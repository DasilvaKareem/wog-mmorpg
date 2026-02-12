import { ethers } from "ethers";
import { biteWallet } from "./biteChain.js";

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

  // Parse AuctionCreated event to extract auctionId
  for (const log of receipt.logs) {
    try {
      const parsed = auctionHouseContract.interface.parseLog(log);
      if (parsed?.name === "AuctionCreated") {
        return {
          auctionId: Number(parsed.args.auctionId),
          txHash: receipt.hash,
        };
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

  // Parse BidPlaced event to get previous bidder
  for (const log of receipt.logs) {
    try {
      const parsed = auctionHouseContract.interface.parseLog(log);
      if (parsed?.name === "BidPlaced") {
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
  return receipt.hash;
}

/**
 * Cancel an auction (before any bids).
 */
export async function cancelAuctionOnChain(auctionId: number): Promise<string> {
  ensureAuctionHouseEnabled();
  const tx = await auctionHouseContract.cancelAuction(auctionId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Read auction details from the contract.
 */
export async function getAuctionFromChain(auctionId: number): Promise<AuctionData> {
  ensureAuctionHouseEnabled();
  const [
    zoneId,
    seller,
    tokenId,
    quantity,
    startPrice,
    buyoutPrice,
    endTime,
    highBidder,
    highBid,
    status,
    extensionCount,
  ] = await auctionHouseContract.getAuction(auctionId);

  return {
    auctionId,
    zoneId,
    seller,
    tokenId: Number(tokenId),
    quantity: Number(quantity),
    startPrice: parseFloat(ethers.formatUnits(startPrice, 18)),
    buyoutPrice: parseFloat(ethers.formatUnits(buyoutPrice, 18)),
    endTime: Number(endTime),
    highBidder,
    highBid: parseFloat(ethers.formatUnits(highBid, 18)),
    status: Number(status),
    extensionCount: Number(extensionCount),
  };
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
 * This is a helper that iterates through all auctions — not gas-efficient on-chain
 * but fine for off-chain querying.
 */
export async function getZoneAuctionsFromChain(
  zoneId: string,
  statusFilter?: number
): Promise<number[]> {
  ensureAuctionHouseEnabled();
  const nextId = await getNextAuctionId();
  const auctionIds: number[] = [];

  for (let i = 0; i < nextId; i++) {
    const auction = await getAuctionFromChain(i);
    if (auction.zoneId === zoneId) {
      if (statusFilter === undefined || auction.status === statusFilter) {
        auctionIds.push(i);
      }
    }
  }

  return auctionIds;
}
