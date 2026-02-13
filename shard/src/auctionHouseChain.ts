import { ethers } from "ethers";
import { biteWallet, biteProvider } from "./biteChain.js";

const AUCTION_HOUSE_CONTRACT_ADDRESS = process.env.AUCTION_HOUSE_CONTRACT_ADDRESS;

/** WoGAuctionHouse ABI — only the functions/events we interact with at runtime. */
const AUCTION_HOUSE_ABI = [
  "function createAuction(string zoneId, address seller, uint256 tokenId, uint256 quantity, uint256 startPrice, uint256 durationSeconds, uint256 buyoutPrice) returns (uint256)",
  "function placeBid(uint256 auctionId, address bidder, uint256 bidAmount) returns (address, uint256)",
  "function buyout(uint256 auctionId, address buyer)",
  "function endAuction(uint256 auctionId)",
  "function cancelAuction(uint256 auctionId)",
  "function getAuction(uint256 auctionId) view returns (string zoneId, address seller, uint256 tokenId, uint256 quantity, uint256 startPrice, uint256 buyoutPrice, uint256 endTime, address highBidder, uint256 highBid, uint8 status, uint8 extensionCount)",
  "function nextAuctionId() view returns (uint256)",
  "event AuctionCreated(uint256 indexed auctionId, string zoneId, address indexed seller, uint256 tokenId, uint256 quantity, uint256 startPrice, uint256 buyoutPrice, uint256 endTime)",
  "event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 bidAmount, address previousBidder, uint256 previousBid, uint256 newEndTime, bool extended)",
  "event AuctionEnded(uint256 indexed auctionId, address winner, uint256 finalPrice)",
  "event AuctionCancelled(uint256 indexed auctionId)",
  "event BuyoutExecuted(uint256 indexed auctionId, address buyer, uint256 buyoutPrice)",
];

const auctionHouseContract = AUCTION_HOUSE_CONTRACT_ADDRESS
  ? new ethers.Contract(AUCTION_HOUSE_CONTRACT_ADDRESS, AUCTION_HOUSE_ABI, biteWallet)
  : null;

function ensureAuctionHouseEnabled(): asserts auctionHouseContract is ethers.Contract {
  if (!auctionHouseContract) {
    throw new Error("Auction house contract not configured (missing AUCTION_HOUSE_CONTRACT_ADDRESS)");
  }
}

// -- Types --

export interface AuctionData {
  auctionId: number;
  zoneId: string;
  seller: string;
  tokenId: number;
  quantity: number;
  startPrice: number;
  buyoutPrice: number;
  endTime: number;
  highBidder: string;
  highBid: number;
  status: number; // 0 = Active, 1 = Ended, 2 = Cancelled
  extensionCount: number;
}

// -- In-memory auction cache --
// The on-chain getAuction() view function has a known bug (returns 0x on SKALE BITE v2).
// All mutating functions (create/bid/end/cancel) work and emit events, but reads fail.
// This cache mirrors on-chain state so the API can serve auction data reliably.
const auctionCache = new Map<number, AuctionData>();

function cacheAuction(data: AuctionData): void {
  auctionCache.set(data.auctionId, data);
}

// -- Contract interaction helpers --

/**
 * Create a new auction on the WoGAuctionHouse contract.
 * Prices are in GOLD (18 decimals).
 */
export async function createAuctionOnChain(
  zoneId: string,
  seller: string,
  tokenId: number,
  quantity: number,
  startPrice: number,
  durationSeconds: number,
  buyoutPrice: number
): Promise<{ auctionId: number; txHash: string }> {
  ensureAuctionHouseEnabled();
  const startPriceWei = ethers.parseUnits(startPrice.toString(), 18);
  const buyoutPriceWei = buyoutPrice > 0 ? ethers.parseUnits(buyoutPrice.toString(), 18) : 0;

  const tx = await auctionHouseContract.createAuction(
    zoneId,
    seller,
    tokenId,
    quantity,
    startPriceWei,
    durationSeconds,
    buyoutPriceWei
  );
  const receipt = await tx.wait();

  // Parse AuctionCreated event to extract auctionId and cache the auction
  for (const log of receipt.logs) {
    try {
      const parsed = auctionHouseContract.interface.parseLog(log);
      if (parsed?.name === "AuctionCreated") {
        const auctionId = Number(parsed.args.auctionId);
        cacheAuction({
          auctionId,
          zoneId,
          seller,
          tokenId,
          quantity,
          startPrice,
          buyoutPrice,
          endTime: Number(parsed.args.endTime),
          highBidder: ethers.ZeroAddress,
          highBid: 0,
          status: 0, // Active
          extensionCount: 0,
        });
        return { auctionId, txHash: receipt.hash };
      }
    } catch {
      // Not our event, skip
    }
  }

  throw new Error("AuctionCreated event not found in receipt");
}

