import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";
import { hasLearnedProfession } from "./professions.js";
import { mintItem, burnItem } from "./blockchain.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { authenticateRequest } from "./auth.js";

export interface AlchemyRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  goldCost: number;
  brewingTime: number; // seconds (for future use)
}

export const ALCHEMY_RECIPES: AlchemyRecipe[] = [
  // --- Basic Potions (Tier 1) ---
  {
    recipeId: "minor-health-potion",
    outputTokenId: 45n, // Minor Health Potion
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 31n, quantity: 2 }, // 2x Meadow Lily
      { tokenId: 33n, quantity: 1 }, // 1x Dandelion
    ],
    goldCost: 5,
    brewingTime: 10,
  },
  {
    recipeId: "minor-mana-potion",
    outputTokenId: 46n, // Minor Mana Potion
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 32n, quantity: 2 }, // 2x Wild Rose
      { tokenId: 34n, quantity: 1 }, // 1x Clover
    ],
    goldCost: 5,
    brewingTime: 10,
  },

  // --- Intermediate Elixirs (Tier 2) ---
  {
    recipeId: "stamina-elixir",
    outputTokenId: 47n, // Stamina Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 35n, quantity: 2 }, // 2x Lavender
      { tokenId: 37n, quantity: 1 }, // 1x Mint
    ],
    goldCost: 15,
    brewingTime: 15,
  },
  {
    recipeId: "wisdom-potion",
    outputTokenId: 48n, // Wisdom Potion
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 36n, quantity: 2 }, // 2x Sage
      { tokenId: 38n, quantity: 1 }, // 1x Moonflower
    ],
    goldCost: 25,
    brewingTime: 20,
  },
  {
    recipeId: "swift-step-potion",
    outputTokenId: 49n, // Swift Step Potion
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 37n, quantity: 2 }, // 2x Mint
      { tokenId: 34n, quantity: 2 }, // 2x Clover
    ],
    goldCost: 12,
    brewingTime: 12,
  },

  // --- Advanced Potions (Tier 3) ---
  {
    recipeId: "greater-health-potion",
    outputTokenId: 50n, // Greater Health Potion
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 38n, quantity: 1 }, // 1x Moonflower
      { tokenId: 35n, quantity: 2 }, // 2x Lavender
      { tokenId: 36n, quantity: 1 }, // 1x Sage
    ],
    goldCost: 40,
    brewingTime: 25,
  },
  {
    recipeId: "greater-mana-potion",
    outputTokenId: 51n, // Greater Mana Potion
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 39n, quantity: 1 }, // 1x Starbloom
      { tokenId: 37n, quantity: 2 }, // 2x Mint
      { tokenId: 35n, quantity: 1 }, // 1x Lavender
    ],
    goldCost: 50,
    brewingTime: 30,
  },

  // --- Master Elixirs (Tier 4) ---
  {
    recipeId: "elixir-of-strength",
    outputTokenId: 52n, // Elixir of Strength
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 1 }, // 1x Dragon's Breath
      { tokenId: 36n, quantity: 2 }, // 2x Sage
      { tokenId: 38n, quantity: 1 }, // 1x Moonflower
    ],
    goldCost: 80,
    brewingTime: 40,
  },
  {
    recipeId: "elixir-of-vitality",
    outputTokenId: 53n, // Elixir of Vitality
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 1 }, // 1x Dragon's Breath
      { tokenId: 38n, quantity: 2 }, // 2x Moonflower
      { tokenId: 39n, quantity: 1 }, // 1x Starbloom
    ],
    goldCost: 100,
    brewingTime: 45,
  },
  {
    recipeId: "philosophers-elixir",
    outputTokenId: 54n, // Philosopher's Elixir (legendary)
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 2 }, // 2x Dragon's Breath
      { tokenId: 39n, quantity: 2 }, // 2x Starbloom
      { tokenId: 38n, quantity: 2 }, // 2x Moonflower
    ],
    goldCost: 200,
    brewingTime: 60,
  },

  // --- Enchantment Elixirs (Special Tier) ---
  {
    recipeId: "fire-enchantment",
    outputTokenId: 55n, // Fire Enchantment Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 1 }, // 1x Dragon's Breath
      { tokenId: 35n, quantity: 3 }, // 3x Lavender
    ],
    goldCost: 60,
    brewingTime: 35,
  },
  {
    recipeId: "ice-enchantment",
    outputTokenId: 56n, // Ice Enchantment Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 38n, quantity: 2 }, // 2x Moonflower
      { tokenId: 37n, quantity: 2 }, // 2x Mint
    ],
    goldCost: 55,
    brewingTime: 32,
  },
  {
    recipeId: "lightning-enchantment",
    outputTokenId: 57n, // Lightning Enchantment Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 39n, quantity: 1 }, // 1x Starbloom
      { tokenId: 36n, quantity: 2 }, // 2x Sage
      { tokenId: 37n, quantity: 1 }, // 1x Mint
    ],
    goldCost: 65,
    brewingTime: 38,
  },
  {
    recipeId: "holy-enchantment",
    outputTokenId: 58n, // Holy Enchantment Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 38n, quantity: 2 }, // 2x Moonflower
      { tokenId: 31n, quantity: 3 }, // 3x Meadow Lily
      { tokenId: 36n, quantity: 1 }, // 1x Sage
    ],
    goldCost: 70,
    brewingTime: 40,
  },
  {
    recipeId: "shadow-enchantment",
    outputTokenId: 59n, // Shadow Enchantment Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 1 }, // 1x Dragon's Breath
      { tokenId: 39n, quantity: 1 }, // 1x Starbloom
      { tokenId: 36n, quantity: 2 }, // 2x Sage
    ],
    goldCost: 75,
    brewingTime: 42,
  },
  {
    recipeId: "sharpness-elixir",
    outputTokenId: 60n, // Sharpness Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 1 }, // 1x Dragon's Breath
      { tokenId: 38n, quantity: 1 }, // 1x Moonflower
      { tokenId: 35n, quantity: 2 }, // 2x Lavender
    ],
    goldCost: 80,
    brewingTime: 45,
  },
  {
    recipeId: "durability-elixir",
    outputTokenId: 61n, // Durability Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 39n, quantity: 2 }, // 2x Starbloom
      { tokenId: 35n, quantity: 2 }, // 2x Lavender
    ],
    goldCost: 70,
    brewingTime: 38,
  },
];

