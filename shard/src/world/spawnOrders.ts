import type { FastifyInstance } from "fastify";
import {
  getOrCreateZone,
  getEntity,
  getAllEntities,
  recalculateEntityVitals,
  isWalletSpawned,
  registerSpawnedWallet,
  unregisterSpawnedWallet,
  type Entity,
} from "./zoneRuntime.js";
import { randomUUID } from "crypto";
import { computeStatsAtLevel } from "../character/leveling.js";
import { authenticateRequest } from "../auth/auth.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { loadCharacter, saveCharacter } from "../character/characterStore.js";
import { restoreProfessions } from "../professions/professions.js";
import { reputationManager } from "../economy/reputationManager.js";
import { logDiary, narrativeSpawn } from "../social/diary.js";
import { getWorldLayout, getZoneOffset } from "./worldLayout.js";
import { rehydratePartyMembership } from "../social/partySystem.js";

interface SpawnOrderBody {
  zoneId: string;
  type: string;
  name: string;
  x?: number;
  y?: number;
  hp?: number;
  walletAddress?: string;
  level?: number;
  xp?: number;
  xpReward?: number;
  characterTokenId?: string;
  agentId?: string;
  raceId?: string;
  classId?: string;
  calling?: "adventurer" | "farmer" | "merchant" | "craftsman";
  gender?: "male" | "female";
  skinColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  origin?: string;
}

function parseOnChainTokenId(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  try {
    return BigInt(trimmed);
  } catch {
    return undefined;
  }
}

function parseAgentId(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  try {
    return BigInt(trimmed);
  } catch {
    return undefined;
  }
}

