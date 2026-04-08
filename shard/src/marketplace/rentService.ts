/**
 * Rental service — Model A: usage rights only.
 *
 * Owner keeps NFT ownership. Renter gets time-limited server-authorized
 * usage rights. No on-chain transfer. Backend is authoritative.
 *
 * Redis stores:
 *  - rental listings (what's available for rent)
 *  - rental grants (active authorizations)
 *
 * The expiry tick cleans up expired grants.
 */

import { randomUUID } from "crypto";
import { getRedis } from "../redis.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { getAllEntities, recalculateEntityVitals } from "../world/zoneRuntime.js";
import { saveCharacter } from "../character/characterStore.js";
import {
  getActiveRentalGrantForToken,
  getRentalGrantProjection,
  getRentalListingProjection,
  listActiveRentalGrantsForRenter,
  listActiveRentalListingsProjection,
  listExpiredActiveRentalGrantIds,
  upsertRentalGrant,
  upsertRentalListing,
} from "../db/rentalStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

// ── Interfaces ──────────────────────────────────────────────────────

export interface RentalListing {
  rentalId: string;
  ownerWallet: string;
  assetType: "item" | "character";
  tokenId: number;
  instanceId?: string;
  durationSeconds: number;
  priceUsdCents: number;
  renewable: boolean;
  maxRentals: number;       // 0 = unlimited
  activeRentals: number;
  status: "active" | "paused" | "cancelled";
  createdAt: number;
  expiresAt?: number;       // optional listing expiry
}

export interface RentalGrant {
  grantId: string;
  rentalId: string;
  renterWallet: string;
  ownerWallet: string;
  assetType: "item" | "character";
  tokenId: number;
  instanceId?: string;
  startsAt: number;
  endsAt: number;
  usageMode: "equip" | "deploy" | "access" | "full";
  status: "active" | "expired" | "cancelled" | "renewed";
  operationId?: string;
  renewCount: number;
}

// ── Redis Key Helpers ───────────────────────────────────────────────

const KEY_RENTAL = (id: string) => `mktplace:rental:${id}`;
const KEY_RENTALS_ACTIVE = "mktplace:rentals:active";
const KEY_RENTALS_OWNER = (w: string) => `mktplace:rentals:owner:${w.toLowerCase()}`;

const KEY_GRANT = (id: string) => `mktplace:grant:${id}`;
const KEY_GRANTS_ACTIVE = "mktplace:grants:active";
const KEY_GRANTS_RENTER = (w: string) => `mktplace:grants:renter:${w.toLowerCase()}`;
const KEY_GRANTS_TOKEN = (tokenId: number) => `mktplace:grants:token:${tokenId}`;

// ── Rental Listing CRUD ─────────────────────────────────────────────

export type CreateRentalParams = Pick<
  RentalListing,
  | "ownerWallet"
  | "assetType"
  | "tokenId"
  | "instanceId"
  | "durationSeconds"
  | "priceUsdCents"
  | "renewable"
> & { maxRentals?: number };

export async function createRentalListing(
  params: CreateRentalParams
): Promise<RentalListing> {
  const now = Date.now();
  const listing: RentalListing = {
    rentalId: randomUUID(),
    ownerWallet: params.ownerWallet.toLowerCase(),
    assetType: params.assetType,
    tokenId: params.tokenId,
    instanceId: params.instanceId,
    durationSeconds: params.durationSeconds,
    priceUsdCents: params.priceUsdCents,
    renewable: params.renewable,
    maxRentals: params.maxRentals ?? 0,
    activeRentals: 0,
    status: "active",
    createdAt: now,
  };

  if (isPostgresConfigured()) {
    await upsertRentalListing(listing);
  }
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.multi();
    pipeline.set(KEY_RENTAL(listing.rentalId), JSON.stringify(listing));
    pipeline.zadd(KEY_RENTALS_ACTIVE, now, listing.rentalId);
    pipeline.sadd(KEY_RENTALS_OWNER(listing.ownerWallet), listing.rentalId);
    await pipeline.exec();
  }

  return listing;
}

