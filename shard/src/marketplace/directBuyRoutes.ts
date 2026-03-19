import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticateRequest, getAuthenticatedWallet } from "../auth/auth.js";
import { burnItem, mintItem } from "../blockchain/blockchain.js";
import { assignItemInstanceOwner } from "../items/itemRng.js";
import { canListItem } from "./assetPortability.js";
import {
  createListing,
  getListing,
  getRawListing,
  getActiveListings,
  markListingSold,
  markListingCancelled,
  markListingExpired,
  expireStaleListings,
  type DirectListing,
} from "./listingsService.js";
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
import {
  handleMppCharge,
  markPaymentConfirmed,
  ensureIdempotentSettlement,
} from "./marketplacePayments.js";

// ── Constants ───────────────────────────────────────────────────────

const LISTING_EXPIRY_TICK_MS = 30_000; // 30 seconds
const SKALE_CHAIN = "skale";
const SKALE_ITEMS_CONTRACT = process.env.ITEMS_CONTRACT_ADDRESS ?? "";

// ── Route Registration ──────────────────────────────────────────────

export function registerDirectBuyRoutes(server: FastifyInstance) {
  // ── POST /marketplace/direct/listings ─────────────────────────────
  server.post<{
    Body: {
      wallet: string;
      tokenId: number;
      quantity: number;
      instanceId?: string;
      priceUsd: number;
      priceGold?: number;
      durationMs?: number;
    };
  }>(
    "/marketplace/direct/listings",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const { wallet, tokenId, quantity, instanceId, priceUsd, priceGold, durationMs } =
        request.body;

      if (!authWallet || authWallet.toLowerCase() !== wallet?.toLowerCase()) {
        return reply.code(403).send({ error: "Wallet mismatch" });
      }

      if (!tokenId || !quantity || quantity <= 0 || !priceUsd || priceUsd <= 0) {
        return reply
          .code(400)
          .send({ error: "tokenId, quantity, and priceUsd are required" });
      }

      // Portability check
      const portability = await canListItem({
        wallet,
        tokenId,
        quantity,
        instanceId,
      });
      if (!portability.allowed) {
        return reply.code(400).send({ error: portability.reason });
      }

      // Escrow burn
      let escrowBurnTx: string | undefined;
      let escrowedInstanceId: string | undefined;

      try {
        escrowBurnTx = await burnItem(wallet, BigInt(tokenId), BigInt(quantity));

        // Create listing
        const listing = await createListing({
          sellerWallet: wallet,
          tokenId,
          quantity,
          instanceId,
          priceUsd,
          priceGold,
          escrowBurnTx,
          durationMs,
        });

        // Move instance to listing escrow
        if (instanceId) {
          const escrowed = await assignItemInstanceOwner(
            instanceId,
            `listing:${listing.listingId}`
          );
          if (!escrowed) {
            throw new Error(
              `Failed to move instance ${instanceId} into listing escrow`
            );
          }
          escrowedInstanceId = escrowed.instanceId;
        }

        return reply.send({
          ok: true,
          listingId: listing.listingId,
          escrowTx: escrowBurnTx,
        });
      } catch (err: any) {
        server.log.error(err, "Failed to create direct listing");

        // Rollback: restore burned items
        if (escrowBurnTx) {
          try {
            const restoreTx = await mintItem(
              wallet,
              BigInt(tokenId),
              BigInt(quantity)
            );
            server.log.warn(
              `Direct listing creation failed after escrow burn; restored ${quantity}x token ${tokenId} to ${wallet} via ${restoreTx}`
            );
          } catch (restoreErr) {
            server.log.error(
              restoreErr,
              `CRITICAL: failed to restore escrowed listing item tokenId=${tokenId} qty=${quantity} seller=${wallet}`
            );
          }
        }

        // Rollback: restore instance ownership
        if (escrowedInstanceId) {
          try {
            await assignItemInstanceOwner(escrowedInstanceId, wallet);
          } catch (instanceErr) {
            server.log.error(
              instanceErr,
              `CRITICAL: failed to restore listing instance ${escrowedInstanceId} to ${wallet}`
            );
          }
        }

        return reply
          .code(500)
          .send({ error: "Failed to create listing: " + err.message });
      }
    }
  );

  // ── GET /marketplace/direct/listings ──────────────────────────────
  server.get<{
    Querystring: {
      category?: string;
      search?: string;
      sort?: string;
      seller?: string;
      limit?: string;
      offset?: string;
    };
  }>("/marketplace/direct/listings", async (request) => {
    const { category, search, sort, seller, limit, offset } = request.query;
    const listings = await getActiveListings({
      category,
      search,
      sort,
      seller,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return { total: listings.length, listings };
  });

  // ── GET /marketplace/direct/listings/:listingId ───────────────────
  server.get<{ Params: { listingId: string } }>(
    "/marketplace/direct/listings/:listingId",
    async (request, reply) => {
      const listing = await getListing(request.params.listingId);
      if (!listing) {
        return reply.code(404).send({ error: "Listing not found" });
      }
      return listing;
    }
  );

  // ── POST /marketplace/direct/listings/:listingId/buy ──────────────
  //
  // MPP 402 flow: first call returns 402 + WWW-Authenticate challenge.
  // Client pays via Tempo, then replays the same request with the
  // payment credential header. Second call settles the purchase.
  //
  server.post<{
    Params: { listingId: string };
    Body: { wallet: string };
  }>(
    "/marketplace/direct/listings/:listingId/buy",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const { wallet } = request.body;
      const { listingId } = request.params;

      if (!authWallet || authWallet.toLowerCase() !== wallet?.toLowerCase()) {
        return reply.code(403).send({ error: "Wallet mismatch" });
      }

      // Load listing
      const listing = await getRawListing(listingId);
      if (!listing) {
        return reply.code(404).send({ error: "Listing not found" });
      }
      if (listing.status !== "active") {
        return reply
          .code(400)
          .send({ error: `Listing is ${listing.status}, not active` });
      }
      if (listing.sellerWallet === wallet.toLowerCase()) {
        return reply
          .code(400)
          .send({ error: "Cannot buy your own listing" });
      }

      // Idempotency: check for existing settled operation
      const existingOp = await findOperationByKey(
        "direct_sale",
        listing.sellerWallet,
        wallet,
        listing.tokenId,
        listingId
      );
      if (existingOp?.status === OperationStatus.SOLD) {
        return reply.send({
          ok: true,
          operationId: existingOp.operationId,
          status: "sold",
        });
      }

      // Run MPP 402 charge flow against the raw Node request.
      // First call (no credential) → 402 challenge written to response.
      // Second call (with credential) → 200 + receipt.
      const chargeResult = await handleMppCharge({
        req: request.raw,
        res: reply.raw,
        amountCents: listing.priceUsd,
        operationId: existingOp?.operationId ?? listingId,
        description: `WoG Marketplace: buy listing ${listingId}`,
      });

      if (chargeResult.status === 402) {
        // 402 response already written by mppx toNodeListener
        return;
      }

      // Payment verified — settle the purchase
      const { receipt } = chargeResult;

      // Create or reuse operation
      let op = existingOp;
      if (!op) {
        op = await createOperation({
          operationType: "direct_sale",
          assetType: "item",
          sourceChain: SKALE_CHAIN,
          sourceContract: SKALE_ITEMS_CONTRACT,
          sourceTokenId: listing.tokenId,
          quantity: listing.quantity,
          instanceId: listing.instanceId,
          ownerWallet: listing.sellerWallet,
          buyerWallet: wallet,
          paymentRail: "tempo_mpp",
          listingId,
          status: OperationStatus.PAYMENT_CONFIRMED,
        });
      } else {
        await markPaymentConfirmed(op.operationId, receipt);
      }

      return await settlePurchase(server, op, listing, wallet, reply);
    }
  );

  // ── POST /marketplace/direct/listings/:listingId/cancel ───────────
  server.post<{
    Params: { listingId: string };
    Body: { wallet: string };
  }>(
    "/marketplace/direct/listings/:listingId/cancel",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const { wallet } = request.body;
      const { listingId } = request.params;

      if (!authWallet || authWallet.toLowerCase() !== wallet?.toLowerCase()) {
        return reply.code(403).send({ error: "Wallet mismatch" });
      }

      const listing = await getRawListing(listingId);
      if (!listing) {
        return reply.code(404).send({ error: "Listing not found" });
      }
      if (listing.sellerWallet !== wallet.toLowerCase()) {
        return reply
          .code(403)
          .send({ error: "Only the seller can cancel this listing" });
      }
      if (listing.status !== "active") {
        return reply
          .code(400)
          .send({ error: `Listing is ${listing.status}, cannot cancel` });
      }

      try {
        // Return escrowed item to seller
        const restoreTx = await mintItem(
          wallet,
          BigInt(listing.tokenId),
          BigInt(listing.quantity)
        );

        // Restore instance ownership
        if (listing.instanceId) {
          await assignItemInstanceOwner(listing.instanceId, wallet);
        }

        await markListingCancelled(listingId);

        return reply.send({
          ok: true,
          listingId,
          restoreTx,
        });
      } catch (err: any) {
        server.log.error(err, `Failed to cancel listing ${listingId}`);
        return reply
          .code(500)
          .send({ error: "Failed to cancel listing: " + err.message });
      }
    }
  );

  // ── GET /marketplace/direct/purchases/:operationId ────────────────
  server.get<{ Params: { operationId: string } }>(
    "/marketplace/direct/purchases/:operationId",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const op = await getOperation(request.params.operationId);

      if (!op) {
        return reply.code(404).send({ error: "Operation not found" });
      }

      // Only buyer or seller can view
      if (
        authWallet?.toLowerCase() !== op.ownerWallet.toLowerCase() &&
        authWallet?.toLowerCase() !== op.buyerWallet?.toLowerCase()
      ) {
        return reply.code(403).send({ error: "Not authorized" });
      }

      return op;
    }
  );

  // ── Listing Expiry Tick ───────────────────────────────────────────
  startListingExpiryTick(server);
}

