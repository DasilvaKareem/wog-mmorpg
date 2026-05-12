/**
 * Debounced persistence for `activeQuests` progress.
 *
 * Progress increments happen on hot paths (every skinned corpse, killed mob,
 * herb picked, etc.) — writing to Postgres/Redis on each one is wasteful.
 * Callers `markQuestsDirty(entity)` after mutating `entity.activeQuests`;
 * a single save is debounced ~5s later. Shutdown calls `flushAllPendingQuests`.
 */

import { saveCharacter } from "../character/characterStore.js";
import type { Entity } from "../world/zoneRuntime.js";

const FLUSH_DEBOUNCE_MS = 5000;

interface PendingEntry {
  entity: Entity;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingEntry>();

function keyFor(entity: Entity): string | null {
  if (!entity.walletAddress || !entity.name) return null;
  return `${entity.walletAddress.toLowerCase()}:${entity.name}`;
}

async function flushOne(key: string): Promise<void> {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  clearTimeout(entry.timer);
  const { entity } = entry;
  if (!entity.walletAddress || !entity.name) return;
  try {
    await saveCharacter(entity.walletAddress, entity.name, {
      activeQuests: entity.activeQuests ?? [],
    });
  } catch (err) {
    console.error(`[questPersistence] Flush failed for ${entity.name}:`, err);
  }
}

export function markQuestsDirty(entity: Entity): void {
  const key = keyFor(entity);
  if (!key) return;
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    void flushOne(key);
  }, FLUSH_DEBOUNCE_MS);
  if (typeof timer.unref === "function") timer.unref();
  pending.set(key, { entity, timer });
}

export async function flushAllPendingQuests(): Promise<void> {
  const keys = Array.from(pending.keys());
  await Promise.all(keys.map((k) => flushOne(k)));
}
