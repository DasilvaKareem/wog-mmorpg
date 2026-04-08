import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { DirectListing } from "../marketplace/listingsService.js";

interface DirectListingRow {
  listing_id: string;
  seller_wallet: string;
  asset_type: string;
  token_id: number;
  quantity: number;
  instance_id: string | null;
  price_usd: number;
  price_gold: number | null;
  status: string;
  operation_id: string | null;
  escrow_burn_tx: string | null;
  created_at_ms: string;
  expires_at_ms: string;
}

function mapRow(row: DirectListingRow): DirectListing {
  return {
    listingId: row.listing_id,
    sellerWallet: row.seller_wallet,
    assetType: row.asset_type as DirectListing["assetType"],
    tokenId: row.token_id,
    quantity: row.quantity,
    instanceId: row.instance_id ?? undefined,
    priceUsd: row.price_usd,
    priceGold: row.price_gold ?? undefined,
    status: row.status as DirectListing["status"],
    operationId: row.operation_id ?? undefined,
    escrowBurnTx: row.escrow_burn_tx ?? undefined,
    createdAt: Number(row.created_at_ms),
    expiresAt: Number(row.expires_at_ms),
  };
}

export async function upsertDirectListing(listing: DirectListing): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.direct_listings (
      listing_id, seller_wallet, asset_type, token_id, quantity, instance_id,
      price_usd, price_gold, status, operation_id, escrow_burn_tx,
      created_at_ms, expires_at_ms, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, now()
    )
    on conflict (listing_id) do update set
      seller_wallet = excluded.seller_wallet,
      asset_type = excluded.asset_type,
      token_id = excluded.token_id,
      quantity = excluded.quantity,
      instance_id = excluded.instance_id,
      price_usd = excluded.price_usd,
      price_gold = excluded.price_gold,
      status = excluded.status,
      operation_id = excluded.operation_id,
      escrow_burn_tx = excluded.escrow_burn_tx,
      created_at_ms = excluded.created_at_ms,
      expires_at_ms = excluded.expires_at_ms,
      updated_at = now()`,
    [
      listing.listingId,
      listing.sellerWallet.toLowerCase(),
      listing.assetType,
      listing.tokenId,
      listing.quantity,
      listing.instanceId ?? null,
      listing.priceUsd,
      listing.priceGold ?? null,
      listing.status,
      listing.operationId ?? null,
      listing.escrowBurnTx ?? null,
      listing.createdAt,
      listing.expiresAt,
    ]
  );
}

export async function getDirectListingById(listingId: string): Promise<DirectListing | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<DirectListingRow>(
    `select listing_id, seller_wallet, asset_type, token_id, quantity, instance_id,
            price_usd, price_gold, status, operation_id, escrow_burn_tx,
            created_at_ms, expires_at_ms
       from game.direct_listings
      where listing_id = $1
      limit 1`,
    [listingId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listDirectListingsBySeller(wallet: string): Promise<DirectListing[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<DirectListingRow>(
    `select listing_id, seller_wallet, asset_type, token_id, quantity, instance_id,
            price_usd, price_gold, status, operation_id, escrow_burn_tx,
            created_at_ms, expires_at_ms
       from game.direct_listings
      where seller_wallet = $1
      order by created_at_ms desc`,
    [wallet.toLowerCase()]
  );
  return rows.map(mapRow);
}

export async function listActiveDirectListings(): Promise<DirectListing[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<DirectListingRow>(
    `select listing_id, seller_wallet, asset_type, token_id, quantity, instance_id,
            price_usd, price_gold, status, operation_id, escrow_burn_tx,
            created_at_ms, expires_at_ms
       from game.direct_listings
      where status = 'active'
      order by created_at_ms desc`
  );
  return rows.map(mapRow);
}

export async function listExpiredActiveDirectListingIds(now: number): Promise<string[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ listing_id: string }>(
    `select listing_id
       from game.direct_listings
      where status = 'active'
        and expires_at_ms < $1
      order by expires_at_ms asc`,
    [now]
  );
  return rows.map((row) => row.listing_id);
}