// ── Settlement Helper ───────────────────────────────────────────────

async function settlePurchase(
  server: FastifyInstance,
  op: Operation,
  listing: DirectListing,
  buyerWallet: string,
  reply: FastifyReply
) {
  // Idempotency: already settled?
  if (await ensureIdempotentSettlement(op.operationId)) {
    return reply.send({
      ok: true,
      operationId: op.operationId,
      status: "sold",
    });
  }

  const locked = await acquireOperationLock(op.operationId);
  if (!locked) {
    return reply
      .code(409)
      .send({ error: "Settlement in progress, please retry" });
  }

  try {
    // Mint item to buyer
    const mintTx = await mintItem(
      buyerWallet,
      BigInt(listing.tokenId),
      BigInt(listing.quantity)
    );

    // Transfer instance ownership to buyer
    if (listing.instanceId) {
      await assignItemInstanceOwner(listing.instanceId, buyerWallet);
    }

    // Mark listing as sold
    await markListingSold(listing.listingId, op.operationId);

    // Update operation to SOLD
    await updateOperationStatus(op.operationId, OperationStatus.SOLD, {
      targetTxHash: mintTx,
      buyerWallet,
    });

    return reply.send({
      ok: true,
      operationId: op.operationId,
      status: "sold",
      mintTx,
    });
  } catch (err: any) {
    server.log.error(
      err,
      `Failed to settle purchase for operation ${op.operationId}`
    );
    await updateOperationStatus(op.operationId, OperationStatus.FAILED, {
      failureReason: err.message,
    });
    return reply
      .code(500)
      .send({ error: "Settlement failed: " + err.message });
  } finally {
    await releaseOperationLock(op.operationId);
  }
}

