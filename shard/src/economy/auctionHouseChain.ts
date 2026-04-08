import { ethers } from "ethers";
import { biteWallet, biteProvider } from "../blockchain/biteChain.js";
import { queueBiteTransaction } from "../blockchain/biteTxQueue.js";
import { traceTx } from "../blockchain/txTracer.js";
import {
  executeRegisteredChainOperation,
  registerChainOperationProcessor,
  type ChainOperationRecord,
} from "../blockchain/chainOperationStore.js";
import {
  getAuctionProjection,
  listAuctionProjections,
  upsertAuctionProjection,
} from "../db/auctionProjectionStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

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

function ensureAuctionHouseEnabled(): ethers.Contract {
  if (!auctionHouseContract) {
    throw new Error("Auction house contract not configured (missing AUCTION_HOUSE_CONTRACT_ADDRESS)");
  }
  return auctionHouseContract;
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
  highBidderAgentId?: string | null;
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
  void upsertAuctionProjection(data).catch(() => {});
}

function isTransientRpcReadError(err: unknown): boolean {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  const haystack = `${code} ${message}`.toLowerCase();
  return (
    haystack.includes("timeout") ||
    haystack.includes("network") ||
    haystack.includes("socket") ||
    haystack.includes("econnreset") ||
    haystack.includes("econnrefused") ||
    haystack.includes("etimedout") ||
    haystack.includes("failed to detect network") ||
    haystack.includes("missing response") ||
    haystack.includes("server error")
  );
}

function warnTransientAuctionRead(context: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err ?? "unknown error");
  console.warn(`[auction] ${context} failed (transient read): ${detail.slice(0, 160)}`);
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
  return executeRegisteredChainOperation(
    "auction-create",
    `${seller.toLowerCase()}:${tokenId}:${quantity}:${zoneId}`,
    { zoneId, seller, tokenId, quantity, startPrice, durationSeconds, buyoutPrice }
  );
}

async function processAuctionCreate(
  record: ChainOperationRecord
): Promise<{ result: { auctionId: number; txHash: string }; txHash: string }> {
  const payload = JSON.parse(record.payload) as {
    zoneId: string; seller: string; tokenId: number; quantity: number; startPrice: number; durationSeconds: number; buyoutPrice: number;
  };
  return traceTx("auction-create", "createAuctionOnChain", payload, "bite", async () => {
    const contract = ensureAuctionHouseEnabled();
    const startPriceWei = ethers.parseUnits(payload.startPrice.toString(), 18);
    const buyoutPriceWei = payload.buyoutPrice > 0 ? ethers.parseUnits(payload.buyoutPrice.toString(), 18) : 0;
    const receipt = await queueBiteTransaction(`auction-create:${payload.seller}:${payload.tokenId}`, async () => {
      const tx = await contract.createAuction(
        payload.zoneId,
        payload.seller,
        payload.tokenId,
        payload.quantity,
        startPriceWei,
        payload.durationSeconds,
        buyoutPriceWei
      );
      return tx.wait();
    });
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === "AuctionCreated") {
          const auctionId = Number(parsed.args.auctionId);
          cacheAuction({
            auctionId,
            zoneId: payload.zoneId,
            seller: payload.seller,
            tokenId: payload.tokenId,
            quantity: payload.quantity,
            startPrice: payload.startPrice,
            buyoutPrice: payload.buyoutPrice,
            endTime: Number(parsed.args.endTime),
            highBidder: ethers.ZeroAddress,
            highBidderAgentId: null,
            highBid: 0,
            status: 0,
            extensionCount: 0,
          });
          return { result: { auctionId, txHash: receipt.hash }, txHash: receipt.hash };
        }
      } catch {}
    }
    throw new Error("AuctionCreated event not found in receipt");
  });
}
registerChainOperationProcessor("auction-create", processAuctionCreate);

/**
 * Place a bid on behalf of an agent.
 * Returns the previous bidder (for unreserving their gold).
 */
