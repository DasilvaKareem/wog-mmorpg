/**
 * Character persistence via Redis hashes.
 * Key pattern: character:{walletAddress}:{characterName}
 *
 * Local/dev can fall back to in-memory Map when Redis is not configured.
 * When Redis is configured, Redis is authoritative.
 */

import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed, scanKeys } from "../redis.js";
import { CLASS_DEFINITIONS } from "./classes.js";
import {
  deleteCharacterProjection,
  getCharacterSnapshotForWallet,
  listCharacterSnapshotsForWallet,
  upsertCharacterProjection,
} from "./characterProjectionStore.js";
import { enqueueOutboxEvent } from "../db/outbox.js";
import { replaceProfessionStateForWallet } from "../db/professionStateStore.js";
import { replaceEquipmentState } from "../db/equipmentStateStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

export type CharacterCalling = "adventurer" | "farmer" | "merchant" | "craftsman";

export interface CharacterSaveData {
  name: string;
  level: number;
  xp: number;
  characterTokenId?: string;
  agentId?: string;
  agentRegistrationTxHash?: string;
  chainRegistrationStatus?: "unregistered" | "pending_mint" | "pending_mint_receipt" | "mint_confirmed" | "identity_pending" | "registered" | "failed_retryable" | "failed_permanent";
  chainRegistrationLastError?: string;
  raceId: string;
  classId: string;
  calling?: CharacterCalling;
  gender?: string;
  skinColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  origin?: string;
  zone: string;
  x: number;
  y: number;
  kills: number;
  activeQuests?: Array<{
    questId: string;
    progress: number;
    startedAt: number;
  }>;
  completedQuests: string[];
  storyFlags: string[];
  learnedTechniques: string[];
  professions: string[];
  signatureTechniqueId?: string;
  ultimateTechniqueId?: string;
  /** Serialized equipment map — persisted as JSON string in Redis */
  equipment?: Record<string, unknown>;
  /** Per-profession skill XP/level/actions */
  professionSkills?: Record<string, { xp: number; level: number; actions: number }>;
}

export type CharacterSavePatch = {
  [K in keyof CharacterSaveData]?: CharacterSaveData[K] | null;
};

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

function parseActiveQuests(
  value: string | undefined
): Array<{ questId: string; progress: number; startedAt: number }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        questId: String((entry as any).questId ?? ""),
        progress: Number((entry as any).progress ?? 0) || 0,
        startedAt: Number((entry as any).startedAt ?? 0) || 0,
      }))
      .filter((entry) => entry.questId.length > 0);
  } catch {
    return [];
  }
}

function parseCharacter(raw: Record<string, string>): CharacterSaveData {
  return {
    name: raw.name ?? "Unknown",
    level: parseInt(raw.level ?? "1", 10) || 1,
    xp: parseInt(raw.xp ?? "0", 10) || 0,
    characterTokenId: raw.characterTokenId || undefined,
    agentId: raw.agentId || undefined,
    agentRegistrationTxHash: raw.agentRegistrationTxHash || undefined,
    chainRegistrationStatus: (raw.chainRegistrationStatus as CharacterSaveData["chainRegistrationStatus"]) || undefined,
    chainRegistrationLastError: raw.chainRegistrationLastError || undefined,
    raceId: raw.raceId ?? "human",
    classId: raw.classId ?? "warrior",
    gender: raw.gender,
    skinColor: raw.skinColor || undefined,
    hairStyle: raw.hairStyle || undefined,
    eyeColor: raw.eyeColor || undefined,
    origin: raw.origin || undefined,
    zone: raw.zone ?? "village-square",
    x: parseFloat(raw.x ?? "0"),
    y: parseFloat(raw.y ?? "0"),
    kills: parseInt(raw.kills ?? "0", 10),
    activeQuests: parseActiveQuests(raw.activeQuests),
    completedQuests: parseStringArray(raw.completedQuests),
    storyFlags: parseStringArray(raw.storyFlags),
    learnedTechniques: parseStringArray(raw.learnedTechniques),
    professions: parseStringArray(raw.professions),
    signatureTechniqueId: raw.signatureTechniqueId || undefined,
    ultimateTechniqueId: raw.ultimateTechniqueId || undefined,
    equipment: raw.equipment ? (() => { try { return JSON.parse(raw.equipment); } catch { return undefined; } })() : undefined,
  };
}

