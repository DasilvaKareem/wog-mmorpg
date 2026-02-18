import type { FastifyInstance } from "fastify";
import { mintItem } from "./blockchain.js";
import { recordGoldSpend, unreserveGold } from "./goldLedger.js";
import {
  getNextAuctionId,
  getAuctionFromChain,
  endAuctionOnChain,
} from "./auctionHouseChain.js";

const TICK_INTERVAL_MS = 5000; // 5 seconds

/**
 * Check all active auctions and settle any that have expired.
 */
async function auctionTick(server: FastifyInstance) {
  try {
    const nextId = await getNextAuctionId();
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

          // If there was a winner, mint item and settle payment
          if (
            auction.highBidder !== "0x0000000000000000000000000000000000000000" &&
            auction.highBid > 0
          ) {
            // Mint item to winner
            const mintTx = await mintItem(
              auction.highBidder,
              BigInt(auction.tokenId),
              BigInt(auction.quantity)
            );

            // Record gold spend (deduct from available)
            recordGoldSpend(auction.highBidder, auction.highBid);

            // Unreserve the gold (since it's now spent)
            unreserveGold(auction.highBidder, auction.highBid);

            server.log.info(
              `Auction ${i} settled: Winner ${auction.highBidder} paid ${auction.highBid} gold. Item minted: ${mintTx}`
            );
          } else {
            server.log.info(
              `Auction ${i} ended with no bids. Item returned to seller.`
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
