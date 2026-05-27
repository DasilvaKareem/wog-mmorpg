import { BASE_MAINNET_CHAIN_ID, SKALE_BASE_CHAIN_ID } from "../chain.js";

/**
 * Centralized bridge config — read from env at import time.
 * All bridge code reads from these constants instead of touching process.env.
 */

function readBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return v === "true" || v === "1" || v.toLowerCase() === "yes";
}

function readNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const BRIDGE_ENABLED = readBool("BRIDGE_ENABLED", false);

/** TTL applied to a signed claim before it must be redeemed on-chain. */
export const BRIDGE_CLAIM_TTL_SECONDS = readNumber("BRIDGE_CLAIM_TTL_SECONDS", 3600);

/** Per-wallet bridges allowed per rolling hour. */
export const BRIDGE_RATE_LIMIT_PER_HOUR = readNumber("BRIDGE_RATE_LIMIT_PER_HOUR", 10);

/** Global ceiling per rolling hour across all wallets. */
export const BRIDGE_RATE_LIMIT_GLOBAL_PER_HOUR = readNumber("BRIDGE_RATE_LIMIT_GLOBAL_PER_HOUR", 100);

/** Listener polling cadence (ms). Lower = more responsive, higher = lighter on RPC. */
export const BRIDGE_LISTENER_POLL_MS = readNumber("BRIDGE_LISTENER_POLL_MS", 5000);

/** Block confirmations before an event is treated as final. */
export const BRIDGE_LISTENER_CONFIRMATIONS = readNumber("BRIDGE_LISTENER_CONFIRMATIONS", 1);

/** Max blocks per getLogs call. */
export const BRIDGE_LISTENER_MAX_BLOCKS = readNumber("BRIDGE_LISTENER_MAX_BLOCKS", 2000);

/** Refund worker polling cadence (ms). */
export const BRIDGE_REFUND_WORKER_POLL_MS = readNumber("BRIDGE_REFUND_WORKER_POLL_MS", 5 * 60 * 1000);

export const BASE_MAINNET_CHARACTER_CONTRACT = (
  process.env.BASE_MAINNET_CHARACTER_CONTRACT || ""
).toLowerCase() as `0x${string}` | "";

export const SKALE_BRIDGE_ADAPTER_CONTRACT = (
  process.env.SKALE_BRIDGE_ADAPTER_CONTRACT || ""
).toLowerCase() as `0x${string}` | "";

export const BASE_MAINNET_RPC_URL = process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org";

/** Returns true if the on-chain bridge contracts are deployed AND env is wired. */
export function bridgeContractsConfigured(): boolean {
  return Boolean(BASE_MAINNET_CHARACTER_CONTRACT) && Boolean(SKALE_BRIDGE_ADAPTER_CONTRACT);
}

export { BASE_MAINNET_CHAIN_ID, SKALE_BASE_CHAIN_ID };
