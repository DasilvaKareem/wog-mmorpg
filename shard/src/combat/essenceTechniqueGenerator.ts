/**
 * Essence Technique Generator — procedural unique techniques for players.
 *
 * Each player gets a deterministic, one-of-a-kind technique at Level 15
 * (Signature) and Level 40 (Ultimate), seeded from wallet + class + tier.
 * The same inputs always produce the same technique (no randomness drift).
 */

import { createHash } from "crypto";
import type { TechniqueDefinition, TechniqueType, TargetType, TechniqueEffect } from "./techniques.js";
import { registerTechniqueFallbackLookup } from "./techniques.js";

// ── Types ──────────────────────────────────────────────────────────────

export type EssenceTier = "signature" | "ultimate";

export interface EssenceTechnique extends TechniqueDefinition {
  tier: EssenceTier;
  walletAddress: string;
  seed: string;
  qualityTier: "rare" | "epic";
  displayColor: string;
}

// ── Seeded PRNG (mulberry32) ───────────────────────────────────────────

function seedToUint32(seed: string): number {
  const hash = createHash("sha256").update(seed).digest();
  return hash.readUInt32BE(0);
}

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns a float in [min, max) */
function rngRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Returns an integer in [min, max] inclusive */
function rngInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rngRange(rng, min, max + 1));
}

/** Pick one item from array using RNG */
function rngPick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Weighted pick: returns the key whose cumulative weight the roll falls into */
function rngWeightedPick<K extends string>(
  rng: () => number,
  weights: Record<K, number>,
): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

// ── Power Budget Config ────────────────────────────────────────────────

interface TierConfig {
  level: number;
  budget: number;
  damageMin: number;
  damageMax: number;
  essenceCostMin: number;
  essenceCostMax: number;
  cooldownMin: number;
  cooldownMax: number;
  qualityTier: "rare" | "epic";
  displayColor: string;
}

const TIER_CONFIG: Record<EssenceTier, TierConfig> = {
  signature: {
    level: 15,
    budget: 100,
    damageMin: 1.2,
    damageMax: 2.0,
    essenceCostMin: 40,
    essenceCostMax: 65,
    cooldownMin: 15,
    cooldownMax: 45,
    qualityTier: "rare",
    displayColor: "#5dadec",
  },
  ultimate: {
    level: 30,
    budget: 180,
    damageMin: 1.8,
    damageMax: 3.0,
    essenceCostMin: 70,
    essenceCostMax: 100,
    cooldownMin: 45,
    cooldownMax: 90,
    qualityTier: "epic",
    displayColor: "#b48efa",
  },
};

// ── Class Archetype Weights ────────────────────────────────────────────

type TypeWeights = Record<TechniqueType, number>;

const CLASS_ARCHETYPES: Record<string, TypeWeights> = {
  warrior: { attack: 50, buff: 30, debuff: 10, healing: 10 },
  monk:    { attack: 50, buff: 30, debuff: 10, healing: 10 },
  rogue:   { attack: 60, buff: 20, debuff: 10, healing: 10 },
  mage:    { attack: 55, buff: 10, debuff: 25, healing: 10 },
  warlock: { attack: 55, buff: 10, debuff: 25, healing: 10 },
  cleric:  { attack: 10, buff: 30, debuff: 10, healing: 50 },
  paladin: { attack: 25, buff: 35, debuff: 5, healing: 35 },
  ranger:  { attack: 45, buff: 15, debuff: 20, healing: 20 },
};

const DEFAULT_WEIGHTS: TypeWeights = { attack: 40, buff: 20, debuff: 20, healing: 20 };

// ── Target type per technique type ─────────────────────────────────────

function pickTargetType(rng: () => number, type: TechniqueType): TargetType {
  switch (type) {
    case "attack":
      return rng() < 0.2 ? "area" : "enemy";
    case "debuff":
      return rng() < 0.15 ? "area" : "enemy";
    case "buff":
      return "self";
    case "healing":
      return rng() < 0.3 ? "ally" : "self";
  }
}

// ── Secondary combo effects ────────────────────────────────────────────

type ComboType = "dot" | "shield" | "heal" | "statBuff" | "statDebuff";

const COMBO_BY_TYPE: Record<TechniqueType, readonly ComboType[]> = {
  attack:  ["dot", "heal", "statDebuff"],
  buff:    ["shield", "heal"],
  debuff:  ["dot", "statDebuff"],
  healing: ["shield", "statBuff"],
};

