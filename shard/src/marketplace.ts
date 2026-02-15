import type { FastifyInstance } from "fastify";
import { getGoldBalance, getItemBalance } from "./blockchain.js";
import { formatGold, getAvailableGold } from "./goldLedger.js";
import { getItemByTokenId, ITEM_CATALOG } from "./itemCatalog.js";
import {
  getAllAuctionsFromCache,
  getAuctionFromChain,
  type AuctionData,
} from "./auctionHouseChain.js";

function formatAuction(auction: AuctionData) {
  const item = getItemByTokenId(BigInt(auction.tokenId));
  return {
    auctionId: auction.auctionId,
    zoneId: auction.zoneId,
    seller: auction.seller,
    tokenId: auction.tokenId,
    itemName: item?.name ?? "Unknown Item",
    itemDescription: item?.description ?? "",
    itemCategory: item?.category ?? "unknown",
    equipSlot: item?.equipSlot ?? null,
    armorSlot: item?.armorSlot ?? null,
    statBonuses: item?.statBonuses ?? {},
    maxDurability: item?.maxDurability ?? null,
    quantity: auction.quantity,
    startPrice: auction.startPrice,
    buyoutPrice: auction.buyoutPrice > 0 ? auction.buyoutPrice : null,
    currentBid: auction.highBid > 0 ? auction.highBid : null,
    highBidder:
      auction.highBidder !== "0x0000000000000000000000000000000000000000"
        ? auction.highBidder
        : null,
    bidCount: auction.highBid > 0 ? 1 : 0,
    endsAt: auction.endTime,
    timeRemaining: Math.max(0, auction.endTime - Math.floor(Date.now() / 1000)),
    status: auction.status === 0 ? "active" : auction.status === 1 ? "ended" : "cancelled",
  };
}

export function registerMarketplaceRoutes(server: FastifyInstance) {
  /**
   * GET /marketplace/listings
   * Returns all active auctions across all zones.
   * Query params: ?category=weapon&search=sword&seller=0x...
   */
  server.get<{
    Querystring: {
      category?: string;
      search?: string;
      seller?: string;
      status?: string;
      sort?: string;
    };
  }>("/marketplace/listings", async (request) => {
    const { category, search, seller, status, sort } = request.query;

    const statusFilter = status === "ended" ? 1 : status === "cancelled" ? 2 : 0;
    const allAuctions = getAllAuctionsFromCache(statusFilter);

    let listings = allAuctions.map(formatAuction);

    // Filter by category
    if (category && category !== "all") {
      listings = listings.filter((l) => l.itemCategory === category);
    }

    // Filter by search
    if (search) {
      const lower = search.toLowerCase();
      listings = listings.filter(
        (l) =>
          l.itemName.toLowerCase().includes(lower) ||
          l.itemDescription.toLowerCase().includes(lower)
      );
    }

    // Filter by seller
    if (seller) {
      const lowerSeller = seller.toLowerCase();
      listings = listings.filter(
        (l) => l.seller.toLowerCase() === lowerSeller
      );
    }

    // Sort
    if (sort === "price-asc") {
      listings.sort((a, b) => (a.currentBid ?? a.startPrice) - (b.currentBid ?? b.startPrice));
    } else if (sort === "price-desc") {
      listings.sort((a, b) => (b.currentBid ?? b.startPrice) - (a.currentBid ?? a.startPrice));
    } else if (sort === "ending-soon") {
      listings.sort((a, b) => a.endsAt - b.endsAt);
    } else if (sort === "newest") {
      listings.sort((a, b) => b.auctionId - a.auctionId);
    } else {
      // Default: ending soon
      listings.sort((a, b) => a.endsAt - b.endsAt);
    }

    return {
      total: listings.length,
      listings,
    };
  });

  /**
   * GET /marketplace/listing/:auctionId
   * Get a single listing by auction ID.
   */
  server.get<{ Params: { auctionId: string } }>(
    "/marketplace/listing/:auctionId",
    async (request, reply) => {
      const auctionId = parseInt(request.params.auctionId, 10);
      if (isNaN(auctionId)) {
        reply.code(400);
        return { error: "Invalid auction ID" };
      }

      try {
        const auction = await getAuctionFromChain(auctionId);
        return formatAuction(auction);
      } catch {
        reply.code(404);
        return { error: "Listing not found" };
      }
    }
  );

  /**
   * GET /marketplace/my-listings/:address
   * Get all listings by a specific seller.
   */
  server.get<{ Params: { address: string } }>(
    "/marketplace/my-listings/:address",
    async (request) => {
      const address = request.params.address.toLowerCase();
      const all = getAllAuctionsFromCache();
      const listings = all
        .filter((a) => a.seller.toLowerCase() === address)
        .map(formatAuction);

      return { total: listings.length, listings };
    }
  );

  /**
   * GET /marketplace/my-bids/:address
   * Get all active auctions where the address is the high bidder.
   */
  server.get<{ Params: { address: string } }>(
    "/marketplace/my-bids/:address",
    async (request) => {
      const address = request.params.address.toLowerCase();
      const active = getAllAuctionsFromCache(0);
      const bids = active
        .filter(
          (a) =>
            a.highBidder.toLowerCase() === address &&
            a.highBidder !== "0x0000000000000000000000000000000000000000"
        )
        .map(formatAuction);

      return { total: bids.length, listings: bids };
    }
  );

  /**
   * GET /marketplace/stats
   * Get marketplace overview stats.
   */
  server.get("/marketplace/stats", async () => {
    const active = getAllAuctionsFromCache(0);
    const ended = getAllAuctionsFromCache(1);

    const totalVolume = ended.reduce((sum, a) => {
      const salePrice = a.highBid > 0 ? a.highBid : a.buyoutPrice;
      return sum + salePrice;
    }, 0);

    const uniqueSellers = new Set(active.map((a) => a.seller.toLowerCase())).size;
    const uniqueBidders = new Set(
      active
        .filter((a) => a.highBidder !== "0x0000000000000000000000000000000000000000")
        .map((a) => a.highBidder.toLowerCase())
    ).size;

    return {
      activeListings: active.length,
      totalSales: ended.length,
      totalVolume: formatGold(totalVolume),
      uniqueSellers,
      uniqueBidders,
    };
  });

  /**
   * GET /marketplace/catalog
   * Get item catalog with market data (active listing count per item).
   */
  server.get("/marketplace/catalog", async () => {
    const active = getAllAuctionsFromCache(0);

    // Count active listings per tokenId
    const listingCounts = new Map<number, number>();
    const lowestPrices = new Map<number, number>();
    for (const a of active) {
      listingCounts.set(a.tokenId, (listingCounts.get(a.tokenId) ?? 0) + 1);
      const price = a.highBid > 0 ? a.highBid : a.startPrice;
      const current = lowestPrices.get(a.tokenId);
      if (current === undefined || price < current) {
        lowestPrices.set(a.tokenId, price);
      }
    }

    return ITEM_CATALOG.map((item) => {
      const tokenId = Number(item.tokenId);
      return {
        tokenId: tokenId.toString(),
        name: item.name,
        description: item.description,
        category: item.category,
        goldPrice: item.goldPrice,
        equipSlot: item.equipSlot ?? null,
        armorSlot: item.armorSlot ?? null,
        statBonuses: item.statBonuses ?? {},
        maxDurability: item.maxDurability ?? null,
        activeListings: listingCounts.get(tokenId) ?? 0,
        lowestPrice: lowestPrices.get(tokenId) ?? null,
      };
    });
  });
}
