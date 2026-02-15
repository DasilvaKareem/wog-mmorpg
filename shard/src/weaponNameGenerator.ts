import type { QualityTier } from "./itemRng.js";

// ── Weapon Category Detection ────────────────────────────────────────

export type WeaponCategory = "melee" | "ranged" | "magic";
export type WeaponTier = "low" | "mid" | "high";

/**
 * Maps a catalog tokenId to its weapon category and tier.
 * This lets us pick thematic base names even though the
 * blockchain only knows about a handful of tokenIds.
 */
const TOKEN_CATEGORY_MAP: Record<number, { category: WeaponCategory; tier: WeaponTier }> = {
  // Base weapons → Low tier
  2:   { category: "melee",  tier: "low"  }, // Iron Sword
  3:   { category: "melee",  tier: "low"  }, // Steel Longsword
  4:   { category: "ranged", tier: "low"  }, // Hunter's Bow
  5:   { category: "melee",  tier: "low"  }, // Battle Axe
  6:   { category: "magic",  tier: "low"  }, // Apprentice Staff
  7:   { category: "melee",  tier: "low"  }, // Oak Shield (treated as melee)
  // Reinforced → Mid tier
  105: { category: "melee",  tier: "mid"  },
  106: { category: "melee",  tier: "mid"  },
  107: { category: "ranged", tier: "mid"  },
  108: { category: "melee",  tier: "mid"  },
  109: { category: "magic",  tier: "mid"  },
  // Masterwork → High tier
  110: { category: "melee",  tier: "high" },
  111: { category: "melee",  tier: "high" },
  112: { category: "ranged", tier: "high" },
  113: { category: "melee",  tier: "high" },
  114: { category: "magic",  tier: "high" },
};

export function getWeaponMeta(tokenId: number): { category: WeaponCategory; tier: WeaponTier } | undefined {
  return TOKEN_CATEGORY_MAP[tokenId];
}

// ── Base Weapon Names ────────────────────────────────────────────────

const BASE_NAMES: Record<WeaponCategory, Record<WeaponTier, string[]>> = {
  melee: {
    low:  ["Sword", "Dagger", "Club", "Shortsword", "Handaxe", "Cudgel", "Dirk", "Knife", "Cleaver", "Machete"],
    mid:  ["Longsword", "Battleaxe", "Mace", "Spear", "Morningstar", "Scimitar", "Rapier", "Katana", "Falchion", "Broadsword"],
    high: ["Greatsword", "Warhammer", "Halberd", "Flail", "Glaive", "Claymore", "Maul", "Greataxe", "Poleaxe", "Zweihander"],
  },
  ranged: {
    low:  ["Sling", "Shortbow", "Dart", "Throwing Knife", "Hand Crossbow"],
    mid:  ["Longbow", "Crossbow", "Javelin", "Composite Bow", "Recurve Bow"],
    high: ["Arbalest", "Heavy Crossbow", "Greatbow", "Warbow", "Siege Bow"],
  },
  magic: {
    low:  ["Wand", "Branch", "Twig", "Charm", "Amulet"],
    mid:  ["Staff", "Rod", "Scepter", "Orb", "Focus"],
    high: ["Arcane Staff", "Grand Scepter", "Grimoire", "Tome", "Codex", "Relic", "Artifact", "Catalyst"],
  },
};

// ── Prefixes (Material / Origin) ─────────────────────────────────────

