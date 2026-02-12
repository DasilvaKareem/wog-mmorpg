export type Team = "party" | "enemy";
export type StatusEffect = "haste" | "slow" | "stop" | "poison" | "regen";
export type BattlePhase = "awaiting_action" | "victory" | "defeat" | "fled";
export type ActionKind = "attack" | "defend" | "skill" | "item" | "flee";

export interface CombatantStats {
  maxHp: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;        // CTB battle speed (1-100)
}

export interface Combatant {
  id: string;
  name: string;
  team: Team;
  stats: CombatantStats;
  statuses: StatusEffect[];
  nextActTime: number;
  alive: boolean;
}

export interface ActionDef {
  kind: ActionKind;
  name: string;
  baseDelay: number;
  power: number;         // damage/heal multiplier (1.0 = 100% of attack)
}

/** Default actions available to all combatants */
export const ACTIONS: Record<string, ActionDef> = {
  attack:      { kind: "attack",  name: "Attack",       baseDelay: 20, power: 1.0 },
  heavy:       { kind: "skill",   name: "Heavy Strike", baseDelay: 40, power: 1.8 },
  quick:       { kind: "skill",   name: "Quick Slash",  baseDelay: 10, power: 0.6 },
  defend:      { kind: "defend",  name: "Defend",       baseDelay: 8,  power: 0 },
  potion:      { kind: "item",    name: "Health Potion", baseDelay: 12, power: 30 },
  flee:        { kind: "flee",    name: "Flee",         baseDelay: 0,  power: 0 },
};

export interface BattleAction {
  actorId: string;
  actionId: string;      // key in ACTIONS
  targetId?: string;     // required for attack/skill
}

export interface TurnRecord {
  turn: number;
  actorId: string;
  actorName: string;
  actionId: string;
  targetId?: string;
  targetName?: string;
  damage?: number;
  healing?: number;
  killed?: boolean;
  fled?: boolean;
  message: string;
}

export interface XpShare {
  agentId: string;
  agentName: string;
  xp: number;
  alive: boolean;
}

export interface BattleReward {
  totalXp: number;
  partyBonus: number;      // multiplier (1.0 for solo, scales with size)
  shares: XpShare[];
}

export interface BattleState {
  battleId: string;
  phase: BattlePhase;
  combatants: Combatant[];
  turnOrder: string[];    // preview of next N actors
  currentActorId: string;
  turnCount: number;
  log: TurnRecord[];
  rewards?: BattleReward; // populated on victory
}
