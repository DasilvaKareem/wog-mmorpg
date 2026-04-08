import type { FastifyInstance } from "fastify";
import { getEntity } from "../world/zoneRuntime.js";
import { hasLearnedProfession } from "./professions.js";
import { mintItem, burnItem, getItemBalance, getGoldBalance } from "../blockchain/blockchain.js";
import { getAvailableGoldAsync, formatGold, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { authenticateRequest } from "../auth/auth.js";
import { rollCraftedItem } from "../items/itemRng.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { logDiary, narrativeCraft } from "../social/diary.js";
import { copperToGold } from "../blockchain/currency.js";
import { awardProfessionXp, PROFESSION_XP, getProfessionSkills, rollFailure } from "./professionXp.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";
import { advanceGatherQuests } from "../social/questSystem.js";

const lastCraftTime = new Map<string, number>();

export interface CraftingRecipe {
  recipeId: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  copperCost: number;
  requiredProfession: "blacksmithing" | "alchemy" | "leatherworking" | "jewelcrafting";
  requiredSkillLevel: number; // profession skill level (1-300) needed to craft
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
    requiredSkillLevel: 1,
    craftingTime: 10,
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
    requiredSkillLevel: 15,
    craftingTime: 20,
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
    requiredSkillLevel: 10,
    craftingTime: 16,
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
    requiredSkillLevel: 25,
    craftingTime: 30,
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
    requiredSkillLevel: 5,
    craftingTime: 12,
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
    requiredSkillLevel: 30,
    craftingTime: 40,
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
    requiredSkillLevel: 20,
    craftingTime: 24,
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
    requiredSkillLevel: 25,
    craftingTime: 28,
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
    requiredSkillLevel: 75,
    craftingTime: 60,
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
    requiredSkillLevel: 1,
    craftingTime: 6,
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
    requiredSkillLevel: 10,
    craftingTime: 8,
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
    requiredSkillLevel: 25,
    craftingTime: 12,
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
    requiredSkillLevel: 40,
    craftingTime: 16,
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
    requiredSkillLevel: 50,
    craftingTime: 20,
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
    requiredSkillLevel: 40,
    craftingTime: 12,
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
    requiredSkillLevel: 45,
    craftingTime: 16,
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
    requiredSkillLevel: 55,
    craftingTime: 24,
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
    requiredSkillLevel: 65,
    craftingTime: 28,
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
    requiredSkillLevel: 50,
    craftingTime: 20,
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
    requiredSkillLevel: 60,
    craftingTime: 36,
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
    requiredSkillLevel: 55,
    craftingTime: 24,
  },

  // --- Elite Blacksmithing (Weapons) ---
  {
    recipeId: "voidsteel-greatsword",
    outputTokenId: 180n, // Voidsteel Greatsword
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 4 }, // 4x Steel Alloy
      { tokenId: 89n, quantity: 2 }, // 2x Gold Bar
      { tokenId: 178n, quantity: 1 }, // 1x Promic Crystal
    ],
    copperCost: 300,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 150,
    craftingTime: 60,
  },
  {
    recipeId: "promic-warstaff",
    outputTokenId: 181n, // Promic Warstaff
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 89n, quantity: 3 }, // 3x Gold Bar
      { tokenId: 178n, quantity: 2 }, // 2x Promic Crystal
    ],
    copperCost: 250,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 140,
    craftingTime: 56,
  },
  {
    recipeId: "caesaric-longbow",
    outputTokenId: 182n, // Caesaric Longbow
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 3 }, // 3x Steel Alloy
      { tokenId: 172n, quantity: 2 }, // 2x Caesaric Crystal
    ],
    copperCost: 200,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 125,
    craftingTime: 50,
  },
  {
    recipeId: "neodynic-battleaxe",
    outputTokenId: 183n, // Neodynic Battleaxe
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 5 }, // 5x Steel Alloy
      { tokenId: 177n, quantity: 2 }, // 2x Neodynic Ink
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
    ],
    copperCost: 400,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 175,
    craftingTime: 70,
  },
  {
    recipeId: "lantharum-dagger",
    outputTokenId: 184n, // Lantharum Dagger
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 2 }, // 2x Steel Alloy
      { tokenId: 174n, quantity: 2 }, // 2x Lantharum Pigment
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
    ],
    copperCost: 150,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 100,
    craftingTime: 40,
  },

  // --- Elite Blacksmithing (Armor) ---
  {
    recipeId: "telluron-platemail",
    outputTokenId: 185n, // Telluron Platemail
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 4 }, // 4x Steel Alloy
      { tokenId: 170n, quantity: 2 }, // 2x Telluron Fiber
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
    ],
    copperCost: 200,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 150,
    craftingTime: 60,
  },
  {
    recipeId: "prasic-warhelm",
    outputTokenId: 186n, // Prasic Warhelm
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 2 }, // 2x Steel Alloy
      { tokenId: 176n, quantity: 2 }, // 2x Prasic Glass
    ],
    copperCost: 150,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 110,
    craftingTime: 44,
  },
  {
    recipeId: "samaronic-greaves",
    outputTokenId: 187n, // Samaronic Greaves
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 3 }, // 3x Steel Alloy
      { tokenId: 179n, quantity: 2 }, // 2x Samaronic Silk
    ],
    copperCost: 175,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 130,
    craftingTime: 50,
  },
  {
    recipeId: "barylian-warboots",
    outputTokenId: 188n, // Barylian Warboots
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 2 }, // 2x Steel Alloy
      { tokenId: 173n, quantity: 2 }, // 2x Barylian Wax
    ],
    copperCost: 125,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 100,
    craftingTime: 40,
  },
  {
    recipeId: "ceric-pauldrons",
    outputTokenId: 189n, // Ceric Pauldrons
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 3 }, // 3x Steel Alloy
      { tokenId: 175n, quantity: 2 }, // 2x Ceric Foam
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
    ],
    copperCost: 175,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 140,
    craftingTime: 50,
  },
  // --- Unique Weapons — Ore-forged (Tier 1) ---
  {
    recipeId: "frostfang-dagger",
    outputTokenId: 231n, // Frostfang Dagger
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 23n, quantity: 2 }, // 2x Tin Ore
      { tokenId: 25n, quantity: 1 }, // 1x Silver Ore
      { tokenId: 38n, quantity: 1 }, // 1x Moonflower
    ],
    copperCost: 30,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 15,
    craftingTime: 16,
  },
  {
    recipeId: "emberclaw-mace",
    outputTokenId: 232n, // Emberclaw Mace
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 22n, quantity: 3 }, // 3x Coal Ore
      { tokenId: 24n, quantity: 2 }, // 2x Copper Ore
    ],
    copperCost: 35,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 20,
    craftingTime: 20,
  },
  {
    recipeId: "thornvine-whip",
    outputTokenId: 233n, // Thornvine Whip
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 24n, quantity: 1 }, // 1x Copper Ore
      { tokenId: 23n, quantity: 1 }, // 1x Tin Ore
      { tokenId: 35n, quantity: 2 }, // 2x Lavender
    ],
    copperCost: 25,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 10,
    craftingTime: 14,
  },
  {
    recipeId: "gloomveil-wand",
    outputTokenId: 234n, // Gloomveil Wand
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 25n, quantity: 1 }, // 1x Silver Ore
      { tokenId: 36n, quantity: 2 }, // 2x Sage
    ],
    copperCost: 30,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 15,
    craftingTime: 12,
  },

  // --- Unique Weapons — Bar-forged (Tier 2) ---
  {
    recipeId: "wraithbone-scimitar",
    outputTokenId: 235n, // Wraithbone Scimitar
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 86n, quantity: 2 }, // 2x Tin Bar
      { tokenId: 87n, quantity: 1 }, // 1x Copper Bar
      { tokenId: 38n, quantity: 1 }, // 1x Moonflower
    ],
    copperCost: 60,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 50,
    craftingTime: 28,
  },
  {
    recipeId: "duskhollow-warhammer",
    outputTokenId: 236n, // Duskhollow Warhammer
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 87n, quantity: 3 }, // 3x Copper Bar
      { tokenId: 90n, quantity: 1 }, // 1x Steel Alloy
    ],
    copperCost: 80,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 60,
    craftingTime: 36,
  },
  {
    recipeId: "serpentcoil-longbow",
    outputTokenId: 237n, // Serpentcoil Longbow
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 88n, quantity: 1 }, // 1x Silver Bar
      { tokenId: 86n, quantity: 1 }, // 1x Tin Bar
      { tokenId: 40n, quantity: 2 }, // 2x Dragon's Breath
    ],
    copperCost: 70,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 55,
    craftingTime: 32,
  },
  {
    recipeId: "starweaver-scepter",
    outputTokenId: 238n, // Starweaver Scepter
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 88n, quantity: 2 }, // 2x Silver Bar
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
      { tokenId: 39n, quantity: 1 }, // 1x Starbloom
    ],
    copperCost: 90,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 70,
    craftingTime: 36,
  },

  // --- Unique Weapons — Alloy-forged (Tier 3) ---
  {
    recipeId: "bloodthorn-claymore",
    outputTokenId: 239n, // Bloodthorn Claymore
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 2 }, // 2x Steel Alloy
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
      { tokenId: 40n, quantity: 2 }, // 2x Dragon's Breath
    ],
    copperCost: 150,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 100,
    craftingTime: 50,
  },
  {
    recipeId: "moonsilver-rapier",
    outputTokenId: 240n, // Moonsilver Rapier
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 88n, quantity: 3 }, // 3x Silver Bar
      { tokenId: 90n, quantity: 1 }, // 1x Steel Alloy
      { tokenId: 39n, quantity: 1 }, // 1x Starbloom
    ],
    copperCost: 120,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 85,
    craftingTime: 44,
  },
  {
    recipeId: "stormcaller-arbalest",
    outputTokenId: 241n, // Stormcaller Arbalest
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 90n, quantity: 2 }, // 2x Steel Alloy
      { tokenId: 87n, quantity: 2 }, // 2x Copper Bar
      { tokenId: 162n, quantity: 1 }, // 1x Cryptonic Crystal
    ],
    copperCost: 130,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 90,
    craftingTime: 48,
  },
  {
    recipeId: "oathkeeper-maul",
    outputTokenId: 242n, // Oathkeeper Maul
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 89n, quantity: 2 }, // 2x Gold Bar
      { tokenId: 90n, quantity: 1 }, // 1x Steel Alloy
      { tokenId: 161n, quantity: 1 }, // 1x Scandix Steel
    ],
    copperCost: 160,
    requiredProfession: "blacksmithing",
    requiredSkillLevel: 110,
    craftingTime: 52,
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
        requiredSkillLevel: recipe.requiredSkillLevel,
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
          requiredSkillLevel: recipe.requiredSkillLevel,
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

    // Check skill level requirement
    const skills = getProfessionSkills(walletAddress);
    const currentSkillLevel = skills["blacksmithing"]?.level ?? 1;
    if (currentSkillLevel < recipe.requiredSkillLevel) {
      reply.code(400);
      return {
        error: `Blacksmithing skill too low for this recipe`,
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
      const halfXp = recipeId.startsWith("smelt-")
        ? Math.floor(PROFESSION_XP.FORGE_SMELT / 2)
        : recipeId.startsWith("bar-")
          ? Math.floor(PROFESSION_XP.FORGE_ADVANCED / 2)
          : Math.floor(PROFESSION_XP.FORGE_WEAPON / 2);
      awardProfessionXp(entity, zoneId, halfXp, "crafting");
      return {
        ok: false,
        failed: true,
        failChance,
        recipeId: recipe.recipeId,
        message: "The metal warped during forging. No materials consumed.",
      };
    }

    const forge = getEntity(forgeId);
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

    // Check gold balance and deduct crafting cost (copper → gold conversion)
    if (recipe.copperCost > 0) {
      const goldCost = copperToGold(recipe.copperCost);
      const onChainGold = parseFloat(await getGoldBalance(walletAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(walletAddress, safeOnChainGold);
      if (availableGold < goldCost) {
        reply.code(400);
        return {
          error: "Insufficient gold for crafting",
          required: recipe.copperCost,
          available: formatGold(availableGold),
        };
      }
      await recordGoldSpendAsync(walletAddress, goldCost);
    }

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

      // Emit zone event for client speech bubbles
      logZoneEvent({
        zoneId,
        type: "loot",
        tick: 0,
        message: instance && (instance.quality.tier === "rare" || instance.quality.tier === "epic")
          ? `${entity.name} forged a ${instance.quality.tier} item: ${instance.displayName}!`
          : `${entity.name}: Forged ${outputItem?.name ?? "an item"}`,
        entityId: entity.id,
        entityName: entity.name,
        data: {
          craftType: "crafting",
          itemName: instance?.displayName ?? outputItem?.name ?? "an item",
          recipeId,
          ...(instance && { quality: instance.quality.tier, instanceId: instance.instanceId }),
        },
      });

      advanceGatherQuests(entity, outputItem?.name ?? "Unknown");

      if (entity.agentId != null) {
        reputationManager.submitFeedback(entity.agentId, ReputationCategory.Crafting, 2, `Crafted: ${instance?.displayName ?? outputItem?.name ?? recipeId}`);
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
      server.log.error(err, `[crafting] Failed to mint crafted item for ${walletAddress}`);

      for (const material of recipe.requiredMaterials) {
        try {
          await mintItem(walletAddress, material.tokenId, BigInt(material.quantity));
        } catch (refundErr) {
          server.log.error(refundErr, `[crafting] Failed refunding ${material.tokenId.toString()} to ${walletAddress}`);
        }
      }

      reply.code(500);
      return {
        error: "Crafting failed - item could not be created",
        materialsConsumed: burnedMaterials,
        warning: "Item creation failed; refund attempted for consumed materials.",
      };
    }
  });
}
