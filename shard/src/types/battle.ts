/**
 * Battle Engine Types
 */

export type BattlePhase = "preparation" | "combat" | "resolution" | "completed";

export interface BattleAction {
  actorId: string;
  type: "attack" | "defend" | "skill" | "item";
  targetId?: string;
  skillId?: string;
  itemId?: string;
}

export interface TurnRecord {
  turn: number;
  actions: BattleAction[];
  timestamp: number;
}

export interface BattleResult {
  winnerId?: string;
  loserId?: string;
  turns: TurnRecord[];
  duration: number;
}

export interface Combatant {
  id: string;
  name: string;
  alive: boolean;
  stats: {
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    str: number;
    def: number;
    agi: number;
    int: number;
  };
}

export interface BattleState {
  combatants: Combatant[];
  log: TurnRecord[];
  phase: BattlePhase | "victory" | "defeat";
}
