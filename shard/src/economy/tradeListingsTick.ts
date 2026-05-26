import type { FastifyInstance } from "fastify";
import {
  listExpiredOpenTradeListings,
  markTradeListingCancelled,
} from "../db/tradeListingsStore.js";
import { sendInboxMessage } from "../agents/agentInbox.js";
import { cancelTradeOnChain } from "../blockchain/bite.js";

const TICK_INTERVAL_MS = Math.max(
  10_000,
  Number.parseInt(process.env.TRADE_EXPIRE_TICK_INTERVAL_MS ?? "60000", 10) || 60_000,
);

/**
 * Sweep targeted trade listings whose `expiresAtMs` has passed but which have
 * neither matched nor been cancelled. For each: flip the off-chain row to
 * cancelled, fire a `trade-result` inbox message to the seller, and attempt
 * a best-effort on-chain cancel so the BITE contract row stops occupying
 * state. On-chain cancel failures don't block the off-chain notification —
 * the contract trade will simply remain Created until manually cancelled
 * (or never, if the seller doesn't care).
 */
async function tradeExpireTick(server: FastifyInstance) {
  const now = Date.now();
  let expired;
  try {
    expired = await listExpiredOpenTradeListings(now, 200);
  } catch (err) {
    server.log.error(err, "tradeExpireTick: failed to query expired listings");
    return;
  }
  if (expired.length === 0) return;

  for (const listing of expired) {
    try {
      await markTradeListingCancelled(listing.tradeId, now);

      const itemDisplay = listing.itemName ?? `token #${listing.tokenId}`;
      await sendInboxMessage({
        from: listing.sellerWallet,
        fromName: "Trade House",
        to: listing.sellerWallet,
        type: "trade-result",
        body: `Your offer of ${itemDisplay} for ${listing.askPrice}g expired without a response.`,
        data: {
          kind: "trade-expired",
          tradeId: listing.tradeId,
          tokenId: listing.tokenId,
          askPrice: listing.askPrice,
          itemName: itemDisplay,
          targetBuyerWallet: listing.targetBuyerWallet,
        },
      }).catch((err) =>
        server.log.error(err, `tradeExpireTick: failed to notify seller for trade ${listing.tradeId}`)
      );

      // Best-effort on-chain cancel — seller-signed cancel may fail (auth, gas, already-resolved)
      // and that's fine; the off-chain state is the authoritative one for visibility.
      cancelTradeOnChain(listing.tradeId).catch((err) => {
        server.log.warn(`tradeExpireTick: on-chain cancel for trade ${listing.tradeId} failed (non-fatal): ${err?.message ?? err}`);
      });

      server.log.info(`Trade ${listing.tradeId} expired and notified seller ${listing.sellerWallet}`);
    } catch (err) {
      server.log.error(err, `tradeExpireTick: error processing trade ${listing.tradeId}`);
    }
  }
}

/**
 * Register the trade expire tick. Runs every 60s by default; override with
 * env TRADE_EXPIRE_TICK_INTERVAL_MS.
 */
export function registerTradeListingsTick(server: FastifyInstance) {
  server.log.info(`Registering trade expire tick (${TICK_INTERVAL_MS}ms interval)`);

  const tickInterval = setInterval(() => {
    tradeExpireTick(server).catch((err) => {
      server.log.error(err, "Unhandled error in tradeExpireTick");
    });
  }, TICK_INTERVAL_MS);

  server.addHook("onClose", async () => {
    clearInterval(tickInterval);
    server.log.info("Trade expire tick stopped");
  });
}
