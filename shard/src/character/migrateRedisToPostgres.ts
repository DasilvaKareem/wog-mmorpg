/**
 * One-time migration: copies all character saves AND item instances from Redis
 * into the Postgres game.* tables.
 *
 * Safe to run multiple times — all upserts use ON CONFLICT.
 */

import { getRedis } from "../redis.js";
import { isPostgresConfigured } from "../db/postgres.js";
import { upsertCharacterProjection } from "./characterProjectionStore.js";
import type { CharacterSaveData } from "./characterStore.js";
import { upsertCraftedItemInstance } from "../db/itemInstanceStore.js";
import { replaceProfessionStateForWallet } from "../db/professionStateStore.js";
import { replaceEquipmentState } from "../db/equipmentStateStore.js";

interface MigrationResult {
  characters: { migrated: number; skipped: number; errors: number };
  items: { migrated: number; skipped: number; errors: number };
}

export async function migrateRedisToPostgres(): Promise<MigrationResult> {
  if (!isPostgresConfigured()) {
    console.log("[migrate] Postgres not configured — skipping migration");
    return { characters: { migrated: 0, skipped: 0, errors: 0 }, items: { migrated: 0, skipped: 0, errors: 0 } };
  }

  const redis = getRedis();
  if (!redis) {
    console.log("[migrate] Redis not connected — skipping migration");
    return { characters: { migrated: 0, skipped: 0, errors: 0 }, items: { migrated: 0, skipped: 0, errors: 0 } };
  }

  const characters = await migrateCharacters(redis);
  const items = await migrateItemInstances(redis);

  return { characters, items };
}

// Keep old export name for backward compat with server.ts
export const migrateRedisCharactersToPostgres = migrateRedisToPostgres;

// ── Characters ─────────────────────────────────────────────────────────────

function hasRenderableCharacterFields(name: string, raw: Record<string, string>): boolean {
  return Boolean(name.trim() && raw.raceId?.trim() && raw.classId?.trim());
}

function parseStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => String(entry));
  } catch {
    return [];
  }
}

function parseActiveQuests(value: string | undefined): CharacterSaveData["activeQuests"] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        questId: String((entry as { questId?: unknown }).questId ?? ""),
        progress: Number((entry as { progress?: unknown }).progress ?? 0) || 0,
        startedAt: Number((entry as { startedAt?: unknown }).startedAt ?? 0) || 0,
      }))
      .filter((entry) => entry.questId.length > 0);
  } catch {
    return [];
  }
}

function parseProfessionSkills(
  value: string | undefined
): NonNullable<CharacterSaveData["professionSkills"]> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const skills: NonNullable<CharacterSaveData["professionSkills"]> = {};
    for (const [professionId, rawSkill] of Object.entries(parsed)) {
      if (!rawSkill || typeof rawSkill !== "object" || Array.isArray(rawSkill)) continue;
      skills[professionId] = {
        xp: Math.max(0, Number((rawSkill as { xp?: unknown }).xp ?? 0) || 0),
        level: Math.max(1, Number((rawSkill as { level?: unknown }).level ?? 1) || 1),
        actions: Math.max(0, Number((rawSkill as { actions?: unknown }).actions ?? 0) || 0),
      };
    }
    return skills;
  } catch {
    return {};
  }
}

