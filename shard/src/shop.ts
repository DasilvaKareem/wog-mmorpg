import type { FastifyInstance } from "fastify";
import { getGoldBalance, mintItem, getItemBalance, burnItem, transferGoldFrom } from "./blockchain.js";
import { formatGold, getAvailableGold, recordGoldSpend } from "./goldLedger.js";
import { ITEM_CATALOG, getItemByTokenId, getItemsByTokenIds } from "./itemCatalog.js";
import { getAllZones } from "./zoneRuntime.js";
import { authenticateRequest } from "./auth.js";
import { getCustodialWallet } from "./custodialWalletRedis.js";
import {
  getMerchantState,
  getMerchantPrice,
  getMerchantStock,
  getMerchantBuyPrice,
  recordMerchantSale,
  recordMerchantPurchase,
} from "./merchantAgent.js";
import { logDiary, narrativeBuy, narrativeSell } from "./diary.js";

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
      copperPrice: item.copperPrice,
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
   * Includes dynamic pricing and stock if merchant agent is active.
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
      const merchantActive = !!getMerchantState(entityId);

      return {
        npcId: entity.id,
        npcName: entity.name,
        merchantActive,
        items: items.map((item) => {
          const tokenIdNum = Number(item.tokenId);
          const dynamicPrice = getMerchantPrice(entityId, tokenIdNum);
          const stock = getMerchantStock(entityId, tokenIdNum);
          const buyPrice = getMerchantBuyPrice(entityId, tokenIdNum);

          return {
            tokenId: item.tokenId.toString(),
            name: item.name,
            description: item.description,
            copperPrice: item.copperPrice,
            currentPrice: dynamicPrice ?? item.copperPrice,
            stock: stock ?? null,
            buyPrice: buyPrice ?? null,
            category: item.category,
            equipSlot: item.equipSlot ?? null,
            armorSlot: item.armorSlot ?? null,
            statBonuses: item.statBonuses ?? {},
            maxDurability: item.maxDurability ?? null,
          };
        }),
      };
    }
  );

  /**
   * POST /shop/buy { buyerAddress, tokenId, quantity, merchantEntityId? }
   * Server-authoritative purchase: checks available wallet gold, records spend, mints item.
   * If merchantEntityId is provided, uses dynamic pricing + real inventory.
   * PROTECTED - Requires authentication
   */
  server.post<{
    Body: { buyerAddress: string; tokenId: number; quantity: number; merchantEntityId?: string };
  }>("/shop/buy", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { buyerAddress, tokenId, quantity, merchantEntityId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!buyerAddress || !/^0x[a-fA-F0-9]{40}$/.test(buyerAddress)) {
      reply.code(400);
      return { error: "Invalid buyer address" };
    }

    // Verify authenticated wallet matches buyer
    if (buyerAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to purchase for this wallet" };
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

    // Dynamic pricing path — if merchantEntityId provided and merchant agent is active
    const merchantState = merchantEntityId ? getMerchantState(merchantEntityId) : undefined;
    let unitPrice = item.copperPrice;

    if (merchantState) {
      const stock = getMerchantStock(merchantEntityId!, tokenId);
      if (stock === undefined || stock < quantity) {
        reply.code(400);
        return {
          error: "Merchant does not have enough stock",
          available: stock ?? 0,
          requested: quantity,
        };
      }
      const dynPrice = getMerchantPrice(merchantEntityId!, tokenId);
      if (dynPrice !== undefined) {
        unitPrice = dynPrice;
      }
    }

    const totalCost = unitPrice * quantity;

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

      // Update merchant inventory if using dynamic path
      if (merchantState) {
        recordMerchantSale(merchantEntityId!, tokenId, quantity);
      }

      // Log buy diary entry
      {
        let buyerEntity: { name: string; raceId?: string; classId?: string; x: number; y: number } | undefined;
        let buyerZoneId = "unknown";
        for (const [zId, zone] of getAllZones()) {
          for (const e of zone.entities.values()) {
            if (e.walletAddress?.toLowerCase() === buyerAddress.toLowerCase()) {
              buyerEntity = e;
              buyerZoneId = zId;
              break;
            }
          }
          if (buyerEntity) break;
        }
        if (buyerEntity) {
          const { headline, narrative } = narrativeBuy(buyerEntity.name, buyerEntity.raceId, buyerEntity.classId, buyerZoneId, item.name, quantity, totalCost);
          logDiary(buyerAddress, buyerEntity.name, buyerZoneId, buyerEntity.x, buyerEntity.y, "buy", headline, narrative, {
            itemName: item.name,
            tokenId,
            quantity,
            unitPrice,
            totalCost,
          });
        }
      }

      return {
        ok: true,
        item: item.name,
        quantity,
        unitPrice,
        totalCost,
        remainingGold: formatGold(getAvailableGold(buyerAddress, safeOnChainGold)),
        itemTx,
        merchantEntityId: merchantEntityId ?? null,
      };
    } catch (err) {
      server.log.error(err, `Shop buy failed for ${buyerAddress}`);
      reply.code(500);
      return { error: "Purchase transaction failed" };
    }
  });

  /**
   * POST /shop/sell { sellerAddress, merchantEntityId, zoneId, tokenId, quantity }
   * Sell items back to a merchant for gold.
   * PROTECTED - Requires authentication
   */
  server.post<{
    Body: {
      sellerAddress: string;
      merchantEntityId: string;
      zoneId: string;
      tokenId: number;
      quantity: number;
    };
  }>("/shop/sell", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { sellerAddress, merchantEntityId, zoneId, tokenId, quantity } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!sellerAddress || !/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
      reply.code(400);
      return { error: "Invalid seller address" };
    }

    if (sellerAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to sell for this wallet" };
    }

    if (quantity < 1 || quantity > 100) {
      reply.code(400);
      return { error: "Quantity must be between 1 and 100" };
    }

    // Validate merchant entity exists and is a merchant
    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    const entity = zone.entities.get(merchantEntityId);
    if (!entity || entity.type !== "merchant") {
      reply.code(404);
      return { error: "Merchant not found" };
    }

    // Check merchant agent is active
    const merchantState = getMerchantState(merchantEntityId);
    if (!merchantState) {
      reply.code(400);
      return { error: "Merchant is not accepting purchases at this time" };
    }

    // Get buy price — merchant must deal in this item
    const unitBuyPrice = getMerchantBuyPrice(merchantEntityId, tokenId);
    if (unitBuyPrice === undefined || unitBuyPrice <= 0) {
      reply.code(400);
      return { error: "Merchant does not buy this item" };
    }

    const totalPayout = unitBuyPrice * quantity;

    // Check merchant can afford the payout
    if (merchantState.goldBalance < totalPayout) {
      reply.code(400);
      return { error: "Merchant does not have enough gold", merchantGold: merchantState.goldBalance };
    }

    const item = getItemByTokenId(BigInt(tokenId));
    if (!item) {
      reply.code(400);
      return { error: `Unknown tokenId: ${tokenId}` };
    }

    try {
      // Verify seller has the items
      const sellerBalance = await getItemBalance(sellerAddress, BigInt(tokenId));
      if (sellerBalance < BigInt(quantity)) {
        reply.code(400);
        return { error: "You don't have enough of this item", balance: sellerBalance.toString() };
      }

      // Burn items from seller
      await burnItem(sellerAddress, BigInt(tokenId), BigInt(quantity));

      // Transfer gold from merchant's custodial wallet to seller (no new gold minted)
      const merchantAccount = await getCustodialWallet(merchantState.walletAddress);
      await transferGoldFrom(merchantAccount, sellerAddress, String(totalPayout));

      // Update merchant's in-memory gold balance (on-chain balance decreases naturally)
      merchantState.goldBalance = Math.max(0, merchantState.goldBalance - totalPayout);

      // Update merchant inventory
      recordMerchantPurchase(merchantEntityId, tokenId, quantity);

      server.log.info(
        `[shop/sell] ${sellerAddress} sold ${quantity}x ${item.name} to ${entity.name} for ${totalPayout} gold`
      );

      // Log sell diary entry
      {
        let sellerEntity: { name: string; raceId?: string; classId?: string; x: number; y: number } | undefined;
        for (const e of zone.entities.values()) {
          if (e.walletAddress?.toLowerCase() === sellerAddress.toLowerCase()) {
            sellerEntity = e;
            break;
          }
        }
        if (sellerEntity) {
          const { headline, narrative } = narrativeSell(sellerEntity.name, sellerEntity.raceId, sellerEntity.classId, zoneId, item.name, quantity, totalPayout);
          logDiary(sellerAddress, sellerEntity.name, zoneId, sellerEntity.x, sellerEntity.y, "sell", headline, narrative, {
            itemName: item.name,
            tokenId,
            quantity,
            unitBuyPrice,
            totalPayout,
            merchantName: entity.name,
          });
        }
      }

      return {
        ok: true,
        item: item.name,
        quantity,
        unitBuyPrice,
        totalPayout,
        merchantEntityId,
      };
    } catch (err) {
      server.log.error(err, `Shop sell failed for ${sellerAddress}`);
      reply.code(500);
      return { error: "Sell transaction failed" };
    }
  });

  /**
   * GET /shop/sell-prices/:merchantEntityId
   * Discovery endpoint — what the merchant pays for each item + current stock.
   */
  server.get<{ Params: { merchantEntityId: string } }>(
    "/shop/sell-prices/:merchantEntityId",
    async (request, reply) => {
      const { merchantEntityId } = request.params;

      const merchantState = getMerchantState(merchantEntityId);
      if (!merchantState) {
        reply.code(404);
        return { error: "Merchant agent not found" };
      }

      const items: {
        tokenId: string;
        name: string;
        buyPrice: number;
        currentPrice: number;
        stock: number;
        targetStock: number;
      }[] = [];

      for (const [tokenId, entry] of merchantState.inventory) {
        const item = getItemByTokenId(BigInt(tokenId));
        if (!item) continue;

        const buyPrice = getMerchantBuyPrice(merchantEntityId, tokenId);
        items.push({
          tokenId: item.tokenId.toString(),
          name: item.name,
          buyPrice: buyPrice ?? 0,
          currentPrice: entry.currentPrice,
          stock: entry.quantity,
          targetStock: entry.targetStock,
        });
      }

      return {
        merchantEntityId,
        npcName: merchantState.npcName,
        zoneId: merchantState.zoneId,
        merchantGold: merchantState.goldBalance,
        items,
      };
    }
  );
}
