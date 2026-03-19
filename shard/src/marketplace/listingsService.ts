import { randomUUID } from "crypto";
import { getRedis } from "../redis.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { getWalletInstanceByToken } from "../items/itemRng.js";

// ── Interfaces ──────────────────────────────────────────────────────

export interface DirectListing {
  listingId: string;
  sellerWallet: string;
  assetType: "item";
  tokenId: number;
  quantity: number;
  instanceId?: string;
  priceUsd: number;       // cents
  priceGold?: number;     // optional in-game price
  status: "active" | "sold" | "cancelled" | "expired";
  operationId?: string;   // linked on purchase
  escrowBurnTx?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ListingFilter {
  category?: string;
  search?: string;
  sort?: string;
  seller?: string;
  limit?: number;
  offset?: number;
}

// ── Redis Key Helpers ───────────────────────────────────────────────

const KEY_LISTING = (id: string) => `mktplace:listing:${id}`;
const KEY_ACTIVE = "mktplace:listings:active";
const KEY_SELLER = (w: string) => `mktplace:listings:seller:${w.toLowerCase()}`;

const DEFAULT_LISTING_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Enrichment ──────────────────────────────────────────────────────

function enrichListing(listing: DirectListing) {
  const item = getItemByTokenId(BigInt(listing.tokenId));
  const instance = listing.instanceId
    ? getWalletInstanceByToken(
        listing.sellerWallet,
        listing.tokenId,
        listing.instanceId
      ) ?? // Instance may be in escrow under listing:{id}
      getWalletInstanceByToken(
        `listing:${listing.listingId}`,
        listing.tokenId,
        listing.instanceId
      )
    : undefined;

  return {
    ...listing,
    itemName: instance?.displayName ?? item?.name ?? "Unknown Item",
    itemDescription: item?.description ?? "",
    itemCategory: item?.category ?? "unknown",
    equipSlot: item?.equipSlot ?? null,
    armorSlot: item?.armorSlot ?? null,
    statBonuses: instance?.rolledStats ?? item?.statBonuses ?? {},
    bonusAffix: instance?.bonusAffix ?? null,
    quality: instance?.quality?.tier ?? null,
    durability: instance?.currentDurability ?? null,
    maxDurability:
      instance?.currentMaxDurability ?? item?.maxDurability ?? null,
  };
}

// ── Public API ──────────────────────────────────────────────────────

export type CreateListingParams = Pick<
  DirectListing,
  | "sellerWallet"
  | "tokenId"
  | "quantity"
  | "instanceId"
  | "priceUsd"
  | "priceGold"
  | "escrowBurnTx"
> & { durationMs?: number };

export async function createListing(
  params: CreateListingParams
): Promise<DirectListing> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis unavailable – cannot create listing");

  const now = Date.now();
  const listing: DirectListing = {
    listingId: randomUUID(),
    sellerWallet: params.sellerWallet.toLowerCase(),
    assetType: "item",
    tokenId: params.tokenId,
    quantity: params.quantity,
    instanceId: params.instanceId,
    priceUsd: params.priceUsd,
    priceGold: params.priceGold,
    escrowBurnTx: params.escrowBurnTx,
    status: "active",
    createdAt: now,
    expiresAt: now + (params.durationMs ?? DEFAULT_LISTING_DURATION_MS),
  };

  const pipeline = redis.multi();
  pipeline.set(KEY_LISTING(listing.listingId), JSON.stringify(listing));
  pipeline.zadd(KEY_ACTIVE, now, listing.listingId);
  pipeline.sadd(KEY_SELLER(listing.sellerWallet), listing.listingId);
  await pipeline.exec();

  return listing;
}

export async function getListing(
  listingId: string
): Promise<(DirectListing & Record<string, unknown>) | null> {
  const redis = getRedis();
  if (!redis) return null;

  const raw = await redis.get(KEY_LISTING(listingId));
  if (!raw) return null;

  const listing = JSON.parse(raw) as DirectListing;
  return enrichListing(listing);
}

export async function getRawListing(
  listingId: string
): Promise<DirectListing | null> {
  const redis = getRedis();
  if (!redis) return null;

  const raw = await redis.get(KEY_LISTING(listingId));
  return raw ? (JSON.parse(raw) as DirectListing) : null;
}

