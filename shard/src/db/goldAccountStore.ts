import type { PoolClient, QueryResultRow } from "pg";
import { isPostgresConfigured, postgresQuery } from "./postgres.js";

function normWallet(wallet: string): string {
  return wallet.toLowerCase();
}

async function queryWithClient<T extends QueryResultRow>(
  client: PoolClient | null | undefined,
  text: string,
  values: unknown[]
): Promise<{ rows: T[] }> {
  if (client) {
    return await client.query<T>(text, values);
  }
  return await postgresQuery<T>(text, values);
}

export async function getGoldSpendTotals(): Promise<Record<string, number>> {
  if (!isPostgresConfigured()) return {};
  const { rows } = await postgresQuery<{ wallet_address: string; spent_amount: number }>(
    `select wallet_address, spent_amount
       from game.gold_spend_totals
      where spent_amount > 0`
  );
  return Object.fromEntries(rows.map((row) => [row.wallet_address, Number(row.spent_amount)]));
}

export async function addGoldSpend(
  wallet: string,
  amount: number,
  client?: PoolClient | null
): Promise<number> {
  if (!isPostgresConfigured()) return amount;
  const { rows } = await queryWithClient<{ spent_amount: number }>(
    client,
    `insert into game.gold_spend_totals (wallet_address, spent_amount, updated_at)
     values ($1,$2,now())
     on conflict (wallet_address) do update set
       spent_amount = game.gold_spend_totals.spent_amount + excluded.spent_amount,
       updated_at = now()
     returning spent_amount`,
    [normWallet(wallet), amount]
  );
  return Number(rows[0]?.spent_amount ?? amount);
}

export async function subtractGoldSpend(
  wallet: string,
  amount: number,
  client?: PoolClient | null
): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const { rows } = await queryWithClient<{ spent_amount: number }>(
    client,
    `insert into game.gold_spend_totals (wallet_address, spent_amount, updated_at)
     values ($1,0,now())
     on conflict (wallet_address) do update set
       spent_amount = greatest(0, game.gold_spend_totals.spent_amount - $2),
       updated_at = now()
     returning spent_amount`,
    [normWallet(wallet), amount]
  );
  return Number(rows[0]?.spent_amount ?? 0);
}

export async function setGoldReservationAmount(
  wallet: string,
  amount: number,
  client?: PoolClient | null
): Promise<void> {
  if (!isPostgresConfigured()) return;
  const normalized = normWallet(wallet);
  if (!Number.isFinite(amount) || amount <= 0) {
    await queryWithClient(client, `delete from game.gold_reservations where wallet_address = $1`, [normalized]);
    return;
  }
  await queryWithClient(
    client,
    `insert into game.gold_reservations (wallet_address, reserved_amount, updated_at)
     values ($1,$2,now())
     on conflict (wallet_address) do update set reserved_amount = excluded.reserved_amount, updated_at = now()`,
    [normalized, amount]
  );
}
