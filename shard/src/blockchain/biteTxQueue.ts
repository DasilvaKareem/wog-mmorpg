import { biteProvider, biteWallet } from "./biteChain.js";
import { randomUUID } from "crypto";
import { getRedis } from "../redis.js";

const NONCE_ERROR_CODES = new Set(["-32004", "-32000", "-32603", "NONCE_EXPIRED"]);
const MAX_RETRIES = 3;
const DEFAULT_RECEIPT_TIMEOUT_MS = 45_000;
const DEFAULT_SUBMISSION_TIMEOUT_MS = 20_000;
const DEFAULT_QUEUE_ATTEMPT_TIMEOUT_MS = 30_000;
const DISTRIBUTED_QUEUE_LOCK_TTL_MS = 45_000;
const DISTRIBUTED_QUEUE_LOCK_HEARTBEAT_MS = 10_000;
const DISTRIBUTED_QUEUE_LOCK_KEY_PREFIX = "blockchain:tx-lock";
const LOCAL_AUTOMINE_CHAIN_ID = "31337";

const signerTxChains = new Map<string, Promise<void>>();
let nextServerNonce: number | null = null;

function normalizeQueueKey(key: string): string {
  return key.trim().toLowerCase();
}

export function isLocalServerNonceMode(): boolean {
  const chainId = (process.env.SKALE_BASE_CHAIN_ID ?? "").trim();
  const shardChainEnv = (process.env.SHARD_CHAIN_ENV ?? "").trim().toLowerCase();
  const rpcUrl = (process.env.SKALE_BASE_RPC_URL ?? process.env.HARDHAT_RPC_URL ?? "").trim().toLowerCase();
  return (
    chainId === LOCAL_AUTOMINE_CHAIN_ID ||
    shardChainEnv === "local" ||
    rpcUrl === "http://127.0.0.1:8545" ||
    rpcUrl === "http://localhost:8545"
  );
}

export async function reserveServerNonce(): Promise<number | null> {
  if (!biteWallet) return null;
  const address = await biteWallet.getAddress();
  const chainNonce = await biteProvider.getTransactionCount(
    address,
    isLocalServerNonceMode() ? "latest" : "pending"
  );
  if (nextServerNonce == null || nextServerNonce < chainNonce) {
    nextServerNonce = chainNonce;
  }
  const reserved = nextServerNonce;
  nextServerNonce += 1;
  return reserved;
}

export function resetServerNonce(): void {
  nextServerNonce = null;
}

export function bumpServerNonceFloor(nonce: number): void {
  if (!Number.isFinite(nonce) || nonce < 0) return;
  if (nextServerNonce == null || nextServerNonce < nonce) {
    nextServerNonce = nonce;
  }
}

export function isTransientRpcSendError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  const code = String((err as any)?.code ?? (err as any)?.cause?.code ?? (err as any)?.data?.code ?? "");
  return (
    msg.includes("fetch failed") ||
    msg.includes("UND_ERR_SOCKET") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("socket hang up") ||
    msg.includes("502") ||
    msg.includes("503") ||
    code === "UND_ERR_SOCKET"
  );
}

function isNonceError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  const code = String((err as any)?.code ?? (err as any)?.cause?.code ?? (err as any)?.data?.code ?? "");
  return (
    NONCE_ERROR_CODES.has(code) ||
    msg.includes("nonce") ||
    msg.includes("replacement transaction")
  );
}

