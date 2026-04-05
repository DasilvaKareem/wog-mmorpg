/**
 * Reputation Chain Layer
 * Fire-and-forget bridge between the in-memory ReputationManager and
 * the official ERC-8004 reputation registry.
 */

import { ethers } from "ethers";
import { biteSigner, biteWallet } from "../blockchain/biteChain.js";
import { queueBiteTransaction, reserveServerNonce, waitForBiteReceipt, waitForBiteSubmission } from "../blockchain/biteTxQueue.js";
import { traceTx } from "../blockchain/txTracer.js";
import { normalizeAgentId } from "../erc8004/agentResolution.js";
import { OFFICIAL_REPUTATION_REGISTRY_ABI } from "../erc8004/official.js";
import {
  acquireChainOperationLock,
  createChainOperation,
  getChainOperation,
  listDueChainOperations,
  markChainOperationRetryable,
  releaseChainOperationLock,
  updateChainOperation,
} from "../blockchain/chainOperationStore.js";

const REPUTATION_CONTRACT_ADDRESS = process.env.REPUTATION_REGISTRY_ADDRESS;

const reputationContract =
  REPUTATION_CONTRACT_ADDRESS && (biteSigner ?? biteWallet)
    ? new ethers.Contract(REPUTATION_CONTRACT_ADDRESS, OFFICIAL_REPUTATION_REGISTRY_ABI, biteSigner ?? biteWallet)
    : null;

if (!reputationContract && !REPUTATION_CONTRACT_ADDRESS) {
  console.warn("[reputationChain] REPUTATION_REGISTRY_ADDRESS not set — on-chain reputation disabled");
}

function tryToIdentityId(agentId: string | bigint): bigint | null {
  const normalized = normalizeAgentId(agentId);
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

const DEFAULT_SCORE = 500;
const MIN_SCORE = 0;
const MAX_SCORE = 1000;

/** Per-entity backoff cache: maps normalized agentId → timestamp when retry is allowed */
const reputationFailBackoff = new Map<string, number>();
const REPUTATION_FAIL_BACKOFF_MS = 60_000; // 60 seconds before retrying a failed entity

/**
 * Tracks entities that have had at least one successful giveFeedback() on-chain.
 * Only these entities will have data readable via getClients() — all others will
 * revert, so there's no point attempting reconciliation for them.
 */
const chainFeedbackExists = new Set<string>();

/** Returns true if this entity has had feedback successfully written on-chain. */
export function hasChainFeedback(agentId: string | bigint): boolean {
  return chainFeedbackExists.has(normalizeAgentId(agentId));
}

const CATEGORY_TAGS = ["combat", "economic", "social", "crafting", "agent"] as const;
type CategoryIndex = 0 | 1 | 2 | 3 | 4;

const REPUTATION_OP_TYPE = "reputation-feedback";

function getChainUpdateListeners(): Set<(agentId: string, reason: string) => void> {
  const globalKey = "__wogReputationChainListeners";
  const globalStore = globalThis as typeof globalThis & {
    [globalKey]?: Set<(agentId: string, reason: string) => void>;
  };
  if (!globalStore[globalKey]) {
    globalStore[globalKey] = new Set<(agentId: string, reason: string) => void>();
  }
  return globalStore[globalKey]!;
}

export interface OnChainReputationScore {
  combat: number;
  economic: number;
  social: number;
  crafting: number;
  agent: number;
  overall: number;
  lastUpdated: number;
}

function clampScore(value: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, value));
}

function notifyChainUpdate(agentId: string, reason: string): void {
  for (const listener of getChainUpdateListeners()) {
    try {
      listener(agentId, reason);
    } catch (err) {
      console.warn(`[reputationChain] chain update listener failed for ${agentId}:`, err);
    }
  }
}

