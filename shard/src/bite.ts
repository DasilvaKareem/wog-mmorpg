import { ethers } from "ethers";
import { bite, biteWallet, biteProvider } from "./biteChain.js";

const TRADE_CONTRACT_ADDRESS = process.env.TRADE_CONTRACT_ADDRESS!;

/** WoGTrade ABI — only the functions/events we interact with at runtime. */
const TRADE_ABI = [
  "function createTrade(bytes encryptedAskPrice, uint256 tokenId, uint256 quantity, address seller) returns (uint256)",
  "function submitOffer(uint256 tradeId, bytes encryptedBidPrice, address buyer) payable returns (address)",
  "function cancelTrade(uint256 tradeId)",
  "function getTrade(uint256 tradeId) view returns (address seller, address buyer, uint256 tokenId, uint256 quantity, uint8 status, uint256 askPrice, uint256 bidPrice, bool matched)",
  "function nextTradeId() view returns (uint256)",
  "event TradeCreated(uint256 indexed tradeId, address indexed seller, uint256 tokenId, uint256 quantity)",
  "event OfferSubmitted(uint256 indexed tradeId, address indexed buyer)",
  "event TradeResolved(uint256 indexed tradeId, bool matched, uint256 askPrice, uint256 bidPrice)",
  "event TradeCancelled(uint256 indexed tradeId)",
];

const tradeContract = new ethers.Contract(
  TRADE_CONTRACT_ADDRESS,
  TRADE_ABI,
  biteWallet
);

// -- Encryption helpers --

/**
 * Encrypt a gold price using BITE v2 threshold encryption.
 * The price is ABI-encoded as a uint256 (in wei) before encryption,
 * so the contract's onDecrypt can abi.decode it back.
 */
export async function encryptPrice(amount: number): Promise<string> {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256"],
    [ethers.parseUnits(amount.toString(), 18)]
  );
  return bite.encryptMessage(encoded);
}

// -- Contract interaction helpers --

export interface TradeResult {
  tradeId: number;
  matched: boolean;
  askPrice: number;
  bidPrice: number;
  seller: string;
  buyer: string;
  tokenId: number;
  quantity: number;
  status: number;
}

/** Create a trade listing on the WoGTrade contract. */
export async function createTradeOnChain(
  encryptedAskPrice: string,
  tokenId: number,
  quantity: number,
  seller: string
): Promise<{ tradeId: number; txHash: string }> {
  const tx = await tradeContract.createTrade(
    encryptedAskPrice,
    tokenId,
    quantity,
    seller
  );
  const receipt = await tx.wait();

  // Parse TradeCreated event to extract the tradeId
  for (const log of receipt.logs) {
    try {
      const parsed = tradeContract.interface.parseLog(log);
      if (parsed?.name === "TradeCreated") {
        return {
          tradeId: Number(parsed.args.tradeId),
          txHash: receipt.hash,
        };
      }
    } catch {
      // Not our event, skip
    }
  }

  throw new Error("TradeCreated event not found in receipt");
}

/**
 * Submit an encrypted bid for a trade. This triggers the BITE v2 CTX
 * which will decrypt both prices in the next block.
 * Sends 0.00001 sFUEL to fund the CTX callback gas (sFUEL is free on SKALE).
 */
export async function submitOfferOnChain(
  tradeId: number,
  encryptedBidPrice: string,
  buyer: string
): Promise<{ txHash: string }> {
  const tx = await tradeContract.submitOffer(
    tradeId,
    encryptedBidPrice,
    buyer,
    { value: ethers.parseEther("0.00001") }
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Poll the contract until the trade resolves (status changes from Pending).
 * The CTX callback fires in the next block, so this typically resolves within a few seconds.
 */
export async function waitForTradeResolution(
  tradeId: number,
  timeoutMs = 30000
): Promise<TradeResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const trade = await getTradeFromChain(tradeId);
    // Status 2 = Resolved, 3 = Failed
    if (trade.status === 2 || trade.status === 3) {
      return trade;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Trade ${tradeId} resolution timed out after ${timeoutMs}ms`);
}

/** Cancel a trade that hasn't received an offer yet. */
export async function cancelTradeOnChain(tradeId: number): Promise<string> {
  const tx = await tradeContract.cancelTrade(tradeId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Read trade details from the contract. */
export async function getTradeFromChain(tradeId: number): Promise<TradeResult> {
  const [seller, buyer, tokenId, quantity, status, askPrice, bidPrice, matched] =
    await tradeContract.getTrade(tradeId);

  return {
    tradeId,
    seller,
    buyer,
    tokenId: Number(tokenId),
    quantity: Number(quantity),
    status: Number(status),
    askPrice: parseFloat(ethers.formatUnits(askPrice, 18)),
    bidPrice: parseFloat(ethers.formatUnits(bidPrice, 18)),
    matched,
  };
}

/** Get the next trade ID (total number of trades created). */
export async function getNextTradeId(): Promise<number> {
  return Number(await tradeContract.nextTradeId());
}
