import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";
import { hasLearnedProfession } from "./professions.js";
import { mintItem, burnItem } from "./blockchain.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { rollCraftedItem } from "./itemRng.js";
import { logZoneEvent } from "./zoneEvents.js";

export interface JewelcraftingRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  copperCost: number;
  craftingTime: number;
}

export const JEWELCRAFTING_RECIPES: JewelcraftingRecipe[] = [
  {
    recipeId: "ruby-ring",
    outputTokenId: 122n, // Ruby Ring
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 116n, quantity: 2 }, // 2x Rough Ruby
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
    ],
    copperCost: 100,
    craftingTime: 12,
  },
  {
    recipeId: "sapphire-ring",
    outputTokenId: 123n, // Sapphire Ring
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 117n, quantity: 2 }, // 2x Rough Sapphire
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
    ],
    copperCost: 100,
    craftingTime: 12,
  },
  {
    recipeId: "emerald-ring",
    outputTokenId: 124n, // Emerald Ring
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 118n, quantity: 2 }, // 2x Rough Emerald
      { tokenId: 88n, quantity: 1 }, // 1x Silver Bar
    ],
    copperCost: 110,
    craftingTime: 14,
  },
  {
    recipeId: "diamond-amulet",
    outputTokenId: 125n, // Diamond Amulet
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 119n, quantity: 2 }, // 2x Flawed Diamond
      { tokenId: 89n, quantity: 2 }, // 2x Gold Bar
    ],
    copperCost: 200,
    craftingTime: 20,
  },
  {
    recipeId: "shadow-opal-amulet",
    outputTokenId: 126n, // Shadow Opal Amulet
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 120n, quantity: 2 }, // 2x Shadow Opal
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
      { tokenId: 88n, quantity: 1 }, // 1x Silver Bar
    ],
    copperCost: 220,
    craftingTime: 18,
  },
  {
    recipeId: "arcane-crystal-amulet",
    outputTokenId: 127n, // Arcane Crystal Amulet
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 121n, quantity: 2 }, // 2x Arcane Crystal
      { tokenId: 89n, quantity: 2 }, // 2x Gold Bar
      { tokenId: 88n, quantity: 1 }, // 1x Silver Bar
    ],
    copperCost: 280,
    craftingTime: 24,
  },
];

export function getJewelcraftingRecipeById(
  recipeId: string
): JewelcraftingRecipe | undefined {
  return JEWELCRAFTING_RECIPES.find((r) => r.recipeId === recipeId);
}

export function registerJewelcraftingRoutes(server: FastifyInstance) {
  // GET /jewelcrafting/recipes
  server.get("/jewelcrafting/recipes", async () => {
    return JEWELCRAFTING_RECIPES.map((recipe) => {
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
        copperCost: recipe.copperCost,
        craftingTime: recipe.craftingTime,
      };
    });
  });

  // POST /jewelcrafting/craft
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      stationId: string;
      recipeId: string;
    };
  }>("/jewelcrafting/craft", async (request, reply) => {
    const { walletAddress, zoneId, entityId, stationId, recipeId } = request.body;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    const recipe = getJewelcraftingRecipeById(recipeId);
    if (!recipe) {
      reply.code(404);
      return { error: "Recipe not found" };
    }

    if (!hasLearnedProfession(walletAddress, "jewelcrafting")) {
      reply.code(400);
      return {
        error: "You must learn jewelcrafting to craft this item",
        requiredProfession: "jewelcrafting",
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
    if (!station || station.type !== "jewelers-bench") {
      reply.code(404);
      return { error: "Jeweler's Workbench not found" };
    }

    // Check range
    const dx = station.x - entity.x;
    const dy = station.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) {
      reply.code(400);
      return {
        error: "Too far from Jeweler's Workbench",
        distance: Math.round(dist),
        maxRange: 100,
      };
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
      server.log.error(err, `[jewelcrafting] Failed to burn materials for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Failed to consume materials - you may not have enough gems or bars",
        hint: "Check your wallet inventory for required materials",
      };
    }

    // Mint crafted jewelry
    try {
      const craftTx = await mintItem(
        walletAddress,
        recipe.outputTokenId,
        BigInt(recipe.outputQuantity)
      );

      const outputItem = getItemByTokenId(recipe.outputTokenId);

      // Roll RNG stats for jewelry (armor category)
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
        `[jewelcrafting] ${entity.name} crafted ${instance?.displayName ?? outputItem?.name} (${instance?.quality.tier ?? "n/a"}) at ${station.name} → ${craftTx}`
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
        copperCost: recipe.copperCost,
      };
    } catch (err) {
      server.log.error(err, `[jewelcrafting] Failed to mint crafted item for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Crafting failed - item could not be created",
        materialsConsumed: burnedMaterials,
        warning: "Materials were consumed but item creation failed - contact support",
      };
    }
  });
}