export async function placeBidOnChain(
  auctionId: number,
  bidder: string,
  bidAmount: number,
  bidderAgentId?: string | null
): Promise<{ txHash: string; previousBidder: string; previousBid: number }> {
  return executeRegisteredChainOperation(
    "auction-bid",
    `${auctionId}:${bidder.toLowerCase()}:${bidAmount}`,
    { auctionId, bidder, bidAmount, bidderAgentId: bidderAgentId ?? null }
  );
}
async function processAuctionBid(
  record: ChainOperationRecord
): Promise<{ result: { txHash: string; previousBidder: string; previousBid: number }; txHash: string }> {
  const payload = JSON.parse(record.payload) as { auctionId: number; bidder: string; bidAmount: number; bidderAgentId?: string | null };
  return traceTx("auction-bid", "placeBidOnChain", payload, "bite", async () => {
    const contract = ensureAuctionHouseEnabled();
    const bidAmountWei = ethers.parseUnits(payload.bidAmount.toString(), 18);
    const receipt = await queueBiteTransaction(`auction-bid:${payload.auctionId}:${payload.bidder}`, async () => {
      const tx = await contract.placeBid(payload.auctionId, payload.bidder, bidAmountWei);
      return tx.wait();
    });
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === "BidPlaced") {
          const cached = auctionCache.get(payload.auctionId);
          if (cached) {
            cached.highBidder = payload.bidder;
            cached.highBidderAgentId = payload.bidderAgentId ?? null;
            cached.highBid = payload.bidAmount;
            cached.endTime = Number(parsed.args.newEndTime);
            if (parsed.args.extended) cached.extensionCount++;
            await upsertAuctionProjection(cached);
          }
          return {
            result: {
              txHash: receipt.hash,
              previousBidder: parsed.args.previousBidder,
              previousBid: parseFloat(ethers.formatUnits(parsed.args.previousBid, 18)),
            },
            txHash: receipt.hash,
          };
        }
      } catch {}
    }
    throw new Error("BidPlaced event not found in receipt");
  });
}
registerChainOperationProcessor("auction-bid", processAuctionBid);

/**
 * Execute instant buyout at the buyout price.
 */
export async function buyoutAuctionOnChain(
  auctionId: number,
  buyer: string
): Promise<{ txHash: string }> {
  return executeRegisteredChainOperation("auction-buyout", `${auctionId}:${buyer.toLowerCase()}`, { auctionId, buyer });
}
async function processAuctionBuyout(record: ChainOperationRecord): Promise<{ result: { txHash: string }; txHash: string }> {
  const payload = JSON.parse(record.payload) as { auctionId: number; buyer: string };
  return traceTx("auction-buyout", "buyoutAuctionOnChain", payload, "bite", async () => {
    const contract = ensureAuctionHouseEnabled();
    const receipt = await queueBiteTransaction(`auction-buyout:${payload.auctionId}:${payload.buyer}`, async () => {
      const tx = await contract.buyout(payload.auctionId, payload.buyer);
      return tx.wait();
    });
    return { result: { txHash: receipt.hash }, txHash: receipt.hash };
  });
}
registerChainOperationProcessor("auction-buyout", processAuctionBuyout);

/**
 * End an expired auction (server calls this when time is up).
 */
export async function endAuctionOnChain(auctionId: number): Promise<string> {
  return executeRegisteredChainOperation("auction-end", String(auctionId), { auctionId });
}
async function processAuctionEnd(record: ChainOperationRecord): Promise<{ result: string; txHash: string }> {
  const payload = JSON.parse(record.payload) as { auctionId: number };
  return traceTx("auction-end", "endAuctionOnChain", payload, "bite", async () => {
    const contract = ensureAuctionHouseEnabled();
    const receipt = await queueBiteTransaction(`auction-end:${payload.auctionId}`, async () => {
      const tx = await contract.endAuction(payload.auctionId);
      return tx.wait();
    });
    const cached = auctionCache.get(payload.auctionId);
    if (cached) {
      cached.status = 1;
      await upsertAuctionProjection(cached);
    }
    return { result: receipt.hash, txHash: receipt.hash };
  });
}
registerChainOperationProcessor("auction-end", processAuctionEnd);

/**
 * Cancel an auction (before any bids).
 */
export async function cancelAuctionOnChain(auctionId: number): Promise<string> {
  return executeRegisteredChainOperation("auction-cancel", String(auctionId), { auctionId });
}
async function processAuctionCancel(record: ChainOperationRecord): Promise<{ result: string; txHash: string }> {
  const payload = JSON.parse(record.payload) as { auctionId: number };
  return traceTx("auction-cancel", "cancelAuctionOnChain", payload, "bite", async () => {
    const contract = ensureAuctionHouseEnabled();
    const receipt = await queueBiteTransaction(`auction-cancel:${payload.auctionId}`, async () => {
      const tx = await contract.cancelAuction(payload.auctionId);
      return tx.wait();
    });
    const cached = auctionCache.get(payload.auctionId);
    if (cached) {
      cached.status = 2;
      await upsertAuctionProjection(cached);
    }
    return { result: receipt.hash, txHash: receipt.hash };
  });
}
registerChainOperationProcessor("auction-cancel", processAuctionCancel);

