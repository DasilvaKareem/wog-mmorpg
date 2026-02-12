import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";
import { mintItem } from "./blockchain.js";
import { FLOWER_CATALOG } from "./flowerCatalog.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { hasLearnedProfession } from "./professions.js";
import { authenticateRequest } from "./auth.js";

const GATHER_RANGE = 50;

// Sickle tier mapping (tokenId -> tier)
const SICKLE_TIERS: Record<number, number> = {
  41: 1, // Basic Sickle
  42: 2, // Iron Sickle
  43: 3, // Steel Sickle
  44: 4, // Enchanted Sickle
};

export function registerHerbalismRoutes(server: FastifyInstance) {
  // GET /herbalism/catalog - flower types and requirements
  server.get("/herbalism/catalog", async () => {
    return Object.entries(FLOWER_CATALOG).map(([flowerType, props]) => ({
      flowerType,
      label: props.label,
      rarity: props.rarity,
      maxCharges: props.maxCharges,
      respawnTicks: props.respawnTicks,
      requiredSickleTier: props.requiredSickleTier,
      tokenId: props.tokenId.toString(),
    }));
  });

  // GET /herbalism/nodes/:zoneId - all flower nodes in zone
  server.get<{ Params: { zoneId: string } }>(
    "/herbalism/nodes/:zoneId",
    async (request, reply) => {
      const zone = getAllZones().get(request.params.zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const flowerNodes = Array.from(zone.entities.values())
        .filter((e) => e.type === "flower-node")
        .map((e) => ({
          id: e.id,
          name: e.name,
          x: e.x,
          y: e.y,
          flowerType: e.flowerType,
          charges: e.charges ?? 0,
          maxCharges: e.maxCharges ?? 0,
          depleted: e.depletedAtTick != null,
          requiredSickleTier: e.flowerType
            ? FLOWER_CATALOG[e.flowerType].requiredSickleTier
            : 1,
        }));

      return { zoneId: request.params.zoneId, flowerNodes };
    }
  );

  // POST /herbalism/gather - gather flowers with sickle
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      flowerNodeId: string;
    };
  }>("/herbalism/gather", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, flowerNodeId } = request.body;
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

    const flowerNode = zone.entities.get(flowerNodeId);
    if (!flowerNode || flowerNode.type !== "flower-node") {
      reply.code(404);
      return { error: "Flower node not found" };
    }

    // Check range
    const dx = flowerNode.x - entity.x;
    const dy = flowerNode.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > GATHER_RANGE) {
      reply.code(400);
      return { error: "Out of range", distance: Math.round(dist), maxRange: GATHER_RANGE };
    }

    // Check if depleted
    if (flowerNode.depletedAtTick != null || (flowerNode.charges ?? 0) <= 0) {
      reply.code(400);
      return { error: "Flower node depleted" };
    }

    // CRITICAL: Check if player has learned herbalism profession
    if (!hasLearnedProfession(walletAddress, "herbalism")) {
      reply.code(400);
      return {
        error: "You must learn the Herbalism profession from a trainer first",
        hint: "Find an Herbalism trainer to learn this profession",
      };
    }

    // CRITICAL: Check sickle equipped
    const weaponEquipped = entity.equipment?.weapon;
    if (!weaponEquipped || weaponEquipped.broken || weaponEquipped.durability <= 0) {
      reply.code(400);
      return { error: "No sickle equipped or sickle broken" };
    }

    const sickleItem = getItemByTokenId(BigInt(weaponEquipped.tokenId));
    if (!sickleItem || sickleItem.category !== "tool" || !sickleItem.name.includes("Sickle")) {
      reply.code(400);
      return { error: "Equipped weapon is not a sickle" };
    }

    const sickleTier = SICKLE_TIERS[weaponEquipped.tokenId] ?? 0;
    const flowerProps = FLOWER_CATALOG[flowerNode.flowerType!];
    if (sickleTier < flowerProps.requiredSickleTier) {
      reply.code(400);
      return {
        error: "Sickle tier too low for this flower",
        yourTier: sickleTier,
        requiredTier: flowerProps.requiredSickleTier,
      };
    }

    // Deplete flower charge
    flowerNode.charges = (flowerNode.charges ?? 0) - 1;
    const chargesRemaining = flowerNode.charges;
    if (flowerNode.charges <= 0) {
      flowerNode.depletedAtTick = zone.tick;
    }

    // CRITICAL: Reduce sickle durability
    weaponEquipped.durability = Math.max(0, weaponEquipped.durability - 1);
    if (weaponEquipped.durability === 0) {
      weaponEquipped.broken = true;
    }

    // Mint flower NFT
    try {
      const flowerTx = await mintItem(walletAddress, flowerProps.tokenId, 1n);

      server.log.info(
        `[herbalism] ${entity.name} gathered ${flowerProps.label} with ${sickleItem.name} (${weaponEquipped.durability}/${weaponEquipped.maxDurability} dur) → ${flowerTx}`
      );

      return {
        ok: true,
        flowerType: flowerNode.flowerType,
        flowerName: flowerProps.label,
        quantity: 1,
        chargesRemaining,
        tokenId: flowerProps.tokenId.toString(),
        flowerTx,
        sickle: {
          name: sickleItem.name,
          durability: weaponEquipped.durability,
          maxDurability: weaponEquipped.maxDurability,
          broken: weaponEquipped.broken,
        },
      };
    } catch (err) {
      server.log.error(err, `[herbalism] Failed for ${walletAddress}`);

      // Refund charge and durability on mint failure
      flowerNode.charges = (flowerNode.charges ?? 0) + 1;
      if (flowerNode.charges > 0) flowerNode.depletedAtTick = undefined;
      weaponEquipped.durability = Math.min(
        weaponEquipped.maxDurability,
        weaponEquipped.durability + 1
      );
      if (weaponEquipped.durability > 0) weaponEquipped.broken = false;

      reply.code(500);
      return { error: "Gathering transaction failed" };
    }
  });
}
