/**
 * Shared Redis client singleton.
 * Redis is the authoritative persistent store by default.
 * In-memory fallback is only enabled when REDIS_ALLOW_MEMORY_FALLBACK=true.
 */

let redis: any = null;
let initialized = false;
let redisConfigured = false;
let memoryFallbackAllowed = false;
let lastRedisError: string | null = null;

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

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

async function init() {
  if (initialized) return;
  initialized = true;

  const { url: redisUrl, source } = resolveRedisUrl();
  redisConfigured = Boolean(redisUrl);
  const fallbackOverride = parseBooleanEnv(process.env.REDIS_ALLOW_MEMORY_FALLBACK);
  memoryFallbackAllowed = fallbackOverride ?? false;

  if (redisUrl) {
    try {
      const Redis = (await import("ioredis")).default as any;
      const needsTls = redisUrl.startsWith("rediss://");
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times: number) {
          return Math.min(times * 500, 3000);
        },
        connectTimeout: 10000,
        lazyConnect: true,
        ...(needsTls ? { tls: { rejectUnauthorized: false } } : {}),
      });

      client.on("error", (err: Error) => {
        lastRedisError = err.message;
        console.warn("[redis] Connection error:", err.message);
      });

      client.on("connect", () => {
        lastRedisError = null;
        console.log("[redis] Connected");
      });

      client.on("close", () => {
        console.warn("[redis] Connection closed; client will retry");
      });

      redis = client;
      await client.connect();
      console.log(`[redis] Ready (${source}):`, redisUrl.replace(/\/\/.*@/, "//***@"));
    } catch (err: any) {
      lastRedisError = err?.message ?? String(err);
      if (memoryFallbackAllowed) {
        console.warn("[redis] Failed to connect, using in-memory fallback:", lastRedisError);
      } else {
        console.error("[redis] Failed to connect and memory fallback is disabled:", lastRedisError);
      }
      redis = null;
    }
  } else {
    if (memoryFallbackAllowed) {
      console.log("[redis] No Redis URL configured, using in-memory fallback");
    } else {
      console.warn("[redis] No Redis URL configured and memory fallback is disabled");
    }
  }
}

// Initialize eagerly on import
await init();

/** Returns the shared Redis client, or null if unavailable */
export function getRedis(): any {
  return redis;
}

/** True when REDIS_URL (or equivalent) is configured. */
export function isRedisConfigured(): boolean {
  return redisConfigured;
}

/**
 * In-memory fallback is disabled by default.
 * Set REDIS_ALLOW_MEMORY_FALLBACK=true to allow dual-mode behavior explicitly.
 */
export function isMemoryFallbackAllowed(): boolean {
  return memoryFallbackAllowed;
}

/** Throw in strict mode when Redis is required but unavailable. */
export function assertRedisAvailable(context: string): void {
  if (redis) return;
  if (memoryFallbackAllowed) return;
  const suffix = lastRedisError ? ` (${lastRedisError})` : "";
  throw new Error(`[redis] ${context}: Redis is required but unavailable${suffix}`);
}
