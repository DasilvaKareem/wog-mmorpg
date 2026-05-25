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
  paladin_divine_bulwark: "technique-shield",
  paladin_hammer_of_justice: "attack-melee",
  paladin_wings_of_valor: "cast-holy",
  paladin_wrath_of_the_righteous: "attack-melee",
  paladin_hand_of_god: "cast-holy",
  paladin_blessing_of_kings: "cast-holy",
  paladin_aura_of_devotion: "cast-holy",
  paladin_divine_aegis: "cast-holy",
  paladin_blessing_of_protection: "cast-holy",
  paladin_blessing_of_sanctuary: "cast-holy",
  // Rogue
  rogue_backstab: "attack-melee",
  rogue_poison_blade: "attack-melee",
  rogue_shadow_strike: "attack-melee",
  rogue_smoke_bomb: "attack-melee",
  rogue_blade_flurry: "technique-cleave",
  rogue_stealth: "idle",
  rogue_evasion: "idle",
  // Higher ranks default to "attack-melee" via basicAttackFor → resolves to Dagger_Attack on rogue rig
  rogue_shadowstep_ambush: "attack-melee",
  rogue_death_mark: "attack-melee",
  rogue_phantom_strike: "attack-melee",
  rogue_deathblow: "attack-melee",
  rogue_living_shadow: "attack-melee",
  // Party / ally buffs — no strike, hold combat-idle stance
  rogue_tricks_of_the_trade: "idle",
  rogue_shadow_veil: "idle",
  rogue_assassins_mark: "idle",
  rogue_sharpen_blade: "idle",
  rogue_shadow_infusion: "idle",
  // Ranger
  ranger_aimed_shot: "attack-ranged",
  ranger_hunters_mark: "attack-ranged",
  ranger_quick_shot: "attack-ranged",
  ranger_multi_shot: "attack-ranged",
  ranger_volley: "attack-ranged",
  ranger_entangling_roots: "cast-arcane",
  ranger_natures_blessing: "cast-holy",
  ranger_sky_piercer: "attack-ranged",
  ranger_storm_of_arrows: "attack-ranged",
  ranger_falcon_dive: "attack-ranged",
  ranger_arrow_of_judgment: "attack-ranged",
  ranger_heavens_volley: "attack-ranged",
  ranger_pack_tactics: "cast-holy",
  ranger_natures_vigil: "cast-holy",
  ranger_predators_instinct: "cast-holy",
  ranger_eagle_eye: "cast-holy",
  ranger_bond_of_the_wild: "cast-holy",
  // Mage
  mage_fireball: "cast-arcane",
  mage_arcane_missiles: "cast-arcane",
  mage_slow: "cast-arcane",
  mage_flamestrike: "cast-arcane",
  mage_frost_nova: "cast-arcane",
  mage_frost_armor: "cast-arcane",
  mage_mana_shield: "cast-arcane",
  mage_glacial_prison: "cast-arcane",
  mage_meteor_strike: "cast-arcane",
  mage_time_warp: "cast-arcane",
  mage_arcane_cataclysm: "cast-arcane",
  mage_absolute_zero: "cast-arcane",
  mage_arcane_brilliance: "cast-arcane",
  mage_temporal_shift: "cast-arcane",
  mage_arcane_empowerment: "cast-arcane",
  mage_arcane_infusion: "cast-arcane",
  mage_chrono_blessing: "cast-arcane",
  // Cleric
  cleric_holy_light: "cast-holy",
  cleric_smite: "cast-holy",
  cleric_renew: "cast-holy",
  cleric_holy_nova: "cast-holy",
  cleric_divine_protection: "cast-holy",
  cleric_prayer_of_fortitude: "cast-holy",
  cleric_spirit_of_redemption: "cast-holy",
  cleric_guardian_angel: "cast-holy",
  cleric_divine_hymn: "cast-holy",
  cleric_wrath_of_heaven: "cast-holy",
  cleric_divine_intervention: "cast-holy",
  cleric_wrath_of_the_divine: "cast-holy",
  cleric_prayer_of_healing: "cast-holy",
  cleric_sanctuary: "cast-holy",
  cleric_divine_chorus: "cast-holy",
  cleric_greater_renew: "cast-holy",
  cleric_blessing_of_light: "cast-holy",
  // Warlock
  warlock_shadow_bolt: "cast-dark",
  warlock_curse_of_weakness: "cast-dark",
  warlock_drain_life: "cast-dark",
  warlock_corruption: "cast-dark",
  warlock_howl_of_terror: "cast-dark",
  warlock_soul_shield: "cast-dark",
  warlock_siphon_soul: "cast-dark",
  warlock_demonic_grasp: "cast-dark",
  warlock_nether_gate: "cast-dark",
  warlock_soul_rend: "cast-dark",
  warlock_doom: "cast-dark",
  warlock_soul_harvest: "cast-dark",
  warlock_dark_pact: "cast-dark",
  warlock_soul_link: "cast-dark",
  warlock_demonic_empowerment: "cast-dark",
  warlock_dark_empowerment: "cast-dark",
  warlock_soul_covenant: "cast-dark",
  // Monk
  monk_palm_strike: "technique-palm",
  monk_disable: "technique-palm",
  monk_chi_burst: "cast-arcane",
  monk_flying_kick: "technique-flying-kick",
  monk_whirlwind_kick: "technique-spin",
  monk_meditation: "cast-holy",
  monk_inner_focus: "cast-holy",
  monk_hundred_fists: "technique-palm",
  monk_dragon_strike: "technique-palm",
  monk_inner_peace: "cast-holy",
  monk_one_thousand_palms: "technique-palm",
  monk_perfect_balance: "cast-holy",
  monk_windwalkers_grace: "cast-holy",
  monk_zen_meditation: "cast-holy",
  monk_transcendence: "cast-holy",
  monk_chi_attunement: "cast-holy",
  monk_spirit_bond: "cast-holy",
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
  // ── Mage — Wizard.glb exposes:
  //   Death, Idle_Attacking, Idle, Idle_Weapon, PickUp, Punch, RecieveHit,
  //   RecieveHit_2, Roll, Run, Run_Weapon, Spell1, Spell2, Staff_Attack, Walk
  // Spell1 = forward thrust (single-target / bolts).
  // Spell2 = overhead, both arms (AoE / channels / heavy spells).
  // Idle_Weapon = staff held neutrally, used for passive self-buffs.
  mage_fireball:             [{ exact: "Spell1" }],                          // forward thrust
  mage_arcane_missiles:      [{ exact: "Spell2" }, { exact: "Spell1" }],     // multi-shot, two-handed
  mage_flamestrike:          [{ exact: "Spell2" }],                          // overhead AoE
  mage_frost_nova:           [{ exact: "Spell2" }],                          // burst around caster
  mage_slow:                 [{ exact: "Spell1" }],                          // pointed debuff
  mage_frost_armor:          [{ exact: "Idle_Weapon" }, { exact: "Spell1" }],// passive armor
  mage_mana_shield:          [{ exact: "Idle_Weapon" }, { exact: "Spell2" }],// arms-up shield
  mage_glacial_prison:       [{ exact: "Spell2" }],                          // overhead AoE freeze
  mage_meteor_strike:        [{ exact: "Spell2" }],                          // calling down a meteor
  mage_time_warp:            [{ exact: "Idle_Weapon" }, { exact: "Spell2" }],// self channel
  mage_arcane_cataclysm:     [{ exact: "Spell2" }],                          // ultimate AoE
  mage_absolute_zero:        [{ exact: "Spell2" }],                          // ultimate freeze
  // Party / ally buffs — passive staff-held stance.
  mage_arcane_brilliance:    [{ exact: "Idle_Weapon" }, { exact: "Spell1" }],
  mage_temporal_shift:       [{ exact: "Idle_Weapon" }, { exact: "Spell2" }],
  mage_arcane_empowerment:   [{ exact: "Idle_Weapon" }, { exact: "Spell2" }],
  mage_arcane_infusion:      [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  mage_chrono_blessing:      [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],

  // ── Cleric — Cleric.glb exposes (note: NO Spell2, NO Idle_Attacking):
  //   Death, Idle, Idle_Weapon, PickUp, Punch, RecieveHit, RecieveHit_Attacking,
  //   Run, Spell1, Staff_Attack, Walk
  // Every spell collapses to Spell1; VFX is the entire differentiator.
  cleric_holy_light:            [{ exact: "Spell1" }],
  cleric_smite:                 [{ exact: "Spell1" }, { exact: "Staff_Attack" }],
  cleric_renew:                 [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  cleric_holy_nova:             [{ exact: "Spell1" }],
  cleric_divine_protection:     [{ exact: "Idle_Weapon" }, { exact: "Spell1" }],
  cleric_prayer_of_fortitude:   [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  cleric_spirit_of_redemption:  [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  cleric_guardian_angel:        [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  cleric_divine_hymn:           [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  cleric_wrath_of_heaven:       [{ exact: "Spell1" }],
  cleric_divine_intervention:   [{ exact: "Idle_Weapon" }, { exact: "Spell1" }],
  cleric_wrath_of_the_divine:   [{ exact: "Spell1" }],
  cleric_prayer_of_healing:     [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  cleric_sanctuary:             [{ exact: "Idle_Weapon" }, { exact: "Spell1" }],
  cleric_divine_chorus:         [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  cleric_greater_renew:         [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  cleric_blessing_of_light:     [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],

  // ── Warlock — shares Wizard.glb with Mage (dark-tint atlas)
  warlock_shadow_bolt:         [{ exact: "Spell1" }],                          // forward bolt
  warlock_curse_of_weakness:   [{ exact: "Spell1" }],                          // pointed hex
  warlock_drain_life:          [{ exact: "Spell2" }],                          // sustained channel
  warlock_corruption:          [{ exact: "Spell2" }, { exact: "Spell1" }],     // sustained curse
  warlock_howl_of_terror:      [{ exact: "Spell2" }],                          // overhead howl
  warlock_soul_shield:         [{ exact: "Idle_Weapon" }, { exact: "Spell2" }],// arms-up shield
  warlock_siphon_soul:         [{ exact: "Spell2" }],                          // channeling pull
  warlock_demonic_grasp:       [{ exact: "Spell1" }, { exact: "Spell2" }],     // grasping reach
  warlock_nether_gate:         [{ exact: "Spell2" }],                          // overhead portal
  warlock_soul_rend:           [{ exact: "Spell2" }],                          // multi-target AoE
  warlock_doom:                [{ exact: "Spell1" }, { exact: "Spell2" }],     // dooming the target
  warlock_soul_harvest:        [{ exact: "Spell2" }],                          // overhead reap
  // Party / ally buffs — passive staff-held stance.
  warlock_dark_pact:           [{ exact: "Idle_Weapon" }, { exact: "Spell1" }],
  warlock_soul_link:           [{ exact: "Idle_Weapon" }, { exact: "Spell2" }],
  warlock_demonic_empowerment: [{ exact: "Idle_Weapon" }, { exact: "Spell2" }],
  warlock_dark_empowerment:    [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],
  warlock_soul_covenant:       [{ exact: "Spell1" }, { exact: "Idle_Weapon" }],

  // ── Ranger — Ranger.glb exposes:
  //   Bow_Draw, Bow_Shoot, Death, Idle_Attacking, Idle, Idle_Weapon, PickUp,
  //   Punch, RecieveHit, RecieveHit_2, Roll, Run, Run_Holding, Walk
  // No spell clips — nature/heal abilities lean on Idle_Weapon (bow held).
  ranger_aimed_shot:           [{ exact: "Bow_Draw" }, { exact: "Bow_Shoot" }],   // hold-then-release
  ranger_quick_shot:           [{ exact: "Bow_Shoot" }],                          // instant
  ranger_multi_shot:           [{ exact: "Bow_Shoot" }],
  ranger_volley:               [{ exact: "Bow_Shoot" }],
  ranger_hunters_mark:         [{ exact: "Bow_Draw" }, { exact: "Idle_Weapon" }],
  ranger_entangling_roots:     [{ exact: "Idle_Weapon" }, { exact: "Bow_Draw" }],
  ranger_natures_blessing:     [{ exact: "Idle_Weapon" }],
  ranger_sky_piercer:          [{ exact: "Bow_Draw" }, { exact: "Bow_Shoot" }],
  ranger_storm_of_arrows:      [{ exact: "Bow_Shoot" }],
  ranger_falcon_dive:          [{ exact: "Bow_Shoot" }, { exact: "Bow_Draw" }],
  ranger_arrow_of_judgment:    [{ exact: "Bow_Draw" }, { exact: "Bow_Shoot" }],
  ranger_heavens_volley:       [{ exact: "Bow_Shoot" }],
  ranger_pack_tactics:         [{ exact: "Idle_Weapon" }],
  ranger_natures_vigil:        [{ exact: "Idle_Weapon" }],
  ranger_predators_instinct:   [{ exact: "Idle_Weapon" }],
  ranger_eagle_eye:            [{ exact: "Idle_Weapon" }],
  ranger_bond_of_the_wild:     [{ exact: "Idle_Weapon" }],

  // ── Warrior — Warrior.glb exposes exactly these clips:
  //   Death, Idle_Attacking, Idle, Idle_Weapon, PickUp, Punch, RecieveHit,
  //   Roll, Run, Run_Weapon, Sword_Attack, Sword_Attack2, Walk
  // No Defend / Victory / Cleave / Spell clips exist, so shouts and stances
  // fall back to Idle_Attacking (combat stance, fists clenched) and VFX
  // carries the distinctiveness.
  warrior_heroic_strike:       [{ exact: "Sword_Attack2" }, { exact: "Sword_Attack" }],   // heavier slash
  warrior_rending_strike:      [{ exact: "Sword_Attack2" }, { exact: "Sword_Attack" }],   // brutal cut
  warrior_cleave:              [{ exact: "Sword_Attack" }, { exact: "Sword_Attack2" }],   // standard slash, sweep VFX
  warrior_shield_wall:         [{ exact: "Idle_Attacking" }, { exact: "Idle_Weapon" }],   // defensive stance
  warrior_battle_rage:         [{ exact: "Idle_Attacking" }],                              // combat roar stance
  warrior_intimidating_shout:  [{ exact: "Idle_Attacking" }, { exact: "Punch" }],          // assertive stance
  warrior_rallying_cry:        [{ exact: "Idle_Attacking" }],                              // weapon-raised cry
  warrior_titans_charge:       [{ exact: "Sword_Attack2" }, { exact: "Sword_Attack" }],   // heaviest hit
  warrior_earthquake_slam:     [{ exact: "Sword_Attack2" }, { exact: "PickUp" }],         // overhead-ish
  warrior_undying_rage:        [{ exact: "Idle_Attacking" }],                              // berserker stance

  // ── Paladin — shares Warrior.glb (gold tint). Same clip pool:
  //   Death, Idle_Attacking, Idle, Idle_Weapon, PickUp, Punch, RecieveHit,
  //   Roll, Run, Run_Weapon, Sword_Attack, Sword_Attack2, Walk
  // No spell clips — holy abilities lean on Idle_Weapon stance + VFX.
  paladin_holy_smite:              [{ exact: "Sword_Attack" }, { exact: "Sword_Attack2" }],
  paladin_consecration:            [{ exact: "Idle_Weapon" }, { exact: "Sword_Attack" }],
  paladin_judgment:                [{ exact: "Sword_Attack" }, { exact: "Idle_Weapon" }],
  paladin_lay_on_hands:            [{ exact: "Idle_Weapon" }, { exact: "Idle" }],
  paladin_divine_shield:           [{ exact: "Idle_Attacking" }, { exact: "Idle_Weapon" }],
  paladin_blessing_of_might:       [{ exact: "Idle_Weapon" }],
  paladin_aura_of_resolve:         [{ exact: "Idle_Weapon" }],
  paladin_divine_bulwark:          [{ exact: "Idle_Attacking" }, { exact: "Idle_Weapon" }],
  paladin_hammer_of_justice:       [{ exact: "Sword_Attack2" }, { exact: "Sword_Attack" }],
  paladin_wings_of_valor:          [{ exact: "Idle_Weapon" }, { exact: "Idle_Attacking" }],
  paladin_wrath_of_the_righteous:  [{ exact: "Sword_Attack2" }, { exact: "Sword_Attack" }],
  paladin_hand_of_god:             [{ exact: "Idle_Weapon" }, { exact: "Idle" }],
  paladin_blessing_of_kings:       [{ exact: "Idle_Weapon" }],
  paladin_aura_of_devotion:        [{ exact: "Idle_Weapon" }],
  paladin_divine_aegis:            [{ exact: "Idle_Weapon" }],
  paladin_blessing_of_protection:  [{ exact: "Idle_Weapon" }],
  paladin_blessing_of_sanctuary:   [{ exact: "Idle_Weapon" }],

  // ── Rogue — Rogue.glb exposes:
  //   Attacking_Idle, Dagger_Attack, Dagger_Attack2, Death, Idle, PickUp,
  //   Punch, RecieveHit, RecieveHit_2, Roll, Run, Walk
  // No spell/throw/teleport clips, so blink/teleport/cloud abilities lean
  // on a dagger strike + VFX to sell the fantasy.
  rogue_backstab:              [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }],   // brutal stab
  rogue_poison_blade:          [{ exact: "Dagger_Attack" }, { exact: "Dagger_Attack2" }],   // standard nick
  rogue_shadow_strike:         [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }],   // sudden strike after blink
  rogue_smoke_bomb:            [{ exact: "Punch" }, { exact: "PickUp" }],                   // throw-then-cloud read
  rogue_blade_flurry:          [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }],   // (only one clip plays; VFX = flurry)
  rogue_shadowstep_ambush:     [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }],
  rogue_death_mark:            [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }],
  rogue_phantom_strike:        [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }],
  rogue_deathblow:             [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }],   // the killing blow
  rogue_living_shadow:         [{ exact: "Dagger_Attack2" }, { exact: "Dagger_Attack" }],
  // Party / ally buffs — hold combat stance, VFX projects the boon.
  rogue_tricks_of_the_trade:   [{ exact: "Attacking_Idle" }, { exact: "Idle" }],
  rogue_shadow_veil:           [{ exact: "Attacking_Idle" }, { exact: "Idle" }],
  rogue_assassins_mark:        [{ exact: "Attacking_Idle" }, { exact: "Idle" }],
  rogue_sharpen_blade:         [{ exact: "Attacking_Idle" }, { exact: "Idle" }],
  rogue_shadow_infusion:       [{ exact: "Attacking_Idle" }, { exact: "Idle" }],

  // ── Monk — Monk.glb exposes (NO Punch, NO Spell):
  //   Attack, Attack2, Death, Idle_Attacking, Idle, PickUp, RecieveHit,
  //   RecieveHit_2, Roll, Run, Walk
  // Only TWO combat motions (Attack / Attack2) for the entire kit. Alternate
  // them on cadence — quick strikes use Attack, heavy hits use Attack2.
  monk_palm_strike:        [{ exact: "Attack" }],                 // quick palm
  monk_disable:            [{ exact: "Attack" }],                 // control hit
  monk_chi_burst:          [{ exact: "Attack2" }],                // heavier blast
  monk_flying_kick:        [{ exact: "Attack2" }],                // gap-closer
  monk_whirlwind_kick:     [{ exact: "Attack2" }],                // heavy spin
  monk_meditation:         [{ exact: "Idle_Attacking" }, { exact: "Idle" }],
  monk_inner_focus:        [{ exact: "Idle_Attacking" }],
  monk_hundred_fists:      [{ exact: "Attack" }, { exact: "Attack2" }],     // rapid flurry
  monk_dragon_strike:      [{ exact: "Attack2" }],                // heaviest hit
  monk_inner_peace:        [{ exact: "Idle_Attacking" }, { exact: "Idle" }],
  monk_one_thousand_palms: [{ exact: "Attack2" }, { exact: "Attack" }],     // ultimate
  monk_perfect_balance:    [{ exact: "Idle_Attacking" }, { exact: "Idle" }],
  monk_windwalkers_grace:  [{ exact: "Idle_Attacking" }],
  monk_zen_meditation:     [{ exact: "Idle_Attacking" }, { exact: "Idle" }],
  monk_transcendence:      [{ exact: "Idle_Attacking" }, { exact: "Idle" }],
  monk_chi_attunement:     [{ exact: "Idle_Attacking" }],
  monk_spirit_bond:        [{ exact: "Idle_Attacking" }],
};

// ── Tier 3: critical-hit clip preference ──────────────────────────────────────
// When the server flags `data.critical === true`, the resolver tries these
// candidates BEFORE the per-technique or per-style maps. The intent is purely
// visual: a crit should look like a heavier, distinct swing. Limited to
// melee-flavoured actions — ranged/cast crits already read clearly via the
// damage numbers and we don't want to mis-route projectile/channel clips.

const CRITICAL_GLB_CANDIDATES: Partial<Record<Action, ClipCandidate[]>> = {
  "attack-melee":           [{ exact: "Sword_Attack2" }, { exact: "Attack2" }, { exact: "Dagger_Attack2" }, { exact: "SwordSlash" }, { substring: "heavy" }, { substring: "power" }],
  "technique-cleave":       [{ exact: "Attack2" }, { exact: "Sword_Attack2" }, { exact: "SwordSlash" }, { substring: "spin" }],
  "technique-palm":         [{ exact: "Attack2" }, { exact: "Punch" }, { exact: "Attack" }],
  "technique-flying-kick":  [{ substring: "kick" }, { substring: "jump" }, { exact: "Attack2" }],
  "technique-spin":         [{ substring: "spin" }, { substring: "whirl" }, { exact: "Attack2" }],
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

  // Locomotion (idle/walk/run) must NEVER fall back to a combat clip — otherwise
  // a rig with only an "Attack" clip (e.g. Quaternius Easy Enemy pack) plays
  // attack on loop while standing still. Walk/run can borrow from each other;
  // idle returns null (mob holds bind pose), which reads cleanly.
  const isLocomotion = action === "idle" || action === "walk" || action === "run";
  if (isLocomotion) {
    const locomotionFallback: Action[] =
      action === "walk" ? ["run", "idle"]
      : action === "run"  ? ["walk", "idle"]
      : ["walk", "run"];
    for (const fb of locomotionFallback) {
      const c = actionMap.get(fb);
      if (c) {
        animLogFor(debugName, `${action} → locomotion-fallback(${fb})=${c.name}`);
        return c;
      }
    }
    animLogFor(debugName, `${action} → no locomotion clip; holding bind pose`);
    return null;
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
export function getProceduralClip(action: Action, _critical?: boolean): THREE.AnimationClip | null {
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
  critical?: boolean,
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

  // Tier 3: critical-hit preference (melee-flavoured actions only)
  if (critical) {
    const critCandidates = CRITICAL_GLB_CANDIDATES[action];
    if (critCandidates) {
      const clip = findByCandidates(critCandidates);
      if (clip) return clip;
    }
  }

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
