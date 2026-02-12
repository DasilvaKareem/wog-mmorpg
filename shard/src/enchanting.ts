import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";
import { burnItem } from "./blockchain.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { authenticateRequest } from "./auth.js";

export type EnchantmentType =
  | "fire"
  | "ice"
  | "lightning"
  | "holy"
  | "shadow"
  | "sharpness"
  | "durability";

export interface EnchantmentEffect {
  type: EnchantmentType;
  name: string;
  description: string;
  statBonus?: {
    str?: number;
    def?: number;
    agi?: number;
    int?: number;
  };
  specialEffect?: string;
}

// Enchantment elixir tokenId -> enchantment effect mapping
export const ENCHANTMENT_CATALOG: Record<number, EnchantmentEffect> = {
  55: {
    type: "fire",
    name: "Fire Enchantment",
    description: "Weapon burns with eternal flames",
    statBonus: { str: 5 },
    specialEffect: "Deals +10% fire damage",
  },
  56: {
    type: "ice",
    name: "Ice Enchantment",
    description: "Weapon is wreathed in frost",
    statBonus: { str: 3, agi: 2 },
    specialEffect: "20% chance to slow enemies",
  },
  57: {
    type: "lightning",
    name: "Lightning Enchantment",
    description: "Weapon crackles with electricity",
    statBonus: { str: 4, agi: 3 },
    specialEffect: "30% chance to chain to nearby enemies",
  },
  58: {
    type: "holy",
    name: "Holy Enchantment",
    description: "Weapon glows with divine light",
    statBonus: { str: 4, def: 2 },
    specialEffect: "Heals 5 HP on hit",
  },
  59: {
    type: "shadow",
    name: "Shadow Enchantment",
    description: "Weapon is cloaked in darkness",
    statBonus: { str: 6, agi: 1 },
    specialEffect: "+15% critical hit chance",
  },
  60: {
    type: "sharpness",
    name: "Sharpness Enchantment",
    description: "Weapon edge is impossibly keen",
    statBonus: { str: 8 },
    specialEffect: "+20% damage vs armored targets",
  },
  61: {
    type: "durability",
    name: "Durability Enchantment",
    description: "Weapon becomes nearly unbreakable",
    statBonus: { def: 3 },
    specialEffect: "Durability loss reduced by 50%",
  },
};

