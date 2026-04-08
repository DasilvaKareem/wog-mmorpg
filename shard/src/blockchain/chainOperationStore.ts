import { randomUUID } from "crypto";
import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "../redis.js";
import { isPostgresConfigured, postgresQuery } from "../db/postgres.js";

export type ChainOperationStatus =
  | "queued"
  | "submitted"
  | "confirmed"
  | "completed"
  | "failed_retryable"
  | "failed_permanent";

export interface ChainOperationRecord {
  operationId: string;
  type: string;
  subject: string;
  payload: string;
  status: ChainOperationStatus;
  attemptCount: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  lastAttemptAt?: number;
  completedAt?: number;
  txHash?: string;
  lastError?: string;
}

const memoryStore = new Map<string, ChainOperationRecord>();
const memoryPending = new Set<string>();
const memoryLocks = new Set<string>();
const KEY = (id: string) => `chainop:${id}`;
const KEY_TYPE = (type: string) => `chainop:type:${type}`;
const KEY_PENDING = "chainop:pending";
const KEY_LOCK = (id: string) => `chainop:lock:${id}`;
const CHAIN_OPERATION_LOCK_TTL_MS = Math.max(
  10_000,
  Number.parseInt(process.env.CHAIN_OPERATION_LOCK_TTL_MS ?? "30000", 10) || 30_000
);
const CHAIN_OPERATION_LOCK_HEARTBEAT_MS = Math.max(
  5_000,
  Math.min(
    CHAIN_OPERATION_LOCK_TTL_MS - 5_000,
    Number.parseInt(process.env.CHAIN_OPERATION_LOCK_HEARTBEAT_MS ?? "10000", 10) || 10_000
  )
);
const CHAIN_OPERATION_MAX_RETRIES = Math.max(
  0,
  Number.parseInt(process.env.CHAIN_OPERATION_MAX_RETRIES ?? "8", 10) || 8
);
const processorRegistry = new Map<string, ChainOperationProcessor<unknown>>();

type ChainOperationRow = {
  operation_id: string;
  type: string;
  subject: string;
  payload_json: unknown;
  status: ChainOperationStatus;
  attempt_count: number;
  next_attempt_at_ms: string;
  created_at_ms: string;
  updated_at_ms: string;
  last_attempt_at_ms: string | null;
  completed_at_ms: string | null;
  tx_hash: string | null;
  last_error: string | null;
};

export interface ChainOperationExecutionResult<T> {
  result: T;
  txHash?: string | null;
}

export type ChainOperationProcessor<T> = (
  record: ChainOperationRecord
) => Promise<ChainOperationExecutionResult<T>>;

function serialize(record: ChainOperationRecord): Record<string, string> {
  return {
    operationId: record.operationId,
    type: record.type,
    subject: record.subject,
    payload: record.payload,
    status: record.status,
    attemptCount: String(record.attemptCount),
    nextAttemptAt: String(record.nextAttemptAt),
    createdAt: String(record.createdAt),
    updatedAt: String(record.updatedAt),
    ...(record.lastAttemptAt != null && { lastAttemptAt: String(record.lastAttemptAt) }),
    ...(record.completedAt != null && { completedAt: String(record.completedAt) }),
    ...(record.txHash ? { txHash: record.txHash } : {}),
    ...(record.lastError ? { lastError: record.lastError } : {}),
  };
}

function deserialize(raw: Record<string, string>): ChainOperationRecord | null {
  if (!raw.operationId || !raw.type || !raw.subject || !raw.payload || !raw.status) return null;
  return {
    operationId: raw.operationId,
    type: raw.type,
    subject: raw.subject,
    payload: raw.payload,
    status: raw.status as ChainOperationStatus,
    attemptCount: Number(raw.attemptCount ?? "0") || 0,
    nextAttemptAt: Number(raw.nextAttemptAt ?? "0") || 0,
    createdAt: Number(raw.createdAt ?? "0") || 0,
    updatedAt: Number(raw.updatedAt ?? "0") || 0,
    ...(raw.lastAttemptAt ? { lastAttemptAt: Number(raw.lastAttemptAt) || 0 } : {}),
    ...(raw.completedAt ? { completedAt: Number(raw.completedAt) || 0 } : {}),
    ...(raw.txHash ? { txHash: raw.txHash } : {}),
    ...(raw.lastError ? { lastError: raw.lastError } : {}),
  };
}

