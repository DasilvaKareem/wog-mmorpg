import type { FastifyInstance } from "fastify";
import { getGoldBalance, getItemBalance } from "./blockchain.js";
import { formatGold, getAvailableGold, recordGoldSpend } from "./goldLedger.js";
import { getItemByTokenId, type EquipmentSlot } from "./itemCatalog.js";
import {
  getAllZones,
  getEffectiveStats,
  recalculateEntityVitals,
  type Entity,
  type ZoneState,
} from "./zoneRuntime.js";
import { authenticateRequest } from "./auth.js";
import { getItemInstance } from "./itemRng.js";

const EQUIPMENT_SLOTS: EquipmentSlot[] = [
  "weapon",
  "chest",
  "legs",
  "boots",
  "helm",
  "shoulders",
  "gloves",
  "belt",
  "ring",
  "amulet",
];

function isEquipmentSlot(value: string): value is EquipmentSlot {
  return EQUIPMENT_SLOTS.includes(value as EquipmentSlot);
}

function isBlacksmith(entity: Entity | undefined): entity is Entity {
  if (!entity) return false;
  return entity.type === "merchant" && /blacksmith/i.test(entity.name);
}

function computeRepairCost(
  item: { copperPrice: number; maxDurability?: number; statBonuses?: Record<string, number | undefined> },
  missingDurability: number,
  playerLevel: number
): number {
  const maxDurability = Math.max(1, item.maxDurability ?? 1);
  let statWeight = 0;
  for (const value of Object.values(item.statBonuses ?? {})) {
    statWeight += Math.abs(value ?? 0);
  }
  const qualityMultiplier = 1 + statWeight / 80;
  const levelMultiplier = 1 + Math.max(0, playerLevel - 1) * 0.04;
  const perPoint =
    Math.max(1, (item.copperPrice / maxDurability) * 0.75 * qualityMultiplier) *
    levelMultiplier;
  return Math.max(1, Math.ceil(missingDurability * perPoint));
}

function serializeEntityEquipment(entity: Entity) {
  return {
    entityId: entity.id,
    name: entity.name,
    hp: entity.hp,
    maxHp: entity.maxHp,
    equipment: entity.equipment ?? {},
    effectiveStats: entity.effectiveStats ?? getEffectiveStats(entity) ?? null,
  };
}

function resolvePlayer(
  zone: ZoneState,
  options: { entityId?: string; walletAddress?: string }
): { entity?: Entity; error?: string } {
  const wallet = options.walletAddress?.toLowerCase();

  if (options.entityId) {
    const entity = zone.entities.get(options.entityId);
    if (!entity) return { error: "Entity not found" };
    if (entity.type !== "player") return { error: "Entity is not a player" };
    if (wallet && entity.walletAddress?.toLowerCase() !== wallet) {
      return { error: "Entity wallet mismatch" };
    }
    return { entity };
  }

  if (!wallet) {
    return { error: "Provide entityId or walletAddress" };
  }

  for (const entity of zone.entities.values()) {
    if (entity.type !== "player") continue;
    if (entity.walletAddress?.toLowerCase() === wallet) {
      return { entity };
    }
  }

  return { error: "Player not found in zone" };
}