// ── Effect Generation ──────────────────────────────────────────────────

function generateEffects(
  rng: () => number,
  type: TechniqueType,
  targetType: TargetType,
  config: TierConfig,
): TechniqueEffect {
  const effects: TechniqueEffect = {};
  const primaryBudgetShare = rngRange(rng, 0.5, 0.7);

  switch (type) {
    case "attack": {
      effects.damageMultiplier = parseFloat(
        rngRange(rng, config.damageMin, config.damageMax).toFixed(2),
      );
      if (targetType === "area") {
        effects.maxTargets = rngInt(rng, 2, 4);
        effects.areaRadius = rngInt(rng, 5, 10);
        // AoE trades damage for targets
        effects.damageMultiplier = parseFloat(
          (effects.damageMultiplier * 0.75).toFixed(2),
        );
      }
      break;
    }
    case "buff": {
      const stat = rngPick(rng, ["str", "def", "agi", "int", "luck"] as const);
      const bonus = rngInt(rng, 20, 60);
      effects.statBonus = { [stat]: bonus };
      effects.duration = rngInt(rng, 8, 20);
      break;
    }
    case "debuff": {
      const stat = rngPick(rng, ["str", "def", "agi", "int"] as const);
      const reduction = rngInt(rng, 20, 50);
      effects.statReduction = { [stat]: reduction };
      effects.duration = rngInt(rng, 8, 15);
      break;
    }
    case "healing": {
      effects.healAmount = rngInt(rng, 25, 60);
      if (rng() < 0.4) {
        // HoT variant
        effects.duration = rngInt(rng, 6, 14);
      }
      break;
    }
  }

  // 40% chance of secondary combo effect
  if (rng() < 0.4) {
    const combos = COMBO_BY_TYPE[type];
    const combo = rngPick(rng, combos);
    const secondaryBudget = 1 - primaryBudgetShare;

    switch (combo) {
      case "dot":
        effects.dotDamage = rngInt(rng, 8, 25);
        effects.duration = effects.duration ?? rngInt(rng, 8, 14);
        break;
      case "shield":
        effects.shield = rngInt(rng, 15, 40);
        effects.duration = effects.duration ?? rngInt(rng, 8, 15);
        break;
      case "heal":
        if (type === "attack") {
          // Lifesteal percentage
          effects.healAmount = rngInt(rng, 20, 50);
        }
        break;
      case "statBuff":
        if (!effects.statBonus) {
          const stat = rngPick(rng, ["str", "def", "agi"] as const);
          effects.statBonus = { [stat]: rngInt(rng, 10, 30) };
          effects.duration = effects.duration ?? rngInt(rng, 8, 12);
        }
        break;
      case "statDebuff":
        if (!effects.statReduction) {
          const stat = rngPick(rng, ["str", "def", "agi"] as const);
          effects.statReduction = { [stat]: rngInt(rng, 10, 30) };
          effects.duration = effects.duration ?? rngInt(rng, 6, 10);
        }
        break;
    }
  }

  return effects;
}

// ── Name Generator ─────────────────────────────────────────────────────

type LoreCategory = "warrior" | "marksman" | "sorcerer" | "support";

const CLASS_TO_LORE: Record<string, LoreCategory> = {
  warrior: "warrior",
  paladin: "warrior",
  monk: "warrior",
  rogue: "warrior",
  ranger: "marksman",
  mage: "sorcerer",
  warlock: "sorcerer",
  cleric: "support",
};

