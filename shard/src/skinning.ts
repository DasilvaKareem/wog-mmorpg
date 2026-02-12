import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";
import { mintItem } from "./blockchain.js";
import { getLootTable, rollDrops } from "./lootTables.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { hasLearnedProfession } from "./professions.js";
import { authenticateRequest } from "./auth.js";

const SKINNING_RANGE = 50;

// Skinning knife tier mapping (tokenId -> tier)
const SKINNING_KNIFE_TIERS: Record<number, number> = {
  76: 1, // Rusty Skinning Knife
  77: 2, // Iron Skinning Knife
  78: 3, // Steel Skinning Knife
  79: 4, // Master Skinner's Blade
};

export function registerSkinningRoutes(server: FastifyInstance) {
  // GET /skinning/corpses/:zoneId - list available corpses to skin
  server.get<{ Params: { zoneId: string } }>(
    "/skinning/corpses/:zoneId",
    async (request, reply) => {
      const zone = getAllZones().get(request.params.zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const corpses = Array.from(zone.entities.values())
        .filter((e) => e.type === "corpse" && !e.skinned)
        .map((e) => ({
          id: e.id,
          name: e.name,
          x: e.x,
          y: e.y,
          mobName: e.mobName,
          skinnableUntil: e.skinnableUntil,
          timeRemaining: e.skinnableUntil ? Math.max(0, e.skinnableUntil - Date.now()) : 0,
        }));

      return { zoneId: request.params.zoneId, corpses };
    }
  );

  // POST /skinning/harvest - skin a corpse for materials
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      corpseId: string;
    };
  }>("/skinning/harvest", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, corpseId } = request.body;
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

    // Check profession
    if (!hasLearnedProfession(walletAddress, "skinning")) {
      reply.code(400);
      return { error: "Skinning profession not learned. Visit a skinning trainer." };
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

    const corpse = zone.entities.get(corpseId);
    if (!corpse || corpse.type !== "corpse") {
      reply.code(404);
      return { error: "Corpse not found" };
    }

    // Check if already skinned
    if (corpse.skinned) {
      reply.code(400);
      return { error: "Corpse already skinned" };
    }

    // Check if expired
    if (corpse.skinnableUntil && Date.now() > corpse.skinnableUntil) {
      reply.code(400);
      return { error: "Corpse has decayed and can no longer be skinned" };
    }

    // Check range
    const dx = corpse.x - entity.x;
    const dy = corpse.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > SKINNING_RANGE) {
      reply.code(400);
      return {
        error: "Out of range",
        distance: Math.round(dist),
        maxRange: SKINNING_RANGE,
      };
    }

    // CRITICAL: Check skinning knife equipped
    const weaponEquipped = entity.equipment?.weapon;
    if (!weaponEquipped || weaponEquipped.broken || weaponEquipped.durability <= 0) {
      reply.code(400);
      return { error: "No skinning knife equipped or knife broken" };
    }

    const knifeItem = getItemByTokenId(BigInt(weaponEquipped.tokenId));
    if (!knifeItem || knifeItem.category !== "tool") {
      reply.code(400);
      return { error: "Equipped weapon is not a skinning knife" };
    }

    const knifeTier = SKINNING_KNIFE_TIERS[weaponEquipped.tokenId] ?? 0;
    if (knifeTier === 0) {
      reply.code(400);
      return { error: "Equipped tool is not a skinning knife" };
    }

    // Get loot table for corpse
    const lootTable = corpse.mobName ? getLootTable(corpse.mobName) : undefined;
    if (!lootTable || lootTable.skinningDrops.length === 0) {
      reply.code(400);
      return { error: "This corpse cannot be skinned" };
    }

    // Roll skinning drops
    const drops = rollDrops(lootTable.skinningDrops);
    if (drops.length === 0) {
      reply.code(400);
      return { error: "Nothing of value could be harvested from this corpse" };
    }

    // Mark corpse as skinned
    corpse.skinned = true;

    // CRITICAL: Reduce knife durability
    weaponEquipped.durability = Math.max(0, weaponEquipped.durability - 1);
    if (weaponEquipped.durability === 0) {
      weaponEquipped.broken = true;
    }

    // Mint skinning materials
    const mintPromises: Promise<string>[] = [];
    const mintedItems: Array<{ name: string; quantity: number; tokenId: string }> = [];

    for (const drop of drops) {
      const item = getItemByTokenId(drop.tokenId);
      if (item) {
        mintPromises.push(mintItem(walletAddress, drop.tokenId, BigInt(drop.quantity)));
        mintedItems.push({
          name: item.name,
          quantity: drop.quantity,
          tokenId: drop.tokenId.toString(),
        });
      }
    }

    try {
      const txHashes = await Promise.all(mintPromises);

      server.log.info(
        `[skinning] ${entity.name} skinned ${corpse.name} with ${knifeItem.name} (${weaponEquipped.durability}/${weaponEquipped.maxDurability} dur) → ${mintedItems.length} items`
      );

      return {
        ok: true,
        corpse: corpse.name,
        materials: mintedItems,
        totalItems: mintedItems.reduce((sum, item) => sum + item.quantity, 0),
        txHashes,
        knife: {
          name: knifeItem.name,
          durability: weaponEquipped.durability,
          maxDurability: weaponEquipped.maxDurability,
          broken: weaponEquipped.broken,
        },
      };
    } catch (err) {
      server.log.error(err, `[skinning] Failed for ${walletAddress}`);

      // Refund on mint failure
      corpse.skinned = false;
      weaponEquipped.durability = Math.min(
        weaponEquipped.maxDurability,
        weaponEquipped.durability + 1
      );
      if (weaponEquipped.durability > 0) weaponEquipped.broken = false;

      reply.code(500);
      return { error: "Skinning transaction failed" };
    }
  });
}
