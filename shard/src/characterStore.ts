/**
 * Character persistence via Redis hashes.
 * Key pattern: character:{walletAddress}:{characterName}
 *
 * Falls back to in-memory Map when Redis is unavailable or errors.
 */

import { getRedis } from "./redis.js";

export interface CharacterSaveData {
  name: string;
  level: number;
  xp: number;
  raceId: string;
  classId: string;
  gender?: string;
  zone: string;
  x: number;
  y: number;
  kills: number;
  completedQuests: string[];
  learnedTechniques: string[];
  professions: string[];
  signatureTechniqueId?: string;
  ultimateTechniqueId?: string;
}

// In-memory fallback (always available)
const memoryStore = new Map<string, Record<string, string>>();

function key(walletAddress: string, characterName: string): string {
  return `character:${walletAddress.toLowerCase()}:${characterName}`;
}

export async function saveCharacter(
  walletAddress: string,
  characterName: string,
  data: Partial<CharacterSaveData>
): Promise<void> {
  // Flatten to string values for Redis HSET
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    flat[k] = Array.isArray(v) ? JSON.stringify(v) : String(v);
  }

  if (Object.keys(flat).length === 0) return;

  const k = key(walletAddress, characterName);

  // Always write to in-memory
  const existing = memoryStore.get(k) ?? {};
  memoryStore.set(k, { ...existing, ...flat });

  // Try Redis too
  const redis = getRedis();
  if (redis) {
    try {
      await redis.hset(k, flat);
    } catch {
      // Redis failed, in-memory already has the data
    }
  }
}

export async function loadCharacter(
  walletAddress: string,
  characterName: string
): Promise<CharacterSaveData | null> {
  let raw: Record<string, string> = {};

  const k = key(walletAddress, characterName);

  // Try Redis first
  const redis = getRedis();
  if (redis) {
    try {
      raw = await redis.hgetall(k);
    } catch {
      // Redis failed, fall through to in-memory
    }
  }

  // Fall back to in-memory if Redis returned nothing
  if (!raw || Object.keys(raw).length === 0) {
    raw = memoryStore.get(k) ?? {};
  }

  // Empty hash = no saved character
  if (Object.keys(raw).length === 0) return null;

  return {
    name: raw.name ?? "Unknown",
    level: parseInt(raw.level ?? "1", 10),
    xp: parseInt(raw.xp ?? "0", 10),
    raceId: raw.raceId ?? "human",
    classId: raw.classId ?? "warrior",
    gender: raw.gender,
    zone: raw.zone ?? "village-square",
    x: parseFloat(raw.x ?? "0"),
    y: parseFloat(raw.y ?? "0"),
    kills: parseInt(raw.kills ?? "0", 10),
    completedQuests: raw.completedQuests ? JSON.parse(raw.completedQuests) : [],
    learnedTechniques: raw.learnedTechniques ? JSON.parse(raw.learnedTechniques) : [],
    professions: raw.professions ? JSON.parse(raw.professions) : [],
    signatureTechniqueId: raw.signatureTechniqueId || undefined,
    ultimateTechniqueId: raw.ultimateTechniqueId || undefined,
  };
}

/**
 * Scan for learned professions by wallet address without knowing the character name.
 * Used by the professions endpoint to serve offline champions.
 */
export async function getProfessionsForWallet(walletAddress: string): Promise<string[]> {
  const prefix = `character:${walletAddress.toLowerCase()}:`;

  // Try Redis scan first
  const redis = getRedis();
  if (redis) {
    try {
      const keys: string[] = await redis.keys(`${prefix}*`);
      for (const k of keys) {
        const data: Record<string, string> = await redis.hgetall(k);
        if (data?.professions) {
          return JSON.parse(data.professions) as string[];
        }
      }
    } catch {
      // fall through to in-memory
    }
  }

  // In-memory fallback
  for (const [k, data] of memoryStore.entries()) {
    if (k.startsWith(prefix) && data.professions) {
      return JSON.parse(data.professions) as string[];
    }
  }

  return [];
}

export async function deleteCharacter(walletAddress: string, characterName: string): Promise<void> {
  const k = key(walletAddress, characterName);
  memoryStore.delete(k);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(k);
    } catch {
      // Redis failed, in-memory already cleared
    }
  }
}