/**
 * Read auction details. Uses in-memory cache (the on-chain getAuction view
 * function has a known bug on SKALE BITE v2 — returns 0x for all IDs).
 */
export async function getAuctionFromChain(auctionId: number): Promise<AuctionData> {
  if (isPostgresConfigured()) {
    const projected = await getAuctionProjection(auctionId);
    if (projected) {
      auctionCache.set(projected.auctionId, projected);
      return projected;
    }
  }
  const cached = auctionCache.get(auctionId);
  if (cached) return cached;
  throw new Error(`Auction ${auctionId} not found`);
}

/**
 * Get the next auction ID (total number of auctions created).
 */
export async function getNextAuctionId(): Promise<number> {
  const contract = ensureAuctionHouseEnabled();
  try {
    return Number(await contract.nextAuctionId());
  } catch (err) {
    if (isTransientRpcReadError(err)) {
      warnTransientAuctionRead("nextAuctionId", err);
      return 0;
    }
    throw err;
  }
}

/**
 * Get all auction IDs for a specific zone (filters by zoneId).
 * Reads from in-memory cache.
 */
export async function getZoneAuctionsFromChain(
  zoneId: string,
  statusFilter?: number
): Promise<number[]> {
  if (isPostgresConfigured()) {
    const projected = await listAuctionProjections(statusFilter, zoneId);
    projected.forEach((auction) => auctionCache.set(auction.auctionId, auction));
    return projected.map((auction) => auction.auctionId);
  }

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
 * Get all auctions across all zones from cache.
 * Optional status filter (0=Active, 1=Ended, 2=Cancelled).
 */
export function getAllAuctionsFromCache(statusFilter?: number): AuctionData[] {
  const results: AuctionData[] = [];
  for (const auction of auctionCache.values()) {
    if (statusFilter === undefined || auction.status === statusFilter) {
      results.push(auction);
    }
  }
  return results;
}

export async function hydrateAuctionCacheFromProjections(): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const auctions = await listAuctionProjections();
  for (const auction of auctions) {
    auctionCache.set(auction.auctionId, auction);
  }
  return auctions.length;
}

/**
 * Rebuild the auction cache from historical on-chain events.
 * Call once at server startup to restore state from before the process restarted.
 */
export async function rebuildAuctionCache(): Promise<void> {
  if (!AUCTION_HOUSE_CONTRACT_ADDRESS || !biteProvider) return;

  // Verify contract is actually deployed before calling methods
  let code: string;
  try {
    code = await biteProvider.getCode(AUCTION_HOUSE_CONTRACT_ADDRESS);
  } catch (err) {
    if (isTransientRpcReadError(err)) {
      warnTransientAuctionRead("cache rebuild contract code lookup", err);
      return;
    }
    throw err;
  }
  if (!code || code === "0x") {
    console.warn(`[auction] No contract deployed at ${AUCTION_HOUSE_CONTRACT_ADDRESS} — skipping cache rebuild`);
    return;
  }

  const readContract = new ethers.Contract(
    AUCTION_HOUSE_CONTRACT_ADDRESS,
    AUCTION_HOUSE_ABI,
    biteProvider
  );

  try {
    let nextId: number;
    try {
      nextId = Number(await readContract.nextAuctionId());
    } catch (err) {
      if (isTransientRpcReadError(err)) {
        warnTransientAuctionRead("cache rebuild nextAuctionId", err);
        return;
      }
      throw err;
    }
    if (nextId === 0) {
      console.log("[auction] No auctions on-chain to rebuild");
      return;
    }

    // SKALE limits eth_getLogs to 2000 blocks per query.
    // Scan backwards from latest in 2000-block chunks until we find all auctions.
    let latestBlock: number;
    try {
      latestBlock = await biteProvider.getBlockNumber();
    } catch (err) {
      if (isTransientRpcReadError(err)) {
        warnTransientAuctionRead("cache rebuild latest block lookup", err);
        return;
      }
      throw err;
    }
    const CHUNK = 1999;

    async function queryInChunks(filter: any): Promise<any[]> {
      const allLogs: any[] = [];
      let to = latestBlock;
      while (to >= 0) {
        const from = Math.max(0, to - CHUNK);
        let logs: any[];
        try {
          logs = await readContract.queryFilter(filter, from, to);
        } catch (err) {
          if (isTransientRpcReadError(err)) {
            warnTransientAuctionRead(`queryFilter ${String(filter?.fragment?.name ?? "unknown")} ${from}-${to}`, err);
            break;
          }
          throw err;
        }
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
        highBidderAgentId: null,
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
