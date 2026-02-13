/**
 * PvP Battle Manager
 * Central coordinator for all PvP battles, matchmaking, and results
 */

import { PvPBattleEngine } from "./pvpBattleEngine.js";
import { MatchmakingSystem } from "./matchmaking.js";
import type {
  PvPBattleConfig,
  PvPBattleState,
  PvPFormat,
  MatchmakingEntry,
  PvPMatchResult,
  PvPLeaderboardEntry,
} from "./types/pvp.js";
import type { BattleAction } from "./types/battle.js";
import { randomUUID } from "crypto";

export interface PvPDatabase {
  // Player stats
  playerStats: Map<
    string,
    {
      walletAddress: string;
      elo: number;
      wins: number;
      losses: number;
      currentStreak: number;
      bestStreak: number;
      totalDamage: number;
      totalKills: number;
      mvpCount: number;
    }
  >;

  // Match history
  matchHistory: Array<{
    battleId: string;
    timestamp: number;
    result: PvPMatchResult;
  }>;
}

export class PvPBattleManager {
  private activeBattles: Map<string, PvPBattleEngine>;
  private matchmaking: MatchmakingSystem;
  private database: PvPDatabase;
  private battleEventHandlers: Map<string, Array<(state: PvPBattleState) => void>>;

  constructor() {
    this.activeBattles = new Map();
    this.matchmaking = new MatchmakingSystem();
    this.database = {
      playerStats: new Map(),
      matchHistory: [],
    };
    this.battleEventHandlers = new Map();

    // Start matchmaking ticker (check every 5 seconds)
    setInterval(() => this.tickMatchmaking(), 5000);

    // Cleanup old queue entries every minute
    setInterval(() => this.matchmaking.cleanupOldEntries(), 60000);
  }

  /**
   * Add player to matchmaking queue
   */
  joinQueue(entry: MatchmakingEntry): void {
    // Initialize player stats if new
    if (!this.database.playerStats.has(entry.agentId)) {
      this.database.playerStats.set(entry.agentId, {
        walletAddress: entry.walletAddress,
        elo: entry.elo || 1000, // Default ELO
        wins: 0,
        losses: 0,
        currentStreak: 0,
        bestStreak: 0,
        totalDamage: 0,
        totalKills: 0,
        mvpCount: 0,
      });
    }

    this.matchmaking.addToQueue(entry);
  }

  /**
   * Remove player from queue
   */
  leaveQueue(agentId: string, format: PvPFormat): boolean {
    return this.matchmaking.removeFromQueue(agentId, format);
  }

  /**
   * Get queue status
   */
  getQueueStatus(format: PvPFormat) {
    return this.matchmaking.getQueueStatus(format);
  }

  /**
   * Get all queues status
   */
  getAllQueuesStatus() {
    return this.matchmaking.getAllQueuesStatus();
  }

  /**
   * Matchmaking ticker - tries to create matches
   */
  private tickMatchmaking(): void {
    const formats: PvPFormat[] = ["1v1", "2v2", "5v5", "ffa"];

    for (const format of formats) {
      const config = this.matchmaking.tryCreateMatch(format);
      if (config) {
        this.createBattle(config);
      }
    }
  }

  /**
   * Create a new battle
   */
  createBattle(config: PvPBattleConfig): string {
    const battle = new PvPBattleEngine(config);

    // Set to betting phase
    battle.setBettingPhase();

    this.activeBattles.set(config.battleId, battle);

    // Schedule battle start after bet lock time
    setTimeout(() => {
      if (this.activeBattles.has(config.battleId)) {
        const b = this.activeBattles.get(config.battleId);
        if (b && b.battleStatus === "betting") {
          b.startBattle();
        }
      }
    }, config.betLockTime * 1000);

    return config.battleId;
  }

  /**
   * Get battle by ID
   */
  getBattle(battleId: string): PvPBattleEngine | undefined {
    return this.activeBattles.get(battleId);
  }

  /**
   * Get battle state
   */
  getBattleState(battleId: string): PvPBattleState | null {
    const battle = this.activeBattles.get(battleId);
    return battle ? battle.getState() : null;
  }

  /**
   * Submit action to battle
   */
  submitBattleAction(battleId: string, action: BattleAction): PvPBattleState | null {
    const battle = this.activeBattles.get(battleId);
    if (!battle) return null;

    const state = battle.submitAction(action);

    // Emit event to subscribers
    this.emitBattleEvent(battleId, state);

    // Check if battle completed
    if (state.status === "completed") {
      this.handleBattleCompletion(battleId);
    }

    return state;
  }

  /**
   * Handle battle completion - update stats, calculate rewards
   */
  private handleBattleCompletion(battleId: string): void {
    const battle = this.activeBattles.get(battleId);
    if (!battle) return;

    const result = battle.calculateMatchResult();

    // Update player stats
    this.updatePlayerStats(result);

    // Store match history
    this.database.matchHistory.push({
      battleId,
      timestamp: Date.now(),
      result,
    });

    // Clean up battle after 5 minutes (keep for replays)
    setTimeout(() => {
      this.activeBattles.delete(battleId);
    }, 300000);
  }

