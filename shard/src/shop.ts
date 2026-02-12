import type { FastifyInstance } from "fastify";
import { getGoldBalance, mintItem } from "./blockchain.js";
import { formatGold, getAvailableGold, recordGoldSpend } from "./goldLedger.js";
import { ITEM_CATALOG, getItemByTokenId, getItemsByTokenIds } from "./itemCatalog.js";
import { getAllZones } from "./zoneRuntime.js";

export function registerShopRoutes(server: FastifyInstance) {
  /**
   * GET /shop/catalog
   * Returns the full item catalog with prices.
   */
  server.get("/shop/catalog", async () => {
    return ITEM_CATALOG.map((item) => ({
      tokenId: item.tokenId.toString(),
      name: item.name,
      description: item.description,
      goldPrice: item.goldPrice,
      category: item.category,
      equipSlot: item.equipSlot ?? null,
      armorSlot: item.armorSlot ?? null,
      statBonuses: item.statBonuses ?? {},
      maxDurability: item.maxDurability ?? null,
    }));
  });

  /**
   * GET /shop/npc/:zoneId/:entityId
   * Returns the catalog for a specific merchant NPC (filtered by their shopItems).
   */
  server.get<{ Params: { zoneId: string; entityId: string } }>(
    "/shop/npc/:zoneId/:entityId",
    async (request, reply) => {
      const { zoneId, entityId } = request.params;

      const zone = getAllZones().get(zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const entity = zone.entities.get(entityId);
      if (!entity || entity.type !== "merchant" || !entity.shopItems) {
        reply.code(404);
        return { error: "Merchant not found" };
      }

      const items = getItemsByTokenIds(entity.shopItems);

      return {
        npcId: entity.id,
        npcName: entity.name,
        items: items.map((item) => ({
          tokenId: item.tokenId.toString(),
          name: item.name,
          description: item.description,
          goldPrice: item.goldPrice,
          category: item.category,
          equipSlot: item.equipSlot ?? null,
          armorSlot: item.armorSlot ?? null,
          statBonuses: item.statBonuses ?? {},
          maxDurability: item.maxDurability ?? null,
        })),
      };
    }
  );

  /**
   * POST /shop/buy { buyerAddress, tokenId, quantity }
   * Server-authoritative purchase: checks available wallet gold, records spend, mints item.
   */
  server.post<{
    Body: { buyerAddress: string; tokenId: number; quantity: number };
  }>("/shop/buy", async (request, reply) => {
    const { buyerAddress, tokenId, quantity } = request.body;

    if (!buyerAddress || !/^0x[a-fA-F0-9]{40}$/.test(buyerAddress)) {
      reply.code(400);
      return { error: "Invalid buyer address" };
    }

    if (quantity < 1 || quantity > 100) {
      reply.code(400);
      return { error: "Quantity must be between 1 and 100" };
    }

    const item = getItemByTokenId(BigInt(tokenId));
    if (!item) {
      reply.code(400);
      return { error: `Unknown tokenId: ${tokenId}` };
    }

    const totalCost = item.goldPrice * quantity;

    try {
      const onChainGold = parseFloat(await getGoldBalance(buyerAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = getAvailableGold(buyerAddress, safeOnChainGold);
      if (availableGold < totalCost) {
        reply.code(400);
        return {
          error: "Insufficient gold",
          required: totalCost,
          available: formatGold(availableGold),
        };
      }

      // Mint the item to the buyer
      const itemTx = await mintItem(buyerAddress, item.tokenId, BigInt(quantity));
      server.log.info(
        `Minted ${quantity}x ${item.name} to ${buyerAddress}: ${itemTx}`
      );
      recordGoldSpend(buyerAddress, totalCost);

      return {
        ok: true,
        item: item.name,
        quantity,
        totalCost,
        remainingGold: formatGold(getAvailableGold(buyerAddress, safeOnChainGold)),
        itemTx,
      };
    } catch (err) {
      server.log.error(err, `Shop buy failed for ${buyerAddress}`);
      reply.code(500);
      return { error: "Purchase transaction failed" };
    }
  });
}
