import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getEntity } from "../world/zoneRuntime.js";
import { hasLearnedProfession } from "./professions.js";
import { enqueueItemMint, enqueueItemBurn } from "../blockchain/blockchain.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { rollCraftedItem } from "../items/itemRng.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { awardProfessionXp, PROFESSION_XP, getProfessionSkills, rollFailure } from "./professionXp.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";
import { advanceGatherQuests } from "../social/questSystem.js";

const lastCraftTime = new Map<string, number>();

export interface JewelcraftingRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  copperCost: number;
  requiredSkillLevel: number; // jewelcrafting skill level (1-300) needed to craft
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
    requiredSkillLevel: 1,
    craftingTime: 24,
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
    requiredSkillLevel: 10,
    craftingTime: 24,
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
    requiredSkillLevel: 25,
    craftingTime: 28,
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
    requiredSkillLevel: 50,
    craftingTime: 40,
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
    requiredSkillLevel: 75,
    craftingTime: 36,
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
    requiredSkillLevel: 100,
    craftingTime: 48,
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
        requiredSkillLevel: recipe.requiredSkillLevel,
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
  }>("/jewelcrafting/craft", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
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

    // Check skill level requirement
    const skills = getProfessionSkills(walletAddress);
    const currentSkillLevel = skills["jewelcrafting"]?.level ?? 1;
    if (currentSkillLevel < recipe.requiredSkillLevel) {
      reply.code(400);
      return {
        error: `Jewelcrafting skill too low for this recipe`,
        requiredSkillLevel: recipe.requiredSkillLevel,
        currentSkillLevel,
        hint: `Craft simpler recipes to raise your skill from ${currentSkillLevel} to ${recipe.requiredSkillLevel}`,
      };
    }

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    // Enforce crafting cooldown
    const cooldownMs = recipe.craftingTime * 1000;
    const lastCraft = lastCraftTime.get(walletAddress.toLowerCase());
    if (lastCraft && Date.now() - lastCraft < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (Date.now() - lastCraft)) / 1000);
      reply.code(429);
      return { error: "Crafting too fast", cooldownRemaining: remaining };
    }

    // Roll for failure
    const { failed, failChance } = rollFailure(currentSkillLevel, recipe.requiredSkillLevel);
    if (failed) {
      lastCraftTime.set(walletAddress.toLowerCase(), Date.now());
      const halfXp = recipeId.includes("amulet")
        ? Math.floor(PROFESSION_XP.JEWEL_AMULET / 2)
        : Math.floor(PROFESSION_XP.JEWEL_RING / 2);
      awardProfessionXp(entity, zoneId, halfXp, "jewelcrafting");
      return {
        ok: false,
        failed: true,
        failChance,
        recipeId: recipe.recipeId,
        message: "The gem shattered during setting. No materials consumed.",
      };
    }

    const station = getEntity(stationId);
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
        const burnTx = await enqueueItemBurn(
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
      const craftTx = await enqueueItemMint(
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

      // Emit zone event for client speech bubbles
      logZoneEvent({
        zoneId,
        type: "loot",
        tick: 0,
        message: instance && (instance.quality.tier === "rare" || instance.quality.tier === "epic")
          ? `${entity.name} crafted a ${instance.quality.tier} item: ${instance.displayName}!`
          : `${entity.name}: Crafted ${outputItem?.name ?? "an item"}`,
        entityId: entity.id,
        entityName: entity.name,
        data: {
          craftType: "jewelcrafting",
          itemName: instance?.displayName ?? outputItem?.name ?? "an item",
          recipeId,
          ...(instance && { quality: instance.quality.tier, instanceId: instance.instanceId }),
        },
      });

      // Award profession XP (ring = 35, amulet = 45)
      const jcXp = recipeId.includes("amulet")
        ? PROFESSION_XP.JEWEL_AMULET
        : PROFESSION_XP.JEWEL_RING;
      const profXpResult = awardProfessionXp(entity, zoneId, jcXp, "jewelcrafting", outputItem?.name);

      advanceGatherQuests(entity, outputItem?.name ?? "Unknown");

      if (entity.agentId != null) {
        reputationManager.submitFeedback(entity.agentId, ReputationCategory.Crafting, 3, `Crafted: ${instance?.displayName ?? outputItem?.name ?? recipeId}`);
      }
      server.log.info(
        `[jewelcrafting] ${entity.name} crafted ${instance?.displayName ?? outputItem?.name} (${instance?.quality.tier ?? "n/a"}) at ${station.name} → ${craftTx}`
      );

      lastCraftTime.set(walletAddress.toLowerCase(), Date.now());

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
