/**
 * Reputation Manager (In-Memory + On-Chain)
 * Manages ERC-8004 reputation system for WoG characters
 * In-memory is the read source; chain writes are fire-and-forget backup
 */
import {
  getReputationOnChain,
  initReputationOnChain,
  registerReputationChainListener,
  submitFeedbackOnChain,
} from "../erc8004/reputation.js";
import { getRedis } from "../redis.js";
import { normalizeAgentId } from "../erc8004/agentResolution.js";

export enum ReputationCategory {
  Combat = 0,
  Economic = 1,
  Social = 2,
  Crafting = 3,
  Agent = 4,
}

export interface ReputationScore {
  combat: number;
  economic: number;
  social: number;
  crafting: number;
  agent: number;
  overall: number;
  lastUpdated: number;
}

export interface ReputationFeedback {
  submitter: string;
  agentId: string;
  category: ReputationCategory;
  delta: number;
  reason: string;
  timestamp: number;
}

const DEFAULT_SCORE = 500;
const MIN_SCORE = 0;
const MAX_SCORE = 1000;

const RANK_TIERS: { min: number; name: string }[] = [
  { min: 900, name: "Legendary Hero" },
  { min: 800, name: "Renowned Champion" },
  { min: 700, name: "Trusted Veteran" },
  { min: 600, name: "Reliable Ally" },
  { min: 500, name: "Average Citizen" },
  { min: 400, name: "Questionable" },
  { min: 300, name: "Untrustworthy" },
  { min: 0, name: "Notorious" },
];

function clamp(value: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, value));
}

export class ReputationManager {
  private scores: Map<string, ReputationScore> = new Map();
  private feedbackLog: ReputationFeedback[] = [];
  private chainInitSucceeded: Set<string> = new Set();
  private chainInitInFlight: Set<string> = new Set();
  private chainInitRetryAttempts: Map<string, number> = new Map();
  private chainInitRetryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private chainSyncInFlight: Set<string> = new Set();
  private chainSyncNeeded: Set<string> = new Set();
  private lastChainSyncAt: Map<string, number> = new Map();
  private readonly chainSyncIntervalMs = 20_000;
  private readonly chainSyncStaleMs = 30_000;

  constructor() {
    registerReputationChainListener((agentId) => {
      this.scheduleChainReconcile(agentId);
    });

    setInterval(() => {
      this.flushPendingChainReconciles().catch(() => {});
    }, this.chainSyncIntervalMs);
  }

  private persistScore(agentId: string, rep: ReputationScore): void {
    const redis = getRedis();
    if (!redis) return;
    redis.hset(`reputation:agent:${agentId}`, {
      combat: String(rep.combat),
      economic: String(rep.economic),
      social: String(rep.social),
      crafting: String(rep.crafting),
      agent: String(rep.agent),
      overall: String(rep.overall),
      lastUpdated: String(rep.lastUpdated),
    }).catch(() => {});
  }

  private applyChainScore(agentId: string, chainScore: ReputationScore): void {
    this.scores.set(agentId, chainScore);
    this.chainSyncNeeded.delete(agentId);
    this.lastChainSyncAt.set(agentId, Date.now());
    this.persistScore(agentId, chainScore);
  }

  private scheduleChainReconcile(agentId: string | bigint): void {
    this.chainSyncNeeded.add(normalizeAgentId(agentId));
  }

  private async reconcileFromChain(agentId: string | bigint): Promise<ReputationScore | null> {
    const key = normalizeAgentId(agentId);
    if (this.chainSyncInFlight.has(key)) {
      return this.scores.get(key) ?? null;
    }

    this.chainSyncInFlight.add(key);
    try {
      const chainScore = await getReputationOnChain(key);
      if (!chainScore) {
        return this.scores.get(key) ?? null;
      }

      const normalized: ReputationScore = {
        combat: chainScore.combat,
        economic: chainScore.economic,
        social: chainScore.social,
        crafting: chainScore.crafting,
        agent: chainScore.agent,
        overall: chainScore.overall,
        lastUpdated: chainScore.lastUpdated || Date.now(),
      };
      this.applyChainScore(key, normalized);
      return normalized;
    } finally {
      this.chainSyncInFlight.delete(key);
    }
  }

  private async flushPendingChainReconciles(): Promise<void> {
    for (const agentId of Array.from(this.chainSyncNeeded)) {
      await this.reconcileFromChain(agentId).catch(() => {});
    }
  }

