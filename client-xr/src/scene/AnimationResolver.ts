import * as THREE from "three";
import { AnimationLibrary } from "./AnimationLibrary.js";
import type { Entity } from "../types.js";

/**
 * Scoped animation trace logging.
 *
 * Default OFF. Enable for ONE entity at a time — either your own character
 * or a specific entity name — so you see every step of THAT entity's
 * animation pipeline without drowning in zone-wide spam.
 *
 *   Enable:  ?animdebug=self                 — traces your own character
 *            ?animdebug=<name>               — traces a specific entity
 *            window.WOG_ANIM_DEBUG = "self"  — from console, same shape
 *
 * Locomotion transitions (idle/walk/run) are never logged — they fire every
 * frame across every entity and drown everything out.
 */

type AnimDebugScope = null | "self" | "all" | { needle: string };

function readDebugScope(): AnimDebugScope {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("animdebug");
    const override = (window as any).WOG_ANIM_DEBUG;
    const raw = typeof override === "string" ? override : q;

    // Explicit: ?animdebug=self | ?animdebug=all | ?animdebug=<name>
    if (raw === "self" || raw === "1" || raw === "true") return "self";
    if (raw === "all" || raw === "*") return "all";
    if (raw === "off" || raw === "0" || raw === "false") return null;
    if (raw) return { needle: raw.toLowerCase() };

    // Default: on localhost, trace self automatically so dev never needs the flag
    const host = window.location.hostname;
    if (/^(localhost|127\.|0\.0\.0\.0|192\.168\.)/.test(host)) return "self";
  } catch { /* ignore */ }
  return null;
}

const DEBUG_SCOPE = readDebugScope();
let selfEntityName: string | null = null;

/** Strip " the <Class>" suffix + lowercase for forgiving name matching. */
function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase().replace(/\s+the\s+\w+$/i, "");
}

/** Called by main.ts once the player's own character is known. */
export function setAnimDebugSelfName(name: string | null): void {
  selfEntityName = normalizeName(name);
  if (DEBUG_SCOPE && selfEntityName) {
    console.log(`[Anim] debug scope = ${typeof DEBUG_SCOPE === "object" ? `needle(${DEBUG_SCOPE.needle})` : DEBUG_SCOPE}, self="${selfEntityName}"`);
  }
}

/** Is debug logging enabled for this entity? */
export function isAnimDebugFor(entityName: string | null | undefined): boolean {
  if (!DEBUG_SCOPE) return false;
  if (DEBUG_SCOPE === "all") return true;
  const name = normalizeName(entityName);
  if (!name) return false;
  if (DEBUG_SCOPE === "self") {
    if (!selfEntityName) return false;
    return name === selfEntityName || name.startsWith(selfEntityName) || selfEntityName.startsWith(name);
  }
  return name.includes(DEBUG_SCOPE.needle);
}

/** Log only when scope covers this entity. */
export function animLogFor(entityName: string | null | undefined, ...args: unknown[]): void {
  if (isAnimDebugFor(entityName)) console.log("[Anim]", entityName, ...args);
}

/** Unconditional warning (bugs, binding failures, missing clips). */
export function animWarn(...args: unknown[]): void {
  console.warn("[Anim]", ...args);
}

/** Fires when debug is enabled at all (setup/load lines, not per-frame). */
export function animLogOnce(...args: unknown[]): void {
  if (DEBUG_SCOPE) console.log("[Anim]", ...args);
}

// Announce scope at module load so the user always knows whether logs are on.
if (typeof window !== "undefined") {
  const scopeLabel = DEBUG_SCOPE === null ? "OFF"
    : DEBUG_SCOPE === "self" ? "self (waiting for character)"
    : DEBUG_SCOPE === "all" ? "ALL entities"
    : `needle(${(DEBUG_SCOPE as { needle: string }).needle})`;
  console.log(`[Anim] module loaded — debug scope = ${scopeLabel}`);
}

/**
 * Animation resolution pipeline.
 *
 * Three concerns, cleanly separated:
 *
 *   1. ACTION   — what the entity is doing (intent). Same value regardless of rig.
 *   2. LOOKUP   — for a given Action + rig, which clip plays?
 *   3. FALLBACK — if the rig is missing the preferred clip, what do we substitute?
 *
 * Everything about animations lives here. EntityManager consumes `resolveAction`
 * for intent, `buildGlbActionMap` at load time, and `getClipForAction` at play
 * time. No more scattered `TECHNIQUE_ANIM`, `attackAnimForClass`,
 * `resolveCombatAnim`, `findClipByName`, `GLB_CLIP_FALLBACKS`, etc.
 */

