import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { RentalGrant, RentalListing } from "../marketplace/rentService.js";
import type { RentalEntityRecord } from "../marketplace/characterRentalService.js";

function json<T>(value: T): string {
  return JSON.stringify(value);
}

export async function upsertRentalListing(listing: RentalListing): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.rental_listings (
      rental_id, owner_wallet, status, asset_type, token_id, payload_json, created_at_ms, updated_at
    ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,now())
    on conflict (rental_id) do update set
      owner_wallet = excluded.owner_wallet,
      status = excluded.status,
      asset_type = excluded.asset_type,
      token_id = excluded.token_id,
      payload_json = excluded.payload_json,
      created_at_ms = excluded.created_at_ms,
      updated_at = now()`,
    [listing.rentalId, listing.ownerWallet.toLowerCase(), listing.status, listing.assetType, listing.tokenId, json(listing), listing.createdAt]
  );
}

export async function getRentalListingProjection(rentalId: string): Promise<RentalListing | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: RentalListing }>(
    `select payload_json from game.rental_listings where rental_id = $1 limit 1`,
    [rentalId]
  );
  return rows[0]?.payload_json ?? null;
}

export async function listActiveRentalListingsProjection(): Promise<RentalListing[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ payload_json: RentalListing }>(
    `select payload_json from game.rental_listings where status = 'active' order by created_at_ms desc`
  );
  return rows.map((r) => r.payload_json);
}

export async function upsertRentalGrant(grant: RentalGrant): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.rental_grants (
      grant_id, rental_id, renter_wallet, owner_wallet, token_id, status, ends_at_ms, payload_json, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
    on conflict (grant_id) do update set
      rental_id = excluded.rental_id,
      renter_wallet = excluded.renter_wallet,
      owner_wallet = excluded.owner_wallet,
      token_id = excluded.token_id,
      status = excluded.status,
      ends_at_ms = excluded.ends_at_ms,
      payload_json = excluded.payload_json,
      updated_at = now()`,
    [grant.grantId, grant.rentalId, grant.renterWallet.toLowerCase(), grant.ownerWallet.toLowerCase(), grant.tokenId, grant.status, grant.endsAt, json(grant)]
  );
}

export async function getRentalGrantProjection(grantId: string): Promise<RentalGrant | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: RentalGrant }>(
    `select payload_json from game.rental_grants where grant_id = $1 limit 1`,
    [grantId]
  );
  return rows[0]?.payload_json ?? null;
}

export async function listActiveRentalGrantsForRenter(wallet: string, now: number): Promise<RentalGrant[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ payload_json: RentalGrant }>(
    `select payload_json
       from game.rental_grants
      where renter_wallet = $1 and status = 'active' and ends_at_ms > $2
      order by ends_at_ms asc`,
    [wallet.toLowerCase(), now]
  );
  return rows.map((r) => r.payload_json);
}

export async function getActiveRentalGrantForToken(wallet: string, tokenId: number, now: number): Promise<RentalGrant | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: RentalGrant }>(
    `select payload_json
       from game.rental_grants
      where renter_wallet = $1 and token_id = $2 and status = 'active' and ends_at_ms > $3
      order by ends_at_ms asc
      limit 1`,
    [wallet.toLowerCase(), tokenId, now]
  );
  return rows[0]?.payload_json ?? null;
}

export async function listExpiredActiveRentalGrantIds(now: number): Promise<string[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ grant_id: string }>(
    `select grant_id from game.rental_grants where status = 'active' and ends_at_ms <= $1 order by ends_at_ms asc`,
    [now]
  );
  return rows.map((r) => r.grant_id);
}

export async function upsertCharacterRentalEntity(record: RentalEntityRecord): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.character_rental_entities (grant_id, entity_id, payload_json, updated_at)
     values ($1,$2,$3::jsonb,now())
     on conflict (grant_id) do update set entity_id = excluded.entity_id, payload_json = excluded.payload_json, updated_at = now()`,
    [record.grantId, record.entityId, json(record)]
  );
}

export async function getCharacterRentalEntity(grantId: string): Promise<RentalEntityRecord | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: RentalEntityRecord }>(
    `select payload_json from game.character_rental_entities where grant_id = $1 limit 1`,
    [grantId]
  );
  return rows[0]?.payload_json ?? null;
}

export async function getCharacterRentalEntityByEntityId(entityId: string): Promise<RentalEntityRecord | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: RentalEntityRecord }>(
    `select payload_json from game.character_rental_entities where entity_id = $1 limit 1`,
    [entityId]
  );
  return rows[0]?.payload_json ?? null;
}

export async function deleteCharacterRentalEntity(grantId: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(`delete from game.character_rental_entities where grant_id = $1`, [grantId]);
}