export function getAlchemyRecipeById(recipeId: string): AlchemyRecipe | undefined {
  return ALCHEMY_RECIPES.find((r) => r.recipeId === recipeId);
}

export function registerAlchemyRoutes(server: FastifyInstance) {
  // GET /alchemy/recipes - list all alchemy recipes
  server.get("/alchemy/recipes", async () => {
    return ALCHEMY_RECIPES.map((recipe) => {
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
        brewingTime: recipe.brewingTime,
      };
    });
  });

  // GET /alchemy/recipes/tier/:tier - filter recipes by tier
  server.get<{ Params: { tier: string } }>(
    "/alchemy/recipes/tier/:tier",
    async (request, reply) => {
      const tier = parseInt(request.params.tier);
      if (isNaN(tier) || tier < 1 || tier > 4) {
        reply.code(400);
        return { error: "Invalid tier. Must be 1-4." };
      }

      // Tier 1: recipes 0-1, Tier 2: 2-4, Tier 3: 5-6, Tier 4: 7-9
      const tierRanges = {
        1: [0, 1],
        2: [2, 4],
        3: [5, 6],
        4: [7, 9],
      };

      const [start, end] = tierRanges[tier as 1 | 2 | 3 | 4];
      const filtered = ALCHEMY_RECIPES.slice(start, end + 1);

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
          goldCost: recipe.goldCost,
          brewingTime: recipe.brewingTime,
        };
      });
    }
  );

  // POST /alchemy/brew - craft a potion at an alchemy lab
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      alchemyLabId: string; // Alchemy Lab NPC entity ID
      recipeId: string;
    };
  }>("/alchemy/brew", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, alchemyLabId, recipeId } = request.body;
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
    const recipe = getAlchemyRecipeById(recipeId);
    if (!recipe) {
      reply.code(404);
      return { error: "Recipe not found" };
    }

    // Check profession requirement
    if (!hasLearnedProfession(walletAddress, "alchemy")) {
      reply.code(400);
      return {
        error: "You must learn Alchemy to brew potions",
        requiredProfession: "alchemy",
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

    const alchemyLab = zone.entities.get(alchemyLabId);
    if (!alchemyLab || alchemyLab.type !== "alchemy-lab") {
      reply.code(404);
      return { error: "Alchemy Lab not found" };
    }

    // Check range (must be within 100 units of alchemy lab)
    const dx = alchemyLab.x - entity.x;
    const dy = alchemyLab.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) {
      reply.code(400);
      return {
        error: "Too far from Alchemy Lab",
        distance: Math.round(dist),
        maxRange: 100,
      };
    }

    // TODO: Check gold balance and deduct cost
    // For now, we'll skip the gold check

    // CRITICAL: Burn required materials (consume flower NFTs)
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
      server.log.error(err, `[alchemy] Failed to burn materials for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Failed to consume flowers - you may not have enough materials",
        hint: "Check your wallet inventory for required flowers",
      };
    }

    // Mint crafted potion
    try {
      const potionTx = await mintItem(
        walletAddress,
        recipe.outputTokenId,
        BigInt(recipe.outputQuantity)
      );

      const outputItem = getItemByTokenId(recipe.outputTokenId);

      server.log.info(
        `[alchemy] ${entity.name} brewed ${outputItem?.name} at ${alchemyLab.name} → ${potionTx}`
      );

      return {
        ok: true,
        recipeId: recipe.recipeId,
        brewed: {
          tokenId: recipe.outputTokenId.toString(),
          name: outputItem?.name ?? "Unknown",
          quantity: recipe.outputQuantity,
          tx: potionTx,
        },
        materialsConsumed: burnedMaterials,
        goldCost: recipe.goldCost,
      };
    } catch (err) {
      server.log.error(err, `[alchemy] Failed to mint potion for ${walletAddress}`);

      // TODO: Refund burned materials on mint failure
      // This is a critical edge case - materials were consumed but potion wasn't created

      reply.code(500);
      return {
        error: "Brewing failed - potion could not be created",
        materialsConsumed: burnedMaterials,
        warning: "Flowers were consumed but potion creation failed - contact support",
      };
    }
  });
}
