/**
 * Character rental activation and enforcement.
 *
 * When a rental grant for a character is activated:
 *  1. Load the character save from the owner's wallet
 *  2. Spawn it into the renter's current zone
 *  3. Auto-add to the renter's party
 *  4. Block owner commands for the duration
 *  5. On expiry: save XP/kills back to owner, despawn, remove from party
 */

import { getRedis } from "../redis.js";
import { loadCharacter, saveCharacter } from "../character/characterStore.js";
import {
  getEntity,
  getAllEntities,
  getOrCreateZone,
  recalculateEntityVitals,
  unregisterSpawnedWallet,
  type Entity,
} from "../world/zoneRuntime.js";
import { randomUUID } from "crypto";
import { getRentalGrant, type RentalGrant } from "./rentService.js";

// ── Redis Keys ──────────────────────────────────────────────────────

const KEY_RENTAL_ENTITY = (grantId: string) => `mktplace:rental:entity:${grantId}`;
const KEY_RENTAL_BLOCK = (entityId: string) => `mktplace:rental:blocked:${entityId}`;

// ── Interfaces ──────────────────────────────────────────────────────

export interface RentalEntityRecord {
  grantId: string;
  entityId: string;
  zoneId: string;
  ownerWallet: string;
  renterWallet: string;
  characterName: string;
  spawnedAt: number;
}

// ── Activation ──────────────────────────────────────────────────────

/**
 * Activate a character rental: spawn the character and add to party.
 */
export async function activateCharacterRental(params: {
  grantId: string;
  ownerWallet: string;
  renterWallet: string;
  characterName: string;
  renterEntityId: string;
  renterZoneId: string;
}): Promise<RentalEntityRecord> {
  const { grantId, ownerWallet, renterWallet, characterName, renterEntityId, renterZoneId } = params;

  // Load the owner's character save data
  const saved = await loadCharacter(ownerWallet, characterName);
  if (!saved) {
    // Try custodial wallet
    const { getAgentCustodialWallet } = await import("../agents/agentConfigStore.js");
    const custodial = await getAgentCustodialWallet(ownerWallet);
    const savedFromCustodial = custodial ? await loadCharacter(custodial, characterName) : null;
    if (!savedFromCustodial) {
      throw new Error(`Character "${characterName}" not found for owner ${ownerWallet}`);
    }
    return activateWithSave(savedFromCustodial, custodial!, params);
  }

  return activateWithSave(saved, ownerWallet, params);
}

async function activateWithSave(
  saved: Awaited<ReturnType<typeof loadCharacter>> & {},
  resolvedOwnerWallet: string,
  params: {
    grantId: string;
    ownerWallet: string;
    renterWallet: string;
    characterName: string;
    renterEntityId: string;
    renterZoneId: string;
  }
): Promise<RentalEntityRecord> {
  const { grantId, ownerWallet, renterWallet, renterEntityId, renterZoneId } = params;

  // Get renter's entity to find their position
  const renterEntity = getEntity(renterEntityId);
  const spawnX = renterEntity ? renterEntity.x + 32 : 150;
  const spawnY = renterEntity ? renterEntity.y + 32 : 150;

  // Derive stats for the character
  const { computeStatsAtLevel } = await import("../character/leveling.js");
  const derivedStats = computeStatsAtLevel(
    saved.raceId ?? "human",
    saved.classId ?? "warrior",
    saved.level ?? 1
  );

  // Create entity
  const entity: Entity = {
    id: randomUUID(),
    type: "player",
    name: saved.name,
    x: spawnX,
    y: spawnY,
    hp: derivedStats?.hp ?? 100,
    maxHp: derivedStats?.hp ?? 100,
    essence: derivedStats?.essence,
    maxEssence: derivedStats?.essence,
    createdAt: Date.now(),
    walletAddress: renterWallet.toLowerCase(), // Assign to renter so they can see it
    level: saved.level ?? 1,
    xp: saved.xp ?? 0,
    raceId: saved.raceId,
    classId: saved.classId,
    calling: saved.calling as any,
    gender: saved.gender as any,
    skinColor: saved.skinColor,
    hairStyle: saved.hairStyle,
    eyeColor: saved.eyeColor,
    origin: saved.origin,
    stats: derivedStats,
    kills: saved.kills ?? 0,
    completedQuests: saved.completedQuests ?? [],
    learnedTechniques: saved.learnedTechniques ?? [],
    equipment: saved.equipment as any,
    followLeaderId: renterEntityId,
  };

  recalculateEntityVitals(entity);

  // Spawn into zone
  const zone = getOrCreateZone(renterZoneId);
  zone.entities.set(entity.id, entity);

  // Record the rental entity mapping
  const record: RentalEntityRecord = {
    grantId,
    entityId: entity.id,
    zoneId: renterZoneId,
    ownerWallet: resolvedOwnerWallet,
    renterWallet: renterWallet.toLowerCase(),
    characterName: saved.name,
    spawnedAt: Date.now(),
  };

  const redis = getRedis();
  if (redis) {
    await redis.set(KEY_RENTAL_ENTITY(grantId), JSON.stringify(record), "EX", 7 * 86400);
    // Block owner commands for this entity
    await redis.set(KEY_RENTAL_BLOCK(entity.id), grantId, "EX", 7 * 86400);
  }

  return record;
}

// ── Command Blocking ────────────────────────────────────────────────

/**
 * Check if an entity is currently rented out and commands should be blocked
 * for the original owner. Returns the grantId if blocked, null if not.
 */
export async function isEntityRentalBlocked(entityId: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  return redis.get(KEY_RENTAL_BLOCK(entityId));
}

// ── Deactivation ────────────────────────────────────────────────────

/**
 * Deactivate a character rental: save progress back to owner, despawn entity,
 * remove from party.
 */
export async function deactivateCharacterRental(grantId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const raw = await redis.get(KEY_RENTAL_ENTITY(grantId));
  if (!raw) return false;

  const record = JSON.parse(raw) as RentalEntityRecord;
  const entity = getEntity(record.entityId);

  if (entity) {
    // Clear follow-leader before despawning (defensive cleanup)
    entity.followLeaderId = undefined;

    // Save XP and kills back to the owner's character
    await saveCharacter(record.ownerWallet, record.characterName, {
      xp: entity.xp ?? 0,
      kills: entity.kills ?? 0,
      level: entity.level ?? 1,
      completedQuests: entity.completedQuests ?? [],
      learnedTechniques: entity.learnedTechniques ?? [],
    });

    // Remove from party
    const { removeEntityFromParty } = await import("../social/partySystem.js");
    removeEntityFromParty(record.entityId);

    // Despawn entity
    const zone = getOrCreateZone(record.zoneId);
    zone.entities.delete(record.entityId);
  }

  // Clean up Redis
  await redis.del(KEY_RENTAL_ENTITY(grantId));
  await redis.del(KEY_RENTAL_BLOCK(record.entityId));

  return true;
}

/**
 * Get the rental entity record for a grant.
 */
export async function getRentalEntityRecord(
  grantId: string
): Promise<RentalEntityRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(KEY_RENTAL_ENTITY(grantId));
  return raw ? (JSON.parse(raw) as RentalEntityRecord) : null;
}
