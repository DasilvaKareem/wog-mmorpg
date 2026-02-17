/** Copper ↔ Gold conversion utilities (mirrors client/src/lib/currency.ts) */

export const COPPER_PER_GOLD = 10_000;

/** Convert a copper amount to on-chain gold (e.g. 500 copper → 0.05 gold) */
export const copperToGold = (copper: number): number => copper / COPPER_PER_GOLD;

/** Convert on-chain gold to copper (e.g. 1 gold → 10,000 copper) */
export const goldToCopper = (gold: number): number => Math.floor(gold * COPPER_PER_GOLD);