function fromRow(row: ChainOperationRow): ChainOperationRecord {
  return {
    operationId: row.operation_id,
    type: row.type,
    subject: row.subject,
    payload: JSON.stringify(row.payload_json ?? {}),
    status: row.status,
    attemptCount: Number(row.attempt_count ?? 0) || 0,
    nextAttemptAt: Number(row.next_attempt_at_ms ?? "0") || 0,
    createdAt: Number(row.created_at_ms ?? "0") || 0,
    updatedAt: Number(row.updated_at_ms ?? "0") || 0,
    ...(row.last_attempt_at_ms ? { lastAttemptAt: Number(row.last_attempt_at_ms) || 0 } : {}),
    ...(row.completed_at_ms ? { completedAt: Number(row.completed_at_ms) || 0 } : {}),
    ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function shouldUsePostgres(): boolean {
  return isPostgresConfigured();
}

async function persist(record: ChainOperationRecord): Promise<void> {
  if (shouldUsePostgres()) {
    await postgresQuery(
      `
        insert into game.chain_operations (
          operation_id,
          type,
          subject,
          payload_json,
          status,
          attempt_count,
          next_attempt_at,
          created_at,
          updated_at,
          last_attempt_at,
          completed_at,
          tx_hash,
          last_error
        ) values (
          $1, $2, $3, $4::jsonb, $5, $6,
          to_timestamp($7::double precision / 1000.0),
          to_timestamp($8::double precision / 1000.0),
          to_timestamp($9::double precision / 1000.0),
          case when $10::bigint is null then null else to_timestamp($10::double precision / 1000.0) end,
          case when $11::bigint is null then null else to_timestamp($11::double precision / 1000.0) end,
          $12,
          $13
        )
        on conflict (operation_id)
        do update set
          type = excluded.type,
          subject = excluded.subject,
          payload_json = excluded.payload_json,
          status = excluded.status,
          attempt_count = excluded.attempt_count,
          next_attempt_at = excluded.next_attempt_at,
          updated_at = excluded.updated_at,
          last_attempt_at = excluded.last_attempt_at,
          completed_at = excluded.completed_at,
          tx_hash = excluded.tx_hash,
          last_error = excluded.last_error
      `,
      [
        record.operationId,
        record.type,
        record.subject,
        record.payload,
        record.status,
        record.attemptCount,
        record.nextAttemptAt,
        record.createdAt,
        record.updatedAt,
        record.lastAttemptAt ?? null,
        record.completedAt ?? null,
        record.txHash ?? null,
        record.lastError ?? null,
      ]
    );
    return;
  }

  const redis = getRedis();
  if (redis) {
    await redis.hset(KEY(record.operationId), serialize(record));
    const staleFields: string[] = [];
    if (record.lastAttemptAt == null) staleFields.push("lastAttemptAt");
    if (record.completedAt == null) staleFields.push("completedAt");
    if (record.txHash == null) staleFields.push("txHash");
    if (record.lastError == null) staleFields.push("lastError");
    if (staleFields.length > 0) await redis.hdel(KEY(record.operationId), ...staleFields);
    await redis.sadd(KEY_TYPE(record.type), record.operationId);
    if (record.status === "completed" || record.status === "failed_permanent") {
      await redis.zrem(KEY_PENDING, record.operationId);
    } else {
      await redis.zadd(KEY_PENDING, record.nextAttemptAt, record.operationId);
    }
    return;
  }

  assertRedisAvailable("chainOperationStore.persist");
  memoryStore.set(KEY(record.operationId), record);
  if (record.status === "completed" || record.status === "failed_permanent") {
    memoryPending.delete(record.operationId);
  } else {
    memoryPending.add(record.operationId);
  }
}

export async function createChainOperation(
  type: string,
  subject: string,
  payload: unknown,
): Promise<ChainOperationRecord> {
  const now = Date.now();
  const record: ChainOperationRecord = {
    operationId: randomUUID(),
    type,
    subject,
    payload: JSON.stringify(payload ?? {}),
    status: "queued",
    attemptCount: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await persist(record);
  return record;
}

export async function getChainOperation(operationId: string): Promise<ChainOperationRecord | null> {
  if (shouldUsePostgres()) {
    const { rows } = await postgresQuery<ChainOperationRow>(
      `
        select
          operation_id,
          type,
          subject,
          payload_json,
          status,
          attempt_count,
          floor(extract(epoch from next_attempt_at) * 1000)::text as next_attempt_at_ms,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms,
          case when last_attempt_at is null then null else floor(extract(epoch from last_attempt_at) * 1000)::text end as last_attempt_at_ms,
          case when completed_at is null then null else floor(extract(epoch from completed_at) * 1000)::text end as completed_at_ms,
          tx_hash,
          last_error
        from game.chain_operations
        where operation_id = $1
        limit 1
      `,
      [operationId]
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  const redis = getRedis();
  if (redis) {
    const raw = await redis.hgetall(KEY(operationId));
    if (!raw || Object.keys(raw).length === 0) return null;
    return deserialize(raw);
  }

  if (!isMemoryFallbackAllowed()) {
    assertRedisAvailable("chainOperationStore.get");
    return null;
  }
  return memoryStore.get(KEY(operationId)) ?? null;
}

export async function findLatestChainOperationByTypeAndSubject(
  type: string,
  subject: string,
): Promise<ChainOperationRecord | null> {
  if (shouldUsePostgres()) {
    const { rows } = await postgresQuery<ChainOperationRow>(
      `
        select
          operation_id,
          type,
          subject,
          payload_json,
          status,
          attempt_count,
          floor(extract(epoch from next_attempt_at) * 1000)::text as next_attempt_at_ms,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms,
          case when last_attempt_at is null then null else floor(extract(epoch from last_attempt_at) * 1000)::text end as last_attempt_at_ms,
          case when completed_at is null then null else floor(extract(epoch from completed_at) * 1000)::text end as completed_at_ms,
          tx_hash,
          last_error
        from game.chain_operations
        where type = $1 and subject = $2
        order by updated_at desc
        limit 1
      `,
      [type, subject]
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  const redis = getRedis();
  if (redis) {
    const ids = await redis.smembers(KEY_TYPE(type));
    let latest: ChainOperationRecord | null = null;
    for (const id of ids) {
      const raw = await redis.hgetall(KEY(id));
      if (!raw || Object.keys(raw).length === 0) continue;
      const record = deserialize(raw);
      if (!record || record.type !== type || record.subject !== subject) continue;
      if (!latest || record.updatedAt > latest.updatedAt) {
        latest = record;
      }
    }
    return latest;
  }

  if (!isMemoryFallbackAllowed()) {
    assertRedisAvailable("chainOperationStore.findLatestByTypeAndSubject");
    return null;
  }

  let latest: ChainOperationRecord | null = null;
  for (const record of memoryStore.values()) {
    if (record.type !== type || record.subject !== subject) continue;
    if (!latest || record.updatedAt > latest.updatedAt) {
      latest = record;
    }
  }
  return latest;
}

export async function updateChainOperation(
  operationId: string,
  patch: Partial<ChainOperationRecord>,
): Promise<ChainOperationRecord | null> {
  const current = await getChainOperation(operationId);
  if (!current) return null;
  const updated: ChainOperationRecord = {
    ...current,
    ...patch,
    operationId: current.operationId,
    type: current.type,
    subject: current.subject,
    payload: patch.payload ?? current.payload,
    updatedAt: Date.now(),
  };
  await persist(updated);
  return updated;
}

export async function markChainOperationRetryable(operationId: string, err: unknown): Promise<ChainOperationRecord | null> {
  const current = await getChainOperation(operationId);
  if (!current) return null;
  const attemptCount = current.attemptCount + 1;
  const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 240);
  if (attemptCount >= CHAIN_OPERATION_MAX_RETRIES) {
    return updateChainOperation(operationId, {
      status: "failed_permanent",
      attemptCount,
      nextAttemptAt: 0,
      lastAttemptAt: Date.now(),
      lastError: `max retries exceeded: ${lastError}`.slice(0, 240),
    });
  }
  return updateChainOperation(operationId, {
    status: "failed_retryable",
    attemptCount,
    nextAttemptAt: Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attemptCount, 5)),
    lastAttemptAt: Date.now(),
    lastError,
  });
}

export async function listDueChainOperations(type?: string): Promise<ChainOperationRecord[]> {
  if (shouldUsePostgres()) {
    const values: unknown[] = [];
    const typeFilter = type ? `and type = $1` : "";
    if (type) values.push(type);
    const { rows } = await postgresQuery<ChainOperationRow>(
      `
        select
          operation_id,
          type,
          subject,
          payload_json,
          status,
          attempt_count,
          floor(extract(epoch from next_attempt_at) * 1000)::text as next_attempt_at_ms,
          floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
          floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms,
          case when last_attempt_at is null then null else floor(extract(epoch from last_attempt_at) * 1000)::text end as last_attempt_at_ms,
          case when completed_at is null then null else floor(extract(epoch from completed_at) * 1000)::text end as completed_at_ms,
          tx_hash,
          last_error
        from game.chain_operations
        where next_attempt_at <= now()
          ${typeFilter}
          and status not in ('submitted', 'confirmed', 'completed', 'failed_permanent')
        order by next_attempt_at asc
      `,
      values
    );
    return rows.map(fromRow);
  }

  const redis = getRedis();
  let ids: string[] = [];
  if (redis) {
    ids = await redis.zrangebyscore(KEY_PENDING, 0, Date.now());
  } else if (isMemoryFallbackAllowed()) {
    ids = Array.from(memoryPending.values());
  } else {
    assertRedisAvailable("chainOperationStore.listDue");
  }

  const records: ChainOperationRecord[] = [];
  for (const id of ids) {
    const record = await getChainOperation(id);
    if (!record) continue;
    if (type && record.type !== type) continue;
    if (record.status === "submitted" || record.status === "confirmed" || record.status === "completed" || record.status === "failed_permanent") {
      continue;
    }
    records.push(record);
  }
  return records;
}

export async function acquireChainOperationLock(operationId: string, ttlMs = CHAIN_OPERATION_LOCK_TTL_MS): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    const result = await redis.set(KEY_LOCK(operationId), "1", "PX", ttlMs, "NX");
    return result === "OK";
  }
  if (memoryLocks.has(operationId)) return false;
  memoryLocks.add(operationId);
  return true;
}

export async function extendChainOperationLock(operationId: string, ttlMs = CHAIN_OPERATION_LOCK_TTL_MS): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    return (await redis.pexpire(KEY_LOCK(operationId), ttlMs)) === 1;
  }
  return memoryLocks.has(operationId);
}

