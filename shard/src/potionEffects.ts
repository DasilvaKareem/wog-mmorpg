/**
 * Potion/Elixir/Tonic effect definitions.
 *
 * Four categories of consumable liquids:
 *   Elixir  – Combat essence liquids (stat buffs for fighting)
 *   Potion  – Support liquids (HP/MP restoration, shields, HoTs)
 *   Tonic   – Safe drink essences (XP boosts, profession boosts, utility)
 *   Nectar  – Naturally occurring liquids (raw gathered ingredients, not consumable)
 *
 * Each effect maps a tokenId to the ActiveEffect it applies when consumed.
 */

export type LiquidCategory = "elixir" | "potion" | "tonic" | "nectar";

export interface PotionEffect {
  tokenId: bigint;
  category: LiquidCategory;
  /** Flat HP restored instantly on consume (potions). */
  hpRestore?: number;
  /** Flat MP/essence restored instantly on consume (potions). */
  mpRestore?: number;
  /** Buff effect applied as ActiveEffect. */
  buff?: {
    name: string;
    type: "buff" | "hot" | "shield";
    /** Duration in ticks (500ms each). 600 ticks = 5 min. */
    durationTicks: number;
    /** Percentage stat modifiers (e.g. { str: 20 } = +20% STR). */
    statModifiers?: Record<string, number>;
    /** HP healed per tick (HoT). */
    hotHealPerTick?: number;
    /** Shield HP absorb amount. */
    shieldHp?: number;
  };
  /** XP multiplier while tonic is active (e.g. 1.5 = +50% XP). */
  xpMultiplier?: number;
  /** Element name for resistance elixirs. */
  elementResist?: string;
}

// Ticks per minute = 120 (500ms ticks)
const MIN_5 = 600;
const MIN_10 = 1200;
const MIN_15 = 1800;
const MIN_20 = 2400;
const MIN_30 = 3600;