  /**
   * Update player statistics after match
   */
  private updatePlayerStats(result: PvPMatchResult): void {
    // Update red team
    result.teamRed.forEach((player) => {
      const stats = this.database.playerStats.get(player.agentId);
      if (!stats) return;

      const won = result.winner === "red";
      stats.elo = player.newElo;

      if (won) {
        stats.wins++;
        stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
      } else {
        stats.losses++;
        stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
      }

      stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    });

    // Update blue team
    result.teamBlue.forEach((player) => {
      const stats = this.database.playerStats.get(player.agentId);
      if (!stats) return;

      const won = result.winner === "blue";
      stats.elo = player.newElo;

      if (won) {
        stats.wins++;
        stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
      } else {
        stats.losses++;
        stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
      }

      stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    });

    // Update MVP stats
    const mvpStats = this.database.playerStats.get(result.mvp.agentId);
    if (mvpStats) {
      mvpStats.mvpCount++;
    }
  }

  /**
   * Get leaderboard
   */
  getLeaderboard(limit: number = 100): PvPLeaderboardEntry[] {
    const entries: PvPLeaderboardEntry[] = [];

    for (const [agentId, stats] of this.database.playerStats.entries()) {
      const totalGames = stats.wins + stats.losses;
      entries.push({
        agentId,
        walletAddress: stats.walletAddress,
        characterName: `Agent ${agentId.substring(0, 8)}`,
        elo: stats.elo,
        wins: stats.wins,
        losses: stats.losses,
        winRate: totalGames > 0 ? stats.wins / totalGames : 0,
        currentStreak: stats.currentStreak,
        bestStreak: stats.bestStreak,
        totalDamage: stats.totalDamage,
        totalKills: stats.totalKills,
        mvpCount: stats.mvpCount,
      });
    }

    // Sort by ELO descending
    entries.sort((a, b) => b.elo - a.elo);

    return entries.slice(0, limit);
  }

  /**
   * Get player stats
   */
  getPlayerStats(agentId: string): PvPLeaderboardEntry | null {
    const stats = this.database.playerStats.get(agentId);
    if (!stats) return null;

    const totalGames = stats.wins + stats.losses;

    return {
      agentId,
      walletAddress: stats.walletAddress,
      characterName: `Agent ${agentId.substring(0, 8)}`,
      elo: stats.elo,
      wins: stats.wins,
      losses: stats.losses,
      winRate: totalGames > 0 ? stats.wins / totalGames : 0,
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak,
      totalDamage: stats.totalDamage,
      totalKills: stats.totalKills,
      mvpCount: stats.mvpCount,
    };
  }

  /**
   * Get match history for player
   */
  getPlayerMatchHistory(agentId: string, limit: number = 20): PvPMatchResult[] {
    return this.database.matchHistory
      .filter((m) => {
        const inRed = m.result.teamRed.some((p) => p.agentId === agentId);
        const inBlue = m.result.teamBlue.some((p) => p.agentId === agentId);
        return inRed || inBlue;
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map((m) => m.result);
  }

  /**
   * Subscribe to battle events
   */
  subscribeToBattle(
    battleId: string,
    handler: (state: PvPBattleState) => void
  ): () => void {
    if (!this.battleEventHandlers.has(battleId)) {
      this.battleEventHandlers.set(battleId, []);
    }

    this.battleEventHandlers.get(battleId)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.battleEventHandlers.get(battleId);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Emit battle event to subscribers
   */
  private emitBattleEvent(battleId: string, state: PvPBattleState): void {
    const handlers = this.battleEventHandlers.get(battleId);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(state);
        } catch (error) {
          console.error("Battle event handler error:", error);
        }
      });
    }
  }

  /**
   * Get all active battles
   */
  getActiveBattles(): Array<{
    battleId: string;
    format: PvPFormat;
    status: string;
    playersCount: number;
  }> {
    const battles: Array<{
      battleId: string;
      format: PvPFormat;
      status: string;
      playersCount: number;
    }> = [];

    for (const [battleId, battle] of this.activeBattles.entries()) {
      const state = battle.getState();
      battles.push({
        battleId,
        format: state.config.format,
        status: state.status,
        playersCount: state.config.teamRed.length + state.config.teamBlue.length,
      });
    }

    return battles;
  }

  /**
   * Cancel a battle (admin function)
   */
  cancelBattle(battleId: string): boolean {
    const battle = this.activeBattles.get(battleId);
    if (!battle) return false;

    battle.cancelBattle();
    this.activeBattles.delete(battleId);
    return true;
  }
}

// Global singleton instance
export const pvpBattleManager = new PvPBattleManager();
