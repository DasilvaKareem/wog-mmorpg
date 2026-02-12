import type { FastifyInstance } from "fastify";
import { getGoldBalance, getItemBalance, mintItem } from "./blockchain.js";
import { formatGold, getAvailableGold, recordGoldSpend } from "./goldLedger.js";
import {
  encryptPrice,
  createTradeOnChain,
  submitOfferOnChain,
  waitForTradeResolution,
  cancelTradeOnChain,
  getTradeFromChain,
  getNextTradeId,
} from "./bite.js";

const STATUS_NAMES = ["created", "pending", "resolved", "failed", "cancelled"];

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
    };
  }>("/trade/list", async (request, reply) => {
    const { sellerAddress, tokenId, quantity, askPrice } = request.body;

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

      server.log.info(
        `Trade ${tradeId} created by ${sellerAddress}: tokenId=${tokenId} qty=${quantity}`
      );

      return { ok: true, tradeId, txHash };
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
  }>("/trade/offer", async (request, reply) => {
    const { tradeId, buyerAddress, bidPrice } = request.body;

    if (!buyerAddress || !/^0x[a-fA-F0-9]{40}$/.test(buyerAddress)) {
      reply.code(400);
      return { error: "Invalid buyer address" };
    }

    if (bidPrice <= 0) {
      reply.code(400);
      return { error: "Bid price must be positive" };
    }

    try {
      const onChainGold = parseFloat(await getGoldBalance(buyerAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = getAvailableGold(buyerAddress, safeOnChainGold);
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
        // Trade matched — mint item to buyer on the main SKALE chain
        const mintTx = await mintItem(
          buyerAddress,
          BigInt(result.tokenId),
          BigInt(result.quantity)
        );
        const settledPrice = result.askPrice;
        recordGoldSpend(buyerAddress, settledPrice);
        server.log.info(
          `Trade ${tradeId} matched! Item minted to buyer: ${mintTx}`
        );

        return {
          ok: true,
          matched: true,
          tradeId,
          askPrice: result.askPrice,
          bidPrice: result.bidPrice,
          settledPrice,
          remainingGold: formatGold(
            getAvailableGold(buyerAddress, safeOnChainGold)
          ),
          itemTx: mintTx,
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
    async (request, reply) => {
      const { tradeId } = request.body;

      try {
        const txHash = await cancelTradeOnChain(tradeId);
        server.log.info(`Trade ${tradeId} cancelled: ${txHash}`);
        return { ok: true, tradeId, txHash };
      } catch (err) {
        server.log.error(err, `Failed to cancel trade ${tradeId}`);
        reply.code(500);
        return { error: "Failed to cancel trade" };
      }
    }
  );
}
