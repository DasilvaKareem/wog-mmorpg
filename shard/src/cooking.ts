import type { FastifyInstance } from "fastify";
import { getOrCreateZone } from "./zoneRuntime.js";
import { burnItem, mintItem } from "./blockchain.js";
import { hasLearnedProfession } from "./professions.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { getItemBalance } from "./blockchain.js";
import { authenticateRequest } from "./auth.js";

const COOKING_RANGE = 50;

export interface CookingRecipe {
  recipeId: string;
  name: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
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
    cookingTime: 3,
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
    cookingTime: 5,
    hpRestoration: 60,
  },
  {
    recipeId: "roasted_boar",
    name: "Roasted Boar",
    outputTokenId: 83n,
    outputQuantity: 1,
    requiredMaterials: [{ tokenId: 1n, quantity: 5 }], // Raw Meat x5
    cookingTime: 8,
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
    cookingTime: 12,
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
    cookingTime: 20,
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

    const zone = getOrCreateZone(zoneId);
    const entity = zone.entities.get(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    const campfire = zone.entities.get(campfireId);
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
      burnPromises.push(burnItem(walletAddress, mat.tokenId, BigInt(mat.quantity)));
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
      const cookTx = await mintItem(
        walletAddress,
        recipe.outputTokenId,
        BigInt(recipe.outputQuantity)
      );

      server.log.info(
        `[cooking] ${entity.name} cooked ${recipe.name} at ${campfire.name} → ${cookTx}`
      );

      return {
        ok: true,
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

    const zone = getOrCreateZone(zoneId);
    const entity = zone.entities.get(entityId);
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
      const burnTx = await burnItem(walletAddress, BigInt(foodTokenId), 1n);

      // Restore HP
      const healAmount = Math.min(recipe.hpRestoration, entity.maxHp - entity.hp);
      entity.hp = Math.min(entity.maxHp, entity.hp + recipe.hpRestoration);

      server.log.info(
        `[cooking] ${entity.name} consumed ${recipe.name}, restored ${healAmount} HP → ${burnTx}`
      );

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
