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

export interface LeatherworkingRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  copperCost: number;
  requiredSkillLevel: number; // leatherworking skill level (1-300) needed to craft
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
    copperCost: 25,
    requiredSkillLevel: 1,
    craftingTime: 20,
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
    copperCost: 22,
    requiredSkillLevel: 5,
    craftingTime: 16,
  },
  {
    recipeId: "tanned-boots",
    outputTokenId: 93n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 2 }, // 2x Light Leather
      { tokenId: 62n, quantity: 2 }, // 2x Scrap Leather
    ],
    copperCost: 18,
    requiredSkillLevel: 1,
    craftingTime: 12,
  },
  {
    recipeId: "tanned-helm",
    outputTokenId: 94n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 2 }, // 2x Light Leather
      { tokenId: 68n, quantity: 2 }, // 2x Small Bone
    ],
    copperCost: 18,
    requiredSkillLevel: 10,
    craftingTime: 12,
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
    copperCost: 20,
    requiredSkillLevel: 15,
    craftingTime: 14,
  },
  {
    recipeId: "tanned-gloves",
    outputTokenId: 96n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 63n, quantity: 2 }, // 2x Light Leather
      { tokenId: 62n, quantity: 1 }, // 1x Scrap Leather
    ],
    copperCost: 15,
    requiredSkillLevel: 5,
    craftingTime: 10,
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
    copperCost: 15,
    requiredSkillLevel: 10,
    craftingTime: 10,
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
    copperCost: 65,
    requiredSkillLevel: 50,
    craftingTime: 36,
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
    copperCost: 55,
    requiredSkillLevel: 55,
    craftingTime: 28,
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
    copperCost: 50,
    requiredSkillLevel: 50,
    craftingTime: 20,
  },
  {
    recipeId: "reinforced-helm",
    outputTokenId: 101n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 70n, quantity: 2 }, // 2x Heavy Leather
      { tokenId: 69n, quantity: 3 }, // 3x Thick Bone
    ],
    copperCost: 50,
    requiredSkillLevel: 60,
    craftingTime: 20,
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
    copperCost: 55,
    requiredSkillLevel: 65,
    craftingTime: 24,
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
    copperCost: 60,
    requiredSkillLevel: 60,
    craftingTime: 20,
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
    copperCost: 55,
    requiredSkillLevel: 55,
    craftingTime: 20,
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
        copperCost: recipe.copperCost,
        requiredSkillLevel: recipe.requiredSkillLevel,
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
  }>("/leatherworking/craft", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
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

    // Check skill level requirement
    const skills = getProfessionSkills(walletAddress);
    const currentSkillLevel = skills["leatherworking"]?.level ?? 1;
    if (currentSkillLevel < recipe.requiredSkillLevel) {
      reply.code(400);
      return {
        error: `Leatherworking skill too low for this recipe`,
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
      const halfXp = recipeId.startsWith("reinforced-")
        ? Math.floor(PROFESSION_XP.LEATHER_ADVANCED / 2)
        : Math.floor(PROFESSION_XP.LEATHER_BASIC / 2);
      awardProfessionXp(entity, zoneId, halfXp, "leatherworking");
      return {
        ok: false,
        failed: true,
        failChance,
        recipeId: recipe.recipeId,
        message: "The leather cracked during shaping. No materials consumed.",
      };
    }

    const station = getEntity(stationId);
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
      server.log.error(err, `[leatherworking] Failed to burn materials for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Failed to consume materials - you may not have enough",
        hint: "Check your wallet inventory for required materials",
      };
    }

    // Mint crafted item
    try {
      const craftTx = await enqueueItemMint(
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
          craftType: "leatherworking",
          itemName: instance?.displayName ?? outputItem?.name ?? "an item",
          recipeId,
          ...(instance && { quality: instance.quality.tier, instanceId: instance.instanceId }),
        },
      });

      // Award profession XP (basic tanned = 30, reinforced = 40)
      const lwXp = recipeId.startsWith("reinforced-")
        ? PROFESSION_XP.LEATHER_ADVANCED
        : PROFESSION_XP.LEATHER_BASIC;
      const profXpResult = awardProfessionXp(entity, zoneId, lwXp, "leatherworking", outputItem?.name);

      advanceGatherQuests(entity, outputItem?.name ?? "Unknown");

      if (entity.agentId != null) {
        reputationManager.submitFeedback(entity.agentId, ReputationCategory.Crafting, 2, `Crafted: ${instance?.displayName ?? outputItem?.name ?? recipeId}`);
      }
      server.log.info(
        `[leatherworking] ${entity.name} crafted ${instance?.displayName ?? outputItem?.name} (${instance?.quality.tier ?? "n/a"}) at ${station.name} → ${craftTx}`
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
