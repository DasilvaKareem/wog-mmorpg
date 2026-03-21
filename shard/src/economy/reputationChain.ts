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

const REPUTATION_CONTRACT_ADDRESS = process.env.REPUTATION_REGISTRY_ADDRESS;

const reputationContract =
  REPUTATION_CONTRACT_ADDRESS && biteWallet
    ? new ethers.Contract(REPUTATION_CONTRACT_ADDRESS, OFFICIAL_REPUTATION_REGISTRY_ABI, biteWallet)
    : null;

if (!reputationContract && !REPUTATION_CONTRACT_ADDRESS) {
  console.warn("[reputationChain] REPUTATION_REGISTRY_ADDRESS not set — on-chain reputation disabled");
}

function toIdentityId(agentId: string | bigint): bigint {
  return BigInt(normalizeAgentId(agentId));
}

const FLUSH_INTERVAL_MS = 15_000;
const DEFAULT_SCORE = 500;
const MIN_SCORE = 0;
const MAX_SCORE = 1000;

const CATEGORY_TAGS = ["combat", "economic", "social", "crafting", "agent"] as const;
type CategoryIndex = 0 | 1 | 2 | 3 | 4;

const pendingFeedback = new Map<string, [number, number, number, number, number]>();
const chainUpdateListeners = new Set<(agentId: string, reason: string) => void>();

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
  for (const listener of chainUpdateListeners) {
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
  chainUpdateListeners.add(listener);
  return () => chainUpdateListeners.delete(listener);
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

  try {
    const identityId = toIdentityId(agentId);
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
  deltas[category as CategoryIndex] += delta;
}

async function flushPendingFeedback(): Promise<void> {
  if (pendingFeedback.size === 0) return;

  const batch = new Map(pendingFeedback);
  pendingFeedback.clear();

  for (const [agentId, deltas] of batch) {
    if (deltas.every((d) => d === 0)) continue;

    try {
      const ok = await batchUpdateReputationOnChain(agentId, deltas, "batched-feedback");
      if (!ok) mergePendingFeedback(agentId, deltas);
    } catch (err) {
      console.warn(`[reputationChain] flush failed for ${agentId}:`, err);
      mergePendingFeedback(agentId, deltas);
    }
  }
}

setInterval(() => {
  flushPendingFeedback().catch((err) => {
    console.warn("[reputationChain] flushPendingFeedback error:", err);
  });
}, FLUSH_INTERVAL_MS);

export async function batchUpdateReputationOnChain(
  agentId: string | bigint,
  deltas: [number, number, number, number, number],
  reason: string
): Promise<boolean> {
  if (!reputationContract) return false;

  try {
    const normalizedAgentId = normalizeAgentId(agentId);
    const identityId = toIdentityId(agentId);

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
