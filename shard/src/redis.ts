/**
 * Shared Redis client singleton.
 * Lazy-loads ioredis if REDIS_URL is set, otherwise returns null (in-memory fallback).
 */

let redis: any = null;
let initialized = false;

async function init() {
  if (initialized) return;
  initialized = true;

  if (process.env.REDIS_URL) {
    try {
      const Redis = (await import("ioredis")).default as any;
      redis = new Redis(process.env.REDIS_URL);
      console.log("[redis] Connected:", process.env.REDIS_URL.replace(/\/\/.*@/, "//***@"));
    } catch (err) {
      console.warn("[redis] Failed to connect, falling back to in-memory:", err);
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
