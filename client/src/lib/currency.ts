/**
 * Currency Utility Module
 *
 * Provides UI abstraction for displaying GOLD cryptocurrency as
 * traditional RPG metal denominations (Gold/Silver/Copper).
 *
 * Conversion Ratios:
 * - 1 GOLD = 100 SILVER = 10,000 COPPER
 * - 1 SILVER = 100 COPPER = 0.01 GOLD
 * - 1 COPPER = 0.0001 GOLD
 *
 * Note: This is purely a display/input abstraction. The blockchain
 * still only stores ERC-20 GOLD tokens with 18 decimals.
 */

export interface MetalBreakdown {
  gold: number;      // Whole gold pieces (0-∞)
  silver: number;    // Silver pieces (0-99)
  copper: number;    // Copper pieces (0-99)
  totalGold: number; // Original gold decimal value
}

/**
 * Converts a gold decimal amount to metal denomination breakdown
 *
 * @param goldAmount - The gold amount as a decimal (e.g., 123.4567)
 * @returns Breakdown of gold, silver, and copper pieces
 *
 * @example
 * formatGoldToMetals(123.4567)
 * // Returns: { gold: 123, silver: 45, copper: 67, totalGold: 123.4567 }
 */
export function formatGoldToMetals(goldAmount: number): MetalBreakdown {
  // Convert to copper (smallest unit) to avoid floating point errors
  // 1 gold = 10,000 copper
  const totalCopper = Math.floor(goldAmount * 10000);

  // Extract each denomination
  const gold = Math.floor(totalCopper / 10000);
  const silver = Math.floor((totalCopper % 10000) / 100);
  const copper = totalCopper % 100;

  return {
    gold,
    silver,
    copper,
    totalGold: goldAmount
  };
}

/**
 * Converts metal denominations to a gold decimal amount
 *
 * @param gold - Number of gold pieces
 * @param silver - Number of silver pieces (0-99)
 * @param copper - Number of copper pieces (0-99)
 * @returns Total gold amount as a decimal
 *
 * @example
 * parseMetalsToGold(10, 5, 25)
 * // Returns: 10.0525
 */
export function parseMetalsToGold(
  gold: number = 0,
  silver: number = 0,
  copper: number = 0
): number {
  // Clamp silver and copper to valid ranges
  const clampedSilver = Math.min(99, Math.max(0, Math.floor(silver)));
  const clampedCopper = Math.min(99, Math.max(0, Math.floor(copper)));

  return (gold * 1) + (clampedSilver * 0.01) + (clampedCopper * 0.0001);
}

/**
 * Formats gold amount as a human-readable string with denominations
 *
 * @param goldAmount - The gold amount as a decimal
 * @param options - Formatting options
 * @returns Formatted string like "123g 45s 67c" or "10g 5s"
 *
 * @example
 * formatGoldString(123.4567)
 * // Returns: "123g 45s 67c"
 *
 * formatGoldString(10.05)
 * // Returns: "10g 5s"
 *
 * formatGoldString(0.0025)
 * // Returns: "25c"
 *
 * formatGoldString(0)
 * // Returns: "0c"
 */
export function formatGoldString(
  goldAmount: number,
  options: { showZero?: boolean } = {}
): string {
  const { gold, silver, copper } = formatGoldToMetals(goldAmount);

  const parts: string[] = [];

  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0) parts.push(`${silver}s`);
  if (copper > 0) parts.push(`${copper}c`);

  // Handle zero case
  if (parts.length === 0) {
    return options.showZero !== false ? '0c' : '';
  }

  return parts.join(' ');
}

/**
 * Formats gold amount with full denomination labels
 *
 * @param goldAmount - The gold amount as a decimal
 * @returns Formatted string like "123 gold, 45 silver, 67 copper"
 *
 * @example
 * formatGoldStringLong(123.4567)
 * // Returns: "123 gold, 45 silver, 67 copper"
 */
export function formatGoldStringLong(goldAmount: number): string {
  const { gold, silver, copper } = formatGoldToMetals(goldAmount);

  const parts: string[] = [];

  if (gold > 0) {
    parts.push(`${gold} ${gold === 1 ? 'gold' : 'gold'}`);
  }
  if (silver > 0) {
    parts.push(`${silver} ${silver === 1 ? 'silver' : 'silver'}`);
  }
  if (copper > 0) {
    parts.push(`${copper} ${copper === 1 ? 'copper' : 'copper'}`);
  }

  if (parts.length === 0) return '0 copper';

  return parts.join(', ');
}

/**
 * Parses a formatted gold string back to decimal amount
 *
 * @param goldString - String like "10g 5s 25c" or "100g" or "50c"
 * @returns Gold decimal amount
 *
 * @example
 * parseGoldString("10g 5s 25c")
 * // Returns: 10.0525
 *
 * parseGoldString("100g")
 * // Returns: 100.0
 */
export function parseGoldString(goldString: string): number {
  const goldMatch = goldString.match(/(\d+)g/);
  const silverMatch = goldString.match(/(\d+)s/);
  const copperMatch = goldString.match(/(\d+)c/);

  const gold = goldMatch ? parseInt(goldMatch[1]) : 0;
  const silver = silverMatch ? parseInt(silverMatch[1]) : 0;
  const copper = copperMatch ? parseInt(copperMatch[1]) : 0;

  return parseMetalsToGold(gold, silver, copper);
}

/**
 * Validates if a metal denomination is within valid ranges
 *
 * @param gold - Gold pieces
 * @param silver - Silver pieces (should be 0-99)
 * @param copper - Copper pieces (should be 0-99)
 * @returns True if valid, false otherwise
 */
/** Convert copper to on-chain gold (e.g. 500 copper → 0.05 gold) */
export const COPPER_PER_GOLD = 10_000;
export const copperToGold = (copper: number): number => copper / COPPER_PER_GOLD;
export const goldToCopper = (gold: number): number => Math.floor(gold * COPPER_PER_GOLD);

/**
 * Format a copper amount as a human-readable denomination string.
 * e.g. 150 → "1s 50c", 10050 → "1g 50c"
 */
export function formatCopperString(copper: number): string {
  return formatGoldString(copperToGold(copper));
}

export function isValidMetalAmount(
  gold: number,
  silver: number,
  copper: number
): boolean {
  return (
    gold >= 0 &&
    silver >= 0 && silver <= 99 &&
    copper >= 0 && copper <= 99 &&
    Number.isFinite(gold) &&
    Number.isFinite(silver) &&
    Number.isFinite(copper)
  );
}
