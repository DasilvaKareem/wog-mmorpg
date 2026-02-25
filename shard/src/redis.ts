/**
 * Shared Redis client singleton.
 * Lazy-loads ioredis if REDIS_URL is set, otherwise returns null (in-memory fallback).
 * If Redis becomes unreachable, automatically falls back to null so callers use in-memory.
 */

let redis: any = null;
let initialized = false;

function resolveRedisUrl(): { url: string | null; source: string | null } {
  const candidates: Array<[string, string | undefined]> = [
    ["REDIS_URL", process.env.REDIS_URL],
    ["UPSTASH_REDIS_URL", process.env.UPSTASH_REDIS_URL],
    ["REDIS_TLS_URL", process.env.REDIS_TLS_URL],
  ];

  for (const [name, value] of candidates) {
    if (!value) continue;
    if (value.startsWith("redis://") || value.startsWith("rediss://")) {
      return { url: value, source: name };
    }
    console.warn(`[redis] Ignoring ${name}: expected redis:// or rediss:// URL`);
  }

  if (process.env.UPSTASH_REDIS_REST_URL) {
    console.warn("[redis] UPSTASH_REDIS_REST_URL is set, but ioredis requires REDIS_URL/UPSTASH_REDIS_URL (redis://)");
  }

  return { url: null, source: null };
}

async function init() {
  if (initialized) return;
  initialized = true;

  const { url: redisUrl, source } = resolveRedisUrl();

  if (redisUrl) {
    try {
      const Redis = (await import("ioredis")).default as any;
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times: number) {
          if (times > 5) {
            console.warn("[redis] Max reconnect attempts reached, falling back to in-memory");
            return null; // stop retrying
          }
          return Math.min(times * 500, 3000);
        },
        connectTimeout: 5000,
        lazyConnect: true,
      });

      client.on("error", (err: Error) => {
        if (redis) {
          console.warn("[redis] Connection lost, falling back to in-memory:", err.message);
          redis = null;
        }
      });

      client.on("connect", () => {
        console.log("[redis] Connected");
        redis = client;
      });

      await client.connect();
      redis = client;
      console.log(`[redis] Ready (${source}):`, redisUrl.replace(/\/\/.*@/, "//***@"));
    } catch (err: any) {
      console.warn("[redis] Failed to connect, using in-memory fallback:", err.message);
      redis = null;
    }
  } else {
    console.log("[redis] No Redis URL configured, using in-memory fallback");
  }
}

// Initialize eagerly on import
await init();

/** Returns the shared Redis client, or null if unavailable */
export function getRedis(): any {
  return redis;
}
