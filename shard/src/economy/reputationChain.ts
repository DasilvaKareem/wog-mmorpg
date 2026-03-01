/**
 * Reputation Chain Layer
 * Fire-and-forget bridge between the in-memory ReputationManager and
 * the WoGReputationRegistry contract on BITE v2.
 *
 * All functions silently swallow errors — chain failures never break gameplay.
 *
 * Key insight: every Ethereum address is a uint160 that fits in uint256,
 * so walletAddress → identityId is deterministic with no separate registry.
 *
 * submitFeedbackOnChain() now queues deltas and flushes every 15s via
 * batchUpdateReputationOnChain() to reduce individual RPC transactions.
 */

import { ethers } from "ethers";
import { biteWallet } from "../blockchain/biteChain.js";

const REPUTATION_CONTRACT_ADDRESS = process.env.REPUTATION_REGISTRY_ADDRESS;

const REPUTATION_ABI = [
  "function initializeReputation(uint256 identityId) external",
  "function submitFeedback(uint256 identityId, uint8 category, int256 delta, string reason) external",
  "function batchUpdateReputation(uint256 identityId, int256[5] deltas, string reason) external",
  "function getReputation(uint256 identityId) external view returns (tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256))",
  "function authorizeReporter(address reporter) external",
];

const reputationContract =
  REPUTATION_CONTRACT_ADDRESS && biteWallet
    ? new ethers.Contract(REPUTATION_CONTRACT_ADDRESS, REPUTATION_ABI, biteWallet)
    : null;

if (!reputationContract) {
  if (!REPUTATION_CONTRACT_ADDRESS) {
    console.warn(
      "[reputationChain] REPUTATION_REGISTRY_ADDRESS not set — on-chain reputation disabled"
    );
  }
}

/** Convert a wallet address to its uint256 identity ID (address is uint160, fits in uint256) */
function walletToIdentityId(walletAddress: string): bigint {
  return BigInt(walletAddress.toLowerCase());
}

/**
 * Initialize reputation on-chain for a new wallet (fire-and-forget).
 * Idempotent — the contract skips if already initialized.
 */
export async function initReputationOnChain(
  walletAddress: string
): Promise<void> {
  if (!reputationContract) return;
  try {
    const identityId = walletToIdentityId(walletAddress);
    const tx = await reputationContract.initializeReputation(identityId);
    await tx.wait();
    console.log(`[reputationChain] init ${walletAddress} (id=${identityId})`);
  } catch (err) {
    console.warn(`[reputationChain] init failed for ${walletAddress}:`, err);
  }
}

// =============================================================================
//  Batched feedback queue — accumulates deltas and flushes every 15s
// =============================================================================

const FLUSH_INTERVAL_MS = 15_000;

/** Pending deltas per wallet: [combat, economic, social, crafting, agent] */
const pendingFeedback = new Map<string, [number, number, number, number, number]>();

/**
 * Submit feedback on-chain for a single category.
 * Instead of firing an immediate RPC transaction, the delta is queued
 * and flushed every 15s via batchUpdateReputationOnChain().
 */
export async function submitFeedbackOnChain(
  walletAddress: string,
  category: number,
  delta: number,
  _reason: string
): Promise<void> {
  if (!reputationContract) return;
  if (category < 0 || category > 4) return;

  const key = walletAddress.toLowerCase();
  let deltas = pendingFeedback.get(key);
  if (!deltas) {
    deltas = [0, 0, 0, 0, 0];
    pendingFeedback.set(key, deltas);
  }
  deltas[category] += delta;
}

/** Flush all pending feedback as batch transactions. */
async function flushPendingFeedback(): Promise<void> {
  if (pendingFeedback.size === 0) return;

  // Snapshot and clear so new deltas during flush go to the next batch
  const batch = new Map(pendingFeedback);
  pendingFeedback.clear();

  for (const [wallet, deltas] of batch) {
    // Skip wallets with all-zero deltas
    if (deltas.every((d) => d === 0)) continue;

    try {
      await batchUpdateReputationOnChain(wallet, deltas, "batched-feedback");
    } catch (err) {
      console.warn(`[reputationChain] flush failed for ${wallet}:`, err);
    }
  }
}

// Start the flush interval
setInterval(() => {
  flushPendingFeedback().catch((err) => {
    console.warn("[reputationChain] flushPendingFeedback error:", err);
  });
}, FLUSH_INTERVAL_MS);

/**
 * Batch update multiple reputation categories on-chain (fire-and-forget).
 * deltas is [combat, economic, social, crafting, agent] indexed by category enum.
 */
export async function batchUpdateReputationOnChain(
  walletAddress: string,
  deltas: [number, number, number, number, number],
  reason: string
): Promise<void> {
  if (!reputationContract) return;
  try {
    const identityId = walletToIdentityId(walletAddress);
    const bigDeltas = deltas.map(BigInt) as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    const tx = await reputationContract.batchUpdateReputation(
      identityId,
      bigDeltas,
      reason
    );
    await tx.wait();
  } catch (err) {
    console.warn(
      `[reputationChain] batchUpdate failed for ${walletAddress}:`,
      err
    );
  }
}
