import { biteWallet } from "./biteChain.js";

const NONCE_ERROR_CODES = new Set(["-32004", "-32000", "-32603", "NONCE_EXPIRED"]);
const MAX_RETRIES = 3;

let biteTxChain: Promise<void> = Promise.resolve();

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

export async function queueServerWalletTransaction<T>(
  label: string,
  fn: () => Promise<T>,
  options?: { beforeAttempt?: () => Promise<void> | void }
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = biteTxChain;
  biteTxChain = gate;

  await previous;

  let lastError: unknown;
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await options?.beforeAttempt?.();
        return await fn();
      } catch (err) {
        lastError = err;
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