// ── Action — semantic intent ──────────────────────────────────────────────────

export type Action =
  // locomotion
  | "idle" | "walk" | "run"
  // combat — basic auto attacks, distinguished by delivery
  | "attack-melee" | "attack-ranged" | "attack-cast"
  // combat — techniques/abilities. Not every technique needs its own bucket —
  // most reuse a basic-attack bucket. These exist only when the animation
  // should look meaningfully different (e.g. AOE stance, taunt, shield brace).
  | "technique-cleave" | "technique-shield" | "technique-rally" | "technique-shout"
  | "technique-palm" | "technique-flying-kick" | "technique-spin"
  // spellcasting variants — used by techniques or caster basic attacks
  | "cast-arcane" | "cast-holy" | "cast-dark"
  // reactions
  | "damage" | "heal" | "death" | "defeat" | "levelup"
  // gathering / crafting
  | "gather" | "mine" | "forage" | "skin"
  | "craft" | "brew" | "cook" | "enchant" | "carve"
  // misc
  | "roll" | "jump" | "pickup" | "sit" | "standup";

// ── Class → basic-attack action ───────────────────────────────────────────────

const CLASS_BASIC_ATTACK: Record<string, Action> = {
  warrior: "attack-melee",
  paladin: "attack-melee",
  rogue:   "attack-melee",
  monk:    "attack-melee",
  ranger:  "attack-ranged",
  mage:    "cast-arcane",
  warlock: "cast-dark",
  cleric:  "cast-holy",
};

// ── Technique → action ────────────────────────────────────────────────────────
// Only list techniques that differ from the class's basic attack. Everything
// not in this map falls back to the caller's base action (usually basic attack).

const TECHNIQUE_ACTION: Record<string, Action> = {
  // Warrior
  warrior_heroic_strike: "attack-melee",
  warrior_rending_strike: "attack-melee",
  warrior_cleave: "technique-cleave",
  warrior_shield_wall: "technique-shield",
  warrior_battle_rage: "technique-shout",
  warrior_intimidating_shout: "technique-shout",
  warrior_rallying_cry: "technique-rally",
  // Paladin
  paladin_holy_smite: "attack-melee",
  paladin_consecration: "cast-holy",
  paladin_judgment: "cast-holy",
  paladin_lay_on_hands: "cast-holy",
  paladin_divine_shield: "technique-shield",
  paladin_blessing_of_might: "cast-holy",
  paladin_aura_of_resolve: "cast-holy",
  // Rogue
  rogue_backstab: "attack-melee",
  rogue_poison_blade: "attack-melee",
  rogue_shadow_strike: "attack-melee",
  rogue_smoke_bomb: "attack-melee",
  rogue_blade_flurry: "technique-cleave",
  rogue_stealth: "idle",
  rogue_evasion: "idle",
  // Ranger
  ranger_aimed_shot: "attack-ranged",
  ranger_hunters_mark: "attack-ranged",
  ranger_quick_shot: "attack-ranged",
  ranger_multi_shot: "attack-ranged",
  ranger_volley: "attack-ranged",
  ranger_entangling_roots: "cast-arcane",
  ranger_natures_blessing: "cast-holy",
  // Mage
  mage_fireball: "cast-arcane",
  mage_arcane_missiles: "cast-arcane",
  mage_slow: "cast-arcane",
  mage_flamestrike: "cast-arcane",
  mage_frost_nova: "cast-arcane",
  mage_frost_armor: "cast-arcane",
  mage_mana_shield: "cast-arcane",
  // Cleric
  cleric_holy_light: "cast-holy",
  cleric_smite: "cast-holy",
  cleric_renew: "cast-holy",
  cleric_holy_nova: "cast-holy",
  cleric_divine_protection: "cast-holy",
  cleric_prayer_of_fortitude: "cast-holy",
  cleric_spirit_of_redemption: "cast-holy",
  // Warlock
  warlock_shadow_bolt: "cast-dark",
  warlock_curse_of_weakness: "cast-dark",
  warlock_drain_life: "cast-dark",
  warlock_corruption: "cast-dark",
  warlock_howl_of_terror: "cast-dark",
  warlock_soul_shield: "cast-dark",
  warlock_siphon_soul: "cast-dark",
  // Monk
  monk_palm_strike: "technique-palm",
  monk_disable: "technique-palm",
  monk_chi_burst: "cast-arcane",
  monk_flying_kick: "technique-flying-kick",
  monk_whirlwind_kick: "technique-spin",
  monk_meditation: "cast-holy",
  monk_inner_focus: "cast-holy",
};