const PREFIXES: Record<WeaponTier, string[]> = {
  low: [
    "Rusty", "Worn", "Simple", "Plain", "Crude",
    "Basic", "Tarnished", "Chipped", "Dented", "Scratched",
    "Old", "Weathered", "Common", "Standard", "Regular",
    "Apprentice", "Novice", "Training", "Practice", "Makeshift",
    "Scavenged", "Salvaged", "Repaired", "Patched", "Humble",
  ],
  mid: [
    "Iron", "Steel", "Silver", "Bronze", "Copper",
    "Tempered", "Hardened", "Sharpened", "Polished", "Reinforced",
    "Sturdy", "Balanced", "Masterwork", "Crafted", "Forged",
    "Smithed", "Hammered", "Engraved", "Etched", "Inscribed",
    "Burnished", "Honed", "Refined", "Quality", "Superior",
  ],
  high: [
    "Ancient", "Runed", "Blessed", "Cursed", "Shadow",
    "Crystal", "Dragon", "Demon", "Holy", "Void",
    "Astral", "Frozen", "Scorched", "Ethereal", "Spectral",
    "Twilight", "Dawn", "Midnight", "Storm", "Bloodforged",
    "Soulbound", "Starforged", "Hellforged", "Moonlit", "Sundered",
    "Celestial", "Infernal", "Primordial", "Eldritch", "Mythic",
    "Legendary", "Fabled", "Divine", "Unholy", "Abyssal",
    "Radiant", "Arcane", "Mystic", "Enigmatic", "Transcendent",
    "Immortal", "Eternal", "Timeless", "Boundless", "Omnipotent",
  ],
};

// ── Suffixes (Quality / Style) ───────────────────────────────────────

const SUFFIXES: Record<WeaponTier, string[]> = {
  low: [
    "", "", "", "", "", // Most low-level items have no suffix
    "of Beginnings", "of First Steps", "of the Apprentice",
    "of Training", "of Learning", "of the Novice",
    "of Practice", "of the Recruit", "of the Initiate",
    "of Humble Origins", "of Simple Make", "of Common Folk",
    "of the Peasant", "of the Militia", "of the Guard",
    "of the Patrol", "of the Watch", "of the Sentry",
    "of the Scout", "of Basic Craft", "of Standard Issue",
    "of the Volunteer", "of the Draftee", "of the Conscript",
    "of Rustic Make",
  ],
  mid: [
    "of the Warrior", "of the Knight", "of the Soldier",
    "of the Champion", "of the Victor", "of the Duelist",
    "of the Gladiator", "of the Mercenary", "of the Veteran",
    "of the Captain", "of the Commander", "of the Elite",
    "of the Master", "of the Expert", "of the Adept",
    "of Honor", "of Valor", "of Courage",
    "of Strength", "of Power", "of Might",
    "of the Guild", "of the Order", "of the Brotherhood",
    "of the Chosen",
  ],
  high: [
    "of the Ancients", "of the Void", "of Eternity",
    "of the Damned", "of Glory", "of Ruin",
    "of the Phoenix", "of the Serpent", "of the Wolf",
    "of the Dragon", "of Kings", "of Legends",
    "of Shadows", "of Light", "of Chaos",
    "of Order", "of the Titans", "of the Gods",
    "of the Fallen", "of Apocalypse", "of Armageddon",
    "of the End Times", "of Infinity", "of the Cosmos",
    "of the Universe", "of Creation", "of Destruction",
    "of the Primordial", "of the Abyss", "of the Heavens",
    "of the Underworld", "of the Astral Planes", "of Dimensions Beyond",
    "of Reality's Edge", "of Time Itself", "of Forbidden Knowledge",
    "of Lost Empires", "of Vanquished Realms", "of Shattered Worlds",
    "of the Eternal War", "of the First Age", "of the Last Stand",
    "of Prophecy", "of Destiny", "of Fate", "of Doom", "of Salvation",
  ],
};

// ── Enchantment Name Pools (for display, maps to enchantment types) ──

