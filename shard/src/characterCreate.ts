import type { CharacterStats } from "./classes.js";
import { getClassById } from "./classes.js";
import { getRaceById } from "./races.js";
import type { RaceDefinition } from "./races.js";
import type { ClassDefinition } from "./classes.js";
import { computeStatsAtLevel } from "./leveling.js";

export interface ComputedCharacter {
  name: string;
  race: RaceDefinition;
  class: ClassDefinition;
  level: number;
  stats: CharacterStats;
}

export function validateCharacterInput(input: {
  walletAddress?: string;
  name?: string;
  race?: string;
  className?: string;
}): string | null {
  const { walletAddress, name, race, className } = input;

  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return "Invalid wallet address";
  }

  if (!name || name.length < 2 || name.length > 24 || !/^[a-zA-Z0-9 ]+$/.test(name)) {
    return "Name must be 2-24 alphanumeric characters (spaces allowed)";
  }

  if (!race || !getRaceById(race)) {
    return `Unknown race: ${race}`;
  }

  if (!className || !getClassById(className)) {
    return `Unknown class: ${className}`;
  }

  return null;
}

export function computeCharacter(
  name: string,
  raceId: string,
  classId: string
): ComputedCharacter {
  const race = getRaceById(raceId)!;
  const classDef = getClassById(classId)!;

  const stats = computeStatsAtLevel(raceId, classId, 1);

  return {
    name,
    race,
    class: classDef,
    level: 1,
    stats,
  };
}
