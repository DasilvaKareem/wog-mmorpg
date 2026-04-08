/**
 * Web Push Notification Service
 *
 * Implements RFC 8292 Voluntary Application Server Identification (VAPID)
 * push notifications for all platforms:
 *   - Android (Chrome, Samsung Internet, Firefox)
 *   - iOS (Safari 16.4+, Chrome 128+ on iOS)
 *   - Windows (Chrome, Edge, Firefox)
 *   - macOS (Safari 16.4+, Chrome, Firefox)
 *   - Linux (Chrome, Firefox)
 *
 * Environment variables required:
 *   VAPID_PUBLIC_KEY  — base64url encoded 65-byte uncompressed EC public key
 *   VAPID_PRIVATE_KEY — base64url encoded 32-byte EC private key
 *   VAPID_EMAIL       — contact email for push service (e.g. mailto:admin@worldofgeneva.com)
 *
 * Generate keys once with:
 *   npx web-push generate-vapid-keys
 */

import webPush, { type PushSubscription } from "web-push";
import { getRedis } from "../redis.js";
import { setDiaryPushHook, type DiaryAction, type DiaryEntry } from "./diary.js";
import {
  deleteWebPushSubscription,
  getWebPushSubscription,
  listWebPushWallets,
  upsertWebPushSubscription,
} from "../db/notificationStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

// ── VAPID configuration ───────────────────────────────────────────────────
let vapidConfigured = false;

function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@worldofgeneva.com";

  if (!publicKey || !privateKey) {
    console.warn(
      "[web-push] VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set. " +
        "Run: npx web-push generate-vapid-keys"
    );
    return;
  }

  webPush.setVapidDetails(email, publicKey, privateKey);
  vapidConfigured = true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

// ── Subscription storage (Redis) ──────────────────────────────────────────
const pushSubKey = (wallet: string) => `push:sub:${wallet.toLowerCase()}`;

export interface StoredSubscription {
  subscription: PushSubscription;
  wallet: string;
  createdAt: number;
}

/**
 * Save a push subscription for a wallet address.
 * Each wallet can have one active subscription (last-wins).
 */
export async function saveSubscription(
  wallet: string,
  subscription: PushSubscription
): Promise<void> {
  const data: StoredSubscription = {
    subscription,
    wallet: wallet.toLowerCase(),
    createdAt: Date.now(),
  };
  if (isPostgresConfigured()) {
    await upsertWebPushSubscription(data.wallet, data.subscription, data.createdAt);
  }
  const redis = getRedis();
  if (!redis) {
    return;
  }
  // Keep subscription for 1 year (subscriptions can expire but this gives headroom)
  await redis.set(pushSubKey(wallet), JSON.stringify(data), "EX", 365 * 24 * 60 * 60);
}

/**
 * Remove a push subscription for a wallet address.
 */
export async function removeSubscription(wallet: string): Promise<void> {
  if (isPostgresConfigured()) {
    await deleteWebPushSubscription(wallet);
  }
  const redis = getRedis();
  if (!redis) return;
  await redis.del(pushSubKey(wallet));
}

/**
 * Retrieve a stored push subscription for a wallet.
 */
export async function getSubscription(
  wallet: string
): Promise<PushSubscription | null> {
  if (isPostgresConfigured()) {
    const subscription = await getWebPushSubscription(wallet);
    if (subscription) return subscription;
  }
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(pushSubKey(wallet));
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredSubscription;
    return data.subscription;
  } catch {
    return null;
  }
}

// ── Send push notification ────────────────────────────────────────────────
export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  url?: string;
  image?: string;
  actions?: Array<{ action: string; title: string }>;
}

/**
 * Send a push notification to a specific wallet's registered device(s).
 * Returns true if sent successfully, false if no subscription or not configured.
 */
export async function sendPushToWallet(
  wallet: string,
  payload: PushPayload
): Promise<boolean> {
  ensureVapidConfigured();
  if (!vapidConfigured) return false;

  const subscription = await getSubscription(wallet);
  if (!subscription) return false;

  const enrichedPayload = {
    ...payload,
    icon: payload.icon ?? "/favicon-192.png",
    badge: "/favicon-192.png",
    tag: payload.tag ?? "wog-game",
    url: payload.url ?? "/world",
    timestamp: Date.now(),
  };

  try {
    await webPush.sendNotification(subscription, JSON.stringify(enrichedPayload));
    return true;
  } catch (err: any) {
    // 410 Gone or 404 Not Found = subscription expired/invalid → clean up
    if (err.statusCode === 410 || err.statusCode === 404) {
      await removeSubscription(wallet);
      console.log(`[web-push] Removed expired subscription for ${wallet}`);
    } else {
      console.warn(`[web-push] Failed to send to ${wallet}:`, err.message);
    }
    return false;
  }
}

/**
 * Broadcast a push notification to all wallets with subscriptions.
 * Used for world events (invasions, seasonal events, etc.)
 */
export async function broadcastPush(payload: PushPayload): Promise<number> {
  ensureVapidConfigured();
  if (!vapidConfigured) return 0;

  let sent = 0;
  try {
    const wallets = isPostgresConfigured()
      ? await listWebPushWallets()
      : (() => [] as string[])();
    const redis = getRedis();
    const keys: string[] = wallets.length > 0
      ? wallets.map((wallet) => `push:sub:${wallet}`)
      : !isPostgresConfigured() && redis
        ? await redis.keys("push:sub:*")
        : [];
    const results = await Promise.allSettled(
      keys.map(async (key: string) => {
        const wallet = key.replace("push:sub:", "");
        const ok = await sendPushToWallet(wallet, payload);
        if (ok) sent++;
      })
    );
    // Log any unexpected failures
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("[web-push] Broadcast error:", r.reason);
      }
    }
  } catch (err: any) {
    console.warn("[web-push] Broadcast failed:", err.message);
  }
  return sent;
}

// ── Diary hook integration ────────────────────────────────────────────────

function buildPushPayload(action: DiaryAction, entry: DiaryEntry): PushPayload | null {
  const name = entry.characterName;
  if (action === "level_up") {
    const level = (entry.details.newLevel as number) ?? "?";
    return {
      title: "Level Up!",
      body: `${name} reached level ${level}! Keep conquering the World of Geneva.`,
      tag: `wog-levelup-${entry.walletAddress}`,
      url: "/world",
    };
  }
  if (action === "death") {
    const zone = entry.zoneId
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return {
      title: "You Were Slain",
      body: `${name} fell in ${zone}. Respawn and seek your revenge!`,
      tag: `wog-death-${entry.walletAddress}`,
      url: "/world",
    };
  }
  if (action === "quest_complete") {
    const questName = (entry.details.questName as string) ?? "a quest";
    return {
      title: "Quest Complete!",
      body: `${name} completed "${questName}". Collect your rewards!`,
      tag: `wog-quest-${entry.walletAddress}`,
      url: "/world",
    };
  }
  return null;
}

/**
 * Wire web push alerts into the diary system.
 * Call once during server startup (after initWebPush or together with initTelegramBot).
 */
export function initWebPushAlerts(): void {
  setDiaryPushHook((wallet, action, entry) => {
    const payload = buildPushPayload(action, entry);
    if (!payload) return;
    // Fire-and-forget
    sendPushToWallet(wallet, payload).catch(() => {});
  });
  console.log("[web-push] Diary push hook registered");
}
