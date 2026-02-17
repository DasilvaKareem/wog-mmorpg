/**
 * Reputation Manager (In-Memory)
 * Manages ERC-8004 reputation system for WoG characters
 * Keyed by wallet address — no on-chain contracts required
 */

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
  walletAddress: string;
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

  /** Ensure a wallet has a reputation entry (idempotent) */
  ensureInitialized(walletAddress: string): void {
    const key = walletAddress.toLowerCase();
    if (this.scores.has(key)) return;
    this.scores.set(key, {
      combat: DEFAULT_SCORE,
      economic: DEFAULT_SCORE,
      social: DEFAULT_SCORE,
      crafting: DEFAULT_SCORE,
      agent: DEFAULT_SCORE,
      overall: DEFAULT_SCORE,
      lastUpdated: Date.now(),
    });
  }

  /** Get reputation scores for a wallet */
  getReputation(walletAddress: string): ReputationScore | null {
    const key = walletAddress.toLowerCase();
    return this.scores.get(key) ?? null;
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
    walletAddress: string,
    category: ReputationCategory,
    delta: number,
    reason: string,
    submitter: string = "system"
  ): void {
    const key = walletAddress.toLowerCase();
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
      walletAddress: key,
      category,
      delta,
      reason,
      timestamp: Date.now(),
    });

    // Keep feedback log bounded
    if (this.feedbackLog.length > 5000) {
      this.feedbackLog = this.feedbackLog.slice(-2500);
    }
  }

  /** Batch update multiple categories at once */
  batchUpdateReputation(
    walletAddress: string,
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
    if (deltas.combat) this.submitFeedback(walletAddress, ReputationCategory.Combat, deltas.combat, reason, submitter);
    if (deltas.economic) this.submitFeedback(walletAddress, ReputationCategory.Economic, deltas.economic, reason, submitter);
    if (deltas.social) this.submitFeedback(walletAddress, ReputationCategory.Social, deltas.social, reason, submitter);
    if (deltas.crafting) this.submitFeedback(walletAddress, ReputationCategory.Crafting, deltas.crafting, reason, submitter);
    if (deltas.agent) this.submitFeedback(walletAddress, ReputationCategory.Agent, deltas.agent, reason, submitter);
  }

  /** Get feedback history for a wallet */
  getFeedbackHistory(walletAddress: string, limit: number = 20): ReputationFeedback[] {
    const key = walletAddress.toLowerCase();
    return this.feedbackLog
      .filter((f) => f.walletAddress === key)
      .slice(-limit)
      .reverse();
  }

  /** Update combat reputation based on PvP results */
  updateCombatReputation(
    walletAddress: string,
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
      walletAddress,
      ReputationCategory.Combat,
      delta,
      won ? `Won PvP battle (performance: ${performanceScore})` : "Lost PvP battle"
    );
  }

  /** Update economic reputation based on trade */
  updateEconomicReputation(
    walletAddress: string,
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
      walletAddress,
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
