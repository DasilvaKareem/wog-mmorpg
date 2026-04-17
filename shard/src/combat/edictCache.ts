// ── In-memory edict cache ───────────────────────────────────────────
//
// Keyed by lowercase wallet address. Populated by:
//   1. Agent runner each tick (reads config from Redis, syncs here)
//   2. PUT /agent/edicts endpoint (writes Redis + updates here)
//
// Read by zoneRuntime auto-combat loop (synchronous, can't await Redis).

import type { Edict } from "./edicts.js";

const cache = new Map<string, Edict[]>();

export function getEdictCache(wallet: string): Edict[] | undefined {
  return cache.get(wallet.toLowerCase());
}

export function setEdictCache(wallet: string, edicts: Edict[]): void {
  const key = wallet.toLowerCase();
  if (edicts.length === 0) {
    cache.delete(key);
  } else {
    cache.set(key, edicts);
  }
}

export function clearEdictCache(wallet: string): void {
  cache.delete(wallet.toLowerCase());
}
