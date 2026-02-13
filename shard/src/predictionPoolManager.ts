/**
 * Prediction Pool Manager
 * Manages encrypted prediction markets using BITE Protocol
 */

import { ethers } from "ethers";
import { bite, biteWallet, biteProvider } from "./biteChain.js";
import type {
  PredictionPool,
  EncryptedPosition,
  BetPlacementRequest,
  BetPlacementResult,
  PoolSettlementData,
  PredictionStats,
  BettingHistory,
  BettingRecord,
  PoolStatus,
  BetChoice,
} from "./types/prediction.js";
import type { PvPTeam } from "./types/pvp.js";
import { randomUUID } from "crypto";

const PREDICTION_CONTRACT_ADDRESS = process.env.PREDICTION_CONTRACT_ADDRESS!;

/** PvPPredictionMarket ABI - core functions */
const PREDICTION_ABI = [
  "function createPool(string poolId, string battleId, uint256 duration, uint256 betLockTime)",
  "function placeBet(string poolId, bytes encryptedChoice, address better) payable",
  "function lockPool(string poolId)",
  "function settleBattle(string poolId, string winner, string[] decryptedChoices)",
  "function claimWinnings(string poolId)",
  "function cancelPool(string poolId, string reason)",
  "function getPool(string poolId) view returns (string battleId, uint256 lockTimestamp, uint256 executeTimestamp, uint8 status, uint256 totalStaked, uint256 participantCount, string winner)",
  "function getPosition(string poolId, address better) view returns (uint256 amount, uint256 timestamp, string decryptedChoice, bool claimed, uint256 payout)",
  "function getActivePools() view returns (string[] memory)",
  "event PoolCreated(string indexed poolId, string indexed battleId, uint256 lockTimestamp, uint256 executeTimestamp)",
  "event BetPlaced(string indexed poolId, address indexed better, uint256 amount, uint256 timestamp)",
  "event PoolLocked(string indexed poolId, uint256 lockTimestamp)",
  "event PoolSettled(string indexed poolId, string winner, uint256 totalPayout, uint256 platformFee)",
  "event WinningsClaimed(string indexed poolId, address indexed winner, uint256 amount)",
];

const predictionContract = new ethers.Contract(
  PREDICTION_CONTRACT_ADDRESS,
  PREDICTION_ABI,
  biteWallet
);

export class PredictionPoolManager {
  private pools: Map<string, PredictionPool>;
  private bettingHistory: Map<string, BettingHistory>;

  constructor() {
    this.pools = new Map();
    this.bettingHistory = new Map();
  }

  /**
   * Create a new prediction pool for a battle
   */
  async createPool(
    battleId: string,
    duration: number, // seconds
    betLockTime: number // seconds before battle to lock bets
  ): Promise<string> {
    const poolId = randomUUID();

    // Create pool on-chain
    const tx = await predictionContract.createPool(
      poolId,
      battleId,
      duration,
      betLockTime
    );
    await tx.wait();

    // Create local pool state
    const now = Date.now();
    const lockTimestamp = now + betLockTime * 1000;
    const executeTimestamp = lockTimestamp + duration * 1000;

    const pool: PredictionPool = {
      poolId,
      battleId,
      status: "open",
      createdAt: now,
      lockTimestamp,
      executeTimestamp,
      positions: new Map(),
      totalPoolSize: BigInt(0),
      participantCount: 0,
      payouts: new Map(),
    };

    this.pools.set(poolId, pool);

    return poolId;
  }

  /**
   * Place an encrypted bet on a pool
   */
  async placeBet(request: BetPlacementRequest): Promise<BetPlacementResult> {
    const { poolId, choice, amount, betterAddress } = request;

    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    if (pool.status !== "open") {
      throw new Error(`Pool ${poolId} is not open for betting`);
    }

    if (Date.now() >= pool.lockTimestamp) {
      throw new Error(`Pool ${poolId} betting is locked`);
    }

    // Encrypt the choice using BITE
    const encryptedChoice = await this.encryptChoice(choice);

    // Submit on-chain
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const tx = await predictionContract.placeBet(
      poolId,
      encryptedChoice,
      betterAddress,
      { value: amountWei }
    );
    const receipt = await tx.wait();

    // Create position
    const positionId = randomUUID();
    const position: EncryptedPosition = {
      positionId,
      better: betterAddress,
      encryptedChoice,
      amount: amountWei,
      timestamp: Date.now(),
      claimed: false,
    };

    // Store locally
    pool.positions.set(betterAddress, position);
    pool.totalPoolSize += amountWei;
    pool.participantCount++;

    // Update betting history
    this.addToBettingHistory(betterAddress, poolId, pool.battleId, choice, amountWei);

    return {
      positionId,
      txHash: receipt.hash,
      encryptedChoice,
      amount: amountWei,
      timestamp: position.timestamp,
    };
  }

