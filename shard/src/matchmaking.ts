/**
 * Matchmaking System for PvP
 * Handles queue management and match creation
 */

import type {
  MatchmakingEntry,
  MatchmakingQueue,
  PvPFormat,
  PvPCombatant,
  PvPBattleConfig,
  PvPTeam,
} from "./types/pvp.js";
import { randomUUID } from "crypto";
import { getMapByLevel, getMapByFormat } from "./coliseumMaps.js";

const MAX_QUEUE_TIME_MS = 120000; // 2 minutes max queue time
const ELO_RANGE_BASE = 100; // Initial ELO range for matching
const ELO_RANGE_EXPANSION_PER_30S = 50; // Expand range every 30s

export class MatchmakingSystem {
  private queues: Map<PvPFormat, MatchmakingQueue>;

  constructor() {
    this.queues = new Map([
      ["1v1", { format: "1v1", entries: [], minPlayers: 2, maxPlayers: 2 }],
      ["2v2", { format: "2v2", entries: [], minPlayers: 4, maxPlayers: 4 }],
      ["5v5", { format: "5v5", entries: [], minPlayers: 10, maxPlayers: 10 }],
      ["ffa", { format: "ffa", entries: [], minPlayers: 4, maxPlayers: 8 }],
    ]);
  }

  /**
   * Add a player to the matchmaking queue
   */
  addToQueue(entry: MatchmakingEntry): void {
    const queue = this.queues.get(entry.format);
    if (!queue) {
      throw new Error(`Invalid format: ${entry.format}`);
    }

    // Check if already queued
    const existingIndex = queue.entries.findIndex(
      (e) => e.agentId === entry.agentId
    );
    if (existingIndex !== -1) {
      // Update existing entry
      queue.entries[existingIndex] = entry;
    } else {
      // Add new entry
      queue.entries.push(entry);
    }
  }