  private scheduleChainInit(agentId: string, reason: string): void {
    if (this.chainInitSucceeded.has(agentId) || this.chainInitInFlight.has(agentId)) {
      return;
    }

    const existingTimer = this.chainInitRetryTimers.get(agentId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.chainInitRetryTimers.delete(agentId);
    }

    this.chainInitInFlight.add(agentId);
    void initReputationOnChain(agentId)
      .then((ok) => {
        this.chainInitInFlight.delete(agentId);
        if (ok) {
          this.chainInitSucceeded.add(agentId);
          this.chainInitRetryAttempts.delete(agentId);
          return;
        }

        const attempts = (this.chainInitRetryAttempts.get(agentId) ?? 0) + 1;
        this.chainInitRetryAttempts.set(agentId, attempts);
        const delayMs = Math.min(5 * 60_000, 15_000 * 2 ** (attempts - 1));
        const timer = setTimeout(() => {
          this.chainInitRetryTimers.delete(agentId);
          this.scheduleChainInit(agentId, "retry");
        }, delayMs);
        this.chainInitRetryTimers.set(agentId, timer);
        console.warn(
          `[reputation] on-chain init pending for ${agentId}; retrying in ${Math.round(delayMs / 1000)}s (${reason})`
        );
      })
      .catch(() => {
        this.chainInitInFlight.delete(agentId);
      });
  }

  /** Ensure an agent has a reputation entry (idempotent) */
  ensureInitialized(agentId: string | bigint): void {
    const key = normalizeAgentId(agentId);
    if (this.scores.has(key)) {
      this.scheduleChainInit(key, "ensureInitialized-existing");
      return;
    }
    // Set defaults synchronously so scores are always available
    this.scores.set(key, {
      combat: DEFAULT_SCORE,
      economic: DEFAULT_SCORE,
      social: DEFAULT_SCORE,
      crafting: DEFAULT_SCORE,
      agent: DEFAULT_SCORE,
      overall: DEFAULT_SCORE,
      lastUpdated: Date.now(),
    });
    // Fire-and-forget Redis restore — overwrites defaults if persisted data exists
    const redis = getRedis();
    if (redis) {
      redis.hgetall(`reputation:agent:${key}`).then((stored: Record<string, string> | null) => {
        if (stored && stored.overall) {
          this.scores.set(key, {
            combat: parseInt(stored.combat ?? String(DEFAULT_SCORE), 10),
            economic: parseInt(stored.economic ?? String(DEFAULT_SCORE), 10),
            social: parseInt(stored.social ?? String(DEFAULT_SCORE), 10),
            crafting: parseInt(stored.crafting ?? String(DEFAULT_SCORE), 10),
            agent: parseInt(stored.agent ?? String(DEFAULT_SCORE), 10),
            overall: parseInt(stored.overall, 10),
            lastUpdated: parseInt(stored.lastUpdated ?? String(Date.now()), 10),
          });
        }
        this.scheduleChainInit(key, stored && stored.overall ? "redis-restore" : "fresh-init");
        this.scheduleChainReconcile(key);
      }).catch(() => {
        this.scheduleChainInit(key, "redis-read-failed");
        this.scheduleChainReconcile(key);
      });
    } else {
      this.scheduleChainInit(key, "fresh-init");
      this.scheduleChainReconcile(key);
    }
  }

  /** Get reputation scores for an agent */
  getReputation(agentId: string | bigint): ReputationScore | null {
    const key = normalizeAgentId(agentId);
    const rep = this.scores.get(key) ?? null;
    const lastSync = this.lastChainSyncAt.get(key) ?? 0;
    if (!rep) {
      this.ensureInitialized(key);
      this.scheduleChainReconcile(key);
      return null;
    }
    if (Date.now() - lastSync > this.chainSyncStaleMs) {
      this.scheduleChainReconcile(key);
    }
    return rep;
  }

  async getEventuallyConsistentReputation(agentId: string | bigint): Promise<ReputationScore | null> {
    const key = normalizeAgentId(agentId);
    this.ensureInitialized(key);
    const rep = this.scores.get(key) ?? null;
    const lastSync = this.lastChainSyncAt.get(key) ?? 0;
    if (!rep || this.chainSyncNeeded.has(key) || Date.now() - lastSync > this.chainSyncStaleMs) {
      const synced = await this.reconcileFromChain(key).catch(() => null);
      return synced ?? this.scores.get(key) ?? rep;
    }
    return rep;
  }

  /** Get rank name for a given score */
  getReputationRank(score: number): string {
    for (const tier of RANK_TIERS) {
      if (score >= tier.min) return tier.name;
    }
    return "Notorious";
  }

