import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getEntity } from "../world/zoneRuntime.js";
import { hasLearnedProfession } from "../professions/professions.js";
import { enqueueItemBurn, enqueueItemMint, getItemBalance } from "../blockchain/blockchain.js";
import { queueItemMint } from "../blockchain/chainBatcher.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { consumeOwnedItemInstances, rollCraftedItem } from "./itemRng.js";
import { getEquippedInstanceIds, getEquippedItemCounts, getRecyclableQuantity } from "./inventoryState.js";
import { logZoneEvent } from "../world/zoneEvents.js";

export interface UpgradeRecipe {
  recipeId: string;
  inputWeaponTokenId: bigint;
  outputTokenId: bigint;
  additionalMaterials: Array<{ tokenId: bigint; quantity: number }>;
  copperCost: number;
}

export const UPGRADE_RECIPES: UpgradeRecipe[] = [
  // --- Base → Reinforced ---
  {
    recipeId: "upgrade-iron-sword-reinforced",
    inputWeaponTokenId: 2n, // Iron Sword
    outputTokenId: 105n, // Reinforced Iron Sword
    additionalMaterials: [
      { tokenId: 90n, quantity: 1 }, // 1x Steel Alloy
      { tokenId: 86n, quantity: 2 }, // 2x Tin Bar
    ],
    copperCost: 100,
  },
  {
    recipeId: "upgrade-steel-longsword-reinforced",
    inputWeaponTokenId: 3n, // Steel Longsword
    outputTokenId: 106n, // Reinforced Steel Longsword
    additionalMaterials: [
      { tokenId: 90n, quantity: 2 }, // 2x Steel Alloy
      { tokenId: 87n, quantity: 2 }, // 2x Copper Bar
    ],
    copperCost: 200,
  },
  {
    recipeId: "upgrade-hunters-bow-reinforced",
    inputWeaponTokenId: 4n, // Hunter's Bow
    outputTokenId: 107n, // Reinforced Hunter's Bow
    additionalMaterials: [
      { tokenId: 90n, quantity: 1 }, // 1x Steel Alloy
      { tokenId: 88n, quantity: 1 }, // 1x Silver Bar
    ],
    copperCost: 150,
  },
  {
    recipeId: "upgrade-battle-axe-reinforced",
    inputWeaponTokenId: 5n, // Battle Axe
    outputTokenId: 108n, // Reinforced Battle Axe
    additionalMaterials: [
      { tokenId: 90n, quantity: 3 }, // 3x Steel Alloy
      { tokenId: 87n, quantity: 2 }, // 2x Copper Bar
    ],
    copperCost: 350,
  },
  {
    recipeId: "upgrade-apprentice-staff-reinforced",
    inputWeaponTokenId: 6n, // Apprentice Staff
    outputTokenId: 109n, // Reinforced Apprentice Staff
    additionalMaterials: [
      { tokenId: 88n, quantity: 2 }, // 2x Silver Bar
      { tokenId: 90n, quantity: 1 }, // 1x Steel Alloy
    ],
    copperCost: 180,
  },

  // --- Reinforced → Masterwork ---
  {
    recipeId: "upgrade-iron-sword-masterwork",
    inputWeaponTokenId: 105n, // Reinforced Iron Sword
    outputTokenId: 110n, // Masterwork Iron Sword
    additionalMaterials: [
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
      { tokenId: 90n, quantity: 2 }, // 2x Steel Alloy
    ],
    copperCost: 250,
  },
  {
    recipeId: "upgrade-steel-longsword-masterwork",
    inputWeaponTokenId: 106n, // Reinforced Steel Longsword
    outputTokenId: 111n, // Masterwork Steel Longsword
    additionalMaterials: [
      { tokenId: 89n, quantity: 2 }, // 2x Gold Bar
      { tokenId: 90n, quantity: 3 }, // 3x Steel Alloy
    ],
    copperCost: 500,
  },
  {
    recipeId: "upgrade-hunters-bow-masterwork",
    inputWeaponTokenId: 107n, // Reinforced Hunter's Bow
    outputTokenId: 112n, // Masterwork Hunter's Bow
    additionalMaterials: [
      { tokenId: 89n, quantity: 1 }, // 1x Gold Bar
      { tokenId: 88n, quantity: 2 }, // 2x Silver Bar
    ],
    copperCost: 350,
  },
  {
    recipeId: "upgrade-battle-axe-masterwork",
    inputWeaponTokenId: 108n, // Reinforced Battle Axe
    outputTokenId: 113n, // Masterwork Battle Axe
    additionalMaterials: [
      { tokenId: 89n, quantity: 3 }, // 3x Gold Bar
      { tokenId: 90n, quantity: 3 }, // 3x Steel Alloy
    ],
    copperCost: 750,
  },
  {
    recipeId: "upgrade-apprentice-staff-masterwork",
    inputWeaponTokenId: 109n, // Reinforced Apprentice Staff
    outputTokenId: 114n, // Masterwork Apprentice Staff
    additionalMaterials: [
      { tokenId: 89n, quantity: 2 }, // 2x Gold Bar
      { tokenId: 88n, quantity: 3 }, // 3x Silver Bar
    ],
    copperCost: 500,
  },
];

