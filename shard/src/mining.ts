import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";
import { mintItem } from "./blockchain.js";
import { ORE_CATALOG } from "./oreCatalog.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { hasLearnedProfession } from "./professions.js";
import { authenticateRequest } from "./auth.js";
import { logDiary, narrativeMine } from "./diary.js";

const GATHER_RANGE = 50;

// Pickaxe tier mapping (tokenId -> tier)
const PICKAXE_TIERS: Record<number, number> = {
  27: 1, // Stone Pickaxe
  28: 2, // Iron Pickaxe
  29: 3, // Steel Pickaxe
  30: 4, // Mithril Pickaxe
};

export function registerMiningRoutes(server: FastifyInstance) {
  // GET /mining/catalog - ore types and requirements
  server.get("/mining/catalog", async () => {
    return Object.entries(ORE_CATALOG).map(([oreType, props]) => ({
      oreType,
      label: props.label,
      rarity: props.rarity,
      maxCharges: props.maxCharges,
      respawnTicks: props.respawnTicks,
      requiredPickaxeTier: props.requiredPickaxeTier,
      tokenId: props.tokenId.toString(),
    }));
  });

  // GET /mining/nodes/:zoneId - all ore nodes in zone
  server.get<{ Params: { zoneId: string } }>(
    "/mining/nodes/:zoneId",
    async (request, reply) => {
      const zone = getAllZones().get(request.params.zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const oreNodes = Array.from(zone.entities.values())
        .filter((e) => e.type === "ore-node")
        .map((e) => ({
          id: e.id,
          name: e.name,
          x: e.x,
          y: e.y,
          oreType: e.oreType,
          charges: e.charges ?? 0,
          maxCharges: e.maxCharges ?? 0,
          depleted: e.depletedAtTick != null,
          requiredPickaxeTier: e.oreType ? ORE_CATALOG[e.oreType].requiredPickaxeTier : 1,
        }));

      return { zoneId: request.params.zoneId, oreNodes };
    }
  );

  // POST /mining/gather - mine ore with pickaxe
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      oreNodeId: string;
    };
  }>("/mining/gather", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, oreNodeId } = request.body;
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

    const oreNode = zone.entities.get(oreNodeId);
    if (!oreNode || oreNode.type !== "ore-node") {
      reply.code(404);
      return { error: "Ore node not found" };
    }

    // Check range
    const dx = oreNode.x - entity.x;
    const dy = oreNode.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > GATHER_RANGE) {
      reply.code(400);
      return { error: "Out of range", distance: Math.round(dist), maxRange: GATHER_RANGE };
    }

    // Check if depleted
    if (oreNode.depletedAtTick != null || (oreNode.charges ?? 0) <= 0) {
      reply.code(400);
      return { error: "Ore node depleted" };
    }

    // CRITICAL: Check if player has learned mining profession
    if (!hasLearnedProfession(walletAddress, "mining")) {
      reply.code(400);
      return {
        error: "You must learn the Mining profession from a trainer first",
        hint: "Find Grizzled Miner Torvik in village-square to learn Mining",
      };
    }

    // CRITICAL: Check pickaxe equipped
    const weaponEquipped = entity.equipment?.weapon;
    if (!weaponEquipped || weaponEquipped.broken || weaponEquipped.durability <= 0) {
      reply.code(400);
      return { error: "No pickaxe equipped or pickaxe broken" };
    }

    const pickaxeItem = getItemByTokenId(BigInt(weaponEquipped.tokenId));
    if (!pickaxeItem || pickaxeItem.category !== "tool") {
      reply.code(400);
      return { error: "Equipped weapon is not a pickaxe" };
    }

    const pickaxeTier = PICKAXE_TIERS[weaponEquipped.tokenId] ?? 0;
    const oreProps = ORE_CATALOG[oreNode.oreType!];
    if (pickaxeTier < oreProps.requiredPickaxeTier) {
      reply.code(400);
      return {
        error: "Pickaxe tier too low for this ore",
        yourTier: pickaxeTier,
        requiredTier: oreProps.requiredPickaxeTier,
      };
    }

    // Deplete ore charge
    oreNode.charges = (oreNode.charges ?? 0) - 1;
    const chargesRemaining = oreNode.charges;
    if (oreNode.charges <= 0) {
      oreNode.depletedAtTick = zone.tick;
    }

    // CRITICAL: Reduce pickaxe durability
    weaponEquipped.durability = Math.max(0, weaponEquipped.durability - 1);
    if (weaponEquipped.durability === 0) {
      weaponEquipped.broken = true;
    }

    // Mint ore NFT
    try {
      const oreTx = await mintItem(walletAddress, oreProps.tokenId, 1n);

      server.log.info(
        `[mining] ${entity.name} mined ${oreProps.label} with ${pickaxeItem.name} (${weaponEquipped.durability}/${weaponEquipped.maxDurability} dur) → ${oreTx}`
      );

      // Log mine diary entry
      if (walletAddress) {
        const { headline, narrative } = narrativeMine(entity.name, entity.raceId, entity.classId, zoneId, oreProps.label, pickaxeItem.name);
        logDiary(walletAddress, entity.name, zoneId, entity.x, entity.y, "mine", headline, narrative, {
          oreName: oreProps.label,
          pickaxeName: pickaxeItem.name,
          chargesRemaining,
        });
      }

      return {
        ok: true,
        oreType: oreNode.oreType,
        oreName: oreProps.label,
        quantity: 1,
        chargesRemaining,
        tokenId: oreProps.tokenId.toString(),
        oreTx,
        pickaxe: {
          name: pickaxeItem.name,
          durability: weaponEquipped.durability,
          maxDurability: weaponEquipped.maxDurability,
          broken: weaponEquipped.broken,
        },
      };
    } catch (err) {
      server.log.error(err, `[mining] Failed for ${walletAddress}`);

      // Refund charge and durability on mint failure
      oreNode.charges = (oreNode.charges ?? 0) + 1;
      if (oreNode.charges > 0) oreNode.depletedAtTick = undefined;
      weaponEquipped.durability = Math.min(weaponEquipped.maxDurability, weaponEquipped.durability + 1);
      if (weaponEquipped.durability > 0) weaponEquipped.broken = false;

      reply.code(500);
      return { error: "Mining transaction failed" };
    }
  });
}
