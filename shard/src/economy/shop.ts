import type { FastifyInstance } from "fastify";
import { getGoldBalance, mintGold, mintItem, getItemBalance, burnItem, transferGoldFrom } from "../blockchain/blockchain.js";
import { formatGold, getAvailableGoldAsync, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import { ITEM_CATALOG, getItemByTokenId, getItemRecycleCopperValue, getItemsByTokenIds } from "../items/itemCatalog.js";
import { getEquippedInstanceIds, getEquippedItemCounts, getRecyclableQuantity } from "../items/inventoryState.js";
import { consumeOwnedItemInstances } from "../items/itemRng.js";
import { getEntity, getAllEntities } from "../world/zoneRuntime.js";
import { authenticateRequest } from "../auth/auth.js";
import { getCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import {
  getMerchantState,
  getMerchantPrice,
  getMerchantStock,
  getMerchantBuyPrice,
  recordMerchantSale,
  recordMerchantPurchase,
  resolveMerchantEntityId,
} from "../world/merchantAgent.js";
import { logDiary, narrativeBuy, narrativeRecycle, narrativeSell } from "../social/diary.js";
import { copperToGold } from "../blockchain/currency.js";

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
   * GET /shop/npc/:entityId
   * Returns the catalog for a specific merchant NPC (filtered by their shopItems).
   * Includes dynamic pricing and stock if merchant agent is active.
   */
  const shopNpcHandler = async (request: any, reply: any) => {
    const requestedEntityId = request.params.entityId;
    const entityId = resolveMerchantEntityId(requestedEntityId);

    const entity = getEntity(entityId);
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
  };

  server.get<{ Params: { entityId: string } }>(
    "/shop/npc/:entityId",
    shopNpcHandler
  );

  // Backward compat alias
  server.get<{ Params: { zoneId: string; entityId: string } }>(
    "/shop/npc/:zoneId/:entityId",
    shopNpcHandler
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

    // Verify authenticated wallet matches buyer (direct or via custodial ownership)
    const buyerLower = buyerAddress.toLowerCase();
    const authLower = authenticatedWallet.toLowerCase();
    let shopAuthorized = buyerLower === authLower;
    if (!shopAuthorized) {
      const custodial = await getAgentCustodialWallet(authenticatedWallet);
      shopAuthorized = !!custodial && buyerLower === custodial.toLowerCase();
    }
    if (!shopAuthorized) {
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

    const totalCost = unitPrice * quantity; // in copper
    const goldCost = copperToGold(totalCost); // convert to on-chain gold

    try {
      const onChainGold = parseFloat(await getGoldBalance(buyerAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(buyerAddress, safeOnChainGold);
      if (availableGold < goldCost) {
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
      await recordGoldSpendAsync(buyerAddress, goldCost);

      // Update merchant inventory if using dynamic path
      if (merchantState) {
        await recordMerchantSale(merchantEntityId!, tokenId, quantity);
      }

      // Log buy diary entry
      {
        let buyerEntity: { name: string; raceId?: string; classId?: string; region?: string; x: number; y: number } | undefined;
        for (const e of getAllEntities().values()) {
          if (e.walletAddress?.toLowerCase() === buyerAddress.toLowerCase()) {
            buyerEntity = e;
            break;
          }
        }
        if (buyerEntity) {
          const buyerZoneId = (buyerEntity as any).region ?? "unknown";
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
        remainingGold: formatGold(await getAvailableGoldAsync(buyerAddress, safeOnChainGold)),
        itemTx,
      merchantEntityId: merchantEntityId ? resolveMerchantEntityId(merchantEntityId) : null,
      };
    } catch (err) {
      server.log.error(err, `Shop buy failed for ${buyerAddress}`);
      reply.code(500);
      return { error: "Purchase transaction failed" };
    }
  });

  /**
   * POST /shop/sell { sellerAddress, merchantEntityId, tokenId, quantity }
   * Sell items back to a merchant for gold.
   * PROTECTED - Requires authentication
   */
  server.post<{
    Body: {
      sellerAddress: string;
      merchantEntityId: string;
      zoneId?: string;
      tokenId: number;
      quantity: number;
    };
  }>("/shop/sell", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { sellerAddress, merchantEntityId, tokenId, quantity } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!sellerAddress || !/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
      reply.code(400);
      return { error: "Invalid seller address" };
    }

    const sellerLower = sellerAddress.toLowerCase();
    const authLowerSell = authenticatedWallet.toLowerCase();
    let sellAuthorized = sellerLower === authLowerSell;
    if (!sellAuthorized) {
      const custodial = await getAgentCustodialWallet(authenticatedWallet);
      sellAuthorized = !!custodial && sellerLower === custodial.toLowerCase();
    }
    if (!sellAuthorized) {
      reply.code(403);
      return { error: "Not authorized to sell for this wallet" };
    }

    if (quantity < 1 || quantity > 100) {
      reply.code(400);
      return { error: "Quantity must be between 1 and 100" };
    }

    // Validate merchant entity exists and is a merchant
    const entity = getEntity(merchantEntityId);
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

    const totalPayout = unitBuyPrice * quantity; // in copper
    const goldPayout = copperToGold(totalPayout); // convert to on-chain gold

    // Check merchant can afford the payout
    if (merchantState.goldBalance < goldPayout) {
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

      const ownedQuantity = Number(sellerBalance);
      const equippedCounts = await getEquippedItemCounts(sellerAddress);
      const equippedCount = equippedCounts.get(tokenId) ?? 0;
      const sellableQuantity = getRecyclableQuantity(ownedQuantity, equippedCount);
      if (quantity > sellableQuantity) {
        reply.code(400);
        return {
          error: equippedCount > 0
            ? "That item is equipped on one of your characters. Unequip it or sell only extra copies."
            : "You can't sell more than you own.",
          ownedQuantity,
          equippedCount,
          sellableQuantity,
        };
      }

      // Burn items from seller
      await burnItem(sellerAddress, BigInt(tokenId), BigInt(quantity));
      const equippedInstanceIds = await getEquippedInstanceIds(sellerAddress);
      await consumeOwnedItemInstances(sellerAddress, tokenId, quantity, equippedInstanceIds);

      // Transfer gold from merchant's custodial wallet to seller (no new gold minted)
      const merchantAccount = await getCustodialWallet(merchantState.walletAddress);
      await transferGoldFrom(merchantAccount, sellerAddress, goldPayout.toString());

      // Update merchant's in-memory gold balance (on-chain balance decreases naturally)
      merchantState.goldBalance = Math.max(0, merchantState.goldBalance - goldPayout);

      // Update merchant inventory
      await recordMerchantPurchase(merchantEntityId, tokenId, quantity);

      server.log.info(
        `[shop/sell] ${sellerAddress} sold ${quantity}x ${item.name} to ${entity.name} for ${totalPayout} gold`
      );

      // Log sell diary entry
      {
        let sellerEntity: { name: string; raceId?: string; classId?: string; region?: string; x: number; y: number } | undefined;
        for (const e of getAllEntities().values()) {
          if (e.walletAddress?.toLowerCase() === sellerAddress.toLowerCase()) {
            sellerEntity = e;
            break;
          }
        }
        if (sellerEntity) {
          const zoneId = (sellerEntity as any).region ?? "unknown";
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
   * POST /shop/recycle { sellerAddress, tokenId, quantity }
   * Burn NFT items and mint GOLD based on recycle value.
   * PROTECTED - Requires authentication
   */
  server.post<{
    Body: {
      sellerAddress: string;
      tokenId: number;
      quantity: number;
    };
  }>("/shop/recycle", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { sellerAddress, tokenId, quantity } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!sellerAddress || !/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
      reply.code(400);
      return { error: "Invalid seller address" };
    }

    const sellerLower = sellerAddress.toLowerCase();
    const authLowerSell = authenticatedWallet.toLowerCase();
    let recycleAuthorized = sellerLower === authLowerSell;
    if (!recycleAuthorized) {
      const custodial = await getAgentCustodialWallet(authenticatedWallet);
      recycleAuthorized = !!custodial && sellerLower === custodial.toLowerCase();
    }
    if (!recycleAuthorized) {
      reply.code(403);
      return { error: "Not authorized to recycle for this wallet" };
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

    const recycleCopperValue = getItemRecycleCopperValue(item);
    const totalPayoutCopper = recycleCopperValue * quantity;
    const goldPayout = copperToGold(totalPayoutCopper);

    try {
      const sellerBalance = await getItemBalance(sellerAddress, BigInt(tokenId));
      if (sellerBalance < BigInt(quantity)) {
        reply.code(400);
        return { error: "You don't have enough of this item", balance: sellerBalance.toString() };
      }

      const ownedQuantity = Number(sellerBalance);
      const equippedCounts = await getEquippedItemCounts(sellerAddress);
      const equippedCount = equippedCounts.get(tokenId) ?? 0;
      const recyclableQuantity = getRecyclableQuantity(ownedQuantity, equippedCount);
      if (quantity > recyclableQuantity) {
        reply.code(400);
        return {
          error: equippedCount > 0
            ? "That item is equipped on one of your characters. Unequip it or recycle only extra copies."
            : "You can't recycle more than you own.",
          ownedQuantity,
          equippedCount,
          recyclableQuantity,
        };
      }

      const burnTx = await burnItem(sellerAddress, BigInt(tokenId), BigInt(quantity));
      const equippedInstanceIds = await getEquippedInstanceIds(sellerAddress);
      await consumeOwnedItemInstances(sellerAddress, tokenId, quantity, equippedInstanceIds);
      const goldTx = await mintGold(sellerAddress, goldPayout.toString());

      server.log.info(
        `[shop/recycle] ${sellerAddress} recycled ${quantity}x ${item.name} for ${totalPayoutCopper}c`
      );

      {
        let sellerEntity: { name: string; raceId?: string; classId?: string; region?: string; x: number; y: number } | undefined;
        for (const e of getAllEntities().values()) {
          if (e.walletAddress?.toLowerCase() === sellerAddress.toLowerCase()) {
            sellerEntity = e;
            break;
          }
        }
        if (sellerEntity) {
          const zoneId = (sellerEntity as any).region ?? "unknown";
          const { headline, narrative } = narrativeRecycle(
            sellerEntity.name,
            sellerEntity.raceId,
            sellerEntity.classId,
            zoneId,
            item.name,
            quantity,
            totalPayoutCopper,
          );
          logDiary(sellerAddress, sellerEntity.name, zoneId, sellerEntity.x, sellerEntity.y, "recycle", headline, narrative, {
            itemName: item.name,
            tokenId,
            quantity,
            unitRecycleValue: recycleCopperValue,
            totalPayoutCopper,
          });
        }
      }

      return {
        ok: true,
        item: item.name,
        quantity,
        unitRecycleValue: recycleCopperValue,
        totalPayoutCopper,
        goldPayout,
        burnTx,
        goldTx,
      };
    } catch (err) {
      server.log.error(err, `Shop recycle failed for ${sellerAddress}`);
      reply.code(500);
      return { error: "Recycle transaction failed" };
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
