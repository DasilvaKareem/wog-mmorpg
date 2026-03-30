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
} from "../types/pvp.js";
import type { BattleAction } from "../types/battle.js";
import { pvpReputationIntegration } from "./pvpReputationIntegration.js";
import { getRedis } from "../redis.js";

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

interface PersistedPvPPlayerStats {
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

interface PersistedMatchmakingEntry {
  agentId: string;
  walletAddress: string;
  characterTokenId: string;
  level: number;
  elo: number;
  format: PvPFormat;
  queuedAt: number;
  preferredTeam?: "red" | "blue" | "none";
  groupId?: string;
}

interface PersistedActiveBattleSummary {
  battleId: string;
  format: PvPFormat;
  status: string;
  playersCount: number;
  createdAt: number;
}

const REDIS_PVP_PLAYER_STATS_KEY = "pvp:player-stats";
const REDIS_PVP_MATCH_HISTORY_KEY = "pvp:match-history";
const REDIS_PVP_QUEUES_KEY = "pvp:queues";
const REDIS_PVP_ACTIVE_BATTLES_KEY = "pvp:active-battles";
const REDIS_PVP_RECOVERY_KEY = "pvp:last-recovery";
const MAX_MATCH_HISTORY = 250;

export class PvPBattleManager {
  private activeBattles: Map<string, PvPBattleEngine>;
  private matchmaking: MatchmakingSystem;
  private database: PvPDatabase;
  private battleEventHandlers: Map<string, Array<(state: PvPBattleState) => void>>;
  private matchmakingTickInFlight: boolean;

  constructor() {
    this.activeBattles = new Map();
    this.matchmaking = new MatchmakingSystem();
    this.database = {
      playerStats: new Map(),
      matchHistory: [],
    };
    this.battleEventHandlers = new Map();
    this.matchmakingTickInFlight = false;

    // Start matchmaking ticker (check every 5 seconds)
    setInterval(() => {
      void this.tickMatchmaking();
    }, 5000);

    // Cleanup old queue entries every minute
    setInterval(() => this.matchmaking.cleanupOldEntries(), 60000);
  }

  private serializePlayerStats(): Record<string, PersistedPvPPlayerStats> {
    return Object.fromEntries(this.database.playerStats.entries());
  }

  private serializeMatchHistory(): Array<{ battleId: string; timestamp: number; result: PvPMatchResult }> {
    return this.database.matchHistory.slice(-MAX_MATCH_HISTORY);
  }

  private serializeQueues(): PersistedMatchmakingEntry[] {
    return this.matchmaking.snapshotQueues().flatMap((queue) =>
      queue.entries.map((entry) => ({
        ...entry,
        characterTokenId: entry.characterTokenId.toString(),
      }))
    );
  }

  private serializeActiveBattles(): PersistedActiveBattleSummary[] {
    return Array.from(this.activeBattles.entries()).map(([battleId, battle]) => {
      const state = battle.getState();
      return {
        battleId,
        format: state.config.format,
        status: state.status,
        playersCount: state.config.teamRed.length + state.config.teamBlue.length,
        createdAt: state.config.createdAt,
      };
    });
  }

  private async persistState(): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    await redis.mset({
      [REDIS_PVP_PLAYER_STATS_KEY]: JSON.stringify(this.serializePlayerStats()),
      [REDIS_PVP_MATCH_HISTORY_KEY]: JSON.stringify(this.serializeMatchHistory()),
      [REDIS_PVP_QUEUES_KEY]: JSON.stringify(this.serializeQueues()),
      [REDIS_PVP_ACTIVE_BATTLES_KEY]: JSON.stringify(this.serializeActiveBattles()),
    });
  }

  private persistStateEventually(context: string): void {
    void this.persistState().catch((err) => {
      console.warn(`[pvp] Failed to persist state after ${context}:`, err);
    });
  }

  async flushPersistence(context: string): Promise<void> {
    await this.persistState().catch((err) => {
      console.warn(`[pvp] Failed to persist state after ${context}:`, err);
      throw err;
    });
  }

  async restoreFromRedis(): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const [rawStats, rawHistory, rawQueues, rawActiveBattles] = await redis.mget(
      REDIS_PVP_PLAYER_STATS_KEY,
      REDIS_PVP_MATCH_HISTORY_KEY,
      REDIS_PVP_QUEUES_KEY,
      REDIS_PVP_ACTIVE_BATTLES_KEY,
    );

    if (rawStats) {
      const parsed = JSON.parse(rawStats) as Record<string, PersistedPvPPlayerStats>;
      this.database.playerStats = new Map(Object.entries(parsed));
    }

    if (rawHistory) {
      const parsed = JSON.parse(rawHistory) as Array<{ battleId: string; timestamp: number; result: PvPMatchResult }>;
      this.database.matchHistory = Array.isArray(parsed) ? parsed.slice(-MAX_MATCH_HISTORY) : [];
    }

