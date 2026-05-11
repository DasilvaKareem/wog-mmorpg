import { isPostgresConfigured, postgresQuery } from "./postgres.js";

/**
 * Off-chain metadata for a trade listing created via `POST /trade/list`.
 *
 * The on-chain `WoGTrade.sol` contract is open-bid only — any wallet can match
 * any listing. To support targeted P2P trades, we mirror the trade off-chain
 * with an optional `targetBuyerWallet` field and enforce it at the API layer
 * inside `POST /trade/offer`. We also denormalize `askPrice` here so the
 * targeted recipient can see the price upfront in their inbox without waiting
 * for BITE CTX decryption.
 */
export interface TradeListing {
  tradeId: number;
  sellerWallet: string;
  sellerName: string;
  tokenId: number;
  quantity: number;
  askPrice: number;
  targetBuyerWallet: string | null;
  itemName: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  cancelledAtMs: number | null;
  matchedAtMs: number | null;
}

interface TradeListingRow {
  trade_id: string;
  seller_wallet: string;
  seller_name: string;
  token_id: number;
  quantity: number;
  ask_price: string;
  target_buyer_wallet: string | null;
  item_name: string | null;
  created_at_ms: string;
  expires_at_ms: string;
  cancelled_at_ms: string | null;
  matched_at_ms: string | null;
}

function mapRow(row: TradeListingRow): TradeListing {
  return {
    tradeId: Number(row.trade_id),
    sellerWallet: row.seller_wallet,
    sellerName: row.seller_name,
    tokenId: row.token_id,
    quantity: row.quantity,
    askPrice: Number(row.ask_price),
    targetBuyerWallet: row.target_buyer_wallet,
    itemName: row.item_name,
    createdAtMs: Number(row.created_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
    cancelledAtMs: row.cancelled_at_ms !== null ? Number(row.cancelled_at_ms) : null,
    matchedAtMs: row.matched_at_ms !== null ? Number(row.matched_at_ms) : null,
  };
}

// In-memory fallback for dev/test runs without Postgres.
const memListings = new Map<number, TradeListing>();

export async function insertTradeListing(listing: TradeListing): Promise<void> {
  memListings.set(listing.tradeId, { ...listing });
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.trade_listings (
       trade_id, seller_wallet, seller_name, token_id, quantity, ask_price,
       target_buyer_wallet, item_name,
       created_at_ms, expires_at_ms, cancelled_at_ms, matched_at_ms, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6,
       $7, $8,
       $9, $10, $11, $12, now()
     )
     on conflict (trade_id) do update set
       seller_wallet = excluded.seller_wallet,
       seller_name = excluded.seller_name,
       token_id = excluded.token_id,
       quantity = excluded.quantity,
       ask_price = excluded.ask_price,
       target_buyer_wallet = excluded.target_buyer_wallet,
       item_name = excluded.item_name,
       expires_at_ms = excluded.expires_at_ms,
       updated_at = now()`,
    [
      listing.tradeId,
      listing.sellerWallet.toLowerCase(),
      listing.sellerName,
      listing.tokenId,
      listing.quantity,
      listing.askPrice,
      listing.targetBuyerWallet ? listing.targetBuyerWallet.toLowerCase() : null,
      listing.itemName,
      listing.createdAtMs,
      listing.expiresAtMs,
      listing.cancelledAtMs,
      listing.matchedAtMs,
    ]
  );
}

export async function getTradeListing(tradeId: number): Promise<TradeListing | null> {
  if (isPostgresConfigured()) {
    const { rows } = await postgresQuery<TradeListingRow>(
      `select trade_id, seller_wallet, seller_name, token_id, quantity, ask_price,
              target_buyer_wallet, item_name,
              created_at_ms, expires_at_ms, cancelled_at_ms, matched_at_ms
         from game.trade_listings
        where trade_id = $1
        limit 1`,
      [tradeId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }
  return memListings.get(tradeId) ?? null;
}

export async function markTradeListingCancelled(tradeId: number, ts: number): Promise<void> {
  const existing = memListings.get(tradeId);
  if (existing) existing.cancelledAtMs = ts;
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `update game.trade_listings
        set cancelled_at_ms = $2, updated_at = now()
      where trade_id = $1
        and cancelled_at_ms is null`,
    [tradeId, ts]
  );
}

export async function markTradeListingMatched(tradeId: number, ts: number): Promise<void> {
  const existing = memListings.get(tradeId);
  if (existing) existing.matchedAtMs = ts;
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `update game.trade_listings
        set matched_at_ms = $2, updated_at = now()
      where trade_id = $1
        and matched_at_ms is null`,
    [tradeId, ts]
  );
}

export async function listIncomingTradesForBuyer(
  buyerWallet: string,
  now: number,
): Promise<TradeListing[]> {
  if (isPostgresConfigured()) {
    const { rows } = await postgresQuery<TradeListingRow>(
      `select trade_id, seller_wallet, seller_name, token_id, quantity, ask_price,
              target_buyer_wallet, item_name,
              created_at_ms, expires_at_ms, cancelled_at_ms, matched_at_ms
         from game.trade_listings
        where target_buyer_wallet = $1
          and cancelled_at_ms is null
          and matched_at_ms is null
          and expires_at_ms > $2
        order by created_at_ms desc`,
      [buyerWallet.toLowerCase(), now]
    );
    return rows.map(mapRow);
  }
  const wallet = buyerWallet.toLowerCase();
  return Array.from(memListings.values())
    .filter(
      (l) =>
        l.targetBuyerWallet?.toLowerCase() === wallet &&
        l.cancelledAtMs === null &&
        l.matchedAtMs === null &&
        l.expiresAtMs > now,
    )
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/**
 * Listings that have passed their `expiresAtMs` deadline but are still open
 * (neither cancelled nor matched). Used by the expire tick to flip them and
 * notify the seller.
 */
export async function listExpiredOpenTradeListings(
  now: number,
  limit = 100,
): Promise<TradeListing[]> {
  if (isPostgresConfigured()) {
    const { rows } = await postgresQuery<TradeListingRow>(
      `select trade_id, seller_wallet, seller_name, token_id, quantity, ask_price,
              target_buyer_wallet, item_name,
              created_at_ms, expires_at_ms, cancelled_at_ms, matched_at_ms
         from game.trade_listings
        where cancelled_at_ms is null
          and matched_at_ms is null
          and expires_at_ms <= $1
        order by expires_at_ms asc
        limit $2`,
      [now, limit]
    );
    return rows.map(mapRow);
  }
  return Array.from(memListings.values())
    .filter(
      (l) =>
        l.cancelledAtMs === null &&
        l.matchedAtMs === null &&
        l.expiresAtMs <= now,
    )
    .sort((a, b) => a.expiresAtMs - b.expiresAtMs)
    .slice(0, limit);
}

export async function listOutgoingTradesForSeller(
  sellerWallet: string,
): Promise<TradeListing[]> {
  if (isPostgresConfigured()) {
    const { rows } = await postgresQuery<TradeListingRow>(
      `select trade_id, seller_wallet, seller_name, token_id, quantity, ask_price,
              target_buyer_wallet, item_name,
              created_at_ms, expires_at_ms, cancelled_at_ms, matched_at_ms
         from game.trade_listings
        where seller_wallet = $1
        order by created_at_ms desc
        limit 200`,
      [sellerWallet.toLowerCase()]
    );
    return rows.map(mapRow);
  }
  const wallet = sellerWallet.toLowerCase();
  return Array.from(memListings.values())
    .filter((l) => l.sellerWallet.toLowerCase() === wallet)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}
