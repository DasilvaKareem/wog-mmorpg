import { randomUUID } from "crypto";
import { getRedis, isMemoryFallbackAllowed, assertRedisAvailable } from "../redis.js";
import { isPostgresConfigured, postgresQuery, withPostgresClient } from "../db/postgres.js";
import { classifyTxFailure } from "./txTracer.js";

export type ChainIntentStatus =
  | "pending"
  | "processing"
  | "submitted"
  | "confirmed"
  | "retryable"
  | "waiting_funds"
  | "failed_permanent"
  | "superseded";

export interface ChainWriteIntentRecord {
  intentId: string;
  type: string;
  aggregateType: string;
  aggregateKey: string;
  walletAddress?: string;
  payload: string;
  priority: number;
  status: ChainIntentStatus;
  availableAt: number;
  claimedAt?: number;
  claimOwner?: string;
  lastSubmittedAt?: number;
  confirmedAt?: number;
  attemptCount: number;
  txHash?: string;
  lastError?: string;
  supersededBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChainTxAttemptRecord {
  attemptId: string;
  intentId: string;
  signerAddress?: string;
  rpcProvider?: string;
  queueLabel?: string;
  nonce?: number;
  txHash?: string;
  status: "processing" | "submitted" | "confirmed" | "failed";
  errorCode?: string;
  errorMessage?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  createdAt: number;
  submittedAt?: number;
  confirmedAt?: number;
}

type ChainIntentRow = {
  intent_id: string;
  type: string;
  aggregate_type: string;
  aggregate_key: string;
  wallet_address: string | null;
  payload_json: unknown;
  priority: number;
  status: ChainIntentStatus;
  available_at_ms: string;
  claimed_at_ms: string | null;
  claim_owner: string | null;
  last_submitted_at_ms: string | null;
  confirmed_at_ms: string | null;
  attempt_count: number;
  tx_hash: string | null;
  last_error: string | null;
  superseded_by: string | null;
  created_at_ms: string;
  updated_at_ms: string;
};

type ChainTxAttemptRow = {
  attempt_id: string;
  intent_id: string;
  signer_address: string | null;
  rpc_provider: string | null;
  queue_label: string | null;
  nonce: string | null;
  tx_hash: string | null;
  status: ChainTxAttemptRecord["status"];
  error_code: string | null;
  error_message: string | null;
  gas_limit: string | null;
  gas_price: string | null;
  max_fee_per_gas: string | null;
  max_priority_fee_per_gas: string | null;
  created_at_ms: string;
  submitted_at_ms: string | null;
  confirmed_at_ms: string | null;
};

const memoryIntents = new Map<string, ChainWriteIntentRecord>();
const memoryAttempts = new Map<string, ChainTxAttemptRecord>();
const memoryAggregate = new Map<string, string>();
const memoryClaims = new Set<string>();
const CHAIN_INTENT_SUBMITTED_RECOVERY_MS = Math.max(
  30_000,
  Number.parseInt(process.env.CHAIN_INTENT_SUBMITTED_RECOVERY_MS ?? "120000", 10) || 120_000
);

export function formatChainError(err: unknown, maxLength = 400): string {
  let message = "";
  if (typeof err === "string") {
    message = err;
  } else if (err instanceof Error) {
    message = err.message;
  } else if (err && typeof err === "object") {
    const candidate = err as {
      message?: unknown;
      shortMessage?: unknown;
      reason?: unknown;
      code?: unknown;
      error?: unknown;
      cause?: unknown;
      data?: unknown;
    };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      message = candidate.message;
    } else if (typeof candidate.shortMessage === "string" && candidate.shortMessage.trim()) {
      message = candidate.shortMessage;
    } else if (typeof candidate.reason === "string" && candidate.reason.trim()) {
      message = candidate.reason;
    } else if (candidate.error && typeof candidate.error === "object") {
      message = formatChainError(candidate.error, maxLength);
    } else if (candidate.cause && typeof candidate.cause === "object") {
      message = formatChainError(candidate.cause, maxLength);
    } else {
      try {
        message = JSON.stringify(err);
      } catch {
        message = String(err);
      }
    }
    if (!message && candidate.code != null) {
      message = `code=${String(candidate.code)}`;
    }
    if (!message && candidate.data != null) {
      try {
        message = JSON.stringify(candidate.data);
      } catch {
        message = String(candidate.data);
      }
    }
  } else {
    message = String(err ?? "");
  }
  return message.slice(0, maxLength);
}