export async function getActiveListings(
  filter?: ListingFilter
): Promise<Array<DirectListing & Record<string, unknown>>> {
  const redis = getRedis();
  if (!redis) return [];

  const ids: string[] = await redis.zrangebyscore(KEY_ACTIVE, "-inf", "+inf");
  if (!ids.length) return [];

  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(KEY_LISTING(id));
  const results = await pipeline.exec();

  let listings: Array<DirectListing & Record<string, unknown>> = [];
  for (const [err, raw] of results) {
    if (!err && raw) {
      const listing = JSON.parse(raw as string) as DirectListing;
      listings.push(enrichListing(listing));
    }
  }

  // Apply filters
  if (filter?.category && filter.category !== "all") {
    listings = listings.filter(
      (l) => (l as any).itemCategory === filter.category
    );
  }
  if (filter?.search) {
    const lower = filter.search.toLowerCase();
    listings = listings.filter(
      (l) =>
        String((l as any).itemName ?? "")
          .toLowerCase()
          .includes(lower) ||
        String((l as any).itemDescription ?? "")
          .toLowerCase()
          .includes(lower)
    );
  }
  if (filter?.seller) {
    const lowerSeller = filter.seller.toLowerCase();
    listings = listings.filter((l) => l.sellerWallet === lowerSeller);
  }

  // Sort
  if (filter?.sort === "price-asc") {
    listings.sort((a, b) => a.priceUsd - b.priceUsd);
  } else if (filter?.sort === "price-desc") {
    listings.sort((a, b) => b.priceUsd - a.priceUsd);
  } else if (filter?.sort === "newest") {
    listings.sort((a, b) => b.createdAt - a.createdAt);
  } else {
    // Default: newest first
    listings.sort((a, b) => b.createdAt - a.createdAt);
  }

  // Pagination
  const offset = filter?.offset ?? 0;
  const limit = filter?.limit ?? 50;
  listings = listings.slice(offset, offset + limit);

  return listings;
}

export async function getSellerListings(
  wallet: string
): Promise<Array<DirectListing & Record<string, unknown>>> {
  const redis = getRedis();
  if (!redis) return [];

  const ids: string[] = await redis.smembers(KEY_SELLER(wallet.toLowerCase()));
  if (!ids.length) return [];

  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(KEY_LISTING(id));
  const results = await pipeline.exec();

  const listings: Array<DirectListing & Record<string, unknown>> = [];
  for (const [err, raw] of results) {
    if (!err && raw) {
      const listing = JSON.parse(raw as string) as DirectListing;
      listings.push(enrichListing(listing));
    }
  }
  return listings;
}

export async function markListingSold(
  listingId: string,
  operationId: string
): Promise<DirectListing | null> {
  const redis = getRedis();
  if (!redis) return null;

  const listing = await getRawListing(listingId);
  if (!listing) return null;

  listing.status = "sold";
  listing.operationId = operationId;

  const pipeline = redis.multi();
  pipeline.set(KEY_LISTING(listingId), JSON.stringify(listing));
  pipeline.zrem(KEY_ACTIVE, listingId);
  await pipeline.exec();

  return listing;
}

export async function markListingCancelled(
  listingId: string
): Promise<DirectListing | null> {
  const redis = getRedis();
  if (!redis) return null;

  const listing = await getRawListing(listingId);
  if (!listing) return null;

  listing.status = "cancelled";

  const pipeline = redis.multi();
  pipeline.set(KEY_LISTING(listingId), JSON.stringify(listing));
  pipeline.zrem(KEY_ACTIVE, listingId);
  await pipeline.exec();

  return listing;
}

export async function markListingExpired(
  listingId: string
): Promise<DirectListing | null> {
  const redis = getRedis();
  if (!redis) return null;

  const listing = await getRawListing(listingId);
  if (!listing) return null;

  listing.status = "expired";

  const pipeline = redis.multi();
  pipeline.set(KEY_LISTING(listingId), JSON.stringify(listing));
  pipeline.zrem(KEY_ACTIVE, listingId);
  await pipeline.exec();

  return listing;
}

/**
 * Scan active ZSET for listings whose expiresAt has passed.
 * Returns the IDs of expired listings (does not modify them).
 */
export async function expireStaleListings(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];

  const ids: string[] = await redis.zrangebyscore(KEY_ACTIVE, "-inf", "+inf");
  if (!ids.length) return [];

  const now = Date.now();
  const expired: string[] = [];

  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(KEY_LISTING(id));
  const results = await pipeline.exec();

  for (let i = 0; i < results.length; i++) {
    const [err, raw] = results[i];
    if (err || !raw) continue;
    const listing = JSON.parse(raw as string) as DirectListing;
    if (listing.expiresAt < now) {
      expired.push(listing.listingId);
    }
  }

  return expired;
}
