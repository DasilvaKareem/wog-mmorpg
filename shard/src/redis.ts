/**
 * Shared Redis client singleton.
 * Lazy-loads ioredis if REDIS_URL is set, otherwise returns null (in-memory fallback).
 * If Redis becomes unreachable, automatically falls back to null so callers use in-memory.
 */

let redis: any = null;
let initialized = false;

async function init() {
  if (initialized) return;
  initialized = true;

  if (process.env.REDIS_URL) {
    try {
      const Redis = (await import("ioredis")).default as any;
      const client = new Redis(process.env.REDIS_URL, {
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
      console.log("[redis] Ready:", process.env.REDIS_URL.replace(/\/\/.*@/, "//***@"));
    } catch (err: any) {
      console.warn("[redis] Failed to connect, using in-memory fallback:", err.message);
      redis = null;
    }
  } else {
    console.log("[redis] No REDIS_URL set, using in-memory fallback");
  }
}

// Initialize eagerly on import
await init();

/** Returns the shared Redis client, or null if unavailable */
export function getRedis(): any {
  return redis;
}
