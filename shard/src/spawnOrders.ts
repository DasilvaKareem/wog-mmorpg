import type { FastifyInstance } from "fastify";
import {
  getOrCreateZone,
  recalculateEntityVitals,
  type Entity,
} from "./zoneRuntime.js";
import { randomUUID } from "crypto";
import { computeStatsAtLevel } from "./leveling.js";
import { authenticateRequest } from "./auth.js";
import { loadCharacter, saveCharacter } from "./characterStore.js";
import { restoreProfessions } from "./professions.js";
import { reputationManager } from "./reputationManager.js";
import { logDiary, narrativeSpawn } from "./diary.js";

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
  raceId?: string;
  classId?: string;
  gender?: "male" | "female";
}

export function registerSpawnOrders(server: FastifyInstance) {
  // POST /spawn — inject an entity into a zone (PROTECTED)
  server.post<{ Body: SpawnOrderBody }>("/spawn", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const {
      zoneId, type, name, x = 0, y = 0, hp,
      walletAddress, level, xp, xpReward, characterTokenId, raceId, classId, gender,
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
    }

    // Try to restore saved character from Redis
    // Only restore if saved name matches the spawn request (same character).
    // Different name = different character on same wallet (e.g. team battle scripts).
    let saved: Awaited<ReturnType<typeof loadCharacter>> = null;
    let restored = false;
    if (type === "player" && walletAddress) {
      const candidate = await loadCharacter(walletAddress);
      if (candidate && candidate.name === name) {
        saved = candidate;
      }
    }

    const spawnZoneId = saved?.zone ?? zoneId;
    const zone = getOrCreateZone(spawnZoneId);

    const resolvedLevel = saved?.level ?? level ?? 1;
    const resolvedRaceId = saved?.raceId ?? raceId;
    const resolvedClassId = saved?.classId ?? classId;
    const resolvedGender = (saved?.gender as "male" | "female" | undefined) ?? gender;
    const derivedStats =
      type === "player" && resolvedRaceId && resolvedClassId
        ? computeStatsAtLevel(resolvedRaceId, resolvedClassId, resolvedLevel)
        : undefined;
    const resolvedHp = hp ?? derivedStats?.hp ?? 100;

    const entity: Entity = {
      id: randomUUID(),
      type,
      name: saved?.name ?? name,
      x: saved?.x ?? x,
      y: saved?.y ?? y,
      hp: resolvedHp,
      maxHp: derivedStats?.hp ?? resolvedHp,
      ...(derivedStats?.essence != null && { essence: derivedStats.essence, maxEssence: derivedStats.essence }),
      createdAt: Date.now(),
      ...(walletAddress != null && { walletAddress }),
      level: resolvedLevel,
      xp: saved?.xp ?? xp ?? 0,
      ...(xpReward != null && { xpReward }),
      ...(characterTokenId != null && { characterTokenId: BigInt(characterTokenId) }),
      ...(resolvedRaceId != null && { raceId: resolvedRaceId }),
      ...(resolvedClassId != null && { classId: resolvedClassId }),
      ...(resolvedGender != null && { gender: resolvedGender }),
      ...(derivedStats != null && { stats: derivedStats }),
      kills: saved?.kills ?? 0,
      completedQuests: saved?.completedQuests ?? [],
      learnedTechniques: saved?.learnedTechniques ?? [],
    };

    if (entity.stats) {
      recalculateEntityVitals(entity);
    }

    // Restore professions into in-memory map
    if (saved?.professions && saved.professions.length > 0 && walletAddress) {
      restoreProfessions(walletAddress, saved.professions);
      restored = true;
      server.log.info(
        `[persistence] Restored character "${entity.name}" L${entity.level} (${saved.completedQuests.length} quests, ${saved.learnedTechniques.length} techniques, ${saved.professions.length} professions)`
      );
    } else if (saved) {
      restored = true;
      server.log.info(
        `[persistence] Restored character "${entity.name}" L${entity.level}`
      );
    }

    // First-time spawn: save initial character data
    if (!saved && walletAddress && type === "player") {
      await saveCharacter(walletAddress, {
        name: entity.name,
        level: entity.level ?? 1,
        xp: entity.xp ?? 0,
        raceId: resolvedRaceId ?? "human",
        classId: resolvedClassId ?? "warrior",
        gender: resolvedGender,
        zone: spawnZoneId,
        x: entity.x,
        y: entity.y,
        kills: 0,
        completedQuests: [],
        learnedTechniques: [],
        professions: [],
      });
    }

    zone.entities.set(entity.id, entity);

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

    // Initialize reputation for player wallets
    if (type === "player" && walletAddress) {
      reputationManager.ensureInitialized(walletAddress);
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
      },
      restored,
      zone: spawnZoneId,
    };
  });

  // DELETE /spawn/:zoneId/:entityId — remove an entity
  server.delete<{ Params: { zoneId: string; entityId: string } }>(
    "/spawn/:zoneId/:entityId",
    async (request, reply) => {
      const { zoneId, entityId } = request.params;
      const zone = getOrCreateZone(zoneId);

      if (!zone.entities.has(entityId)) {
        reply.code(404);
        return { error: "Entity not found" };
      }

      zone.entities.delete(entityId);
      return { deleted: entityId };
    }
  );
}
