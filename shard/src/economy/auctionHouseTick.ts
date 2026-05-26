import type { FastifyInstance } from "fastify";
import { mintItem } from "../blockchain/blockchain.js";
import { recordGoldSpendAsync, revertGoldSpendAsync, unreserveGoldAsync } from "../blockchain/goldLedger.js";
import { assignItemInstanceOwner, getAuctionEscrowInstance } from "../items/itemRng.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import {
  getNextAuctionId,
  getAuctionFromChain,
  endAuctionOnChain,
  type AuctionData,
} from "./auctionHouseChain.js";
import { listExpiredActiveProjections } from "../db/auctionProjectionStore.js";
import { isPostgresConfigured } from "../db/postgres.js";
import { reputationManager, ReputationCategory } from "./reputationManager.js";
import { resolveLiveAgentIdForWallet } from "../erc8004/agentResolution.js";
import { sendInboxToCustodialOwner } from "../agents/agentInbox.js";

const TICK_INTERVAL_MS = Math.max(
  2_000,
  Number.parseInt(process.env.AUCTION_TICK_INTERVAL_MS ?? "5000", 10) || 5_000
); // 5 seconds default
const NEXT_ID_REFRESH_MS = 60_000; // only re-fetch nextAuctionId every 60s

let cachedNextAuctionId = 0;
let nextAuctionIdExpiresAt = 0;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Settle one expired auction: end on-chain, mint to winner or restore to seller,
 * release reserved gold, and emit reputation feedback.
 */
async function settleAuction(server: FastifyInstance, auctionId: number, auction: AuctionData): Promise<void> {
  server.log.info(
    `Auction ${auctionId} has expired. Settling... (highBidder: ${auction.highBidder}, highBid: ${auction.highBid})`
  );

  try {
    await endAuctionOnChain(auctionId);
  } catch (endErr: any) {
    // Already ended on-chain (e.g. cache rebuilt before AuctionEnded events applied)
    if (endErr?.info?.error?.message?.includes("not active") ||
        endErr?.message?.includes("not active")) {
      auction.status = 1; // Mark as ended in cache
      return;
    }
    throw endErr;
  }

  const hasWinner = auction.highBidder !== ZERO_ADDRESS && auction.highBid > 0;
  const itemName = getItemByTokenId(BigInt(auction.tokenId))?.name ?? `Token #${auction.tokenId}`;

  if (hasWinner) {
    await recordGoldSpendAsync(auction.highBidder, auction.highBid);
    await unreserveGoldAsync(auction.highBidder, auction.highBid);
    let mintTx: string | null = null;
    try {
      mintTx = await mintItem(
        auction.highBidder,
        BigInt(auction.tokenId),
        BigInt(auction.quantity)
      );
      const escrowedInstance = getAuctionEscrowInstance(auctionId);
      if (escrowedInstance) {
        await assignItemInstanceOwner(escrowedInstance.instanceId, auction.highBidder);
      }
    } catch (mintErr) {
      await revertGoldSpendAsync(auction.highBidder, auction.highBid).catch(() => {});
      throw mintErr;
    }

    const winnerAgentId = auction.highBidderAgentId ?? resolveLiveAgentIdForWallet(auction.highBidder);
    if (winnerAgentId) {
      reputationManager.submitFeedback(winnerAgentId, ReputationCategory.Economic, 3, `Won auction for item ${auction.tokenId}`);
    }
    server.log.info(
      `Auction ${auctionId} settled: Winner ${auction.highBidder} paid ${auction.highBid} gold. Item minted: ${mintTx}`
    );

    // Notify the seller via inbox (resolves custodial → owner so the human
    // player sees it, not the agent's custodial wallet).
    sendInboxToCustodialOwner(auction.seller, {
      from: "0x0000000000000000000000000000000000000000",
      fromName: "Auction House",
      type: "system",
      body: `Sold ${auction.quantity}× ${itemName} for ${auction.highBid} GOLD`,
      data: {
        kind: "auction_sold",
        auctionId,
        zoneId: auction.zoneId,
        tokenId: auction.tokenId,
        quantity: auction.quantity,
        salePrice: auction.highBid,
        buyer: auction.highBidder,
      },
    }).catch((err) => {
      server.log.warn({ err, auctionId }, "auction sale inbox notify failed");
    });
  } else {
    const restoreTx = await mintItem(
      auction.seller,
      BigInt(auction.tokenId),
      BigInt(auction.quantity)
    );
    const escrowedInstance = getAuctionEscrowInstance(auctionId);
    if (escrowedInstance) {
      await assignItemInstanceOwner(escrowedInstance.instanceId, auction.seller);
    }
    server.log.info(
      `Auction ${auctionId} ended with no bids. Escrow returned to seller ${auction.seller} via ${restoreTx}.`
    );

    // Notify the seller their listing expired with no bids.
    sendInboxToCustodialOwner(auction.seller, {
      from: "0x0000000000000000000000000000000000000000",
      fromName: "Auction House",
      type: "system",
      body: `Your listing of ${auction.quantity}× ${itemName} expired with no bids — item returned`,
      data: {
        kind: "auction_expired",
        auctionId,
        zoneId: auction.zoneId,
        tokenId: auction.tokenId,
        quantity: auction.quantity,
      },
    }).catch((err) => {
      server.log.warn({ err, auctionId }, "auction expire inbox notify failed");
    });
  }
}

