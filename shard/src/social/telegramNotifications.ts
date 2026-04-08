/**
 * Telegram Notification System
 *
 * Links player wallets to Telegram chat IDs.
 * Sends instant alerts (level-up, death) and periodic 4-hour summaries.
 *
 * Storage: in-memory map + Redis (tg:wallet:{addr} → chatId)
 */

import { getRedis } from "../redis.js";
import { setDiaryAlertHook, readMergedDiary, type DiaryAction, type DiaryEntry } from "./diary.js";
import {
  deleteTelegramWalletLink,
  getTelegramWalletLink,
  listTelegramWalletLinks,
  updateTelegramSummaryTimestamp,
  upsertTelegramWalletLink,
} from "../db/notificationStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

// ── In-memory storage ────────────────────────────────────────────────────
const walletToChatId = new Map<string, string>();
const lastInstantAlert = new Map<string, number>();
let pollingOffset = 0;
let botInitialized = false;

// ── Redis key helpers ─────────────────────────────────────────────────────
const tgWalletKey = (wallet: string) => `tg:wallet:${wallet.toLowerCase()}`;
const tgSummaryKey = (wallet: string) => `tg:summary:${wallet.toLowerCase()}`;

// ── Bot API ───────────────────────────────────────────────────────────────
function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}

export function getBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? "";
}

async function callBotApi(method: string, body: Record<string, unknown>): Promise<any> {
  const token = botToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  } catch {
    return null;
  }
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  await callBotApi("sendMessage", { chat_id: chatId, text });
}

// ── Storage helpers ───────────────────────────────────────────────────────
async function storeChatId(wallet: string, chatId: string): Promise<void> {
  const key = wallet.toLowerCase();
  walletToChatId.set(key, chatId);
  if (isPostgresConfigured()) {
    await upsertTelegramWalletLink(key, chatId);
  }
  const redis = getRedis();
  if (redis) {
    await redis.set(tgWalletKey(key), chatId);
  }
}

export async function getTelegramChatId(wallet: string): Promise<string | null> {
  const key = wallet.toLowerCase();
  if (walletToChatId.has(key)) return walletToChatId.get(key)!;
  if (isPostgresConfigured()) {
    const chatId = await getTelegramWalletLink(key);
    if (chatId) {
      walletToChatId.set(key, chatId);
      return chatId;
    }
  }
  const redis = getRedis();
  if (redis) {
    try {
      const chatId: string | null = await redis.get(tgWalletKey(key));
      if (chatId) {
        walletToChatId.set(key, chatId);
        return chatId;
      }
    } catch {
      // fall through
    }
  }
  return null;
}

export async function unlinkTelegramChat(wallet: string): Promise<void> {
  const key = wallet.toLowerCase();
  walletToChatId.delete(key);
  if (isPostgresConfigured()) {
    await deleteTelegramWalletLink(key);
  }
  const redis = getRedis();
  if (redis) {
    await redis.del(tgWalletKey(key));
  }
}

async function loadMappingsFromRedis(): Promise<void> {
  if (isPostgresConfigured()) {
    try {
      const links = await listTelegramWalletLinks();
      for (const link of links) {
        walletToChatId.set(link.wallet, link.chatId);
      }
      if (walletToChatId.size > 0) {
        console.log(`[telegram] Loaded ${walletToChatId.size} linked wallet(s) from Postgres`);
      }
      return;
    } catch (err: any) {
      console.warn("[telegram] Failed to load Postgres mappings:", err.message);
    }
    return;
  }
  const redis = getRedis();
  if (!redis) return;
  try {
    const keys: string[] = await redis.keys("tg:wallet:*");
    for (const key of keys) {
      const chatId: string | null = await redis.get(key);
      if (chatId) {
        const wallet = key.replace("tg:wallet:", "");
        walletToChatId.set(wallet, chatId);
      }
    }
    if (walletToChatId.size > 0) {
      console.log(`[telegram] Loaded ${walletToChatId.size} linked wallet(s) from Redis`);
    }
  } catch (err: any) {
    console.warn("[telegram] Failed to load Redis mappings:", err.message);
  }
}

// ── Instant alerts ────────────────────────────────────────────────────────
export async function sendInstantAlert(wallet: string, text: string): Promise<void> {
  const now = Date.now();
  const key = wallet.toLowerCase();
  const lastAlert = lastInstantAlert.get(key) ?? 0;
  if (now - lastAlert < 60_000) return; // 1 alert per 60s max
  lastInstantAlert.set(key, now);
  const chatId = await getTelegramChatId(key);
  if (!chatId) return;
  await sendTelegramMessage(chatId, text).catch(() => {});
}

function buildAlertText(action: DiaryAction, entry: DiaryEntry): string {
  const name = entry.characterName;
  if (action === "level_up") {
    const level = (entry.details.newLevel as number) ?? "?";
    return `🎉 ${name} reached level ${level}!`;
  }
  if (action === "death") {
    const zone = entry.zoneId
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return `💀 ${name} was slain in ${zone}.`;
  }
  return "";
}

