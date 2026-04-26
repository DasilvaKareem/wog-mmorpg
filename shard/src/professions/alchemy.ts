import type { FastifyInstance } from "fastify";
import { getEntity, getOrCreateZone, type Entity } from "../world/zoneRuntime.js";
import { hasLearnedProfession } from "./professions.js";
import { enqueueItemMint, enqueueItemBurn, getItemBalance, getGoldBalance } from "../blockchain/blockchain.js";
import { queueItemMint } from "../blockchain/chainBatcher.js";
import { getAvailableGoldAsync, formatGold, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { authenticateRequest } from "../auth/auth.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { logDiary, narrativeBrew, narrativeConsume } from "../social/diary.js";
import { awardProfessionXp, PROFESSION_XP, getProfessionSkills, rollFailure } from "./professionXp.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { copperToGold } from "../blockchain/currency.js";
import { getPotionEffect, type PotionEffect } from "./potionEffects.js";
import { randomUUID } from "crypto";
import { advanceGatherQuests } from "../social/questSystem.js";

const lastBrewTime = new Map<string, number>();

async function controlsWallet(
  authenticatedWallet: string,
  targetWallet: string | undefined | null
): Promise<boolean> {
  if (!targetWallet) return false;
  if (authenticatedWallet.toLowerCase() === targetWallet.toLowerCase()) return true;
  const custodialWallet = await getAgentCustodialWallet(authenticatedWallet);
  return custodialWallet?.toLowerCase() === targetWallet.toLowerCase();
}

export interface AlchemyRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  copperCost: number;
  requiredSkillLevel: number; // alchemy skill level (1-300) needed to brew
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
    requiredSkillLevel: 1,
    brewingTime: 20,
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
    requiredSkillLevel: 1,
    brewingTime: 20,
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
    requiredSkillLevel: 25,
    brewingTime: 30,
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
    requiredSkillLevel: 35,
    brewingTime: 40,
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
    requiredSkillLevel: 15,
    brewingTime: 24,
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
    requiredSkillLevel: 50,
    brewingTime: 50,
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
    requiredSkillLevel: 60,
    brewingTime: 60,
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
    requiredSkillLevel: 75,
    brewingTime: 80,
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
    requiredSkillLevel: 100,
    brewingTime: 90,
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
    requiredSkillLevel: 150,
    brewingTime: 120,
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
    requiredSkillLevel: 75,
    brewingTime: 70,
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
    requiredSkillLevel: 75,
    brewingTime: 64,
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
    requiredSkillLevel: 85,
    brewingTime: 76,
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
    requiredSkillLevel: 90,
    brewingTime: 80,
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
    requiredSkillLevel: 100,
    brewingTime: 84,
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
    requiredSkillLevel: 110,
    brewingTime: 90,
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
    requiredSkillLevel: 100,
    brewingTime: 76,
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
    requiredSkillLevel: 10,
    brewingTime: 40,
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
    requiredSkillLevel: 30,
    brewingTime: 50,
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
    requiredSkillLevel: 60,
    brewingTime: 70,
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
    requiredSkillLevel: 90,
    brewingTime: 90,
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
    requiredSkillLevel: 125,
    brewingTime: 110,
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
    requiredSkillLevel: 175,
    brewingTime: 120,
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
    requiredSkillLevel: 20,
    brewingTime: 30,
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
    requiredSkillLevel: 60,
    brewingTime: 50,
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
    requiredSkillLevel: 125,
    brewingTime: 80,
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
    requiredSkillLevel: 40,
    brewingTime: 40,
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
    requiredSkillLevel: 50,
    brewingTime: 50,
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
    requiredSkillLevel: 50,
    brewingTime: 50,
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
    requiredSkillLevel: 65,
    brewingTime: 60,
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
    requiredSkillLevel: 60,
    brewingTime: 56,
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
    requiredSkillLevel: 55,
    brewingTime: 56,
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
        requiredSkillLevel: recipe.requiredSkillLevel,
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

      // Tier 1: basic potions, Tier 2: intermediate elixirs, Tier 3: advanced, Tier 4: master
      const tierRanges: Record<number, [number, number]> = {
        1: [0, 1],    // minor-health, minor-mana
        2: [2, 4],    // stamina, wisdom, swift-step
        3: [5, 16],   // greater potions, stat elixirs, enchantments
        4: [17, ALCHEMY_RECIPES.length - 1], // gate essences, tonics, resistance elixirs
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
          requiredSkillLevel: recipe.requiredSkillLevel,
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
    if (!(await controlsWallet(authenticatedWallet, walletAddress))) {
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

    // Check skill level requirement
    const skills = getProfessionSkills(walletAddress);
    const currentSkillLevel = skills["alchemy"]?.level ?? 1;
    if (currentSkillLevel < recipe.requiredSkillLevel) {
      reply.code(400);
      return {
        error: `Alchemy skill too low for this recipe`,
        requiredSkillLevel: recipe.requiredSkillLevel,
        currentSkillLevel,
        hint: `Brew simpler potions to raise your skill from ${currentSkillLevel} to ${recipe.requiredSkillLevel}`,
      };
    }

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }
    if (entity.type !== "player") {
      reply.code(400);
      return { error: "Only player entities can brew potions" };
    }
    if (!(await controlsWallet(authenticatedWallet, entity.walletAddress))) {
      reply.code(403);
      return { error: "Not authorized to control this player" };
    }
    if (entity.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
      reply.code(400);
      return { error: "walletAddress does not match entity owner" };
    }

    // Enforce brewing cooldown
    const cooldownMs = recipe.brewingTime * 1000;
    const lastBrew = lastBrewTime.get(walletAddress.toLowerCase());
    if (lastBrew && Date.now() - lastBrew < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (Date.now() - lastBrew)) / 1000);
      reply.code(429);
      return { error: "Brewing too fast", cooldownRemaining: remaining };
    }

    // Roll for failure
    const { failed, failChance } = rollFailure(currentSkillLevel, recipe.requiredSkillLevel);
    if (failed) {
      lastBrewTime.set(walletAddress.toLowerCase(), Date.now());
      const halfXp = recipe.copperCost <= 15
        ? Math.floor(PROFESSION_XP.BREW_TIER1 / 2)
        : recipe.copperCost <= 50
          ? Math.floor(PROFESSION_XP.BREW_TIER2 / 2)
          : Math.floor(PROFESSION_XP.BREW_TIER3 / 2);
      awardProfessionXp(entity, zoneId, halfXp, "alchemy");
      return {
        ok: false,
        failed: true,
        failChance,
        recipeId: recipe.recipeId,
        message: "The potion fizzled and evaporated. No materials consumed.",
      };
    }

    const alchemyLab = getEntity(alchemyLabId);
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

    // Check gold balance and deduct brewing cost (copper → gold conversion)
    if (recipe.copperCost > 0) {
      const goldCost = copperToGold(recipe.copperCost);
      const onChainGold = parseFloat(await getGoldBalance(walletAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(walletAddress, safeOnChainGold);
      if (availableGold < goldCost) {
        reply.code(400);
        return {
          error: "Insufficient gold for brewing",
          required: recipe.copperCost,
          available: formatGold(availableGold),
        };
      }
      await recordGoldSpendAsync(walletAddress, goldCost);
    }

    // CRITICAL: Burn required materials (consume flower NFTs)
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
      server.log.error(err, `[alchemy] Failed to burn materials for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Failed to consume flowers - you may not have enough materials",
        hint: "Check your wallet inventory for required flowers",
      };
    }

    // Mint crafted potion
    try {
      await queueItemMint(walletAddress, recipe.outputTokenId, BigInt(recipe.outputQuantity));
      const potionTx = "queued-batch-item-mint";

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

      advanceGatherQuests(entity, outputItem?.name ?? "Unknown");

      if (entity.agentId != null) {
        reputationManager.submitFeedback(entity.agentId, ReputationCategory.Crafting, 2, `Crafted: ${outputItem?.name ?? recipeId}`);
      }
      server.log.info(
        `[alchemy] ${entity.name} brewed ${outputItem?.name} at ${alchemyLab.name} → ${potionTx}`
      );

      // Emit zone event for client speech bubbles
      logZoneEvent({
        zoneId,
        type: "loot",
        tick: 0,
        message: `${entity.name}: Brewed ${outputItem?.name ?? "a potion"}`,
        entityId: entity.id,
        entityName: entity.name,
        data: { craftType: "alchemy", itemName: outputItem?.name ?? "a potion", recipeId },
      });

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

      lastBrewTime.set(walletAddress.toLowerCase(), Date.now());

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

      for (const material of recipe.requiredMaterials) {
        try {
          await enqueueItemMint(walletAddress, material.tokenId, BigInt(material.quantity));
        } catch (refundErr) {
          server.log.error(refundErr, `[alchemy] Failed refunding ${material.tokenId.toString()} to ${walletAddress}`);
        }
      }

      reply.code(500);
      return {
        error: "Brewing failed - potion could not be created",
        materialsConsumed: burnedMaterials,
        warning: "Potion creation failed; refund attempted for consumed materials.",
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

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    // Zone needed for tick reference
    const zone = getOrCreateZone(zoneId);

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
      burnTx = await enqueueItemBurn(walletAddress, BigInt(tokenId), 1n);
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
      type: "consume",
      tick: zone.tick,
      message: `${entity.name} consumed ${itemName}`,
      entityId: entity.id,
      entityName: entity.name,
      data: {
        itemName,
        consumeType: effect.category,
        hpRestored: (results.hpRestored as number) ?? 0,
        mpRestored: (results.mpRestored as number) ?? 0,
        buffName: effect.buff?.name,
      },
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