  /**
   * Remove a player from the queue
   */
  removeFromQueue(agentId: string, format: PvPFormat): boolean {
    const queue = this.queues.get(format);
    if (!queue) return false;

    const index = queue.entries.findIndex((e) => e.agentId === agentId);
    if (index !== -1) {
      queue.entries.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Remove a player from all queues
   */
  removeFromAllQueues(agentId: string): void {
    for (const queue of this.queues.values()) {
      const index = queue.entries.findIndex((e) => e.agentId === agentId);
      if (index !== -1) {
        queue.entries.splice(index, 1);
      }
    }
  }

  /**
   * Get queue status for a format
   */
  getQueueStatus(format: PvPFormat): {
    format: PvPFormat;
    playersInQueue: number;
    playersNeeded: number;
    averageWaitTime: number;
  } {
    const queue = this.queues.get(format);
    if (!queue) {
      throw new Error(`Invalid format: ${format}`);
    }

    const now = Date.now();
    const totalWaitTime = queue.entries.reduce(
      (sum, e) => sum + (now - e.queuedAt),
      0
    );
    const averageWaitTime =
      queue.entries.length > 0 ? totalWaitTime / queue.entries.length : 0;

    return {
      format,
      playersInQueue: queue.entries.length,
      playersNeeded: queue.minPlayers - queue.entries.length,
      averageWaitTime,
    };
  }

  /**
   * Attempt to create a match from queued players
   * Returns null if no suitable match can be made
   */
  tryCreateMatch(format: PvPFormat): PvPBattleConfig | null {
    const queue = this.queues.get(format);
    if (!queue) return null;

    // Not enough players
    if (queue.entries.length < queue.minPlayers) {
      return null;
    }

    // Try to find a balanced match
    const match = this.findBalancedMatch(queue);
    if (!match) return null;

    // Remove matched players from queue
    match.forEach((entry) => {
      const index = queue.entries.findIndex((e) => e.agentId === entry.agentId);
      if (index !== -1) {
        queue.entries.splice(index, 1);
      }
    });

    // Create battle config
    return this.createBattleConfig(format, match);
  }

  /**
   * Find a balanced match from queue entries
   */
  private findBalancedMatch(queue: MatchmakingQueue): MatchmakingEntry[] | null {
    const now = Date.now();
    const entries = [...queue.entries];

    // Sort by queue time (oldest first for fairness)
    entries.sort((a, b) => a.queuedAt - b.queuedAt);

    // For each potential match starter, try to build a team
    for (const starter of entries) {
      const timeInQueue = now - starter.queuedAt;
      const eloRange =
        ELO_RANGE_BASE +
        Math.floor(timeInQueue / 30000) * ELO_RANGE_EXPANSION_PER_30S;

      // Find players within ELO range
      const candidates = entries.filter((e) => {
        return Math.abs(e.elo - starter.elo) <= eloRange;
      });

      if (candidates.length >= queue.minPlayers) {
        // Take the required number of players
        const matchPlayers = candidates.slice(0, queue.maxPlayers);

        // For team formats, balance teams by ELO
        if (queue.format !== "ffa") {
          return this.balanceTeams(matchPlayers);
        }

        return matchPlayers;
      }
    }

    // Force match if someone has been waiting too long
    const oldestEntry = entries[0];
    if (oldestEntry && now - oldestEntry.queuedAt > MAX_QUEUE_TIME_MS) {
      // Just take the first N players
      return entries.slice(0, queue.maxPlayers);
    }

    return null;
  }

  /**
   * Balance teams by ELO (snake draft style)
   */
  private balanceTeams(players: MatchmakingEntry[]): MatchmakingEntry[] {
    // Sort by ELO descending
    const sorted = [...players].sort((a, b) => b.elo - a.elo);

    // Snake draft: 1->2, 2->1, 1->2, 2->1...
    const balanced: MatchmakingEntry[] = [];
    let teamToggle = true;

    for (let i = 0; i < sorted.length; i++) {
      if (i % 2 === 0) {
        teamToggle = true;
      } else {
        teamToggle = !teamToggle;
      }
      balanced.push(sorted[i]);
    }

    return balanced;
  }

  /**
   * Create battle config from matched players
   */
  private createBattleConfig(
    format: PvPFormat,
    players: MatchmakingEntry[]
  ): PvPBattleConfig {
    const battleId = randomUUID();
    const now = Date.now();

    // Determine battle duration based on format
    let duration = 300; // Default 5 minutes
    if (format === "1v1") duration = 180; // 3 minutes for 1v1
    if (format === "ffa") duration = 420; // 7 minutes for FFA

    // Determine level range
    const levels = players.map((p) => p.level);
    const minLevel = Math.min(...levels);
    const maxLevel = Math.max(...levels);

    // Select arena
    const avgLevel = levels.reduce((sum, l) => sum + l, 0) / levels.length;
    const arena =
      format === "ffa"
        ? getMapByFormat("ffa")
        : getMapByLevel(Math.floor(avgLevel));

    // Assign teams
    const playersPerTeam = format === "ffa" ? 1 : players.length / 2;
    const teamRed: PvPCombatant[] = [];
    const teamBlue: PvPCombatant[] = [];

    players.forEach((player, index) => {
      const combatant = this.createCombatantFromEntry(player, index);

      if (format === "ffa") {
        // FFA: everyone on separate "teams" (actually all vs all)
        combatant.pvpTeam = "none";
        teamRed.push(combatant);
      } else {
        // Team formats
        if (index < playersPerTeam) {
          combatant.pvpTeam = "red";
          teamRed.push(combatant);
        } else {
          combatant.pvpTeam = "blue";
          teamBlue.push(combatant);
        }
      }
    });

    return {
      battleId,
      format,
      duration,
      betLockTime: 60, // Lock bets 60s before start
      createdAt: now,
      arena,
      teamRed,
      teamBlue,
      executionOrder: "size", // Execute largest bets first by default
      minLevel,
      maxLevel,
    };
  }

  /**
   * Create PvPCombatant from matchmaking entry
   */
  private createCombatantFromEntry(
    entry: MatchmakingEntry,
    index: number
  ): PvPCombatant {
    // Base stats from level (simplified)
    const baseHp = 100 + entry.level * 20;
    const baseAttack = 10 + entry.level * 2;
    const baseDefense = 5 + entry.level * 1;
    const baseSpeed = 50 + Math.random() * 20;

    return {
      id: `combatant_${entry.agentId}_${index}`,
      name: `Agent ${entry.agentId.substring(0, 8)}`,
      team: "party", // Base type, overridden by pvpTeam
      pvpTeam: "red", // Will be set in createBattleConfig
      agentId: entry.agentId,
      walletAddress: entry.walletAddress,
      stats: {
        maxHp: baseHp,
        hp: baseHp,
        attack: baseAttack,
        defense: baseDefense,
        speed: baseSpeed,
      },
      statuses: [],
      nextActTime: 0,
      alive: true,
      gear: {},
      elo: entry.elo,
      winStreak: 0,
      totalWins: 0,
      totalLosses: 0,
    };
  }

  /**
   * Get all queues status
   */
  getAllQueuesStatus(): Array<{
    format: PvPFormat;
    playersInQueue: number;
    playersNeeded: number;
    averageWaitTime: number;
  }> {
    return Array.from(this.queues.keys()).map((format) =>
      this.getQueueStatus(format)
    );
  }

  /**
   * Clean up old queue entries (for maintenance)
   */
  cleanupOldEntries(maxAge: number = 600000): void {
    // 10 minutes
    const now = Date.now();

    for (const queue of this.queues.values()) {
      queue.entries = queue.entries.filter((e) => now - e.queuedAt < maxAge);
    }
  }
}