const PREFIXES: Record<LoreCategory, Record<TechniqueType, readonly string[]>> = {
  warrior: {
    attack:  ["Thundering", "Raging", "Savage", "Crushing", "Iron", "Brutal", "Devastating", "Mighty"],
    buff:    ["Stalwart", "Unyielding", "Ironclad", "Valiant", "Fortified", "Resolute"],
    debuff:  ["Sundering", "Crippling", "Shattering", "Rending", "Overwhelming"],
    healing: ["Battle-Hardened", "Resilient", "Enduring", "Steadfast"],
  },
  marksman: {
    attack:  ["Piercing", "Precise", "Swift", "Lethal", "Hawkeye", "Deadly", "Venomous"],
    buff:    ["Keen", "Windborne", "Primal", "Wild", "Focused"],
    debuff:  ["Crippling", "Venomous", "Ensnaring", "Blinding", "Disorienting"],
    healing: ["Nature's", "Verdant", "Restorative", "Soothing"],
  },
  sorcerer: {
    attack:  ["Arcane", "Eldritch", "Void", "Abyssal", "Infernal", "Celestial", "Chaotic"],
    buff:    ["Mystic", "Ethereal", "Astral", "Runic", "Enchanted"],
    debuff:  ["Cursed", "Withering", "Soul-Rending", "Entropic", "Blighting"],
    healing: ["Luminous", "Ethereal", "Radiant", "Transcendent"],
  },
  support: {
    attack:  ["Holy", "Divine", "Sacred", "Blessed", "Righteous", "Purifying"],
    buff:    ["Blessed", "Sacred", "Divine", "Hallowed", "Anointed"],
    debuff:  ["Sanctified", "Purging", "Smiting", "Condemning"],
    healing: ["Blessed", "Sacred", "Divine", "Hallowed", "Merciful", "Radiant"],
  },
};

const CORES: Record<TechniqueType, readonly string[]> = {
  attack:  ["Onslaught", "Barrage", "Assault", "Cataclysm", "Execution", "Rampage", "Eruption", "Annihilation", "Tempest", "Fury"],
  buff:    ["Aegis", "Bastion", "Fortitude", "Empowerment", "Ascendance", "Invocation", "Warding", "Mantle"],
  debuff:  ["Bane", "Affliction", "Malediction", "Corruption", "Hex", "Curse", "Torment", "Entropy"],
  healing: ["Restoration", "Renewal", "Mending", "Salvation", "Absolution", "Rejuvenation", "Sanctuary"],
};

const SUFFIXES_SIGNATURE: readonly string[] = [
  "of the Chosen", "of the Vanguard", "of Resolve", "of the Phoenix",
  "of the Storm", "of the Bloodline", "of the Iron Will", "of Arcadia",
];

const SUFFIXES_ULTIMATE: readonly string[] = [
  "of Transcendence", "of the Eternal Flame", "of Oblivion", "of the Cosmos",
  "of Ascension", "of the Ancients", "of the Abyss", "of Genesis",
  "of the Eclipse", "of the World Tree",
];

function generateName(
  rng: () => number,
  classId: string,
  type: TechniqueType,
  tier: EssenceTier,
): string {
  const lore = CLASS_TO_LORE[classId] ?? "warrior";
  const prefixPool = PREFIXES[lore][type];
  const corePool = CORES[type];
  const suffixPool = tier === "signature" ? SUFFIXES_SIGNATURE : SUFFIXES_ULTIMATE;

  const prefix = rngPick(rng, prefixPool);
  const core = rngPick(rng, corePool);
  const suffix = rngPick(rng, suffixPool);

  return `${prefix} ${core} ${suffix}`;
}

// ── Description Generator ──────────────────────────────────────────────

function generateDescription(
  type: TechniqueType,
  effects: TechniqueEffect,
  tier: EssenceTier,
): string {
  const tierLabel = tier === "signature" ? "Signature" : "Ultimate";
  const parts: string[] = [];

  if (type === "attack" && effects.damageMultiplier) {
    const pct = Math.round(effects.damageMultiplier * 100);
    if (effects.maxTargets && effects.maxTargets > 1) {
      parts.push(`${tierLabel} AoE attack dealing ${pct}% damage to up to ${effects.maxTargets} targets`);
    } else {
      parts.push(`${tierLabel} attack dealing ${pct}% weapon damage`);
    }
    if (effects.healAmount) {
      parts.push(`healing for ${effects.healAmount}% of damage dealt`);
    }
    if (effects.dotDamage) {
      parts.push(`applying ${effects.dotDamage} damage per tick`);
    }
  } else if (type === "buff") {
    if (effects.statBonus) {
      const entries = Object.entries(effects.statBonus);
      const bonusStr = entries.map(([s, v]) => `+${v}% ${s.toUpperCase()}`).join(", ");
      parts.push(`${tierLabel} buff granting ${bonusStr} for ${effects.duration ?? 0}s`);
    }
    if (effects.shield) {
      parts.push(`absorbing ${effects.shield}% max HP as a shield`);
    }
  } else if (type === "debuff") {
    if (effects.statReduction) {
      const entries = Object.entries(effects.statReduction);
      const debuffStr = entries.map(([s, v]) => `-${v}% ${s.toUpperCase()}`).join(", ");
      parts.push(`${tierLabel} debuff inflicting ${debuffStr} for ${effects.duration ?? 0}s`);
    }
    if (effects.dotDamage) {
      parts.push(`dealing ${effects.dotDamage} damage per tick`);
    }
  } else if (type === "healing") {
    if (effects.duration) {
      parts.push(`${tierLabel} heal restoring ${effects.healAmount}% max HP over ${effects.duration}s`);
    } else {
      parts.push(`${tierLabel} heal restoring ${effects.healAmount}% max HP instantly`);
    }
    if (effects.shield) {
      parts.push(`granting ${effects.shield}% max HP shield`);
    }
  }

  return parts.join(", ") || `${tierLabel} essence technique`;
}

