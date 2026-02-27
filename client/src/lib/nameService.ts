/**
 * Client-side .wog name resolution cache + helpers
 *
 * Usage:
 *   const name = await resolveWogName("0x1a2b...cdef");
 *   const display = displayName("0x1a2b...cdef", name);
 *   // → "Zephyr.wog" or "0x1a2b...cdef"
 */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: string | null;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Resolve a wallet address to its .wog name.
 * Returns the display name (without .wog suffix) or null.
 * Results are cached for 60 seconds.
 */
export async function resolveWogName(
  address: string
): Promise<string | null> {
  const key = address.toLowerCase();

  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) {
    return entry.value;
  }

  try {
    const res = await fetch(`${API_BASE}/name/lookup/${address}`);
    if (!res.ok) {
      cache.set(key, { value: null, expiry: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const data = await res.json();
    // data.name is "Foo.wog" — strip the suffix for the raw name
    const name: string = data.name?.replace(/\.wog$/i, "") ?? null;
    cache.set(key, { value: name, expiry: Date.now() + CACHE_TTL_MS });
    return name;
  } catch {
    return null;
  }
}

/**
 * Display a wallet as either "Name.wog" or a truncated address.
 * Pass a pre-resolved wogName to avoid async calls, or null to truncate.
 */
export function displayName(
  address: string,
  wogName?: string | null
): string {
  if (wogName) return `${wogName}.wog`;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Check if a .wog name is available.
 */
export async function checkNameAvailable(
  name: string
): Promise<{ available: boolean; reason?: string }> {
  try {
    const res = await fetch(`${API_BASE}/name/check/${encodeURIComponent(name)}`);
    return await res.json();
  } catch {
    return { available: false, reason: "Network error" };
  }
}
