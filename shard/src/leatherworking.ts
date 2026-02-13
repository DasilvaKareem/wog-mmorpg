import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";
import { hasLearnedProfession } from "./professions.js";
import { mintItem, burnItem } from "./blockchain.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { rollCraftedItem } from "./itemRng.js";
import { logZoneEvent } from "./zoneEvents.js";

export interface LeatherworkingRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  goldCost: number;
  craftingTime: number;
}

export const LEATHERWORKING_RECIPES: LeatherworkingRecipe[] = [
  // --- Basic Tanned Leather Set ---
  {
    recipeId: "tanned-vest",
    outputTokenId: 91n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 4 }, // 4x Light Leather
      { tokenId: 62n, quantity: 2 }, // 2x Scrap Leather
      { tokenId: 68n, quantity: 2 }, // 2x Small Bone
    ],
    goldCost: 25,
    craftingTime: 10,
  },
  {
    recipeId: "tanned-leggings",
    outputTokenId: 92n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 3 }, // 3x Light Leather
      { tokenId: 62n, quantity: 2 }, // 2x Scrap Leather
      { tokenId: 65n, quantity: 1 }, // 1x Wolf Pelt
    ],
    goldCost: 22,
    craftingTime: 8,
  },
  {
    recipeId: "tanned-boots",
    outputTokenId: 93n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 2 }, // 2x Light Leather
      { tokenId: 62n, quantity: 2 }, // 2x Scrap Leather
    ],
    goldCost: 18,
    craftingTime: 6,
  },
  {
    recipeId: "tanned-helm",
    outputTokenId: 94n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 2 }, // 2x Light Leather
      { tokenId: 68n, quantity: 2 }, // 2x Small Bone
    ],
    goldCost: 18,
    craftingTime: 6,
  },
  {
    recipeId: "tanned-shoulders",
    outputTokenId: 95n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 2 }, // 2x Light Leather
      { tokenId: 65n, quantity: 1 }, // 1x Wolf Pelt
      { tokenId: 68n, quantity: 1 }, // 1x Small Bone
    ],
    goldCost: 20,
    craftingTime: 7,
  },
  {
    recipeId: "tanned-gloves",
    outputTokenId: 96n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 2 }, // 2x Light Leather
      { tokenId: 62n, quantity: 1 }, // 1x Scrap Leather
    ],
    goldCost: 15,
    craftingTime: 5,
  },
  {
    recipeId: "tanned-belt",
    outputTokenId: 97n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 1 }, // 1x Light Leather
      { tokenId: 62n, quantity: 2 }, // 2x Scrap Leather
      { tokenId: 68n, quantity: 1 }, // 1x Small Bone
    ],
    goldCost: 15,
    craftingTime: 5,
  },

  // --- Reinforced Hide Set ---
  {
    recipeId: "reinforced-vest",
    outputTokenId: 98n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 70n, quantity: 3 }, // 3x Heavy Leather
      { tokenId: 64n, quantity: 2 }, // 2x Medium Leather
      { tokenId: 66n, quantity: 1 }, // 1x Bear Hide
      { tokenId: 69n, quantity: 2 }, // 2x Thick Bone
    ],
    goldCost: 65,
    craftingTime: 18,
  },
  {
    recipeId: "reinforced-leggings",
    outputTokenId: 99n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 70n, quantity: 2 }, // 2x Heavy Leather
      { tokenId: 64n, quantity: 2 }, // 2x Medium Leather
      { tokenId: 69n, quantity: 2 }, // 2x Thick Bone
    ],
    goldCost: 55,
    craftingTime: 14,
  },
  {
    recipeId: "reinforced-boots",
    outputTokenId: 100n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 70n, quantity: 2 }, // 2x Heavy Leather
      { tokenId: 64n, quantity: 1 }, // 1x Medium Leather
      { tokenId: 69n, quantity: 1 }, // 1x Thick Bone
    ],
    goldCost: 50,
    craftingTime: 10,
  },
  {
    recipeId: "reinforced-helm",
    outputTokenId: 101n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 70n, quantity: 2 }, // 2x Heavy Leather
      { tokenId: 69n, quantity: 3 }, // 3x Thick Bone
    ],
    goldCost: 50,
    craftingTime: 10,
  },
  {
    recipeId: "reinforced-shoulders",
    outputTokenId: 102n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 70n, quantity: 2 }, // 2x Heavy Leather
      { tokenId: 66n, quantity: 1 }, // 1x Bear Hide
      { tokenId: 69n, quantity: 2 }, // 2x Thick Bone
    ],
    goldCost: 55,
    craftingTime: 12,
  },
  {
    recipeId: "reinforced-gloves",
    outputTokenId: 103n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 70n, quantity: 1 }, // 1x Heavy Leather
      { tokenId: 64n, quantity: 2 }, // 2x Medium Leather
      { tokenId: 73n, quantity: 1 }, // 1x Troll Hide
    ],
    goldCost: 60,
    craftingTime: 10,
  },
  {
    recipeId: "reinforced-belt",
    outputTokenId: 104n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 70n, quantity: 1 }, // 1x Heavy Leather
      { tokenId: 64n, quantity: 1 }, // 1x Medium Leather
      { tokenId: 72n, quantity: 2 }, // 2x Ancient Bone
    ],
    goldCost: 55,
    craftingTime: 10,
  },
];

