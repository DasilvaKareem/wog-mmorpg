export type Team = "party" | "enemy";
export type StatusEffect = "haste" | "slow" | "stop" | "poison" | "regen";
export type BattlePhase = "awaiting_action" | "victory" | "defeat" | "fled";
export type ActionKind = "attack" | "defend" | "skill" | "item" | "flee";
export interface CombatantStats {
    maxHp: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
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
    power: number;
}
/** Default actions available to all combatants */
export declare const ACTIONS: Record<string, ActionDef>;
export interface BattleAction {
    actorId: string;
    actionId: string;
    targetId?: string;
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
    partyBonus: number;
    shares: XpShare[];
}
export interface BattleState {
    battleId: string;
    phase: BattlePhase;
    combatants: Combatant[];
    turnOrder: string[];
    currentActorId: string;
    turnCount: number;
    log: TurnRecord[];
    rewards?: BattleReward;
}