/**
 * Place a bid on behalf of an agent.
 * Returns the previous bidder (for unreserving their gold).
 */
export async function placeBidOnChain(
  auctionId: number,
  bidder: string,
  bidAmount: number
): Promise<{ txHash: string; previousBidder: string; previousBid: number }> {
  ensureAuctionHouseEnabled();
  const bidAmountWei = ethers.parseUnits(bidAmount.toString(), 18);

  const tx = await auctionHouseContract.placeBid(
    auctionId,
    bidder,
    bidAmountWei
  );
  const receipt = await tx.wait();

  // Parse BidPlaced event to get previous bidder and update cache
  for (const log of receipt.logs) {
    try {
      const parsed = auctionHouseContract.interface.parseLog(log);
      if (parsed?.name === "BidPlaced") {
        const cached = auctionCache.get(auctionId);
        if (cached) {
          cached.highBidder = bidder;
          cached.highBid = bidAmount;
          cached.endTime = Number(parsed.args.newEndTime);
          if (parsed.args.extended) cached.extensionCount++;
        }
        return {
          txHash: receipt.hash,
          previousBidder: parsed.args.previousBidder,
          previousBid: parseFloat(ethers.formatUnits(parsed.args.previousBid, 18)),
        };
      }
    } catch {
      // Not our event, skip
    }
  }

  throw new Error("BidPlaced event not found in receipt");
}

/**
 * Execute instant buyout at the buyout price.
 */
