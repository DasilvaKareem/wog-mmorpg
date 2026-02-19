import type { FastifyInstance } from "fastify";
import { getAllZones, getOrCreateZone, type Entity } from "./zoneRuntime.js";
import { hasLearnedProfession } from "./professions.js";
import { mintItem, burnItem, getItemBalance } from "./blockchain.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { authenticateRequest } from "./auth.js";
import { logDiary, narrativeBrew, narrativeConsume } from "./diary.js";
import { awardProfessionXp, PROFESSION_XP } from "./professionXp.js";
import { logZoneEvent } from "./zoneEvents.js";
import { getPotionEffect, type PotionEffect } from "./potionEffects.js";
import { randomUUID } from "crypto";

export interface AlchemyRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  copperCost: number;
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
    copperCost: 5,
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
    copperCost: 5,
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
    copperCost: 15,
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
    copperCost: 25,
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
    copperCost: 12,
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
    copperCost: 40,
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
    copperCost: 50,
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
    copperCost: 80,
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
    copperCost: 100,
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
    copperCost: 200,
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
    copperCost: 60,
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
    copperCost: 55,
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
    copperCost: 65,
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
    copperCost: 70,
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
    copperCost: 75,
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
    copperCost: 80,
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
    copperCost: 70,
    brewingTime: 38,
  },
  // --- Gate Reagents (Dungeon Key crafting pipeline) ---
  {
    recipeId: "crude-gate-essence",
    outputTokenId: 128n, // Crude Gate Essence
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 31n, quantity: 5 }, // 5x Meadow Lily
      { tokenId: 33n, quantity: 3 }, // 3x Dandelion
      { tokenId: 22n, quantity: 2 }, // 2x Coal Ore
    ],
    copperCost: 15,
    brewingTime: 20,
  },
  {
    recipeId: "lesser-gate-essence",
    outputTokenId: 129n, // Lesser Gate Essence
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 35n, quantity: 4 }, // 4x Lavender
      { tokenId: 34n, quantity: 3 }, // 3x Clover
      { tokenId: 23n, quantity: 3 }, // 3x Tin Ore
    ],
    copperCost: 30,
    brewingTime: 25,
  },
  {
    recipeId: "gate-essence",
    outputTokenId: 130n, // Gate Essence
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 36n, quantity: 4 }, // 4x Sage
      { tokenId: 38n, quantity: 2 }, // 2x Moonflower
      { tokenId: 24n, quantity: 3 }, // 3x Copper Ore
    ],
    copperCost: 60,
    brewingTime: 35,
  },
  {
    recipeId: "greater-gate-essence",
    outputTokenId: 131n, // Greater Gate Essence
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 38n, quantity: 4 }, // 4x Moonflower
      { tokenId: 39n, quantity: 2 }, // 2x Starbloom
      { tokenId: 25n, quantity: 3 }, // 3x Silver Ore
    ],
    copperCost: 100,
    brewingTime: 45,
  },
  {
    recipeId: "superior-gate-essence",
    outputTokenId: 132n, // Superior Gate Essence
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 39n, quantity: 4 }, // 4x Starbloom
      { tokenId: 40n, quantity: 2 }, // 2x Dragon's Breath
      { tokenId: 26n, quantity: 3 }, // 3x Gold Ore
      { tokenId: 121n, quantity: 1 }, // 1x Arcane Crystal
    ],
    copperCost: 180,
    brewingTime: 55,
  },
  {
    recipeId: "supreme-gate-essence",
    outputTokenId: 133n, // Supreme Gate Essence
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 4 }, // 4x Dragon's Breath
      { tokenId: 39n, quantity: 4 }, // 4x Starbloom
      { tokenId: 26n, quantity: 5 }, // 5x Gold Ore
      { tokenId: 121n, quantity: 2 }, // 2x Arcane Crystal
    ],
    copperCost: 300,
    brewingTime: 60,
  },

  // --- Tonics (XP Boosts, Tier 5) ---
  {
    recipeId: "meadow-tonic",
    outputTokenId: 140n, // Meadow Tonic (+50% XP, 5 min)
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 31n, quantity: 3 }, // 3x Meadow Lily
      { tokenId: 34n, quantity: 2 }, // 2x Clover
      { tokenId: 150n, quantity: 1 }, // 1x Dew Nectar
    ],
    copperCost: 20,
    brewingTime: 15,
  },
  {
    recipeId: "starbloom-tonic",
    outputTokenId: 141n, // Starbloom Tonic (+100% XP, 10 min)
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 39n, quantity: 2 }, // 2x Starbloom
      { tokenId: 36n, quantity: 2 }, // 2x Sage
      { tokenId: 152n, quantity: 2 }, // 2x Moonpetal Nectar
    ],
    copperCost: 60,
    brewingTime: 25,
  },
  {
    recipeId: "dragons-breath-tonic",
    outputTokenId: 142n, // Dragon's Breath Tonic (+200% XP, 15 min)
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 2 }, // 2x Dragon's Breath
      { tokenId: 39n, quantity: 1 }, // 1x Starbloom
      { tokenId: 153n, quantity: 2 }, // 2x Emberveil Nectar
    ],
    copperCost: 120,
    brewingTime: 40,
  },
  {
    recipeId: "apprentice-tonic",
    outputTokenId: 143n, // Apprentice's Tonic (+50% profession XP, 10 min)
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 36n, quantity: 3 }, // 3x Sage
      { tokenId: 37n, quantity: 2 }, // 2x Mint
      { tokenId: 151n, quantity: 1 }, // 1x Suncrest Nectar
    ],
    copperCost: 35,
    brewingTime: 20,
  },

  // --- Resistance Elixirs (required for L25+ zones, Tier 6) ---
  {
    recipeId: "fire-resistance-elixir",
    outputTokenId: 144n, // Fire Resistance Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 38n, quantity: 2 }, // 2x Moonflower
      { tokenId: 37n, quantity: 3 }, // 3x Mint
      { tokenId: 153n, quantity: 1 }, // 1x Emberveil Nectar
    ],
    copperCost: 45,
    brewingTime: 25,
  },
  {
    recipeId: "shadow-resistance-elixir",
    outputTokenId: 145n, // Shadow Resistance Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 38n, quantity: 2 }, // 2x Moonflower
      { tokenId: 35n, quantity: 3 }, // 3x Lavender
      { tokenId: 154n, quantity: 1 }, // 1x Gloomveil Nectar
    ],
    copperCost: 45,
    brewingTime: 25,
  },
  {
    recipeId: "ice-resistance-elixir",
    outputTokenId: 146n, // Ice Resistance Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 40n, quantity: 1 }, // 1x Dragon's Breath
      { tokenId: 37n, quantity: 2 }, // 2x Mint
      { tokenId: 151n, quantity: 1 }, // 1x Suncrest Nectar
    ],
    copperCost: 55,
    brewingTime: 30,
  },
  {
    recipeId: "lightning-resistance-elixir",
    outputTokenId: 147n, // Lightning Resistance Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 39n, quantity: 2 }, // 2x Starbloom
      { tokenId: 36n, quantity: 2 }, // 2x Sage
      { tokenId: 155n, quantity: 1 }, // 1x Stormwell Nectar
    ],
    copperCost: 50,
    brewingTime: 28,
  },
  {
    recipeId: "holy-resistance-elixir",
    outputTokenId: 148n, // Holy Resistance Elixir
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 38n, quantity: 3 }, // 3x Moonflower
      { tokenId: 31n, quantity: 3 }, // 3x Meadow Lily
      { tokenId: 152n, quantity: 1 }, // 1x Moonpetal Nectar
    ],
    copperCost: 50,
    brewingTime: 28,
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
        copperCost: recipe.copperCost,
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
          copperCost: recipe.copperCost,
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

      // Award profession XP based on potion tier
      const isMinor = recipeId.startsWith("minor-");
      const isMid = ["stamina-elixir", "wisdom-potion", "swift-step-potion"].includes(recipeId);
      const brewXp = isMinor
        ? PROFESSION_XP.BREW_TIER1
        : isMid
          ? PROFESSION_XP.BREW_TIER2
          : PROFESSION_XP.BREW_TIER3;
      const profXpResult = awardProfessionXp(entity, zoneId, brewXp, "alchemy", outputItem?.name);

      server.log.info(
        `[alchemy] ${entity.name} brewed ${outputItem?.name} at ${alchemyLab.name} → ${potionTx}`
      );

      // Log brew diary entry
      if (walletAddress) {
        const potionName = outputItem?.name ?? "Unknown Potion";
        const { headline, narrative } = narrativeBrew(entity.name, entity.raceId, entity.classId, zoneId, potionName, alchemyLab.name);
        logDiary(walletAddress, entity.name, zoneId, entity.x, entity.y, "brew", headline, narrative, {
          recipeId: recipe.recipeId,
          potionName,
          labName: alchemyLab.name,
        });
      }

      return {
        ok: true,
        recipeId: recipe.recipeId,
        professionXp: profXpResult,
        brewed: {
          tokenId: recipe.outputTokenId.toString(),
          name: outputItem?.name ?? "Unknown",
          quantity: recipe.outputQuantity,
          tx: potionTx,
        },
        materialsConsumed: burnedMaterials,
        copperCost: recipe.copperCost,
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

  // ── POST /alchemy/consume — drink a potion/elixir/tonic ───────────
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      tokenId: number;
    };
  }>("/alchemy/consume", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, tokenId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

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

    // Look up potion effect
    const effect = getPotionEffect(BigInt(tokenId));
    if (!effect) {
      reply.code(400);
      return { error: "Item is not a consumable potion, elixir, or tonic" };
    }

    // Check ownership
    const balance = await getItemBalance(walletAddress, BigInt(tokenId));
    if (balance < 1n) {
      reply.code(400);
      return { error: "You don't own this item" };
    }

    // Burn the consumable NFT
    let burnTx: string;
    try {
      burnTx = await burnItem(walletAddress, BigInt(tokenId), 1n);
    } catch (err) {
      server.log.error(err, `[alchemy] Failed to burn consumable for ${walletAddress}`);
      reply.code(500);
      return { error: "Failed to consume item" };
    }

    const item = getItemByTokenId(BigInt(tokenId));
    const itemName = item?.name ?? "Unknown";
    const results: Record<string, unknown> = { ok: true, consumed: itemName, category: effect.category, tx: burnTx };

    // Apply instant HP restore
    if (effect.hpRestore && effect.hpRestore > 0) {
      const healed = Math.min(effect.hpRestore, entity.maxHp - entity.hp);
      entity.hp = Math.min(entity.maxHp, entity.hp + effect.hpRestore);
      results.hpRestored = healed;
      results.currentHp = entity.hp;
      results.maxHp = entity.maxHp;
    }

    // Apply instant MP restore
    if (effect.mpRestore && effect.mpRestore > 0 && entity.essence != null && entity.maxEssence != null) {
      const restored = Math.min(effect.mpRestore, entity.maxEssence - entity.essence);
      entity.essence = Math.min(entity.maxEssence, entity.essence + effect.mpRestore);
      results.mpRestored = restored;
      results.currentMp = entity.essence;
      results.maxMp = entity.maxEssence;
    }

    // Apply buff as ActiveEffect
    if (effect.buff) {
      if (!entity.activeEffects) entity.activeEffects = [];

      // Remove existing buff with same name (don't stack, refresh instead)
      entity.activeEffects = entity.activeEffects.filter((e) => e.name !== effect.buff!.name);

      entity.activeEffects.push({
        id: randomUUID(),
        techniqueId: `potion-${tokenId}`,
        name: effect.buff.name,
        type: effect.buff.type,
        casterId: entity.id,
        appliedAtTick: zone.tick,
        durationTicks: effect.buff.durationTicks,
        remainingTicks: effect.buff.durationTicks,
        ...(effect.buff.statModifiers && { statModifiers: effect.buff.statModifiers }),
        ...(effect.buff.hotHealPerTick && { hotHealPerTick: effect.buff.hotHealPerTick }),
        ...(effect.buff.shieldHp && { shieldHp: effect.buff.shieldHp, shieldMaxHp: effect.buff.shieldHp }),
      });

      results.buffApplied = {
        name: effect.buff.name,
        durationSeconds: Math.round(effect.buff.durationTicks / 2), // 500ms ticks
        ...(effect.buff.statModifiers && { statModifiers: effect.buff.statModifiers }),
        ...(effect.xpMultiplier && { xpMultiplier: effect.xpMultiplier }),
        ...(effect.elementResist && { elementResist: effect.elementResist }),
      };
    }

    // Log zone event
    logZoneEvent({
      zoneId,
      type: "system",
      tick: zone.tick,
      message: `${entity.name} consumed ${itemName}`,
      entityId: entity.id,
      entityName: entity.name,
    });

    // Log diary
    if (walletAddress) {
      const hpRestored = (results.hpRestored as number) ?? 0;
      const { headline, narrative } = narrativeConsume(entity.name, entity.raceId, entity.classId, zoneId, itemName, hpRestored);
      logDiary(walletAddress, entity.name, zoneId, entity.x, entity.y, "consume", headline, narrative, {
        itemName,
        category: effect.category,
        ...(effect.buff && { buffName: effect.buff.name }),
        ...(effect.xpMultiplier && { xpMultiplier: effect.xpMultiplier }),
      });
    }

    server.log.info(`[alchemy] ${entity.name} consumed ${itemName} (${effect.category}) → ${burnTx}`);
    return results;
  });

  // ── GET /alchemy/consumables — list all consumable effects ─────────
  server.get("/alchemy/consumables", async () => {
    const { POTION_EFFECTS } = await import("./potionEffects.js");
    return Object.values(POTION_EFFECTS).map((effect: PotionEffect) => {
      const item = getItemByTokenId(effect.tokenId);
      return {
        tokenId: effect.tokenId.toString(),
        name: item?.name ?? "Unknown",
        category: effect.category,
        ...(effect.hpRestore && { hpRestore: effect.hpRestore }),
        ...(effect.mpRestore && { mpRestore: effect.mpRestore }),
        ...(effect.xpMultiplier && { xpMultiplier: effect.xpMultiplier }),
        ...(effect.elementResist && { elementResist: effect.elementResist }),
        ...(effect.buff && {
          buff: {
            name: effect.buff.name,
            type: effect.buff.type,
            durationSeconds: Math.round(effect.buff.durationTicks / 2),
            ...(effect.buff.statModifiers && { statModifiers: effect.buff.statModifiers }),
          },
        }),
      };
    });
  });
}
