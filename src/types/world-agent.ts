import type { Vec2 } from "./zone.js";

export type AgentBehavior = "idle" | "patrol" | "territorial";
export type AgentCategory = "hostile" | "friendly";
export type AgentTier = "lesser" | "normal" | "greater" | "elite";

export interface TierMultipliers {
  health: number;
  threat: number;
  speed: number;
  perceptionRadius: number;
  ttlTicks: number;
  attack: number;
  defense: number;
  battleSpeed: number;
}

export const TIER_MULTIPLIERS: Record<AgentTier, TierMultipliers> = {
  lesser:  { health: 0.6, threat: 0.5, speed: 0.8, perceptionRadius: 0.8, ttlTicks: 1.0, attack: 0.6, defense: 0.6, battleSpeed: 0.8 },
  normal:  { health: 1.0, threat: 1.0, speed: 1.0, perceptionRadius: 1.0, ttlTicks: 1.0, attack: 1.0, defense: 1.0, battleSpeed: 1.0 },
  greater: { health: 1.8, threat: 2.0, speed: 1.2, perceptionRadius: 1.3, ttlTicks: 1.5, attack: 1.6, defense: 1.5, battleSpeed: 1.3 },
  elite:   { health: 3.0, threat: 3.5, speed: 1.4, perceptionRadius: 1.6, ttlTicks: 2.0, attack: 2.5, defense: 2.2, battleSpeed: 1.6 },
};

export const ALL_TIERS: AgentTier[] = ["lesser", "normal", "greater", "elite"];

export const TIER_NAME_PREFIX: Record<AgentTier, string> = {
  lesser: "Lesser",
  normal: "",
  greater: "Greater",
  elite: "Elite",
};

/** Static definition loaded from JSON */
export interface WorldAgentTemplate {
  templateId: string;
  name: string;
  category: AgentCategory;
  tier: AgentTier;
  threat: number;
  health: number;
  speed: number;
  leashRadius: number;
  perceptionRadius: number;
  ttlTicks: number;
  behavior: AgentBehavior;
  // Battle stats
  attack: number;
  defense: number;
  battleSpeed: number;   // CTB timeline speed (1-100)
}

/** Runtime state of a spawned agent */
export interface WorldAgentState {
  instanceId: string;
  templateId: string;
  tier: AgentTier;
  name: string;
  position: Vec2;
  spawnPosition: Vec2;
  health: number;
  maxHealth: number;
  threat: number;
  speed: number;
  leashRadius: number;
  perceptionRadius: number;
  behavior: AgentBehavior;
  ticksAlive: number;
  ttlTicks: number;
  alive: boolean;
}
