/**
 * Elemental resistance system.
 *
 * Mobs in L25+ zones have elemental affinities. Without the matching
 * resistance elixir, attackers deal 50% damage and take 150% damage.
 * With the right resistance, damage is normal (1.0x).
 */

export type ElementType = "fire" | "ice" | "lightning" | "shadow" | "holy";

/** Zone → element mapping. Zones below L25 have no element (null). */
export const ZONE_ELEMENTS: Record<string, ElementType | null> = {
  "village-square": null,
  "wild-meadow": null,
  "dark-forest": null,
  "auroral-plains": null,
  "emerald-woods": null,
  "viridian-range": "fire",       // Volcanic highlands
  "moondancer-glade": "shadow",   // Haunted moonlit glade
  "felsrock-citadel": "lightning", // Storm-battered fortress
  "lake-lumina": "holy",          // Radiant sacred lake
  "azurshard-chasm": "ice",       // Frozen crystal chasm
};

/**
 * Get the damage multiplier when attacking a mob in a zone.
 * - No zone element → 1.0 (normal)
 * - Has zone element + attacker has matching resistance → 1.0
 * - Has zone element + attacker lacks resistance → 0.5 (deal half damage)
 */
export function getAttackMultiplier(
  zoneId: string,
  attackerEffects?: Array<{ name: string; remainingTicks: number }>
): number {
  const element = ZONE_ELEMENTS[zoneId];
  if (!element) return 1.0;

  // Check if attacker has matching resistance
  if (hasElementResistFromEffects(attackerEffects, element)) return 1.0;

  return 0.5; // Half damage without resistance
}

/**
 * Get the damage multiplier when a mob attacks a player in a zone.
 * - No zone element → 1.0
 * - Has zone element + defender has matching resistance → 1.0
 * - Has zone element + defender lacks resistance → 1.5 (take 50% more damage)
 */
export function getDefenseMultiplier(
  zoneId: string,
  defenderEffects?: Array<{ name: string; remainingTicks: number }>
): number {
  const element = ZONE_ELEMENTS[zoneId];
  if (!element) return 1.0;

  if (hasElementResistFromEffects(defenderEffects, element)) return 1.0;

  return 1.5; // 50% more damage without resistance
}

function hasElementResistFromEffects(
  effects?: Array<{ name: string; remainingTicks: number }>,
  element?: string
): boolean {
  if (!effects || !element) return false;
  const cap = element.charAt(0).toUpperCase() + element.slice(1);
  return effects.some(
    (e) =>
      e.remainingTicks > 0 &&
      (e.name === `${cap} Resistance` || e.name === `${cap} Enchantment`)
  );
}
