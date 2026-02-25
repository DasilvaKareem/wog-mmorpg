/**
 * Character persistence via Redis hashes.
 * Key pattern: character:{walletAddress}:{characterName}
 *
 * Falls back to in-memory Map when Redis is unavailable or errors.
 */

import { getRedis } from "./redis.js";
import { CLASS_DEFINITIONS } from "./classes.js";

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
const CLASS_SUFFIXES = CLASS_DEFINITIONS.map((c) => c.name.toLowerCase());

function key(walletAddress: string, characterName: string): string {
  return `character:${walletAddress.toLowerCase()}:${characterName}`;
}

function collapseWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function stripKnownClassSuffix(input: string): string {
  const collapsed = collapseWhitespace(input);
  const lower = collapsed.toLowerCase();
  for (const className of CLASS_SUFFIXES) {
    const suffix = ` the ${className}`;
    if (lower.endsWith(suffix)) {
      return collapsed.slice(0, collapsed.length - suffix.length).trim();
    }
  }
  return collapsed;
}

function buildLookupNameCandidates(characterName: string): string[] {
  const candidates: string[] = [];
  const add = (v: string) => {
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  const collapsed = collapseWhitespace(characterName);
  add(characterName);
  add(collapsed);

  const stripped = stripKnownClassSuffix(collapsed);
  add(stripped);
  add(collapseWhitespace(stripped));

  return candidates;
}

function normalizeForLookup(input: string): string {
  return stripKnownClassSuffix(input).toLowerCase();
}

function parseStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v));
  } catch {
    return [];
  }
}

function parseCharacter(raw: Record<string, string>): CharacterSaveData {
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
    completedQuests: parseStringArray(raw.completedQuests),
    learnedTechniques: parseStringArray(raw.learnedTechniques),
    professions: parseStringArray(raw.professions),
    signatureTechniqueId: raw.signatureTechniqueId || undefined,
    ultimateTechniqueId: raw.ultimateTechniqueId || undefined,
  };
}

async function resolveFallbackKey(
  walletAddress: string,
  characterName: string,
  exactKey: string
): Promise<string | null> {
  const prefix = `character:${walletAddress.toLowerCase()}:`;
  const nameCandidates = buildLookupNameCandidates(characterName);
  const normalizedCandidates = new Set(nameCandidates.map(normalizeForLookup));

  // Try in-memory keys first.
  for (const k of memoryStore.keys()) {
    if (!k.startsWith(prefix) || k === exactKey) continue;
    const storedName = k.slice(prefix.length);
    if (normalizedCandidates.has(normalizeForLookup(storedName))) {
      return k;
    }
  }

  const redis = getRedis();
  if (!redis) return null;

  try {
    const keys: string[] = await redis.keys(`${prefix}*`);
    for (const k of keys) {
      if (k === exactKey) continue;
      const storedName = k.slice(prefix.length);
      if (normalizedCandidates.has(normalizeForLookup(storedName))) {
        return k;
      }
    }
  } catch {
    // Redis scan failed, ignore and keep default behavior.
  }

  return null;
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
  let resolvedKey = k;

  // Try Redis first
  const redis = getRedis();
  if (redis) {
    try {
      raw = await redis.hgetall(resolvedKey);
    } catch {
      // Redis failed, fall through to in-memory
    }
  }

  // Fall back to in-memory if Redis returned nothing
  if (!raw || Object.keys(raw).length === 0) {
    raw = memoryStore.get(resolvedKey) ?? {};
  }

  // Alias fallback: tolerate "Name" vs "Name the Class" style lookups.
  if (!raw || Object.keys(raw).length === 0) {
    const fallbackKey = await resolveFallbackKey(walletAddress, characterName, k);
    if (fallbackKey) {
      resolvedKey = fallbackKey;
      if (redis) {
        try {
          raw = await redis.hgetall(resolvedKey);
        } catch {
          // Redis failed, fall through to in-memory
        }
      }
      if (!raw || Object.keys(raw).length === 0) {
        raw = memoryStore.get(resolvedKey) ?? {};
      }
      if (Object.keys(raw).length > 0) {
        console.log(`[persistence] Character alias restore matched key "${resolvedKey}" for lookup "${characterName}"`);
      }
    }
  }

  // Empty hash = no saved character
  if (Object.keys(raw).length === 0) return null;

  return parseCharacter(raw);
}

/**
 * Load any saved character for a wallet when the name is unknown.
 * Useful for boot-time rehydration fallbacks.
 */
export async function loadAnyCharacterForWallet(
  walletAddress: string
): Promise<CharacterSaveData | null> {
  const all = await loadAllCharactersForWallet(walletAddress);
  return all.length > 0 ? all[0] : null;
}

/**
 * Load ALL saved characters for a wallet.
 * Used as a fallback when on-chain NFT enumeration is unavailable.
 */
export async function loadAllCharactersForWallet(
  walletAddress: string
): Promise<CharacterSaveData[]> {
  const prefix = `character:${walletAddress.toLowerCase()}:`;
  const seen = new Set<string>();
  const results: CharacterSaveData[] = [];

  const redis = getRedis();
  if (redis) {
    try {
      const keys: string[] = await redis.keys(`${prefix}*`);
      for (const k of keys) {
        const raw = await redis.hgetall(k);
        if (raw && Object.keys(raw).length > 0) {
          const parsed = parseCharacter(raw);
          seen.add(k);
          results.push(parsed);
        }
      }
    } catch {
      // Redis read failed; try in-memory fallback.
    }
  }

  for (const [k, raw] of memoryStore.entries()) {
    if (!k.startsWith(prefix) || seen.has(k)) continue;
    if (raw && Object.keys(raw).length > 0) {
      results.push(parseCharacter(raw));
    }
  }

  return results;
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