function stripRank(techniqueId: string): string {
  return techniqueId.replace(/_r[234]$/, "");
}

// ── GLB clip name resolution ─────────────────────────────────────────────────
// Ordered list of candidate clip names (or substrings) per action. The resolver
// walks this list and returns the first match found in the GLB's clip map.
// Substrings let us match e.g. "Spellcasting", "2H_Spell_Attack", "Cast_Shoot"
// without knowing every Quaternius variation.

interface ClipCandidate {
  exact?: string;            // exact clip name (preferred)
  substring?: string;        // case-insensitive substring match
}

const GLB_CANDIDATES: Record<Action, ClipCandidate[]> = {
  idle:              [{ exact: "Idle" }, { substring: "idle" }],
  walk:              [{ exact: "Walk" }, { substring: "walk" }],
  run:               [{ exact: "Run" },  { substring: "run" }],

  "attack-melee":    [
    { exact: "SwordSlash" }, { exact: "Sword_Attack" }, { exact: "Sword_Attack2" },
    { exact: "Dagger_Attack" }, { exact: "Dagger_Attack2" },
    { exact: "Attack" }, { exact: "Attack2" }, { exact: "Punch" },
    { substring: "slash" }, { substring: "sword" }, { substring: "attack" },
    { substring: "punch" }, { substring: "strike" },
  ],
  "attack-ranged":   [
    { exact: "Bow_Shoot" }, { exact: "Shoot_OneHanded" }, { exact: "Bow_Draw" },
    { substring: "bow" }, { substring: "shoot" }, { substring: "ranged" }, { substring: "aim" },
  ],
  "attack-cast":     [
    { exact: "Spell1" }, { exact: "Staff_Attack" }, { exact: "Spell2" },
    { substring: "spell" }, { substring: "cast" }, { substring: "staff" }, { substring: "magic" },
  ],

  "cast-arcane":     [
    { exact: "Spell1" }, { exact: "Staff_Attack" },
    { substring: "spell" }, { substring: "cast" }, { substring: "magic" }, { substring: "arcane" },
  ],
  "cast-holy":       [
    { exact: "Spell1" }, { exact: "Spell2" }, { exact: "Staff_Attack" },
    { substring: "holy" }, { substring: "heal" }, { substring: "bless" },
    { substring: "spell" }, { substring: "cast" },
  ],
  "cast-dark":       [
    { exact: "Spell2" }, { exact: "Spell1" }, { exact: "Staff_Attack" },
    { substring: "dark" }, { substring: "shadow" }, { substring: "curse" },
    { substring: "spell" }, { substring: "cast" },
  ],

  "technique-cleave":      [{ exact: "SwordSlash" }, { exact: "Attack2" }, { substring: "cleave" }, { substring: "spin" }],
  "technique-shield":      [{ exact: "Defend" }, { substring: "block" }, { substring: "shield" }, { substring: "guard" }],
  "technique-rally":       [{ exact: "Victory" }, { substring: "cheer" }, { substring: "yell" }, { substring: "shout" }],
  "technique-shout":       [{ exact: "Victory" }, { substring: "shout" }, { substring: "yell" }, { substring: "roar" }],
  "technique-palm":        [{ exact: "Punch" }, { exact: "Attack" }, { substring: "punch" }, { substring: "palm" }],
  "technique-flying-kick": [{ substring: "kick" }, { substring: "jump" }, { exact: "Attack" }],
  "technique-spin":        [{ substring: "spin" }, { substring: "whirl" }, { exact: "Attack2" }],

  damage:  [{ exact: "RecieveHit" }, { exact: "RecieveHit_2" }, { substring: "hit" }, { substring: "damage" }, { substring: "flinch" }],
  heal:    [{ substring: "heal" }, { substring: "bless" }, { substring: "spell" }],
  death:   [{ exact: "Death" }, { substring: "death" }, { substring: "die" }],
  defeat:  [{ exact: "Defeat" }, { substring: "defeat" }, { substring: "down" }],
  levelup: [{ exact: "Victory" }, { substring: "cheer" }, { substring: "victory" }],

  gather:  [{ exact: "PickUp" }, { substring: "gather" }, { substring: "pickup" }],
  mine:    [{ exact: "PickUp" }, { substring: "mine" }, { substring: "pickup" }],
  forage:  [{ exact: "PickUp" }, { substring: "gather" }, { substring: "pick" }],
  skin:    [{ exact: "PickUp" }, { substring: "skin" }],
  craft:   [{ exact: "PickUp" }, { substring: "craft" }],
  brew:    [{ exact: "PickUp" }, { substring: "brew" }],
  cook:    [{ exact: "PickUp" }, { substring: "cook" }],
  enchant: [{ exact: "Spell1" }, { substring: "enchant" }, { substring: "spell" }],
  carve:   [{ exact: "PickUp" }, { substring: "carve" }],

  roll:    [{ exact: "Roll" }, { substring: "roll" }, { substring: "dodge" }],
  jump:    [{ exact: "Jump" }, { substring: "jump" }],
  pickup:  [{ exact: "PickUp" }, { substring: "pick" }],
  sit:     [{ exact: "SitDown" }, { substring: "sit" }],
  standup: [{ exact: "StandUp" }, { substring: "stand" }],
};

