import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { InboxMessage } from "../agents/agentInbox.js";

export async function upsertInboxMessage(wallet: string, message: InboxMessage): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.agent_inbox_messages (message_id, wallet_address, acked, ts_ms, payload_json, updated_at)
     values ($1,$2,false,$3,$4::jsonb,now())
     on conflict (message_id) do update set payload_json = excluded.payload_json, updated_at = now()`,
    [message.id, wallet.toLowerCase(), message.ts, JSON.stringify(message)]
  );
}

export async function appendInboxHistory(wallet: string, message: InboxMessage): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.agent_inbox_history (message_id, wallet_address, ts_ms, payload_json, updated_at)
     values ($1,$2,$3,$4::jsonb,now())
     on conflict (message_id) do nothing`,
    [message.id, wallet.toLowerCase(), message.ts, JSON.stringify(message)]
  );
}

export async function listInboxMessages(wallet: string, limit: number, sinceTs?: number): Promise<InboxMessage[]> {
  if (!isPostgresConfigured()) return [];
  const values: unknown[] = [wallet.toLowerCase()];
  const sinceClause = typeof sinceTs === "number" ? `and ts_ms > $${values.push(sinceTs)}` : "";
  values.push(limit);
  const { rows } = await postgresQuery<{ payload_json: InboxMessage }>(
    `select payload_json
       from game.agent_inbox_messages
      where wallet_address = $1
        and acked = false
        ${sinceClause}
      order by ts_ms asc
      limit $${values.length}`,
    values
  );
  return rows.map((row) => row.payload_json);
}

export async function ackInboxMessageIds(wallet: string, ids: string[]): Promise<number> {
  if (!isPostgresConfigured() || ids.length === 0) return 0;
  const { rowCount } = await postgresQuery(
    `update game.agent_inbox_messages
        set acked = true, updated_at = now()
      where wallet_address = $1
        and message_id = any($2::text[])`,
    [wallet.toLowerCase(), ids]
  );
  return rowCount ?? 0;
}

export async function countInboxMessages(wallet: string): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const { rows } = await postgresQuery<{ count: string }>(
    `select count(*)::text as count from game.agent_inbox_messages where wallet_address = $1 and acked = false`,
    [wallet.toLowerCase()]
  );
  return Number(rows[0]?.count ?? "0");
}

export async function countNewInboxMessages(wallet: string, sinceTs: number): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const { rows } = await postgresQuery<{ count: string }>(
    `select count(*)::text as count
       from game.agent_inbox_messages
      where wallet_address = $1
        and acked = false
        and ts_ms > $2`,
    [wallet.toLowerCase(), sinceTs]
  );
  return Number(rows[0]?.count ?? "0");
}

export async function listInboxHistory(
  wallet: string,
  limit: number,
  offset: number,
): Promise<{ messages: InboxMessage[]; total: number; unread: number }> {
  if (!isPostgresConfigured()) return { messages: [], total: 0, unread: 0 };
  const [{ rows: countRows }, { rows: unreadRows }, { rows }] = await Promise.all([
    postgresQuery<{ count: string }>(
      `select count(*)::text as count from game.agent_inbox_history where wallet_address = $1`,
      [wallet.toLowerCase()]
    ),
    postgresQuery<{ count: string }>(
      `select count(*)::text as count from game.agent_inbox_history where wallet_address = $1 and read_at is null`,
      [wallet.toLowerCase()]
    ),
    postgresQuery<{ payload_json: InboxMessage; read_at: Date | null }>(
      `select payload_json, read_at
         from game.agent_inbox_history
        where wallet_address = $1
        order by ts_ms asc
        limit $2 offset $3`,
      [wallet.toLowerCase(), limit, offset]
    ),
  ]);
  return {
    messages: rows.map((row) => ({
      ...row.payload_json,
      readAt: row.read_at ? row.read_at.valueOf() : null,
    }) as InboxMessage),
    total: Number(countRows[0]?.count ?? "0"),
    unread: Number(unreadRows[0]?.count ?? "0"),
  };
}

/**
 * Mark a set of history message IDs as read for the given wallet. Idempotent —
 * re-marking a message leaves its original read_at untouched. Returns the number
 * of rows newly flipped from unread → read.
 */
export async function markHistoryRead(wallet: string, ids: string[]): Promise<number> {
  if (!isPostgresConfigured() || ids.length === 0) return 0;
  const { rowCount } = await postgresQuery(
    `update game.agent_inbox_history
        set read_at = now()
      where wallet_address = $1
        and message_id = any($2::text[])
        and read_at is null`,
    [wallet.toLowerCase(), ids]
  );
  return rowCount ?? 0;
}

/**
 * Mark all unread history for a wallet as read. Returns the number of rows
 * flipped. Used by "Mark all read" in the client.
 */
export async function markAllHistoryRead(wallet: string): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const { rowCount } = await postgresQuery(
    `update game.agent_inbox_history
        set read_at = now()
      where wallet_address = $1
        and read_at is null`,
    [wallet.toLowerCase()]
  );
  return rowCount ?? 0;
}
