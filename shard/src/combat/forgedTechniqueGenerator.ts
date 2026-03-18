/**
 * Forged Technique Generator — LLM-powered custom ability creation.
 *
 * Players visit a class trainer in L30-40 zones, describe the ability they
 * want, and an LLM forges a balanced technique based on their description.
 *
 * One custom technique per tier per player:
 *   - adept    (L30) — Moondancer Glade
 *   - master   (L35) — Felsrock Citadel
 *   - legendary (L40) — Lake Lumina
 */

import { createHash } from "crypto";
import { gemini, GEMINI_MODEL } from "../agents/geminiClient.js";
import { registerTechniqueFallbackLookup } from "./techniques.js";
import type {
  TechniqueDefinition,
  TechniqueType,
  TargetType,
  TechniqueEffect,
  AnimStyle,
} from "./techniques.js";

// ── Types ──────────────────────────────────────────────────────────────

export type ForgeTier = "adept" | "master" | "legendary";

export interface ForgedTechnique extends TechniqueDefinition {
  tier: ForgeTier;
  walletAddress: string;
  playerDescription: string;
  qualityTier: "rare" | "epic" | "legendary";
  displayColor: string;
}

// ── Balance Constraints per Tier ────────────────────────────────────────

interface TierConstraints {
  level: number;
  goldCost: number;
  maxDamageMultiplier: number;
  maxHealAmount: number;
  maxShield: number;
  maxStatBonus: number;
  maxStatReduction: number;
  maxDotDamage: number;
  maxAoETargets: number;
  maxAoERadius: number;
  maxKnockback: number;
  maxLunge: number;
  minCooldown: number;
  minEssenceCost: number;
  maxDuration: number;
  qualityTier: "rare" | "epic" | "legendary";
  displayColor: string;
}

const TIER_CONSTRAINTS: Record<ForgeTier, TierConstraints> = {
  adept: {
    level: 30,
    goldCost: 2500,
    maxDamageMultiplier: 4.5,
    maxHealAmount: 80,
    maxShield: 90,
    maxStatBonus: 80,
    maxStatReduction: 80,
    maxDotDamage: 30,
    maxAoETargets: 6,
    maxAoERadius: 12,
    maxKnockback: 20,
    maxLunge: 28,
    minCooldown: 15,
    minEssenceCost: 35,
    maxDuration: 15,
    qualityTier: "rare",
    displayColor: "#5dadec",
  },
  master: {
    level: 35,
    goldCost: 4000,
    maxDamageMultiplier: 6.0,
    maxHealAmount: 100,
    maxShield: 120,
    maxStatBonus: 100,
    maxStatReduction: 95,
    maxDotDamage: 45,
    maxAoETargets: 8,
    maxAoERadius: 15,
    maxKnockback: 22,
    maxLunge: 35,
    minCooldown: 20,
    minEssenceCost: 45,
    maxDuration: 20,
    qualityTier: "epic",
    displayColor: "#b48efa",
  },
  legendary: {
    level: 40,
    goldCost: 6000,
    maxDamageMultiplier: 8.5,
    maxHealAmount: 100,
    maxShield: 150,
    maxStatBonus: 100,
    maxStatReduction: 100,
    maxDotDamage: 55,
    maxAoETargets: 12,
    maxAoERadius: 20,
    maxKnockback: 28,
    maxLunge: 42,
    minCooldown: 25,
    minEssenceCost: 55,
    maxDuration: 20,
    qualityTier: "legendary",
    displayColor: "#ff8c00",
  },
};

// ── In-Memory Registry ──────────────────────────────────────────────────

const registry = new Map<string, ForgedTechnique>();
const walletTierIndex = new Map<string, ForgedTechnique>(); // "wallet:tier" → technique

function walletTierKey(wallet: string, tier: ForgeTier): string {
  return `${wallet.toLowerCase()}:${tier}`;
}

function generateTechniqueId(wallet: string, tier: ForgeTier): string {
  const hex8 = createHash("sha256")
    .update(`${wallet.toLowerCase()}:forged:${tier}`)
    .digest("hex")
    .slice(0, 10);
  return `forged_${tier}_${hex8}`;
}