// ── Tier 1: animStyle → per-action clip variants ─────────────────────────────
// Server tags every ability/combat event with `animStyle`: "melee" | "projectile"
// | "area" | "channel". Each style picks a different clip from the SAME action's
// available pool, so even without per-technique mapping the four styles look
// distinct (forward thrust vs overhead AoE vs sustained channel).
//
// Quaternius rigs typically expose `Spell1` (forward stab/thrust) and `Spell2`
// (overhead/AoE). We exploit that pairing.

const STYLE_CLIP_CANDIDATES: Record<string, Partial<Record<Action, ClipCandidate[]>>> = {
  projectile: {
    "cast-arcane":    [{ exact: "Spell1" }, { substring: "bolt" }, { exact: "Staff_Attack" }],
    "cast-holy":      [{ exact: "Spell1" }, { substring: "smite" }, { substring: "bolt" }],
    "cast-dark":      [{ exact: "Spell1" }, { substring: "bolt" }, { substring: "shadow" }],
    "attack-cast":    [{ exact: "Spell1" }, { exact: "Staff_Attack" }],
    "attack-ranged":  [{ exact: "Bow_Shoot" }, { exact: "Shoot_OneHanded" }, { substring: "shoot" }],
  },
  area: {
    "cast-arcane":    [{ exact: "Spell2" }, { exact: "Staff_Attack" }, { substring: "blast" }],
    "cast-holy":      [{ exact: "Spell2" }, { substring: "nova" }, { substring: "burst" }],
    "cast-dark":      [{ exact: "Spell2" }, { substring: "burst" }, { substring: "blast" }],
    "attack-cast":    [{ exact: "Spell2" }, { exact: "Staff_Attack" }],
    "attack-melee":   [{ exact: "Attack2" }, { exact: "SwordSlash" }, { substring: "spin" }, { substring: "cleave" }],
    "attack-ranged":  [{ exact: "Bow_Shoot" }, { substring: "volley" }, { substring: "multi" }],
  },
  channel: {
    "cast-arcane":    [{ exact: "Spell2" }, { exact: "Spell1" }, { substring: "channel" }, { substring: "summon" }],
    "cast-holy":      [{ exact: "Spell2" }, { substring: "channel" }, { substring: "pray" }, { substring: "bless" }],
    "cast-dark":      [{ exact: "Spell2" }, { substring: "channel" }, { substring: "drain" }, { substring: "siphon" }],
    "attack-cast":    [{ exact: "Spell2" }, { substring: "channel" }],
  },
  melee: {
    "attack-melee":   [{ exact: "SwordSlash" }, { exact: "Sword_Attack" }, { exact: "Attack" }, { exact: "Punch" }],
    "technique-cleave":      [{ exact: "Attack2" }, { exact: "SwordSlash" }],
    "technique-palm":        [{ exact: "Punch" }, { exact: "Attack" }],
    "technique-flying-kick": [{ substring: "kick" }, { substring: "jump" }, { exact: "Attack" }],
    "technique-spin":        [{ substring: "spin" }, { substring: "whirl" }, { exact: "Attack2" }],
  },
};

// ── Tier 2: per-technique clip overrides ──────────────────────────────────────
// Hero spells per class get a hand-picked clip. Falls back to Tier 1 (style),
// then Tier 0 (default action map). Ranks are stripped, so `mage_fireball_r3`
// uses the same entry as `mage_fireball`.
//
// NOTE: substring matches are forgiving across Quaternius variants ("Spell1",
// "2H_Spell_Attack", "Spell_Attack_01" all hit "spell").

