import type { FastifyInstance } from "fastify";
import { getGoldBalance, getItemBalance, mintItem } from "./blockchain.js";
import {
  formatGold,
  getAvailableGold,
  recordGoldSpend,
  reserveGold,
  unreserveGold,
} from "./goldLedger.js";
import { getItemByTokenId } from "./itemCatalog.js";
import {
  createAuctionOnChain,
  placeBidOnChain,
  buyoutAuctionOnChain,
  cancelAuctionOnChain,
  getAuctionFromChain,
  getZoneAuctionsFromChain,
  type AuctionData,
} from "./auctionHouseChain.js";
import { getAllZones } from "./zoneRuntime.js";
import { authenticateRequest } from "./auth.js";

const STATUS_NAMES = ["active", "ended", "cancelled"];

function formatAuctionForResponse(auction: AuctionData) {
  const item = getItemByTokenId(BigInt(auction.tokenId));

  return {
    auctionId: auction.auctionId,
    zoneId: auction.zoneId,
    seller: auction.seller,
    tokenId: auction.tokenId,
    itemName: item?.name ?? "Unknown Item",
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
  };
}

export function registerAuctionHouseRoutes(server: FastifyInstance) {
  /**
   * GET /auctionhouse/npc/:zoneId/:entityId
   * Get auctioneer NPC details and list active auctions in their zone.
   * This is the main discovery endpoint for AI agents.
   */
  server.get<{ Params: { zoneId: string; entityId: string } }>(
    "/auctionhouse/npc/:zoneId/:entityId",
    async (request, reply) => {
      const { zoneId, entityId } = request.params;

      const zone = getAllZones().get(zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const entity = zone.entities.get(entityId);
      if (!entity || entity.type !== "auctioneer") {
        reply.code(404);
        return { error: "Auctioneer not found" };
      }

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
    }
  );

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
    };
  }>("/auctionhouse/:zoneId/create", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId } = request.params;
    const { sellerAddress, tokenId, quantity, startPrice, durationMinutes, buyoutPrice } = request.body;
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

    try {
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

      const durationSeconds = durationMinutes * 60;
      const finalBuyoutPrice = buyoutPrice && buyoutPrice > 0 ? buyoutPrice : 0;

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

      server.log.info(
        `Auction ${auctionId} created in ${zoneId} by ${sellerAddress}: tokenId=${tokenId} qty=${quantity}`
      );

      return {
        ok: true,
        auctionId,
        zoneId,
        endTime: Math.floor(Date.now() / 1000) + durationSeconds,
        txHash,
      };
    } catch (err) {
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
      const availableGold = getAvailableGold(bidderAddress, safeOnChainGold);

      if (availableGold < bidAmount) {
        reply.code(400);
        return {
          error: "Insufficient gold",
          required: bidAmount,
          available: formatGold(availableGold),
        };
      }

      // Reserve bidder's gold
      reserveGold(bidderAddress, bidAmount);

      // Place bid on-chain
      const { txHash, previousBidder, previousBid } = await placeBidOnChain(
        auctionId,
        bidderAddress,
        bidAmount
      );

      // Unreserve previous bidder's gold (if any)
      if (previousBidder !== "0x0000000000000000000000000000000000000000" && previousBid > 0) {
        unreserveGold(previousBidder, previousBid);
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
        remainingGold: formatGold(getAvailableGold(bidderAddress, safeOnChainGold)),
        txHash,
      };
    } catch (err) {
      // Unreserve gold if bid failed
      try {
        unreserveGold(bidderAddress, bidAmount);
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
      const availableGold = getAvailableGold(buyerAddress, safeOnChainGold);

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
        unreserveGold(auction.highBidder, auction.highBid);
      }

      // Execute buyout on-chain
      const { txHash } = await buyoutAuctionOnChain(auctionId, buyerAddress);

      // Mint item immediately
      const mintTx = await mintItem(
        buyerAddress,
        BigInt(auction.tokenId),
        BigInt(auction.quantity)
      );

      // Record gold spend
      recordGoldSpend(buyerAddress, auction.buyoutPrice);

      server.log.info(
        `Auction ${auctionId} bought out by ${buyerAddress} for ${auction.buyoutPrice} gold`
      );

      return {
        ok: true,
        auctionId,
        buyoutPrice: auction.buyoutPrice,
        remainingGold: formatGold(getAvailableGold(buyerAddress, safeOnChainGold)),
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

      if (auction.highBidder !== "0x0000000000000000000000000000000000000000") {
        reply.code(400);
        return { error: "Cannot cancel auction with bids" };
      }

      const txHash = await cancelAuctionOnChain(auctionId);

      server.log.info(`Auction ${auctionId} cancelled`);

      return { ok: true, auctionId, txHash };
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