// ── Listing Expiry Tick ─────────────────────────────────────────────

function startListingExpiryTick(server: FastifyInstance) {
  server.log.info(
    `Registering listing expiry tick (${LISTING_EXPIRY_TICK_MS / 1000}s interval)`
  );

  const tickInterval = setInterval(() => {
    listingExpiryTick(server).catch((err) => {
      server.log.error(err, "Unhandled error in listing expiry tick");
    });
  }, LISTING_EXPIRY_TICK_MS);

  server.addHook("onClose", async () => {
    clearInterval(tickInterval);
    server.log.info("Listing expiry tick stopped");
  });
}

async function listingExpiryTick(server: FastifyInstance) {
  try {
    const expiredIds = await expireStaleListings();
    for (const listingId of expiredIds) {
      try {
        const listing = await getRawListing(listingId);
        if (!listing || listing.status !== "active") continue;

        // Return escrowed item to seller
        const restoreTx = await mintItem(
          listing.sellerWallet,
          BigInt(listing.tokenId),
          BigInt(listing.quantity)
        );
        server.log.info(
          `Expired listing ${listingId}: restored ${listing.quantity}x token ${listing.tokenId} to ${listing.sellerWallet} via ${restoreTx}`
        );

        // Restore instance ownership
        if (listing.instanceId) {
          await assignItemInstanceOwner(
            listing.instanceId,
            listing.sellerWallet
          );
        }

        await markListingExpired(listingId);
      } catch (err) {
        server.log.error(
          err,
          `Error processing expired listing ${listingId}`
        );
      }
    }
  } catch (err) {
    server.log.error(err, "Error in listing expiry tick");
  }
}