    if (rawQueues) {
      const parsed = JSON.parse(rawQueues) as PersistedMatchmakingEntry[];
      const grouped = new Map<PvPFormat, MatchmakingEntry[]>();
      for (const entry of parsed ?? []) {
        const restored: MatchmakingEntry = {
          ...entry,
          characterTokenId: BigInt(entry.characterTokenId),
        };
        const existing = grouped.get(restored.format) ?? [];
        existing.push(restored);
        grouped.set(restored.format, existing);
      }

      this.matchmaking.restoreQueues(
        (["1v1", "2v2", "5v5", "ffa"] as PvPFormat[]).map((format) => ({
          format,
          entries: grouped.get(format) ?? [],
          minPlayers: format === "1v1" ? 2 : format === "2v2" ? 4 : format === "5v5" ? 10 : 4,
          maxPlayers: format === "1v1" ? 2 : format === "2v2" ? 4 : format === "5v5" ? 10 : 8,
        }))
      );
    }

    if (rawActiveBattles) {
      const parsed = JSON.parse(rawActiveBattles) as PersistedActiveBattleSummary[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        await redis.set(
          REDIS_PVP_RECOVERY_KEY,
          JSON.stringify({
            recoveredAt: Date.now(),
            cancelledBattles: parsed,
          })
        );
      }
      await redis.del(REDIS_PVP_ACTIVE_BATTLES_KEY);
    }
  }

  /**
   * Add player to matchmaking queue
   */
  async joinQueue(entry: MatchmakingEntry): Promise<void> {
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
    await this.flushPersistence("joinQueue");
  }

  /**
   * Remove player from queue
   */
  async leaveQueue(agentId: string, format: PvPFormat): Promise<boolean> {
    const removed = this.matchmaking.removeFromQueue(agentId, format);
    if (removed) await this.flushPersistence("leaveQueue");
    return removed;
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
  private async tickMatchmaking(): Promise<void> {
    if (this.matchmakingTickInFlight) return;
    this.matchmakingTickInFlight = true;

    const formats: PvPFormat[] = ["1v1", "2v2", "5v5", "ffa"];

    try {
      for (const format of formats) {
        const config = this.matchmaking.tryCreateMatch(format);
        if (config) {
          await this.createBattle(config);
        }
      }
    } finally {
      this.matchmakingTickInFlight = false;
    }
  }

  /**
   * Create a new battle
   */
  async createBattle(config: PvPBattleConfig): Promise<string> {
    const battle = new PvPBattleEngine(config);

    // Set to betting phase
    battle.setBettingPhase();

    this.activeBattles.set(config.battleId, battle);
    await this.flushPersistence("createBattle");

    // Schedule battle start after bet lock time
    setTimeout(() => {
      if (this.activeBattles.has(config.battleId)) {
        const b = this.activeBattles.get(config.battleId);
        if (b && b.battleStatus === "betting") {
          b.startBattle();
          this.persistStateEventually("battleStart");
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

    // Update on-chain reputation via ERC-8004
    void pvpReputationIntegration.updateReputationFromBattle(result);

    // Store match history
    this.database.matchHistory.push({
      battleId,
      timestamp: Date.now(),
      result,
    });
    this.database.matchHistory = this.database.matchHistory.slice(-MAX_MATCH_HISTORY);
    this.persistStateEventually("handleBattleCompletion");

    // Clean up battle after 5 minutes (keep for replays)
    setTimeout(() => {
      this.activeBattles.delete(battleId);
      this.persistStateEventually("battleCleanup");
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
   * Check if a player is currently in an active (non-completed) battle
   */
  isInActiveBattle(agentId: string): boolean {
    return this.getActiveBattleForPlayer(agentId) !== null;
  }

  /**
   * Get the active battle a player is in (if any)
   */
  getActiveBattleForPlayer(agentId: string): { battleId: string; status: string } | null {
    for (const [battleId, battle] of this.activeBattles.entries()) {
      const state = battle.getState();
      if (state.status === "completed" || state.status === "cancelled") continue;
      const inRed = state.config.teamRed.some((c) => c.agentId === agentId);
      const inBlue = state.config.teamBlue.some((c) => c.agentId === agentId);
      if (inRed || inBlue) return { battleId, status: state.status };
    }
    return null;
  }

  /**
   * Cancel a battle (admin function)
   */
  cancelBattle(battleId: string): boolean {
    const battle = this.activeBattles.get(battleId);
    if (!battle) return false;

    battle.cancelBattle();
    this.activeBattles.delete(battleId);
    this.persistStateEventually("cancelBattle");
    return true;
  }
}

// Global singleton instance
export const pvpBattleManager = new PvPBattleManager();
