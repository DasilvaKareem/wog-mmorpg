import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getGoldBalance, getItemBalance, mintItem, burnItem, enqueueGoldTransferFrom } from "../blockchain/blockchain.js";
import { formatGold, getAvailableGoldAsync } from "../blockchain/goldLedger.js";
import {
  encryptPrice,
  createTradeOnChain,
  submitOfferOnChain,
  waitForTradeResolution,
  cancelTradeOnChain,
  getTradeFromChain,
  getNextTradeId,
} from "../blockchain/bite.js";
import {
  insertTradeListing,
  getTradeListing,
  markTradeListingCancelled,
  markTradeListingMatched,
  listIncomingTradesForBuyer,
  listOutgoingTradesForSeller,
  type TradeListing,
} from "../db/tradeListingsStore.js";
import { sendInboxMessage } from "../agents/agentInbox.js";
import { isWalletSpawned, getEntity } from "../world/zoneRuntime.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { getItemByTokenId } from "../items/itemCatalog.js";

const STATUS_NAMES = ["created", "pending", "resolved", "failed", "cancelled"];

const DEFAULT_TRADE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function resolveSellerName(sellerWallet: string): string {
  const spawn = isWalletSpawned(sellerWallet);
  if (!spawn) return sellerWallet.slice(0, 8);
  const ent = getEntity(spawn.entityId);
  return ent?.name ?? sellerWallet.slice(0, 8);
}

function resolveItemName(tokenId: number): string | null {
  const item = getItemByTokenId(BigInt(tokenId));
  return item?.name ?? null;
}