const TECHNIQUE_CLIP_NAME: Record<string, ClipCandidate[]> = {
  // ── Mage — alternate Spell1 (thrust) / Spell2 (overhead) for visual variety
  mage_fireball:         [{ exact: "Spell1" }, { substring: "fire" }, { substring: "spell" }],
  mage_arcane_missiles:  [{ exact: "Spell2" }, { exact: "Spell1" }, { substring: "spell" }],
  mage_flamestrike:      [{ exact: "Spell2" }, { exact: "Staff_Attack" }, { substring: "blast" }],
  mage_frost_nova:       [{ exact: "Spell2" }, { substring: "nova" }, { substring: "burst" }],
  mage_slow:             [{ exact: "Spell1" }, { substring: "curse" }, { substring: "spell" }],
  mage_frost_armor:      [{ exact: "Defend" }, { exact: "Spell1" }, { substring: "buff" }],
  mage_mana_shield:      [{ exact: "Defend" }, { exact: "Spell2" }, { substring: "shield" }],
  mage_spell_reflect:    [{ exact: "Defend" }, { exact: "Spell2" }],
  mage_temporal_rewind:  [{ exact: "Spell2" }, { substring: "channel" }, { substring: "spell" }],
  mage_starfall_barrage: [{ exact: "Spell2" }, { substring: "channel" }, { substring: "summon" }],
  mage_spellburst:       [{ exact: "Spell2" }, { exact: "Spell1" }, { substring: "blast" }],

  // ── Cleric — Spell1 for direct, Spell2 for area/heal
  cleric_holy_light:          [{ exact: "Spell1" }, { substring: "heal" }, { substring: "bless" }],
  cleric_smite:               [{ exact: "Spell1" }, { substring: "smite" }, { substring: "spell" }],
  cleric_renew:               [{ exact: "Spell2" }, { substring: "heal" }, { substring: "bless" }],
  cleric_holy_nova:           [{ exact: "Spell2" }, { substring: "nova" }, { substring: "burst" }],
  cleric_divine_protection:   [{ exact: "Defend" }, { exact: "Spell1" }, { substring: "shield" }],
  cleric_prayer_of_fortitude: [{ exact: "Spell2" }, { substring: "pray" }, { substring: "bless" }],
  cleric_spirit_of_redemption:[{ exact: "Spell2" }, { substring: "channel" }, { substring: "spirit" }],

  // ── Warlock — Spell2 emphasized for shadow
  warlock_shadow_bolt:        [{ exact: "Spell1" }, { substring: "shadow" }, { substring: "bolt" }],
  warlock_curse_of_weakness:  [{ exact: "Spell1" }, { substring: "curse" }],
  warlock_drain_life:         [{ exact: "Spell2" }, { substring: "drain" }, { substring: "channel" }],
  warlock_corruption:         [{ exact: "Spell2" }, { substring: "curse" }, { substring: "spell" }],
  warlock_howl_of_terror:     [{ exact: "Spell2" }, { substring: "howl" }, { substring: "yell" }],
  warlock_soul_shield:        [{ exact: "Defend" }, { exact: "Spell2" }, { substring: "shield" }],
  warlock_siphon_soul:        [{ exact: "Spell2" }, { substring: "siphon" }, { substring: "drain" }],

  // ── Ranger — bow specialization, Spell1 for nature buffs
  ranger_aimed_shot:        [{ exact: "Bow_Shoot" }, { substring: "aim" }, { substring: "bow" }],
  ranger_quick_shot:        [{ exact: "Bow_Shoot" }, { substring: "shoot" }],
  ranger_multi_shot:        [{ exact: "Bow_Shoot" }, { substring: "volley" }, { substring: "multi" }],
  ranger_volley:            [{ exact: "Bow_Shoot" }, { substring: "volley" }],
  ranger_hunters_mark:      [{ exact: "Bow_Draw" }, { exact: "Bow_Shoot" }, { substring: "aim" }],
  ranger_entangling_roots:  [{ exact: "Spell1" }, { substring: "roots" }, { substring: "spell" }],
  ranger_natures_blessing:  [{ exact: "Spell2" }, { substring: "bless" }, { substring: "heal" }],

  // ── Warrior — sword variants, Defend for shield, Victory for shouts
  warrior_heroic_strike:       [{ exact: "SwordSlash" }, { exact: "Sword_Attack" }],
  warrior_rending_strike:      [{ exact: "Sword_Attack2" }, { exact: "SwordSlash" }],
  warrior_cleave:              [{ exact: "Attack2" }, { exact: "SwordSlash" }, { substring: "cleave" }],
  warrior_shield_wall:         [{ exact: "Defend" }, { substring: "block" }],
  warrior_battle_rage:         [{ exact: "Victory" }, { substring: "shout" }, { substring: "yell" }],
  warrior_intimidating_shout:  [{ exact: "Victory" }, { substring: "shout" }, { substring: "roar" }],
  warrior_rallying_cry:        [{ exact: "Victory" }, { substring: "cheer" }, { substring: "rally" }],

  // ── Paladin — sword for melee, Spell1/Spell2 for holy
  paladin_holy_smite:        [{ exact: "Sword_Attack" }, { exact: "SwordSlash" }],
  paladin_consecration:      [{ exact: "Spell2" }, { substring: "nova" }, { substring: "ground" }],
  paladin_judgment:          [{ exact: "Spell1" }, { substring: "smite" }],
  paladin_lay_on_hands:      [{ exact: "Spell2" }, { substring: "heal" }, { substring: "bless" }],
  paladin_divine_shield:     [{ exact: "Defend" }, { substring: "shield" }, { substring: "bless" }],
  paladin_blessing_of_might: [{ exact: "Spell1" }, { substring: "bless" }],
  paladin_aura_of_resolve:   [{ exact: "Spell2" }, { substring: "aura" }, { substring: "bless" }],

  // ── Rogue — dagger variants
  rogue_backstab:        [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }, { substring: "backstab" }],
  rogue_poison_blade:    [{ exact: "Dagger_Attack" }, { substring: "stab" }],
  rogue_shadow_strike:   [{ exact: "Dagger_Attack2" }, { substring: "stab" }, { substring: "shadow" }],
  rogue_smoke_bomb:      [{ exact: "Spell1" }, { substring: "throw" }, { exact: "Dagger_Attack" }],
  rogue_blade_flurry:    [{ exact: "Dagger_Attack2" }, { substring: "flurry" }, { exact: "Attack2" }],

  // ── Monk — punch / kick / spin specialization
  monk_palm_strike:      [{ exact: "Punch" }, { substring: "palm" }, { exact: "Attack" }],
  monk_disable:          [{ exact: "Punch" }, { substring: "palm" }],
  monk_chi_burst:        [{ exact: "Spell2" }, { substring: "burst" }, { exact: "Spell1" }],
  monk_flying_kick:      [{ substring: "kick" }, { substring: "jump" }, { exact: "Attack" }],
  monk_whirlwind_kick:   [{ substring: "spin" }, { substring: "whirl" }, { exact: "Attack2" }],
  monk_meditation:       [{ substring: "meditate" }, { exact: "SitDown" }, { exact: "Spell1" }],
  monk_inner_focus:      [{ exact: "Spell1" }, { substring: "focus" }, { substring: "bless" }],
};

