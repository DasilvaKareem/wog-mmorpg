/**
 * Agent Inbox — Redis Streams-backed agent-to-agent messaging system.
 *
 * Keys:
 *   inbox:{walletAddress}  → Redis Stream of InboxMessage
 *
 * Agents can send direct messages, trade requests, party invites,
 * and zone-wide broadcasts to each other through the shard server.
 */

import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "../redis.js";
import {
  ackInboxMessageIds,
  appendInboxHistory,
  countInboxMessages,
  countNewInboxMessages,
  listInboxHistory,
  listInboxMessages,
  upsertInboxMessage,
} from "../db/agentInboxStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type InboxMessageType =
  | "direct"           // free-form agent-to-agent message
  | "trade-request"    // "I want to buy/sell X"
  | "party-invite"     // "Join my party"
  | "broadcast"        // zone-wide announcement
  | "system";          // game event notification (level-up, death, quest complete)

export interface InboxMessage {
  /** Redis Stream entry ID (set on read, not on send) */
  id: string;
  /** Sender wallet address */
  from: string;
  /** Sender character name (for display) */
  fromName: string;
  /** Recipient wallet address (empty for broadcasts) */
  to: string;
  /** Message category */
  type: InboxMessageType;
  /** Free-text body */
  body: string;
  /** Optional structured payload (item IDs, gold amounts, etc.) */
  data?: Record<string, unknown>;
  /** Unix timestamp ms */
  ts: number;
}

