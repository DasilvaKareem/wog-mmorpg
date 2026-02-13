import type { Combatant, BattleState, BattleAction, BattlePhase } from "../types/battle.js";
export declare class BattleEngine {
    private state;
    private enemyXpValues;
    constructor(battleId: string, partyCombatants: Combatant[], enemyCombatants: Combatant[], enemyXpValues?: Map<string, number>);
    getState(): BattleState;
    /** Process an action from the current actor. Returns the updated battle state. */
    submitAction(action: BattleAction): BattleState;
    private resolveAction;
    private resolveAttack;
    private resolveDamage;
    private resolveDefend;
    private resolveItem;
    private resolveFlee;
    /** Calculate XP rewards on victory. Split among party members with party bonus. */
    private calculateRewards;
    /** Fallback XP for enemies without explicit xpReward (from stats) */
    private fallbackXp;
    get phase(): BattlePhase;
    get battleId(): string;
}
