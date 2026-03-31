/**
 * Profession XP System
 * Awards character XP for gathering, crafting, cooking, brewing, skinning, etc.
 * Also tracks per-profession skill XP/levels and quest progress.
 */

import { xpForLevel, MAX_LEVEL, computeStatsAtLevel } from "../character/leveling.js";
import { recalculateEntityVitals, type Entity, getAllZones } from "../world/zoneRuntime.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { saveCharacter } from "../character/characterStore.js";
import { logDiary, narrativeLevelUp } from "../social/diary.js";
import { QUEST_CATALOG } from "../social/questSystem.js";
import type { ProfessionType } from "./professions.js";

// ── Per-profession skill tracking ───────────────────────────────────

export const PROFESSION_SKILL_MAX = 300;

/** XP thresholds for each skill level (1-300). Level N requires SKILL_XP_TABLE[N] cumulative XP. */
function skillXpForLevel(level: number): number {
  // Quadratic curve: level 1=0, level 50≈2500, level 100≈10000, level 200≈40000, level 300≈90000
  if (level <= 1) return 0;
  return Math.floor((level - 1) * (level - 1));
}

export function skillLevelFromXp(xp: number): number {
  // Inverse of quadratic: level = floor(sqrt(xp)) + 1, capped at 300
  const level = Math.floor(Math.sqrt(xp)) + 1;
  return Math.min(level, PROFESSION_SKILL_MAX);
}

export interface ProfessionSkillData {
  xp: number;
  level: number;
  actions: number; // total gather/craft/brew/etc. actions
}

// walletAddress (lowercase) -> professionId -> skill data
const professionSkills = new Map<string, Map<string, ProfessionSkillData>>();

/** Map actionLabel from awardProfessionXp to a ProfessionType */
const ACTION_TO_PROFESSION: Record<string, ProfessionType> = {
  mining: "mining",
  herbalism: "herbalism",
  skinning: "skinning",
  crafting: "blacksmithing",
  blacksmithing: "blacksmithing",
  alchemy: "alchemy",
  cooking: "cooking",
  leatherworking: "leatherworking",
  jewelcrafting: "jewelcrafting",
};

function getOrCreateSkill(wallet: string, profession: string): ProfessionSkillData {
  const key = wallet.toLowerCase();
  if (!professionSkills.has(key)) professionSkills.set(key, new Map());
  const map = professionSkills.get(key)!;
  if (!map.has(profession)) map.set(profession, { xp: 0, level: 1, actions: 0 });
  return map.get(profession)!;
}

/** Award per-profession skill XP (called alongside character XP award) */
function awardSkillXp(wallet: string, actionLabel: string, xpAmount: number): void {
  const profId = ACTION_TO_PROFESSION[actionLabel];
  if (!profId) return;
  const skill = getOrCreateSkill(wallet, profId);
  skill.xp += xpAmount;
  skill.actions += 1;
  skill.level = skillLevelFromXp(skill.xp);
}

/** Get all profession skill data for a wallet */
export function getProfessionSkills(walletAddress: string): Record<string, ProfessionSkillData> {
  const map = professionSkills.get(walletAddress.toLowerCase());
  if (!map) return {};
  const result: Record<string, ProfessionSkillData> = {};
  for (const [prof, data] of map) {
    result[prof] = { ...data };
  }
  return result;
}

/** Restore profession skills from persisted data (called on spawn/login) */
export function restoreProfessionSkills(walletAddress: string, skills: Record<string, ProfessionSkillData>): void {
  const key = walletAddress.toLowerCase();
  if (!professionSkills.has(key)) professionSkills.set(key, new Map());
  const map = professionSkills.get(key)!;
  for (const [prof, data] of Object.entries(skills)) {
    map.set(prof, { xp: data.xp ?? 0, level: data.level ?? 1, actions: data.actions ?? 0 });
  }
}

