import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { AuctionData } from "../economy/auctionHouseChain.js";

interface AuctionRow {
  auction_id: string;
  zone_id: string;
  seller_wallet: string;
  token_id: number;
  quantity: number;
  start_price: string;
  buyout_price: string;
  end_time: number;
  high_bidder: string;
  high_bidder_agent_id: string | null;
  high_bid: string;
  status: number;
  extension_count: number;
}

function mapRow(row: AuctionRow): AuctionData {
  return {
    auctionId: Number(row.auction_id),
    zoneId: row.zone_id,
    seller: row.seller_wallet,
    tokenId: row.token_id,
    quantity: row.quantity,
    startPrice: Number(row.start_price),
    buyoutPrice: Number(row.buyout_price),
    endTime: row.end_time,
    highBidder: row.high_bidder,
    highBidderAgentId: row.high_bidder_agent_id,
    highBid: Number(row.high_bid),
    status: row.status,
    extensionCount: row.extension_count,
  };
}

export async function upsertAuctionProjection(auction: AuctionData): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.auction_projections (
      auction_id, zone_id, seller_wallet, token_id, quantity,
      start_price, buyout_price, end_time, high_bidder, high_bidder_agent_id,
      high_bid, status, extension_count, updated_at
    ) values (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, now()
    )
    on conflict (auction_id) do update set
      zone_id = excluded.zone_id,
      seller_wallet = excluded.seller_wallet,
      token_id = excluded.token_id,
      quantity = excluded.quantity,
      start_price = excluded.start_price,
      buyout_price = excluded.buyout_price,
      end_time = excluded.end_time,
      high_bidder = excluded.high_bidder,
      high_bidder_agent_id = excluded.high_bidder_agent_id,
      high_bid = excluded.high_bid,
      status = excluded.status,
      extension_count = excluded.extension_count,
      updated_at = now()`,
    [
      auction.auctionId,
      auction.zoneId,
      auction.seller.toLowerCase(),
      auction.tokenId,
      auction.quantity,
      auction.startPrice,
      auction.buyoutPrice,
      auction.endTime,
      auction.highBidder.toLowerCase(),
      auction.highBidderAgentId ?? null,
      auction.highBid,
      auction.status,
      auction.extensionCount,
    ]
  );
}

export async function getAuctionProjection(auctionId: number): Promise<AuctionData | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<AuctionRow>(
    `select auction_id::text, zone_id, seller_wallet, token_id, quantity,
            start_price::text, buyout_price::text, end_time, high_bidder,
            high_bidder_agent_id, high_bid::text, status, extension_count
       from game.auction_projections
      where auction_id = $1
      limit 1`,
    [auctionId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listAuctionProjections(statusFilter?: number, zoneId?: string): Promise<AuctionData[]> {
  if (!isPostgresConfigured()) return [];
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (typeof statusFilter === "number") {
    values.push(statusFilter);
    clauses.push(`status = $${values.length}`);
  }
  if (zoneId) {
    values.push(zoneId);
    clauses.push(`zone_id = $${values.length}`);
  }
  const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
  const { rows } = await postgresQuery<AuctionRow>(
    `select auction_id::text, zone_id, seller_wallet, token_id, quantity,
            start_price::text, buyout_price::text, end_time, high_bidder,
            high_bidder_agent_id, high_bid::text, status, extension_count
       from game.auction_projections
       ${where}
      order by auction_id asc`,
    values
  );
  return rows.map(mapRow);
}
