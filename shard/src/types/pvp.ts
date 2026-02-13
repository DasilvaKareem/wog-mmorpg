/**
 * PvP Battle System Type Definitions
 * Supports 1v1, 2v2, 5v5, and Free-For-All formats
 */

import type { Combatant, BattlePhase, BattleState } from "./battle.js";

export type PvPFormat = "1v1" | "2v2" | "5v5" | "ffa";
export type PvPTeam = "red" | "blue" | "none";
export type MatchStatus = "queued" | "betting" | "in_progress" | "completed" | "cancelled";
export type ExecutionOrder = "size" | "timestamp" | "random";

export interface PvPCombatant extends Combatant {
  agentId: string;
  walletAddress: string;
  pvpTeam: PvPTeam;
  gear: {
    weapon?: {
      tokenId: number;
      durability: number;
      maxDurability: number;
    };
    armor?: {
      tokenId: number;
      durability: number;
      maxDurability: number;
    };
    trinket?: {
      tokenId: number;
      durability: number;
      maxDurability: number;
    };
  };
  elo: number;
  winStreak: number;
  totalWins: number;
  totalLosses: number;
}

export interface ColiseumMap {
  mapId: string;
  name: string;
  tileSet: string;
  width: number;
  height: number;
  spawnPoints: {
    red: Array<{ x: number; y: number }>;
    blue: Array<{ x: number; y: number }>;
  };
  obstacles: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    type: "pillar" | "wall";
  }>;
  powerUps: Array<{
    x: number;
    y: number;
    type: "health" | "damage" | "speed";
    respawnTicks: number;
    active: boolean;
  }>;
  hazards: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    type: "fire" | "spikes" | "poison";
    damagePerTick: number;
  }>;
}

export interface PvPBattleConfig {
  battleId: string;
  format: PvPFormat;
  duration: number; // seconds: 60, 300, 900
  betLockTime: number; // seconds before battle starts to lock bets
  createdAt: number; // timestamp
  startTime?: number; // timestamp when battle actually starts
  endTime?: number; // timestamp when battle ends

  // Arena
  arena: ColiseumMap;

  // Teams
  teamRed: PvPCombatant[];
  teamBlue: PvPCombatant[];

  // Prediction market
  marketPoolId?: string;

  // Execution settings
  executionOrder: ExecutionOrder;

  // Level requirement
  minLevel: number;
  maxLevel: number;
}

export interface PvPBattleState extends BattleState {
  battleId: string;
  config: PvPBattleConfig;
  status: MatchStatus;
  winner?: PvPTeam;
  mvp?: string; // combatant ID with most damage/kills
  statistics: BattleStatistics;
}

export interface BattleStatistics {
  teamRedDamage: number;
  teamBlueDamage: number;
  teamRedKills: number;
  teamBlueKills: number;
  combatantStats: Map<string, CombatantStatistics>;
}

export interface CombatantStatistics {
  combatantId: string;
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  kills: number;
  deaths: number;
  actionsUsed: Map<string, number>;
}

export interface MatchmakingEntry {
  agentId: string;
  walletAddress: string;
  characterTokenId: bigint;
  level: number;
  elo: number;
  format: PvPFormat;
  queuedAt: number;
  preferredTeam?: PvPTeam;
}

export interface MatchmakingQueue {
  format: PvPFormat;
  entries: MatchmakingEntry[];
  minPlayers: number;
  maxPlayers: number;
}

export interface PvPMatchResult {
  battleId: string;
  winner: PvPTeam;
  duration: number;
  teamRed: Array<{
    agentId: string;
    walletAddress: string;
    eloChange: number;
    newElo: number;
  }>;
  teamBlue: Array<{
    agentId: string;
    walletAddress: string;
    eloChange: number;
    newElo: number;
  }>;
  mvp: {
    agentId: string;
    walletAddress: string;
    reward: bigint; // bonus GOLD for MVP
  };
}

export interface PvPLeaderboardEntry {
  agentId: string;
  walletAddress: string;
  characterName: string;
  elo: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  totalDamage: number;
  totalKills: number;
  mvpCount: number;
}
