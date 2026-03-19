/**
 * MPP-gated bid fee service.
 *
 * The existing auction house handles all bid logic (reserveGold, anti-snipe,
 * settlement). This service adds an MPP fee gate: the bidder pays a small
 * fee via Tempo before the bid is placed in the auction system.
 *
 * Flow:
 *  1. Buyer submits bid amount + auction ID
 *  2. Backend validates bid is above current minimum
 *  3. Backend creates a BID_FEE operation
 *  4. MPP 402 challenge returned for bid fee
 *  5. On payment confirmation: place bid in existing auction system
 *  6. Mark operation BID_PLACED
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { getRedis } from "../redis.js";
import {
  createOperation,
  getOperation,
  updateOperationStatus,
  findOperationByKey,
  acquireOperationLock,
  releaseOperationLock,
  OperationStatus,
  type Operation,
} from "./operationRegistry.js";
import { handleMppCharge, ensureIdempotentSettlement } from "./marketplacePayments.js";

// ── Config ──────────────────────────────────────────────────────────

/** Bid fee in USD cents. $0.05 default. */
const BID_FEE_CENTS = parseInt(process.env.BID_FEE_CENTS ?? "5", 10);

const SKALE_CHAIN = "skale";
const SKALE_ITEMS_CONTRACT = process.env.ITEMS_CONTRACT_ADDRESS ?? "";

// ── Redis Keys ──────────────────────────────────────────────────────

const KEY_BID_OP = (auctionId: number, bidder: string) =>
  `mktplace:bid:${auctionId}:${bidder.toLowerCase()}`;

// ── Public API ──────────────────────────────────────────────────────

export function getBidFeeCents(): number {
  return BID_FEE_CENTS;
}

/**
 * Record a bid-fee operation link in Redis so we can enforce
 * one paid bid per auction per bidder (until outbid).
 */
async function recordBidOp(
  auctionId: number,
  bidderWallet: string,
  operationId: string
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  // Expire after 24h (auctions don't last longer)
  await redis.set(KEY_BID_OP(auctionId, bidderWallet), operationId, "EX", 86400);
}

async function getExistingBidOp(
  auctionId: number,
  bidderWallet: string
): Promise<Operation | null> {
  const redis = getRedis();
  if (!redis) return null;
  const opId = await redis.get(KEY_BID_OP(auctionId, bidderWallet));
  if (!opId) return null;
  return getOperation(opId);
}

/**
 * Handle MPP-gated bid placement.
 *
 * @param server     Fastify instance (for logging)
 * @param req        Raw Node request (for MPP)
 * @param res        Raw Node response (for MPP 402)
 * @param reply      Fastify reply (for JSON responses after MPP)
 * @param auctionId  The auction being bid on
 * @param bidderWallet  The bidder's wallet
 * @param bidAmount  The gold bid amount
 * @param tokenId    The auction's token ID
 * @param placeBidFn Callback that actually places the bid in the auction system
 */
export async function handleMppBid(params: {
  server: FastifyInstance;
  req: import("http").IncomingMessage;
  res: import("http").ServerResponse;
  reply: FastifyReply;
  auctionId: number;
  bidderWallet: string;
  bidAmount: number;
  tokenId: number;
  placeBidFn: () => Promise<{ ok: boolean; error?: string }>;
}): Promise<void> {
  const {
    server, req, res, reply,
    auctionId, bidderWallet, bidAmount, tokenId,
    placeBidFn,
  } = params;

  // Check for existing paid bid on this auction by this bidder
  const existingOp = await getExistingBidOp(auctionId, bidderWallet);
  if (existingOp?.status === OperationStatus.BID_PLACED) {
    // Already paid for this auction — allow re-bidding without another fee
    const result = await placeBidFn();
    if (result.ok) {
      reply.send({ ok: true, operationId: existingOp.operationId, status: "bid_placed", feePaid: false });
    } else {
      reply.code(400).send({ error: result.error ?? "Bid failed" });
    }
    return;
  }

  // Run MPP charge for bid fee
  const chargeResult = await handleMppCharge({
    req,
    res,
    amountCents: BID_FEE_CENTS,
    operationId: `bid-${auctionId}-${bidderWallet}`,
    description: `WoG bid fee: auction #${auctionId}`,
  });

  if (chargeResult.status === 402) {
    // 402 already written by mppx
    return;
  }

  // Payment confirmed — create operation and place bid
  const op = await createOperation({
    operationType: "bid_fee",
    assetType: "item",
    sourceChain: SKALE_CHAIN,
    sourceContract: SKALE_ITEMS_CONTRACT,
    sourceTokenId: tokenId,
    quantity: 1,
    ownerWallet: bidderWallet,
    buyerWallet: bidderWallet,
    paymentRail: "tempo_mpp",
    paymentReference: chargeResult.receipt.receiptId,
    auctionId,
    status: OperationStatus.PAYMENT_CONFIRMED,
  });

  // Place the bid
  const result = await placeBidFn();
  if (result.ok) {
    await updateOperationStatus(op.operationId, OperationStatus.BID_PLACED);
    await recordBidOp(auctionId, bidderWallet, op.operationId);
    reply.send({
      ok: true,
      operationId: op.operationId,
      status: "bid_placed",
      feePaid: true,
      feeAmount: BID_FEE_CENTS,
    });
  } else {
    await updateOperationStatus(op.operationId, OperationStatus.FAILED, {
      failureReason: result.error,
    });
    reply.code(400).send({ error: result.error ?? "Bid failed after payment" });
  }
}
