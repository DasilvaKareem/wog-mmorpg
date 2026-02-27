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

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
};

const RESTRICTED_TOKEN_PATTERNS: RegExp[] = [
  /^fag(s|got|gots|gy)?$/,
  /^nigg(er|ers|a|as)?$/,
  /^bitch(es|y)?$/,
  /^fuck(s|er|ers|ing|ed)?$/,
  /^chink(s)?$/,
  /^spic(s)?$/,
  /^kike(s)?$/,
  /^wetback(s)?$/,
  /^beaner(s)?$/,
  /^gook(s)?$/,
  /^coon(s)?$/,
  /^raghead(s)?$/,
  /^towelhead(s)?$/,
];

const RESTRICTED_COMPACT_SUBSTRINGS = [
  "nigger",
  "nigga",
  "faggot",
  "bitch",
  "fuck",
  "wetback",
  "beaner",
  "towelhead",
  "raghead",
  "chink",
  "spic",
  "kike",
];

function normalizeToken(token: string): string {
  const lowered = token.toLowerCase();
  let out = "";
  for (const ch of lowered) {
    const mapped = LEET_MAP[ch] ?? ch;
    if (mapped >= "a" && mapped <= "z") out += mapped;
  }
  return out;
}

function containsRestrictedLanguage(name: string): boolean {
  const tokens = name
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  if (tokens.length === 0) return false;

  for (const token of tokens) {
    if (RESTRICTED_TOKEN_PATTERNS.some((pattern) => pattern.test(token))) {
      return true;
    }
  }

  const compact = tokens.join("");
  return RESTRICTED_COMPACT_SUBSTRINGS.some((w) => compact.includes(w));
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

  if (containsRestrictedLanguage(name)) {
    return "Name contains restricted language";
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