// ── LLM Prompt Builder ──────────────────────────────────────────────────

const CLASS_FANTASIES: Record<string, string> = {
  warrior: "melee bruiser — gap closers, slams, shouts, cleaves, charges, shields",
  paladin: "holy warrior — divine smites, invulnerability, shields of light, holy judgment, wings",
  rogue: "shadow assassin — teleports, backstabs, poisons, smoke, blinding speed, executes",
  ranger: "precision marksman — piercing shots, arrow storms, traps, falcon strikes, nature magic",
  mage: "arcane devastator — fireballs, meteors, frost prisons, time warps, reality-bending AoE",
  cleric: "divine healer — massive heals, divine shields, holy novas, resurrection, wrath of heaven",
  warlock: "dark sorcerer — soul drains, curses, demonic portals, DoTs, life steal, void magic",
  monk: "martial artist — flying kicks, palm strikes, chi blasts, meditation, hundred-hit combos",
};

function buildPrompt(
  playerDescription: string,
  className: string,
  tier: ForgeTier,
  constraints: TierConstraints,
): string {
  const fantasy = CLASS_FANTASIES[className] ?? "versatile fighter";

  return `You are a game designer for an MMORPG. A ${className} player (${fantasy}) is forging a custom ability at the ${tier} tier (Level ${constraints.level}).

The player describes the ability they want:
"${playerDescription}"

Generate a technique that matches their vision as closely as possible while respecting balance constraints.

RULES:
- The technique MUST feel like what the player asked for. Capture their fantasy.
- Give it an EPIC name — dramatic, evocative, lore-worthy. Not generic.
- Write a HYPE description — short but makes the player feel powerful. Use vivid language.
- Pick the best type (attack/buff/debuff/healing) and target (self/enemy/ally/area) for the concept.
- The animStyle MUST match the delivery: "melee" for close-range physical, "projectile" for ranged, "area" for AoE effects, "channel" for sustained casts. Buffs/heals on self can omit animStyle.
- You can combine multiple effects (damage + DoT, damage + debuff, shield + buff, etc.)
- If the player asks for a gap closer, USE the lunge field (dash toward target).
- If the player asks for a stun or freeze, reduce agi and/or str by 90-100%.
- If the player asks for invulnerability, use shield (high %) + def stat bonus.
- If the player asks for knockback, use the knockback field.

BALANCE CONSTRAINTS (hard caps — do NOT exceed):
- damageMultiplier: max ${constraints.maxDamageMultiplier}
- healAmount: max ${constraints.maxHealAmount}% of max HP
- shield: max ${constraints.maxShield}% of max HP
- statBonus values: max ${constraints.maxStatBonus}%
- statReduction values: max ${constraints.maxStatReduction}%
- dotDamage: max ${constraints.maxDotDamage} per tick
- maxTargets (for AoE): max ${constraints.maxAoETargets}
- areaRadius: max ${constraints.maxAoERadius}
- knockback: max ${constraints.maxKnockback} units
- lunge: max ${constraints.maxLunge} units
- cooldown: minimum ${constraints.minCooldown} seconds
- essenceCost: minimum ${constraints.minEssenceCost}
- duration: max ${constraints.maxDuration} seconds

Respond with ONLY a JSON object, no markdown, no explanation:
{
  "name": "Epic Ability Name",
  "description": "Short hype description of what it does",
  "type": "attack|buff|debuff|healing",
  "targetType": "self|enemy|ally|area",
  "animStyle": "melee|projectile|area|channel",
  "essenceCost": <number>,
  "cooldown": <number>,
  "effects": {
    "damageMultiplier": <number or omit>,
    "healAmount": <number or omit>,
    "shield": <number or omit>,
    "statBonus": { "<stat>": <number> } or omit,
    "statReduction": { "<stat>": <number> } or omit,
    "dotDamage": <number or omit>,
    "duration": <number or omit>,
    "areaRadius": <number or omit>,
    "maxTargets": <number or omit>,
    "knockback": <number or omit>,
    "lunge": <number or omit>
  }
}`;
}

// ── Effect Clamping (safety net) ────────────────────────────────────────