export function registerReputationChainListener(
  listener: (agentId: string, reason: string) => void
): () => void {
  const listeners = getChainUpdateListeners();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function initReputationOnChain(
  agentId: string | bigint
): Promise<boolean> {
  notifyChainUpdate(normalizeAgentId(agentId), "init");
  return true;
}

async function getCategoryAverage(
  identityId: bigint,
  clients: string[],
  tag: string
): Promise<number> {
  if (!reputationContract || clients.length === 0) return 0;
  const [, summaryValue] = await reputationContract.getSummary(identityId, clients, tag, "");
  return Number(summaryValue ?? 0);
}

export async function getReputationOnChain(
  agentId: string | bigint
): Promise<OnChainReputationScore | null> {
  if (!reputationContract) return null;
  const identityId = tryToIdentityId(agentId);
  if (identityId === null) return null;

  const normalizedId = normalizeAgentId(agentId);

  // Check per-entity failure backoff — skip if recently failed
  const retryAfter = reputationFailBackoff.get(normalizedId);
  if (retryAfter && Date.now() < retryAfter) {
    return null;
  }

  try {
    const clients = Array.from(await reputationContract.getClients(identityId)) as string[];
    if (!clients || clients.length === 0) {
      return null;
    }

    const [combatAvg, economicAvg, socialAvg, craftingAvg, agentAvg] = await Promise.all(
      CATEGORY_TAGS.map((tag) => getCategoryAverage(identityId, clients, tag))
    );

    const combat = clampScore(DEFAULT_SCORE + combatAvg);
    const economic = clampScore(DEFAULT_SCORE + economicAvg);
    const social = clampScore(DEFAULT_SCORE + socialAvg);
    const crafting = clampScore(DEFAULT_SCORE + craftingAvg);
    const agent = clampScore(DEFAULT_SCORE + agentAvg);
    const overall = Math.round((combat + economic + social + crafting + agent) / 5);

    // Clear backoff on success
    reputationFailBackoff.delete(normalizedId);

    return {
      combat,
      economic,
      social,
      crafting,
      agent,
      overall,
      lastUpdated: Date.now(),
    };
  } catch (err) {
    // Set backoff so we don't spam retries for this entity
    reputationFailBackoff.set(normalizedId, Date.now() + REPUTATION_FAIL_BACKOFF_MS);
    const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
      ?? (err as Error)?.message ?? "unknown error";
    console.warn(`[reputationChain] getReputation failed for ${normalizedId} (backing off ${REPUTATION_FAIL_BACKOFF_MS / 1000}s): ${msg}`);
    return null;
  }
}

export async function submitFeedbackOnChain(
  agentId: string | bigint,
  category: number,
  delta: number,
  _reason: string
): Promise<void> {
  if (!reputationContract) return;
  if (category < 0 || category > 4) return;

  const key = normalizeAgentId(agentId);
  const deltas: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  deltas[category as CategoryIndex] = delta;
  const record = await createChainOperation(REPUTATION_OP_TYPE, key, { agentId: key, deltas, reason: _reason });
  void processReputationOperation(record.operationId).catch((err) => {
    console.warn(`[reputationChain] queue dispatch failed for ${key}: ${(err as Error)?.message ?? err}`);
  });
}

export async function batchUpdateReputationOnChain(
  agentId: string | bigint,
  deltas: [number, number, number, number, number],
  reason: string
): Promise<boolean> {
  if (!reputationContract) return false;

  try {
    const normalizedAgentId = normalizeAgentId(agentId);
    const identityId = tryToIdentityId(agentId);
    if (identityId === null) {
      return true;
    }

    for (let i = 0; i < CATEGORY_TAGS.length; i++) {
      const delta = deltas[i];
      if (delta === 0) continue;

      await traceTx("reputation-feedback", "giveFeedback", { agentId: normalizedAgentId, category: CATEGORY_TAGS[i], delta }, "bite", () =>
        queueBiteTransaction(`reputation-feedback:${normalizedAgentId}:${CATEGORY_TAGS[i]}`, async () => {
          const tx = await waitForBiteSubmission(reputationContract.giveFeedback(
            identityId,
            BigInt(delta),
            0,
            CATEGORY_TAGS[i],
            reason,
            "",
            "",
            ethers.ZeroHash,
            { nonce: await reserveServerNonce() ?? undefined }
          ));
          await waitForBiteReceipt(tx.wait());
        })
      );
    }

    chainFeedbackExists.add(normalizedAgentId);
    notifyChainUpdate(normalizedAgentId, "feedback");
    return true;
  } catch (err) {
    console.warn(`[reputationChain] feedback update failed for ${normalizeAgentId(agentId)}:`, (err as Error)?.message ?? err);
    return false;
  }
}

export async function processReputationOperation(operationId: string): Promise<void> {
  const record = await getChainOperation(operationId);
  if (!record || record.type !== REPUTATION_OP_TYPE) return;
  if (!(await acquireChainOperationLock(operationId, 30_000))) return;

  try {
    await updateChainOperation(operationId, {
      status: "submitted",
      attemptCount: record.attemptCount + 1,
      lastAttemptAt: Date.now(),
      nextAttemptAt: Date.now(),
      lastError: undefined,
    });
    const payload = JSON.parse(record.payload) as { agentId: string; deltas: [number, number, number, number, number]; reason?: string };
    const ok = await batchUpdateReputationOnChain(payload.agentId, payload.deltas, payload.reason ?? "queued-feedback");
    if (!ok) throw new Error(`Failed to reconcile reputation for ${payload.agentId}`);
    await updateChainOperation(operationId, {
      status: "completed",
      completedAt: Date.now(),
      lastError: undefined,
    });
  } catch (err) {
    await markChainOperationRetryable(operationId, err);
    throw err;
  } finally {
    await releaseChainOperationLock(operationId).catch(() => {});
  }
}

export async function processPendingReputationOperations(
  logger: { error: (err: unknown, msg?: string) => void } = console,
): Promise<void> {
  const ops = await listDueChainOperations(REPUTATION_OP_TYPE);
  for (const op of ops) {
    try {
      await processReputationOperation(op.operationId);
    } catch (err) {
      logger.error(err, `[reputationChain] worker failed for ${op.operationId}`);
    }
  }
}

export function startReputationChainWorker(logger: { error: (err: unknown, msg?: string) => void }): void {
  const tick = async () => {
    await processPendingReputationOperations(logger);
  };

  void tick().catch((err) => logger.error(err, "[reputationChain] initial worker tick failed"));
  setInterval(() => {
    tick().catch((err) => logger.error(err, "[reputationChain] worker tick failed"));
  }, 5_000);
}
