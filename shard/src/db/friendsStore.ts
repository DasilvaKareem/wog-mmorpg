import { isPostgresConfigured, postgresQuery } from "./postgres.js";

export interface PersistedFriend {
  wallet: string;
  addedAt: number;
}

export interface PersistedFriendRequest {
  id: string;
  fromWallet: string;
  fromName: string;
  toWallet: string;
  createdAt: number;
}

export async function listFriends(wallet: string): Promise<PersistedFriend[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ friend_wallet: string; added_at_ms: string }>(
    `select friend_wallet, added_at_ms::text
       from game.friend_edges
      where wallet_address = $1
      order by added_at_ms desc`,
    [wallet.toLowerCase()]
  );
  return rows.map((row) => ({
    wallet: row.friend_wallet,
    addedAt: Number(row.added_at_ms),
  }));
}

export async function replaceFriends(wallet: string, friends: PersistedFriend[]): Promise<void> {
  if (!isPostgresConfigured()) return;
  const normalizedWallet = wallet.toLowerCase();
  await postgresQuery("delete from game.friend_edges where wallet_address = $1", [normalizedWallet]);
  for (const friend of friends) {
    await postgresQuery(
      `insert into game.friend_edges (
        wallet_address, friend_wallet, added_at_ms, updated_at
      ) values ($1, $2, $3, now())`,
      [normalizedWallet, friend.wallet.toLowerCase(), friend.addedAt]
    );
  }
}

export async function replaceFriendRequests(wallet: string, requests: PersistedFriendRequest[], ttlMs: number): Promise<void> {
  if (!isPostgresConfigured()) return;
  const normalizedWallet = wallet.toLowerCase();
  await postgresQuery("delete from game.friend_requests where to_wallet = $1", [normalizedWallet]);
  for (const request of requests) {
    await postgresQuery(
      `insert into game.friend_requests (
        request_id, from_wallet, from_name, to_wallet, created_at_ms, expires_at_ms, updated_at
      ) values ($1, $2, $3, $4, $5, $6, now())`,
      [
        request.id,
        request.fromWallet.toLowerCase(),
        request.fromName,
        normalizedWallet,
        request.createdAt,
        request.createdAt + ttlMs,
      ]
    );
  }
}

export async function listFreshFriendRequests(wallet: string, now: number): Promise<PersistedFriendRequest[]> {
  if (!isPostgresConfigured()) return [];
  await postgresQuery("delete from game.friend_requests where to_wallet = $1 and expires_at_ms <= $2", [
    wallet.toLowerCase(),
    now,
  ]);
  const { rows } = await postgresQuery<{
    request_id: string;
    from_wallet: string;
    from_name: string;
    to_wallet: string;
    created_at_ms: string;
  }>(
    `select request_id, from_wallet, from_name, to_wallet, created_at_ms::text
       from game.friend_requests
      where to_wallet = $1
        and expires_at_ms > $2
      order by created_at_ms desc`,
    [wallet.toLowerCase(), now]
  );
  return rows.map((row) => ({
    id: row.request_id,
    fromWallet: row.from_wallet,
    fromName: row.from_name,
    toWallet: row.to_wallet,
    createdAt: Number(row.created_at_ms),
  }));
}
