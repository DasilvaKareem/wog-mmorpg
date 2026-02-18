/**
 * Profession XP System
 * Awards character XP for gathering, crafting, cooking, brewing, skinning, etc.
 * Also tracks quest progress for "gather" and "craft" quest types.
 */

import { xpForLevel, MAX_LEVEL, computeStatsAtLevel } from "./leveling.js";
import { recalculateEntityVitals, type Entity, getAllZones } from "./zoneRuntime.js";
import { logZoneEvent } from "./zoneEvents.js";
import { saveCharacter } from "./characterStore.js";
import { logDiary, narrativeLevelUp } from "./diary.js";
import { QUEST_CATALOG } from "./questSystem.js";

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

  // Add XP
  entity.xp = (entity.xp ?? 0) + xpAmount;

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

  // Persist character
  if (entity.walletAddress && entity.name) {
    saveCharacter(entity.walletAddress, entity.name, {
      level: entity.level,
      xp: entity.xp,
      kills: entity.kills,
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
