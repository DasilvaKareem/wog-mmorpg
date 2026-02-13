/**
 * Prediction Market Type Definitions
 * Uses SKALE BITE Protocol for encrypted betting
 */

import type { PvPTeam } from "./pvp.js";

export type PoolStatus = "open" | "locked" | "executing" | "settled" | "cancelled";
export type BetChoice = "RED" | "BLUE";

export interface PredictionPool {
  poolId: string;
  battleId: string;

  // Market state
  status: PoolStatus;
  createdAt: number;
  lockTimestamp: number; // When betting closes
  executeTimestamp: number; // When battle ends and CTX triggers
  settledAt?: number; // When payouts are calculated

  // Encrypted positions (stored on-chain)
  positions: Map<string, EncryptedPosition>;

  // Public aggregated data
  totalPoolSize: bigint; // Total GOLD staked
  participantCount: number;

  // Results (populated after CTX)
  winner?: BetChoice;
  totalWinningStake?: bigint;
  totalLosingStake?: bigint;

  // Payouts (calculated after settlement)
  payouts: Map<string, bigint>; // walletAddress -> payout amount
}

export interface EncryptedPosition {
  positionId: string;
  better: string; // wallet address
  encryptedChoice: string; // BITE encrypted "RED" or "BLUE"
  amount: bigint; // Visible stake amount (public)
  timestamp: number; // When bet was placed
  decryptedChoice?: BetChoice; // Populated after CTX
  claimed: boolean; // Whether winnings have been claimed
  payout?: bigint; // Calculated payout (if winner)
}

export interface BetPlacementRequest {
  poolId: string;
  choice: BetChoice;
  amount: number; // GOLD amount
  betterAddress: string;
}

export interface BetPlacementResult {
  positionId: string;
  txHash: string;
  encryptedChoice: string;
  amount: bigint;
  timestamp: number;
}

export interface PoolSettlementData {
  poolId: string;
  winner: BetChoice;
  decryptedPositions: Array<{
    positionId: string;
    better: string;
    choice: BetChoice;
    amount: bigint;
  }>;
  payouts: Array<{
    winner: string;
    stake: bigint;
    payout: bigint;
    profitMultiplier: number;
  }>;
  totalWinningStake: bigint;
  totalLosingStake: bigint;
  totalPayout: bigint;
}

export interface PredictionStats {
  poolId: string;
  battleId: string;
  status: PoolStatus;
  totalStaked: string; // formatted GOLD
  participantCount: number;
  lockTimestamp: number;
  timeUntilLock?: number; // seconds
  participants: Array<{
    wallet: string;
    amount: string; // formatted GOLD
    timestamp: number;
    // choice is HIDDEN until settlement
  }>;
}

export interface BettingHistory {
  walletAddress: string;
  totalBets: number;
  totalStaked: bigint;
  totalWon: bigint;
  totalLost: bigint;
  netProfit: bigint;
  winRate: number;
  currentStreak: number; // positive = wins, negative = losses
  bestStreak: number;
  bets: BettingRecord[];
}

export interface BettingRecord {
  positionId: string;
  poolId: string;
  battleId: string;
  choice: BetChoice;
  amount: bigint;
  timestamp: number;
  result?: "win" | "loss";
  payout?: bigint;
  profit?: bigint;
  claimed: boolean;
}

export interface X402PredictionOrder {
  poolId: string;
  encryptedPayload: string; // x402 encrypted entire order
  agentSignature: string;
}

export interface X402DiscoveryResponse {
  service: string;
  version: string;
  endpoints: Array<{
    path: string;
    method: string;
    encryption?: string;
    description: string;
  }>;
  activePools: Array<{
    poolId: string;
    battleId: string;
    totalStaked: string;
    participantCount: number;
    lockTimestamp: number;
    status: PoolStatus;
  }>;
}
