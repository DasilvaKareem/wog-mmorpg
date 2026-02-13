/**
 * PvP Battle Engine
 * Extends the base battle engine with team-based combat, timers, and statistics tracking
 */

import type {
  PvPBattleConfig,
  PvPBattleState,
  PvPCombatant,
  PvPTeam,
  MatchStatus,
  BattleStatistics,
  CombatantStatistics,
  PvPMatchResult,
} from "./types/pvp.js";
import type { BattleAction, TurnRecord, BattlePhase } from "../src/types/battle.js";
import { BattleEngine } from "../src/runtime/battle-engine.js";

const ELO_K_FACTOR = 32;
const MVP_REWARD_GOLD = 100; // Bonus GOLD for MVP

export class PvPBattleEngine {
  private config: PvPBattleConfig;
  private battleEngine: BattleEngine;
  private status: MatchStatus;
  private startedAt?: number;
  private completedAt?: number;
  private winner?: PvPTeam;
  private statistics: BattleStatistics;
  private battleTimer?: NodeJS.Timeout;

  constructor(config: PvPBattleConfig) {
    this.config = config;
    this.status = "queued";
    this.statistics = {
      teamRedDamage: 0,
      teamBlueDamage: 0,
      teamRedKills: 0,
      teamBlueKills: 0,
      combatantStats: new Map(),
    };

    // Initialize combatant statistics
    [...config.teamRed, ...config.teamBlue].forEach((c) => {
      this.statistics.combatantStats.set(c.id, {
        combatantId: c.id,
        damageDealt: 0,
        damageTaken: 0,
        healingDone: 0,
        kills: 0,
        deaths: 0,
        actionsUsed: new Map(),
      });
    });

    // Initialize base battle engine
    const enemyXpValues = new Map<string, number>();
    // No XP in PvP
    this.battleEngine = new BattleEngine(
      config.battleId,
      config.teamRed,
      config.teamBlue,
      enemyXpValues
    );
  }

  /**
   * Start the battle - moves from queued/betting to in_progress
   */
  startBattle(): void {
    if (this.status !== "queued" && this.status !== "betting") {
      throw new Error(`Cannot start battle in status: ${this.status}`);
    }

    this.status = "in_progress";
    this.startedAt = Date.now();
    this.config.startTime = this.startedAt;

    // Set battle timer
    const durationMs = this.config.duration * 1000;
    this.battleTimer = setTimeout(() => {
      this.timeExpired();
    }, durationMs);
  }

  /**
   * Handle battle timer expiration - determine winner by HP/kills
   */
  private timeExpired(): void {
    if (this.status !== "in_progress") return;

    // Calculate winner based on remaining HP + kills
    const teamRedScore = this.calculateTeamScore("red");
    const teamBlueScore = this.calculateTeamScore("blue");

    if (teamRedScore > teamBlueScore) {
      this.winner = "red";
    } else if (teamBlueScore > teamRedScore) {
      this.winner = "blue";
    } else {
      // Tie - random winner (very rare)
      this.winner = Math.random() > 0.5 ? "red" : "blue";
    }

    this.completeBattle();
  }

  /**
   * Calculate team score: (alive combatants * 1000) + total HP + (kills * 500)
   */
  private calculateTeamScore(team: PvPTeam): number {
    const state = this.battleEngine.getState();
    const teamCombatants = state.combatants.filter(
      (c) => (c as PvPCombatant).pvpTeam === team
    );

    const aliveCount = teamCombatants.filter((c) => c.alive).length;
    const totalHp = teamCombatants.reduce((sum, c) => sum + c.stats.hp, 0);
    const kills =
      team === "red" ? this.statistics.teamRedKills : this.statistics.teamBlueKills;

    return aliveCount * 1000 + totalHp + kills * 500;
  }

  /**
   * Submit an action for a combatant
   */
  submitAction(action: BattleAction): PvPBattleState {
    if (this.status !== "in_progress") {
      throw new Error(`Cannot submit action in status: ${this.status}`);
    }

    // Submit to base battle engine
    const baseState = this.battleEngine.submitAction(action);

    // Track statistics from the action
    const latestTurn = baseState.log[baseState.log.length - 1];
    if (latestTurn) {
      this.updateStatistics(latestTurn);
    }

    // Check if battle ended naturally (all of one team dead)
    if (baseState.phase === "victory" || baseState.phase === "defeat") {
      const teamRedAlive = baseState.combatants.some(
        (c) => (c as PvPCombatant).pvpTeam === "red" && c.alive
      );
      const teamBlueAlive = baseState.combatants.some(
        (c) => (c as PvPCombatant).pvpTeam === "blue" && c.alive
      );

      if (!teamRedAlive) {
        this.winner = "blue";
      } else if (!teamBlueAlive) {
        this.winner = "red";
      }

      this.completeBattle();
    }

    return this.getState();
  }