function parseEquipment(value: string | undefined): CharacterSaveData["equipment"] {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as CharacterSaveData["equipment"]
      : undefined;
  } catch {
    return undefined;
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function buildCharacterSnapshot(name: string, raw: Record<string, string>): CharacterSaveData {
  const raceId = raw.raceId?.trim();
  const classId = raw.classId?.trim();
  if (!hasRenderableCharacterFields(name, raw) || !raceId || !classId) {
    throw new Error(`incomplete character record for "${name}"`);
  }
  return {
    name,
    level: Math.max(1, parseInt(raw.level ?? "1", 10) || 1),
    xp: Math.max(0, parseInt(raw.xp ?? "0", 10) || 0),
    characterTokenId: raw.characterTokenId || undefined,
    agentId: raw.agentId || undefined,
    agentRegistrationTxHash: raw.agentRegistrationTxHash || undefined,
    chainRegistrationStatus: raw.chainRegistrationStatus as CharacterSaveData["chainRegistrationStatus"] | undefined,
    chainRegistrationLastError: raw.chainRegistrationLastError || undefined,
    raceId,
    classId,
    calling: raw.calling as CharacterSaveData["calling"] | undefined,
    gender: raw.gender || undefined,
    skinColor: raw.skinColor || undefined,
    hairStyle: raw.hairStyle || undefined,
    eyeColor: raw.eyeColor || undefined,
    origin: raw.origin || undefined,
    zone: raw.zone || "village-square",
    x: Number(raw.x ?? "0") || 0,
    y: Number(raw.y ?? "0") || 0,
    kills: Math.max(0, parseInt(raw.kills ?? "0", 10) || 0),
    activeQuests: parseActiveQuests(raw.activeQuests),
    completedQuests: parseStringArray(raw.completedQuests),
    storyFlags: parseStringArray(raw.storyFlags),
    learnedTechniques: parseStringArray(raw.learnedTechniques),
    professions: parseStringArray(raw.professions),
    runEnergy: raw.runEnergy != null ? Number(raw.runEnergy) || 0 : undefined,
    maxRunEnergy: raw.maxRunEnergy != null ? Number(raw.maxRunEnergy) || 0 : undefined,
    runModeEnabled: parseBoolean(raw.runModeEnabled),
    signatureTechniqueId: raw.signatureTechniqueId || undefined,
    ultimateTechniqueId: raw.ultimateTechniqueId || undefined,
    equipment: parseEquipment(raw.equipment),
    professionSkills: parseProfessionSkills(raw.professionSkills),
  };
}

async function syncDerivedCharacterState(walletAddress: string, snapshot: CharacterSaveData): Promise<void> {
  await replaceProfessionStateForWallet({
    walletAddress,
    professions: snapshot.professions ?? [],
    skills: snapshot.professionSkills ?? {},
  });
  await replaceEquipmentState({
    walletAddress,
    characterName: snapshot.name,
    equipment: snapshot.equipment,
  });
}

async function migrateCharacters(redis: ReturnType<typeof getRedis> & object) {
  console.log("[migrate] Migrating characters...");

  const allKeys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "character:0x*:*", "COUNT", 200);
    cursor = nextCursor;
    for (const k of keys) {
      if (k.includes(":index:") || k.includes(":bootstrap:")) continue;
      allKeys.push(k);
    }
  } while (cursor !== "0");

  console.log(`[migrate] Found ${allKeys.length} character records in Redis`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const key of allKeys) {
    try {
      const parts = key.split(":");
      if (parts.length < 3) { skipped++; continue; }
      const walletAddress = parts[1];
      if (!walletAddress.startsWith("0x")) { skipped++; continue; }

      const raw = await redis.hgetall(key);
      if (!raw || Object.keys(raw).length === 0) { skipped++; continue; }

      const charName = parts.slice(2).join(":");
      const name = raw.name || charName;
      if (!name) { skipped++; continue; }
      if (!hasRenderableCharacterFields(name, raw)) { skipped++; continue; }
      const snapshot = buildCharacterSnapshot(name, raw);

      await upsertCharacterProjection({
        walletAddress,
        character: {
          name: snapshot.name,
          classId: snapshot.classId,
          raceId: snapshot.raceId,
          level: snapshot.level,
          xp: snapshot.xp,
          characterTokenId: snapshot.characterTokenId ?? null,
          agentId: snapshot.agentId ?? null,
          agentRegistrationTxHash: snapshot.agentRegistrationTxHash ?? null,
          chainRegistrationStatus: snapshot.chainRegistrationStatus ?? null,
          chainRegistrationLastError: snapshot.chainRegistrationLastError ?? null,
          zone: snapshot.zone,
          calling: snapshot.calling,
          gender: snapshot.gender,
          skinColor: snapshot.skinColor,
          hairStyle: snapshot.hairStyle,
          eyeColor: snapshot.eyeColor,
          origin: snapshot.origin,
        },
        fullSnapshot: snapshot as unknown as Record<string, unknown>,
        source: "redis-migration",
      });
      await syncDerivedCharacterState(walletAddress, snapshot);
      migrated++;
    } catch (err: any) {
      errors++;
      if (errors <= 5) console.warn(`[migrate] Character ${key}: ${err.message?.slice(0, 100)}`);
    }
  }

  console.log(`[migrate] Characters: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
  return { migrated, skipped, errors };
}

// ── Item instances ─────────────────────────────────────────────────────────

async function migrateItemInstances(redis: ReturnType<typeof getRedis> & object) {
  console.log("[migrate] Migrating item instances...");

  // Get all instance IDs from the set
  const ids = await redis.smembers("itemrng:instances");
  if (!Array.isArray(ids) || ids.length === 0) {
    // Try scanning for individual keys instead
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, found] = await redis.scan(cursor, "MATCH", "itemrng:instance:*", "COUNT", 200);
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== "0");

    if (keys.length === 0) {
      console.log("[migrate] No item instances found in Redis");
      return { migrated: 0, skipped: 0, errors: 0 };
    }

    console.log(`[migrate] Found ${keys.length} item instance keys via scan`);
    return migrateItemKeys(redis, keys);
  }

  console.log(`[migrate] Found ${ids.length} item instance IDs in set`);
  const keys = ids.map((id: string) => `itemrng:instance:${id}`);
  return migrateItemKeys(redis, keys);
}

async function migrateItemKeys(redis: ReturnType<typeof getRedis> & object, keys: string[]) {
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches of 50 to avoid overwhelming postgres
  for (let i = 0; i < keys.length; i += 50) {
    const batch = keys.slice(i, i + 50);
    const payloads = await redis.mget(batch);

    for (let j = 0; j < batch.length; j++) {
      const raw = payloads?.[j];
      if (!raw) { skipped++; continue; }

      try {
        const instance = JSON.parse(raw);
        if (!instance.instanceId || !instance.ownerWallet) { skipped++; continue; }
        await upsertCraftedItemInstance(instance);
        migrated++;
      } catch (err: any) {
        errors++;
        if (errors <= 5) console.warn(`[migrate] Item ${batch[j]}: ${err.message?.slice(0, 100)}`);
      }
    }
  }

  console.log(`[migrate] Items: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
  return { migrated, skipped, errors };
}
