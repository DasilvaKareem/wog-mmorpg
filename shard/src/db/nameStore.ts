import { isPostgresConfigured, postgresQuery } from "./postgres.js";

function normWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

function normName(name: string): string {
  return name.trim().toLowerCase();
}

export async function getNameByWallet(wallet: string): Promise<string | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ name: string }>(
    `select name from game.wallet_names where wallet_address = $1`,
    [normWallet(wallet)]
  );
  return rows[0]?.name ?? null;
}

export async function getWalletByName(name: string): Promise<string | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ wallet_address: string }>(
    `select wallet_address from game.wallet_names where normalized_name = $1`,
    [normName(name)]
  );
  return rows[0]?.wallet_address ?? null;
}

export async function isWalletNameAvailable(name: string): Promise<boolean> {
  return (await getWalletByName(name)) == null;
}

export async function upsertWalletName(wallet: string, name: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.wallet_names (wallet_address, name, normalized_name, updated_at)
     values ($1, $2, $3, now())
     on conflict (wallet_address) do update set
       name = excluded.name,
       normalized_name = excluded.normalized_name,
       updated_at = now()`,
    [normWallet(wallet), name.trim(), normName(name)]
  );
}

export async function deleteWalletName(wallet: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(`delete from game.wallet_names where wallet_address = $1`, [normWallet(wallet)]);
}