export const ENCHANTMENT_DISPLAY_NAMES: Record<WeaponTier, Record<string, string[]>> = {
  low: {
    fire:       ["Minor Flame", "Spark", "Ember"],
    ice:        ["Minor Frost", "Chill", "Drizzle"],
    lightning:  ["Minor Shock", "Breeze", "Dust"],
    holy:       ["Minor Light", "Faint Glow", "Dim Radiance"],
    shadow:     ["Minor Poison", "Scratching", "Grazing"],
    sharpness:  ["Minor Sharpness", "Minor Impact", "Nicking"],
    durability: ["Minor Protection", "Thin Shield", "Faint Barrier"],
  },
  mid: {
    fire:       ["Flame", "Fire", "Heat", "Burn", "Blaze"],
    ice:        ["Frost", "Ice", "Cold", "Freeze"],
    lightning:  ["Lightning", "Thunder", "Electricity", "Jolt"],
    holy:       ["Mana", "Wisdom", "Channeling", "Resonance"],
    shadow:     ["Striking", "Bleeding", "Fury", "Wounding", "Rending"],
    sharpness:  ["Cleaving", "Piercing", "Crushing", "Sundering", "Slashing"],
    durability: ["Protection", "Shielding", "Fortitude", "Warding", "Aegis"],
  },
  high: {
    fire:       ["Inferno", "Magma", "Cosmic Fire", "Primordial Flame", "Cataclysm"],
    ice:        ["Blizzard", "Absolute Zero", "Eternal Frost"],
    lightning:  ["Tempest", "Endless Storm", "Eldritch Lightning", "Celestial Thunder"],
    holy:       ["Divine Radiance", "Sorcery", "Restoration", "Transcendence", "Ascension"],
    shadow:     ["Obliteration", "Execution", "Decimation", "Annihilation", "Vengeance"],
    sharpness:  ["Carnage", "Slaughter", "Devastation", "Retribution", "Wrath"],
    durability: ["Invulnerability", "Indestructibility", "Immortality", "Undying", "Phoenix Rebirth"],
  },
};

// ── RNG Helpers ──────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Map quality tier to the appropriate name tier.
 * Common / Uncommon → use the weapon's own tier.
 * Rare → bump up one tier (capped at high).
 * Epic → always high.
 */
function resolveNameTier(baseTier: WeaponTier, quality: QualityTier): WeaponTier {
  if (quality === "epic") return "high";
  if (quality === "rare") {
    if (baseTier === "low") return "mid";
    return "high";
  }
  return baseTier;
}

// ── Public API ───────────────────────────────────────────────────────

export interface GeneratedWeaponName {
  /** e.g. "Voidforged Claymore of Eternal Ruin" */
  displayName: string;
  /** The randomly chosen base weapon type, e.g. "Claymore" */
  baseWeaponType: string;
  /** The prefix rolled, e.g. "Voidforged" */
  prefix: string;
  /** The suffix rolled, e.g. "of Eternal Ruin" (empty string if none) */
  suffix: string;
}

/**
 * Generate a procedural weapon name for a crafted item.
 *
 * @param tokenId   - The catalog tokenId of the base item
 * @param quality   - The rolled quality tier (common/uncommon/rare/epic)
 * @returns A generated name, or null if the tokenId isn't a recognized weapon
 */
export function generateWeaponName(
  tokenId: number,
  quality: QualityTier,
): GeneratedWeaponName | null {
  const meta = getWeaponMeta(tokenId);
  if (!meta) return null;

  const { category, tier } = meta;

  // Pick a random base weapon name from the appropriate category + tier
  const baseWeaponType = pick(BASE_NAMES[category][tier]);

  // Prefix tier can be boosted by quality
  const prefixTier = resolveNameTier(tier, quality);
  const prefix = pick(PREFIXES[prefixTier]);

  // Suffix tier follows the same logic
  const suffixTier = resolveNameTier(tier, quality);
  const suffix = pick(SUFFIXES[suffixTier]);

  // Build final name
  const parts = [prefix, baseWeaponType];
  const displayName = parts.join(" ") + (suffix ? ` ${suffix}` : "");

  return {
    displayName,
    baseWeaponType,
    prefix,
    suffix,
  };
}

/**
 * Pick a thematic enchantment display name based on tier and type.
 * Falls back to the system enchantment name if no pool exists.
 */
export function getEnchantmentDisplayName(
  tokenId: number,
  enchantmentType: string,
): string | null {
  const meta = getWeaponMeta(tokenId);
  if (!meta) return null;

  const tierPool = ENCHANTMENT_DISPLAY_NAMES[meta.tier];
  const typePool = tierPool?.[enchantmentType];
  if (!typePool || typePool.length === 0) return null;

  return pick(typePool);
}