function shouldUsePostgres(): boolean {
  return isPostgresConfigured();
}

function normalizeWallet(address?: string | null): string | undefined {
  return typeof address === "string" && address.trim() ? address.trim().toLowerCase() : undefined;
}

function toEpochMs(value: string | null): number | undefined {
  if (!value) return undefined;
  return Number(value) || 0;
}

function fromIntentRow(row: ChainIntentRow): ChainWriteIntentRecord {
  return {
    intentId: row.intent_id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateKey: row.aggregate_key,
    ...(row.wallet_address ? { walletAddress: row.wallet_address } : {}),
    payload: JSON.stringify(row.payload_json ?? {}),
    priority: Number(row.priority ?? 100) || 100,
    status: row.status,
    availableAt: Number(row.available_at_ms ?? "0") || 0,
    ...(row.claimed_at_ms ? { claimedAt: Number(row.claimed_at_ms) || 0 } : {}),
    ...(row.claim_owner ? { claimOwner: row.claim_owner } : {}),
    ...(row.last_submitted_at_ms ? { lastSubmittedAt: Number(row.last_submitted_at_ms) || 0 } : {}),
    ...(row.confirmed_at_ms ? { confirmedAt: Number(row.confirmed_at_ms) || 0 } : {}),
    attemptCount: Number(row.attempt_count ?? 0) || 0,
    ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
    createdAt: Number(row.created_at_ms ?? "0") || 0,
    updatedAt: Number(row.updated_at_ms ?? "0") || 0,
  };
}

function fromAttemptRow(row: ChainTxAttemptRow): ChainTxAttemptRecord {
  return {
    attemptId: row.attempt_id,
    intentId: row.intent_id,
    ...(row.signer_address ? { signerAddress: row.signer_address } : {}),
    ...(row.rpc_provider ? { rpcProvider: row.rpc_provider } : {}),
    ...(row.queue_label ? { queueLabel: row.queue_label } : {}),
    ...(row.nonce != null ? { nonce: Number(row.nonce) || 0 } : {}),
    ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    status: row.status,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.gas_limit ? { gasLimit: row.gas_limit } : {}),
    ...(row.gas_price ? { gasPrice: row.gas_price } : {}),
    ...(row.max_fee_per_gas ? { maxFeePerGas: row.max_fee_per_gas } : {}),
    ...(row.max_priority_fee_per_gas ? { maxPriorityFeePerGas: row.max_priority_fee_per_gas } : {}),
    createdAt: Number(row.created_at_ms ?? "0") || 0,
    ...(row.submitted_at_ms ? { submittedAt: Number(row.submitted_at_ms) || 0 } : {}),
    ...(row.confirmed_at_ms ? { confirmedAt: Number(row.confirmed_at_ms) || 0 } : {}),
  };
}

async function getIntentById(intentId: string): Promise<ChainWriteIntentRecord | null> {
  if (shouldUsePostgres()) {
    const { rows } = await postgresQuery<ChainIntentRow>(
      `
        select
          intent_id,
          type,
          aggregate_type,
          aggregate_key,
          wallet_address,
          payload_json,
          priority,
          status,
          floor(extract(epoch from available_at) * 1000)::text as available_at_ms,
          case when claimed_at is null then null else floor(extract(epoch from claimed_at) * 1000)::text end as claimed_at_ms,
          claim_owner,
          case when last_submitted_at is null then null else floor(extract(epoch from last_submitted_at) * 1000)::text end as last_submitted_at_ms,
          case when confirmed_at is null then null else floor(extract(epoch from confirmed_at) * 1000)::text end as confirmed_at_ms,
          attempt_count,
          tx_hash,
          last_error,
          superseded_by,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms
        from game.chain_write_intents
        where intent_id = $1
        limit 1
      `,
      [intentId]
    );
    return rows[0] ? fromIntentRow(rows[0]) : null;
  }

  return memoryIntents.get(intentId) ?? null;
}

export async function getChainIntent(intentId: string): Promise<ChainWriteIntentRecord | null> {
  return await getIntentById(intentId);
}