export async function releaseChainOperationLock(operationId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.del(KEY_LOCK(operationId));
    return;
  }
  memoryLocks.delete(operationId);
}

function startChainOperationLockHeartbeat(
  operationId: string,
  ttlMs = CHAIN_OPERATION_LOCK_TTL_MS,
  intervalMs = CHAIN_OPERATION_LOCK_HEARTBEAT_MS
): NodeJS.Timeout | null {
  if (!getRedis()) return null;
  return setInterval(() => {
    void extendChainOperationLock(operationId, ttlMs).catch(() => {});
  }, intervalMs);
}

async function markChainOperationSubmitted(
  operationId: string,
  attemptCount: number,
  ttlMs = CHAIN_OPERATION_LOCK_TTL_MS
): Promise<ChainOperationRecord | null> {
  return updateChainOperation(operationId, {
    status: "submitted",
    attemptCount,
    lastAttemptAt: Date.now(),
    nextAttemptAt: Date.now() + ttlMs,
    lastError: undefined,
  });
}

export async function runTrackedChainOperation<T>(
  type: string,
  subject: string,
  payload: unknown,
  executor: (record: ChainOperationRecord) => Promise<{ result: T; txHash?: string | null }>,
): Promise<T> {
  const record = await createChainOperation(type, subject, payload);
  if (!(await acquireChainOperationLock(record.operationId, CHAIN_OPERATION_LOCK_TTL_MS))) {
    throw new Error(`Failed to acquire chain operation lock for ${record.operationId}`);
  }
  await markChainOperationSubmitted(record.operationId, 1, CHAIN_OPERATION_LOCK_TTL_MS);
  const heartbeat = startChainOperationLockHeartbeat(record.operationId, CHAIN_OPERATION_LOCK_TTL_MS);

  try {
    const { result, txHash } = await executor(record);
    await updateChainOperation(record.operationId, {
      status: "completed",
      completedAt: Date.now(),
      txHash: txHash ?? undefined,
      lastError: undefined,
    });
    return result;
  } catch (err) {
    await markChainOperationRetryable(record.operationId, err);
    throw err;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await releaseChainOperationLock(record.operationId).catch(() => {});
  }
}