export function registerTradeRoutes(server: FastifyInstance) {
  /**
   * POST /trade/list
   * Seller lists an item for trade with an encrypted ask price.
   * The price is encrypted via BITE v2 — no other agent can see it.
   */
  server.post<{
    Body: {
      sellerAddress: string;
      tokenId: number;
      quantity: number;
      askPrice: number;
      targetBuyerWallet?: string;
      expiresAtMs?: number;
    };
  }>("/trade/list", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { sellerAddress, tokenId, quantity, askPrice, targetBuyerWallet, expiresAtMs } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (sellerAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    if (!sellerAddress || !/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
      reply.code(400);
      return { error: "Invalid seller address" };
    }

    if (quantity < 1) {
      reply.code(400);
      return { error: "Quantity must be at least 1" };
    }

    if (askPrice <= 0) {
      reply.code(400);
      return { error: "Ask price must be positive" };
    }

    if (targetBuyerWallet && !/^0x[a-fA-F0-9]{40}$/.test(targetBuyerWallet)) {
      reply.code(400);
      return { error: "Invalid target buyer wallet" };
    }

    if (targetBuyerWallet && targetBuyerWallet.toLowerCase() === sellerAddress.toLowerCase()) {
      reply.code(400);
      return { error: "Cannot target yourself" };
    }

    try {
      // Verify seller owns the item on the main SKALE chain
      const balance = await getItemBalance(sellerAddress, BigInt(tokenId));
      if (balance < BigInt(quantity)) {
        reply.code(400);
        return {
          error: "Insufficient item balance",
          required: quantity,
          available: balance.toString(),
        };
      }

      // Encrypt ask price using BITE v2 threshold encryption
      const encryptedAsk = await encryptPrice(askPrice);

      // Submit to WoGTrade contract on BITE v2 sandbox chain
      const { tradeId, txHash } = await createTradeOnChain(
        encryptedAsk,
        tokenId,
        quantity,
        sellerAddress
      );

      const now = Date.now();
      const sellerName = resolveSellerName(sellerAddress);
      const itemName = resolveItemName(tokenId);
      const ttl = typeof expiresAtMs === "number" && expiresAtMs > now ? expiresAtMs : now + DEFAULT_TRADE_TTL_MS;

      const listing: TradeListing = {
        tradeId,
        sellerWallet: sellerAddress.toLowerCase(),
        sellerName,
        tokenId,
        quantity,
        askPrice,
        targetBuyerWallet: targetBuyerWallet ? targetBuyerWallet.toLowerCase() : null,
        itemName,
        createdAtMs: now,
        expiresAtMs: ttl,
        cancelledAtMs: null,
        matchedAtMs: null,
      };
      await insertTradeListing(listing).catch((err) =>
        server.log.error(err, `Failed to persist trade listing ${tradeId}`)
      );

      server.log.info(
        `Trade ${tradeId} created by ${sellerAddress}: tokenId=${tokenId} qty=${quantity}${targetBuyerWallet ? ` target=${targetBuyerWallet}` : ""}`
      );

      // Targeted P2P: notify the recipient via inbox with the actionable payload.
      if (targetBuyerWallet) {
        const displayItem = itemName ?? `token #${tokenId}`;
        const qtyLabel = quantity > 1 ? ` ×${quantity}` : "";
        await sendInboxMessage({
          from: sellerAddress.toLowerCase(),
          fromName: sellerName,
          to: targetBuyerWallet.toLowerCase(),
          type: "trade-offer",
          body: `${sellerName} wants to sell you ${displayItem}${qtyLabel} for ${askPrice}g`,
          data: {
            kind: "trade-offer",
            tradeId,
            tokenId,
            quantity,
            askPrice,
            itemName,
            sellerName,
            sellerWallet: sellerAddress.toLowerCase(),
            expiresAtMs: ttl,
          },
        }).catch((err) =>
          server.log.error(err, `Failed to deliver trade-offer inbox for trade ${tradeId}`)
        );
      }

      // Surface the listing in zone chat for observers (only when seller has a spawned entity).
      const sellerSpawn = isWalletSpawned(sellerAddress);
      if (sellerSpawn) {
        const displayItem = itemName ?? `token #${tokenId}`;
        const audience = targetBuyerWallet ? ` to a specific buyer` : "";
        logZoneEvent({
          zoneId: sellerSpawn.zoneId,
          type: "trade",
          tick: 0,
          message: `${sellerName} listed ${displayItem} for ${askPrice}g${audience}.`,
          entityId: sellerSpawn.entityId,
          entityName: sellerName,
          data: { tradeId, tokenId, askPrice, targeted: !!targetBuyerWallet },
        });
      }

      return { ok: true, tradeId, txHash, expiresAtMs: ttl };
    } catch (err) {
      server.log.error(err, "Failed to create trade listing");
      reply.code(500);
      return { error: "Failed to create trade" };
    }
  });

  /**
   * POST /trade/offer
   * Buyer submits an encrypted bid for an existing trade.
   * Triggers BITE v2 CTX — both prices are decrypted atomically in the next block.
   * If bid >= ask, the trade matches and the item is minted to the buyer.
   */
  server.post<{
    Body: { tradeId: number; buyerAddress: string; bidPrice: number };
  }>("/trade/offer", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { tradeId, buyerAddress, bidPrice } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (buyerAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    if (!buyerAddress || !/^0x[a-fA-F0-9]{40}$/.test(buyerAddress)) {
      reply.code(400);
      return { error: "Invalid buyer address" };
    }

    if (bidPrice <= 0) {
      reply.code(400);
      return { error: "Bid price must be positive" };
    }

    try {
      // Enforce targeted P2P at the API layer (the contract is open-bid).
      const listing = await getTradeListing(tradeId).catch(() => null);
      if (listing) {
        if (listing.cancelledAtMs !== null) {
          reply.code(410);
          return { error: "Trade listing was cancelled" };
        }
        if (listing.matchedAtMs !== null) {
          reply.code(410);
          return { error: "Trade listing already matched" };
        }
        if (listing.expiresAtMs <= Date.now()) {
          reply.code(410);
          return { error: "Trade listing expired" };
        }
        if (
          listing.targetBuyerWallet &&
          listing.targetBuyerWallet.toLowerCase() !== buyerAddress.toLowerCase()
        ) {
          reply.code(403);
          return { error: "This trade is reserved for another buyer" };
        }
      }

      const onChainGold = parseFloat(await getGoldBalance(buyerAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(buyerAddress, safeOnChainGold);
      if (availableGold < bidPrice) {
        reply.code(400);
        return {
          error: "Insufficient gold",
          required: bidPrice,
          available: formatGold(availableGold),
        };
      }

      // Encrypt bid price using BITE v2 threshold encryption
      const encryptedBid = await encryptPrice(bidPrice);

      // Submit offer to WoGTrade contract (triggers CTX for decryption)
      const { txHash } = await submitOfferOnChain(
        tradeId,
        encryptedBid,
        buyerAddress
      );

      server.log.info(
        `Offer submitted for trade ${tradeId} by ${buyerAddress}, waiting for CTX resolution...`
      );

      // Poll contract until BITE decrypts and onDecrypt resolves the trade
      const result = await waitForTradeResolution(tradeId);

      if (result.matched) {
        const settledPrice = result.askPrice;
        const sellerWallet = result.seller || listing?.sellerWallet;
        const tokenIdBig = BigInt(result.tokenId);
        const qtyBig = BigInt(result.quantity);

        if (!sellerWallet) {
          server.log.error(`Trade ${tradeId} matched but no seller wallet available — cannot settle`);
          reply.code(500);
          return { error: "Settlement failed: missing seller address" };
        }

        // Verify the seller still owns the item. If they sold/equipped it
        // between listing and acceptance, bail out and mark cancelled.
        const sellerBalance = await getItemBalance(sellerWallet, tokenIdBig);
        if (sellerBalance < qtyBig) {
          await markTradeListingCancelled(tradeId, Date.now()).catch(() => {});
          server.log.warn(
            `Trade ${tradeId} match aborted: seller ${sellerWallet} no longer holds ${result.quantity} of token ${result.tokenId}`
          );
          reply.code(409);
          return { error: "Seller no longer holds the listed item" };
        }

        // Three-step settlement with compensating rollbacks on partial failure.
        // Step A: burn item from seller.
        let burnTx: string;
        try {
          burnTx = await burnItem(sellerWallet, tokenIdBig, qtyBig);
        } catch (burnErr) {
          server.log.error(burnErr, `Trade ${tradeId} settlement failed at burn step`);
          reply.code(502);
          return { error: "Failed to escrow seller item; trade not settled" };
        }

        // Step B: transfer gold buyer → seller (atomic Postgres update + on-chain enqueue).
        let goldTx: string;
        try {
          goldTx = await enqueueGoldTransferFrom(buyerAddress, sellerWallet, String(settledPrice));
        } catch (goldErr) {
          // Rollback: re-mint the burned item to the seller.
          await mintItem(sellerWallet, tokenIdBig, qtyBig).catch((revertErr) =>
            server.log.error(revertErr, `Trade ${tradeId}: CRITICAL — failed to restore burned item to seller after gold-transfer failure`)
          );
          server.log.error(goldErr, `Trade ${tradeId} settlement failed at gold-transfer step (item restored to seller)`);
          reply.code(502);
          return { error: "Failed to transfer gold; trade rolled back" };
        }

        // Step C: mint item to buyer.
        let mintTx: string;
        try {
          mintTx = await mintItem(buyerAddress, tokenIdBig, qtyBig);
        } catch (mintErr) {
          // Rollback: reverse gold transfer + restore item to seller.
          await enqueueGoldTransferFrom(sellerWallet, buyerAddress, String(settledPrice)).catch((revertErr) =>
            server.log.error(revertErr, `Trade ${tradeId}: CRITICAL — failed to revert gold transfer after mint failure`)
          );
          await mintItem(sellerWallet, tokenIdBig, qtyBig).catch((revertErr) =>
            server.log.error(revertErr, `Trade ${tradeId}: CRITICAL — failed to restore item to seller after mint failure`)
          );
          server.log.error(mintErr, `Trade ${tradeId} settlement failed at buyer-mint step (rolled back)`);
          reply.code(502);
          return { error: "Failed to deliver item; trade rolled back" };
        }

        server.log.info(
          `Trade ${tradeId} settled: ${sellerWallet} → ${buyerAddress}, token ${result.tokenId} x${result.quantity} for ${settledPrice}g (burn=${burnTx}, gold=${goldTx}, mint=${mintTx})`
        );

        await markTradeListingMatched(tradeId, Date.now()).catch((err) =>
          server.log.error(err, `Failed to mark trade ${tradeId} matched off-chain`)
        );

        // Notify the seller — they've been blind to the buyer's decision until now.
        const itemDisplay = resolveItemName(result.tokenId) ?? listing?.itemName ?? `token #${result.tokenId}`;
        const buyerSpawn = isWalletSpawned(buyerAddress);
        const buyerName = buyerSpawn ? (getEntity(buyerSpawn.entityId)?.name ?? buyerAddress.slice(0, 8)) : buyerAddress.slice(0, 8);
        const sellerName = listing?.sellerName ?? resolveSellerName(sellerWallet);

        await sendInboxMessage({
          from: buyerAddress.toLowerCase(),
          fromName: buyerName,
          to: sellerWallet.toLowerCase(),
          type: "trade-result",
          body: `${buyerName} accepted your offer for ${itemDisplay}. Received ${settledPrice}g.`,
          data: {
            kind: "trade-completed",
            tradeId,
            tokenId: result.tokenId,
            quantity: result.quantity,
            settledPrice,
            buyerWallet: buyerAddress.toLowerCase(),
            buyerName,
            itemName: itemDisplay,
          },
        }).catch((err) =>
          server.log.error(err, `Failed to notify seller of trade ${tradeId} completion`)
        );

        // Surface match in zone chat for the buyer (where they're spawned).
        if (buyerSpawn) {
          logZoneEvent({
            zoneId: buyerSpawn.zoneId,
            type: "trade",
            tick: 0,
            message: `${buyerName} bought ${itemDisplay} from ${sellerName} for ${settledPrice}g.`,
            entityId: buyerSpawn.entityId,
            entityName: buyerName,
            data: { tradeId, tokenId: result.tokenId, settledPrice },
          });
        }

        return {
          ok: true,
          matched: true,
          tradeId,
          askPrice: result.askPrice,
          bidPrice: result.bidPrice,
          settledPrice,
          remainingGold: formatGold(
            await getAvailableGoldAsync(buyerAddress, parseFloat(await getGoldBalance(buyerAddress)))
          ),
          itemTx: mintTx,
          goldTx,
          burnTx,
          txHash,
        };
      }

      return {
        ok: true,
        matched: false,
        tradeId,
        askPrice: result.askPrice,
        bidPrice: result.bidPrice,
        reason: "Bid price below ask price",
        txHash,
      };
    } catch (err) {
      server.log.error(err, `Failed to submit offer for trade ${tradeId}`);
      reply.code(500);
      return { error: "Failed to submit offer" };
    }
  });

  /**
   * GET /trade/:id
   * Returns trade details. Prices are only visible after resolution.
   */
  server.get<{ Params: { id: string } }>(
    "/trade/:id",
    async (request, reply) => {
      const tradeId = parseInt(request.params.id, 10);
      if (isNaN(tradeId) || tradeId < 0) {
        reply.code(400);
        return { error: "Invalid trade ID" };
      }

      try {
        const trade = await getTradeFromChain(tradeId);
        return {
          tradeId: trade.tradeId,
          seller: trade.seller,
          buyer: trade.buyer,
          tokenId: trade.tokenId,
          quantity: trade.quantity,
          status: STATUS_NAMES[trade.status] || "unknown",
          // Prices are only revealed after CTX decryption (status >= Resolved)
          askPrice: trade.status >= 2 ? trade.askPrice : "encrypted",
          bidPrice: trade.status >= 2 ? trade.bidPrice : "encrypted",
          matched: trade.matched,
        };
      } catch (err) {
        server.log.error(err, `Failed to get trade ${tradeId}`);
        reply.code(500);
        return { error: "Failed to read trade" };
      }
    }
  );

  /**
   * GET /trades
   * Lists all trades from the WoGTrade contract.
   */
  server.get("/trades", async (_request, reply) => {
    try {
      const nextId = await getNextTradeId();
      const trades = [];

      for (let i = 0; i < nextId; i++) {
        const trade = await getTradeFromChain(i);
        trades.push({
          tradeId: trade.tradeId,
          seller: trade.seller,
          buyer: trade.buyer,
          tokenId: trade.tokenId,
          quantity: trade.quantity,
          status: STATUS_NAMES[trade.status] || "unknown",
          matched: trade.matched,
        });
      }

      return trades;
    } catch (err) {
      server.log.error(err, "Failed to list trades");
      reply.code(500);
      return { error: "Failed to list trades" };
    }
  });

  /**
   * POST /trade/cancel
   * Seller cancels a trade that hasn't received an offer yet.
   */
  server.post<{ Body: { tradeId: number } }>(
    "/trade/cancel",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { tradeId } = request.body;
      const authenticatedWallet = (request as any).walletAddress as string;

      try {
        // Off-chain ownership check (the on-chain contract enforces seller too,
        // but rejecting early here avoids paying for a tx that would revert).
        const listing = await getTradeListing(tradeId).catch(() => null);
        if (listing && listing.sellerWallet.toLowerCase() !== authenticatedWallet.toLowerCase()) {
          reply.code(403);
          return { error: "Only the seller can cancel this trade" };
        }

        const txHash = await cancelTradeOnChain(tradeId);
        await markTradeListingCancelled(tradeId, Date.now()).catch((err) =>
          server.log.error(err, `Failed to mark trade ${tradeId} cancelled off-chain`)
        );
        server.log.info(`Trade ${tradeId} cancelled: ${txHash}`);
        return { ok: true, tradeId, txHash };
      } catch (err) {
        server.log.error(err, `Failed to cancel trade ${tradeId}`);
        reply.code(500);
        return { error: "Failed to cancel trade" };
      }
    }
  );

  /**
   * POST /trade/reject
   * Targeted recipient declines an incoming trade offer.
   * Off-chain only: marks the listing as no longer presented to the buyer.
   * The on-chain trade remains in Created status until the seller cancels or
   * the listing expires — but it won't appear in the recipient's inbox feed.
   */
  server.post<{ Body: { tradeId: number } }>(
    "/trade/reject",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { tradeId } = request.body;
      const authenticatedWallet = (request as any).walletAddress as string;

      const listing = await getTradeListing(tradeId).catch(() => null);
      if (!listing) {
        reply.code(404);
        return { error: "Trade listing not found" };
      }
      if (
        !listing.targetBuyerWallet ||
        listing.targetBuyerWallet.toLowerCase() !== authenticatedWallet.toLowerCase()
      ) {
        reply.code(403);
        return { error: "Only the targeted recipient can reject this trade" };
      }
      if (listing.cancelledAtMs !== null || listing.matchedAtMs !== null) {
        return { ok: true, tradeId, alreadyClosed: true };
      }

      await markTradeListingCancelled(tradeId, Date.now()).catch((err) =>
        server.log.error(err, `Failed to mark trade ${tradeId} rejected`)
      );
      server.log.info(`Trade ${tradeId} rejected by recipient ${authenticatedWallet}`);

      // Tell the seller their offer was declined.
      const itemDisplay = listing.itemName ?? resolveItemName(listing.tokenId) ?? `token #${listing.tokenId}`;
      const buyerSpawn = isWalletSpawned(authenticatedWallet);
      const buyerName = buyerSpawn
        ? getEntity(buyerSpawn.entityId)?.name ?? authenticatedWallet.slice(0, 8)
        : authenticatedWallet.slice(0, 8);
      await sendInboxMessage({
        from: authenticatedWallet.toLowerCase(),
        fromName: buyerName,
        to: listing.sellerWallet.toLowerCase(),
        type: "trade-result",
        body: `${buyerName} declined your offer for ${itemDisplay}.`,
        data: {
          kind: "trade-declined",
          tradeId,
          tokenId: listing.tokenId,
          askPrice: listing.askPrice,
          buyerWallet: authenticatedWallet.toLowerCase(),
          buyerName,
          itemName: itemDisplay,
        },
      }).catch((err) =>
        server.log.error(err, `Failed to notify seller of trade ${tradeId} rejection`)
      );

      return { ok: true, tradeId };
    }
  );

  /**
   * GET /trade/outgoing/:wallet
   * List trade listings created BY this wallet. Includes pending (active),
   * matched, cancelled and expired listings so the seller has full visibility
   * of their offer history. Auth-gated to the wallet owner.
   */
  server.get<{ Params: { wallet: string } }>(
    "/trade/outgoing/:wallet",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const walletParam = request.params.wallet;
      const authenticatedWallet = (request as any).walletAddress as string;

      if (!walletParam || !/^0x[a-fA-F0-9]{40}$/.test(walletParam)) {
        reply.code(400);
        return { error: "Invalid wallet" };
      }
      if (walletParam.toLowerCase() !== authenticatedWallet.toLowerCase()) {
        reply.code(403);
        return { error: "Not authorized to read another wallet's outgoing trades" };
      }

      try {
        const listings = await listOutgoingTradesForSeller(walletParam);
        const now = Date.now();
        return {
          offers: listings.map((l) => ({
            tradeId: l.tradeId,
            sellerWallet: l.sellerWallet,
            sellerName: l.sellerName,
            targetBuyerWallet: l.targetBuyerWallet,
            tokenId: l.tokenId,
            quantity: l.quantity,
            askPrice: l.askPrice,
            itemName: l.itemName,
            createdAtMs: l.createdAtMs,
            expiresAtMs: l.expiresAtMs,
            cancelledAtMs: l.cancelledAtMs,
            matchedAtMs: l.matchedAtMs,
            status:
              l.matchedAtMs !== null ? "matched" :
              l.cancelledAtMs !== null ? "cancelled" :
              l.expiresAtMs <= now ? "expired" :
              "pending",
          })),
        };
      } catch (err) {
        server.log.error(err, `Failed to list outgoing trades for ${walletParam}`);
        reply.code(500);
        return { error: "Failed to list outgoing trades" };
      }
    }
  );

  /**
   * GET /trade/incoming/:wallet
   * List active, non-expired targeted trade offers awaiting this wallet's response.
   */
  server.get<{ Params: { wallet: string } }>(
    "/trade/incoming/:wallet",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const walletParam = request.params.wallet;
      const authenticatedWallet = (request as any).walletAddress as string;

      if (!walletParam || !/^0x[a-fA-F0-9]{40}$/.test(walletParam)) {
        reply.code(400);
        return { error: "Invalid wallet" };
      }
      if (walletParam.toLowerCase() !== authenticatedWallet.toLowerCase()) {
        reply.code(403);
        return { error: "Not authorized to read another wallet's incoming trades" };
      }

      try {
        const listings = await listIncomingTradesForBuyer(walletParam, Date.now());
        return {
          offers: listings.map((l) => ({
            tradeId: l.tradeId,
            sellerWallet: l.sellerWallet,
            sellerName: l.sellerName,
            tokenId: l.tokenId,
            quantity: l.quantity,
            askPrice: l.askPrice,
            itemName: l.itemName,
            createdAtMs: l.createdAtMs,
            expiresAtMs: l.expiresAtMs,
          })),
        };
      } catch (err) {
        server.log.error(err, `Failed to list incoming trades for ${walletParam}`);
        reply.code(500);
        return { error: "Failed to list incoming trades" };
      }
    }
  );
}