export function registerSpawnOrders(server: FastifyInstance) {
  async function controlsWallet(authenticatedWallet: string, targetWallet: string | undefined): Promise<boolean> {
    if (!targetWallet) return false;
    if (targetWallet.toLowerCase() === authenticatedWallet.toLowerCase()) return true;
    const custodialWallet = await getAgentCustodialWallet(authenticatedWallet);
    return custodialWallet?.toLowerCase() === targetWallet.toLowerCase();
  }

  // POST /spawn — inject an entity into a zone (PROTECTED)
  server.post<{ Body: SpawnOrderBody }>("/spawn", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const {
      zoneId, type, name, x = 0, y = 0, hp,
      walletAddress, level, xp, xpReward, characterTokenId, raceId, classId, calling, gender,
      skinColor, hairStyle, eyeColor, origin, agentId,
    } = request.body;

    const authenticatedWallet = (request as any).walletAddress;

    if (!zoneId || !type || !name) {
      reply.code(400);
      return { error: "zoneId, type, and name are required" };
    }

    // Verify authenticated wallet matches the entity's wallet (for players)
    if (type === "player" && walletAddress) {
      if (walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
        reply.code(403);
        return { error: "Not authorized to spawn entity for this wallet" };
      }

      // Enforce one player per wallet across the entire shard
      const existing = isWalletSpawned(walletAddress);
      if (existing) {
        reply.code(409);
        return {
          error: "Wallet already has a live character on this shard",
          entityId: existing.entityId,
          zoneId: existing.zoneId,
        };
      }
    }

    // Try to restore saved character from Redis
    // Only restore if saved name matches the spawn request (same character).
    // Different name = different character on same wallet (e.g. team battle scripts).
    let saved: Awaited<ReturnType<typeof loadCharacter>> = null;
    let restored = false;
    if (type === "player" && walletAddress) {
      saved = await loadCharacter(walletAddress, name);
    }

    const spawnZoneId = saved?.zone ?? zoneId;
    const zone = getOrCreateZone(spawnZoneId);
    const offset = getZoneOffset(spawnZoneId) ?? { x: 0, z: 0 };
    const zoneLayout = getWorldLayout().zones[spawnZoneId];

    const resolvedLevel = Math.max(1, Number(saved?.level ?? level ?? 1) || 1);
    const resolvedRaceId = saved?.raceId ?? raceId;
    const resolvedClassId = saved?.classId ?? classId;
    const resolvedCalling = (saved?.calling as "adventurer" | "farmer" | "merchant" | "craftsman" | undefined) ?? calling;
    const resolvedGender = (saved?.gender as "male" | "female" | undefined) ?? gender;
    const resolvedSkinColor = saved?.skinColor ?? skinColor;
    const resolvedHairStyle = saved?.hairStyle ?? hairStyle;
    const resolvedEyeColor = saved?.eyeColor ?? eyeColor;
    const resolvedOrigin = saved?.origin ?? origin;
    const derivedStats =
      type === "player" && resolvedRaceId && resolvedClassId
        ? computeStatsAtLevel(resolvedRaceId, resolvedClassId, resolvedLevel)
        : undefined;
    const resolvedHp = hp ?? derivedStats?.hp ?? 100;
    const resolvedTokenId = parseOnChainTokenId(saved?.characterTokenId ?? characterTokenId);
    const resolvedAgentId = parseAgentId(saved?.agentId ?? agentId);

    // Saved coords may be raw world-space, normalized-world from the bad layout shift,
    // or legacy zone-local values. Prefer an explicit in-zone world-space match first.
    const rawX = saved?.x ?? x;
    const rawY = saved?.y ?? y;
    const rawLooksWorld = zoneLayout
      ? rawX >= offset.x && rawX <= offset.x + zoneLayout.size.width &&
        rawY >= offset.z && rawY <= offset.z + zoneLayout.size.height
      : rawX >= offset.x && rawY >= offset.z;
    const rawLooksLocal = zoneLayout
      ? rawX >= 0 && rawX <= zoneLayout.size.width &&
        rawY >= 0 && rawY <= zoneLayout.size.height
      : true;
    const worldX = rawLooksWorld ? rawX : rawLooksLocal ? rawX + offset.x : rawX;
    const worldY = rawLooksWorld ? rawY : rawLooksLocal ? rawY + offset.z : rawY;

    const entity: Entity = {
      id: randomUUID(),
      type,
      name: saved?.name ?? name,
      x: worldX,
      y: worldY,
      hp: resolvedHp,
      maxHp: derivedStats?.hp ?? resolvedHp,
      ...(derivedStats?.essence != null && { essence: derivedStats.essence, maxEssence: derivedStats.essence }),
      createdAt: Date.now(),
      ...(walletAddress != null && { walletAddress }),
      level: resolvedLevel,
      xp: saved?.xp ?? xp ?? 0,
      ...(xpReward != null && { xpReward }),
      ...(resolvedTokenId != null && { characterTokenId: resolvedTokenId }),
      ...(resolvedAgentId != null && { agentId: resolvedAgentId }),
      ...(resolvedRaceId != null && { raceId: resolvedRaceId }),
      ...(resolvedClassId != null && { classId: resolvedClassId }),
      ...(resolvedCalling != null && { calling: resolvedCalling }),
      ...(resolvedGender != null && { gender: resolvedGender }),
      ...(resolvedSkinColor != null && { skinColor: resolvedSkinColor }),
      ...(resolvedHairStyle != null && { hairStyle: resolvedHairStyle }),
      ...(resolvedEyeColor != null && { eyeColor: resolvedEyeColor }),
      ...(resolvedOrigin != null && { origin: resolvedOrigin }),
      ...(derivedStats != null && { stats: derivedStats }),
      kills: saved?.kills ?? 0,
      completedQuests: saved?.completedQuests ?? [],
      storyFlags: saved?.storyFlags ?? [],
      learnedTechniques: saved?.learnedTechniques ?? [],
      ...(saved?.equipment != null && { equipment: saved.equipment as any }),
    };

    if (entity.stats) {
      recalculateEntityVitals(entity);
    }

    // Restore professions into in-memory map
    if (saved?.professions && saved.professions.length > 0 && walletAddress) {
      restoreProfessions(walletAddress, saved.professions);
      restored = true;
      server.log.info(
        `[persistence] Restored character "${entity.name}" from spawn name "${name}" L${entity.level} (${saved.completedQuests.length} quests, ${saved.learnedTechniques.length} techniques, ${saved.professions.length} professions)`
      );
    } else if (saved) {
      restored = true;
      server.log.info(
        `[persistence] Restored character "${entity.name}" from spawn name "${name}" L${entity.level}`
      );
    }

    // First-time spawn: save initial character data
    if (!saved && walletAddress && type === "player") {
      await saveCharacter(walletAddress, entity.name, {
        name: entity.name,
        level: entity.level ?? 1,
        xp: entity.xp ?? 0,
        ...(entity.characterTokenId != null && { characterTokenId: entity.characterTokenId.toString() }),
        ...(entity.agentId != null && { agentId: entity.agentId.toString() }),
        raceId: resolvedRaceId ?? "human",
        classId: resolvedClassId ?? "warrior",
        calling: resolvedCalling,
        gender: resolvedGender,
        skinColor: resolvedSkinColor,
        hairStyle: resolvedHairStyle,
        eyeColor: resolvedEyeColor,
        origin: resolvedOrigin,
        zone: spawnZoneId,
        x: entity.x,
        y: entity.y,
        kills: 0,
        completedQuests: [],
        storyFlags: [],
        learnedTechniques: [],
        professions: [],
      });
    }

    zone.entities.set(entity.id, entity);

    // Register wallet in spawn registry (one player per shard)
    if (type === "player" && walletAddress) {
      registerSpawnedWallet(walletAddress, entity.id, spawnZoneId);
      // Re-link to persisted party (survives server restarts)
      rehydratePartyMembership(entity.id, walletAddress).catch((err) =>
        server.log.error(`[party] Rehydration error for ${entity.name}: ${err}`)
      );
    }

    // Log diary entry for player spawns
    if (type === "player" && walletAddress) {
      const { headline, narrative } = narrativeSpawn(entity.name, entity.raceId, entity.classId, spawnZoneId, restored);
      logDiary(walletAddress, entity.name, spawnZoneId, entity.x, entity.y, "spawn", headline, narrative, {
        restored,
        level: entity.level ?? 1,
        raceId: entity.raceId,
        classId: entity.classId,
      });
    }

    // Initialize reputation for player agents when identity is available
    if (type === "player" && entity.agentId != null) {
      reputationManager.ensureInitialized(entity.agentId);
    }

    server.log.info(
      `Spawned ${type} "${entity.name}" in zone ${spawnZoneId} (${zone.entities.size} entities)${restored ? " [RESTORED]" : ""}`
    );

    return {
      spawned: {
        ...entity,
        ...(entity.characterTokenId != null && {
          characterTokenId: entity.characterTokenId.toString(),
        }),
        ...(entity.agentId != null && {
          agentId: entity.agentId.toString(),
        }),
      },
      restored,
      zone: spawnZoneId,
    };
  });

  // DELETE /spawn/:entityId — remove an entity
  const deleteSpawnHandler = async (request: any, reply: any) => {
    const authenticatedWallet = (request as any).walletAddress as string;
    const entityId = request.params.entityId;
    const entity = getEntity(entityId);

    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    if (entity.type !== "player") {
      reply.code(403);
      return { error: "Only player entities can be despawned via this route" };
    }

    if (!(await controlsWallet(authenticatedWallet, entity.walletAddress))) {
      reply.code(403);
      return { error: "Not authorized to despawn this entity" };
    }

    if (entity.walletAddress) unregisterSpawnedWallet(entity.walletAddress);
    getAllEntities().delete(entityId);
    return { deleted: entityId };
  };

  server.delete("/spawn/:entityId", { preHandler: authenticateRequest }, deleteSpawnHandler);
  // Compat alias
  server.delete("/spawn/:zoneId/:entityId", { preHandler: authenticateRequest }, deleteSpawnHandler);
}
