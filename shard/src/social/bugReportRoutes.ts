import type { FastifyInstance, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { getRedis } from "../redis.js";

const VALID_CATEGORIES = new Set(["gameplay", "visual", "performance", "crash", "other"]);

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const RECENT_LIST_KEY = "bugs:recent";
const RECENT_LIST_CAP = 500;

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

function clientIp(request: FastifyRequest): string {
  const fwd = (request.headers["x-forwarded-for"] as string | undefined) ?? "";
  if (fwd) return fwd.split(",")[0]?.trim() ?? "";
  return request.ip ?? "unknown";
}

function clamp(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}

type BugReportContext = {
  walletAddress?: string;
  characterId?: string;
  characterName?: string;
  zoneId?: string;
  url?: string;
  userAgent?: string;
  screen?: string;
  devicePixelRatio?: number;
  qualityTier?: string;
  clientVersion?: string;
  recentErrors?: string[];
};

type BugReportBody = {
  category?: string;
  title?: string;
  description?: string;
  context?: BugReportContext;
};

function sanitizeContext(raw: BugReportContext | undefined): BugReportContext {
  if (!raw || typeof raw !== "object") return {};
  const errs = Array.isArray(raw.recentErrors)
    ? raw.recentErrors.slice(0, 20).map((s) => String(s).slice(0, 500))
    : [];
  return {
    walletAddress: clamp(raw.walletAddress, 64) || undefined,
    characterId: clamp(raw.characterId, 64) || undefined,
    characterName: clamp(raw.characterName, 64) || undefined,
    zoneId: clamp(raw.zoneId, 64) || undefined,
    url: clamp(raw.url, 512) || undefined,
    userAgent: clamp(raw.userAgent, 512) || undefined,
    screen: clamp(raw.screen, 32) || undefined,
    devicePixelRatio: typeof raw.devicePixelRatio === "number" ? raw.devicePixelRatio : undefined,
    qualityTier: clamp(raw.qualityTier, 32) || undefined,
    clientVersion: clamp(raw.clientVersion, 64) || undefined,
    recentErrors: errs.length ? errs : undefined,
  };
}

async function forwardToTelegram(id: string, payload: Record<string, unknown>): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_BUG_REPORT_CHAT_ID;
  if (!token || !chatId) return;
  const ctx = (payload.context as BugReportContext) ?? {};
  const lines = [
    `🐞 *Bug Report* \`${id}\``,
    `*Category:* ${payload.category}`,
    `*Title:* ${payload.title}`,
    "",
    String(payload.description ?? "").slice(0, 1500),
    "",
    `*Char:* ${ctx.characterName ?? "?"} (${ctx.characterId ?? "?"})`,
    `*Zone:* ${ctx.zoneId ?? "?"}  *Tier:* ${ctx.qualityTier ?? "?"}`,
    `*Wallet:* ${ctx.walletAddress ?? "?"}`,
    `*URL:* ${ctx.url ?? "?"}`,
    `*UA:* ${(ctx.userAgent ?? "?").slice(0, 120)}`,
  ];
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
  } catch {}
}

export function registerBugReportRoutes(server: FastifyInstance): void {
  server.post<{ Body: BugReportBody }>("/bug-report", async (request, reply) => {
    const body = request.body ?? {};

    const category = String(body.category ?? "").toLowerCase();
    const title = clamp(body.title, 80);
    const description = clamp(body.description, 1000);

    if (!VALID_CATEGORIES.has(category)) {
      reply.code(400);
      return { error: "Invalid category" };
    }
    if (title.length < 1) {
      reply.code(400);
      return { error: "Title is required" };
    }
    if (description.length < 1) {
      reply.code(400);
      return { error: "Description is required" };
    }

    const context = sanitizeContext(body.context);
    const ip = clientIp(request);
    const wallet = context.walletAddress ?? "";
    const limitKey = wallet ? `w:${wallet.toLowerCase()}` : `ip:${ip}`;

    if (!checkRateLimit(limitKey)) {
      reply.code(429);
      return { error: "Too many reports. Please try again later." };
    }

    const id = `bug_${crypto.randomBytes(4).toString("hex")}`;
    const record = {
      id,
      category,
      title,
      description,
      context,
      ip,
      createdAt: Date.now(),
    };

    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(`bug:report:${id}`, JSON.stringify(record));
        await redis.lpush(RECENT_LIST_KEY, id);
        await redis.ltrim(RECENT_LIST_KEY, 0, RECENT_LIST_CAP - 1);
      } catch (err) {
        request.log.warn({ err }, "[bug-report] redis write failed");
      }
    } else {
      request.log.info({ record }, "[bug-report] received (no redis)");
    }

    forwardToTelegram(id, record).catch(() => {});

    return { id };
  });
}
