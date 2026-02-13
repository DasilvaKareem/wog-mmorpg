/**
 * PvP Prediction Integration
 * Connects PvP battles with prediction markets
 * Handles auto-execution and settlement
 */

import { pvpBattleManager } from "./pvpBattleManager.js";
import { predictionPoolManager } from "./predictionPoolManager.js";
import type { PvPBattleConfig } from "./types/pvp.js";
import type { PvPTeam } from "./types/pvp.js";

export class PvPPredictionIntegration {
  private battleToPoolMap: Map<string, string>; // battleId -> poolId
  private poolToBattleMap: Map<string, string>; // poolId -> battleId
  private battleTimers: Map<string, NodeJS.Timeout>;

  constructor() {
    this.battleToPoolMap = new Map();
    this.poolToBattleMap = new Map();
    this.battleTimers = new Map();
  }

  /**
   * Create a battle with an associated prediction market
   */
  async createBattleWithPrediction(
    config: PvPBattleConfig
  ): Promise<{ battleId: string; poolId: string }> {
    // Create prediction pool first
    const poolId = await predictionPoolManager.createPool(
      config.battleId,
      config.duration,
      config.betLockTime
    );

    // Link pool to battle
    config.marketPoolId = poolId;

    // Create battle
    const battleId = pvpBattleManager.createBattle(config);

    // Store mappings
    this.battleToPoolMap.set(battleId, poolId);
    this.poolToBattleMap.set(poolId, battleId);

    // Schedule auto-lock and auto-execute
    this.scheduleBattleExecution(battleId, poolId, config);

    return { battleId, poolId };
  }

  /**
   * Schedule automatic battle execution and settlement
   */
  private scheduleBattleExecution(
    battleId: string,
    poolId: string,
    config: PvPBattleConfig
  ): void {
    // Schedule bet lock (happens before battle starts)
    const lockDelay = config.betLockTime * 1000;
    setTimeout(async () => {
      try {
        await predictionPoolManager.lockPool(poolId);
        console.log(`[PvPPrediction] Pool ${poolId} locked`);
      } catch (error) {
        console.error(`[PvPPrediction] Failed to lock pool ${poolId}:`, error);
      }
    }, lockDelay);

    // Schedule battle auto-execution (when duration expires)
    const executionDelay = lockDelay + config.duration * 1000;
    const timer = setTimeout(async () => {
      await this.executeBattleAndSettle(battleId, poolId);
    }, executionDelay);

    this.battleTimers.set(battleId, timer);
  }

  /**
   * Execute battle to completion and settle prediction market
   */
  private async executeBattleAndSettle(
    battleId: string,
    poolId: string
  ): Promise<void> {
    try {
      const battle = pvpBattleManager.getBattle(battleId);
      if (!battle) {
        console.error(`[PvPPrediction] Battle ${battleId} not found`);
        return;
      }

      // Check battle status
      const state = battle.getState();

      let winner: PvPTeam;

      if (state.status === "completed") {
        // Battle already completed naturally
        winner = state.winner || "red";
      } else if (state.status === "in_progress") {
        // Battle still running - determine winner by score
        // This triggers time expiration in the battle engine
        // The engine will calculate winner based on HP/kills
        console.log(`[PvPPrediction] Battle ${battleId} time expired`);

        // Wait a moment for battle engine to process timeout
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const updatedState = battle.getState();
        winner = updatedState.winner || "red";
      } else {
        // Battle in invalid state
        console.error(
          `[PvPPrediction] Battle ${battleId} in unexpected state: ${state.status}`
        );
        // Cancel pool and refund
        await predictionPoolManager.cancelPool(
          poolId,
          `Battle in unexpected state: ${state.status}`
        );
        return;
      }

      // Settle prediction pool with winner
      console.log(
        `[PvPPrediction] Settling pool ${poolId} with winner: ${winner}`
      );
      const settlement = await predictionPoolManager.settlePool(poolId, winner);

      console.log(
        `[PvPPrediction] Pool ${poolId} settled. Total payout: ${settlement.totalPayout}`
      );

      // Cleanup
      this.battleTimers.delete(battleId);
    } catch (error) {
      console.error(
        `[PvPPrediction] Error executing battle ${battleId} and settling pool ${poolId}:`,
        error
      );

      // Attempt to cancel pool on error
      try {
        await predictionPoolManager.cancelPool(
          poolId,
          `Error during execution: ${(error as Error).message}`
        );
      } catch (cancelError) {
        console.error(
          `[PvPPrediction] Failed to cancel pool ${poolId}:`,
          cancelError
        );
      }
    }
  }

  /**
   * Get pool ID for a battle
   */
  getPoolForBattle(battleId: string): string | undefined {
    return this.battleToPoolMap.get(battleId);
  }

  /**
   * Get battle ID for a pool
   */
  getBattleForPool(poolId: string): string | undefined {
    return this.poolToBattleMap.get(poolId);
  }

  /**
   * Cancel a battle and its associated pool
   */
  async cancelBattleWithPrediction(
    battleId: string,
    reason: string
  ): Promise<void> {
    const poolId = this.battleToPoolMap.get(battleId);

    // Cancel battle
    pvpBattleManager.cancelBattle(battleId);

    // Cancel pool and refund bets
    if (poolId) {
      await predictionPoolManager.cancelPool(poolId, reason);
    }

    // Clear timer
    const timer = this.battleTimers.get(battleId);
    if (timer) {
      clearTimeout(timer);
      this.battleTimers.delete(battleId);
    }

    // Clear mappings
    this.battleToPoolMap.delete(battleId);
    if (poolId) {
      this.poolToBattleMap.delete(poolId);
    }
  }

  /**
   * Get combined battle and pool status
   */
  getBattleWithPredictionStatus(battleId: string): {
    battle: any;
    pool: any;
  } | null {
    const poolId = this.battleToPoolMap.get(battleId);
    if (!poolId) return null;

    const battleState = pvpBattleManager.getBattleState(battleId);
    if (!battleState) return null;

    try {
      const poolStats = predictionPoolManager.getPoolStats(poolId);

      return {
        battle: battleState,
        pool: poolStats,
      };
    } catch (error) {
      return {
        battle: battleState,
        pool: null,
      };
    }
  }

  /**
   * Manually settle a battle (for testing/admin)
   */
  async manuallySettleBattle(battleId: string, winner: PvPTeam): Promise<void> {
    const poolId = this.battleToPoolMap.get(battleId);
    if (!poolId) {
      throw new Error(`No pool found for battle ${battleId}`);
    }

    // Clear auto-execution timer
    const timer = this.battleTimers.get(battleId);
    if (timer) {
      clearTimeout(timer);
      this.battleTimers.delete(battleId);
    }

    // Settle pool
    await predictionPoolManager.settlePool(poolId, winner);

    console.log(`[PvPPrediction] Manually settled battle ${battleId} with winner ${winner}`);
  }
}

// Global singleton
export const pvpPredictionIntegration = new PvPPredictionIntegration();