function isRenderableCharacterRecord(raw: Record<string, string>): boolean {
  const name = raw.name?.trim();
  const raceId = raw.raceId?.trim();
  const classId = raw.classId?.trim();
  return Boolean(name && raceId && classId);
}

async function resolveFallbackKey(
  walletAddress: string,
  characterName: string,
  exactKey: string
): Promise<string | null> {
  const prefix = `character:${walletAddress.toLowerCase()}:`;
  const nameCandidates = buildLookupNameCandidates(characterName);
  const normalizedCandidates = new Set(nameCandidates.map(normalizeForLookup));

  if (isMemoryFallbackAllowed()) {
    // Try in-memory keys first in local/dev fallback mode.
    for (const k of memoryStore.keys()) {
      if (!k.startsWith(prefix) || k === exactKey) continue;
      const storedName = k.slice(prefix.length);
      if (normalizedCandidates.has(normalizeForLookup(storedName))) {
        return k;
      }
    }
  }

  const redis = getRedis();
  if (!redis) {
    assertRedisAvailable("resolveFallbackKey");
    return null;
  }

  try {
    const keys: string[] = await scanKeys(`${prefix}*`);
    for (const k of keys) {
      if (k === exactKey) continue;
      const storedName = k.slice(prefix.length);
      if (normalizedCandidates.has(normalizeForLookup(storedName))) {
        return k;
      }
    }
  } catch (err) {
    if (!isMemoryFallbackAllowed()) throw err;
  }

  return null;
}

export async function saveCharacter(
  walletAddress: string,
  characterName: string,
  data: CharacterSavePatch
): Promise<void> {
  if (isPostgresConfigured()) {
    const existing = (await loadCharacter(walletAddress, characterName)) ?? ({
      name: characterName,
      level: 1,
      xp: 0,
      raceId: "human",
      classId: "warrior",
      zone: "village-square",
      x: 0,
      y: 0,
      kills: 0,
      completedQuests: [],
      storyFlags: [],
      learnedTechniques: [],
      professions: [],
    } satisfies CharacterSaveData);
    const merged: CharacterSaveData = { ...existing };
    for (const [k, v] of Object.entries(data) as Array<[keyof CharacterSaveData, CharacterSavePatch[keyof CharacterSaveData]]>) {
      if (v === undefined) continue;
      if (v === null) {
        delete (merged as Partial<CharacterSaveData>)[k];
        continue;
      }
      (merged as unknown as Record<string, unknown>)[k] = v;
    }
    await syncCharacterProjection(walletAddress, characterName, merged).catch((err) => {
      console.warn(`[characterProjection] Failed to sync ${walletAddress}:${characterName}: ${String(err?.message ?? err).slice(0, 140)}`);
    });

    const redis = getRedis();
    if (!redis) {
      return;
    }
  }

  // Flatten to string values for Redis HSET
  const flat: Record<string, string> = {};
  const fieldsToDelete: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v === null) {
      fieldsToDelete.push(k);
      continue;
    }
    flat[k] = (Array.isArray(v) || typeof v === "object") ? JSON.stringify(v) : String(v);
  }

  if (Object.keys(flat).length === 0 && fieldsToDelete.length === 0) return;

  const k = key(walletAddress, characterName);
  const redis = getRedis();

  if (redis) {
    try {
      if (Object.keys(flat).length > 0) {
        await redis.hset(k, flat);
      }
      if (fieldsToDelete.length > 0) {
        await redis.hdel(k, ...fieldsToDelete);
      }
      await syncCharacterProjection(walletAddress, characterName).catch((err) => {
        console.warn(`[characterProjection] Failed to sync ${walletAddress}:${characterName}: ${String(err?.message ?? err).slice(0, 140)}`);
      });
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  }

  assertRedisAvailable("saveCharacter");
  const existing = memoryStore.get(k) ?? {};
  const next = { ...existing, ...flat };
  for (const field of fieldsToDelete) {
    delete next[field];
  }
  memoryStore.set(k, next);
  await syncCharacterProjection(walletAddress, characterName).catch((err) => {
    console.warn(`[characterProjection] Failed to sync ${walletAddress}:${characterName}: ${String(err?.message ?? err).slice(0, 140)}`);
  });
}