  /**
   * Update statistics based on turn record
   */
  private updateStatistics(turn: TurnRecord): void {
    const actorStats = this.statistics.combatantStats.get(turn.actorId);
    if (!actorStats) return;

    // Track action usage
    const count = actorStats.actionsUsed.get(turn.actionId) || 0;
    actorStats.actionsUsed.set(turn.actionId, count + 1);

    // Track damage
    if (turn.damage && turn.targetId) {
      actorStats.damageDealt += turn.damage;

      // Track team damage
      const actor = this.battleEngine
        .getState()
        .combatants.find((c) => c.id === turn.actorId) as PvPCombatant;
      if (actor?.pvpTeam === "red") {
        this.statistics.teamRedDamage += turn.damage;
      } else if (actor?.pvpTeam === "blue") {
        this.statistics.teamBlueDamage += turn.damage;
      }

      // Track damage taken
      const targetStats = this.statistics.combatantStats.get(turn.targetId);
      if (targetStats) {
        targetStats.damageTaken += turn.damage;
      }
    }

    // Track healing
    if (turn.healing) {
      actorStats.healingDone += turn.healing;
    }

    // Track kills
    if (turn.killed && turn.targetId) {
      actorStats.kills++;

      const actor = this.battleEngine
        .getState()
        .combatants.find((c) => c.id === turn.actorId) as PvPCombatant;
      if (actor?.pvpTeam === "red") {
        this.statistics.teamRedKills++;
      } else if (actor?.pvpTeam === "blue") {
        this.statistics.teamBlueKills++;
      }

      // Track deaths
      const targetStats = this.statistics.combatantStats.get(turn.targetId);
      if (targetStats) {
        targetStats.deaths++;
      }
    }
  }

  /**
   * Complete the battle - cleanup and finalize
   */
  private completeBattle(): void {
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
    }

    this.status = "completed";
    this.completedAt = Date.now();
    this.config.endTime = this.completedAt;
  }

  /**
   * Cancel the battle
   */
  cancelBattle(): void {
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
    }
    this.status = "cancelled";
  }

  /**
   * Get current battle state
   */
  getState(): PvPBattleState {
    const baseState = this.battleEngine.getState();

    return {
      ...baseState,
      config: this.config,
      status: this.status,
      winner: this.winner,
      mvp: this.getMVP(),
      statistics: this.statistics,
    };
  }

  /**
   * Determine MVP (most damage + kills)
   */
  private getMVP(): string | undefined {
    let mvpId: string | undefined;
    let highestScore = 0;

    for (const [combatantId, stats] of this.statistics.combatantStats.entries()) {
      const score = stats.damageDealt + stats.kills * 200;
      if (score > highestScore) {
        highestScore = score;
        mvpId = combatantId;
      }
    }

    return mvpId;
  }

  /**
   * Calculate match results with ELO changes
   */
  calculateMatchResult(): PvPMatchResult {
    if (!this.winner) {
      throw new Error("Cannot calculate results before battle completes");
    }

    const mvpId = this.getMVP();
    const mvpCombatant = [...this.config.teamRed, ...this.config.teamBlue].find(
      (c) => c.id === mvpId
    );

    const duration = this.completedAt
      ? (this.completedAt - (this.startedAt || 0)) / 1000
      : 0;

    // Calculate ELO changes
    const teamRedResults = this.config.teamRed.map((c) => {
      const won = this.winner === "red";
      const eloChange = this.calculateEloChange(c.elo, this.getAverageElo("blue"), won);

      return {
        agentId: c.agentId,
        walletAddress: c.walletAddress,
        eloChange,
        newElo: c.elo + eloChange,
      };
    });

    const teamBlueResults = this.config.teamBlue.map((c) => {
      const won = this.winner === "blue";
      const eloChange = this.calculateEloChange(c.elo, this.getAverageElo("red"), won);

      return {
        agentId: c.agentId,
        walletAddress: c.walletAddress,
        eloChange,
        newElo: c.elo + eloChange,
      };
    });

    return {
      battleId: this.config.battleId,
      winner: this.winner,
      duration,
      teamRed: teamRedResults,
      teamBlue: teamBlueResults,
      mvp: {
        agentId: mvpCombatant?.agentId || "",
        walletAddress: mvpCombatant?.walletAddress || "",
        reward: BigInt(MVP_REWARD_GOLD) * BigInt(10 ** 18), // Convert to wei
      },
    };
  }

  /**
   * Calculate ELO change for a player
   */
  private calculateEloChange(
    playerElo: number,
    opponentAvgElo: number,
    won: boolean
  ): number {
    const expectedScore =
      1 / (1 + Math.pow(10, (opponentAvgElo - playerElo) / 400));
    const actualScore = won ? 1 : 0;
    return Math.round(ELO_K_FACTOR * (actualScore - expectedScore));
  }

  /**
   * Get average ELO of a team
   */
  private getAverageElo(team: PvPTeam): number {
    const combatants = team === "red" ? this.config.teamRed : this.config.teamBlue;
    const totalElo = combatants.reduce((sum, c) => sum + c.elo, 0);
    return totalElo / combatants.length;
  }

  get battleId(): string {
    return this.config.battleId;
  }

  get battleStatus(): MatchStatus {
    return this.status;
  }

  get battleWinner(): PvPTeam | undefined {
    return this.winner;
  }

  /**
   * Set status to betting (before battle starts)
   */
  setBettingPhase(): void {
    if (this.status !== "queued") {
      throw new Error(`Cannot enter betting phase from status: ${this.status}`);
    }
    this.status = "betting";
  }
}
