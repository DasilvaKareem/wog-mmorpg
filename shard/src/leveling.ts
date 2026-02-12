import type { CharacterStats } from "./classes.js";
import { getClassById } from "./classes.js";
import { getRaceById } from "./races.js";

export const MAX_LEVEL = 60;
export const GROWTH_RATE = 0.02;

/** Cumulative XP required to reach a given level. L1 = 0. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 100 * level * level;
}

/** XP remaining until the next level-up. Returns 0 at max level. */
export function xpToNextLevel(currentLevel: number, currentXp: number): number {
  if (currentLevel >= MAX_LEVEL) return 0;
  return Math.max(0, xpForLevel(currentLevel + 1) - currentXp);
}

/**
 * Compute character stats at a given level.
 * Applies race modifiers to class base stats, then scales by 1 + 0.02 * (level - 1).
 */
export function computeStatsAtLevel(
  raceId: string,
  classId: string,
  level: number,
): CharacterStats {
  const race = getRaceById(raceId)!;
  const classDef = getClassById(classId)!;
  const scale = 1 + GROWTH_RATE * (level - 1);

  return {
    str: Math.round(classDef.baseStats.str * race.statModifiers.str * scale),
    def: Math.round(classDef.baseStats.def * race.statModifiers.def * scale),
    hp: Math.round(classDef.baseStats.hp * race.statModifiers.hp * scale),
    agi: Math.round(classDef.baseStats.agi * race.statModifiers.agi * scale),
    int: Math.round(classDef.baseStats.int * race.statModifiers.int * scale),
    mp: Math.round(classDef.baseStats.mp * race.statModifiers.mp * scale),
    faith: Math.round(classDef.baseStats.faith * race.statModifiers.faith * scale),
    luck: Math.round(classDef.baseStats.luck * race.statModifiers.luck * scale),
  };
}