export async function loadCharacter(
  walletAddress: string,
  characterName: string
): Promise<CharacterSaveData | null> {
  if (isPostgresConfigured()) {
    const snapshot = await getCharacterSnapshotForWallet(walletAddress, characterName);
    if (snapshot && Object.keys(snapshot).length > 0) {
      return snapshot as unknown as CharacterSaveData;
    }
  }
  let raw: Record<string, string> = {};
  const k = key(walletAddress, characterName);
  let resolvedKey = k;

  // Try Redis first.
  const redis = isPostgresConfigured() ? null : getRedis();
  if (redis) {
    try {
      raw = await redis.hgetall(resolvedKey);
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("loadCharacter");
    }
  }

  // Fall back to in-memory only in local/dev mode.
  if (isMemoryFallbackAllowed() && (!raw || Object.keys(raw).length === 0)) {
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
        } catch (err) {
          if (!isMemoryFallbackAllowed()) throw err;
        }
      }
      if (isMemoryFallbackAllowed() && (!raw || Object.keys(raw).length === 0)) {
        raw = memoryStore.get(resolvedKey) ?? {};
      }
      if (Object.keys(raw).length > 0) {
        console.log(`[persistence] Character alias restore matched key "${resolvedKey}" for lookup "${characterName}"`);
      }
    }
  }

  // Empty hash = no saved character
  if (Object.keys(raw).length === 0) return null;
  if (!isRenderableCharacterRecord(raw)) return null;

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
  if (isPostgresConfigured()) {
    const snapshots = await listCharacterSnapshotsForWallet(walletAddress);
    if (snapshots.length > 0) {
      return snapshots as unknown as CharacterSaveData[];
    }
  }
  const prefix = `character:${walletAddress.toLowerCase()}:`;
  const seen = new Set<string>();
  const results: CharacterSaveData[] = [];

  const redis = isPostgresConfigured() ? null : getRedis();
  if (redis) {
    try {
      const keys: string[] = await scanKeys(`${prefix}*`);
      for (const k of keys) {
        const raw = await redis.hgetall(k);
        if (raw && Object.keys(raw).length > 0 && isRenderableCharacterRecord(raw)) {
          const parsed = parseCharacter(raw);
          seen.add(k);
          results.push(parsed);
        }
      }
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("loadAllCharactersForWallet");
    }
  }

  if (isMemoryFallbackAllowed()) {
    for (const [k, raw] of memoryStore.entries()) {
      if (!k.startsWith(prefix) || seen.has(k)) continue;
      if (raw && Object.keys(raw).length > 0 && isRenderableCharacterRecord(raw)) {
        results.push(parseCharacter(raw));
      }
    }
  }

  return results;
}

/**
 * Scan for learned professions by wallet address without knowing the character name.
 * Used by the professions endpoint to serve offline champions.
 */
export async function getProfessionsForWallet(walletAddress: string): Promise<string[]> {
  if (isPostgresConfigured()) {
    const snapshots = await listCharacterSnapshotsForWallet(walletAddress);
    for (const snapshot of snapshots) {
      const professions = Array.isArray(snapshot.professions) ? snapshot.professions.map(String) : [];
      if (professions.length > 0) return professions;
    }
  }
  const prefix = `character:${walletAddress.toLowerCase()}:`;

  // Try Redis scan first
  const redis = isPostgresConfigured() ? null : getRedis();
  if (redis) {
    try {
      const keys: string[] = await scanKeys(`${prefix}*`);
      for (const k of keys) {
        const data: Record<string, string> = await redis.hgetall(k);
        if (data?.professions) {
          return JSON.parse(data.professions) as string[];
        }
      }
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("getProfessionsForWallet");
    }
  }

  // In-memory fallback (local/dev only)
  if (isMemoryFallbackAllowed()) {
    for (const [k, data] of memoryStore.entries()) {
      if (k.startsWith(prefix) && data.professions) {
        return JSON.parse(data.professions) as string[];
      }
    }
  }

  return [];
}

