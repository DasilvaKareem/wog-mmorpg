import type { FastifyInstance } from "fastify";
import { getEntity, getOrCreateZone } from "../world/zoneRuntime.js";
import { enqueueItemBurn, enqueueItemMint } from "../blockchain/blockchain.js";
import { hasLearnedProfession } from "./professions.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { getItemBalance } from "../blockchain/blockchain.js";
import { authenticateRequest } from "../auth/auth.js";
import { logDiary, narrativeCook, narrativeConsume } from "../social/diary.js";
import { awardProfessionXp, PROFESSION_XP, getProfessionSkills, rollFailure } from "./professionXp.js";
import { advanceGatherQuests } from "../social/questSystem.js";
import { logZoneEvent } from "../world/zoneEvents.js";

const COOKING_RANGE = 50;
const lastCookTime = new Map<string, number>();

export interface CookingRecipe {
  recipeId: string;
  name: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  requiredSkillLevel: number; // cooking skill level (1-300) needed to cook
  cookingTime: number; // seconds
  hpRestoration: number;
}

export const COOKING_RECIPES: CookingRecipe[] = [
  {
    recipeId: "cooked_meat",
    name: "Cooked Meat",
    outputTokenId: 81n,
    outputQuantity: 1,
    requiredMaterials: [{ tokenId: 1n, quantity: 1 }], // Raw Meat x1
    requiredSkillLevel: 1,
    cookingTime: 6,
    hpRestoration: 30,
  },
  {
    recipeId: "hearty_stew",
    name: "Hearty Stew",
    outputTokenId: 82n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 1n, quantity: 3 }, // Raw Meat x3
      { tokenId: 31n, quantity: 1 }, // Meadow Lily x1 (herbs)
    ],
    requiredSkillLevel: 15,
    cookingTime: 10,
    hpRestoration: 60,
  },
  {
    recipeId: "roasted_boar",
    name: "Roasted Boar",
    outputTokenId: 83n,
    outputQuantity: 1,
    requiredMaterials: [{ tokenId: 1n, quantity: 5 }], // Raw Meat x5
    requiredSkillLevel: 35,
    cookingTime: 16,
    hpRestoration: 100,
  },
  {
    recipeId: "bear_feast",
    name: "Bear Feast",
    outputTokenId: 84n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 1n, quantity: 8 }, // Raw Meat x8
      { tokenId: 35n, quantity: 2 }, // Lavender x2 (spices)
    ],
    requiredSkillLevel: 60,
    cookingTime: 24,
    hpRestoration: 150,
  },
  {
    recipeId: "heros_banquet",
    name: "Hero's Banquet",
    outputTokenId: 85n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 1n, quantity: 15 }, // Raw Meat x15
      { tokenId: 40n, quantity: 3 }, // Dragon's Breath x3 (rare spice)
    ],
    requiredSkillLevel: 100,
    cookingTime: 40,
    hpRestoration: 250,
  },
];