export interface SendMessageParams {
  from: string;
  fromName: string;
  to: string;
  type: InboxMessageType;
  body: string;
  data?: Record<string, unknown>;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Max messages kept per inbox stream */
const MAX_INBOX_SIZE = 500;

/** Max messages kept in the persistent history log */
const MAX_HISTORY_SIZE = 500;

/** Default read batch size */
const DEFAULT_READ_LIMIT = 20;

// ── In-memory fallback ───────────────────────────────────────────────────────

const memInbox = new Map<string, InboxMessage[]>();
const memHistory = new Map<string, InboxMessage[]>();
let memIdCounter = 0;

function inboxKey(wallet: string): string {
  return `inbox:${wallet.toLowerCase()}`;
}

function historyKey(wallet: string): string {
  return `inbox:log:${wallet.toLowerCase()}`;
}

// ── Send ─────────────────────────────────────────────────────────────────────

/**
 * Send a message to a specific agent's inbox.
 * The shard mediates all messages — agents never talk peer-to-peer.
 */
export async function sendInboxMessage(params: SendMessageParams): Promise<string> {
  const { from, fromName, to, type, body, data } = params;
  const ts = Date.now();
  const redis = getRedis();

  const fields: Record<string, string> = {
    from: from.toLowerCase(),
    fromName,
    to: to.toLowerCase(),
    type,
    body,
    ts: String(ts),
  };
  if (data) fields.data = JSON.stringify(data);

  // Build the message object for the persistent log
  const logEntry: InboxMessage = {
    id: "", // filled after XADD or in-memory
    from: from.toLowerCase(),
    fromName,
    to: to.toLowerCase(),
    type,
    body,
    data,
    ts,
  };

  if (isPostgresConfigured()) {
    const id = `pg-${ts}-${++memIdCounter}`;
    logEntry.id = id;
    await upsertInboxMessage(to, logEntry);
    void appendToHistory(to, logEntry);

    const redis = getRedis();
    if (!redis) {
      return id;
    }
  }

  if (redis) {
    try {
      // XADD with MAXLEN ~ for auto-trimming (approximate for perf)
      const id: string = await redis.xadd(
        inboxKey(to),
        "MAXLEN", "~", String(MAX_INBOX_SIZE),
        "*", // auto-generate ID
        ...Object.entries(fields).flat(),
      );
      logEntry.id = id;
      // Persist to permanent history log (Redis LIST, capped)
      appendToHistory(to, logEntry);
      return id;
    } catch (err: any) {
      if (!isMemoryFallbackAllowed()) throw err;
      console.warn(`[inbox] Redis XADD failed, using in-memory: ${err.message}`);
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("sendInboxMessage");
    }
  }

  // In-memory fallback
  const key = to.toLowerCase();
  const list = memInbox.get(key) ?? [];
  const id = `mem-${++memIdCounter}`;
  logEntry.id = id;
  list.push({ ...logEntry, id });
  if (list.length > MAX_INBOX_SIZE) list.splice(0, list.length - MAX_INBOX_SIZE);
  memInbox.set(key, list);
  appendToHistory(to, logEntry);
  return id;
}

/**
 * Broadcast a message to all agents in a zone.
 * Caller provides the list of wallet addresses in the zone.
 */
export async function broadcastToZone(
  from: string,
  fromName: string,
  body: string,
  recipientWallets: string[],
  data?: Record<string, unknown>,
): Promise<number> {
  let sent = 0;
  for (const wallet of recipientWallets) {
    if (wallet.toLowerCase() === from.toLowerCase()) continue; // skip self
    await sendInboxMessage({ from, fromName, to: wallet, type: "broadcast", body, data });
    sent++;
  }
  return sent;
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read messages from an agent's inbox.
 * Returns newest-first. Pass `since` (stream ID) to only get messages after that point.
 */
export async function readInbox(
  wallet: string,
  limit = DEFAULT_READ_LIMIT,
  since?: string,
): Promise<InboxMessage[]> {
  if (isPostgresConfigured()) {
    const sinceTs = since ? Number(since.split("-")[1] ? since.split("-")[0] : since.split("-")[0]) : undefined;
    const rows = await listInboxMessages(wallet, limit, sinceTs);
    if (rows.length > 0) return rows;
  }
  const redis = getRedis();
  const key = inboxKey(wallet);

  if (redis) {
    try {
      // XRANGE: oldest-to-newest. Use since+1 or "0-0" for start.
      const startId = since ? incrementStreamId(since) : "0-0";
      const raw: Array<[string, string[]]> = await redis.xrange(key, startId, "+", "COUNT", String(limit));
      return raw.map(([id, fields]) => parseStreamEntry(id, fields));
    } catch (err: any) {
      if (!isMemoryFallbackAllowed()) throw err;
      console.warn(`[inbox] Redis XRANGE failed: ${err.message}`);
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("readInbox");
    }
  }

  // In-memory fallback
  const list = memInbox.get(wallet.toLowerCase()) ?? [];
  let filtered = list;
  if (since) {
    const idx = list.findIndex((m) => m.id === since);
    if (idx >= 0) filtered = list.slice(idx + 1);
  }
  return filtered.slice(-limit);
}

/**
 * Peek at the newest N messages (for agent tick — lightweight check).
 */
export async function peekInbox(
  wallet: string,
  limit = 5,
): Promise<InboxMessage[]> {
  if (isPostgresConfigured()) {
    const rows = await listInboxMessages(wallet, limit);
    if (rows.length > 0) return rows.slice(-limit);
  }
  const redis = getRedis();
  const key = inboxKey(wallet);

  if (redis) {
    try {
      // XREVRANGE: newest-first
      const raw: Array<[string, string[]]> = await redis.xrevrange(key, "+", "-", "COUNT", String(limit));
      return raw.map(([id, fields]) => parseStreamEntry(id, fields)).reverse();
    } catch (err: any) {
      if (!isMemoryFallbackAllowed()) throw err;
      console.warn(`[inbox] Redis XREVRANGE failed: ${err.message}`);
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("peekInbox");
    }
  }

  const list = memInbox.get(wallet.toLowerCase()) ?? [];
  return list.slice(-limit);
}

// ── Acknowledge / Delete ─────────────────────────────────────────────────────

/**
 * Delete specific messages from an inbox by stream ID.
 * Agents call this after processing messages.
 */
export async function ackInboxMessages(wallet: string, messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  if (isPostgresConfigured()) {
    const count = await ackInboxMessageIds(wallet, messageIds);
    const redis = getRedis();
    if (!redis) return count;
  }
  const redis = getRedis();
  const key = inboxKey(wallet);

  if (redis) {
    try {
      const deleted: number = await redis.xdel(key, ...messageIds);
      return deleted;
    } catch (err: any) {
      if (!isMemoryFallbackAllowed()) throw err;
      console.warn(`[inbox] Redis XDEL failed: ${err.message}`);
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("ackInboxMessages");
    }
  }

  // In-memory fallback
  const k = wallet.toLowerCase();
  const list = memInbox.get(k);
  if (!list) return 0;
  const before = list.length;
  const idSet = new Set(messageIds);
  memInbox.set(k, list.filter((m) => !idSet.has(m.id)));
  return before - (memInbox.get(k)?.length ?? 0);
}

// ── Count ────────────────────────────────────────────────────────────────────

/**
 * Get the number of messages in an agent's inbox.
 */
export async function countInbox(wallet: string): Promise<number> {
  if (isPostgresConfigured()) {
    const count = await countInboxMessages(wallet);
    if (count > 0) return count;
  }
  const redis = getRedis();
  const key = inboxKey(wallet);

  if (redis) {
    try {
      return await redis.xlen(key);
    } catch (err: any) {
      if (!isMemoryFallbackAllowed()) throw err;
      console.warn(`[inbox] Redis XLEN failed: ${err.message}`);
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("countInbox");
    }
  }

  return (memInbox.get(wallet.toLowerCase()) ?? []).length;
}

/**
 * Count messages received since a given stream ID (for "new message" badge).
 */
export async function countNewMessages(wallet: string, since: string): Promise<number> {
  if (isPostgresConfigured()) {
    const sinceTs = Number(since.split("-")[0] ?? "0");
    const count = await countNewInboxMessages(wallet, sinceTs);
    if (count > 0) return count;
  }
  const redis = getRedis();
  const key = inboxKey(wallet);

  if (redis) {
    try {
      const startId = incrementStreamId(since);
      const raw: Array<[string, string[]]> = await redis.xrange(key, startId, "+");
      return raw.length;
    } catch (err: any) {
      if (!isMemoryFallbackAllowed()) throw err;
      console.warn(`[inbox] Redis XRANGE count failed: ${err.message}`);
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("countNewMessages");
    }
  }

  const list = memInbox.get(wallet.toLowerCase()) ?? [];
  const idx = list.findIndex((m) => m.id === since);
  return idx >= 0 ? list.length - idx - 1 : list.length;
}

// ── Persistent History ───────────────────────────────────────────────────────

/**
 * Append a message to the permanent history log (Redis LIST, capped).
 * Fire-and-forget — never blocks the sender.
 */
function appendToHistory(wallet: string, msg: InboxMessage): void {
  if (isPostgresConfigured()) {
    void appendInboxHistory(wallet, msg).catch(() => {});
  }
  const redis = getRedis();
  const key = historyKey(wallet);

  if (redis) {
    redis.rpush(key, JSON.stringify(msg)).then(() =>
      redis.ltrim(key, -MAX_HISTORY_SIZE, -1)
    ).catch((err: any) => {
      console.debug(`[inbox] History append failed: ${err.message?.slice(0, 60)}`);
    });
  } else if (isMemoryFallbackAllowed()) {
    const k = wallet.toLowerCase();
    const list = memHistory.get(k) ?? [];
    list.push(msg);
    if (list.length > MAX_HISTORY_SIZE) list.splice(0, list.length - MAX_HISTORY_SIZE);
    memHistory.set(k, list);
  } else {
    console.error("[inbox] appendToHistory skipped: Redis required but unavailable");
  }
}

/**
 * Read the full message history for an agent (newest-last).
 * This is the permanent log — messages persist even after ack/deletion.
 */
export async function getMessageHistory(
  wallet: string,
  limit = 100,
  offset = 0,
): Promise<{ messages: InboxMessage[]; total: number }> {
  if (isPostgresConfigured()) {
    const history = await listInboxHistory(wallet, limit, offset);
    if (history.total > 0) return history;
  }
  const redis = getRedis();
  const key = historyKey(wallet);

  if (redis) {
    try {
      const total: number = await redis.llen(key);
      // Read newest-last: use negative offsets for pagination from the end
      const start = offset;
      const end = offset + limit - 1;
      const raw: string[] = await redis.lrange(key, start, end);
      const messages = raw.map((s: string) => JSON.parse(s) as InboxMessage);
      return { messages, total };
    } catch (err: any) {
      if (!isMemoryFallbackAllowed()) throw err;
      console.warn(`[inbox] History read failed: ${err.message}`);
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("getMessageHistory");
    }
  }

  const list = memHistory.get(wallet.toLowerCase()) ?? [];
  return { messages: list.slice(offset, offset + limit), total: list.length };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseStreamEntry(id: string, fields: string[]): InboxMessage {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    map[fields[i]] = fields[i + 1];
  }
  return {
    id,
    from: map.from ?? "",
    fromName: map.fromName ?? "",
    to: map.to ?? "",
    type: (map.type as InboxMessageType) ?? "direct",
    body: map.body ?? "",
    data: map.data ? JSON.parse(map.data) : undefined,
    ts: Number(map.ts) || 0,
  };
}

/**
 * Increment a Redis Stream ID by 1 sequence number for exclusive range queries.
 * "1234-0" → "1234-1", "1234" → "1234-1"
 */
function incrementStreamId(id: string): string {
  const parts = id.split("-");
  const ts = parts[0];
  const seq = Number(parts[1] ?? 0) + 1;
  return `${ts}-${seq}`;
}

// ── System Notifications ─────────────────────────────────────────────────────

/**
 * Send a system notification to a player's inbox (level-up, death, quest complete, etc.).
 * Fire-and-forget safe — logs errors but never throws.
 */
export async function sendSystemNotification(
  wallet: string,
  characterName: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await sendInboxMessage({
      from: "system",
      fromName: "World of Geneva",
      to: wallet,
      type: "system",
      body,
      data,
    });
  } catch (err: any) {
    console.warn(`[inbox] System notification failed for ${wallet}: ${err.message?.slice(0, 80)}`);
  }
}
