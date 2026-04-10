import type { FastifyInstance } from "fastify";
import { mintItem } from "../blockchain/blockchain.js";
import { recordGoldSpendAsync, revertGoldSpendAsync, unreserveGoldAsync } from "../blockchain/goldLedger.js";
import { assignItemInstanceOwner, getAuctionEscrowInstance } from "../items/itemRng.js";
import {
  getNextAuctionId,
  getAuctionFromChain,
  endAuctionOnChain,
} from "./auctionHouseChain.js";
import { reputationManager, ReputationCategory } from "./reputationManager.js";
import { resolveLiveAgentIdForWallet } from "../erc8004/agentResolution.js";

const TICK_INTERVAL_MS = 5000; // 5 seconds
const NEXT_ID_REFRESH_MS = 60_000; // only re-fetch nextAuctionId every 60s

let cachedNextAuctionId = 0;
let nextAuctionIdExpiresAt = 0;

/**
 * Check all active auctions and settle any that have expired.
 */
async function auctionTick(server: FastifyInstance) {
  try {
    // Refresh nextAuctionId from chain only every 60s (not every 5s tick)
    const now_ms = Date.now();
    if (now_ms >= nextAuctionIdExpiresAt) {
      cachedNextAuctionId = await getNextAuctionId();
      nextAuctionIdExpiresAt = now_ms + NEXT_ID_REFRESH_MS;
    }
    const nextId = cachedNextAuctionId;

    // Skip the entire loop if no auctions exist
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

        // Skip if not active
        if (auction.status !== 0) continue;

        // Check if auction has expired
        if (now >= auction.endTime) {
          server.log.info(
            `Auction ${i} has expired. Settling... (highBidder: ${auction.highBidder}, highBid: ${auction.highBid})`
          );

          // End auction on-chain
          try {
            await endAuctionOnChain(i);
          } catch (endErr: any) {
            // Already ended on-chain (e.g. cache rebuilt before AuctionEnded events applied)
            if (endErr?.info?.error?.message?.includes("not active") ||
                endErr?.message?.includes("not active")) {
              auction.status = 1; // Mark as ended in cache
              continue;
            }
            throw endErr;
          }

          // If there was a winner, release the escrowed item and settle payment.
          if (
            auction.highBidder !== "0x0000000000000000000000000000000000000000" &&
            auction.highBid > 0
          ) {
            await recordGoldSpendAsync(auction.highBidder, auction.highBid);
            await unreserveGoldAsync(auction.highBidder, auction.highBid);
            let mintTx: string | null = null;
            try {
              mintTx = await mintItem(
                auction.highBidder,
                BigInt(auction.tokenId),
                BigInt(auction.quantity)
              );
              const escrowedInstance = getAuctionEscrowInstance(i);
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
              `Auction ${i} settled: Winner ${auction.highBidder} paid ${auction.highBid} gold. Item minted: ${mintTx}`
            );
          } else {
            const restoreTx = await mintItem(
              auction.seller,
              BigInt(auction.tokenId),
              BigInt(auction.quantity)
            );
            const escrowedInstance = getAuctionEscrowInstance(i);
            if (escrowedInstance) {
              await assignItemInstanceOwner(escrowedInstance.instanceId, auction.seller);
            }
            server.log.info(
              `Auction ${i} ended with no bids. Escrow returned to seller ${auction.seller} via ${restoreTx}.`
            );
          }
        }
      } catch (err) {
        server.log.error(err, `Error processing auction ${i} in tick`);
      }
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