// Cross-action fallback: if a GLB has no clip for the primary action, try these
// in order before giving up. Each action should degrade gracefully.
const ACTION_FALLBACKS: Partial<Record<Action, Action[]>> = {
  "attack-melee":   ["technique-cleave", "technique-palm"],
  "attack-ranged":  ["attack-cast", "attack-melee"],
  "attack-cast":    ["attack-ranged", "attack-melee"],
  "cast-arcane":    ["attack-cast", "cast-holy", "cast-dark", "attack-ranged", "attack-melee"],
  "cast-holy":      ["attack-cast", "cast-arcane", "attack-ranged", "attack-melee"],
  "cast-dark":      ["attack-cast", "cast-arcane", "attack-ranged", "attack-melee"],
  "technique-cleave":       ["attack-melee"],
  "technique-shield":       ["idle"],
  "technique-rally":        ["idle", "levelup"],
  "technique-shout":        ["idle"],
  "technique-palm":         ["attack-melee"],
  "technique-flying-kick":  ["attack-melee"],
  "technique-spin":         ["attack-melee", "technique-cleave"],
  heal:     ["cast-holy", "cast-arcane", "attack-cast"],
  damage:   ["idle"],
  defeat:   ["death"],
  levelup:  ["cast-holy", "cast-arcane", "idle"],
  mine:     ["gather", "pickup"],
  forage:   ["gather", "pickup"],
  skin:     ["gather", "pickup"],
  brew:     ["craft", "pickup"],
  cook:     ["craft", "pickup"],
  enchant:  ["cast-arcane", "craft"],
  carve:    ["craft", "pickup"],
  gather:   ["pickup"],
  craft:    ["pickup"],
};