export async function getRentalListing(
  rentalId: string
): Promise<RentalListing | null> {
  if (isPostgresConfigured()) {
    const listing = await getRentalListingProjection(rentalId);
    if (listing) return listing;
  }
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(KEY_RENTAL(rentalId));
  return raw ? (JSON.parse(raw) as RentalListing) : null;
}

export async function getActiveRentalListings(): Promise<RentalListing[]> {
  if (isPostgresConfigured()) {
    const listings = await listActiveRentalListingsProjection();
    if (listings.length > 0) return listings;
  }
  const redis = getRedis();
  if (!redis) return [];

  const ids: string[] = await redis.zrangebyscore(KEY_RENTALS_ACTIVE, "-inf", "+inf");
  if (!ids.length) return [];

  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(KEY_RENTAL(id));
  const results = await pipeline.exec();

  const listings: RentalListing[] = [];
  for (const [err, raw] of results) {
    if (!err && raw) {
      const listing = JSON.parse(raw as string) as RentalListing;
      if (listing.status === "active") listings.push(listing);
    }
  }
  return listings;
}

export async function cancelRentalListing(
  rentalId: string
): Promise<RentalListing | null> {
  const listing = await getRentalListing(rentalId);
  if (!listing) return null;

  listing.status = "cancelled";
  if (isPostgresConfigured()) {
    await upsertRentalListing(listing);
  }

  const redis = getRedis();
  if (redis) {
    const pipeline = redis.multi();
    pipeline.set(KEY_RENTAL(rentalId), JSON.stringify(listing));
    pipeline.zrem(KEY_RENTALS_ACTIVE, rentalId);
    await pipeline.exec();
  }

  return listing;
}

// ── Rental Grant CRUD ───────────────────────────────────────────────

export async function createRentalGrant(params: {
  rentalId: string;
  renterWallet: string;
  ownerWallet: string;
  assetType: "item" | "character";
  tokenId: number;
  instanceId?: string;
  durationSeconds: number;
  usageMode: "equip" | "deploy" | "access" | "full";
  operationId?: string;
}): Promise<RentalGrant> {
  const now = Date.now();
  const grant: RentalGrant = {
    grantId: randomUUID(),
    rentalId: params.rentalId,
    renterWallet: params.renterWallet.toLowerCase(),
    ownerWallet: params.ownerWallet.toLowerCase(),
    assetType: params.assetType,
    tokenId: params.tokenId,
    instanceId: params.instanceId,
    startsAt: now,
    endsAt: now + params.durationSeconds * 1000,
    usageMode: params.usageMode,
    status: "active",
    operationId: params.operationId,
    renewCount: 0,
  };

  if (isPostgresConfigured()) {
    await upsertRentalGrant(grant);
  }
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.multi();
    pipeline.set(KEY_GRANT(grant.grantId), JSON.stringify(grant));
    pipeline.zadd(KEY_GRANTS_ACTIVE, grant.endsAt, grant.grantId);
    pipeline.sadd(KEY_GRANTS_RENTER(grant.renterWallet), grant.grantId);
    pipeline.sadd(KEY_GRANTS_TOKEN(grant.tokenId), grant.grantId);
    await pipeline.exec();
  }

  // Increment active rentals on listing
  const listing = await getRentalListing(params.rentalId);
  if (listing) {
    listing.activeRentals++;
    if (isPostgresConfigured()) {
      await upsertRentalListing(listing);
    }
    if (redis) {
      await redis.set(KEY_RENTAL(params.rentalId), JSON.stringify(listing));
    }
  }

  return grant;
}

export async function getRentalGrant(
  grantId: string
): Promise<RentalGrant | null> {
  if (isPostgresConfigured()) {
    const grant = await getRentalGrantProjection(grantId);
    if (grant) return grant;
  }
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(KEY_GRANT(grantId));
  return raw ? (JSON.parse(raw) as RentalGrant) : null;
}