  /** Submit feedback for a single category */
  submitFeedback(
    agentId: string | bigint,
    category: ReputationCategory,
    delta: number,
    reason: string,
    submitter: string = "system"
  ): void {
    const key = normalizeAgentId(agentId);
    this.ensureInitialized(key);
    const rep = this.scores.get(key)!;

    const categoryKey = ReputationCategory[category].toLowerCase() as keyof Omit<
      ReputationScore,
      "overall" | "lastUpdated"
    >;
    rep[categoryKey] = clamp(rep[categoryKey] + delta);
    rep.overall = Math.round(
      (rep.combat + rep.economic + rep.social + rep.crafting + rep.agent) / 5
    );
    rep.lastUpdated = Date.now();

    this.feedbackLog.push({
      submitter,
      agentId: key,
      category,
      delta,
      reason,
      timestamp: Date.now(),
    });

    // Keep feedback log bounded
    if (this.feedbackLog.length > 5000) {
      this.feedbackLog = this.feedbackLog.slice(-2500);
    }

    this.scheduleChainInit(key, "submitFeedback");
    this.scheduleChainReconcile(key);
    submitFeedbackOnChain(key, category, delta, reason).catch(() => {});

    this.persistScore(key, rep);
    const redis = getRedis();
    if (redis) {
      // Append snapshot to timeline (sorted set, score = timestamp)
      const snap = JSON.stringify({
        combat: rep.combat, economic: rep.economic, social: rep.social,
        crafting: rep.crafting, agent: rep.agent, overall: rep.overall,
        category: ReputationCategory[category], delta, reason,
      });
      redis.zadd(`reputation:history:agent:${key}`, Date.now(), snap).catch(() => {});
      // Trim to last 500 snapshots
      redis.zremrangebyrank(`reputation:history:agent:${key}`, 0, -501).catch(() => {});
    }
  }

  /** Batch update multiple categories at once */
  batchUpdateReputation(
    agentId: string | bigint,
    deltas: {
      combat?: number;
      economic?: number;
      social?: number;
      crafting?: number;
      agent?: number;
    },
    reason: string,
    submitter: string = "system"
  ): void {
    if (deltas.combat) this.submitFeedback(agentId, ReputationCategory.Combat, deltas.combat, reason, submitter);
    if (deltas.economic) this.submitFeedback(agentId, ReputationCategory.Economic, deltas.economic, reason, submitter);
    if (deltas.social) this.submitFeedback(agentId, ReputationCategory.Social, deltas.social, reason, submitter);
    if (deltas.crafting) this.submitFeedback(agentId, ReputationCategory.Crafting, deltas.crafting, reason, submitter);
    if (deltas.agent) this.submitFeedback(agentId, ReputationCategory.Agent, deltas.agent, reason, submitter);
  }

  /** Get feedback history for an agent */
  getFeedbackHistory(agentId: string | bigint, limit: number = 20): ReputationFeedback[] {
    const key = normalizeAgentId(agentId);
    return this.feedbackLog
      .filter((f) => f.agentId === key)
      .slice(-limit)
      .reverse();
  }

  /** Get reputation timeline snapshots from Redis */
  async getTimeline(agentId: string | bigint, limit: number = 100): Promise<Array<{ ts: number; combat: number; economic: number; social: number; crafting: number; agent: number; overall: number; category?: string; delta?: number; reason?: string }>> {
    const key = normalizeAgentId(agentId);
    const redis = getRedis();
    if (!redis) return [];
    try {
      const raw = await redis.zrangebyscore(`reputation:history:agent:${key}`, "-inf", "+inf", "WITHSCORES", "LIMIT", 0, limit);
      const result: Array<{ ts: number; combat: number; economic: number; social: number; crafting: number; agent: number; overall: number; category?: string; delta?: number; reason?: string }> = [];
      for (let i = 0; i < raw.length; i += 2) {
        const snap = JSON.parse(raw[i]);
        const ts = parseInt(raw[i + 1], 10);
        result.push({ ts, ...snap });
      }
      return result;
    } catch { return []; }
  }

  /** Update combat reputation based on PvP results */
  updateCombatReputation(
    agentId: string | bigint,
    won: boolean,
    performanceScore: number
  ): void {
    let delta: number;
    if (won) {
      delta = Math.floor(5 + (performanceScore / 100) * 15);
    } else {
      delta = Math.floor(-2 - (performanceScore / 100) * 3);
    }
    this.submitFeedback(
      agentId,
      ReputationCategory.Combat,
      delta,
      won ? `Won PvP battle (performance: ${performanceScore})` : "Lost PvP battle"
    );
  }

  /** Update economic reputation based on trade */
  updateEconomicReputation(
    agentId: string | bigint,
    tradeCompleted: boolean,
    fairPrice: boolean
  ): void {
    let delta: number;
    if (tradeCompleted && fairPrice) {
      delta = 5;
    } else if (tradeCompleted) {
      delta = 1;
    } else {
      delta = -10;
    }
    this.submitFeedback(
      agentId,
      ReputationCategory.Economic,
      delta,
      tradeCompleted
        ? fairPrice ? "Fair trade completed" : "Trade completed (price concern)"
        : "Trade failed/cancelled"
    );
  }
}

// Global singleton
export const reputationManager = new ReputationManager();