// ── Procedural clip names (AnimationLibrary) ──────────────────────────────────
// AnimationLibrary is keyed by its historical names. Map each Action to the
// library's closest equivalent. When a character uses the procedural rig
// (non-GLB fallback), this is the authority.

const PROCEDURAL_CLIP_NAME: Record<Action, string | null> = {
  idle:  "idle",
  walk:  "walk",
  run:   "walk",                     // library has no distinct run, reuse walk
  "attack-melee":   "attack",
  "attack-ranged":  "bowshot",
  "attack-cast":    "magicbolt",
  "cast-arcane":    "spellcast",
  "cast-holy":      "holycast",
  "cast-dark":      "darkcast",
  "technique-cleave":      "cleave",
  "technique-shield":      "shieldwall",
  "technique-rally":       "rallyingcry",
  "technique-shout":       "intimidatingshout",
  "technique-palm":        "palmstrike",
  "technique-flying-kick": "flyingkick",
  "technique-spin":        "whirlwindkick",
  damage:  "damage",
  heal:    "heal",
  death:   "death",
  defeat:  "death",
  levelup: "heal",                   // library has no levelup, heal flash is closest
  gather:  "gather",
  mine:    "mine",
  forage:  "forage",
  skin:    "skin",
  craft:   "craft",
  brew:    "brew",
  cook:    "cook",
  enchant: "enchant",
  carve:   "carve",
  roll:    null,
  jump:    null,
  pickup:  "gather",
  sit:     null,
  standup: null,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the Action for a combat event. `eventKind` distinguishes basic
 * attacks from technique/ability events. `techniqueId` may include ranks
 * (e.g. `warrior_heroic_strike_r2`) — we strip them automatically.
 */
export function resolveAction(
  entity: Pick<Entity, "classId">,
  eventKind: "basic-attack" | "technique",
  techniqueId?: string,
  animStyle?: string,
): Action {
  if (eventKind === "technique" && techniqueId) {
    const mapped = TECHNIQUE_ACTION[stripRank(techniqueId)];
    if (mapped) {
      if (animStyle === "melee" && (mapped === "cast-arcane" || mapped === "cast-holy" || mapped === "cast-dark" || mapped === "attack-cast" || mapped === "attack-ranged")) {
        return basicAttackFor(entity.classId ?? undefined);
      }
      return mapped;
    }
  }
  return basicAttackFor(entity.classId ?? undefined);
}

function basicAttackFor(classId: string | undefined): Action {
  if (!classId) return "attack-melee";
  return CLASS_BASIC_ATTACK[classId] ?? "attack-melee";
}

/**
 * Precompute the Action → clip mapping for a GLB character. Call this once
 * when the entity is built, store the resulting map on the EntityObject, and
 * look up clips with `getClipFromMap` at play time.
 */
export function buildGlbActionMap(glbClips: Map<string, THREE.AnimationClip>): Map<Action, THREE.AnimationClip> {
  const actionMap = new Map<Action, THREE.AnimationClip>();

  const findByCandidate = (cand: ClipCandidate): { clip: THREE.AnimationClip; matched: string } | undefined => {
    if (cand.exact) {
      const c = glbClips.get(cand.exact);
      if (c) return { clip: c, matched: `exact:${cand.exact}` };
    }
    if (cand.substring) {
      const needle = cand.substring.toLowerCase();
      for (const [name, clip] of glbClips) {
        if (name.toLowerCase().includes(needle)) {
          return { clip, matched: `substr(${cand.substring})→${name}` };
        }
      }
    }
    return undefined;
  };

  for (const [action, candidates] of Object.entries(GLB_CANDIDATES) as [Action, ClipCandidate[]][]) {
    for (const cand of candidates) {
      const result = findByCandidate(cand);
      if (result) {
        actionMap.set(action, result.clip);
        break;
      }
    }
  }

  return actionMap;
}

/**
 * Look up a clip for the given action in a pre-built action map, applying
 * cross-action fallbacks. Returns null only if the rig has nothing remotely
 * suitable — which, for a GLB with at least idle + walk, is never.
 */
/**
 * Resolve a clip for an Action from a pre-built GLB map.
 * Pass `debugName` (entity name) to trace resolution for ONE specific entity;
 * otherwise silent.
 */
export function getClipFromMap(
  actionMap: Map<Action, THREE.AnimationClip>,
  action: Action,
  debugName?: string | null,
): THREE.AnimationClip | null {
  const direct = actionMap.get(action);
  if (direct) {
    animLogFor(debugName, `${action} → ${direct.name}`);
    return direct;
  }

  const chain = ACTION_FALLBACKS[action] ?? [];
  for (const fb of chain) {
    const c = actionMap.get(fb);
    if (c) {
      animLogFor(debugName, `${action} → fallback(${fb})=${c.name}`);
      return c;
    }
  }

  for (const fb of ["attack-melee", "attack-ranged", "attack-cast", "cast-arcane", "idle"] as Action[]) {
    const c = actionMap.get(fb);
    if (c) {
      animLogFor(debugName, `${action} → last-resort(${fb})=${c.name}`);
      return c;
    }
  }
  animLogFor(debugName, `${action} → NO CLIP. Map has: ${Array.from(actionMap.keys()).join(", ")}`);
  return null;
}

/**
 * Procedural (non-GLB) clip resolution — uses the hand-authored
 * AnimationLibrary. Same fallback chain applies.
 */
export function getProceduralClip(action: Action): THREE.AnimationClip | null {
  const direct = PROCEDURAL_CLIP_NAME[action];
  if (direct) {
    try { return AnimationLibrary.get(direct); } catch { /* fall through */ }
  }
  const chain = ACTION_FALLBACKS[action] ?? [];
  for (const fb of chain) {
    const name = PROCEDURAL_CLIP_NAME[fb];
    if (name) {
      try { return AnimationLibrary.get(name); } catch { /* continue */ }
    }
  }
  return null;
}

/**
 * Resolve a per-technique or per-animStyle clip variant from raw GLB clips.
 *
 * Returns null if neither tier produces a different clip than the default
 * action map would (caller should then use the default `getClipFromMap`).
 *
 * Tier 2 (techniqueId) takes priority over Tier 1 (animStyle). Both walk
 * `ClipCandidate` lists exactly like `buildGlbActionMap`.
 *
 *   resolveTechniqueClip(glbClips, "cast-arcane", "mage_fireball", "projectile")
 *     → first matching clip from TECHNIQUE_CLIP_NAME["mage_fireball"]
 *
 *   resolveTechniqueClip(glbClips, "cast-arcane", "mage_unknown", "area")
 *     → first matching clip from STYLE_CLIP_CANDIDATES["area"]["cast-arcane"]
 */
export function resolveTechniqueClip(
  glbClips: Map<string, THREE.AnimationClip>,
  action: Action,
  techniqueId?: string,
  animStyle?: string,
): THREE.AnimationClip | null {
  const findByCandidates = (candidates: ClipCandidate[]): THREE.AnimationClip | null => {
    for (const cand of candidates) {
      if (cand.exact) {
        const c = glbClips.get(cand.exact);
        if (c) return c;
      }
      if (cand.substring) {
        const needle = cand.substring.toLowerCase();
        for (const [name, clip] of glbClips) {
          if (name.toLowerCase().includes(needle)) return clip;
        }
      }
    }
    return null;
  };

  // Tier 2: per-technique override
  if (techniqueId) {
    const stripped = stripRank(techniqueId);
    const techCandidates = TECHNIQUE_CLIP_NAME[stripped];
    if (techCandidates) {
      const clip = findByCandidates(techCandidates);
      if (clip) return clip;
    }
  }

  // Tier 1: animStyle variant for this action
  if (animStyle) {
    const styleMap = STYLE_CLIP_CANDIDATES[animStyle];
    const styleCandidates = styleMap?.[action];
    if (styleCandidates) {
      const clip = findByCandidates(styleCandidates);
      if (clip) return clip;
    }
  }

  return null;
}

/** Which actions a GLB is expected to have for combat. Logs warnings when missing. */
export function auditGlbActionMap(
  actionMap: Map<Action, THREE.AnimationClip>,
  clipNames: string[],
  entityName: string,
  classId: string | undefined,
): void {
  const expected: Action[] = ["idle", "walk", "attack-melee"];
  const classAttack = basicAttackFor(classId);
  if (!expected.includes(classAttack)) expected.push(classAttack);

  const missing = expected.filter((a) => !actionMap.has(a));
  if (missing.length > 0) {
    console.warn(
      `[AnimResolver] ${entityName} (${classId ?? "?"}): missing [${missing.join(", ")}]. `
      + `Available clips: ${clipNames.join(", ")}`,
    );
  }
}