export const POTION_EFFECTS: Record<string, PotionEffect> = {
  // ── Potions (Support) ─────────────────────────────────────────────

  // TokenId 45 — Minor Health Potion
  "45": {
    tokenId: 45n,
    category: "potion",
    hpRestore: 30,
  },
  // TokenId 46 — Minor Mana Potion
  "46": {
    tokenId: 46n,
    category: "potion",
    mpRestore: 20,
  },
  // TokenId 50 — Greater Health Potion
  "50": {
    tokenId: 50n,
    category: "potion",
    hpRestore: 100,
  },
  // TokenId 51 — Greater Mana Potion
  "51": {
    tokenId: 51n,
    category: "potion",
    mpRestore: 70,
  },

  // ── Elixirs (Combat) ──────────────────────────────────────────────

  // TokenId 47 — Stamina Elixir
  "47": {
    tokenId: 47n,
    category: "elixir",
    buff: {
      name: "Stamina Boost",
      type: "hot",
      durationTicks: MIN_5,
      hotHealPerTick: 2, // slow regen over 5 min
    },
  },
  // TokenId 48 — Wisdom Potion
  "48": {
    tokenId: 48n,
    category: "elixir",
    buff: {
      name: "Wisdom",
      type: "buff",
      durationTicks: MIN_10,
      statModifiers: { int: 15 },
    },
  },
  // TokenId 49 — Swift Step Potion
  "49": {
    tokenId: 49n,
    category: "elixir",
    buff: {
      name: "Swift Step",
      type: "buff",
      durationTicks: MIN_5,
      statModifiers: { agi: 20 },
    },
  },
  // TokenId 52 — Elixir of Strength
  "52": {
    tokenId: 52n,
    category: "elixir",
    buff: {
      name: "Strength",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { str: 20 },
    },
  },
  // TokenId 53 — Elixir of Vitality
  "53": {
    tokenId: 53n,
    category: "elixir",
    buff: {
      name: "Vitality",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { def: 15, hp: 10 },
    },
  },
  // TokenId 54 — Philosopher's Elixir (legendary)
  "54": {
    tokenId: 54n,
    category: "elixir",
    buff: {
      name: "Philosopher's Enlightenment",
      type: "buff",
      durationTicks: MIN_30,
      statModifiers: { str: 15, def: 15, agi: 15, int: 15 },
    },
  },

  // ── Enchantment Elixirs (Combat — elemental damage/resist) ────────

  // TokenId 55 — Fire Enchantment Elixir
  "55": {
    tokenId: 55n,
    category: "elixir",
    buff: {
      name: "Fire Enchantment",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { str: 10 },
    },
    elementResist: "fire",
  },
  // TokenId 56 — Ice Enchantment Elixir
  "56": {
    tokenId: 56n,
    category: "elixir",
    buff: {
      name: "Ice Enchantment",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { str: 5, agi: 5 },
    },
    elementResist: "ice",
  },
  // TokenId 57 — Lightning Enchantment Elixir
  "57": {
    tokenId: 57n,
    category: "elixir",
    buff: {
      name: "Lightning Enchantment",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { str: 8, agi: 8 },
    },
    elementResist: "lightning",
  },
  // TokenId 58 — Holy Enchantment Elixir
  "58": {
    tokenId: 58n,
    category: "elixir",
    buff: {
      name: "Holy Enchantment",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { str: 8, def: 5 },
    },
    elementResist: "holy",
  },
  // TokenId 59 — Shadow Enchantment Elixir
  "59": {
    tokenId: 59n,
    category: "elixir",
    buff: {
      name: "Shadow Enchantment",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { str: 10, agi: 5 },
    },
    elementResist: "shadow",
  },
  // TokenId 60 — Sharpness Elixir
  "60": {
    tokenId: 60n,
    category: "elixir",
    buff: {
      name: "Sharpness",
      type: "buff",
      durationTicks: MIN_10,
      statModifiers: { str: 15 },
    },
  },
  // TokenId 61 — Durability Elixir
  "61": {
    tokenId: 61n,
    category: "elixir",
    buff: {
      name: "Durability",
      type: "buff",
      durationTicks: MIN_20,
      statModifiers: { def: 8 },
    },
  },

  // ── Tonics (XP Boosts) ────────────────────────────────────────────

  // TokenId 140 — Meadow Tonic (+50% XP for 5 min)
  "140": {
    tokenId: 140n,
    category: "tonic",
    xpMultiplier: 1.5,
    buff: {
      name: "Meadow Vigor",
      type: "buff",
      durationTicks: MIN_5,
    },
  },
  // TokenId 141 — Starbloom Tonic (+100% XP for 10 min)
  "141": {
    tokenId: 141n,
    category: "tonic",
    xpMultiplier: 2.0,
    buff: {
      name: "Starbloom Brilliance",
      type: "buff",
      durationTicks: MIN_10,
    },
  },
  // TokenId 142 — Dragon's Breath Tonic (+200% XP for 15 min)
  "142": {
    tokenId: 142n,
    category: "tonic",
    xpMultiplier: 3.0,
    buff: {
      name: "Draconic Fury",
      type: "buff",
      durationTicks: MIN_15,
    },
  },
  // TokenId 143 — Apprentice's Tonic (+50% profession XP for 10 min)
  "143": {
    tokenId: 143n,
    category: "tonic",
    buff: {
      name: "Apprentice Focus",
      type: "buff",
      durationTicks: MIN_10,
    },
  },

  // ── Resistance Elixirs (required for L25+ zones) ──────────────────

  // TokenId 144 — Fire Resistance Elixir
  "144": {
    tokenId: 144n,
    category: "elixir",
    buff: {
      name: "Fire Resistance",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { def: 5 },
    },
    elementResist: "fire",
  },
  // TokenId 145 — Shadow Resistance Elixir
  "145": {
    tokenId: 145n,
    category: "elixir",
    buff: {
      name: "Shadow Resistance",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { def: 5 },
    },
    elementResist: "shadow",
  },
  // TokenId 146 — Ice Resistance Elixir
  "146": {
    tokenId: 146n,
    category: "elixir",
    buff: {
      name: "Ice Resistance",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { def: 5 },
    },
    elementResist: "ice",
  },
  // TokenId 147 — Lightning Resistance Elixir
  "147": {
    tokenId: 147n,
    category: "elixir",
    buff: {
      name: "Lightning Resistance",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { def: 5 },
    },
    elementResist: "lightning",
  },
  // TokenId 148 — Holy Resistance Elixir
  "148": {
    tokenId: 148n,
    category: "elixir",
    buff: {
      name: "Holy Resistance",
      type: "buff",
      durationTicks: MIN_15,
      statModifiers: { def: 5 },
    },
    elementResist: "holy",
  },
};

/** Look up potion effect by token ID. */
export function getPotionEffect(tokenId: bigint): PotionEffect | undefined {
  return POTION_EFFECTS[tokenId.toString()];
}

/** Check if an entity has an active XP tonic buff. Returns the multiplier (default 1.0). */
export function getActiveXpMultiplier(activeEffects?: Array<{ name: string; remainingTicks: number }>): number {
  if (!activeEffects || activeEffects.length === 0) return 1.0;

  // Check for tonic buff names and return highest multiplier
  let maxMultiplier = 1.0;
  for (const effect of activeEffects) {
    if (effect.remainingTicks <= 0) continue;
    if (effect.name === "Meadow Vigor") maxMultiplier = Math.max(maxMultiplier, 1.5);
    if (effect.name === "Starbloom Brilliance") maxMultiplier = Math.max(maxMultiplier, 2.0);
    if (effect.name === "Draconic Fury") maxMultiplier = Math.max(maxMultiplier, 3.0);
  }
  return maxMultiplier;
}

/** Check if an entity has a specific element resistance active. */
export function hasElementResist(activeEffects?: Array<{ name: string; remainingTicks: number }>, element?: string): boolean {
  if (!activeEffects || !element) return false;
  const resistName = `${element.charAt(0).toUpperCase() + element.slice(1)} Resistance`;
  // Also check enchantment elixirs which grant their element
  const enchantName = `${element.charAt(0).toUpperCase() + element.slice(1)} Enchantment`;
  return activeEffects.some(
    (e) => e.remainingTicks > 0 && (e.name === resistName || e.name === enchantName)
  );
}