export function getUpgradeRecipeById(recipeId: string): UpgradeRecipe | undefined {
  return UPGRADE_RECIPES.find((r) => r.recipeId === recipeId);
}

export function registerUpgradingRoutes(server: FastifyInstance) {
  // GET /crafting/upgrades - list all upgrade recipes
  server.get("/crafting/upgrades", async () => {
    return UPGRADE_RECIPES.map((recipe) => {
      const inputItem = getItemByTokenId(recipe.inputWeaponTokenId);
      const outputItem = getItemByTokenId(recipe.outputTokenId);
      return {
        recipeId: recipe.recipeId,
        input: {
          tokenId: recipe.inputWeaponTokenId.toString(),
          name: inputItem?.name ?? "Unknown",
        },
        output: {
          tokenId: recipe.outputTokenId.toString(),
          name: outputItem?.name ?? "Unknown",
        },
        additionalMaterials: recipe.additionalMaterials.map((mat) => {
          const matItem = getItemByTokenId(mat.tokenId);
          return {
            tokenId: mat.tokenId.toString(),
            name: matItem?.name ?? "Unknown",
            quantity: mat.quantity,
          };
        }),
        copperCost: recipe.copperCost,
      };
    });
  });

  // POST /crafting/upgrade - upgrade a weapon at a forge
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      forgeId: string;
      recipeId: string;
    };
  }>("/crafting/upgrade", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, forgeId, recipeId } = request.body;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    const recipe = getUpgradeRecipeById(recipeId);
    if (!recipe) {
      reply.code(404);
      return { error: "Upgrade recipe not found" };
    }

    if (!hasLearnedProfession(walletAddress, "blacksmithing")) {
      reply.code(400);
      return {
        error: "You must learn blacksmithing to upgrade weapons",
        requiredProfession: "blacksmithing",
      };
    }

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    const forge = getEntity(forgeId);
    if (!forge || forge.type !== "forge") {
      reply.code(404);
      return { error: "Forge not found" };
    }

    // Check range
    const dx = forge.x - entity.x;
    const dy = forge.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) {
      reply.code(400);
      return { error: "Too far from forge", distance: Math.round(dist), maxRange: 100 };
    }

    // Burn input weapon + additional materials
    const burnedItems: Array<{ tokenId: string; quantity: number; tx: string }> = [];
    try {
      const inputWeaponBalance = await getItemBalance(walletAddress, recipe.inputWeaponTokenId);
      const ownedInputWeapons = Number(inputWeaponBalance);
      const equippedCounts = await getEquippedItemCounts(walletAddress);
      const equippedInputWeapons = equippedCounts.get(Number(recipe.inputWeaponTokenId)) ?? 0;
      const upgradableQuantity = getRecyclableQuantity(ownedInputWeapons, equippedInputWeapons);
      if (upgradableQuantity < 1) {
        reply.code(400);
        return {
          error: equippedInputWeapons > 0
            ? "That weapon is equipped on one of your characters. Unequip it before upgrading."
            : "You need the base weapon in your wallet to upgrade it.",
          ownedQuantity: ownedInputWeapons,
          equippedCount: equippedInputWeapons,
        };
      }

      // Burn the input weapon
      const weaponBurnTx = await enqueueItemBurn(
        walletAddress,
        recipe.inputWeaponTokenId,
        1n
      );
      const equippedInstanceIds = await getEquippedInstanceIds(walletAddress);
      await consumeOwnedItemInstances(
        walletAddress,
        Number(recipe.inputWeaponTokenId),
        1,
        equippedInstanceIds,
      );
      burnedItems.push({
        tokenId: recipe.inputWeaponTokenId.toString(),
        quantity: 1,
        tx: weaponBurnTx,
      });

      // Burn additional materials
      for (const material of recipe.additionalMaterials) {
        const burnTx = await enqueueItemBurn(
          walletAddress,
          material.tokenId,
          BigInt(material.quantity)
        );
        burnedItems.push({
          tokenId: material.tokenId.toString(),
          quantity: material.quantity,
          tx: burnTx,
        });
      }
    } catch (err) {
      server.log.error(err, `[upgrading] Failed to burn materials for ${walletAddress}`);
      reply.code(500);
      return {
        error: "Failed to consume materials - check you have the weapon and materials",
        hint: "You need the base weapon + upgrade materials in your wallet",
      };
    }

    // Mint upgraded weapon
    try {
      await queueItemMint(walletAddress, recipe.outputTokenId, 1n);
      const upgradeTx = "queued-batch-item-mint";

      const inputItem = getItemByTokenId(recipe.inputWeaponTokenId);
      const outputItem = getItemByTokenId(recipe.outputTokenId);

      // Roll RNG stats for the upgraded item (fresh roll — old item's rolls are consumed)
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
          message: `${entity.name} upgraded to a ${instance.quality.tier} item: ${instance.displayName}!`,
          entityId: entity.id,
          entityName: entity.name,
          data: { quality: instance.quality.tier, instanceId: instance.instanceId },
        });
      }

      server.log.info(
        `[upgrading] ${entity.name} upgraded ${inputItem?.name} → ${instance?.displayName ?? outputItem?.name} (${instance?.quality.tier ?? "n/a"}) at ${forge.name} → ${upgradeTx}`
      );

      return {
        ok: true,
        recipeId: recipe.recipeId,
        upgraded: {
          from: {
            tokenId: recipe.inputWeaponTokenId.toString(),
            name: inputItem?.name ?? "Unknown",
          },
          to: {
            tokenId: recipe.outputTokenId.toString(),
            name: outputItem?.name ?? "Unknown",
            tx: upgradeTx,
            ...(instance && {
              instanceId: instance.instanceId,
              quality: instance.quality.tier,
              displayName: instance.displayName,
              rolledStats: instance.rolledStats,
              bonusAffix: instance.bonusAffix,
              rolledMaxDurability: instance.rolledMaxDurability,
            }),
          },
        },
        materialsConsumed: burnedItems,
        copperCost: recipe.copperCost,
      };
    } catch (err) {
      server.log.error(err, `[upgrading] Failed to mint upgraded weapon for ${walletAddress}`);
      const refundFailures: string[] = [];
      for (const burned of burnedItems) {
        try {
          await enqueueItemMint(walletAddress, BigInt(burned.tokenId), BigInt(burned.quantity));
        } catch {
          refundFailures.push(`${burned.quantity}x ${burned.tokenId}`);
        }
      }
      reply.code(500);
      return {
        error: "Upgrade failed - weapon could not be created",
        materialsConsumed: burnedItems,
        warning: refundFailures.length > 0
          ? `Upgrade failed and some materials could not be restored (${refundFailures.join(", ")})`
          : "Upgrade failed and consumed materials were restored",
      };
    }
  });
}