// ── ID Generation ──────────────────────────────────────────────────────

function techniqueId(wallet: string, classId: string, tier: EssenceTier): string {
  const hex8 = createHash("sha256")
    .update(wallet.toLowerCase())
    .digest("hex")
    .slice(0, 8);
  return `essence_${tier}_${hex8}_${classId}`;
}

// ── In-Memory Registry ─────────────────────────────────────────────────

const registry = new Map<string, EssenceTechnique>();
const walletIndex = new Map<string, string[]>(); // wallet → technique IDs

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Generate an essence technique deterministically from wallet + class + tier.
 * Same inputs always produce the same technique.
 */
export function generateEssenceTechnique(
  wallet: string,
  classId: string,
  tier: EssenceTier,
): EssenceTechnique {
  const id = techniqueId(wallet, classId, tier);

  // Return cached if already generated
  const existing = registry.get(id);
  if (existing) return existing;

  const config = TIER_CONFIG[tier];
  const seedStr = `${wallet.toLowerCase()}:${classId}:${tier}`;
  const rng = mulberry32(seedToUint32(seedStr));

  // Pick technique type based on class archetype weights
  const weights = CLASS_ARCHETYPES[classId] ?? DEFAULT_WEIGHTS;
  const type = rngWeightedPick(rng, weights);
  const targetType = pickTargetType(rng, type);

  // Generate effects
  const effects = generateEffects(rng, type, targetType, config);

  // Generate name
  const name = generateName(rng, classId, type, tier);

  // Generate numeric values
  const essenceCost = rngInt(rng, config.essenceCostMin, config.essenceCostMax);
  const cooldown = rngInt(rng, config.cooldownMin, config.cooldownMax);

  const technique: EssenceTechnique = {
    id,
    name,
    description: generateDescription(type, effects, tier),
    className: classId,
    levelRequired: config.level,
    copperCost: 0, // Essence techniques are forged, not bought
    essenceCost,
    cooldown,
    type,
    targetType,
    effects,
    tier,
    walletAddress: wallet.toLowerCase(),
    seed: seedStr,
    qualityTier: config.qualityTier,
    displayColor: config.displayColor,
  };

  // Cache it
  registry.set(id, technique);
  const walletKey = wallet.toLowerCase();
  const existing_ids = walletIndex.get(walletKey) ?? [];
  if (!existing_ids.includes(id)) {
    existing_ids.push(id);
    walletIndex.set(walletKey, existing_ids);
  }

  return technique;
}

/**
 * Look up a generated essence technique by ID.
 * Returns undefined if not yet generated.
 */
export function getEssenceTechniqueById(id: string): EssenceTechnique | undefined {
  return registry.get(id);
}

/**
 * Get all generated essence techniques for a wallet address.
 */
export function getWalletEssenceTechniques(wallet: string): EssenceTechnique[] {
  const ids = walletIndex.get(wallet.toLowerCase()) ?? [];
  return ids
    .map((id) => registry.get(id))
    .filter((t): t is EssenceTechnique => t != null);
}

/**
 * Idempotent: generate + cache an essence technique if not already generated.
 */
export function ensureEssenceTechniqueInitialized(
  wallet: string,
  classId: string,
  tier: EssenceTier,
): EssenceTechnique {
  return generateEssenceTechnique(wallet, classId, tier);
}

/**
 * Get the deterministic technique ID for a wallet/class/tier combo.
 * Useful for checking if a technique exists without generating it.
 */
export function getEssenceTechniqueId(
  wallet: string,
  classId: string,
  tier: EssenceTier,
): string {
  return techniqueId(wallet, classId, tier);
}

// ── Self-register as fallback lookup for the combat system ─────────────
registerTechniqueFallbackLookup((id) => registry.get(id));