  /**
   * Encrypt a bet choice using BITE v2
   */
  private async encryptChoice(choice: BetChoice): Promise<string> {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"],
      [choice]
    );
    return bite.encryptMessage(encoded);
  }

  /**
   * Lock a pool - no more bets allowed
   */
  async lockPool(poolId: string): Promise<void> {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    const tx = await predictionContract.lockPool(poolId);
    await tx.wait();

    pool.status = "locked";
  }

  /**
   * Settle a pool after battle completes
   * In production, this would be called by BITE CTX callback
   */
  async settlePool(
    poolId: string,
    winner: PvPTeam
  ): Promise<PoolSettlementData> {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    if (pool.status !== "locked") {
      throw new Error(`Pool ${poolId} is not locked`);
    }

    // Convert team to bet choice
    const winnerChoice: BetChoice = winner === "red" ? "RED" : "BLUE";

    // In production, BITE CTX would decrypt all positions
    // For now, we simulate decryption (in real implementation, this comes from CTX)
    const decryptedChoices: string[] = [];
    const positions = Array.from(pool.positions.values());

    // Simulate CTX decryption
    for (const pos of positions) {
      // In production, this would be decrypted by BITE CTX
      // For development, we need to decrypt locally (simplified)
      decryptedChoices.push(winnerChoice); // Placeholder
    }

    // Submit settlement on-chain
    const tx = await predictionContract.settleBattle(
      poolId,
      winnerChoice,
      decryptedChoices
    );
    await tx.wait();

    // Calculate payouts
    pool.status = "settled";
    pool.winner = winnerChoice;

    let totalWinningStake = BigInt(0);
    let totalLosingStake = BigInt(0);

    // Categorize bets
    positions.forEach((pos, index) => {
      pos.decryptedChoice = decryptedChoices[index] as BetChoice;

      if (pos.decryptedChoice === winnerChoice) {
        totalWinningStake += pos.amount;
      } else {
        totalLosingStake += pos.amount;
      }
    });

    pool.totalWinningStake = totalWinningStake;
    pool.totalLosingStake = totalLosingStake;

    // Calculate individual payouts
    const platformFee = pool.totalPoolSize * BigInt(200) / BigInt(10000); // 2%
    const totalPayout = pool.totalPoolSize - platformFee;

    const payouts: Array<{
      winner: string;
      stake: bigint;
      payout: bigint;
      profitMultiplier: number;
    }> = [];

    for (const pos of positions) {
      if (pos.decryptedChoice === winnerChoice && totalWinningStake > BigInt(0)) {
        // Winner gets proportional share
        const payout = (pos.amount * totalPayout) / totalWinningStake;
        pos.payout = payout;
        pool.payouts.set(pos.better, payout);

        payouts.push({
          winner: pos.better,
          stake: pos.amount,
          payout,
          profitMultiplier: Number(payout) / Number(pos.amount),
        });

        // Update betting history
        this.updateBettingHistoryResult(poolId, pos.better, "win", payout);
      } else {
        // Loser gets nothing
        pos.payout = BigInt(0);
        pool.payouts.set(pos.better, BigInt(0));

        // Update betting history
        this.updateBettingHistoryResult(poolId, pos.better, "loss", BigInt(0));
      }
    }

    const settlementData: PoolSettlementData = {
      poolId,
      winner: winnerChoice,
      decryptedPositions: positions.map((pos) => ({
        positionId: pos.positionId,
        better: pos.better,
        choice: pos.decryptedChoice!,
        amount: pos.amount,
      })),
      payouts,
      totalWinningStake,
      totalLosingStake,
      totalPayout,
    };

    pool.settledAt = Date.now();

    return settlementData;
  }

  /**
   * Claim winnings from a settled pool
   */
  async claimWinnings(poolId: string, betterAddress: string): Promise<string> {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    if (pool.status !== "settled") {
      throw new Error(`Pool ${poolId} is not settled yet`);
    }

    const position = pool.positions.get(betterAddress);
    if (!position) {
      throw new Error(`No position found for ${betterAddress}`);
    }

    if (position.claimed) {
      throw new Error("Already claimed");
    }

    if (!position.payout || position.payout === BigInt(0)) {
      throw new Error("Nothing to claim");
    }

    // Claim on-chain
    const tx = await predictionContract.claimWinnings(poolId);
    const receipt = await tx.wait();

    position.claimed = true;

    return receipt.hash;
  }

  /**
   * Get pool statistics (public view)
   */
  getPoolStats(poolId: string): PredictionStats {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    const now = Date.now();
    const timeUntilLock =
      pool.lockTimestamp > now ? (pool.lockTimestamp - now) / 1000 : 0;

    return {
      poolId: pool.poolId,
      battleId: pool.battleId,
      status: pool.status,
      totalStaked: ethers.formatUnits(pool.totalPoolSize, 18),
      participantCount: pool.participantCount,
      lockTimestamp: pool.lockTimestamp,
      timeUntilLock,
      participants: Array.from(pool.positions.values()).map((pos) => ({
        wallet: pos.better,
        amount: ethers.formatUnits(pos.amount, 18),
        timestamp: pos.timestamp,
        // choice is HIDDEN - creates FOMO!
      })),
    };
  }

  /**
   * Get active pools
   */
  getActivePools(): string[] {
    return Array.from(this.pools.values())
      .filter((p) => p.status === "open" || p.status === "locked")
      .map((p) => p.poolId);
  }

  /**
   * Get betting history for a wallet
   */
  getBettingHistory(walletAddress: string): BettingHistory {
    return (
      this.bettingHistory.get(walletAddress) || {
        walletAddress,
        totalBets: 0,
        totalStaked: BigInt(0),
        totalWon: BigInt(0),
        totalLost: BigInt(0),
        netProfit: BigInt(0),
        winRate: 0,
        currentStreak: 0,
        bestStreak: 0,
        bets: [],
      }
    );
  }

  /**
   * Add to betting history
   */
  private addToBettingHistory(
    wallet: string,
    poolId: string,
    battleId: string,
    choice: BetChoice,
    amount: bigint
  ): void {
    let history = this.bettingHistory.get(wallet);
    if (!history) {
      history = {
        walletAddress: wallet,
        totalBets: 0,
        totalStaked: BigInt(0),
        totalWon: BigInt(0),
        totalLost: BigInt(0),
        netProfit: BigInt(0),
        winRate: 0,
        currentStreak: 0,
        bestStreak: 0,
        bets: [],
      };
      this.bettingHistory.set(wallet, history);
    }

    const record: BettingRecord = {
      positionId: randomUUID(),
      poolId,
      battleId,
      choice,
      amount,
      timestamp: Date.now(),
      claimed: false,
    };

    history.bets.push(record);
    history.totalBets++;
    history.totalStaked += amount;
  }

  /**
   * Update betting history with result
   */
  private updateBettingHistoryResult(
    poolId: string,
    wallet: string,
    result: "win" | "loss",
    payout: bigint
  ): void {
    const history = this.bettingHistory.get(wallet);
    if (!history) return;

    const bet = history.bets.find((b) => b.poolId === poolId);
    if (!bet) return;

    bet.result = result;
    bet.payout = payout;
    bet.profit = payout - bet.amount;

    if (result === "win") {
      history.totalWon += payout;
      history.currentStreak = history.currentStreak >= 0 ? history.currentStreak + 1 : 1;
    } else {
      history.totalLost += bet.amount;
      history.currentStreak = history.currentStreak <= 0 ? history.currentStreak - 1 : -1;
    }

    history.bestStreak = Math.max(history.bestStreak, history.currentStreak);
    history.netProfit = history.totalWon - history.totalLost;

    const wins = history.bets.filter((b) => b.result === "win").length;
    const totalGames = history.bets.filter((b) => b.result).length;
    history.winRate = totalGames > 0 ? wins / totalGames : 0;
  }

  /**
   * Cancel a pool and refund bets
   */
  async cancelPool(poolId: string, reason: string): Promise<void> {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    const tx = await predictionContract.cancelPool(poolId, reason);
    await tx.wait();

    pool.status = "cancelled";
  }
}

// Global singleton
export const predictionPoolManager = new PredictionPoolManager();
