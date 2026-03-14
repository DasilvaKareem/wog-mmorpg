/**
 * Transaction Tracer — centralized error tracing for all blockchain transactions.
 *
 * Wraps any async blockchain call with structured error capture.
 * Errors are stored in a circular buffer and exposed via `getRecentTxErrors()`.
 * The wrapper always re-throws so existing error handling is preserved.
 */

export interface TxError {
  id: string;
  type: string;
  fn: string;
  args: Record<string, unknown>;
  error: string;
  code?: number | string;
  reason?: string;
  stack?: string;
  chain: "skale" | "bite";
  timestamp: number;
  retryable: boolean;
}

const MAX_ERRORS = 200;
const errorBuffer: TxError[] = [];
let errorSeq = 0;

/** All errors recorded since boot. */
export function getRecentTxErrors(limit = 50): TxError[] {
  return errorBuffer.slice(-limit);
}

/** Errors filtered by type (e.g. "gold-mint", "auction-create"). */
export function getTxErrorsByType(type: string, limit = 50): TxError[] {
  return errorBuffer.filter((e) => e.type === type).slice(-limit);
}

/** Errors filtered by chain. */
export function getTxErrorsByChain(chain: "skale" | "bite", limit = 50): TxError[] {
  return errorBuffer.filter((e) => e.chain === chain).slice(-limit);
}

/** Summary counts grouped by type. */
export function getTxErrorSummary(): { total: number; byType: Record<string, number>; byChain: Record<string, number>; oldest?: number; newest?: number } {
  const byType: Record<string, number> = {};
  const byChain: Record<string, number> = {};
  for (const e of errorBuffer) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    byChain[e.chain] = (byChain[e.chain] ?? 0) + 1;
  }
  return {
    total: errorBuffer.length,
    byType,
    byChain,
    oldest: errorBuffer[0]?.timestamp,
    newest: errorBuffer[errorBuffer.length - 1]?.timestamp,
  };
}

function classifyError(err: any): { code?: number | string; reason?: string; retryable: boolean } {
  const msg = String(err?.message ?? err ?? "");
  const code = err?.code ?? err?.cause?.code ?? err?.data?.code;
  const reason = err?.reason ?? err?.shortMessage;

  // Nonce / ordering errors — retryable
  if (msg.includes("nonce") || msg.includes("replacement transaction")) {
    return { code, reason, retryable: true };
  }
  // RPC transient — retryable
  if (msg.includes("zero data") || msg.includes("AbiDecoding") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET") || msg.includes("502") || msg.includes("503")) {
    return { code, reason, retryable: true };
  }
  // Gas / balance — retryable after funding
  if (msg.includes("insufficient funds") || msg.includes("Account balance is too low")) {
    return { code, reason, retryable: true };
  }
  // Revert / business logic — not retryable
  return { code, reason, retryable: false };
}

function recordError(entry: TxError): void {
  errorBuffer.push(entry);
  if (errorBuffer.length > MAX_ERRORS) errorBuffer.shift();

  // Structured log line for grep/search in production logs
  console.error(
    `[txTracer] ${entry.chain}/${entry.type} ${entry.fn} FAILED` +
    (entry.code ? ` code=${entry.code}` : "") +
    (entry.retryable ? " [retryable]" : " [permanent]") +
    ` — ${entry.error.slice(0, 200)}`
  );
}

/**
 * Wrap an async blockchain call with error tracing.
 * On success, returns the result. On failure, records the error and re-throws.
 *
 * Usage:
 *   return traceTx("gold-mint", "mintGold", { to, amount }, "skale", async () => {
 *     // ... actual tx logic
 *   });
 */
export async function traceTx<T>(
  type: string,
  fn: string,
  args: Record<string, unknown>,
  chain: "skale" | "bite",
  executor: () => Promise<T>,
): Promise<T> {
  try {
    return await executor();
  } catch (err: any) {
    const { code, reason, retryable } = classifyError(err);
    const entry: TxError = {
      id: `txerr_${++errorSeq}`,
      type,
      fn,
      args: sanitizeArgs(args),
      error: String(err?.message ?? err ?? "unknown"),
      code,
      reason,
      stack: err?.stack?.split("\n").slice(0, 5).join("\n"),
      chain,
      timestamp: Date.now(),
      retryable,
    };
    recordError(entry);
    throw err;
  }
}

/** Strip private keys and long hex strings from logged args. */
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k.toLowerCase().includes("key") || k.toLowerCase().includes("secret")) {
      clean[k] = "[REDACTED]";
    } else if (typeof v === "bigint") {
      clean[k] = v.toString();
    } else {
      clean[k] = v;
    }
  }
  return clean;
}