export function getChainOperationMaxRetries(): number {
  return CHAIN_OPERATION_MAX_RETRIES;
}

export function registerChainOperationProcessor<T>(
  type: string,
  processor: ChainOperationProcessor<T>
): void {
  processorRegistry.set(type, processor as ChainOperationProcessor<unknown>);
}

export async function processTrackedChainOperation<T = unknown>(
  operationId: string
): Promise<T | null> {
  const record = await getChainOperation(operationId);
  if (!record) return null;
  const now = Date.now();
  const submittedStillLeased =
    record.status === "submitted" &&
    record.nextAttemptAt > now;
  if (submittedStillLeased || record.status === "confirmed" || record.status === "completed" || record.status === "failed_permanent") {
    return null;
  }
  const processor = processorRegistry.get(record.type);
  if (!processor) {
    throw new Error(`No chain operation processor registered for type ${record.type}`);
  }
  if (!(await acquireChainOperationLock(operationId, CHAIN_OPERATION_LOCK_TTL_MS))) return null;
  await markChainOperationSubmitted(operationId, record.attemptCount + 1, CHAIN_OPERATION_LOCK_TTL_MS);
  const heartbeat = startChainOperationLockHeartbeat(operationId, CHAIN_OPERATION_LOCK_TTL_MS);

  try {
    const { result, txHash } = await processor(record);
    await updateChainOperation(operationId, {
      status: "completed",
      completedAt: Date.now(),
      txHash: txHash ?? undefined,
      lastError: undefined,
    });
    return result as T;
  } catch (err) {
    await markChainOperationRetryable(operationId, err);
    throw err;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await releaseChainOperationLock(operationId).catch(() => {});
  }
}

