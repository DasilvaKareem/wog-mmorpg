import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";
import { hasLearnedProfession } from "./professions.js";
import { mintItem, burnItem, getItemBalance } from "./blockchain.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { authenticateRequest } from "./auth.js";
import { rollCraftedItem } from "./itemRng.js";
import { logZoneEvent } from "./zoneEvents.js";
import { logDiary, narrativeCraft } from "./diary.js";
import { awardProfessionXp, PROFESSION_XP } from "./professionXp.js";

export interface CraftingRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  copperCost: number;
  requiredProfession: "blacksmithing" | "alchemy" | "leatherworking" | "jewelcrafting";
  craftingTime: number; // seconds (for future use)
}

export const CRAFTING_RECIPES: CraftingRecipe[] = [
  // --- Blacksmithing Recipes (Weapons) ---
  {
    recipeId: "iron-sword",
    outputTokenId: 2n, // Iron Sword
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 22n, quantity: 2 }, // 2x Coal Ore
      { tokenId: 23n, quantity: 1 }, // 1x Tin Ore
    ],
    copperCost: 25,
    requiredProfession: "blacksmithing",
    craftingTime: 5,
  },
  {
    recipeId: "steel-longsword",
    outputTokenId: 3n, // Steel Longsword
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 22n, quantity: 3 }, // 3x Coal Ore
      { tokenId: 24n, quantity: 2 }, // 2x Copper Ore
    ],
    copperCost: 50,
    requiredProfession: "blacksmithing",
    craftingTime: 10,
  },
  {
    recipeId: "hunters-bow",
    outputTokenId: 4n, // Hunter's Bow
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 23n, quantity: 2 }, // 2x Tin Ore (for metal tips)
    ],
    copperCost: 35,
    requiredProfession: "blacksmithing",
    craftingTime: 8,
  },
  {
    recipeId: "battle-axe",
    outputTokenId: 5n, // Battle Axe
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 24n, quantity: 3 }, // 3x Copper Ore
      { tokenId: 25n, quantity: 1 }, // 1x Silver Ore
    ],
    copperCost: 100,
    requiredProfession: "blacksmithing",
    craftingTime: 15,
  },
  {
    recipeId: "oak-shield",
    outputTokenId: 7n, // Oak Shield
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 22n, quantity: 1 }, // 1x Coal Ore (for metal rim)
      { tokenId: 23n, quantity: 1 }, // 1x Tin Ore
    ],
    copperCost: 20,
    requiredProfession: "blacksmithing",
    craftingTime: 6,
  },
  // --- Advanced Blacksmithing (Armor) ---
  {
    recipeId: "chainmail-shirt",
    outputTokenId: 9n, // Chainmail Shirt
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 24n, quantity: 4 }, // 4x Copper Ore
      { tokenId: 22n, quantity: 2 }, // 2x Coal Ore
    ],
    copperCost: 75,
    requiredProfession: "blacksmithing",
    craftingTime: 20,
  },
  {
    recipeId: "iron-greaves",
    outputTokenId: 17n, // Iron Greaves
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 22n, quantity: 2 }, // 2x Coal Ore
      { tokenId: 24n, quantity: 1 }, // 1x Copper Ore
    ],
    copperCost: 40,
    requiredProfession: "blacksmithing",
    craftingTime: 12,
  },
  {
    recipeId: "steel-sabatons",
    outputTokenId: 18n, // Steel Sabatons
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 24n, quantity: 2 }, // 2x Copper Ore
      { tokenId: 25n, quantity: 1 }, // 1x Silver Ore
    ],
    copperCost: 60,
    requiredProfession: "blacksmithing",
    craftingTime: 14,
  },
  // --- Master Blacksmithing (Legendary Items) ---
  {
    recipeId: "golden-battle-axe",
    outputTokenId: 5n, // Battle Axe (golden variant - same stats, different lore)
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 26n, quantity: 2 }, // 2x Gold Ore
      { tokenId: 25n, quantity: 2 }, // 2x Silver Ore
      { tokenId: 24n, quantity: 3 }, // 3x Copper Ore
    ],
    copperCost: 300,
    requiredProfession: "blacksmithing",
    craftingTime: 30,
  },

  // --- Smelting Recipes (Ore → Bars) ---
  {
    recipeId: "smelt-tin-bar",
    outputTokenId: 86n, // Tin Bar
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 23n, quantity: 2 }, // 2x Tin Ore
      { tokenId: 22n, quantity: 1 }, // 1x Coal Ore (fuel)
    ],
    copperCost: 5,
    requiredProfession: "blacksmithing",
    craftingTime: 3,
  },
  {
    recipeId: "smelt-copper-bar",
    outputTokenId: 87n, // Copper Bar
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 24n, quantity: 2 }, // 2x Copper Ore
      { tokenId: 22n, quantity: 1 }, // 1x Coal Ore (fuel)
    ],
    copperCost: 8,
    requiredProfession: "blacksmithing",
    craftingTime: 4,
  },
  {
    recipeId: "smelt-silver-bar",
    outputTokenId: 88n, // Silver Bar
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 25n, quantity: 2 }, // 2x Silver Ore
      { tokenId: 22n, quantity: 2 }, // 2x Coal Ore (fuel)
    ],
    copperCost: 15,
    requiredProfession: "blacksmithing",
    craftingTime: 6,
  },
  {
    recipeId: "smelt-gold-bar",
    outputTokenId: 89n, // Gold Bar
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 26n, quantity: 2 }, // 2x Gold Ore
      { tokenId: 22n, quantity: 3 }, // 3x Coal Ore (fuel)
    ],
    copperCost: 30,
    requiredProfession: "blacksmithing",
    craftingTime: 8,
  },
  {
    recipeId: "smelt-steel-alloy",
    outputTokenId: 90n, // Steel Alloy
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 86n, quantity: 1 }, // 1x Tin Bar
      { tokenId: 87n, quantity: 1 }, // 1x Copper Bar
      { tokenId: 22n, quantity: 3 }, // 3x Coal Ore
    ],
    copperCost: 40,
    requiredProfession: "blacksmithing",
    craftingTime: 10,
  },

  // --- Bar-based Blacksmithing (advanced armor) ---
  {
    recipeId: "bar-iron-helm",
    outputTokenId: 10n, // Iron Helm
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 86n, quantity: 2 }, // 2x Tin Bar
    ],
    copperCost: 15,
    requiredProfession: "blacksmithing",
    craftingTime: 6,
  },
  {
    recipeId: "bar-bronze-shoulders",
    outputTokenId: 14n, // Bronze Shoulders
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 86n, quantity: 1 }, // 1x Tin Bar
      { tokenId: 87n, quantity: 1 }, // 1x Copper Bar
    ],
    copperCost: 20,
    requiredProfession: "blacksmithing",
    craftingTime: 8,
  },
  {
    recipeId: "bar-knight-gauntlets",
    outputTokenId: 19n, // Knight Gauntlets
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 87n, quantity: 2 }, // 2x Copper Bar
      { tokenId: 88n, quantity: 1 }, // 1x Silver Bar
    ],
    copperCost: 50,
    requiredProfession: "blacksmithing",
    craftingTime: 12,
  },
  {
    recipeId: "bar-steel-pauldrons",
    outputTokenId: 21n, // Steel Pauldrons
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 87n, quantity: 2 }, // 2x Copper Bar
      { tokenId: 90n, quantity: 1 }, // 1x Steel Alloy
    ],
    copperCost: 60,
    requiredProfession: "blacksmithing",
    craftingTime: 14,
  },
  {
    recipeId: "bar-war-belt",
    outputTokenId: 20n, // War Belt
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 87n, quantity: 1 }, // 1x Copper Bar
      { tokenId: 88n, quantity: 1 }, // 1x Silver Bar
    ],
    copperCost: 45,
    requiredProfession: "blacksmithing",
    craftingTime: 10,
  },
  {
    recipeId: "bar-chainmail-shirt",
    outputTokenId: 9n, // Chainmail Shirt (bar version)
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 87n, quantity: 3 }, // 3x Copper Bar
      { tokenId: 86n, quantity: 2 }, // 2x Tin Bar
    ],
    copperCost: 70,
    requiredProfession: "blacksmithing",
    craftingTime: 18,
  },
  {
    recipeId: "bar-apprentice-staff",
    outputTokenId: 6n, // Apprentice Staff
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 88n, quantity: 2 }, // 2x Silver Bar
      { tokenId: 86n, quantity: 1 }, // 1x Tin Bar
    ],
    copperCost: 55,
    requiredProfession: "blacksmithing",
    craftingTime: 12,
  },
];

