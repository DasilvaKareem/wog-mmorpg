import type { FastifyInstance } from "fastify";
import { burnItem, getGoldBalance, getItemBalance, mintItem } from "../blockchain/blockchain.js";
import {
  formatGold,
  getAvailableGoldAsync,
  recordGoldSpendAsync,
  reserveGoldAsync,
  unreserveGoldAsync,
} from "../blockchain/goldLedger.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { assignItemInstanceOwner, getAuctionEscrowInstance, getWalletInstanceByToken } from "../items/itemRng.js";
import {
  createAuctionOnChain,
  placeBidOnChain,
  buyoutAuctionOnChain,
  cancelAuctionOnChain,
  getAuctionFromChain,
  getZoneAuctionsFromChain,
  type AuctionData,
} from "./auctionHouseChain.js";
import { getAllEntities, getEntity } from "../world/zoneRuntime.js";
import { authenticateRequest } from "../auth/auth.js";
import { copperToGold } from "../blockchain/currency.js";
import { getEquippedInstanceIds, getEquippedItemCounts } from "../items/inventoryState.js";

const AUCTION_LISTING_FEE = copperToGold(50); // 50 copper = 0.005 GOLD
const AUCTION_CANCEL_FEE = copperToGold(25);  // 25 copper = 0.0025 GOLD

const STATUS_NAMES = ["active", "ended", "cancelled"];

function formatAuctionForResponse(auction: AuctionData) {
  const item = getItemByTokenId(BigInt(auction.tokenId));
  const instance = getAuctionEscrowInstance(auction.auctionId);

  return {
    auctionId: auction.auctionId,
    zoneId: auction.zoneId,
    seller: auction.seller,
    tokenId: auction.tokenId,
    instanceId: instance?.instanceId ?? null,
    itemName: instance?.displayName ?? item?.name ?? "Unknown Item",
    quantity: auction.quantity,
    startPrice: auction.startPrice,
    buyoutPrice: auction.buyoutPrice > 0 ? auction.buyoutPrice : null,
    endTime: auction.endTime,
    timeRemaining: Math.max(0, auction.endTime - Math.floor(Date.now() / 1000)),
    highBidder: auction.highBidder !== "0x0000000000000000000000000000000000000000"
      ? auction.highBidder
      : null,
    highBid: auction.highBid > 0 ? auction.highBid : null,
    status: STATUS_NAMES[auction.status] || "unknown",
    extensionCount: auction.extensionCount,
    quality: instance?.quality?.tier ?? null,
    rolledStats: instance?.rolledStats ?? {},
    bonusAffix: instance?.bonusAffix ?? null,
    maxDurability: instance?.currentMaxDurability ?? item?.maxDurability ?? null,
    durability: instance?.currentDurability ?? null,
  };
}

