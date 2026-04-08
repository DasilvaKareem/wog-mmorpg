import { randomUUID } from "crypto";
import { getRedis } from "../redis.js";
import {
  getMarketplaceOperation,
  listMarketplaceOperationsByStatus,
  listMarketplaceOperationsByWallet,
  upsertMarketplaceOperation,
} from "../db/marketplaceStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

// ── Status & Type Enums ─────────────────────────────────────────────

export enum OperationStatus {
  CREATED = "CREATED",
  PAYMENT_PENDING = "PAYMENT_PENDING",
  PAYMENT_CONFIRMED = "PAYMENT_CONFIRMED",
  BURN_PENDING = "BURN_PENDING",
  BURNED_ON_SKALE = "BURNED_ON_SKALE",
  MINT_PENDING = "MINT_PENDING",
  MINTED_ON_TARGET = "MINTED_ON_TARGET",
  LISTED = "LISTED",
  SOLD = "SOLD",
  BID_PLACED = "BID_PLACED",
  RENTAL_ACTIVE = "RENTAL_ACTIVE",
  RENTAL_EXPIRED = "RENTAL_EXPIRED",
  IMPORT_PENDING = "IMPORT_PENDING",
  REIMPORTED = "REIMPORTED",
  FAILED = "FAILED",
  REPAIR_REQUIRED = "REPAIR_REQUIRED",
  CANCELLED = "CANCELLED",
}

export type OperationType =
  | "direct_sale"
  | "bid_fee"
  | "rental"
  | "export"
  | "import"
  | "mirror_mint"
  | "mirror_burn"
  | "repair";

export type PaymentRail = "base_usdc" | "none" | "opensea_external";

// ── Operation Interface ─────────────────────────────────────────────

export interface Operation {
  operationId: string;
  operationType: OperationType;
  assetType: "item" | "character";
  sourceChain: string;
  sourceContract: string;
  sourceTokenId: number;
  quantity: number;
  instanceId?: string;
  ownerWallet: string;
  buyerWallet?: string;
  targetChain?: string;
  targetContract?: string;
  targetTokenId?: number;
  paymentRail: PaymentRail;
  paymentReference?: string;
  snapshotUri?: string;
  status: OperationStatus;
  failureReason?: string;
  sourceTxHash?: string;
  targetTxHash?: string;
  listingId?: string;
  auctionId?: number;
  rentalId?: string;
  grantId?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Redis Key Helpers ───────────────────────────────────────────────

const KEY_OP = (id: string) => `mktplace:op:${id}`;
const KEY_OPS_WALLET = (w: string) => `mktplace:ops:wallet:${w.toLowerCase()}`;
const KEY_OPS_STATUS = (s: string) => `mktplace:ops:status:${s}`;
const KEY_LOCK = (id: string) => `mktplace:lock:${id}`;

// ── Public API ──────────────────────────────────────────────────────

export type CreateOperationParams = Omit<
  Operation,
  "operationId" | "status" | "createdAt" | "updatedAt"
> & { status?: OperationStatus };

export async function createOperation(
  params: CreateOperationParams
): Promise<Operation> {
  const now = Date.now();
  const op: Operation = {
    ...params,
    operationId: randomUUID(),
    status: params.status ?? OperationStatus.CREATED,
    createdAt: now,
    updatedAt: now,
  };

  if (isPostgresConfigured()) {
    await upsertMarketplaceOperation(op);
  }
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.multi();
    pipeline.set(KEY_OP(op.operationId), JSON.stringify(op));
    pipeline.sadd(KEY_OPS_WALLET(op.ownerWallet), op.operationId);
    pipeline.sadd(KEY_OPS_STATUS(op.status), op.operationId);
    await pipeline.exec();
  }

  return op;
}

export async function getOperation(
  operationId: string
): Promise<Operation | null> {
  if (isPostgresConfigured()) {
    const op = await getMarketplaceOperation(operationId);
    if (op) return op;
  }
  const redis = getRedis();
  if (!redis) return null;

  const raw = await redis.get(KEY_OP(operationId));
  return raw ? (JSON.parse(raw) as Operation) : null;
}