/** Get XP needed for next skill level */
export function skillXpProgress(skill: ProfessionSkillData): { current: number; needed: number; pct: number } {
  if (skill.level >= PROFESSION_SKILL_MAX) return { current: 0, needed: 0, pct: 100 };
  const currentLevelXp = skillXpForLevel(skill.level);
  const nextLevelXp = skillXpForLevel(skill.level + 1);
  const needed = nextLevelXp - currentLevelXp;
  const current = skill.xp - currentLevelXp;
  return { current, needed, pct: needed > 0 ? Math.floor((current / needed) * 100) : 100 };
}

// XP constants by profession action
export const PROFESSION_XP = {
  // Mining (by ore rarity)
  GATHER_COMMON: 15,
  GATHER_UNCOMMON: 20,
  GATHER_RARE: 25,
  GATHER_EPIC: 30,
  // Skinning
  SKIN: 12,
  // Cooking (by recipe tier)
  COOK_TIER1: 20,
  COOK_TIER2: 25,
  COOK_TIER3: 35,
  // Alchemy (by potion tier)
  BREW_TIER1: 25,
  BREW_TIER2: 30,
  BREW_TIER3: 40,
  // Blacksmithing (by recipe type)
  FORGE_SMELT: 20,
  FORGE_WEAPON: 35,
  FORGE_ADVANCED: 40,
  // Leatherworking
  LEATHER_BASIC: 30,
  LEATHER_ADVANCED: 40,
  // Jewelcrafting
  JEWEL_RING: 35,
  JEWEL_AMULET: 45,
} as const;

export interface ProfessionXpResult {
  xpAwarded: number;
  totalXp: number;
  leveledUp: boolean;
  newLevel?: number;
}

/**
 * Award character XP for a profession action (gather, craft, etc.).
 * Handles: XP add -> level-up check -> stat recompute -> zone event -> diary -> save -> quest progress.
 *
 * @param entity       The player entity
 * @param zoneId       The zone where the action occurred
 * @param xpAmount     Amount of XP to award
 * @param actionLabel  Short label for logging (e.g. "mining", "cooking")
 * @param craftedItemName  For craft quest tracking: the crafted item name (e.g. "Hearty Stew")
 * @param gatheredItemName For gather quest tracking: the node/resource name (e.g. "Coal Deposit")
 */