export function registerEnchantingRoutes(server: FastifyInstance) {
  // GET /enchanting/catalog - list all available enchantments
  server.get("/enchanting/catalog", async () => {
    return Object.entries(ENCHANTMENT_CATALOG).map(([tokenId, effect]) => {
      const elixir = getItemByTokenId(BigInt(tokenId));
      return {
        tokenId,
        elixirName: elixir?.name ?? "Unknown",
        enchantmentName: effect.name,
        description: effect.description,
        statBonus: effect.statBonus,
        specialEffect: effect.specialEffect,
      };
    });
  });

  // POST /enchanting/apply - enchant a weapon or armor piece
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      altarId: string; // Enchanter's Altar entity ID
      enchantmentElixirTokenId: number;
      equipmentSlot: "weapon" | "chest" | "legs" | "boots" | "helm" | "shoulders" | "gloves" | "belt";
    };
  }>("/enchanting/apply", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const {
      walletAddress,
      zoneId,
      entityId,
      altarId,
      enchantmentElixirTokenId,
      equipmentSlot,
    } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    // Validate wallet
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    // Verify authenticated wallet matches request wallet
    if (walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    // Validate enchantment elixir
    const enchantment = ENCHANTMENT_CATALOG[enchantmentElixirTokenId];
    if (!enchantment) {
      reply.code(400);
      return { error: "Invalid enchantment elixir token ID" };
    }

    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    const entity = zone.entities.get(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    const altar = zone.entities.get(altarId);
    if (!altar || altar.type !== "enchanting-altar") {
      reply.code(404);
      return { error: "Enchanting Altar not found" };
    }

    // Check range (must be within 100 units of altar)
    const dx = altar.x - entity.x;
    const dy = altar.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) {
      reply.code(400);
      return {
        error: "Too far from Enchanting Altar",
        distance: Math.round(dist),
        maxRange: 100,
      };
    }

    // Check if equipment exists in the slot
    if (!entity.equipment) {
      reply.code(400);
      return { error: "You have no equipment" };
    }

    const equippedItem = entity.equipment[equipmentSlot];
    if (!equippedItem) {
      reply.code(400);
      return { error: `No item equipped in ${equipmentSlot} slot` };
    }

    if (equippedItem.broken) {
      reply.code(400);
      return { error: "Cannot enchant broken equipment - repair it first" };
    }

    // Check if already enchanted
    if (equippedItem.enchantments && equippedItem.enchantments.length > 0) {
      reply.code(400);
      return {
        error: "This item is already enchanted",
        currentEnchantments: equippedItem.enchantments,
        hint: "Remove existing enchantments first or use a different item",
      };
    }

    const itemInfo = getItemByTokenId(BigInt(equippedItem.tokenId));
    if (!itemInfo) {
      reply.code(500);
      return { error: "Item not found in catalog" };
    }

    // CRITICAL: Burn enchantment elixir NFT
    try {
      const burnTx = await burnItem(
        walletAddress,
        BigInt(enchantmentElixirTokenId),
        1n
      );

      // Apply enchantment to equipped item
      if (!equippedItem.enchantments) {
        equippedItem.enchantments = [];
      }

      equippedItem.enchantments.push({
        type: enchantment.type,
        name: enchantment.name,
        statBonus: enchantment.statBonus,
        specialEffect: enchantment.specialEffect,
        appliedAt: Date.now(),
      });

      // If durability enchantment, increase max durability
      if (enchantment.type === "durability") {
        const oldMaxDur = equippedItem.maxDurability;
        equippedItem.maxDurability = Math.floor(equippedItem.maxDurability * 1.5);
        // Restore some durability as a bonus
        equippedItem.durability = Math.min(
          equippedItem.maxDurability,
          equippedItem.durability + Math.floor(equippedItem.maxDurability * 0.3)
        );
        server.log.info(
          `[enchanting] Durability boost: ${oldMaxDur} → ${equippedItem.maxDurability}`
        );
      }

      server.log.info(
        `[enchanting] ${entity.name} enchanted ${itemInfo.name} with ${enchantment.name} → ${burnTx}`
      );

      return {
        ok: true,
        enchantmentApplied: {
          name: enchantment.name,
          type: enchantment.type,
          description: enchantment.description,
          statBonus: enchantment.statBonus,
          specialEffect: enchantment.specialEffect,
        },
        enchantedItem: {
          name: itemInfo.name,
          slot: equipmentSlot,
          tokenId: equippedItem.tokenId,
          durability: equippedItem.durability,
          maxDurability: equippedItem.maxDurability,
          enchantments: equippedItem.enchantments,
        },
        elixirBurnTx: burnTx,
      };
    } catch (err) {
      server.log.error(err, `[enchanting] Failed to burn elixir for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Failed to consume enchantment elixir - you may not have it in your wallet",
      };
    }
  });

  // GET /enchanting/item/:zoneId/:entityId/:slot - view enchantments on an item
  server.get<{
    Params: {
      zoneId: string;
      entityId: string;
      slot: string;
    };
  }>("/enchanting/item/:zoneId/:entityId/:slot", async (request, reply) => {
    const { zoneId, entityId, slot } = request.params;

    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    const entity = zone.entities.get(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    if (!entity.equipment) {
      reply.code(404);
      return { error: "No equipment found" };
    }

    const equippedItem = entity.equipment[slot as keyof typeof entity.equipment];
    if (!equippedItem) {
      reply.code(404);
      return { error: `No item equipped in ${slot} slot` };
    }

    const itemInfo = getItemByTokenId(BigInt(equippedItem.tokenId));

    return {
      item: {
        name: itemInfo?.name ?? "Unknown",
        tokenId: equippedItem.tokenId,
        slot,
        durability: equippedItem.durability,
        maxDurability: equippedItem.maxDurability,
        broken: equippedItem.broken,
      },
      enchantments: equippedItem.enchantments ?? [],
      totalStatBonus: calculateTotalEnchantmentBonus(equippedItem.enchantments ?? []),
    };
  });
}

function calculateTotalEnchantmentBonus(
  enchantments: Array<{
    statBonus?: { str?: number; def?: number; agi?: number; int?: number };
  }>
): { str: number; def: number; agi: number; int: number } {
  const total = { str: 0, def: 0, agi: 0, int: 0 };

  for (const ench of enchantments) {
    if (ench.statBonus) {
      total.str += ench.statBonus.str ?? 0;
      total.def += ench.statBonus.def ?? 0;
      total.agi += ench.statBonus.agi ?? 0;
      total.int += ench.statBonus.int ?? 0;
    }
  }

  return total;
}