export async function deleteCharacter(walletAddress: string, characterName: string): Promise<void> {
  const k = key(walletAddress, characterName);
  if (isPostgresConfigured()) {
    await deleteCharacterProjection({ walletAddress, characterName }).catch((err) => {
      console.warn(`[characterProjection] Failed to delete ${walletAddress}:${characterName}: ${String(err?.message ?? err).slice(0, 140)}`);
    });
    const redis = getRedis();
    if (!redis) {
      return;
    }
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(k);
      await deleteCharacterProjection({ walletAddress, characterName }).catch((err) => {
        console.warn(`[characterProjection] Failed to delete ${walletAddress}:${characterName}: ${String(err?.message ?? err).slice(0, 140)}`);
      });
      if (isMemoryFallbackAllowed()) {
        memoryStore.delete(k);
      }
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  }

  if (!isPostgresConfigured()) {
    assertRedisAvailable("deleteCharacter");
  }
  memoryStore.delete(k);
  await deleteCharacterProjection({ walletAddress, characterName }).catch((err) => {
    console.warn(`[characterProjection] Failed to delete ${walletAddress}:${characterName}: ${String(err?.message ?? err).slice(0, 140)}`);
  });
}

async function syncCharacterProjection(walletAddress: string, characterName: string, savedOverride?: CharacterSaveData): Promise<void> {
  const saved = savedOverride ?? await loadCharacter(walletAddress, characterName);
  if (!saved) {
    await deleteCharacterProjection({ walletAddress, characterName });
    return;
  }

  await upsertCharacterProjection({
    walletAddress,
    character: {
      name: saved.name,
      classId: saved.classId,
      raceId: saved.raceId,
      level: saved.level,
      xp: saved.xp,
      characterTokenId: saved.characterTokenId ?? null,
      agentId: saved.agentId ?? null,
      agentRegistrationTxHash: saved.agentRegistrationTxHash ?? null,
      chainRegistrationStatus: saved.chainRegistrationStatus ?? null,
      chainRegistrationLastError: saved.chainRegistrationLastError ?? null,
      zone: saved.zone,
      calling: saved.calling,
      gender: saved.gender,
      skinColor: saved.skinColor,
      hairStyle: saved.hairStyle,
      eyeColor: saved.eyeColor,
      origin: saved.origin,
    },
  });

  await enqueueOutboxEvent({
    topic: "character.saved",
    aggregateType: "character",
    aggregateKey: `${walletAddress.toLowerCase()}:${saved.name.toLowerCase()}:${saved.classId}`,
    payload: {
      walletAddress: walletAddress.toLowerCase(),
      characterName: saved.name,
      classId: saved.classId,
      raceId: saved.raceId,
      level: saved.level,
      xp: saved.xp,
      characterTokenId: saved.characterTokenId ?? null,
      agentId: saved.agentId ?? null,
      chainRegistrationStatus: saved.chainRegistrationStatus ?? null,
      zoneId: saved.zone,
    },
  }).catch((err) => {
    console.warn(`[outbox] Failed to enqueue character.saved for ${walletAddress}:${saved.name}: ${String(err?.message ?? err).slice(0, 140)}`);
  });

  await replaceProfessionStateForWallet({
    walletAddress,
    professions: saved.professions ?? [],
    skills: saved.professionSkills ?? {},
  }).catch((err) => {
    console.warn(`[professionState] Failed to sync ${walletAddress}: ${String(err?.message ?? err).slice(0, 140)}`);
  });

  await replaceEquipmentState({
    walletAddress,
    characterName: saved.name,
    equipment: saved.equipment,
  }).catch((err) => {
    console.warn(`[equipmentState] Failed to sync ${walletAddress}:${saved.name}: ${String(err?.message ?? err).slice(0, 140)}`);
  });
}