export function awardProfessionXp(
  entity: Entity,
  zoneId: string,
  xpAmount: number,
  actionLabel: string,
  craftedItemName?: string,
  gatheredItemName?: string,
): ProfessionXpResult {
  if (xpAmount <= 0) return { xpAwarded: 0, totalXp: entity.xp ?? 0, leveledUp: false };

  // Track per-profession skill XP
  if (entity.walletAddress) {
    awardSkillXp(entity.walletAddress, actionLabel, xpAmount);
  }

  // Ensure level and xp are proper numbers (safety fix)
  if (typeof entity.level !== "number") entity.level = Number(entity.level) || 1;
  if (typeof entity.xp !== "number") entity.xp = Number(entity.xp) || 0;

  // Add XP
  entity.xp = entity.xp + xpAmount;

  // Check for level-up(s)
  let leveled = false;
  if (entity.level != null && entity.level < MAX_LEVEL) {
    while (entity.level < MAX_LEVEL && entity.xp >= xpForLevel(entity.level + 1)) {
      entity.level++;
      leveled = true;
    }

    if (leveled && entity.raceId && entity.classId) {
      const newStats = computeStatsAtLevel(entity.raceId, entity.classId, entity.level);
      entity.stats = newStats;
      recalculateEntityVitals(entity);

      // Find zone tick for event logging
      const zone = getAllZones().get(zoneId);
      const tick = zone?.tick ?? 0;

      // Log level-up zone event
      logZoneEvent({
        zoneId,
        type: "levelup",
        tick,
        message: `*** ${entity.name} reached level ${entity.level}! ***`,
        entityId: entity.id,
        entityName: entity.name,
        data: { level: entity.level, xp: entity.xp },
      });

      // Log level-up diary entry
      if (entity.walletAddress) {
        const { headline, narrative } = narrativeLevelUp(
          entity.name, entity.raceId, entity.classId, zoneId, entity.level,
        );
        logDiary(
          entity.walletAddress, entity.name, zoneId, entity.x, entity.y,
          "level_up", headline, narrative,
          { newLevel: entity.level, xp: entity.xp, source: actionLabel },
        );
      }

      console.log(`[${actionLabel}] *** ${entity.name} leveled up to ${entity.level}! ***`);
    }
  }

  // Persist character + profession skills
  if (entity.walletAddress && entity.name) {
    saveCharacter(entity.walletAddress, entity.name, {
      level: entity.level,
      xp: entity.xp,
      kills: entity.kills,
      professionSkills: getProfessionSkills(entity.walletAddress),
    }).catch((err) =>
      console.error(`[persistence] Save failed after ${actionLabel} for ${entity.name}:`, err),
    );
  }

  // Track quest progress for "gather" and "craft" quest types
  if (entity.activeQuests) {
    for (const activeQuest of entity.activeQuests) {
      const questDef = QUEST_CATALOG.find((q) => q.id === activeQuest.questId);
      if (!questDef) continue;

      if (questDef.objective.type === "gather" && gatheredItemName) {
        // Skinning quests match any corpse
        if (questDef.objective.targetItemName === "corpse" && gatheredItemName === "corpse") {
          activeQuest.progress++;
        } else if (
          questDef.objective.targetItemName &&
          gatheredItemName.toLowerCase().includes(questDef.objective.targetItemName.toLowerCase())
        ) {
          activeQuest.progress++;
        }
      }

      if (questDef.objective.type === "craft" && craftedItemName) {
        if (
          questDef.objective.targetItemName &&
          craftedItemName.toLowerCase().includes(questDef.objective.targetItemName.toLowerCase())
        ) {
          activeQuest.progress++;
        }
      }
    }
  }

  return {
    xpAwarded: xpAmount,
    totalXp: entity.xp,
    leveledUp: leveled,
    ...(leveled && { newLevel: entity.level }),
  };
}

/** Map ore/flower rarity to XP amount */
export function xpForRarity(rarity: "common" | "uncommon" | "rare" | "epic"): number {
  switch (rarity) {
    case "common": return PROFESSION_XP.GATHER_COMMON;
    case "uncommon": return PROFESSION_XP.GATHER_UNCOMMON;
    case "rare": return PROFESSION_XP.GATHER_RARE;
    case "epic": return PROFESSION_XP.GATHER_EPIC;
  }
}

// ── Failure chance ────────────────────────────────────────────────────

const MAX_FAIL_RATE = 0.40; // 40% max failure when skill barely meets requirement
const SKILL_BUFFER = 25;    // failure drops to 0% this many levels above requirement

/**
 * Calculate the chance of failing a profession action (craft, gather, etc.)
 * based on how far the player's skill exceeds the requirement.
 *
 * - At exactly the required level: 40% failure
 * - 12 levels above: ~20% failure
 * - 25+ levels above: 0% failure
 *
 * Returns a number 0..1 representing failure probability.
 */
export function calculateFailChance(currentSkill: number, requiredSkill: number): number {
  if (currentSkill >= requiredSkill + SKILL_BUFFER) return 0;
  return Math.max(0, MAX_FAIL_RATE * (1 - (currentSkill - requiredSkill) / SKILL_BUFFER));
}

/**
 * Roll against a failure chance. Returns true if the action fails.
 */
export function rollFailure(currentSkill: number, requiredSkill: number): { failed: boolean; failChance: number } {
  const failChance = calculateFailChance(currentSkill, requiredSkill);
  if (failChance <= 0) return { failed: false, failChance: 0 };
  return { failed: Math.random() < failChance, failChance: Math.round(failChance * 100) };
}