export async function getActiveGrantsForRenter(
  wallet: string
): Promise<RentalGrant[]> {
  if (isPostgresConfigured()) {
    const grants = await listActiveRentalGrantsForRenter(wallet, Date.now());
    if (grants.length > 0) return grants;
  }
  const redis = getRedis();
  if (!redis) return [];

  const ids: string[] = await redis.smembers(KEY_GRANTS_RENTER(wallet.toLowerCase()));
  if (!ids.length) return [];

  const now = Date.now();
  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(KEY_GRANT(id));
  const results = await pipeline.exec();

  const grants: RentalGrant[] = [];
  for (const [err, raw] of results) {
    if (!err && raw) {
      const grant = JSON.parse(raw as string) as RentalGrant;
      if (grant.status === "active" && grant.endsAt > now) grants.push(grant);
    }
  }
  return grants;
}

/**
 * Check if a wallet has an active rental grant for a given token.
 * Called by gameplay systems to authorize rented asset usage.
 */
export async function hasActiveRentalRight(
  wallet: string,
  tokenId: number
): Promise<RentalGrant | null> {
  if (isPostgresConfigured()) {
    const grant = await getActiveRentalGrantForToken(wallet, tokenId, Date.now());
    if (grant) return grant;
  }
  const redis = getRedis();
  if (!redis) return null;

  const grantIds: string[] = await redis.smembers(KEY_GRANTS_TOKEN(tokenId));
  if (!grantIds.length) return null;

  const now = Date.now();
  const pipeline = redis.multi();
  for (const id of grantIds) pipeline.get(KEY_GRANT(id));
  const results = await pipeline.exec();

  for (const [err, raw] of results) {
    if (err || !raw) continue;
    const grant = JSON.parse(raw as string) as RentalGrant;
    if (
      grant.renterWallet === wallet.toLowerCase() &&
      grant.status === "active" &&
      grant.endsAt > now
    ) {
      return grant;
    }
  }
  return null;
}

/**
 * Renew an existing grant by extending its end time.
 * Requires the grant to be active and the listing to allow renewals.
 */
export async function renewRentalGrant(
  grantId: string
): Promise<RentalGrant | null> {
  const grant = await getRentalGrant(grantId);
  if (!grant || grant.status !== "active") return null;

  const listing = await getRentalListing(grant.rentalId);
  if (!listing || !listing.renewable) return null;

  const now = Date.now();
  // Extend from current end or now, whichever is later
  const extendFrom = Math.max(grant.endsAt, now);
  grant.endsAt = extendFrom + listing.durationSeconds * 1000;
  grant.renewCount++;

  if (isPostgresConfigured()) {
    await upsertRentalGrant(grant);
  }
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.multi();
    pipeline.set(KEY_GRANT(grantId), JSON.stringify(grant));
    pipeline.zadd(KEY_GRANTS_ACTIVE, grant.endsAt, grantId);
    await pipeline.exec();
  }

  return grant;
}

/**
 * Expire grants that have passed their end time.
 * Called by the expiry tick.
 */
