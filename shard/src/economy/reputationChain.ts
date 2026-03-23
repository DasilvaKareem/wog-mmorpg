/**
 * Reputation Chain Layer
 * Fire-and-forget bridge between the in-memory ReputationManager and
 * the official ERC-8004 reputation registry.
 */

import { ethers } from "ethers";
import { biteWallet } from "../blockchain/biteChain.js";
import { queueBiteTransaction } from "../blockchain/biteTxQueue.js";
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
  REPUTATION_CONTRACT_ADDRESS && biteWallet
    ? new ethers.Contract(REPUTATION_CONTRACT_ADDRESS, OFFICIAL_REPUTATION_REGISTRY_ABI, biteWallet)
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
    console.warn(`[reputationChain] getReputation failed for ${normalizeAgentId(agentId)}:`, err);
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
    console.warn(`[reputationChain] queue dispatch failed for ${key}:`, err);
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

      await queueBiteTransaction(`reputation-feedback:${normalizedAgentId}:${CATEGORY_TAGS[i]}`, async () => {
        const tx = await reputationContract.giveFeedback(
          identityId,
          BigInt(delta),
          0,
          CATEGORY_TAGS[i],
          reason,
          "",
          "",
          ethers.ZeroHash
        );
        await tx.wait();
      });
    }

    notifyChainUpdate(normalizedAgentId, "feedback");
    return true;
  } catch (err) {
    console.warn(`[reputationChain] feedback update failed for ${normalizeAgentId(agentId)}:`, err);
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
