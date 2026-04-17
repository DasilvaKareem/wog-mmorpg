import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { Operation } from "../marketplace/operationRegistry.js";

export async function upsertMarketplaceOperation(operation: Operation): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.marketplace_operations (
      operation_id, operation_json, owner_wallet, status, updated_at_ms
    ) values ($1, $2::jsonb, $3, $4, $5)
    on conflict (operation_id) do update set
      operation_json = excluded.operation_json,
      owner_wallet = excluded.owner_wallet,
      status = excluded.status,
      updated_at_ms = excluded.updated_at_ms`,
    [
      operation.operationId,
      JSON.stringify(operation),
      operation.ownerWallet.toLowerCase(),
      operation.status,
      operation.updatedAt,
    ]
  );
}

export async function getMarketplaceOperation(operationId: string): Promise<Operation | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ operation_json: Operation }>(
    `select operation_json from game.marketplace_operations where operation_id = $1 limit 1`,
    [operationId]
  );
  return rows[0]?.operation_json ?? null;
}

export async function listMarketplaceOperationsByWallet(wallet: string): Promise<Operation[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ operation_json: Operation }>(
    `select operation_json from game.marketplace_operations where owner_wallet = $1 order by updated_at_ms desc`,
    [wallet.toLowerCase()]
  );
  return rows.map((row) => row.operation_json);
}

export async function listMarketplaceOperationsByStatus(status: string): Promise<Operation[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ operation_json: Operation }>(
    `select operation_json from game.marketplace_operations where status = $1 order by updated_at_ms desc`,
    [status]
  );
  return rows.map((row) => row.operation_json);
}

export async function putMarketplacePendingPayment(paymentId: string, wallet: string, payload: unknown, expiresAtMs: number): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.marketplace_pending_payments (
      payment_id, wallet_address, payload_json, expires_at_ms, updated_at
    ) values ($1, $2, $3::jsonb, $4, now())
    on conflict (payment_id) do update set
      wallet_address = excluded.wallet_address,
      payload_json = excluded.payload_json,
      expires_at_ms = excluded.expires_at_ms,
      updated_at = now()`,
    [paymentId, wallet.toLowerCase(), JSON.stringify(payload), expiresAtMs]
  );
}

export async function getMarketplacePendingPayment<T>(paymentId: string): Promise<T | null> {
  if (!isPostgresConfigured()) return null;
  const now = Date.now();
  await postgresQuery("delete from game.marketplace_pending_payments where payment_id = $1 and expires_at_ms <= $2", [paymentId, now]);
  const { rows } = await postgresQuery<{ payload_json: T }>(
    `select payload_json from game.marketplace_pending_payments where payment_id = $1 and expires_at_ms > $2 limit 1`,
    [paymentId, now]
  );
  return rows[0]?.payload_json ?? null;
}

export async function deleteMarketplacePendingPayment(paymentId: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery("delete from game.marketplace_pending_payments where payment_id = $1", [paymentId]);
}

export async function putGoldPendingPayment(paymentId: string, wallet: string, payload: unknown, expiresAtMs: number): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.gold_pending_payments (
      payment_id, wallet_address, payload_json, expires_at_ms, updated_at
    ) values ($1, $2, $3::jsonb, $4, now())
    on conflict (payment_id) do update set
      wallet_address = excluded.wallet_address,
      payload_json = excluded.payload_json,
      expires_at_ms = excluded.expires_at_ms,
      updated_at = now()`,
    [paymentId, wallet.toLowerCase(), JSON.stringify(payload), expiresAtMs]
  );
}

export async function getGoldPendingPayment<T>(paymentId: string): Promise<T | null> {
  if (!isPostgresConfigured()) return null;
  const now = Date.now();
  await postgresQuery("delete from game.gold_pending_payments where payment_id = $1 and expires_at_ms <= $2", [paymentId, now]);
  const { rows } = await postgresQuery<{ payload_json: T }>(
    `select payload_json from game.gold_pending_payments where payment_id = $1 and expires_at_ms > $2 limit 1`,
    [paymentId, now]
  );
  return rows[0]?.payload_json ?? null;
}

export async function deleteGoldPendingPayment(paymentId: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery("delete from game.gold_pending_payments where payment_id = $1", [paymentId]);
}