function clampEffects(effects: TechniqueEffect, c: TierConstraints): TechniqueEffect {
  const clamped: TechniqueEffect = {};

  if (effects.damageMultiplier != null) {
    clamped.damageMultiplier = Math.min(Math.max(effects.damageMultiplier, 0.5), c.maxDamageMultiplier);
    clamped.damageMultiplier = parseFloat(clamped.damageMultiplier.toFixed(2));
  }
  if (effects.healAmount != null) {
    clamped.healAmount = Math.min(Math.max(Math.round(effects.healAmount), 5), c.maxHealAmount);
  }
  if (effects.shield != null) {
    clamped.shield = Math.min(Math.max(Math.round(effects.shield), 5), c.maxShield);
  }
  if (effects.dotDamage != null) {
    clamped.dotDamage = Math.min(Math.max(Math.round(effects.dotDamage), 1), c.maxDotDamage);
  }
  if (effects.duration != null) {
    clamped.duration = Math.min(Math.max(Math.round(effects.duration), 3), c.maxDuration);
  }
  if (effects.areaRadius != null) {
    clamped.areaRadius = Math.min(Math.max(Math.round(effects.areaRadius), 3), c.maxAoERadius);
  }
  if (effects.maxTargets != null) {
    clamped.maxTargets = Math.min(Math.max(Math.round(effects.maxTargets), 2), c.maxAoETargets);
  }
  if (effects.knockback != null) {
    clamped.knockback = Math.min(Math.max(Math.round(effects.knockback), 0), c.maxKnockback);
  }
  if (effects.lunge != null) {
    clamped.lunge = Math.min(Math.max(Math.round(effects.lunge), 0), c.maxLunge);
  }

  if (effects.statBonus && typeof effects.statBonus === "object") {
    const validStats = ["str", "def", "agi", "int", "luck", "hp"];
    const bonus: Record<string, number> = {};
    for (const [stat, val] of Object.entries(effects.statBonus)) {
      if (validStats.includes(stat) && typeof val === "number") {
        bonus[stat] = Math.min(Math.max(Math.round(val), 5), c.maxStatBonus);
      }
    }
    if (Object.keys(bonus).length > 0) clamped.statBonus = bonus;
  }

  if (effects.statReduction && typeof effects.statReduction === "object") {
    const validStats = ["str", "def", "agi", "int", "luck"];
    const reduction: Record<string, number> = {};
    for (const [stat, val] of Object.entries(effects.statReduction)) {
      if (validStats.includes(stat) && typeof val === "number") {
        reduction[stat] = Math.min(Math.max(Math.round(val), 5), c.maxStatReduction);
      }
    }
    if (Object.keys(reduction).length > 0) clamped.statReduction = reduction;
  }

  return clamped;
}

// ── Validation ──────────────────────────────────────────────────────────

const VALID_TYPES: TechniqueType[] = ["attack", "buff", "debuff", "healing"];
const VALID_TARGETS: TargetType[] = ["self", "enemy", "ally", "area"];
const VALID_ANIM: AnimStyle[] = ["melee", "projectile", "area", "channel"];

