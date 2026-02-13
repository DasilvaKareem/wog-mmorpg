/**
 * PvP Reputation Integration
 * Connects PvP battle results with ERC-8004 reputation system
 */

import { reputationManager, ReputationCategory } from "./reputationManager.js";
import type { PvPMatchResult, PvPBattleState } from "./types/pvp.js";

export class PvPReputationIntegration {
  /**
   * Update reputation after a PvP battle completes
   */
  async updateReputationFromBattle(result: PvPMatchResult): Promise<void> {
    try {
      // Update red team
      for (const player of result.teamRed) {
        const won = result.winner === "red";
        const isMVP = player.agentId === result.mvp.agentId;

        // Get character token ID (in production, fetch from database)
        // For now, we'll use agentId as placeholder
        const characterTokenId = BigInt(1); // TODO: Get actual character token ID

        // Calculate performance score (0-100) based on ELO change
        const performanceScore = this.calculatePerformanceScore(
          player.eloChange,
          won,
          isMVP
        );

        // Update combat reputation
        await reputationManager.updateCombatReputation(
          characterTokenId,
          won,
          performanceScore
        );

        // MVP bonus
        if (isMVP) {
          await reputationManager.submitFeedback(
            characterTokenId,
            ReputationCategory.Combat,
            25,
            "Awarded MVP in PvP battle"
          );
        }
      }

      // Update blue team
      for (const player of result.teamBlue) {
        const won = result.winner === "blue";
        const isMVP = player.agentId === result.mvp.agentId;

        const characterTokenId = BigInt(1); // TODO: Get actual character token ID

        const performanceScore = this.calculatePerformanceScore(
          player.eloChange,
          won,
          isMVP
        );

        await reputationManager.updateCombatReputation(
          characterTokenId,
          won,
          performanceScore
        );

        if (isMVP) {
          await reputationManager.submitFeedback(
            characterTokenId,
            ReputationCategory.Combat,
            25,
            "Awarded MVP in PvP battle"
          );
        }
      }

      console.log(`[PvPReputation] Updated reputation for battle ${result.battleId}`);
    } catch (error) {
      console.error(`[PvPReputation] Error updating reputation:`, error);
    }
  }

  /**
   * Calculate performance score based on ELO change and outcome
   */
  private calculatePerformanceScore(
    eloChange: number,
    won: boolean,
    isMVP: boolean
  ): number {
    let score = 50; // Base score

    if (won) {
      // Winners get higher base score
      score = 70;

      // ELO gain indicates strength of opponent
      // Higher ELO gain = tougher opponent = better performance
      if (eloChange > 20) score += 20; // Beat stronger opponent
      else if (eloChange > 10) score += 10;
      else score += 5;
    } else {
      // Losers get lower base score
      score = 30;

      // Small ELO loss indicates close game
      if (eloChange > -10) score += 20; // Close loss
      else if (eloChange > -20) score += 10;
    }

    // MVP bonus
    if (isMVP) {
      score += 10;
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Update reputation for honorable/dishonorable behavior
   */
  async reportBehavior(
    characterTokenId: bigint,
    honorable: boolean,
    reason: string
  ): Promise<void> {
    const delta = honorable ? 10 : -20;

    await reputationManager.submitFeedback(
      characterTokenId,
      ReputationCategory.Combat,
      delta,
      reason
    );
  }

  /**
   * Batch update reputation for tournament results
   */
  async updateTournamentReputation(
    winners: Array<{ characterTokenId: bigint; placement: number }>,
    tournamentName: string
  ): Promise<void> {
    for (const winner of winners) {
      let delta = 0;

      switch (winner.placement) {
        case 1:
          delta = 50;
          break; // 1st place
        case 2:
          delta = 30;
          break; // 2nd place
        case 3:
          delta = 20;
          break; // 3rd place
        default:
          delta = 10;
          break; // Participation
      }

      await reputationManager.submitFeedback(
        winner.characterTokenId,
        ReputationCategory.Combat,
        delta,
        `Placed ${this.getOrdinal(winner.placement)} in ${tournamentName}`
      );
    }
  }

  /**
   * Helper to get ordinal suffix (1st, 2nd, 3rd, etc.)
   */
  private getOrdinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
}

// Global singleton
export const pvpReputationIntegration = new PvPReputationIntegration();
