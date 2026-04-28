/**
 * Farming Profession — harvest crop nodes for produce.
 * Follows the same pattern as herbalism.ts.
 */

import type { FastifyInstance } from "fastify";
import { getEntity, getAllEntities, getEntitiesInRegion, getWorldTick } from "../world/zoneRuntime.js";
import { enqueueItemMint } from "../blockchain/blockchain.js";
import { CROP_CATALOG, HARVESTABLE_PHASES, isBonusPhase, type CropType } from "./cropCatalog.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { authenticateRequest } from "../auth/auth.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { getGameTime } from "../world/worldClock.js";
import { advanceGatherQuests } from "../social/questSystem.js";

const GATHER_RANGE = 50;

// Hoe tier mapping (tokenId -> tier)
const HOE_TIERS: Record<number, number> = {
  220: 1, // Wooden Hoe
  221: 2, // Iron Hoe
  222: 3, // Steel Hoe
  223: 4, // Enchanted Hoe
};

export function registerFarmingRoutes(server: FastifyInstance) {
  // GET /farming/catalog — crop types and requirements
  server.get("/farming/catalog", async () => {
    const gt = getGameTime(getWorldTick());
    return Object.entries(CROP_CATALOG).map(([cropType, props]) => ({
      cropType,
      label: props.label,
      rarity: props.rarity,
      maxCharges: props.maxCharges,
      respawnTicks: props.respawnTicks,
      requiredHoeTier: props.requiredHoeTier,
      minSkill: props.minSkill,
      tokenId: props.tokenId.toString(),
      preferredPhase: props.preferredPhase,
      harvestableNow: HARVESTABLE_PHASES[props.preferredPhase].has(gt.phase),
      bonusYieldNow: isBonusPhase(props.preferredPhase, gt.phase),
    }));
  });

  // GET /farming/nodes — all crop nodes (optionally filtered by region)
  server.get<{ Querystring: { region?: string } }>(
    "/farming/nodes",
    async (request) => {
      const { region } = request.query;
      const entities = region
        ? getEntitiesInRegion(region)
        : [...getAllEntities().values()];

      const cropNodes = entities
        .filter((e) => e.type === "crop-node")
        .map((e) => ({
          id: e.id,
          name: e.name,
          x: e.x,
          y: e.y,
          cropType: e.cropType,
          charges: e.charges ?? 0,
          maxCharges: e.maxCharges ?? 0,
          depleted: e.depletedAtTick != null,
          requiredHoeTier: e.cropType
            ? CROP_CATALOG[e.cropType as CropType]?.requiredHoeTier ?? 1
            : 1,
        }));

      return { nodes: cropNodes, count: cropNodes.length };
    }
  );

  // POST /farming/harvest — gather a crop from a node
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      cropNodeId: string;
    };
  }>(
    "/farming/harvest",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, zoneId, entityId, cropNodeId } = request.body;

      // Validate player entity
      const player = getEntity(entityId);
      if (!player || player.type !== "player") {
        return reply.code(404).send({ error: "Player entity not found" });
      }
      if (
        !player.walletAddress ||
        player.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
      ) {
        return reply.code(403).send({ error: "Not your character" });
      }

      // Validate crop node
      const node = getEntity(cropNodeId);
      if (!node || node.type !== "crop-node") {
        return reply.code(404).send({ error: "Crop node not found" });
      }

      // Check range
      const dx = player.x - node.x;
      const dy = player.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > GATHER_RANGE) {
        return reply.code(400).send({ error: `Too far from crop node (${Math.round(dist)} > ${GATHER_RANGE})` });
      }

      // Check if depleted
      if (node.depletedAtTick != null) {
        return reply.code(400).send({ error: "This crop is not ready for harvest" });
      }

      // Check hoe equipped
      const weapon = player.equipment?.weapon;
      if (!weapon) {
        return reply.code(400).send({ error: "No tool equipped. Equip a hoe to harvest crops." });
      }
      const hoeTier = HOE_TIERS[weapon.tokenId];
      if (!hoeTier) {
        return reply.code(400).send({ error: "You need a hoe equipped to harvest crops." });
      }

      // Check hoe tier requirement
      const cropType = node.cropType as CropType;
      const cropProps = CROP_CATALOG[cropType];
      if (!cropProps) {
        return reply.code(500).send({ error: "Unknown crop type" });
      }
      if (hoeTier < cropProps.requiredHoeTier) {
        return reply.code(400).send({
          error: `This crop requires a tier ${cropProps.requiredHoeTier} hoe (you have tier ${hoeTier})`,
        });
      }

      // ── Time-gate: check if crop can be harvested during current phase ──
      const gt = getGameTime(getWorldTick());
      const allowedPhases = HARVESTABLE_PHASES[cropProps.preferredPhase];
      if (!allowedPhases.has(gt.phase)) {
        const when = cropProps.preferredPhase === "day" ? "during the day (dawn/day)" : "at night (dusk/night)";
        return reply.code(400).send({
          error: `${cropProps.label} can only be harvested ${when}. Current time: ${gt.hour}:${String(gt.minute).padStart(2, "0")} (${gt.phase})`,
        });
      }

      // Harvest: reduce charges
      const originalCharges = node.charges ?? 0;
      node.charges = originalCharges - 1;
      const chargesRemaining = node.charges;
      if (chargesRemaining <= 0) {
        node.depletedAtTick = getWorldTick();
      }

      // ── Bonus yield: double during peak phase ──
      const bonus = isBonusPhase(cropProps.preferredPhase, gt.phase);
      let quantity = hoeTier >= 3 ? 2 : 1;
      if (bonus) quantity *= 2;

      // Mint the crop item
      try {
        const mintTx = await enqueueItemMint(walletAddress, cropProps.tokenId, BigInt(quantity));
        
        server.log.info(
          `[farming] ${player.name} harvested ${quantity}x ${cropProps.label} with tier ${hoeTier} hoe → ${mintTx} (charges left: ${chargesRemaining})`
        );
      } catch (err: any) {
        server.log.error(err, `[farming] Harvest mint failed for ${walletAddress} on node ${cropNodeId}`);
        return reply.code(500).send({ 
          error: "Harvest transaction failed. Node charge consumed to prevent exploit.",
          detail: err.message 
        });
      }

      const itemDef = getItemByTokenId(cropProps.tokenId);
      const itemName = itemDef?.name ?? cropProps.label;
      const bonusMsg = bonus ? " (bonus yield!)" : "";

      // Advance gather/craft quests for harvested crops
      advanceGatherQuests(player, itemName);

      logZoneEvent({
        zoneId: node.region ?? zoneId,
        type: "loot",
        tick: getWorldTick(),
        message: `${player.name}: Harvested ${quantity}x ${itemName}${bonusMsg}`,
        entityId,
        entityName: player.name,
        data: { gatherType: "farming", itemName, nodeId: cropNodeId, bonusYield: bonus },
      });

      return {
        ok: true,
        cropType,
        item: itemName,
        tokenId: cropProps.tokenId.toString(),
        quantity,
        bonusYield: bonus,
        remainingCharges: Math.max(0, chargesRemaining),
        depleted: chargesRemaining <= 0,
        gameTime: gt,
      };
    }
  );
}