export async function expireRentalGrants(): Promise<string[]> {
  const now = Date.now();
  const redis = getRedis();
  const expiredIds: string[] = isPostgresConfigured()
    ? await listExpiredActiveRentalGrantIds(now)
    : redis
      ? await redis.zrangebyscore(KEY_GRANTS_ACTIVE, "-inf", now.toString())
      : [];
  if (!expiredIds.length) return [];

  const expired: string[] = [];
  for (const grantId of expiredIds) {
    const grant = await getRentalGrant(grantId);
    if (!grant || grant.status !== "active") {
      if (redis) {
        await redis.zrem(KEY_GRANTS_ACTIVE, grantId);
      }
      continue;
    }

    grant.status = "expired";
    if (isPostgresConfigured()) {
      await upsertRentalGrant(grant);
    }
    if (redis) {
      const pipeline = redis.multi();
      pipeline.set(KEY_GRANT(grantId), JSON.stringify(grant));
      pipeline.zrem(KEY_GRANTS_ACTIVE, grantId);
      await pipeline.exec();
    }

    if (grant.assetType === "character") {
      // Deactivate character rental: save progress, despawn, remove from party
      const { deactivateCharacterRental } = await import("./characterRentalService.js");
      await deactivateCharacterRental(grantId);
    } else {
      // Force-unequip the rented item from any live entity using it
      forceUnequipRentedItem(grant.renterWallet, grant.tokenId);
    }

    // Decrement active rentals on listing
    const listing = await getRentalListing(grant.rentalId);
    if (listing && listing.activeRentals > 0) {
      listing.activeRentals--;
      if (isPostgresConfigured()) {
        await upsertRentalListing(listing);
      }
      if (redis) {
        await redis.set(KEY_RENTAL(grant.rentalId), JSON.stringify(listing));
      }
    }

    expired.push(grantId);
  }

  return expired;
}

// ── Force Unequip on Expiry ──────────────────────────────────────────

/**
 * Remove a rented item from all live entities belonging to the renter.
 * Called when a rental grant expires.
 */
function forceUnequipRentedItem(renterWallet: string, tokenId: number): void {
  const wallet = renterWallet.toLowerCase();
  for (const entity of getAllEntities().values()) {
    if (entity.walletAddress?.toLowerCase() !== wallet) continue;
    if (!entity.equipment) continue;

    let changed = false;
    for (const [slot, equipped] of Object.entries(entity.equipment)) {
      if (equipped && (equipped as any).tokenId === tokenId) {
        delete (entity.equipment as any)[slot];
        changed = true;
      }
    }

    if (changed) {
      recalculateEntityVitals(entity);
      // Persist the unequip
      saveCharacter(entity.walletAddress, entity.name, {
        equipment: entity.equipment ?? {},
      }).catch(() => {});
    }
  }
}

// ── Enrichment ──────────────────────────────────────────────────────

export function enrichRentalListing(listing: RentalListing) {
  const item = getItemByTokenId(BigInt(listing.tokenId));
  return {
    ...listing,
    itemName: item?.name ?? "Unknown",
    itemDescription: item?.description ?? "",
    itemCategory: item?.category ?? "unknown",
    priceUsd: listing.priceUsdCents,
    durationHours: Math.round(listing.durationSeconds / 3600),
  };
}

export function enrichRentalGrant(grant: RentalGrant) {
  const item = getItemByTokenId(BigInt(grant.tokenId));
  const now = Date.now();
  const timeLeftMs = Math.max(0, grant.endsAt - now);
  const timeLeftSeconds = Math.floor(timeLeftMs / 1000);
  const timeLeftMinutes = Math.floor(timeLeftSeconds / 60);
  const timeLeftHours = Math.floor(timeLeftMinutes / 60);

  let timeLeftDisplay: string;
  if (timeLeftSeconds <= 0) timeLeftDisplay = "Expired";
  else if (timeLeftHours > 24) timeLeftDisplay = `${Math.floor(timeLeftHours / 24)}d ${timeLeftHours % 24}h`;
  else if (timeLeftHours > 0) timeLeftDisplay = `${timeLeftHours}h ${timeLeftMinutes % 60}m`;
  else if (timeLeftMinutes > 0) timeLeftDisplay = `${timeLeftMinutes}m`;
  else timeLeftDisplay = `${timeLeftSeconds}s`;

  return {
    ...grant,
    itemName: item?.name ?? "Unknown",
    itemCategory: item?.category ?? "unknown",
    timeLeftMs,
    timeLeftSeconds,
    timeLeftDisplay,
    isExpiringSoon: timeLeftMs > 0 && timeLeftMs < 30 * 60 * 1000, // < 30 min
  };
}
