/**
 * Battle Engine Stub
 * TODO: Implement full battle engine logic
 */

import type { BattleAction, TurnRecord, BattlePhase, Combatant, BattleState } from "../types/battle.js";

export class BattleEngine {
  private phase: BattlePhase | "victory" | "defeat" = "preparation";
  private log: TurnRecord[] = [];
  private combatants: Combatant[];

  constructor(
    private battleId: string,
    teamRed: any[],
    teamBlue: any[],
    private enemyXpValues: Map<string, number>
  ) {
    // Combine both teams into combatants array
    this.combatants = [...teamRed, ...teamBlue].map((c) => ({
      id: c.id,
      name: c.name || "Unknown",
      alive: true,
      stats: c.stats || {
        hp: 100,
        maxHp: 100,
        mp: 50,
        maxMp: 50,
        str: 10,
        def: 10,
        agi: 10,
        int: 10,
      },
    }));
  }

  submitAction(action: BattleAction): BattleState {
    // Stub implementation - just log the action
    const turn: TurnRecord = {
      turn: this.log.length + 1,
      actions: [action],
      timestamp: Date.now(),
    };
    this.log.push(turn);
    return this.getState();
  }

  getState(): BattleState {
    return {
      combatants: this.combatants,
      log: this.log,
      phase: this.phase,
    };
  }
}
