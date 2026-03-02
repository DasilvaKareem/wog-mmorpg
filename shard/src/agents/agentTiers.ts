/**
 * Agent Tier Definitions — single source of truth for pricing tier capabilities.
 * Matches the tiers shown on PricingPage.tsx.
 */

export type AgentTier = "free" | "starter" | "pro" | "self-hosted";

export interface TierCapabilities {
  /** LLM decision-making via supervisor (false = scripted bot only) */
  supervisorEnabled: boolean;
  /** Max session duration in ms (null = 24/7) */
  sessionLimitMs: number | null;
  /** Which zones the agent may enter ("all" = no restriction) */
  allowedZones: string[] | "all";
  /** Can the agent flee/retreat when low HP */
  retreatEnabled: boolean;
  /** Can the agent learn and use combat techniques */
  techniquesEnabled: boolean;
  /** Can the agent auto-adjust focus/strategy based on situation */
  selfAdaptationEnabled: boolean;
  /** Can the agent use the auction house / marketplace */
  marketTradingEnabled: boolean;
}

export const TIER_CAPABILITIES: Record<AgentTier, TierCapabilities> = {
  free: {
    supervisorEnabled: false,
    sessionLimitMs: 6 * 3600_000,       // 6 hours
    allowedZones: ["village-square"],
    retreatEnabled: false,
    techniquesEnabled: false,
    selfAdaptationEnabled: false,
    marketTradingEnabled: false,
  },
  starter: {
    supervisorEnabled: true,
    sessionLimitMs: 12 * 3600_000,      // 12 hours
    allowedZones: "all",
    retreatEnabled: true,
    techniquesEnabled: true,
    selfAdaptationEnabled: true,
    marketTradingEnabled: false,
  },
  pro: {
    supervisorEnabled: true,
    sessionLimitMs: null,               // 24/7
    allowedZones: "all",
    retreatEnabled: true,
    techniquesEnabled: true,
    selfAdaptationEnabled: true,
    marketTradingEnabled: true,
  },
  "self-hosted": {
    supervisorEnabled: true,
    sessionLimitMs: null,               // 24/7
    allowedZones: "all",
    retreatEnabled: true,
    techniquesEnabled: true,
    selfAdaptationEnabled: true,
    marketTradingEnabled: true,
  },
};