// ── Periodic summary job ──────────────────────────────────────────────────
async function runSummaryJob(): Promise<void> {
  const now = Date.now();
  const windowMs = 4 * 60 * 60 * 1000;
  const persistedLinks = isPostgresConfigured() ? await listTelegramWalletLinks().catch(() => []) : [];
  const persistedSummaryByWallet = new Map(
    persistedLinks.map((link) => [link.wallet, link.lastSummaryAt ?? null])
  );

  for (const [wallet, chatId] of walletToChatId) {
    try {
      const redis = getRedis();
      let lastSummaryAt = now - windowMs;
      if (redis) {
        const stored: string | null = await redis.get(tgSummaryKey(wallet));
        if (stored) lastSummaryAt = parseInt(stored, 10);
      } else if (isPostgresConfigured()) {
        const stored = persistedSummaryByWallet.get(wallet);
        if (stored) lastSummaryAt = stored;
      }

      const entries = await readMergedDiary(wallet, 200, 0);
      const recent = entries.filter((e) => e.timestamp >= lastSummaryAt);

      if (recent.length === 0) continue; // no activity — skip

      const kills = recent.filter((e) => e.action === "kill").length;
      const deaths = recent.filter((e) => e.action === "death").length;
      const quests = recent.filter((e) => e.action === "quest_complete").length;
      const zoneSet = new Set(recent.map((e) => e.zoneId));
      const zones = Array.from(zoneSet)
        .map((z) =>
          z
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
        )
        .join(" → ");
      const levelUps = recent.filter((e) => e.action === "level_up");
      const charName = recent[0]?.characterName ?? wallet.slice(0, 8);

      let msg = `📜 ${charName}'s Last 4 Hours\n`;
      msg += `──────────────────────────\n`;
      msg += `⚔️  Kills: ${kills}  |  Deaths: ${deaths}\n`;
      if (quests > 0) msg += `🎯  Quests: ${quests} completed\n`;
      if (levelUps.length > 0) {
        const maxLevel = Math.max(
          ...levelUps.map((e) => (e.details.newLevel as number) ?? 0),
        );
        msg += `📈  Level up: reached ${maxLevel}!\n`;
      }
      if (zones) msg += `🗺️  Zones: ${zones}\n`;
      msg += `──────────────────────────\nNext update in ~4h`;

      await sendTelegramMessage(chatId, msg);

      if (redis) {
        await redis.set(tgSummaryKey(wallet), String(now));
      }
      if (isPostgresConfigured()) {
        await updateTelegramSummaryTimestamp(wallet, now);
      }
    } catch (err: any) {
      console.warn(`[telegram] Summary failed for ${wallet}:`, err.message);
    }
  }
}

// ── Bot update handler ────────────────────────────────────────────────────
interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;

  const chatId = String(message.chat.id);
  const text = message.text.trim();

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const wallet = parts[1]?.trim();
    if (wallet && wallet.startsWith("0x") && wallet.length >= 20) {
      await storeChatId(wallet, chatId);
      await sendTelegramMessage(
        chatId,
        `✅ Connected!\n\nYour wallet (${wallet.slice(0, 8)}...) is now linked.\n\nYou'll receive:\n• 4-hour activity summaries\n• Instant level-up and death alerts`,
      );
    } else {
      await sendTelegramMessage(
        chatId,
        `Welcome to World of Geneva!\n\nTo link your wallet, use the Telegram button in the game onboarding.`,
      );
    }
    return;
  }

  if (text === "/stop") {
    let foundWallet: string | null = null;
    for (const [w, cId] of walletToChatId) {
      if (cId === chatId) {
        foundWallet = w;
        break;
      }
    }
    if (foundWallet) {
      await unlinkTelegramChat(foundWallet);
      await sendTelegramMessage(
        chatId,
        `✅ Unlinked. You won't receive notifications anymore.\n\nYou can re-link anytime from the game.`,
      );
    } else {
      await sendTelegramMessage(chatId, `No wallet linked to this chat.`);
    }
    return;
  }

  if (text === "/status") {
    let foundWallet: string | null = null;
    for (const [w, cId] of walletToChatId) {
      if (cId === chatId) {
        foundWallet = w;
        break;
      }
    }
    if (foundWallet) {
      await sendTelegramMessage(
        chatId,
        `✅ Linked wallet: ${foundWallet.slice(0, 8)}...${foundWallet.slice(-6)}\n\nReceiving: activity summaries + instant alerts`,
      );
    } else {
      await sendTelegramMessage(
        chatId,
        `No wallet linked. Use the game onboarding to connect.`,
      );
    }
    return;
  }
}

// ── Long-polling loop ─────────────────────────────────────────────────────
function startPolling(): void {
  const token = botToken();
  if (!token) return;

  (async () => {
    while (true) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${pollingOffset}&timeout=30`,
          { signal: AbortSignal.timeout(35_000) },
        );
        const data = (await res.json()) as {
          ok: boolean;
          result: TelegramUpdate[];
        };
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            pollingOffset = update.update_id + 1;
            await handleUpdate(update).catch(console.error);
          }
        }
      } catch {
        // Transient error — wait before retry
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  })();
}

// ── Public init ───────────────────────────────────────────────────────────
export async function initTelegramBot(): Promise<void> {
  if (botInitialized) return;
  botInitialized = true;

  const token = botToken();
  if (!token) {
    console.log("[telegram] TELEGRAM_BOT_TOKEN not set — skipping bot init");
    return;
  }

  await loadMappingsFromRedis();

  // Wire instant-alert hook into diary system
  setDiaryAlertHook((wallet, action, entry) => {
    const text = buildAlertText(action, entry);
    if (text) sendInstantAlert(wallet, text).catch(() => {});
  });

  startPolling();

  // 4-hour periodic summary
  setInterval(() => runSummaryJob().catch(console.error), 4 * 60 * 60 * 1000);

  console.log(`[telegram] Bot started (@${getBotUsername()})`);
}
