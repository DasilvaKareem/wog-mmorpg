/**
 * Reputation Chain Layer
 * Fire-and-forget bridge between the in-memory ReputationManager and
 * the WoGReputationRegistry contract on BITE v2.
 *
 * All functions silently swallow errors — chain failures never break gameplay.
 *
 * submitFeedbackOnChain() now queues deltas and flushes every 15s via
 * batchUpdateReputationOnChain() to reduce individual RPC transactions.
 */

import { ethers } from "ethers";
import { biteWallet } from "../blockchain/biteChain.js";
import { normalizeAgentId } from "../erc8004/agentResolution.js";

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

function toIdentityId(agentId: string | bigint): bigint {
  return BigInt(normalizeAgentId(agentId));
}

/**
 * Initialize reputation on-chain for a new agent (fire-and-forget).
 * Idempotent — the contract skips if already initialized.
 */
export async function initReputationOnChain(
  agentId: string | bigint
): Promise<boolean> {
  if (!reputationContract) return false;
  try {
    const identityId = toIdentityId(agentId);
    const tx = await reputationContract.initializeReputation(identityId);
    await tx.wait();
    console.log(`[reputationChain] init ${normalizeAgentId(agentId)} (id=${identityId})`);
    return true;
  } catch (err) {
    console.warn(`[reputationChain] init failed for ${normalizeAgentId(agentId)}:`, err);
    return false;
  }
}

// =============================================================================
//  Batched feedback queue — accumulates deltas and flushes every 15s
// =============================================================================

const FLUSH_INTERVAL_MS = 15_000;

/** Pending deltas per agent: [combat, economic, social, crafting, agent] */
const pendingFeedback = new Map<string, [number, number, number, number, number]>();

function mergePendingFeedback(
  agentId: string,
  deltas: [number, number, number, number, number]
): void {
  const existing = pendingFeedback.get(agentId) ?? [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    existing[i] += deltas[i];
  }
  pendingFeedback.set(agentId, existing);
}

/**
 * Submit feedback on-chain for a single category.
 * Instead of firing an immediate RPC transaction, the delta is queued
 * and flushed every 15s via batchUpdateReputationOnChain().
 */
export async function submitFeedbackOnChain(
  agentId: string | bigint,
  category: number,
  delta: number,
  _reason: string
): Promise<void> {
  if (!reputationContract) return;
  if (category < 0 || category > 4) return;

  const key = normalizeAgentId(agentId);
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

  for (const [agentId, deltas] of batch) {
    // Skip wallets with all-zero deltas
    if (deltas.every((d) => d === 0)) continue;

    try {
      const ok = await batchUpdateReputationOnChain(agentId, deltas, "batched-feedback");
      if (!ok) {
        mergePendingFeedback(agentId, deltas);
      }
    } catch (err) {
      console.warn(`[reputationChain] flush failed for ${agentId}:`, err);
      mergePendingFeedback(agentId, deltas);
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
  agentId: string | bigint,
  deltas: [number, number, number, number, number],
  reason: string
): Promise<boolean> {
  if (!reputationContract) return false;
  try {
    const identityId = toIdentityId(agentId);
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
    return true;
  } catch (err) {
    console.warn(
      `[reputationChain] batchUpdate failed for ${normalizeAgentId(agentId)}:`,
      err
    );
    return false;
  }
}