export function registerEquipmentRoutes(server: FastifyInstance) {
  server.get("/equipment/slots", async () => ({
    slots: EQUIPMENT_SLOTS,
  }));

  server.get<{ Params: { zoneId: string; entityId: string } }>(
    "/equipment/:zoneId/:entityId",
    async (request, reply) => {
      const zone = getAllZones().get(request.params.zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const entity = zone.entities.get(request.params.entityId);
      if (!entity) {
        reply.code(404);
        return { error: "Entity not found" };
      }

      return serializeEntityEquipment(entity);
    }
  );

  server.get<{ Params: { zoneId: string } }>(
    "/equipment/blacksmiths/:zoneId",
    async (request, reply) => {
      const zone = getAllZones().get(request.params.zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const blacksmiths = Array.from(zone.entities.values())
        .filter((entity) => isBlacksmith(entity))
        .map((entity) => ({
          id: entity.id,
          name: entity.name,
          x: entity.x,
          y: entity.y,
        }));

      return {
        zoneId: zone.zoneId,
        blacksmiths,
      };
    }
  );

  server.post<{
    Body: {
      zoneId: string;
      tokenId: number;
      entityId?: string;
      walletAddress?: string;
      instanceId?: string;
    };
  }>("/equipment/equip", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId, tokenId, entityId, walletAddress, instanceId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!zoneId || !Number.isFinite(tokenId)) {
      reply.code(400);
      return { error: "zoneId and tokenId are required" };
    }

    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    const resolved = resolvePlayer(zone, { entityId, walletAddress });
    if (!resolved.entity) {
      reply.code(404);
      return { error: resolved.error ?? "Player not found" };
    }
    const entity = resolved.entity;

    // Verify wallet ownership
    if (entity.walletAddress?.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to control this entity" };
    }

    const item = getItemByTokenId(BigInt(tokenId));
    if (!item) {
      reply.code(400);
      return { error: "Unknown item tokenId" };
    }
    if ((item.category !== "armor" && item.category !== "weapon" && item.category !== "tool") || !item.equipSlot) {
      reply.code(400);
      return { error: "Item is not equippable" };
    }
    if (!item.maxDurability || item.maxDurability <= 0) {
      reply.code(400);
      return { error: "Item is missing durability metadata" };
    }

    const owner = walletAddress ?? entity.walletAddress;
    if (!owner) {
      reply.code(400);
      return { error: "walletAddress is required for this player" };
    }

    const balance = await getItemBalance(owner, item.tokenId);
    if (balance < 1n) {
      reply.code(400);
      return { error: "Wallet does not own this item" };
    }

    entity.equipment ??= {};
    const current = entity.equipment[item.equipSlot];
    if (current && current.tokenId === Number(item.tokenId) && current.durability > 0) {
      return {
        ok: true,
        equipped: {
          slot: item.equipSlot,
          tokenId: item.tokenId.toString(),
          name: item.name,
        },
        ...serializeEntityEquipment(entity),
      };
    }

    // Build the equipped item state — include rolled stats if instanceId provided
    const itemInstance = instanceId ? getItemInstance(instanceId) : undefined;
    if (instanceId && !itemInstance) {
      reply.code(400);
      return { error: "Item instance not found" };
    }
    if (itemInstance && itemInstance.baseTokenId !== Number(item.tokenId)) {
      reply.code(400);
      return { error: "Instance tokenId mismatch" };
    }
    if (itemInstance && itemInstance.craftedBy !== (owner ?? "").toLowerCase()) {
      reply.code(400);
      return { error: "Instance does not belong to this wallet" };
    }

    const durability = itemInstance?.rolledMaxDurability ?? item.maxDurability;
    entity.equipment[item.equipSlot] = {
      tokenId: Number(item.tokenId),
      durability,
      maxDurability: durability,
      broken: false,
      ...(itemInstance && {
        instanceId: itemInstance.instanceId,
        quality: itemInstance.quality.tier,
        rolledStats: itemInstance.rolledStats,
        bonusAffix: itemInstance.bonusAffix
          ? {
              name: itemInstance.bonusAffix.name,
              statBonuses: itemInstance.bonusAffix.statBonuses,
              specialEffect: itemInstance.bonusAffix.specialEffect,
            }
          : undefined,
      }),
    };
    recalculateEntityVitals(entity);

    return {
      ok: true,
      equipped: {
        slot: item.equipSlot,
        tokenId: item.tokenId.toString(),
        name: itemInstance?.displayName ?? item.name,
        ...(itemInstance && {
          instanceId: itemInstance.instanceId,
          quality: itemInstance.quality.tier,
          displayName: itemInstance.displayName,
        }),
      },
      ...serializeEntityEquipment(entity),
    };
  });

  server.post<{
    Body: {
      zoneId: string;
      slot: string;
      entityId?: string;
      walletAddress?: string;
    };
  }>("/equipment/unequip", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId, slot, entityId, walletAddress } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!zoneId || !slot || !isEquipmentSlot(slot)) {
      reply.code(400);
      return { error: "zoneId and valid equipment slot are required" };
    }

    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    const resolved = resolvePlayer(zone, { entityId, walletAddress });
    if (!resolved.entity) {
      reply.code(404);
      return { error: resolved.error ?? "Player not found" };
    }
    const entity = resolved.entity;

    // Verify wallet ownership
    if (entity.walletAddress?.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to control this entity" };
    }

    if (entity.equipment) {
      delete entity.equipment[slot];
      if (Object.keys(entity.equipment).length === 0) {
        entity.equipment = undefined;
      }
    }
    recalculateEntityVitals(entity);

    return {
      ok: true,
      slot,
      ...serializeEntityEquipment(entity),
    };
  });

  server.post<{
    Body: {
      zoneId: string;
      npcId: string;
      slot?: string;
      entityId?: string;
      walletAddress?: string;
    };
  }>("/equipment/repair", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId, npcId, slot, entityId, walletAddress } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!zoneId || !npcId) {
      reply.code(400);
      return { error: "zoneId and npcId are required" };
    }

    let selectedSlot: EquipmentSlot | undefined;
    if (slot) {
      if (!isEquipmentSlot(slot)) {
        reply.code(400);
        return { error: "slot must be a valid equipment slot" };
      }
      selectedSlot = slot;
    }

    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    const blacksmith = zone.entities.get(npcId);
    if (!isBlacksmith(blacksmith)) {
      reply.code(400);
      return { error: "npcId must reference a blacksmith merchant in this zone" };
    }

    const resolved = resolvePlayer(zone, { entityId, walletAddress });
    if (!resolved.entity) {
      reply.code(404);
      return { error: resolved.error ?? "Player not found" };
    }
    const entity = resolved.entity;

    // Verify wallet ownership
    if (entity.walletAddress?.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to control this entity" };
    }

    const owner = walletAddress ?? entity.walletAddress;
    if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
      reply.code(400);
      return { error: "Valid walletAddress is required to pay repair costs" };
    }

    const slotsToCheck: EquipmentSlot[] = selectedSlot ? [selectedSlot] : EQUIPMENT_SLOTS;
    const playerLevel = Math.max(1, entity.level ?? 1);
    const repairs: Array<{
      slot: EquipmentSlot;
      tokenId: number;
      name: string;
      repairedDurability: number;
      cost: number;
    }> = [];

    for (const nextSlot of slotsToCheck) {
      const equipped = entity.equipment?.[nextSlot];
      if (!equipped) continue;
      if (equipped.maxDurability <= 0) continue;
      const missing = Math.max(0, equipped.maxDurability - equipped.durability);
      if (missing <= 0) continue;

      const item = getItemByTokenId(BigInt(equipped.tokenId));
      if (!item) continue;

      // Use rolled stats + affix stats for repair cost if present, else catalog stats
      let repairStatBonuses = item.statBonuses;
      if (equipped.rolledStats) {
        const merged: Record<string, number | undefined> = { ...equipped.rolledStats };
        if (equipped.bonusAffix?.statBonuses) {
          for (const [k, v] of Object.entries(equipped.bonusAffix.statBonuses)) {
            merged[k] = (merged[k] ?? 0) + (v ?? 0);
          }
        }
        repairStatBonuses = merged;
      }

      const cost = computeRepairCost(
        {
          copperPrice: item.copperPrice,
          maxDurability: equipped.maxDurability,
          statBonuses: repairStatBonuses,
        },
        missing,
        playerLevel
      );

      repairs.push({
        slot: nextSlot,
        tokenId: equipped.tokenId,
        name: item.name,
        repairedDurability: missing,
        cost,
      });
    }

    if (repairs.length === 0) {
      reply.code(400);
      return { error: "No damaged equipped items to repair" };
    }

    const totalCost = repairs.reduce((sum, entry) => sum + entry.cost, 0);
    const onChainGold = parseFloat(await getGoldBalance(owner));
    const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
    const availableGold = getAvailableGold(owner, safeOnChainGold);
    if (availableGold < totalCost) {
      reply.code(400);
      return {
        error: "Insufficient gold",
        required: totalCost,
        available: formatGold(availableGold),
      };
    }

    for (const entry of repairs) {
      const equipped = entity.equipment?.[entry.slot];
      if (!equipped) continue;
      equipped.durability = equipped.maxDurability;
      equipped.broken = false;
    }
    recalculateEntityVitals(entity);
    recordGoldSpend(owner, totalCost);

    return {
      ok: true,
      repairedBy: {
        npcId: blacksmith.id,
        npcName: blacksmith.name,
      },
      playerLevel,
      totalCost,
      remainingGold: formatGold(getAvailableGold(owner, safeOnChainGold)),
      repairs,
      ...serializeEntityEquipment(entity),
    };
  });
}
