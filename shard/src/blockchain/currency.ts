/**
 * Copper ↔ Silver ↔ Gold conversion utilities (mirrors client/src/lib/currency.ts)
 *
 * 1 Gold   = 100 Silver = 10,000 Copper
 * 1 Silver = 100 Copper = 0.01 Gold
 * 1 Copper = 0.0001 Gold
 */

export const COPPER_PER_SILVER = 100;
export const SILVER_PER_GOLD = 100;
export const COPPER_PER_GOLD = COPPER_PER_SILVER * SILVER_PER_GOLD; // 10_000

/** Convert a copper amount to on-chain gold (e.g. 500 copper → 0.05 gold) */
export const copperToGold = (copper: number): number => copper / COPPER_PER_GOLD;

/** Convert on-chain gold to copper (e.g. 1 gold → 10,000 copper) */
export const goldToCopper = (gold: number): number => Math.floor(gold * COPPER_PER_GOLD);

/** Format a copper amount as a human-readable denomination string (e.g. 150 → "1s 50c") */
export function formatCopperString(copper: number): string {
  const total = Math.floor(copper);
  const g = Math.floor(total / COPPER_PER_GOLD);
  const s = Math.floor((total % COPPER_PER_GOLD) / COPPER_PER_SILVER);
  const c = total % COPPER_PER_SILVER;

  const parts: string[] = [];
  if (g > 0) parts.push(`${g}g`);
  if (s > 0) parts.push(`${s}s`);
  if (c > 0 || parts.length === 0) parts.push(`${c}c`);
  return parts.join(" ");
}