export function getLeatherworkingRecipeById(
  recipeId: string
): LeatherworkingRecipe | undefined {
  return LEATHERWORKING_RECIPES.find((r) => r.recipeId === recipeId);
}

export function registerLeatherworkingRoutes(server: FastifyInstance) {
  // GET /leatherworking/recipes
  server.get("/leatherworking/recipes", async () => {
    return LEATHERWORKING_RECIPES.map((recipe) => {
      const outputItem = getItemByTokenId(recipe.outputTokenId);
      return {
        recipeId: recipe.recipeId,
        output: {
          tokenId: recipe.outputTokenId.toString(),
          name: outputItem?.name ?? "Unknown",
          quantity: recipe.outputQuantity,
        },
        materials: recipe.requiredMaterials.map((mat) => {
          const matItem = getItemByTokenId(mat.tokenId);
          return {
            tokenId: mat.tokenId.toString(),
            name: matItem?.name ?? "Unknown",
            quantity: mat.quantity,
          };
        }),
        goldCost: recipe.goldCost,
        craftingTime: recipe.craftingTime,
      };
    });
  });

  // POST /leatherworking/craft
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      stationId: string;
      recipeId: string;
    };
  }>("/leatherworking/craft", async (request, reply) => {
    const { walletAddress, zoneId, entityId, stationId, recipeId } = request.body;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    const recipe = getLeatherworkingRecipeById(recipeId);
    if (!recipe) {
      reply.code(404);
      return { error: "Recipe not found" };
    }

    if (!hasLearnedProfession(walletAddress, "leatherworking")) {
      reply.code(400);
      return {
        error: "You must learn leatherworking to craft this item",
        requiredProfession: "leatherworking",
      };
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

    const station = zone.entities.get(stationId);
    if (!station || station.type !== "tanning-rack") {
      reply.code(404);
      return { error: "Tanning Rack not found" };
    }

    // Check range
    const dx = station.x - entity.x;
    const dy = station.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) {
      reply.code(400);
      return { error: "Too far from Tanning Rack", distance: Math.round(dist), maxRange: 100 };
    }

    // Burn materials
    const burnedMaterials: Array<{ tokenId: string; quantity: number; tx: string }> = [];
    try {
      for (const material of recipe.requiredMaterials) {
        const burnTx = await burnItem(
          walletAddress,
          material.tokenId,
          BigInt(material.quantity)
        );
        burnedMaterials.push({
          tokenId: material.tokenId.toString(),
          quantity: material.quantity,
          tx: burnTx,
        });
      }
    } catch (err) {
      server.log.error(err, `[leatherworking] Failed to burn materials for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Failed to consume materials - you may not have enough",
        hint: "Check your wallet inventory for required materials",
      };
    }

    // Mint crafted item
    try {
      const craftTx = await mintItem(
        walletAddress,
        recipe.outputTokenId,
        BigInt(recipe.outputQuantity)
      );

      const outputItem = getItemByTokenId(recipe.outputTokenId);

      // Roll RNG stats for weapons/armor
      const instance = rollCraftedItem({
        baseTokenId: recipe.outputTokenId,
        recipeId: recipe.recipeId,
        craftedBy: walletAddress,
      });

      if (instance && (instance.quality.tier === "rare" || instance.quality.tier === "epic")) {
        logZoneEvent({
          zoneId,
          type: "loot",
          tick: 0,
          message: `${entity.name} crafted a ${instance.quality.tier} item: ${instance.displayName}!`,
          entityId: entity.id,
          entityName: entity.name,
          data: { quality: instance.quality.tier, instanceId: instance.instanceId },
        });
      }

      server.log.info(
        `[leatherworking] ${entity.name} crafted ${instance?.displayName ?? outputItem?.name} (${instance?.quality.tier ?? "n/a"}) at ${station.name} → ${craftTx}`
      );

      return {
        ok: true,
        recipeId: recipe.recipeId,
        crafted: {
          tokenId: recipe.outputTokenId.toString(),
          name: outputItem?.name ?? "Unknown",
          quantity: recipe.outputQuantity,
          tx: craftTx,
          ...(instance && {
            instanceId: instance.instanceId,
            quality: instance.quality.tier,
            displayName: instance.displayName,
            rolledStats: instance.rolledStats,
            bonusAffix: instance.bonusAffix,
            rolledMaxDurability: instance.rolledMaxDurability,
          }),
        },
        materialsConsumed: burnedMaterials,
        goldCost: recipe.goldCost,
      };
    } catch (err) {
      server.log.error(err, `[leatherworking] Failed to mint crafted item for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Crafting failed - item could not be created",
        materialsConsumed: burnedMaterials,
        warning: "Materials were consumed but item creation failed - contact support",
      };
    }
  });
}
