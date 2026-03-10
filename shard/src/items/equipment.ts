import type { FastifyInstance } from "fastify";
import { getGoldBalance, getItemBalance } from "../blockchain/blockchain.js";
import { formatGold, getAvailableGold, recordGoldSpend } from "../blockchain/goldLedger.js";
import { copperToGold } from "../blockchain/currency.js";
import { getItemByTokenId, getItemRarity, ITEM_CATALOG, type EquipmentSlot } from "./itemCatalog.js";
import {
  getEntity,
  getAllEntities,
  getEntitiesInRegion,
  getEffectiveStats,
  recalculateEntityVitals,
  type Entity,
  type ZoneState,
} from "../world/zoneRuntime.js";
import { authenticateRequest } from "../auth/auth.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { getItemInstance } from "./itemRng.js";
import { logDiary, narrativeEquip, narrativeUnequip, narrativeRepair } from "../social/diary.js";
import { saveCharacter } from "../character/characterStore.js";

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
  options: { entityId?: string; walletAddress?: string }
): { entity?: Entity; error?: string } {
  const wallet = options.walletAddress?.toLowerCase();

  if (options.entityId) {
    const entity = getEntity(options.entityId);
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

  for (const entity of getAllEntities().values()) {
    if (entity.type !== "player") continue;
    if (entity.walletAddress?.toLowerCase() === wallet) {
      return { entity };
    }
  }

  return { error: "Player not found" };
}

export function registerEquipmentRoutes(server: FastifyInstance) {
  server.get("/equipment/slots", async () => ({
    slots: EQUIPMENT_SLOTS,
  }));

  server.get<{ Params: { entityId: string } }>(
    "/equipment/:entityId",
    async (request, reply) => {
      const entity = getEntity(request.params.entityId);
      if (!entity) {
        reply.code(404);
        return { error: "Entity not found" };
      }

      return serializeEntityEquipment(entity);
    }
  );

  // Compat alias: GET /equipment/:zoneId/:entityId
  server.get<{ Params: { zoneId: string; entityId: string } }>(
    "/equipment/:zoneId/:entityId",
    async (request, reply) => {
      const entity = getEntity(request.params.entityId);
      if (!entity) {
        reply.code(404);
        return { error: "Entity not found" };
      }

      return serializeEntityEquipment(entity);
    }
  );

  server.get<{ Querystring: { region?: string } }>(
    "/equipment/blacksmiths",
    async (request, reply) => {
      const { region } = request.query;
      const entities = region
        ? getEntitiesInRegion(region)
        : Array.from(getAllEntities().values());

      const blacksmiths = entities
        .filter((entity) => isBlacksmith(entity))
        .map((entity) => ({
          id: entity.id,
          name: entity.name,
          x: entity.x,
          y: entity.y,
        }));

      return {
        region: region ?? "all",
        blacksmiths,
      };
    }
  );

  // Compat alias: GET /equipment/blacksmiths/:zoneId
  server.get<{ Params: { zoneId: string } }>(
    "/equipment/blacksmiths/:zoneId",
    async (request, reply) => {
      const region = request.params.zoneId;
      const entities = getEntitiesInRegion(region);

      const blacksmiths = entities
        .filter((entity) => isBlacksmith(entity))
        .map((entity) => ({
          id: entity.id,
          name: entity.name,
          x: entity.x,
          y: entity.y,
        }));

      return {
        region,
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

    if (!Number.isFinite(tokenId)) {
      reply.code(400);
      return { error: "tokenId is required" };
    }

    const resolved = resolvePlayer({ entityId, walletAddress });
    if (!resolved.entity) {
      reply.code(404);
      return { error: resolved.error ?? "Player not found" };
    }
    const entity = resolved.entity;

    // Verify wallet ownership: accept direct match OR owner→custodial relationship
    const entityWallet = entity.walletAddress?.toLowerCase();
    const authWallet = authenticatedWallet.toLowerCase();
    let authorized = entityWallet === authWallet;
    if (!authorized) {
      const custodial = await getAgentCustodialWallet(authenticatedWallet);
      authorized = !!custodial && entityWallet === custodial.toLowerCase();
    }
    if (!authorized) {
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
      name: item.name,
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

    // Log equip diary entry
    if (entity.walletAddress) {
      const displayName = itemInstance?.displayName ?? item.name;
      const { headline, narrative } = narrativeEquip(entity.name, entity.raceId, entity.classId, zoneId, displayName, item.equipSlot!);
      logDiary(entity.walletAddress, entity.name, zoneId, entity.x, entity.y, "equip", headline, narrative, {
        itemName: displayName,
        tokenId: item.tokenId.toString(),
        slot: item.equipSlot,
      });
      // Persist equipment to Redis
      saveCharacter(entity.walletAddress, entity.name, { equipment: entity.equipment }).catch(() => {});
    }

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

    if (!slot || !isEquipmentSlot(slot)) {
      reply.code(400);
      return { error: "Valid equipment slot is required" };
    }

    const resolved = resolvePlayer({ entityId, walletAddress });
    if (!resolved.entity) {
      reply.code(404);
      return { error: resolved.error ?? "Player not found" };
    }
    const entity = resolved.entity;

    // Verify wallet ownership: accept direct match OR owner→custodial relationship
    const entityWallet2 = entity.walletAddress?.toLowerCase();
    const authWallet2 = authenticatedWallet.toLowerCase();
    let authorized2 = entityWallet2 === authWallet2;
    if (!authorized2) {
      const custodial = await getAgentCustodialWallet(authenticatedWallet);
      authorized2 = !!custodial && entityWallet2 === custodial.toLowerCase();
    }
    if (!authorized2) {
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

    // Log unequip diary entry
    if (entity.walletAddress) {
      const { headline, narrative } = narrativeUnequip(entity.name, entity.raceId, entity.classId, zoneId, slot);
      logDiary(entity.walletAddress, entity.name, zoneId, entity.x, entity.y, "unequip", headline, narrative, {
        slot,
      });
      saveCharacter(entity.walletAddress, entity.name, { equipment: entity.equipment ?? {} }).catch(() => {});
    }

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

    if (!npcId) {
      reply.code(400);
      return { error: "npcId is required" };
    }

    let selectedSlot: EquipmentSlot | undefined;
    if (slot) {
      if (!isEquipmentSlot(slot)) {
        reply.code(400);
        return { error: "slot must be a valid equipment slot" };
      }
      selectedSlot = slot;
    }

    const blacksmith = getEntity(npcId);
    if (!isBlacksmith(blacksmith)) {
      reply.code(400);
      return { error: "npcId must reference a blacksmith merchant" };
    }

    const resolved = resolvePlayer({ entityId, walletAddress });
    if (!resolved.entity) {
      reply.code(404);
      return { error: resolved.error ?? "Player not found" };
    }
    const entity = resolved.entity;

    // Verify wallet ownership: accept direct match OR owner→custodial relationship
    const entityWallet3 = entity.walletAddress?.toLowerCase();
    const authWallet3 = authenticatedWallet.toLowerCase();
    let authorized3 = entityWallet3 === authWallet3;
    if (!authorized3) {
      const custodial = await getAgentCustodialWallet(authenticatedWallet);
      authorized3 = !!custodial && entityWallet3 === custodial.toLowerCase();
    }
    if (!authorized3) {
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

    const totalCost = repairs.reduce((sum, entry) => sum + entry.cost, 0); // in copper
    const goldCost = copperToGold(totalCost); // convert to on-chain gold
    const onChainGold = parseFloat(await getGoldBalance(owner));
    const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
    const availableGold = getAvailableGold(owner, safeOnChainGold);
    if (availableGold < goldCost) {
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
    recordGoldSpend(owner, goldCost);

    // Log repair diary entry
    if (owner) {
      const { headline, narrative } = narrativeRepair(entity.name, entity.raceId, entity.classId, zoneId, blacksmith.name, totalCost, repairs.length);
      logDiary(owner, entity.name, zoneId, entity.x, entity.y, "repair", headline, narrative, {
        blacksmithName: blacksmith.name,
        totalCost,
        itemsRepaired: repairs.length,
      });
    }

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

  // ── GET /inventory/:walletAddress ─────────────────────────────────────────
  // Returns on-chain ERC-1155 item balances + equipped status for a wallet.
  server.get<{ Params: { walletAddress: string } }>(
    "/inventory/:walletAddress",
    async (request, reply) => {
      const { walletAddress } = request.params;
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        reply.code(400);
        return { error: "Invalid wallet address" };
      }

      // Find live entity equipment across zones
      const equippedByTokenId: Record<number, { slot: string; durability: number; maxDurability: number }> = {};
      for (const entity of getAllEntities().values()) {
        if (entity.type === "player" && entity.walletAddress?.toLowerCase() === walletAddress.toLowerCase()) {
          for (const [slot, e] of Object.entries(entity.equipment ?? {})) {
            equippedByTokenId[(e as any).tokenId] = {
              slot,
              durability: (e as any).durability ?? (e as any).maxDurability ?? 0,
              maxDurability: (e as any).maxDurability ?? 0,
            };
          }
          break;
        }
      }

      // Fetch all on-chain balances in parallel
      const balances = await Promise.all(
        ITEM_CATALOG.map(async (item) => {
          const qty = await getItemBalance(walletAddress, item.tokenId);
          return { tokenId: Number(item.tokenId), qty: Number(qty) };
        })
      );

      const items = balances
        .filter(({ tokenId, qty }) => qty > 0 || equippedByTokenId[tokenId] !== undefined)
        .map(({ tokenId, qty }) => {
          const def = ITEM_CATALOG.find((i) => Number(i.tokenId) === tokenId)!;
          const equipped = equippedByTokenId[tokenId];
          return {
            tokenId,
            name: def.name,
            description: def.description,
            category: def.category,
            equipSlot: def.equipSlot ?? null,
            rarity: getItemRarity(def.copperPrice),
            quantity: qty,
            equipped: !!equipped,
            equippedSlot: equipped?.slot ?? null,
            durability: equipped?.durability ?? null,
            maxDurability: equipped?.maxDurability ?? null,
          };
        });

      return { walletAddress, items };
    }
  );
}