export async function buyoutAuctionOnChain(
  auctionId: number,
  buyer: string
): Promise<{ txHash: string }> {
  ensureAuctionHouseEnabled();
  const tx = await auctionHouseContract.buyout(auctionId, buyer);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * End an expired auction (server calls this when time is up).
 */
export async function endAuctionOnChain(auctionId: number): Promise<string> {
  ensureAuctionHouseEnabled();
  const tx = await auctionHouseContract.endAuction(auctionId);
  const receipt = await tx.wait();
  const cached = auctionCache.get(auctionId);
  if (cached) cached.status = 1; // Ended
  return receipt.hash;
}

/**
 * Cancel an auction (before any bids).
 */
export async function cancelAuctionOnChain(auctionId: number): Promise<string> {
  ensureAuctionHouseEnabled();
  const tx = await auctionHouseContract.cancelAuction(auctionId);
  const receipt = await tx.wait();
  const cached = auctionCache.get(auctionId);
  if (cached) cached.status = 2; // Cancelled
  return receipt.hash;
}

/**
 * Read auction details. Uses in-memory cache (the on-chain getAuction view
 * function has a known bug on SKALE BITE v2 — returns 0x for all IDs).
 */
export async function getAuctionFromChain(auctionId: number): Promise<AuctionData> {
  const cached = auctionCache.get(auctionId);
  if (cached) return cached;
  throw new Error(`Auction ${auctionId} not found`);
}

/**
 * Get the next auction ID (total number of auctions created).
 */
export async function getNextAuctionId(): Promise<number> {
  ensureAuctionHouseEnabled();
  return Number(await auctionHouseContract.nextAuctionId());
}

/**
 * Get all auction IDs for a specific zone (filters by zoneId).
 * Reads from in-memory cache.
 */
export async function getZoneAuctionsFromChain(
  zoneId: string,
  statusFilter?: number
): Promise<number[]> {
  const auctionIds: number[] = [];

  for (const auction of auctionCache.values()) {
    if (auction.zoneId === zoneId) {
      if (statusFilter === undefined || auction.status === statusFilter) {
        auctionIds.push(auction.auctionId);
      }
    }
  }

  return auctionIds;
}

/**
 * Rebuild the auction cache from historical on-chain events.
 * Call once at server startup to restore state from before the process restarted.
 */
export async function rebuildAuctionCache(): Promise<void> {
  if (!AUCTION_HOUSE_CONTRACT_ADDRESS || !biteProvider) return;

  const readContract = new ethers.Contract(
    AUCTION_HOUSE_CONTRACT_ADDRESS,
    AUCTION_HOUSE_ABI,
    biteProvider
  );

  try {
    const nextId = Number(await readContract.nextAuctionId());
    if (nextId === 0) {
      console.log("[auction] No auctions on-chain to rebuild");
      return;
    }

    // SKALE limits eth_getLogs to 2000 blocks per query.
    // Scan backwards from latest in 2000-block chunks until we find all auctions.
    const latestBlock = await biteProvider.getBlockNumber();
    const CHUNK = 1999;

    async function queryInChunks(filter: any): Promise<any[]> {
      const allLogs: any[] = [];
      let to = latestBlock;
      while (to >= 0) {
        const from = Math.max(0, to - CHUNK);
        const logs = await readContract.queryFilter(filter, from, to);
        allLogs.push(...logs);
        if (from === 0) break;
        to = from - 1;
        // Stop scanning if we've found all auctions
        if (allLogs.length >= nextId) break;
      }
      return allLogs;
    }

    const createdFilter = readContract.filters.AuctionCreated();
    const createdLogs = await queryInChunks(createdFilter);

    for (const log of createdLogs) {
      const parsed = readContract.interface.parseLog(log as any);
      if (!parsed) continue;
      const auctionId = Number(parsed.args.auctionId);
      cacheAuction({
        auctionId,
        zoneId: parsed.args.zoneId,
        seller: parsed.args.seller,
        tokenId: Number(parsed.args.tokenId),
        quantity: Number(parsed.args.quantity),
        startPrice: parseFloat(ethers.formatUnits(parsed.args.startPrice, 18)),
        buyoutPrice: parseFloat(ethers.formatUnits(parsed.args.buyoutPrice, 18)),
        endTime: Number(parsed.args.endTime),
        highBidder: ethers.ZeroAddress,
        highBid: 0,
        status: 0, // Assume active; updated below
        extensionCount: 0,
      });
    }

    // Apply BidPlaced events
    const bidFilter = readContract.filters.BidPlaced();
    const bidLogs = await queryInChunks(bidFilter);
    for (const log of bidLogs) {
      const parsed = readContract.interface.parseLog(log as any);
      if (!parsed) continue;
      const cached = auctionCache.get(Number(parsed.args.auctionId));
      if (cached) {
        cached.highBidder = parsed.args.bidder;
        cached.highBid = parseFloat(ethers.formatUnits(parsed.args.bidAmount, 18));
        cached.endTime = Number(parsed.args.newEndTime);
        if (parsed.args.extended) cached.extensionCount++;
      }
    }

    // Apply AuctionEnded events
    const endedFilter = readContract.filters.AuctionEnded();
    const endedLogs = await queryInChunks(endedFilter);
    for (const log of endedLogs) {
      const parsed = readContract.interface.parseLog(log as any);
      if (!parsed) continue;
      const cached = auctionCache.get(Number(parsed.args.auctionId));
      if (cached) cached.status = 1;
    }

    // Apply AuctionCancelled events
    const cancelFilter = readContract.filters.AuctionCancelled();
    const cancelLogs = await queryInChunks(cancelFilter);
    for (const log of cancelLogs) {
      const parsed = readContract.interface.parseLog(log as any);
      if (!parsed) continue;
      const cached = auctionCache.get(Number(parsed.args.auctionId));
      if (cached) cached.status = 2;
    }

    // Mark expired auctions as ended
    const now = Math.floor(Date.now() / 1000);
    for (const auction of auctionCache.values()) {
      if (auction.status === 0 && auction.endTime < now) {
        auction.status = 1; // Expired
      }
    }

    console.log(`[auction] Rebuilt cache: ${auctionCache.size} auctions from on-chain events`);
  } catch (err) {
    console.error("[auction] Failed to rebuild cache from events:", err);
  }
}
