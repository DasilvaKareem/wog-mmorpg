import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL?.trim();

if (!redisUrl) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 15_000,
  ...(redisUrl.startsWith("rediss://") ? { tls: { rejectUnauthorized: false } } : {}),
});

const LIVE_PLAYER_IDS_KEY = "world:live-players";
const LIVE_PLAYER_KEY_PREFIX = "world:live-player:";
const outputDir = path.resolve(process.cwd(), "data", "exports");

function normalizeWallet(value) {
  return String(value ?? "").trim().toLowerCase();
}

function summarizeSession(walletAddress, rawJson) {
  const parsed = JSON.parse(rawJson);
  const entity = parsed?.entity ?? {};
  return {
    walletAddress,
    entityId: entity.id ?? null,
    zoneId: entity.region ?? "village-square",
    sessionState: parsed,
    summary: {
      name: entity.name ?? null,
      level: Number(entity.level ?? 0) || 0,
      classId: entity.classId ?? null,
      raceId: entity.raceId ?? null,
      x: Number(entity.x ?? 0) || 0,
      y: Number(entity.y ?? 0) || 0,
      professions: Array.isArray(parsed?.professions) ? parsed.professions : [],
      savedAt: Number(parsed?.savedAt ?? 0) || 0,
    },
  };
}

async function main() {
  await redis.connect();
  const ids = (await redis.smembers(LIVE_PLAYER_IDS_KEY)).map(normalizeWallet).filter(Boolean);
  const sessions = [];

  for (let i = 0; i < ids.length; i += 1) {
    const walletAddress = ids[i];
    const raw = await redis.get(`${LIVE_PLAYER_KEY_PREFIX}${walletAddress}`);
    if (!raw) continue;
    try {
      sessions.push(summarizeSession(walletAddress, raw));
    } catch (error) {
      console.warn(`[live-sessions] Failed to parse ${walletAddress}: ${String(error?.message ?? error)}`);
    }
  }

  sessions.sort((a, b) => a.walletAddress.localeCompare(b.walletAddress));

  const payload = {
    exportedAt: new Date().toISOString(),
    source: {
      type: "redis",
      keySet: LIVE_PLAYER_IDS_KEY,
      keyPrefix: LIVE_PLAYER_KEY_PREFIX,
    },
    counts: {
      liveSessions: sessions.length,
    },
    liveSessions: sessions,
  };

  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  const outputPath = path.join(outputDir, `prod-redis-live-sessions-${timestamp}.json`);
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[live-sessions] wrote ${outputPath}`);
  console.log(`[live-sessions] exported ${sessions.length} live session(s)`);
}

main()
  .catch((error) => {
    console.error("[live-sessions] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await redis.quit();
    } catch {}
  });
