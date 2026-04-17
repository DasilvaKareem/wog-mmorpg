/**
 * One-time migration: copies all character saves AND item instances from Redis
 * into the Postgres game.* tables.
 *
 * Safe to run multiple times — all upserts use ON CONFLICT.
 */

import { getRedis } from "../redis.js";
import { isPostgresConfigured } from "../db/postgres.js";
import { upsertCharacterProjection } from "./characterProjectionStore.js";
import { upsertCraftedItemInstance } from "../db/itemInstanceStore.js";

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

      await upsertCharacterProjection({
        walletAddress,
        character: {
          name,
          classId: raw.classId || "warrior",
          raceId: raw.raceId || "human",
          level: parseInt(raw.level ?? "1", 10) || 1,
          xp: parseInt(raw.xp ?? "0", 10) || 0,
          characterTokenId: raw.characterTokenId || null,
          agentId: raw.agentId || null,
          agentRegistrationTxHash: raw.agentRegistrationTxHash || null,
          chainRegistrationStatus: raw.chainRegistrationStatus || null,
          zone: raw.zone || "village-square",
          calling: raw.calling || undefined,
          gender: raw.gender || undefined,
          skinColor: raw.skinColor || undefined,
          hairStyle: raw.hairStyle || undefined,
          eyeColor: raw.eyeColor || undefined,
          origin: raw.origin || undefined,
        },
        source: "redis-migration",
      });
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