export function getRecipeById(recipeId: string): CraftingRecipe | undefined {
  return CRAFTING_RECIPES.find((r) => r.recipeId === recipeId);
}

export function registerCraftingRoutes(server: FastifyInstance) {
  // GET /crafting/recipes - list all crafting recipes
  server.get("/crafting/recipes", async () => {
    return CRAFTING_RECIPES.map((recipe) => {
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
        requiredProfession: recipe.requiredProfession,
        craftingTime: recipe.craftingTime,
      };
    });
  });

  // GET /crafting/recipes/:profession - filter recipes by profession
  server.get<{ Params: { profession: string } }>(
    "/crafting/recipes/:profession",
    async (request, reply) => {
      const { profession } = request.params;

      const filtered = CRAFTING_RECIPES.filter(
        (r) => r.requiredProfession === profession
      );

      if (filtered.length === 0) {
        reply.code(404);
        return { error: "No recipes found for this profession" };
      }

      return filtered.map((recipe) => {
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
    }
  );

  // POST /crafting/forge - craft an item at a forge
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      forgeId: string; // Forge NPC entity ID
      recipeId: string;
    };
  }>("/crafting/forge", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, forgeId, recipeId } = request.body;
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

    // Find recipe
    const recipe = getRecipeById(recipeId);
    if (!recipe) {
      reply.code(404);
      return { error: "Recipe not found" };
    }

    // Check profession requirement
    if (!hasLearnedProfession(walletAddress, recipe.requiredProfession)) {
      reply.code(400);
      return {
        error: `You must learn ${recipe.requiredProfession} to craft this item`,
        requiredProfession: recipe.requiredProfession,
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

    const forge = zone.entities.get(forgeId);
    if (!forge || forge.type !== "forge") {
      reply.code(404);
      return { error: "Forge not found" };
    }

    // Check range (must be within 100 units of forge)
    const dx = forge.x - entity.x;
    const dy = forge.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) {
      reply.code(400);
      return {
        error: "Too far from forge",
        distance: Math.round(dist),
        maxRange: 100,
      };
    }

    // TODO: Check gold balance and deduct cost
    // For now, we'll skip the gold check

    // PRE-CHECK: Verify on-chain balances before attempting burn (avoids costly reverts)
    for (const material of recipe.requiredMaterials) {
      const balance = await getItemBalance(walletAddress, material.tokenId);
      if (balance < BigInt(material.quantity)) {
        reply.code(400);
        return {
          error: "Insufficient materials",
          missing: { tokenId: material.tokenId.toString(), need: material.quantity, have: Number(balance) },
        };
      }
    }

    // CRITICAL: Burn required materials (consume ore NFTs)
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
    } catch (err: any) {
      console.error(`[crafting] BURN FAILED for ${walletAddress} recipe=${recipeId}:`, err?.message ?? err);
      server.log.error(err, `[crafting] Failed to burn materials for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Failed to consume materials - you may not have enough ores",
        hint: "Check your wallet inventory for required materials",
        detail: err?.message ?? String(err),
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

      // Log Rare+ crafts as zone events
      if (instance && (instance.quality.tier === "rare" || instance.quality.tier === "epic")) {
        logZoneEvent({
          zoneId,
          type: "loot",
          tick: 0,
          message: `${entity.name} forged a ${instance.quality.tier} item: ${instance.displayName}!`,
          entityId: entity.id,
          entityName: entity.name,
          data: { quality: instance.quality.tier, instanceId: instance.instanceId },
        });
      }

      server.log.info(
        `[crafting] ${entity.name} forged ${instance?.displayName ?? outputItem?.name} (${instance?.quality.tier ?? "n/a"}) at ${forge.name} → ${craftTx}`
      );

      // Award profession XP based on recipe type
      const craftXp = recipeId.startsWith("smelt-")
        ? PROFESSION_XP.FORGE_SMELT
        : recipeId.startsWith("bar-")
          ? PROFESSION_XP.FORGE_ADVANCED
          : PROFESSION_XP.FORGE_WEAPON;
      const profXpResult = awardProfessionXp(entity, zoneId, craftXp, "crafting", outputItem?.name);

      // Log craft diary entry
      if (walletAddress) {
        const craftedName = instance?.displayName ?? outputItem?.name ?? "Unknown";
        const { headline, narrative } = narrativeCraft(entity.name, entity.raceId, entity.classId, zoneId, craftedName, forge.name);
        logDiary(walletAddress, entity.name, zoneId, entity.x, entity.y, "craft", headline, narrative, {
          recipeId: recipe.recipeId,
          itemName: craftedName,
          quality: instance?.quality.tier,
          stationName: forge.name,
        });
      }

      return {
        ok: true,
        recipeId: recipe.recipeId,
        professionXp: profXpResult,
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
      server.log.error(err, `[crafting] Failed to mint crafted item for ${walletAddress}`);

      // TODO: Refund burned materials on mint failure
      // This is a critical edge case - materials were consumed but item wasn't created

      reply.code(500);
      return {
        error: "Crafting failed - item could not be created",
        materialsConsumed: burnedMaterials,
        warning: "Materials were consumed but item creation failed - contact support",
      };
    }
  });
}