export async function updateOperationStatus(
  operationId: string,
  newStatus: OperationStatus,
  extra?: Partial<
    Pick<
      Operation,
      | "failureReason"
      | "sourceTxHash"
      | "targetTxHash"
      | "paymentReference"
      | "snapshotUri"
      | "buyerWallet"
      | "listingId"
      | "auctionId"
      | "rentalId"
      | "grantId"
    >
  >
): Promise<Operation | null> {
  const op = await getOperation(operationId);
  if (!op) return null;

  const oldStatus = op.status;

  op.status = newStatus;
  op.updatedAt = Date.now();
  if (extra) Object.assign(op, extra);

  if (isPostgresConfigured()) {
    await upsertMarketplaceOperation(op);
  }
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.multi();
    pipeline.set(KEY_OP(operationId), JSON.stringify(op));
    if (oldStatus !== newStatus) {
      pipeline.srem(KEY_OPS_STATUS(oldStatus), operationId);
      pipeline.sadd(KEY_OPS_STATUS(newStatus), operationId);
    }
    await pipeline.exec();
  }

  return op;
}

export async function getOperationsByWallet(
  wallet: string
): Promise<Operation[]> {
  if (isPostgresConfigured()) {
    const ops = await listMarketplaceOperationsByWallet(wallet);
    if (ops.length > 0) return ops;
  }
  const redis = getRedis();
  if (!redis) return [];

  const ids: string[] = await redis.smembers(KEY_OPS_WALLET(wallet.toLowerCase()));
  if (!ids.length) return [];

  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(KEY_OP(id));
  const results = await pipeline.exec();

  const ops: Operation[] = [];
  for (const [err, raw] of results) {
    if (!err && raw) ops.push(JSON.parse(raw as string));
  }
  return ops;
}

export async function getOperationsByStatus(
  status: OperationStatus
): Promise<Operation[]> {
  if (isPostgresConfigured()) {
    const ops = await listMarketplaceOperationsByStatus(status);
    if (ops.length > 0) return ops;
  }
  const redis = getRedis();
  if (!redis) return [];

  const ids: string[] = await redis.smembers(KEY_OPS_STATUS(status));
  if (!ids.length) return [];

  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(KEY_OP(id));
  const results = await pipeline.exec();

  const ops: Operation[] = [];
  for (const [err, raw] of results) {
    if (!err && raw) ops.push(JSON.parse(raw as string));
  }
  return ops;
}

/**
 * Idempotency lookup: find an existing operation matching the given criteria.
 * Scans the wallet's operations for a match.
 */
export async function findOperationByKey(
  type: OperationType,
  ownerWallet: string,
  buyerWallet?: string,
  tokenId?: number,
  listingId?: string
): Promise<Operation | null> {
  const ops = await getOperationsByWallet(ownerWallet);
  for (const op of ops) {
    if (op.operationType !== type) continue;
    if (tokenId !== undefined && op.sourceTokenId !== tokenId) continue;
    if (listingId && op.listingId !== listingId) continue;
    if (
      buyerWallet &&
      op.buyerWallet?.toLowerCase() !== buyerWallet.toLowerCase()
    )
      continue;
    // Skip terminal states for idempotency (only match active/pending ops)
    if (
      op.status === OperationStatus.FAILED ||
      op.status === OperationStatus.CANCELLED
    )
      continue;
    return op;
  }
  return null;
}

// ── Distributed Lock ────────────────────────────────────────────────

export async function acquireOperationLock(
  operationId: string,
  ttlMs = 30_000
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const result = await redis.set(KEY_LOCK(operationId), "1", "PX", ttlMs, "NX");
  return result === "OK";
}

export async function releaseOperationLock(
  operationId: string
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  await redis.del(KEY_LOCK(operationId));
}