export function registerAuctionHouseRoutes(server: FastifyInstance) {
  function resolveZoneAgentId(zoneId: string, walletAddress: string): string | null {
    const matches = new Set<string>();

    for (const entity of getAllEntities().values()) {
      if (entity.type !== "player") continue;
      if (entity.region !== zoneId) continue;
      if (entity.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) continue;
      if (entity.agentId == null) continue;
      matches.add(entity.agentId.toString());
    }

    if (matches.size !== 1) return null;
    return Array.from(matches)[0] ?? null;
  }

  /**
   * GET /auctionhouse/npc/:entityId
   * Get auctioneer NPC details and list active auctions in their zone.
   * This is the main discovery endpoint for AI agents.
   */
  const auctionNpcHandler = async (request: any, reply: any) => {
    const entityId = request.params.entityId;

    const entity = getEntity(entityId);
    if (!entity || entity.type !== "auctioneer") {
      reply.code(404);
      return { error: "Auctioneer not found" };
    }

    const zoneId = request.params.zoneId ?? entity.region ?? "unknown";

    try {
      // Get all active auctions for this zone
      const auctionIds = await getZoneAuctionsFromChain(zoneId, 0); // 0 = Active status
      const activeAuctions = [];

      for (const auctionId of auctionIds) {
        const auction = await getAuctionFromChain(auctionId);
        activeAuctions.push(formatAuctionForResponse(auction));
      }

      return {
        npcId: entity.id,
        npcName: entity.name,
        npcType: entity.type,
        zoneId,
        description: `${entity.name} operates the regional auction house for ${zoneId}. Browse active auctions, place bids, or list your own items for sale.`,
        activeAuctions,
        endpoints: {
          listAuctions: `/auctionhouse/${zoneId}/auctions`,
          createAuction: `/auctionhouse/${zoneId}/create`,
          placeBid: `/auctionhouse/${zoneId}/bid`,
          buyout: `/auctionhouse/${zoneId}/buyout`,
        },
      };
    } catch (err) {
      server.log.error(err, `Failed to get auctioneer NPC ${entityId}`);
      reply.code(500);
      return { error: "Failed to retrieve auction house data" };
    }
  };

  server.get("/auctionhouse/npc/:entityId", auctionNpcHandler);
  // Compat alias
  server.get("/auctionhouse/npc/:zoneId/:entityId", auctionNpcHandler);

  /**
   * POST /auctionhouse/:zoneId/create
   * Create a new auction listing in a specific zone.
   */
  server.post<{
    Params: { zoneId: string };
    Body: {
      sellerAddress: string;
      tokenId: number;
      quantity: number;
      startPrice: number;
      durationMinutes: number;
      buyoutPrice?: number;
      instanceId?: string;
    };
  }>("/auctionhouse/:zoneId/create", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId } = request.params;
    const { sellerAddress, tokenId, quantity, startPrice, durationMinutes, buyoutPrice, instanceId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!sellerAddress || !/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
      reply.code(400);
      return { error: "Invalid seller address" };
    }

    // Verify authenticated wallet matches request wallet
    if (sellerAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    if (quantity < 1) {
      reply.code(400);
      return { error: "Quantity must be at least 1" };
    }

    if (startPrice <= 0) {
      reply.code(400);
      return { error: "Start price must be positive" };
    }

    if (durationMinutes < 1) {
      reply.code(400);
      return { error: "Duration must be at least 1 minute" };
    }

    if (buyoutPrice !== undefined && buyoutPrice > 0 && buyoutPrice <= startPrice) {
      reply.code(400);
      return { error: "Buyout price must be greater than start price" };
    }

    if (instanceId && quantity !== 1) {
      reply.code(400);
      return { error: "Instance auctions must have quantity 1" };
    }

    let escrowBurnTx: string | null = null;
    let auctionCreated = false;
    let createdAuctionId: number | null = null;
    let escrowedInstanceId: string | null = null;

    try {
      const item = getItemByTokenId(BigInt(tokenId));
      if (!item) {
        reply.code(400);
        return { error: "Unknown item tokenId" };
      }

      // Verify seller owns the item on the main SKALE chain
      const balance = await getItemBalance(sellerAddress, BigInt(tokenId));
      if (balance < BigInt(quantity)) {
        reply.code(400);
        return {
          error: "Insufficient item balance",
          required: quantity,
          available: balance.toString(),
        };
      }

      // Prevent auctioning items that are currently equipped on any of the wallet's characters.
      const equippedCounts = await getEquippedItemCounts(sellerAddress);
      const equippedCount = equippedCounts.get(tokenId) ?? 0;
      const auctionableQuantity = Number(balance) - equippedCount;
      if (auctionableQuantity < quantity) {
        reply.code(400);
        return {
          error: "Cannot auction equipped items",
          required: quantity,
          available: Math.max(0, auctionableQuantity),
          equipped: equippedCount,
        };
      }

      const equippedInstanceIds = quantity === 1
        ? await getEquippedInstanceIds(sellerAddress)
        : undefined;
      const selectedInstance = quantity === 1
        ? getWalletInstanceByToken(sellerAddress, tokenId, instanceId, equippedInstanceIds)
        : undefined;
      if (instanceId && !selectedInstance) {
        reply.code(400);
        return { error: "Item instance not found for this wallet" };
      }

      // Ensure seller can pay the listing fee.
      const onChainGold = parseFloat(await getGoldBalance(sellerAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(sellerAddress, safeOnChainGold);
      if (availableGold < AUCTION_LISTING_FEE) {
        reply.code(400);
        return {
          error: "Insufficient gold for listing fee",
          required: AUCTION_LISTING_FEE,
          available: availableGold,
          message: `Listing fee is ${formatGold(AUCTION_LISTING_FEE)} (50 copper)`,
        };
      }

      const durationSeconds = durationMinutes * 60;
      const finalBuyoutPrice = buyoutPrice && buyoutPrice > 0 ? buyoutPrice : 0;

      // Burn the item into server-managed escrow before exposing the auction on-chain.
      escrowBurnTx = await burnItem(sellerAddress, BigInt(tokenId), BigInt(quantity));

      // Create auction on BITE v2 chain
      const { auctionId, txHash } = await createAuctionOnChain(
        zoneId,
        sellerAddress,
        tokenId,
        quantity,
        startPrice,
        durationSeconds,
        finalBuyoutPrice
      );
      auctionCreated = true;
      createdAuctionId = auctionId;

      if (selectedInstance) {
        const escrowed = await assignItemInstanceOwner(selectedInstance.instanceId, `auction:${auctionId}`);
        if (!escrowed) {
          throw new Error(`Failed to move instance ${selectedInstance.instanceId} into auction escrow`);
        }
        escrowedInstanceId = escrowed.instanceId;
      }

      await recordGoldSpendAsync(sellerAddress, AUCTION_LISTING_FEE);
      server.log.info(
        `Auction ${auctionId} created in ${zoneId} by ${sellerAddress}: tokenId=${tokenId} qty=${quantity} escrowTx=${escrowBurnTx}${escrowedInstanceId ? ` instance=${escrowedInstanceId}` : ""}`
      );

      return {
        ok: true,
        auctionId,
        zoneId,
        endTime: Math.floor(Date.now() / 1000) + durationSeconds,
        escrowTx: escrowBurnTx,
        instanceId: escrowedInstanceId,
        txHash,
      };
    } catch (err) {
      if (createdAuctionId != null) {
        try {
          await cancelAuctionOnChain(createdAuctionId);
        } catch (cancelErr) {
          server.log.error(cancelErr, `CRITICAL: failed to cancel partially-created auction ${createdAuctionId}`);
        }
      }
      if (escrowBurnTx && !auctionCreated) {
        try {
          const restoreTx = await mintItem(sellerAddress, BigInt(tokenId), BigInt(quantity));
          server.log.warn(
            `Auction creation failed after escrow burn; restored ${quantity}x token ${tokenId} to ${sellerAddress} via ${restoreTx}`
          );
        } catch (restoreErr) {
          server.log.error(
            restoreErr,
            `CRITICAL: failed to restore escrowed auction item tokenId=${tokenId} qty=${quantity} seller=${sellerAddress}`
          );
        }
      } else if (escrowBurnTx && createdAuctionId != null) {
        try {
          const restoreTx = await mintItem(sellerAddress, BigInt(tokenId), BigInt(quantity));
          server.log.warn(
            `Auction ${createdAuctionId} rolled back after partial creation; restored ${quantity}x token ${tokenId} to ${sellerAddress} via ${restoreTx}`
          );
        } catch (restoreErr) {
          server.log.error(
            restoreErr,
            `CRITICAL: failed to restore rolled-back auction item tokenId=${tokenId} qty=${quantity} seller=${sellerAddress}`
          );
        }
      }
      if (escrowedInstanceId) {
        try {
          await assignItemInstanceOwner(escrowedInstanceId, sellerAddress);
        } catch (instanceErr) {
          server.log.error(
            instanceErr,
            `CRITICAL: failed to restore rolled-back auction instance ${escrowedInstanceId} to ${sellerAddress}`
          );
        }
      }
      server.log.error(err, "Failed to create auction");
      reply.code(500);
      return { error: "Failed to create auction" };
    }
  });

  /**
   * POST /auctionhouse/:zoneId/bid
   * Place a bid on an auction in a specific zone.
   */
  server.post<{
    Params: { zoneId: string };
    Body: { auctionId: number; bidderAddress: string; bidAmount: number };
  }>("/auctionhouse/:zoneId/bid", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId } = request.params;
    const { auctionId, bidderAddress, bidAmount } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!bidderAddress || !/^0x[a-fA-F0-9]{40}$/.test(bidderAddress)) {
      reply.code(400);
      return { error: "Invalid bidder address" };
    }

    // Verify authenticated wallet matches request wallet
    if (bidderAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    if (bidAmount <= 0) {
      reply.code(400);
      return { error: "Bid amount must be positive" };
    }

    try {
      // Verify auction exists and is in the correct zone
      const auction = await getAuctionFromChain(auctionId);
      if (auction.zoneId !== zoneId) {
        reply.code(400);
        return { error: "Auction not in this zone" };
      }

      if (auction.status !== 0) {
        reply.code(400);
        return { error: "Auction is not active" };
      }

      // Check minimum bid (start price or current high bid + 10 gold)
      const minBid = auction.highBid > 0 ? auction.highBid + 10 : auction.startPrice;
      if (bidAmount < minBid) {
        reply.code(400);
        return {
          error: "Bid too low",
          minimumBid: minBid,
          yourBid: bidAmount,
        };
      }

      // Check bidder has enough gold
      const onChainGold = parseFloat(await getGoldBalance(bidderAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(bidderAddress, safeOnChainGold);

      if (availableGold < bidAmount) {
        reply.code(400);
        return {
          error: "Insufficient gold",
          required: bidAmount,
          available: formatGold(availableGold),
        };
      }

      // Reserve bidder's gold
      await reserveGoldAsync(bidderAddress, bidAmount);

      // Place bid on-chain
      const bidderAgentId = resolveZoneAgentId(zoneId, bidderAddress);
      const { txHash, previousBidder, previousBid } = await placeBidOnChain(
        auctionId,
        bidderAddress,
        bidAmount,
        bidderAgentId
      );

      // Unreserve previous bidder's gold (if any)
      if (previousBidder !== "0x0000000000000000000000000000000000000000" && previousBid > 0) {
        await unreserveGoldAsync(previousBidder, previousBid);
        server.log.info(
          `Auction ${auctionId}: Unreserved ${previousBid} gold for previous bidder ${previousBidder}`
        );
      }

      server.log.info(
        `Auction ${auctionId}: Bid placed by ${bidderAddress} for ${bidAmount} gold`
      );

      return {
        ok: true,
        auctionId,
        bidAmount,
        remainingGold: formatGold(await getAvailableGoldAsync(bidderAddress, safeOnChainGold)),
        txHash,
      };
    } catch (err) {
      // Unreserve gold if bid failed
      try {
        await unreserveGoldAsync(bidderAddress, bidAmount);
      } catch {}

      server.log.error(err, `Failed to place bid on auction ${auctionId}`);
      reply.code(500);
      return { error: "Failed to place bid" };
    }
  });

  /**
   * POST /auctionhouse/:zoneId/buyout
   * Instantly purchase an auction at the buyout price.
   */
  server.post<{
    Params: { zoneId: string };
    Body: { auctionId: number; buyerAddress: string };
  }>("/auctionhouse/:zoneId/buyout", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId } = request.params;
    const { auctionId, buyerAddress } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!buyerAddress || !/^0x[a-fA-F0-9]{40}$/.test(buyerAddress)) {
      reply.code(400);
      return { error: "Invalid buyer address" };
    }

    // Verify authenticated wallet matches request wallet
    if (buyerAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    try {
      // Verify auction exists and is in the correct zone
      const auction = await getAuctionFromChain(auctionId);
      if (auction.zoneId !== zoneId) {
        reply.code(400);
        return { error: "Auction not in this zone" };
      }

      if (auction.status !== 0) {
        reply.code(400);
        return { error: "Auction is not active" };
      }

      if (auction.buyoutPrice <= 0) {
        reply.code(400);
        return { error: "Buyout not available for this auction" };
      }

      // Check buyer has enough gold
      const onChainGold = parseFloat(await getGoldBalance(buyerAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(buyerAddress, safeOnChainGold);

      if (availableGold < auction.buyoutPrice) {
        reply.code(400);
        return {
          error: "Insufficient gold",
          required: auction.buyoutPrice,
          available: formatGold(availableGold),
        };
      }

      // Unreserve previous bidder if any
      if (auction.highBidder !== "0x0000000000000000000000000000000000000000" && auction.highBid > 0) {
        await unreserveGoldAsync(auction.highBidder, auction.highBid);
      }

      // Execute buyout on-chain
      const { txHash } = await buyoutAuctionOnChain(auctionId, buyerAddress);

      // Release the escrowed item to the buyer.
      const mintTx = await mintItem(
        buyerAddress,
        BigInt(auction.tokenId),
        BigInt(auction.quantity)
      );
      const escrowedInstance = getAuctionEscrowInstance(auctionId);
      if (escrowedInstance) {
        await assignItemInstanceOwner(escrowedInstance.instanceId, buyerAddress);
      }

      // Record gold spend
      await recordGoldSpendAsync(buyerAddress, auction.buyoutPrice);

      server.log.info(
        `Auction ${auctionId} bought out by ${buyerAddress} for ${auction.buyoutPrice} gold`
      );

      return {
        ok: true,
        auctionId,
        buyoutPrice: auction.buyoutPrice,
        remainingGold: formatGold(await getAvailableGoldAsync(buyerAddress, safeOnChainGold)),
        itemTx: mintTx,
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to buyout auction ${auctionId}`);
      reply.code(500);
      return { error: "Failed to buyout auction" };
    }
  });

  /**
   * POST /auctionhouse/:zoneId/cancel
   * Cancel an auction (only if no bids have been placed).
   */
  server.post<{
    Params: { zoneId: string };
    Body: { auctionId: number; sellerAddress: string };
  }>("/auctionhouse/:zoneId/cancel", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId } = request.params;
    const { auctionId, sellerAddress } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    // Verify seller address if provided
    if (sellerAddress && sellerAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    try{
      // Verify auction exists and is in the correct zone
      const auction = await getAuctionFromChain(auctionId);
      if (auction.zoneId !== zoneId) {
        reply.code(400);
        return { error: "Auction not in this zone" };
      }

      if (auction.status !== 0) {
        reply.code(400);
        return { error: "Auction is not active" };
      }

      if (auction.seller.toLowerCase() !== authenticatedWallet.toLowerCase()) {
        reply.code(403);
        return { error: "Only the seller can cancel this auction" };
      }

      if (auction.highBidder !== "0x0000000000000000000000000000000000000000") {
        reply.code(400);
        return { error: "Cannot cancel auction with bids" };
      }

      // Charge cancellation fee (25 copper)
      const onChainGold = parseFloat(await getGoldBalance(authenticatedWallet));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(authenticatedWallet, safeOnChainGold);
      if (availableGold < AUCTION_CANCEL_FEE) {
        reply.code(400);
        return {
          error: "Insufficient gold for cancellation fee",
          required: AUCTION_CANCEL_FEE,
          available: availableGold,
          message: "Cancellation fee is 25 copper (0.0025 GOLD)",
        };
      }

      const txHash = await cancelAuctionOnChain(auctionId);
      const restoreTx = await mintItem(
        authenticatedWallet,
        BigInt(auction.tokenId),
        BigInt(auction.quantity)
      );
      const escrowedInstance = getAuctionEscrowInstance(auctionId);
      if (escrowedInstance) {
        await assignItemInstanceOwner(escrowedInstance.instanceId, authenticatedWallet);
      }
      await recordGoldSpendAsync(authenticatedWallet, AUCTION_CANCEL_FEE);

      server.log.info(`Auction ${auctionId} cancelled and escrow returned via ${restoreTx}`);

      return { ok: true, auctionId, txHash, restoreTx };
    } catch (err) {
      server.log.error(err, `Failed to cancel auction ${auctionId}`);
      reply.code(500);
      return { error: "Failed to cancel auction" };
    }
  });

  /**
   * GET /auctionhouse/:zoneId/auctions
   * List all auctions in a specific zone with optional filters.
   */
  server.get<{
    Params: { zoneId: string };
    Querystring: { status?: string; tokenId?: string };
  }>("/auctionhouse/:zoneId/auctions", async (request, reply) => {
    const { zoneId } = request.params;
    const { status, tokenId } = request.query;

    try {
      // Map status name to number
      let statusFilter: number | undefined;
      if (status) {
        const statusIndex = STATUS_NAMES.indexOf(status.toLowerCase());
        if (statusIndex === -1) {
          reply.code(400);
          return { error: "Invalid status. Use: active, ended, or cancelled" };
        }
        statusFilter = statusIndex;
      }

      // Get all auctions for this zone
      const auctionIds = await getZoneAuctionsFromChain(zoneId, statusFilter);

      const auctions = [];
      for (const auctionId of auctionIds) {
        const auction = await getAuctionFromChain(auctionId);

        // Filter by tokenId if specified
        if (tokenId && auction.tokenId !== parseInt(tokenId, 10)) {
          continue;
        }

        auctions.push(formatAuctionForResponse(auction));
      }

      return auctions;
    } catch (err) {
      server.log.error(err, `Failed to list auctions for zone ${zoneId}`);
      reply.code(500);
      return { error: "Failed to list auctions" };
    }
  });

  /**
   * GET /auctionhouse/:zoneId/auction/:auctionId
   * Get detailed information about a specific auction.
   */
  server.get<{
    Params: { zoneId: string; auctionId: string };
  }>("/auctionhouse/:zoneId/auction/:auctionId", async (request, reply) => {
    const { zoneId, auctionId } = request.params;
    const parsedAuctionId = parseInt(auctionId, 10);

    if (isNaN(parsedAuctionId) || parsedAuctionId < 0) {
      reply.code(400);
      return { error: "Invalid auction ID" };
    }

    try {
      const auction = await getAuctionFromChain(parsedAuctionId);

      if (auction.zoneId !== zoneId) {
        reply.code(404);
        return { error: "Auction not found in this zone" };
      }

      return formatAuctionForResponse(auction);
    } catch (err) {
      server.log.error(err, `Failed to get auction ${parsedAuctionId}`);
      reply.code(500);
      return { error: "Failed to get auction details" };
    }
  });
}