/**
 * Postgres fast-path: scan only the rows whose end_time has already passed
 * (indexed by idx_auction_projections_active_end_time). O(currently expired)
 * instead of O(all auctions ever created).
 */
async function tickViaProjections(server: FastifyInstance): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expired = await listExpiredActiveProjections(now);
  for (const auction of expired) {
    try {
      await settleAuction(server, auction.auctionId, auction);
    } catch (err) {
      server.log.error(err, `Error settling auction ${auction.auctionId} via projection fast-path`);
    }
  }
}

/**
 * Legacy in-memory path: scan 0..nextAuctionId from the chain cache.
 * Kept for dev/local environments that run without Postgres.
 */
async function tickViaCacheScan(server: FastifyInstance): Promise<void> {
  // Refresh nextAuctionId from chain only every 60s (not every 5s tick)
  const now_ms = Date.now();
  if (now_ms >= nextAuctionIdExpiresAt) {
    cachedNextAuctionId = await getNextAuctionId();
    nextAuctionIdExpiresAt = now_ms + NEXT_ID_REFRESH_MS;
  }
  const nextId = cachedNextAuctionId;

  if (nextId <= 0) return;

  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < nextId; i++) {
    try {
      let auction;
      try {
        auction = await getAuctionFromChain(i);
      } catch {
        // Auction not in cache (stale from previous session) — skip
        continue;
      }

      if (auction.status !== 0) continue;
      if (now < auction.endTime) continue;

      await settleAuction(server, i, auction);
    } catch (err) {
      server.log.error(err, `Error processing auction ${i} in tick`);
    }
  }
}

/**
 * Check all active auctions and settle any that have expired.
 */
async function auctionTick(server: FastifyInstance) {
  try {
    if (isPostgresConfigured()) {
      await tickViaProjections(server);
    } else {
      await tickViaCacheScan(server);
    }
  } catch (err) {
    server.log.error(err, "Error in auction house tick");
  }
}

/**
 * Register the auction house tick with the server.
 * The tick runs every 5 seconds to check for expired auctions.
 */
export function registerAuctionHouseTick(server: FastifyInstance) {
  server.log.info("Registering auction house tick (5s interval)");

  const tickInterval = setInterval(() => {
    auctionTick(server).catch((err) => {
      server.log.error(err, "Unhandled error in auction tick");
    });
  }, TICK_INTERVAL_MS);

  // Clean up interval when server closes
  server.addHook("onClose", async () => {
    clearInterval(tickInterval);
    server.log.info("Auction house tick stopped");
  });
}