export function registerCookingRoutes(server: FastifyInstance) {
  // GET /cooking/recipes - list all cooking recipes
  server.get("/cooking/recipes", async () => {
    return {
      recipes: COOKING_RECIPES.map((r) => ({
        recipeId: r.recipeId,
        name: r.name,
        outputTokenId: r.outputTokenId.toString(),
        outputQuantity: r.outputQuantity,
        requiredMaterials: r.requiredMaterials.map((m) => ({
          tokenId: m.tokenId.toString(),
          quantity: m.quantity,
          itemName: getItemByTokenId(m.tokenId)?.name ?? "Unknown",
        })),
        requiredSkillLevel: r.requiredSkillLevel,
        cookingTime: r.cookingTime,
        hpRestoration: r.hpRestoration,
      })),
    };
  });

  // POST /cooking/cook - cook a recipe at a campfire
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      campfireId: string;
      recipeId: string;
    };
  }>("/cooking/cook", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, campfireId, recipeId } = request.body;
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

    // Check cooking profession
    if (!hasLearnedProfession(walletAddress, "cooking")) {
      reply.code(400);
      return { error: "Cooking profession not learned. Visit a cooking trainer." };
    }

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    const campfire = getEntity(campfireId);
    if (!campfire || campfire.type !== "campfire") {
      reply.code(404);
      return { error: "Campfire not found" };
    }

    // Check range to campfire
    const dx = campfire.x - entity.x;
    const dy = campfire.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > COOKING_RANGE) {
      reply.code(400);
      return {
        error: "Too far from campfire",
        distance: Math.round(dist),
        maxRange: COOKING_RANGE,
      };
    }

    // Find recipe
    const recipe = COOKING_RECIPES.find((r) => r.recipeId === recipeId);
    if (!recipe) {
      reply.code(404);
      return { error: "Recipe not found" };
    }

    // Check skill level requirement
    const skills = getProfessionSkills(walletAddress);
    const currentSkillLevel = skills["cooking"]?.level ?? 1;
    if (currentSkillLevel < recipe.requiredSkillLevel) {
      reply.code(400);
      return {
        error: `Cooking skill too low for this recipe`,
        requiredSkillLevel: recipe.requiredSkillLevel,
        currentSkillLevel,
        hint: `Cook simpler recipes to raise your skill from ${currentSkillLevel} to ${recipe.requiredSkillLevel}`,
      };
    }

    // Enforce cooking cooldown
    const cooldownMs = recipe.cookingTime * 1000;
    const lastCook = lastCookTime.get(walletAddress.toLowerCase());
    if (lastCook && Date.now() - lastCook < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (Date.now() - lastCook)) / 1000);
      reply.code(429);
      return { error: "Cooking too fast", cooldownRemaining: remaining };
    }

    // Roll for failure
    const { failed, failChance } = rollFailure(currentSkillLevel, recipe.requiredSkillLevel);
    if (failed) {
      lastCookTime.set(walletAddress.toLowerCase(), Date.now());
      const halfXp = recipeId === "cooked_meat"
        ? Math.floor(PROFESSION_XP.COOK_TIER1 / 2)
        : recipeId === "hearty_stew"
          ? Math.floor(PROFESSION_XP.COOK_TIER2 / 2)
          : Math.floor(PROFESSION_XP.COOK_TIER3 / 2);
      awardProfessionXp(entity, zoneId, halfXp, "cooking");
      return {
        ok: false,
        failed: true,
        failChance,
        recipeId: recipe.recipeId,
        message: "The food burned on the fire. No ingredients consumed.",
      };
    }

    // Check material balances
    for (const mat of recipe.requiredMaterials) {
      const balance = await getItemBalance(walletAddress, mat.tokenId);
      if (balance < BigInt(mat.quantity)) {
        const item = getItemByTokenId(mat.tokenId);
        reply.code(400);
        return {
          error: `Insufficient materials: need ${mat.quantity}x ${item?.name ?? "Unknown"}`,
        };
      }
    }

    // Burn materials
    const burnPromises: Promise<string>[] = [];
    for (const mat of recipe.requiredMaterials) {
      burnPromises.push(enqueueItemBurn(walletAddress, mat.tokenId, BigInt(mat.quantity)));
    }

    try {
      await Promise.all(burnPromises);
    } catch (err) {
      server.log.error(err, `[cooking] Failed to burn materials for ${walletAddress}`);
      reply.code(500);
      return { error: "Failed to burn cooking materials" };
    }

    // Mint cooked food
    try {
      const cookTx = await enqueueItemMint(
        walletAddress,
        recipe.outputTokenId,
        BigInt(recipe.outputQuantity)
      );

      // Award profession XP based on recipe tier
      const cookXp = recipeId === "cooked_meat"
        ? PROFESSION_XP.COOK_TIER1
        : recipeId === "hearty_stew"
          ? PROFESSION_XP.COOK_TIER2
          : PROFESSION_XP.COOK_TIER3;
      const profXpResult = awardProfessionXp(entity, zoneId, cookXp, "cooking", recipe.name);

      advanceGatherQuests(entity, recipe.name);

      if (entity.agentId != null) {
        reputationManager.submitFeedback(entity.agentId, ReputationCategory.Crafting, 1, `Crafted: ${recipe.name}`);
      }
      server.log.info(
        `[cooking] ${entity.name} cooked ${recipe.name} at ${campfire.name} → ${cookTx}`
      );

      // Emit zone event for client speech bubbles
      logZoneEvent({
        zoneId,
        type: "loot",
        tick: 0,
        message: `${entity.name}: Cooked ${recipe.name}`,
        entityId: entity.id,
        entityName: entity.name,
        data: { craftType: "cooking", itemName: recipe.name, recipeId },
      });

      // Log cook diary entry
      if (walletAddress) {
        const { headline, narrative } = narrativeCook(entity.name, entity.raceId, entity.classId, zoneId, recipe.name, campfire.name);
        logDiary(walletAddress, entity.name, zoneId, entity.x, entity.y, "cook", headline, narrative, {
          recipeName: recipe.name,
          campfireName: campfire.name,
          hpRestoration: recipe.hpRestoration,
        });
      }

      lastCookTime.set(walletAddress.toLowerCase(), Date.now());

      return {
        ok: true,
        professionXp: profXpResult,
        recipe: recipe.name,
        quantity: recipe.outputQuantity,
        tokenId: recipe.outputTokenId.toString(),
        hpRestoration: recipe.hpRestoration,
        cookingTime: recipe.cookingTime,
        tx: cookTx,
      };
    } catch (err) {
      server.log.error(err, `[cooking] Failed to mint ${recipe.name} for ${walletAddress}`);
      reply.code(500);
      return { error: "Cooking transaction failed" };
    }
  });

  // POST /cooking/consume - eat cooked food to restore HP
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      foodTokenId: number;
    };
  }>("/cooking/consume", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, foodTokenId } = request.body;
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

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    // Check if item is food
    const food = getItemByTokenId(BigInt(foodTokenId));
    if (!food || food.category !== "consumable") {
      reply.code(400);
      return { error: "Item is not consumable food" };
    }

    // Check if cooked food (tokenIds 81-85)
    const recipe = COOKING_RECIPES.find((r) => r.outputTokenId === BigInt(foodTokenId));
    if (!recipe) {
      reply.code(400);
      return { error: "Item is not cooked food. Use /cooking/cook first." };
    }

    // Check ownership
    const balance = await getItemBalance(walletAddress, BigInt(foodTokenId));
    if (balance < 1n) {
      reply.code(400);
      return { error: "You don't own this food item" };
    }

    // Burn the food item
    try {
      const burnTx = await enqueueItemBurn(walletAddress, BigInt(foodTokenId), 1n);

      // Restore HP
      const healAmount = Math.min(recipe.hpRestoration, entity.maxHp - entity.hp);
      entity.hp = Math.min(entity.maxHp, entity.hp + recipe.hpRestoration);

      const zone = getOrCreateZone(zoneId);
      logZoneEvent({
        zoneId,
        type: "consume",
        tick: zone.tick,
        message: `${entity.name} ate ${recipe.name}`,
        entityId: entity.id,
        entityName: entity.name,
        data: {
          itemName: recipe.name,
          consumeType: "food",
          hpRestored: healAmount,
          mpRestored: 0,
        },
      });

      server.log.info(
        `[cooking] ${entity.name} consumed ${recipe.name}, restored ${healAmount} HP → ${burnTx}`
      );

      // Log consume diary entry
      if (walletAddress) {
        const { headline, narrative } = narrativeConsume(entity.name, entity.raceId, entity.classId, zoneId, recipe.name, healAmount);
        logDiary(walletAddress, entity.name, zoneId, entity.x, entity.y, "consume", headline, narrative, {
          foodName: recipe.name,
          hpRestored: healAmount,
          currentHp: entity.hp,
          maxHp: entity.maxHp,
        });
      }

      return {
        ok: true,
        consumed: recipe.name,
        hpRestored: healAmount,
        currentHp: entity.hp,
        maxHp: entity.maxHp,
        tx: burnTx,
      };
    } catch (err) {
      server.log.error(err, `[cooking] Failed to consume ${recipe.name} for ${walletAddress}`);
      reply.code(500);
      return { error: "Failed to consume food" };
    }
  });
}