export async function executeRegisteredChainOperation<T>(
  type: string,
  subject: string,
  payload: unknown,
): Promise<T> {
  const record = await createChainOperation(type, subject, payload);
  const result = await processTrackedChainOperation<T>(record.operationId);
  if (result === null) {
    throw new Error(`Chain operation ${type} did not run`);
  }
  return result;
}

export async function processPendingTrackedChainOperations(
  logger: { error: (err: unknown, msg?: string) => void } = console,
  types?: string[],
  maxPerTick = 8
): Promise<number> {
  const due = await listDueChainOperations();
  let processed = 0;
  const typeFilter = types ? new Set(types) : null;
  for (const op of due) {
    if (processed >= maxPerTick) break;
    if (typeFilter && !typeFilter.has(op.type)) continue;
    if (!processorRegistry.has(op.type)) continue;
    try {
      await processTrackedChainOperation(op.operationId);
    } catch (err) {
      logger.error(err, `[chainOperationStore] worker failed for ${op.operationId}`);
    }
    processed++;
  }
  return processed;
}

let workerTimer: NodeJS.Timeout | null = null;

export function startChainOperationReplayWorker(
  logger: { error: (err: unknown, msg?: string) => void } = console,
  intervalMs = 5_000,
  startupDelayMs = 30_000
): void {
  if (workerTimer) return;
  const tick = async () => {
    await processPendingTrackedChainOperations(logger);
  };
  // Delay first tick to avoid a crash-recovery burst: all pending ops were due
  // immediately on restart, so we stagger them instead of firing all at once.
  setTimeout(() => {
    void tick().catch((err) => logger.error(err, "[chainOperationStore] initial replay tick failed"));
    workerTimer = setInterval(() => {
      tick().catch((err) => logger.error(err, "[chainOperationStore] replay tick failed"));
    }, intervalMs);
  }, startupDelayMs);
}