async function acquireDistributedQueueLock(queueKey: string, timeoutMs = DEFAULT_QUEUE_ATTEMPT_TIMEOUT_MS): Promise<null | {
  release: () => Promise<void>;
}> {
  const redis = getRedis();
  if (!redis) {
    return null;
  }

  const normalizedQueueKey = normalizeQueueKey(queueKey);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  const lockKey = `${DISTRIBUTED_QUEUE_LOCK_KEY_PREFIX}:${normalizedQueueKey}`;
  while (Date.now() < deadline) {
    const acquired = await redis.set(lockKey, token, "PX", DISTRIBUTED_QUEUE_LOCK_TTL_MS, "NX");
    if (acquired === "OK") {
      const heartbeat = setInterval(() => {
        void redis.pexpire(lockKey, DISTRIBUTED_QUEUE_LOCK_TTL_MS).catch(() => {});
      }, DISTRIBUTED_QUEUE_LOCK_HEARTBEAT_MS);

      return {
        release: async () => {
          clearInterval(heartbeat);
          const current = await redis.get(lockKey);
          if (current === token) {
            await redis.del(lockKey);
          }
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out acquiring distributed tx lock after ${timeoutMs}ms`);
}

export async function queueServerWalletTransaction<T>(
  label: string,
  fn: () => Promise<T>,
  options?: { beforeAttempt?: () => Promise<void> | void }
): Promise<T> {
  if (!biteWallet) {
    return await fn();
  }
  const address = await biteWallet.getAddress();
  return await queueAccountTransaction(address, label, fn, options);
}

export async function queueAccountTransaction<T>(
  accountAddress: string,
  label: string,
  fn: () => Promise<T>,
  options?: { beforeAttempt?: () => Promise<void> | void }
): Promise<T> {
  const queueKey = normalizeQueueKey(accountAddress);
  const serverQueueKey = biteWallet
    ? normalizeQueueKey(await biteWallet.getAddress())
    : "";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = signerTxChains.get(queueKey) ?? Promise.resolve();
  signerTxChains.set(queueKey, gate);

  await previous;
  const distributedLock = await acquireDistributedQueueLock(queueKey);

  let lastError: unknown;
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await options?.beforeAttempt?.();
        return await withBiteTimeout(
          fn(),
          `Timed out waiting for queued transaction attempt after ${DEFAULT_QUEUE_ATTEMPT_TIMEOUT_MS}ms`,
          DEFAULT_QUEUE_ATTEMPT_TIMEOUT_MS
        );
      } catch (err) {
        lastError = err;
        if (queueKey === serverQueueKey) {
          if (isLocalServerNonceMode()) {
            resetServerNonce();
          } else {
            const attemptedNonce = Number((err as { attemptedNonce?: unknown })?.attemptedNonce);
            if (Number.isFinite(attemptedNonce) && attemptedNonce >= 0) {
              bumpServerNonceFloor(attemptedNonce + 1);
            } else {
              resetServerNonce();
            }
          }
        }
        const retryable = isNonceError(err) || isTransientRpcSendError(err);
        if (!retryable || attempt >= MAX_RETRIES) break;
        const delayMs = 1000 * 2 ** attempt;
        console.warn(
          `[biteTxQueue] ${label} failed with ${isNonceError(err) ? "nonce" : "RPC"} error ` +
            `(attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delayMs}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } finally {
    await distributedLock?.release().catch(() => {});
    if (signerTxChains.get(queueKey) === gate) {
      signerTxChains.delete(queueKey);
    }
    release();
  }

  throw lastError;
}

export async function queueBiteTransaction<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return queueServerWalletTransaction(label, fn, {
    beforeAttempt: async () => {
      // thirdweb and ethers/BITE transactions share the same server private key in local/prod.
      // Reset the NonceManager before each send so it resyncs to the latest pending nonce.
      (biteWallet as { reset?: () => void } | null)?.reset?.();
    },
  });
}

export async function waitForBiteReceipt<T>(
  pending: Promise<T>,
  timeoutMs = DEFAULT_RECEIPT_TIMEOUT_MS
): Promise<T> {
  return await withBiteTimeout(pending, `Timed out waiting for on-chain receipt after ${timeoutMs}ms`, timeoutMs);
}

export async function waitForBiteSubmission<T>(
  pending: Promise<T>,
  timeoutMs = DEFAULT_SUBMISSION_TIMEOUT_MS
): Promise<T> {
  return await withBiteTimeout(pending, `Timed out waiting for on-chain submission after ${timeoutMs}ms`, timeoutMs);
}

async function withBiteTimeout<T>(
  pending: Promise<T>,
  message: string,
  timeoutMs: number,
): Promise<T> {
  return await Promise.race([
    pending,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs)
    ),
  ]);
}
