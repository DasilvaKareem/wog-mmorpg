import type { PoolClient, QueryResultRow } from "pg";
import { isPostgresConfigured, postgresQuery } from "./postgres.js";

function normWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

async function queryWithClient<T extends QueryResultRow>(
  client: PoolClient | null | undefined,
  text: string,
  values: unknown[]
): Promise<{ rows: T[] }> {
  if (client) return await client.query<T>(text, values);
  return await postgresQuery<T>(text, values);
}

export async function getWalletGoldBalance(wallet: string): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const { rows } = await postgresQuery<{ balance: number }>(
    `select balance from game.wallet_gold_balances where wallet_address = $1`,
    [normWallet(wallet)]
  );
  return Number(rows[0]?.balance ?? 0);
}

export async function addWalletGold(
  wallet: string,
  amount: number,
  client?: PoolClient | null
): Promise<number> {
  if (!isPostgresConfigured()) return Math.max(0, amount);
  const normalized = normWallet(wallet);
  const { rows } = await queryWithClient<{ balance: number }>(
    client,
    `insert into game.wallet_gold_balances (wallet_address, balance, updated_at)
     values ($1, $2, now())
     on conflict (wallet_address) do update set
       balance = game.wallet_gold_balances.balance + excluded.balance,
       updated_at = now()
     returning balance`,
    [normalized, amount]
  );
  return Number(rows[0]?.balance ?? 0);
}

export async function subtractWalletGold(
  wallet: string,
  amount: number,
  client?: PoolClient | null
): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const normalized = normWallet(wallet);
  const { rows } = await queryWithClient<{ balance: number }>(
    client,
    `insert into game.wallet_gold_balances (wallet_address, balance, updated_at)
     values ($1, 0, now())
     on conflict (wallet_address) do update set
       balance = greatest(0, game.wallet_gold_balances.balance - $2),
       updated_at = now()
     returning balance`,
    [normalized, amount]
  );
  return Number(rows[0]?.balance ?? 0);
}

export async function transferWalletGold(
  fromWallet: string,
  toWallet: string,
  amount: number,
  client?: PoolClient | null
): Promise<void> {
  if (!isPostgresConfigured()) return;
  await subtractWalletGold(fromWallet, amount, client);
  await addWalletGold(toWallet, amount, client);
}

export async function getWalletItemBalance(wallet: string, tokenId: bigint): Promise<bigint> {
  if (!isPostgresConfigured()) return 0n;
  const { rows } = await postgresQuery<{ quantity: string | number }>(
    `select quantity from game.wallet_item_balances where wallet_address = $1 and token_id = $2`,
    [normWallet(wallet), tokenId.toString()]
  );
  const raw = rows[0]?.quantity;
  return raw == null ? 0n : BigInt(raw);
}

export async function addWalletItem(
  wallet: string,
  tokenId: bigint,
  quantity: bigint,
  client?: PoolClient | null
): Promise<bigint> {
  if (!isPostgresConfigured()) return quantity;
  const { rows } = await queryWithClient<{ quantity: string | number }>(
    client,
    `insert into game.wallet_item_balances (wallet_address, token_id, quantity, updated_at)
     values ($1, $2, $3, now())
     on conflict (wallet_address, token_id) do update set
       quantity = game.wallet_item_balances.quantity + excluded.quantity,
       updated_at = now()
     returning quantity`,
    [normWallet(wallet), tokenId.toString(), quantity.toString()]
  );
  return BigInt(rows[0]?.quantity ?? quantity.toString());
}

export async function subtractWalletItem(
  wallet: string,
  tokenId: bigint,
  quantity: bigint,
  client?: PoolClient | null
): Promise<bigint> {
  if (!isPostgresConfigured()) return 0n;
  const { rows } = await queryWithClient<{ quantity: string | number }>(
    client,
    `insert into game.wallet_item_balances (wallet_address, token_id, quantity, updated_at)
     values ($1, $2, 0, now())
     on conflict (wallet_address, token_id) do update set
       quantity = greatest(0, game.wallet_item_balances.quantity - $3::bigint),
       updated_at = now()
     returning quantity`,
    [normWallet(wallet), tokenId.toString(), quantity.toString()]
  );
  return BigInt(rows[0]?.quantity ?? "0");
}

export async function listWalletItemBalances(wallet: string): Promise<Map<number, number>> {
  const balances = new Map<number, number>();
  if (!isPostgresConfigured()) return balances;
  const { rows } = await postgresQuery<{ token_id: string | number; quantity: string | number }>(
    `select token_id, quantity from game.wallet_item_balances where wallet_address = $1 and quantity > 0 order by token_id asc`,
    [normWallet(wallet)]
  );
  for (const row of rows) {
    balances.set(Number(row.token_id), Number(row.quantity));
  }
  return balances;
}