function validateAndClamp(
  raw: any,
  className: string,
  tier: ForgeTier,
  wallet: string,
  description: string,
): ForgedTechnique | null {
  if (!raw || typeof raw !== "object") return null;

  const constraints = TIER_CONSTRAINTS[tier];
  const id = generateTechniqueId(wallet, tier);

  // Validate basic fields
  const name = typeof raw.name === "string" ? raw.name.slice(0, 60) : `Forged ${tier} Technique`;
  const desc = typeof raw.description === "string" ? raw.description.slice(0, 200) : `A custom ${tier} technique`;

  const type: TechniqueType = VALID_TYPES.includes(raw.type) ? raw.type : "attack";
  const targetType: TargetType = VALID_TARGETS.includes(raw.targetType) ? raw.targetType : "enemy";
  const animStyle: AnimStyle | undefined = VALID_ANIM.includes(raw.animStyle) ? raw.animStyle : undefined;

  // Clamp numeric values
  const essenceCost = Math.max(
    Math.round(typeof raw.essenceCost === "number" ? raw.essenceCost : constraints.minEssenceCost + 10),
    constraints.minEssenceCost,
  );
  const cooldown = Math.max(
    typeof raw.cooldown === "number" ? raw.cooldown : constraints.minCooldown + 5,
    constraints.minCooldown,
  );

  // Clamp effects
  const effects = clampEffects(raw.effects ?? {}, constraints);

  // Ensure at least one meaningful effect
  const hasEffect =
    effects.damageMultiplier != null ||
    effects.healAmount != null ||
    effects.shield != null ||
    effects.dotDamage != null ||
    effects.statBonus != null ||
    effects.statReduction != null;

  if (!hasEffect) {
    // Fallback: give a basic attack
    if (type === "attack") effects.damageMultiplier = constraints.maxDamageMultiplier * 0.6;
    else if (type === "healing") effects.healAmount = 40;
    else if (type === "buff") { effects.statBonus = { str: 40 }; effects.duration = 10; }
    else if (type === "debuff") { effects.statReduction = { agi: 40 }; effects.duration = 10; }
  }

  return {
    id,
    name,
    description: desc,
    className,
    levelRequired: constraints.level,
    copperCost: 0, // Gold charged separately
    essenceCost,
    cooldown,
    type,
    targetType,
    effects,
    animStyle,
    tier,
    walletAddress: wallet.toLowerCase(),
    playerDescription: description,
    qualityTier: constraints.qualityTier,
    displayColor: constraints.displayColor,
  };
}

// ── LLM Call ────────────────────────────────────────────────────────────

async function callLLM(prompt: string): Promise<any> {
  const result = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      temperature: 0.9,
      maxOutputTokens: 800,
    },
  });

  const text = result.text?.trim() ?? "";

  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  return JSON.parse(cleaned);
}

// ── Public API ──────────────────────────────────────────────────────────

export function getForgedTechniqueForWalletTier(
  wallet: string,
  tier: ForgeTier,
): ForgedTechnique | undefined {
  return walletTierIndex.get(walletTierKey(wallet, tier));
}

export function getWalletForgedTechniques(wallet: string): ForgedTechnique[] {
  const results: ForgedTechnique[] = [];
  for (const tier of ["adept", "master", "legendary"] as ForgeTier[]) {
    const tech = walletTierIndex.get(walletTierKey(wallet, tier));
    if (tech) results.push(tech);
  }
  return results;
}

export function getTierForLevel(level: number): ForgeTier | null {
  if (level >= 40) return "legendary";
  if (level >= 35) return "master";
  if (level >= 30) return "adept";
  return null;
}

export function getTierConstraints(tier: ForgeTier): TierConstraints {
  return TIER_CONSTRAINTS[tier];
}

/**
 * Forge a custom technique using the LLM.
 * Returns the generated technique or throws on failure.
 */
export async function forgeCustomTechnique(
  wallet: string,
  className: string,
  tier: ForgeTier,
  playerDescription: string,
): Promise<ForgedTechnique> {
  // Check if already forged for this tier
  const existing = walletTierIndex.get(walletTierKey(wallet, tier));
  if (existing) {
    throw new Error(`You have already forged a ${tier} technique: "${existing.name}". One per tier.`);
  }

  const constraints = TIER_CONSTRAINTS[tier];
  const prompt = buildPrompt(playerDescription, className, tier, constraints);

  let raw: any;
  try {
    raw = await callLLM(prompt);
  } catch (err: any) {
    console.error(`[forgedTechnique] LLM call failed:`, err.message);
    throw new Error("The forge's magic falters... try again in a moment.");
  }

  const technique = validateAndClamp(raw, className, tier, wallet, playerDescription);
  if (!technique) {
    throw new Error("The forge could not shape your vision. Try describing it differently.");
  }

  // Store in registry
  registry.set(technique.id, technique);
  walletTierIndex.set(walletTierKey(wallet, tier), technique);

  return technique;
}

/**
 * Restore a forged technique (e.g. from Redis on server restart).
 */
export function restoreForgedTechnique(technique: ForgedTechnique): void {
  registry.set(technique.id, technique);
  walletTierIndex.set(walletTierKey(technique.walletAddress, technique.tier), technique);
}

// ── Register fallback lookup so combat engine can find forged techniques ─
registerTechniqueFallbackLookup((id) => registry.get(id));
