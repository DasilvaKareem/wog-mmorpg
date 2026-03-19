import type { FastifyInstance } from "fastify";
import { authenticateRequest, getAuthenticatedWallet } from "../auth/auth.js";
import {
  createRentalListing,
  getRentalListing,
  getActiveRentalListings,
  cancelRentalListing,
  createRentalGrant,
  getRentalGrant,
  getActiveGrantsForRenter,
  renewRentalGrant,
  expireRentalGrants,
  enrichRentalListing,
  enrichRentalGrant,
} from "./rentService.js";
import { canListItem } from "./assetPortability.js";
import {
  createOperation,
  updateOperationStatus,
  OperationStatus,
} from "./operationRegistry.js";
import { handleMppCharge } from "./marketplacePayments.js";
import { activateCharacterRental, getRentalEntityRecord } from "./characterRentalService.js";
import { addEntityToParty } from "../social/partySystem.js";
import { isWalletSpawned } from "../world/zoneRuntime.js";

// ── Constants ───────────────────────────────────────────────────────

const RENTAL_EXPIRY_TICK_MS = 30_000;

// ── Route Registration ──────────────────────────────────────────────

export function registerRentalRoutes(server: FastifyInstance) {
  // ── POST /rentals/listings ────────────────────────────────────────
  server.post<{
    Body: {
      wallet: string;
      assetType: "item" | "character";
      tokenId: number;
      instanceId?: string;
      durationSeconds: number;
      priceUsdCents: number;
      renewable?: boolean;
      maxRentals?: number;
    };
  }>(
    "/rentals/listings",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const {
        wallet, assetType, tokenId, instanceId,
        durationSeconds, priceUsdCents, renewable, maxRentals,
      } = request.body;

      if (!authWallet || authWallet.toLowerCase() !== wallet?.toLowerCase()) {
        return reply.code(403).send({ error: "Wallet mismatch" });
      }

      if (tokenId == null || !durationSeconds || durationSeconds <= 0 || !priceUsdCents || priceUsdCents <= 0) {
        return reply.code(400).send({ error: "tokenId, durationSeconds, and priceUsdCents required" });
      }

      // For items, validate ownership (but don't burn — usage rights only)
      if (assetType === "item") {
        const portability = await canListItem({ wallet, tokenId, quantity: 1, instanceId });
        if (!portability.allowed) {
          return reply.code(400).send({ error: portability.reason });
        }
      }

      const listing = await createRentalListing({
        ownerWallet: wallet,
        assetType,
        tokenId,
        instanceId,
        durationSeconds,
        priceUsdCents,
        renewable: renewable ?? false,
        maxRentals,
      });

      return reply.send({ ok: true, rentalId: listing.rentalId, listing: enrichRentalListing(listing) });
    }
  );

  // ── GET /rentals/listings ─────────────────────────────────────────
  server.get("/rentals/listings", async () => {
    const listings = await getActiveRentalListings();
    return {
      total: listings.length,
      listings: listings.map(enrichRentalListing),
    };
  });

  // ── GET /rentals/listings/:rentalId ───────────────────────────────
  server.get<{ Params: { rentalId: string } }>(
    "/rentals/listings/:rentalId",
    async (request, reply) => {
      const listing = await getRentalListing(request.params.rentalId);
      if (!listing) return reply.code(404).send({ error: "Rental listing not found" });
      return enrichRentalListing(listing);
    }
  );

  // ── POST /rentals/listings/:rentalId/rent ─────────────────────────
  // MPP 402 flow: pay to rent
  server.post<{
    Params: { rentalId: string };
    Body: { wallet: string; usageMode?: string };
  }>(
    "/rentals/listings/:rentalId/rent",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const { wallet, usageMode } = request.body;
      const { rentalId } = request.params;

      if (!authWallet || authWallet.toLowerCase() !== wallet?.toLowerCase()) {
        return reply.code(403).send({ error: "Wallet mismatch" });
      }

      const listing = await getRentalListing(rentalId);
      if (!listing) return reply.code(404).send({ error: "Rental listing not found" });
      if (listing.status !== "active") {
        return reply.code(400).send({ error: `Listing is ${listing.status}` });
      }
      if (listing.ownerWallet === wallet.toLowerCase()) {
        return reply.code(400).send({ error: "Cannot rent your own asset" });
      }
      if (listing.maxRentals > 0 && listing.activeRentals >= listing.maxRentals) {
        return reply.code(400).send({ error: "Maximum concurrent rentals reached" });
      }

      // MPP charge
      const chargeResult = await handleMppCharge({
        req: request.raw,
        res: reply.raw,
        amountCents: listing.priceUsdCents,
        operationId: `rent-${rentalId}-${wallet}`,
        description: `WoG rental: ${rentalId}`,
      });

      if (chargeResult.status === 402) return; // 402 written

      // Payment confirmed — create operation + grant
      const op = await createOperation({
        operationType: "rental",
        assetType: listing.assetType,
        sourceChain: "skale",
        sourceContract: process.env.ITEMS_CONTRACT_ADDRESS ?? "",
        sourceTokenId: listing.tokenId,
        quantity: 1,
        instanceId: listing.instanceId,
        ownerWallet: listing.ownerWallet,
        buyerWallet: wallet,
        paymentRail: "tempo_mpp",
        paymentReference: chargeResult.receipt.receiptId,
        rentalId,
        status: OperationStatus.PAYMENT_CONFIRMED,
      });

      const grant = await createRentalGrant({
        rentalId,
        renterWallet: wallet,
        ownerWallet: listing.ownerWallet,
        assetType: listing.assetType,
        tokenId: listing.tokenId,
        instanceId: listing.instanceId,
        durationSeconds: listing.durationSeconds,
        usageMode: (usageMode as any) ?? "equip",
        operationId: op.operationId,
      });

      await updateOperationStatus(op.operationId, OperationStatus.RENTAL_ACTIVE, {
        grantId: grant.grantId,
      });

      return reply.send({
        ok: true,
        operationId: op.operationId,
        grantId: grant.grantId,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
      });
    }
  );

  // ── POST /rentals/grants/:grantId/activate ─────────────────────────
  // Spawn the rented character into the renter's zone and add to party
  server.post<{
    Params: { grantId: string };
    Body: { wallet: string; entityId: string; zoneId: string };
  }>(
    "/rentals/grants/:grantId/activate",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const { wallet, entityId, zoneId } = request.body;
      const { grantId } = request.params;

      if (!authWallet || authWallet.toLowerCase() !== wallet?.toLowerCase()) {
        return reply.code(403).send({ error: "Wallet mismatch" });
      }

      const grant = await getRentalGrant(grantId);
      if (!grant) return reply.code(404).send({ error: "Grant not found" });
      if (grant.renterWallet !== wallet.toLowerCase()) {
        return reply.code(403).send({ error: "Not your rental" });
      }
      if (grant.status !== "active") {
        return reply.code(400).send({ error: `Grant is ${grant.status}` });
      }
      if (grant.assetType !== "character") {
        return reply.code(400).send({ error: "This grant is not for a character" });
      }

      // Check if already activated
      const existing = await getRentalEntityRecord(grantId);
      if (existing) {
        return reply.send({
          ok: true,
          alreadyActive: true,
          entityId: existing.entityId,
          zoneId: existing.zoneId,
        });
      }

      // Get the rental listing for character name
      const listing = await getRentalListing(grant.rentalId);
      if (!listing) return reply.code(404).send({ error: "Rental listing not found" });

      // We need the character name — stored as part of the listing metadata
      // For characters, instanceId holds the character name
      const characterName = listing.instanceId;
      if (!characterName) {
        return reply.code(400).send({ error: "Character name not found in rental listing" });
      }

      try {
        const record = await activateCharacterRental({
          grantId,
          ownerWallet: grant.ownerWallet,
          renterWallet: wallet,
          characterName,
          renterEntityId: entityId,
          renterZoneId: zoneId,
        });

        // Auto-add to renter's party
        const partyId = addEntityToParty(entityId, record.entityId, zoneId);

        return reply.send({
          ok: true,
          entityId: record.entityId,
          zoneId: record.zoneId,
          characterName: record.characterName,
          partyId,
        });
      } catch (err: any) {
        server.log.error(err, `Failed to activate character rental ${grantId}`);
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  // ── POST /rentals/grants/:grantId/renew ───────────────────────────
  server.post<{
    Params: { grantId: string };
    Body: { wallet: string };
  }>(
    "/rentals/grants/:grantId/renew",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const { wallet } = request.body;
      const { grantId } = request.params;

      if (!authWallet || authWallet.toLowerCase() !== wallet?.toLowerCase()) {
        return reply.code(403).send({ error: "Wallet mismatch" });
      }

      const grant = await getRentalGrant(grantId);
      if (!grant) return reply.code(404).send({ error: "Grant not found" });
      if (grant.renterWallet !== wallet.toLowerCase()) {
        return reply.code(403).send({ error: "Not your rental" });
      }
      if (grant.status !== "active") {
        return reply.code(400).send({ error: `Grant is ${grant.status}` });
      }

      const listing = await getRentalListing(grant.rentalId);
      if (!listing || !listing.renewable) {
        return reply.code(400).send({ error: "This rental is not renewable" });
      }

      // MPP charge for renewal
      const chargeResult = await handleMppCharge({
        req: request.raw,
        res: reply.raw,
        amountCents: listing.priceUsdCents,
        operationId: `renew-${grantId}`,
        description: `WoG rental renewal: ${grantId}`,
      });

      if (chargeResult.status === 402) return;

      const renewed = await renewRentalGrant(grantId);
      if (!renewed) return reply.code(500).send({ error: "Renewal failed" });

      return reply.send({
        ok: true,
        grantId: renewed.grantId,
        endsAt: renewed.endsAt,
        renewCount: renewed.renewCount,
      });
    }
  );

  // ── GET /rentals/my-rentals ───────────────────────────────────────
  server.get(
    "/rentals/my-rentals",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const wallet = getAuthenticatedWallet(request);
      if (!wallet) return reply.code(401).send({ error: "Not authenticated" });

      const grants = await getActiveGrantsForRenter(wallet);
      return { total: grants.length, grants: grants.map(enrichRentalGrant) };
    }
  );

  // ── POST /rentals/listings/:rentalId/cancel ───────────────────────
  server.post<{
    Params: { rentalId: string };
    Body: { wallet: string };
  }>(
    "/rentals/listings/:rentalId/cancel",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = getAuthenticatedWallet(request);
      const { wallet } = request.body;
      const { rentalId } = request.params;

      if (!authWallet || authWallet.toLowerCase() !== wallet?.toLowerCase()) {
        return reply.code(403).send({ error: "Wallet mismatch" });
      }

      const listing = await getRentalListing(rentalId);
      if (!listing) return reply.code(404).send({ error: "Not found" });
      if (listing.ownerWallet !== wallet.toLowerCase()) {
        return reply.code(403).send({ error: "Not your listing" });
      }

      await cancelRentalListing(rentalId);
      return reply.send({ ok: true });
    }
  );

  // ── Rental Expiry Tick ────────────────────────────────────────────
  startRentalExpiryTick(server);
}

// ── Expiry Tick ─────────────────────────────────────────────────────

function startRentalExpiryTick(server: FastifyInstance) {
  server.log.info(
    `Registering rental expiry tick (${RENTAL_EXPIRY_TICK_MS / 1000}s interval)`
  );

  const tickInterval = setInterval(() => {
    rentalExpiryTick(server).catch((err) => {
      server.log.error(err, "Unhandled error in rental expiry tick");
    });
  }, RENTAL_EXPIRY_TICK_MS);

  server.addHook("onClose", async () => {
    clearInterval(tickInterval);
    server.log.info("Rental expiry tick stopped");
  });
}

async function rentalExpiryTick(server: FastifyInstance) {
  try {
    const expired = await expireRentalGrants();
    if (expired.length > 0) {
      server.log.info(`Expired ${expired.length} rental grants`);
    }
  } catch (err) {
    server.log.error(err, "Error in rental expiry tick");
  }
}