export async function createChainIntent(input: {
  type: string;
  aggregateType: string;
  aggregateKey: string;
  walletAddress?: string | null;
  payload: unknown;
  priority?: number;
  status?: ChainIntentStatus;
  availableAt?: number;
}): Promise<ChainWriteIntentRecord> {
  const now = Date.now();
  const intent: ChainWriteIntentRecord = {
    intentId: randomUUID(),
    type: input.type,
    aggregateType: input.aggregateType,
    aggregateKey: input.aggregateKey,
    ...(normalizeWallet(input.walletAddress) ? { walletAddress: normalizeWallet(input.walletAddress) } : {}),
    payload: JSON.stringify(input.payload ?? {}),
    priority: input.priority ?? 100,
    status: input.status ?? "pending",
    availableAt: input.availableAt ?? now,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  if (shouldUsePostgres()) {
    await postgresQuery(
      `
        insert into game.chain_write_intents (
          intent_id, type, aggregate_type, aggregate_key, wallet_address, payload_json,
          priority, status, available_at, created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8,
          to_timestamp($9::double precision / 1000.0),
          to_timestamp($10::double precision / 1000.0),
          to_timestamp($11::double precision / 1000.0)
        )
      `,
      [
        intent.intentId,
        intent.type,
        intent.aggregateType,
        intent.aggregateKey,
        intent.walletAddress ?? null,
        intent.payload,
        intent.priority,
        intent.status,
        intent.availableAt,
        intent.createdAt,
        intent.updatedAt,
      ]
    );
    return intent;
  }

  memoryIntents.set(intent.intentId, intent);
  memoryAggregate.set(`${intent.type}:${intent.aggregateKey}`, intent.intentId);
  return intent;
}

export async function upsertAggregatedChainIntent(input: {
  type: string;
  aggregateType: string;
  aggregateKey: string;
  walletAddress?: string | null;
  priority?: number;
  mergePayload: (current: Record<string, unknown> | null) => Record<string, unknown>;
}): Promise<ChainWriteIntentRecord> {
  const normalizedWallet = normalizeWallet(input.walletAddress);
  const now = Date.now();
  if (shouldUsePostgres()) {
    return await withPostgresClient(async (client) => {
      await client.query("begin");
      try {
        const { rows } = await client.query<ChainIntentRow>(
          `
            select
              intent_id,
              type,
              aggregate_type,
              aggregate_key,
              wallet_address,
              payload_json,
              priority,
              status,
              floor(extract(epoch from available_at) * 1000)::text as available_at_ms,
              case when claimed_at is null then null else floor(extract(epoch from claimed_at) * 1000)::text end as claimed_at_ms,
              claim_owner,
              case when last_submitted_at is null then null else floor(extract(epoch from last_submitted_at) * 1000)::text end as last_submitted_at_ms,
              case when confirmed_at is null then null else floor(extract(epoch from confirmed_at) * 1000)::text end as confirmed_at_ms,
              attempt_count,
              tx_hash,
              last_error,
              superseded_by,
              floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
              floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms
            from game.chain_write_intents
            where type = $1
              and aggregate_key = $2
              and status in ('pending', 'retryable', 'processing', 'waiting_funds', 'submitted')
            order by created_at desc
            limit 1
            for update
          `,
          [input.type, input.aggregateKey]
        );
        const existing = rows[0] ? fromIntentRow(rows[0]) : null;
        if (existing?.status === "submitted") {
          // Preserve the in-flight publish. Returning the active submitted intent keeps
          // aggregate dedupe intact without mutating the payload behind a live tx hash.
          await client.query("commit");
          return existing;
        }
        const mergedPayload = input.mergePayload(existing ? JSON.parse(existing.payload) : null);
        const nextStatus: ChainIntentStatus =
          existing?.status === "processing"
            ? "pending"
            : existing?.status === "waiting_funds"
              ? "waiting_funds"
              : (existing?.status ?? "pending");

        if (existing) {
          await client.query(
            `
              update game.chain_write_intents
              set wallet_address = coalesce($2, wallet_address),
                  payload_json = $3::jsonb,
                  priority = $4,
                  status = $5,
                  available_at = to_timestamp($6::double precision / 1000.0),
                  claimed_at = null,
                  claim_owner = null,
                  last_error = null,
                  updated_at = to_timestamp($7::double precision / 1000.0)
              where intent_id = $1
            `,
            [
              existing.intentId,
              normalizedWallet ?? null,
              JSON.stringify(mergedPayload),
              input.priority ?? existing.priority,
              nextStatus,
              now,
              now,
            ]
          );
          await client.query("commit");
          return {
            ...existing,
            ...(normalizedWallet ? { walletAddress: normalizedWallet } : {}),
            payload: JSON.stringify(mergedPayload),
            priority: input.priority ?? existing.priority,
            status: nextStatus,
            availableAt: now,
            claimedAt: undefined,
            claimOwner: undefined,
            lastError: undefined,
            updatedAt: now,
          };
        }

        const created: ChainWriteIntentRecord = {
          intentId: randomUUID(),
          type: input.type,
          aggregateType: input.aggregateType,
          aggregateKey: input.aggregateKey,
          ...(normalizedWallet ? { walletAddress: normalizedWallet } : {}),
          payload: JSON.stringify(mergedPayload),
          priority: input.priority ?? 100,
          status: "pending",
          availableAt: now,
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        await client.query(
          `
            insert into game.chain_write_intents (
              intent_id, type, aggregate_type, aggregate_key, wallet_address, payload_json,
              priority, status, available_at, created_at, updated_at
            ) values (
              $1, $2, $3, $4, $5, $6::jsonb, $7, $8,
              to_timestamp($9::double precision / 1000.0),
              to_timestamp($10::double precision / 1000.0),
              to_timestamp($11::double precision / 1000.0)
            )
          `,
          [
            created.intentId,
            created.type,
            created.aggregateType,
            created.aggregateKey,
            created.walletAddress ?? null,
            created.payload,
            created.priority,
            created.status,
            created.availableAt,
            created.createdAt,
            created.updatedAt,
          ]
        );
        await client.query("commit");
        return created;
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    });
  }

  const aggregateLookup = `${input.type}:${input.aggregateKey}`;
  const existingId = memoryAggregate.get(aggregateLookup);
  const existing = existingId ? memoryIntents.get(existingId) ?? null : null;
  const mergedPayload = input.mergePayload(existing ? JSON.parse(existing.payload) : null);
  if (existing && (existing.status === "pending" || existing.status === "retryable" || existing.status === "processing")) {
    const updated: ChainWriteIntentRecord = {
      ...existing,
      ...(normalizedWallet ? { walletAddress: normalizedWallet } : {}),
      payload: JSON.stringify(mergedPayload),
      priority: input.priority ?? existing.priority,
      status: "pending",
      availableAt: now,
      claimedAt: undefined,
      claimOwner: undefined,
      lastError: undefined,
      updatedAt: now,
    };
    memoryIntents.set(existing.intentId, updated);
    return updated;
  }
  const created: ChainWriteIntentRecord = {
    intentId: randomUUID(),
    type: input.type,
    aggregateType: input.aggregateType,
    aggregateKey: input.aggregateKey,
    ...(normalizedWallet ? { walletAddress: normalizedWallet } : {}),
    payload: JSON.stringify(mergedPayload),
    priority: input.priority ?? 100,
    status: "pending",
    availableAt: now,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  memoryIntents.set(created.intentId, created);
  memoryAggregate.set(aggregateLookup, created.intentId);
  return created;
}

export async function listDueChainIntents(type?: string, walletAddress?: string, limit = 200): Promise<ChainWriteIntentRecord[]> {
  if (shouldUsePostgres()) {
    const clauses = [
      `(
        (status in ('pending', 'retryable', 'waiting_funds') and available_at <= now())
        or
        (status = 'submitted' and coalesce(last_submitted_at, claimed_at, updated_at) <= to_timestamp($1::double precision / 1000.0))
      )`,
    ];
    const values: unknown[] = [];
    let index = 2;
    values.push(Date.now() - CHAIN_INTENT_SUBMITTED_RECOVERY_MS);
    if (type) {
      clauses.push(`type = $${index++}`);
      values.push(type);
    }
    if (walletAddress) {
      clauses.push(`wallet_address = $${index++}`);
      values.push(normalizeWallet(walletAddress)!);
    }
    values.push(limit);
    const { rows } = await postgresQuery<ChainIntentRow>(
      `
        select
          intent_id,
          type,
          aggregate_type,
          aggregate_key,
          wallet_address,
          payload_json,
          priority,
          status,
          floor(extract(epoch from available_at) * 1000)::text as available_at_ms,
          case when claimed_at is null then null else floor(extract(epoch from claimed_at) * 1000)::text end as claimed_at_ms,
          claim_owner,
          case when last_submitted_at is null then null else floor(extract(epoch from last_submitted_at) * 1000)::text end as last_submitted_at_ms,
          case when confirmed_at is null then null else floor(extract(epoch from confirmed_at) * 1000)::text end as confirmed_at_ms,
          attempt_count,
          tx_hash,
          last_error,
          superseded_by,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms
        from game.chain_write_intents
        where ${clauses.join(" and ")}
        order by priority asc, available_at asc, created_at asc
        limit $${index}
      `,
      values
    );
    return rows.map(fromIntentRow);
  }

  const normalizedWallet = normalizeWallet(walletAddress);
  return Array.from(memoryIntents.values())
    .filter((intent) =>
      (
        ((intent.status === "pending" || intent.status === "retryable" || intent.status === "waiting_funds") &&
          intent.availableAt <= Date.now()) ||
        (intent.status === "submitted" &&
          ((intent.lastSubmittedAt ?? intent.updatedAt) <= (Date.now() - CHAIN_INTENT_SUBMITTED_RECOVERY_MS)))
      ) &&
      (!type || intent.type === type) &&
      (!normalizedWallet || intent.walletAddress === normalizedWallet)
    )
    .sort((a, b) => a.priority - b.priority || a.availableAt - b.availableAt || a.createdAt - b.createdAt)
    .slice(0, limit);
}

export async function claimChainIntent(intentId: string, claimOwner: string): Promise<ChainWriteIntentRecord | null> {
  const now = Date.now();
  const submittedCutoff = now - CHAIN_INTENT_SUBMITTED_RECOVERY_MS;
  if (shouldUsePostgres()) {
    const { rows } = await postgresQuery<ChainIntentRow>(
      `
        update game.chain_write_intents
        set status = 'processing',
            claimed_at = to_timestamp($2::double precision / 1000.0),
            claim_owner = $3,
            attempt_count = attempt_count + 1,
            updated_at = to_timestamp($2::double precision / 1000.0)
        where intent_id = $1
          and (
            status in ('pending', 'retryable', 'waiting_funds')
            or (status = 'submitted' and coalesce(last_submitted_at, claimed_at, updated_at) <= to_timestamp($4::double precision / 1000.0))
          )
        returning
          intent_id,
          type,
          aggregate_type,
          aggregate_key,
          wallet_address,
          payload_json,
          priority,
          status,
          floor(extract(epoch from available_at) * 1000)::text as available_at_ms,
          case when claimed_at is null then null else floor(extract(epoch from claimed_at) * 1000)::text end as claimed_at_ms,
          claim_owner,
          case when last_submitted_at is null then null else floor(extract(epoch from last_submitted_at) * 1000)::text end as last_submitted_at_ms,
          case when confirmed_at is null then null else floor(extract(epoch from confirmed_at) * 1000)::text end as confirmed_at_ms,
          attempt_count,
          tx_hash,
          last_error,
          superseded_by,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms
      `,
      [intentId, now, claimOwner, submittedCutoff]
    );
    return rows[0] ? fromIntentRow(rows[0]) : null;
  }

  if (memoryClaims.has(intentId)) return null;
  const current = memoryIntents.get(intentId);
  if (
    !current ||
    !(
      current.status === "pending" ||
      current.status === "retryable" ||
      current.status === "waiting_funds" ||
      (current.status === "submitted" && ((current.lastSubmittedAt ?? current.updatedAt) <= submittedCutoff))
    )
  ) return null;
  memoryClaims.add(intentId);
  const updated: ChainWriteIntentRecord = {
    ...current,
    status: "processing",
    claimedAt: now,
    claimOwner,
    attemptCount: current.attemptCount + 1,
    updatedAt: now,
  };
  memoryIntents.set(intentId, updated);
  return updated;
}

export async function updateChainIntent(
  intentId: string,
  patch: Partial<ChainWriteIntentRecord>
): Promise<ChainWriteIntentRecord | null> {
  const current = await getIntentById(intentId);
  if (!current) return null;
  const updated: ChainWriteIntentRecord = {
    ...current,
    ...patch,
    intentId: current.intentId,
    type: current.type,
    aggregateType: patch.aggregateType ?? current.aggregateType,
    aggregateKey: patch.aggregateKey ?? current.aggregateKey,
    walletAddress: patch.walletAddress === undefined ? current.walletAddress : normalizeWallet(patch.walletAddress),
    payload: patch.payload ?? current.payload,
    updatedAt: Date.now(),
  };
  if (shouldUsePostgres()) {
    await postgresQuery(
      `
        update game.chain_write_intents
        set aggregate_type = $2,
            aggregate_key = $3,
            wallet_address = $4,
            payload_json = $5::jsonb,
            priority = $6,
            status = $7,
            available_at = to_timestamp($8::double precision / 1000.0),
            claimed_at = case when $9::bigint is null then null else to_timestamp($9::double precision / 1000.0) end,
            claim_owner = $10,
            last_submitted_at = case when $11::bigint is null then null else to_timestamp($11::double precision / 1000.0) end,
            confirmed_at = case when $12::bigint is null then null else to_timestamp($12::double precision / 1000.0) end,
            attempt_count = $13,
            tx_hash = $14,
            last_error = $15,
            superseded_by = $16,
            updated_at = to_timestamp($17::double precision / 1000.0)
        where intent_id = $1
      `,
      [
        intentId,
        updated.aggregateType,
        updated.aggregateKey,
        updated.walletAddress ?? null,
        updated.payload,
        updated.priority,
        updated.status,
        updated.availableAt,
        updated.claimedAt ?? null,
        updated.claimOwner ?? null,
        updated.lastSubmittedAt ?? null,
        updated.confirmedAt ?? null,
        updated.attemptCount,
        updated.txHash ?? null,
        updated.lastError ?? null,
        updated.supersededBy ?? null,
        updated.updatedAt,
      ]
    );
  } else {
    memoryIntents.set(intentId, updated);
    if (updated.status !== "processing") memoryClaims.delete(intentId);
    memoryAggregate.set(`${updated.type}:${updated.aggregateKey}`, intentId);
  }
  return updated;
}

export async function markChainIntentSubmitted(
  intentId: string,
  txHash?: string | null
): Promise<ChainWriteIntentRecord | null> {
  return await updateChainIntent(intentId, {
    status: "submitted",
    lastSubmittedAt: Date.now(),
    ...(txHash ? { txHash } : {}),
    lastError: undefined,
  });
}

export async function markChainIntentConfirmed(
  intentId: string,
  txHash?: string | null
): Promise<ChainWriteIntentRecord | null> {
  return await updateChainIntent(intentId, {
    status: "confirmed",
    confirmedAt: Date.now(),
    ...(txHash ? { txHash } : {}),
    claimedAt: undefined,
    claimOwner: undefined,
    lastError: undefined,
  });
}

export async function markChainIntentRetryable(
  intentId: string,
  err: unknown,
  delayMs = 15_000
): Promise<ChainWriteIntentRecord | null> {
  const current = await getIntentById(intentId);
  if (!current) return null;
  const classification = classifyTxFailure(err);
  if (classification.kind === "permanent") {
    return await markChainIntentPermanentFailure(intentId, err);
  }
  if (classification.kind === "funding") {
    return await markChainIntentFundingBlocked(intentId, err, Math.max(delayMs, 300_000));
  }
  return await updateChainIntent(intentId, {
    status: "retryable",
    availableAt: Date.now() + delayMs,
    claimedAt: undefined,
    claimOwner: undefined,
    lastError: formatChainError(err, 400),
    txHash: undefined,
  });
}

export async function markChainIntentFundingBlocked(
  intentId: string,
  err: unknown,
  delayMs = 300_000
): Promise<ChainWriteIntentRecord | null> {
  return await updateChainIntent(intentId, {
    status: "waiting_funds",
    availableAt: Date.now() + delayMs,
    claimedAt: undefined,
    claimOwner: undefined,
    lastError: formatChainError(err, 400),
  });
}

export async function markChainIntentPermanentFailure(
  intentId: string,
  err: unknown
): Promise<ChainWriteIntentRecord | null> {
  return await updateChainIntent(intentId, {
    status: "failed_permanent",
    claimedAt: undefined,
    claimOwner: undefined,
    lastError: formatChainError(err, 400),
  });
}

export async function createChainTxAttempt(input: {
  intentId: string;
  signerAddress?: string | null;
  rpcProvider?: string | null;
  queueLabel?: string | null;
  nonce?: number | null;
  status?: ChainTxAttemptRecord["status"];
}): Promise<ChainTxAttemptRecord> {
  const now = Date.now();
  const attempt: ChainTxAttemptRecord = {
    attemptId: randomUUID(),
    intentId: input.intentId,
    ...(normalizeWallet(input.signerAddress) ? { signerAddress: normalizeWallet(input.signerAddress) } : {}),
    ...(input.rpcProvider ? { rpcProvider: input.rpcProvider } : {}),
    ...(input.queueLabel ? { queueLabel: input.queueLabel } : {}),
    ...(typeof input.nonce === "number" ? { nonce: input.nonce } : {}),
    status: input.status ?? "processing",
    createdAt: now,
  };
  if (shouldUsePostgres()) {
    await postgresQuery(
      `
        insert into game.chain_tx_attempts (
          attempt_id, intent_id, signer_address, rpc_provider, queue_label, nonce, status, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, to_timestamp($8::double precision / 1000.0)
        )
      `,
      [
        attempt.attemptId,
        attempt.intentId,
        attempt.signerAddress ?? null,
        attempt.rpcProvider ?? null,
        attempt.queueLabel ?? null,
        attempt.nonce ?? null,
        attempt.status,
        attempt.createdAt,
      ]
    );
  } else {
    memoryAttempts.set(attempt.attemptId, attempt);
  }
  return attempt;
}

export async function updateChainTxAttempt(
  attemptId: string,
  patch: Partial<ChainTxAttemptRecord>
): Promise<ChainTxAttemptRecord | null> {
  let current: ChainTxAttemptRecord | null = null;
  if (shouldUsePostgres()) {
    const { rows } = await postgresQuery<ChainTxAttemptRow>(
      `
        select
          attempt_id,
          intent_id,
          signer_address,
          rpc_provider,
          queue_label,
          nonce::text as nonce,
          tx_hash,
          status,
          error_code,
          error_message,
          gas_limit,
          gas_price,
          max_fee_per_gas,
          max_priority_fee_per_gas,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          case when submitted_at is null then null else floor(extract(epoch from submitted_at) * 1000)::text end as submitted_at_ms,
          case when confirmed_at is null then null else floor(extract(epoch from confirmed_at) * 1000)::text end as confirmed_at_ms
        from game.chain_tx_attempts
        where attempt_id = $1
        limit 1
      `,
      [attemptId]
    );
    current = rows[0] ? fromAttemptRow(rows[0]) : null;
  } else {
    current = memoryAttempts.get(attemptId) ?? null;
  }
  if (!current) return null;

  const updated: ChainTxAttemptRecord = {
    ...current,
    ...patch,
    attemptId: current.attemptId,
    intentId: current.intentId,
  };

  if (shouldUsePostgres()) {
    await postgresQuery(
      `
        update game.chain_tx_attempts
        set signer_address = $2,
            rpc_provider = $3,
            queue_label = $4,
            nonce = $5,
            tx_hash = $6,
            status = $7,
            error_code = $8,
            error_message = $9,
            gas_limit = $10,
            gas_price = $11,
            max_fee_per_gas = $12,
            max_priority_fee_per_gas = $13,
            submitted_at = case when $14::bigint is null then null else to_timestamp($14::double precision / 1000.0) end,
            confirmed_at = case when $15::bigint is null then null else to_timestamp($15::double precision / 1000.0) end
        where attempt_id = $1
      `,
      [
        attemptId,
        updated.signerAddress ?? null,
        updated.rpcProvider ?? null,
        updated.queueLabel ?? null,
        updated.nonce ?? null,
        updated.txHash ?? null,
        updated.status,
        updated.errorCode ?? null,
        updated.errorMessage ?? null,
        updated.gasLimit ?? null,
        updated.gasPrice ?? null,
        updated.maxFeePerGas ?? null,
        updated.maxPriorityFeePerGas ?? null,
        updated.submittedAt ?? null,
        updated.confirmedAt ?? null,
      ]
    );
  } else {
    memoryAttempts.set(attemptId, updated);
  }

  return updated;
}

export async function getChainIntentStats(types?: string[]): Promise<Record<string, { pending: number; processing: number; retryable: number; confirmed: number }>> {
  const output: Record<string, { pending: number; processing: number; retryable: number; confirmed: number }> = {};
  if (shouldUsePostgres()) {
    const values: unknown[] = [];
    let filter = "";
    if (types && types.length > 0) {
      filter = `where type = any($1::text[])`;
      values.push(types);
    }
    const { rows } = await postgresQuery<{ type: string; status: ChainIntentStatus; count: string }>(
      `
        select type, status, count(*)::text as count
        from game.chain_write_intents
        ${filter}
        group by type, status
      `,
      values
    );
    for (const row of rows) {
      output[row.type] ??= { pending: 0, processing: 0, retryable: 0, confirmed: 0 };
      if (row.status === "pending") output[row.type].pending = Number(row.count) || 0;
      if (row.status === "processing" || row.status === "submitted") output[row.type].processing += Number(row.count) || 0;
      if (row.status === "retryable" || row.status === "waiting_funds") output[row.type].retryable += Number(row.count) || 0;
      if (row.status === "confirmed") output[row.type].confirmed = Number(row.count) || 0;
    }
    return output;
  }

  if (!isMemoryFallbackAllowed()) {
    if (!getRedis()) assertRedisAvailable("chainIntentStore.getChainIntentStats");
  }
  for (const row of memoryIntents.values()) {
    if (types && types.length > 0 && !types.includes(row.type)) continue;
    output[row.type] ??= { pending: 0, processing: 0, retryable: 0, confirmed: 0 };
    if (row.status === "pending") output[row.type].pending += 1;
    if (row.status === "processing" || row.status === "submitted") output[row.type].processing += 1;
    if (row.status === "retryable" || row.status === "waiting_funds") output[row.type].retryable += 1;
    if (row.status === "confirmed") output[row.type].confirmed += 1;
  }
  return output;
}

export async function listChainIntents(filters?: {
  type?: string;
  walletAddress?: string;
  statuses?: ChainIntentStatus[];
  limit?: number;
  offset?: number;
}): Promise<ChainWriteIntentRecord[]> {
  const limit = Math.max(1, Math.min(filters?.limit ?? 100, 500));
  const offset = Math.max(0, filters?.offset ?? 0);
  if (shouldUsePostgres()) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    let index = 1;
    if (filters?.type) {
      clauses.push(`type = $${index++}`);
      values.push(filters.type);
    }
    if (filters?.walletAddress) {
      clauses.push(`wallet_address = $${index++}`);
      values.push(normalizeWallet(filters.walletAddress)!);
    }
    if (filters?.statuses && filters.statuses.length > 0) {
      clauses.push(`status = any($${index++}::text[])`);
      values.push(filters.statuses);
    }
    values.push(limit, offset);
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const { rows } = await postgresQuery<ChainIntentRow>(
      `
        select
          intent_id,
          type,
          aggregate_type,
          aggregate_key,
          wallet_address,
          payload_json,
          priority,
          status,
          floor(extract(epoch from available_at) * 1000)::text as available_at_ms,
          case when claimed_at is null then null else floor(extract(epoch from claimed_at) * 1000)::text end as claimed_at_ms,
          claim_owner,
          case when last_submitted_at is null then null else floor(extract(epoch from last_submitted_at) * 1000)::text end as last_submitted_at_ms,
          case when confirmed_at is null then null else floor(extract(epoch from confirmed_at) * 1000)::text end as confirmed_at_ms,
          attempt_count,
          tx_hash,
          last_error,
          superseded_by,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms
        from game.chain_write_intents
        ${where}
        order by updated_at desc
        limit $${index++}
        offset $${index}
      `,
      values
    );
    return rows.map(fromIntentRow);
  }

  const normalizedWallet = normalizeWallet(filters?.walletAddress);
  return Array.from(memoryIntents.values())
    .filter((intent) =>
      (!filters?.type || intent.type === filters.type) &&
      (!normalizedWallet || intent.walletAddress === normalizedWallet) &&
      (!filters?.statuses || filters.statuses.length === 0 || filters.statuses.includes(intent.status))
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(offset, offset + limit);
}

export async function listChainTxAttempts(filters?: {
  intentId?: string;
  limit?: number;
  offset?: number;
}): Promise<ChainTxAttemptRecord[]> {
  const limit = Math.max(1, Math.min(filters?.limit ?? 100, 500));
  const offset = Math.max(0, filters?.offset ?? 0);
  if (shouldUsePostgres()) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    let index = 1;
    if (filters?.intentId) {
      clauses.push(`intent_id = $${index++}`);
      values.push(filters.intentId);
    }
    values.push(limit, offset);
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const { rows } = await postgresQuery<ChainTxAttemptRow>(
      `
        select
          attempt_id,
          intent_id,
          signer_address,
          rpc_provider,
          queue_label,
          nonce::text as nonce,
          tx_hash,
          status,
          error_code,
          error_message,
          gas_limit,
          gas_price,
          max_fee_per_gas,
          max_priority_fee_per_gas,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          case when submitted_at is null then null else floor(extract(epoch from submitted_at) * 1000)::text end as submitted_at_ms,
          case when confirmed_at is null then null else floor(extract(epoch from confirmed_at) * 1000)::text end as confirmed_at_ms
        from game.chain_tx_attempts
        ${where}
        order by created_at desc
        limit $${index++}
        offset $${index}
      `,
      values
    );
    return rows.map(fromAttemptRow);
  }

  return Array.from(memoryAttempts.values())
    .filter((attempt) => !filters?.intentId || attempt.intentId === filters.intentId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(offset, offset + limit);
}
