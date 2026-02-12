import type { FastifyInstance } from "fastify";
import {
  getOrCreateZone,
  recalculateEntityVitals,
  type Entity,
  type EquippedItemState,
} from "./zoneRuntime.js";
import { randomUUID } from "crypto";
import { computeStatsAtLevel } from "./leveling.js";
import { getItemByTokenId, type EquipmentSlot } from "./itemCatalog.js";

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
  equipment?: Partial<
    Record<
      EquipmentSlot,
      number | { tokenId: number; durability: number; maxDurability: number; broken?: boolean }
    >
  >;
}

export function registerSpawnOrders(server: FastifyInstance) {
  // POST /spawn — inject an entity into a zone
  server.post<{ Body: SpawnOrderBody }>("/spawn", async (request, reply) => {
    const {
      zoneId, type, name, x = 0, y = 0, hp,
      walletAddress, level, xp, xpReward, characterTokenId, raceId, classId, equipment,
    } = request.body;

    if (!zoneId || !type || !name) {
      reply.code(400);
      return { error: "zoneId, type, and name are required" };
    }

    const zone = getOrCreateZone(zoneId);

    const resolvedLevel = level ?? 1;
    const derivedStats =
      type === "player" && raceId && classId
        ? computeStatsAtLevel(raceId, classId, resolvedLevel)
        : undefined;
    const resolvedHp = hp ?? derivedStats?.hp ?? 100;

    const normalizedEquipment: Partial<Record<EquipmentSlot, EquippedItemState>> = {};
    if (equipment) {
      for (const [slot, raw] of Object.entries(equipment)) {
        if (raw == null) continue;
        if (typeof raw === "number") {
          const item = getItemByTokenId(BigInt(raw));
          const maxDurability = item?.maxDurability ?? 0;
          normalizedEquipment[slot as EquipmentSlot] = {
            tokenId: raw,
            durability: maxDurability,
            maxDurability,
            broken: maxDurability <= 0,
          };
          continue;
        }

        const item = getItemByTokenId(BigInt(raw.tokenId));
        const fallbackMaxDurability = item?.maxDurability ?? 0;
        const maxDurability =
          raw.maxDurability > 0 ? raw.maxDurability : fallbackMaxDurability;
        const durability =
          raw.durability >= 0
            ? Math.min(raw.durability, maxDurability)
            : maxDurability;

        normalizedEquipment[slot as EquipmentSlot] = {
          tokenId: raw.tokenId,
          durability,
          maxDurability,
          broken: raw.broken ?? durability <= 0,
        };
      }
    }

    const entity: Entity = {
      id: randomUUID(),
      type,
      name,
      x,
      y,
      hp: resolvedHp,
      maxHp: derivedStats?.hp ?? resolvedHp,
      ...(derivedStats?.essence != null && { essence: derivedStats.essence, maxEssence: derivedStats.essence }),
      createdAt: Date.now(),
      ...(walletAddress != null && { walletAddress }),
      ...((level != null || derivedStats != null) && { level: resolvedLevel }),
      ...(xp != null && { xp }),
      ...(xpReward != null && { xpReward }),
      ...(characterTokenId != null && { characterTokenId: BigInt(characterTokenId) }),
      ...(raceId != null && { raceId }),
      ...(classId != null && { classId }),
      ...(derivedStats != null && { stats: derivedStats }),
      ...(Object.keys(normalizedEquipment).length > 0 && { equipment: normalizedEquipment }),
    };

    if (entity.stats) {
      recalculateEntityVitals(entity);
    }

    zone.entities.set(entity.id, entity);

    server.log.info(
      `Spawned ${type} "${name}" in zone ${zoneId} (${zone.entities.size} entities)`
    );

    return {
      spawned: {
        ...entity,
        ...(entity.characterTokenId != null && {
          characterTokenId: entity.characterTokenId.toString(),
        }),
      },
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
