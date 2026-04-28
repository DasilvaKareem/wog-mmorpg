import type { FastifyInstance } from "fastify";
import { getEntity, getAllEntities, getEntitiesInRegion, getWorldTick } from "../world/zoneRuntime.js";
import { enqueueItemMint } from "../blockchain/blockchain.js";
import { getLootTable, rollDrops } from "../items/lootTables.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { hasLearnedProfession } from "./professions.js";
import { authenticateRequest } from "../auth/auth.js";
import { logDiary, narrativeSkin } from "../social/diary.js";
import { awardProfessionXp, PROFESSION_XP, getProfessionSkills, rollFailure } from "./professionXp.js";
import { advanceGatherQuests } from "../social/questSystem.js";
import { logZoneEvent } from "../world/zoneEvents.js";

const SKINNING_RANGE = 50;

// Skinning knife tier mapping (tokenId -> tier)
const SKINNING_KNIFE_TIERS: Record<number, number> = {
  76: 1, // Rusty Skinning Knife
  77: 2, // Iron Skinning Knife
  78: 3, // Steel Skinning Knife
  79: 4, // Master Skinner's Blade
};

export function registerSkinningRoutes(server: FastifyInstance) {
  // GET /skinning/corpses - list available corpses to skin (optionally filtered by region)
  server.get<{ Querystring: { region?: string } }>(
    "/skinning/corpses",
    async (request) => {
      const { region } = request.query;
      const entities = region
        ? getEntitiesInRegion(region)
        : [...getAllEntities().values()];

      const corpses = entities
        .filter((e) => e.type === "corpse" && !e.skinned)
        .map((e) => ({
          id: e.id,
          name: e.name,
          x: e.x,
          y: e.y,
          mobName: e.mobName,
          level: e.level ?? 1,
          requiredSkillLevel: Math.max(1, (e.level ?? 1) * 2),
          skinnableUntil: e.skinnableUntil,
          timeRemaining: e.skinnableUntil ? Math.max(0, e.skinnableUntil - Date.now()) : 0,
          region: e.region,
        }));

      return { region: region ?? "all", corpses };
    }
  );

  // Backward compat alias
  server.get("/skinning/corpses/:zoneId", async (request, reply) => {
    const { zoneId } = (request as any).params;
    return reply.redirect(`/skinning/corpses?region=${zoneId}`);
  });

  // POST /skinning/harvest - skin a corpse for materials
  server.post<{
    Body: {
      walletAddress: string;
      zoneId?: string;
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

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    const corpse = getEntity(corpseId);
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

    // Check skinning skill level (derived from corpse mob level)
    const corpseLevel = corpse.level ?? 1;
    const requiredSkillLevel = Math.max(1, corpseLevel * 2);
    const skills = getProfessionSkills(walletAddress);
    const currentSkillLevel = skills["skinning"]?.level ?? 1;
    if (currentSkillLevel < requiredSkillLevel) {
      reply.code(400);
      return {
        error: `Skinning skill too low for this corpse (level ${corpseLevel})`,
        requiredSkillLevel,
        currentSkillLevel,
        hint: `Skin lower-level corpses to raise your skill from ${currentSkillLevel} to ${requiredSkillLevel}`,
      };
    }

    // Roll for skinning failure
    const { failed, failChance } = rollFailure(currentSkillLevel, requiredSkillLevel);
    if (failed) {
      // Consume knife durability but don't mark corpse as skinned
      weaponEquipped.durability = Math.max(0, weaponEquipped.durability - 1);
      if (weaponEquipped.durability === 0) {
        weaponEquipped.broken = true;
        if (entity.equipment) delete entity.equipment.weapon;
      }
      const region = zoneId ?? entity.region ?? "unknown";
      awardProfessionXp(entity, region, Math.floor(PROFESSION_XP.SKIN / 2), "skinning");
      return {
        ok: false,
        failed: true,
        failChance,
        corpse: corpse.name,
        message: "Your knife slipped and ruined the cut. Corpse still available.",
        knife: {
          name: knifeItem.name,
          durability: weaponEquipped.durability,
          maxDurability: weaponEquipped.maxDurability,
          broken: weaponEquipped.broken,
        },
      };
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
      if (entity.equipment) delete entity.equipment.weapon;
    }

    // Mint skinning materials
    const mintPromises: Promise<string>[] = [];
    const mintedItems: Array<{ name: string; quantity: number; tokenId: string }> = [];

    for (const drop of drops) {
      const item = getItemByTokenId(drop.tokenId);
      if (item) {
        mintPromises.push(enqueueItemMint(walletAddress, drop.tokenId, BigInt(drop.quantity)));
        mintedItems.push({
          name: item.name,
          quantity: drop.quantity,
          tokenId: drop.tokenId.toString(),
        });
      }
    }

    try {
      const txHashes = await Promise.all(mintPromises);

      // Award profession XP
      const region = zoneId ?? entity.region ?? "unknown";
      const profXpResult = awardProfessionXp(entity, region, PROFESSION_XP.SKIN, "skinning", undefined, "corpse");

      server.log.info(
        `[skinning] ${entity.name} skinned ${corpse.name} with ${knifeItem.name} (${weaponEquipped.durability}/${weaponEquipped.maxDurability} dur) → ${mintedItems.length} items (node: ${corpseId})`
      );

      // Emit zone event for client speech bubbles
...
        },
      };
    } catch (err) {
      server.log.error(err, `[skinning] Failed for ${walletAddress} on corpse ${corpseId}`);

      // If enqueueItemMint failed, it might have partially succeeded in updating Postgres.
      // To be safe and prevent exploits, we DO NOT refund the corpse or durability
      // if an error occurs during the minting process.
      
      reply.code(500);
      return { error: "Skinning transaction failed. Corpse consumed to prevent exploit." };
    }
  });
}
