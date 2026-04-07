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
import { arenaManager, type ArenaMatchState, type ArenaMatchResult } from "./arenaManager.js";
import { predictionPoolManager } from "../economy/predictionPoolManager.js";

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

const MVP_REWARD_GOLD = 100;
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
  private battleToPoolMap: Map<string, string> = new Map();

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

    // Register for arena match completions to update stats/ELO/history
    arenaManager.setOnMatchComplete((result) => {
      this.handleArenaMatchCompletion(result);
    });
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
   * Return which formats an agent is currently queued in.
   */
  getQueuedFormats(agentId: string): PvPFormat[] {
    return this.matchmaking.getQueuedFormats(agentId);
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
        const queueStatus = this.matchmaking.getQueueStatus(format);
        if (queueStatus.playersInQueue > 0) {
          console.log(`[pvp-debug] ${format} queue: ${queueStatus.playersInQueue} players, need ${queueStatus.playersNeeded} more`);
        }
        const config = this.matchmaking.tryCreateMatch(format);
        if (config) {
          const redIds = config.teamRed.map((c) => `${c.agentId}`).join(",");
          const blueIds = config.teamBlue.map((c) => `${c.agentId}`).join(",");
          console.log(`[pvp-debug] ${format} match found! red=[${redIds}] blue=[${blueIds}] arena=${config.arena.name}`);
          try {
            await this.createBattle(config);
          } catch (err) {
            console.error(`[pvp-debug] ${format} createBattle failed: ${(err as Error).message}`);
            // tryCreateMatch already removed entries from the in-memory queue;
            // persist so stale entries don't come back after restart
            this.persistStateEventually("matchmaking-failed");
          }
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
    // Use ArenaManager for in-world PvP — teleport real entities to arena zone
    try {
      const battleId = arenaManager.startArenaMatch({
        teamRedEntityIds: config.teamRed.map((c) => c.agentId),
        teamBlueEntityIds: config.teamBlue.map((c) => c.agentId),
        format: config.format,
        arena: config.arena,
      });
      console.log(`[pvp] Arena match started: ${battleId} (${config.format})`);

      // Create prediction pool for betting (non-blocking)
      predictionPoolManager.createPool(battleId, 180, 15).then((poolId) => {
        this.battleToPoolMap.set(battleId, poolId);
        console.log(`[pvp] Prediction pool ${poolId} created for battle ${battleId}`);
      }).catch((err) => {
        console.warn(`[pvp] Prediction pool creation failed (non-fatal): ${(err as Error).message}`);
      });

      return battleId;
    } catch (err) {
      console.error(`[pvp] Failed to start arena match: ${(err as Error).message}`);
      throw err;
    }
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
    // Check arena manager first (in-world matches)
    const arenaState = arenaManager.getMatchState(battleId);
    if (arenaState) return this.arenaStateToLegacy(arenaState);
    // Fallback to old engine for any lingering battles
    const battle = this.activeBattles.get(battleId);
    return battle ? battle.getState() : null;
  }

  private arenaStateToLegacy(a: ArenaMatchState): PvPBattleState {
    const mapCombatant = (c: (typeof a.teamRed)[0], team: "red" | "blue") => ({
      id: c.entityId, name: c.name, agentId: c.entityId, pvpTeam: team,
      stats: { hp: c.hp, maxHp: c.maxHp, mp: 0, maxMp: 0, attack: 0, defense: 0, speed: 0 },
      alive: c.alive, elo: 1000, position: { x: 0, y: 0 },
    });
    return {
      battleId: a.battleId,
      status: a.status,
      config: {
        battleId: a.battleId, format: a.format,
        duration: Math.round(a.durationTicks / 2), betLockTime: 15, createdAt: Date.now(),
        arena: { mapId: a.arenaName, name: a.arenaName, tileSet: "", width: 64, height: 64, spawnPoints: { red: [], blue: [] }, obstacles: [], powerUps: [], hazards: [] },
        teamRed: a.teamRed.map((c) => mapCombatant(c, "red")),
        teamBlue: a.teamBlue.map((c) => mapCombatant(c, "blue")),
        executionOrder: "simultaneous", minLevel: 1, maxLevel: 99,
      },
      turnCount: Math.round(a.elapsedTicks / 2),
      log: [],
      statistics: {
        teamRedDamage: a.statistics.teamRedDamage,
        teamBlueDamage: a.statistics.teamBlueDamage,
        teamRedKills: a.statistics.teamRedKills,
        teamBlueKills: a.statistics.teamBlueKills,
        teamRedHealing: 0, teamBlueHealing: 0,
      },
      winner: a.winner ?? undefined,
      mvp: a.mvp?.entityId ?? undefined,
    } as any;
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
   * Handle completion of an ArenaManager match — update stats, ELO, and history.
   */
  private handleArenaMatchCompletion(result: ArenaMatchResult): void {
    const isFFA = result.format === "ffa";

    for (const combatant of result.combatants) {
      const agentId = combatant.entityId;
      let stats = this.database.playerStats.get(agentId);

      if (!stats) {
        stats = {
          walletAddress: combatant.walletAddress ?? "",
          elo: 1000,
          wins: 0,
          losses: 0,
          currentStreak: 0,
          bestStreak: 0,
          totalDamage: 0,
          totalKills: 0,
          mvpCount: 0,
        };
        this.database.playerStats.set(agentId, stats);
      }

      // Determine win/loss
      const won = isFFA
        ? combatant.entityId === result.ffaWinnerId
        : combatant.team === result.winner;

      // Calculate ELO change using real stored ELO
      const opponentElos = result.combatants
        .filter((c) => (isFFA ? c.entityId !== agentId : c.team !== combatant.team))
        .map((c) => this.database.playerStats.get(c.entityId)?.elo ?? 1000);
      const avgOpponentElo = opponentElos.length > 0
        ? opponentElos.reduce((a, b) => a + b, 0) / opponentElos.length
        : 1000;

      const expectedScore = 1 / (1 + Math.pow(10, (avgOpponentElo - stats.elo) / 400));
      const eloChange = Math.round(32 * ((won ? 1 : 0) - expectedScore));

      stats.elo = Math.max(0, stats.elo + eloChange);
      stats.totalDamage += combatant.damageDealt;
      stats.totalKills += combatant.kills;

      if (won) {
        stats.wins++;
        stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
      } else {
        stats.losses++;
        stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
      }
      stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);

      if (result.mvp && result.mvp.entityId === agentId) {
        stats.mvpCount++;
      }
    }

    // Build match history entry
    const teamRedCombatants = result.combatants.filter((c) => c.team === "red");
    const teamBlueCombatants = result.combatants.filter((c) => c.team === "blue");

    const matchResult: PvPMatchResult = {
      battleId: result.battleId,
      winner: result.winner,
      duration: result.duration,
      teamRed: teamRedCombatants.map((c) => ({
        agentId: c.entityId,
        walletAddress: c.walletAddress ?? "",
        eloChange: 0,
        newElo: this.database.playerStats.get(c.entityId)?.elo ?? 1000,
      })),
      teamBlue: teamBlueCombatants.map((c) => ({
        agentId: c.entityId,
        walletAddress: c.walletAddress ?? "",
        eloChange: 0,
        newElo: this.database.playerStats.get(c.entityId)?.elo ?? 1000,
      })),
      mvp: {
        agentId: result.mvp?.entityId ?? "",
        walletAddress: result.combatants.find((c) => c.entityId === result.mvp?.entityId)?.walletAddress ?? "",
        reward: BigInt(MVP_REWARD_GOLD) * BigInt(10 ** 18),
      },
    };

    this.database.matchHistory.push({
      battleId: result.battleId,
      timestamp: Date.now(),
      result: matchResult,
    });
    this.database.matchHistory = this.database.matchHistory.slice(-MAX_MATCH_HISTORY);

    // Update on-chain reputation
    void pvpReputationIntegration.updateReputationFromBattle(matchResult);

    // Settle prediction pool
    const poolId = this.battleToPoolMap.get(result.battleId);
    if (poolId) {
      predictionPoolManager.settlePool(poolId, result.winner).then(() => {
        console.log(`[pvp] Prediction pool ${poolId} settled — winner: ${result.winner}`);
      }).catch((err) => {
        console.warn(`[pvp] Prediction pool settlement failed: ${(err as Error).message}`);
      });
      this.battleToPoolMap.delete(result.battleId);
    }

    this.persistStateEventually("arenaMatchCompletion");
    console.log(`[pvp] Arena match ${result.battleId} stats updated — winner: ${isFFA ? result.ffaWinnerId : result.winner}`);
  }

  /** Get the prediction pool ID linked to a battle. */
  getPoolForBattle(battleId: string): string | undefined {
    return this.battleToPoolMap.get(battleId);
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
  getActiveBattles(): PvPBattleState[] {
    const battles: PvPBattleState[] = [];

    for (const match of arenaManager.getActiveMatches()) {
      const state = arenaManager.getMatchState(match.battleId);
      if (!state) continue;
      const legacyState = this.arenaStateToLegacy(state);
      const poolId = this.getPoolForBattle(match.battleId);
      if (poolId) {
        legacyState.config.marketPoolId = poolId;
      }
      battles.push(legacyState);
    }

    for (const [battleId, battle] of this.activeBattles.entries()) {
      const state = battle.getState();
      const poolId = this.getPoolForBattle(battleId);
      if (poolId) {
        state.config.marketPoolId = poolId;
      }
      battles.push(state);
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
    // Check arena manager first (agentId is actually entityId in the queue)
    const arenaMatch = arenaManager.getMatchForPlayer(agentId);
    if (arenaMatch) return { battleId: arenaMatch.battleId, status: arenaMatch.status };
    // Legacy fallback
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
    // Try arena manager first
    if (arenaManager.cancelMatch(battleId)) return true;
    // Legacy fallback
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
