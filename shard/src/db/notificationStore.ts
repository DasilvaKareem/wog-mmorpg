import type { PushSubscription } from "web-push";
import { isPostgresConfigured, postgresQuery } from "./postgres.js";

export async function upsertWebPushSubscription(wallet: string, subscription: PushSubscription, createdAt: number): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.web_push_subscriptions (
      wallet_address, subscription_json, created_at_ms, updated_at
    ) values ($1, $2::jsonb, $3, now())
    on conflict (wallet_address) do update set
      subscription_json = excluded.subscription_json,
      created_at_ms = excluded.created_at_ms,
      updated_at = now()`,
    [wallet.toLowerCase(), JSON.stringify(subscription), createdAt]
  );
}

export async function getWebPushSubscription(wallet: string): Promise<PushSubscription | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ subscription_json: PushSubscription }>(
    `select subscription_json from game.web_push_subscriptions where wallet_address = $1 limit 1`,
    [wallet.toLowerCase()]
  );
  return rows[0]?.subscription_json ?? null;
}

export async function deleteWebPushSubscription(wallet: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery("delete from game.web_push_subscriptions where wallet_address = $1", [wallet.toLowerCase()]);
}

export async function listWebPushWallets(): Promise<string[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ wallet_address: string }>(
    `select wallet_address from game.web_push_subscriptions`
  );
  return rows.map((row) => row.wallet_address);
}

export async function upsertTelegramWalletLink(wallet: string, chatId: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.telegram_wallet_links (
      wallet_address, chat_id, updated_at
    ) values ($1, $2, now())
    on conflict (wallet_address) do update set
      chat_id = excluded.chat_id,
      updated_at = now()`,
    [wallet.toLowerCase(), chatId]
  );
}

export async function getTelegramWalletLink(wallet: string): Promise<string | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ chat_id: string }>(
    `select chat_id from game.telegram_wallet_links where wallet_address = $1 limit 1`,
    [wallet.toLowerCase()]
  );
  return rows[0]?.chat_id ?? null;
}

export async function deleteTelegramWalletLink(wallet: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery("delete from game.telegram_wallet_links where wallet_address = $1", [wallet.toLowerCase()]);
}

export async function listTelegramWalletLinks(): Promise<Array<{ wallet: string; chatId: string; lastSummaryAt: number | null }>> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ wallet_address: string; chat_id: string; last_summary_at_ms: string | null }>(
    `select wallet_address, chat_id, last_summary_at_ms::text from game.telegram_wallet_links`
  );
  return rows.map((row) => ({
    wallet: row.wallet_address,
    chatId: row.chat_id,
    lastSummaryAt: row.last_summary_at_ms ? Number(row.last_summary_at_ms) : null,
  }));
}

export async function updateTelegramSummaryTimestamp(wallet: string, ts: number): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `update game.telegram_wallet_links set last_summary_at_ms = $2, updated_at = now() where wallet_address = $1`,
    [wallet.toLowerCase(), ts]
  );
}
