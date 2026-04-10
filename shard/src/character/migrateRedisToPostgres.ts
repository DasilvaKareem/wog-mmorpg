/**
 * One-time migration: copies all character saves from Redis into the
 * Postgres game.characters + game.character_projections tables.
 *
 * Safe to run multiple times — upsertCharacterProjection uses ON CONFLICT.
 * Skips characters that already exist in postgres.
 */

import { getRedis } from "../redis.js";
import { isPostgresConfigured } from "../db/postgres.js";
import { upsertCharacterProjection } from "./characterProjectionStore.js";

export async function migrateRedisCharactersToPostgres(): Promise<{ migrated: number; skipped: number; errors: number }> {
  if (!isPostgresConfigured()) {
    console.log("[migrate] Postgres not configured — skipping Redis→Postgres migration");
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  const redis = getRedis();
  if (!redis) {
    console.log("[migrate] Redis not connected — skipping migration");
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  console.log("[migrate] Starting Redis → Postgres character migration...");

  // Find all character keys (format: character:{wallet}:{name})
  const allKeys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "character:0x*:*", "COUNT", 200);
    cursor = nextCursor;
    for (const k of keys) {
      // Skip index/bootstrap/lookup keys
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
      // Parse key: character:{wallet}:{name}
      const parts = key.split(":");
      if (parts.length < 3) { skipped++; continue; }
      const walletAddress = parts[1];
      const charName = parts.slice(2).join(":"); // name might contain colons

      if (!walletAddress.startsWith("0x")) { skipped++; continue; }

      // Read the hash from Redis
      const raw = await redis.hgetall(key);
      if (!raw || Object.keys(raw).length === 0) { skipped++; continue; }
      if (!raw.name && !charName) { skipped++; continue; }

      const name = raw.name || charName;
      const classId = raw.classId || "warrior";
      const raceId = raw.raceId || "human";
      const level = parseInt(raw.level ?? "1", 10) || 1;
      const xp = parseInt(raw.xp ?? "0", 10) || 0;

      await upsertCharacterProjection({
        walletAddress,
        character: {
          name,
          classId,
          raceId,
          level,
          xp,
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
      console.warn(`[migrate] Failed to migrate ${key}: ${err.message?.slice(0, 100)}`);
    }
  }

  console.log(`[migrate] Done: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
  return { migrated, skipped, errors };
}
