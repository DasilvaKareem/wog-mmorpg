import type {
  Combatant,
  BattleState,
  BattleAction,
  TurnRecord,
  ActionDef,
  BattlePhase,
  StatusEffect,
  BattleReward,
  XpShare,
  Team,
} from "../types/battle.js";
import { ACTIONS } from "../types/battle.js";

const SPEED_BASE = 1000;
const TURN_PREVIEW_COUNT = 10;
const POISON_DAMAGE = 8;
const REGEN_HEAL = 10;
const DEFEND_DEFENSE_BONUS = 0.5; // +50% defense when defending
const FLEE_CHANCE = 0.6;

function getSpeedMultiplier(statuses: StatusEffect[]): number {
  if (statuses.includes("stop")) return 999999;
  if (statuses.includes("haste")) return 0.5;
  if (statuses.includes("slow")) return 1.5;
  return 1.0;
}

function computeTimeCost(combatant: Combatant, action: ActionDef): number {
  if (combatant.statuses.includes("stop")) return 999999;
  const mult = getSpeedMultiplier(combatant.statuses);
  const speedComponent = Math.ceil((SPEED_BASE / Math.max(1, combatant.stats.speed)) * mult);
  return speedComponent + action.baseDelay;
}

function getNextActor(combatants: Combatant[]): Combatant {
  const alive = combatants.filter((c) => c.alive);
  alive.sort((a, b) => {
    if (a.nextActTime !== b.nextActTime) return a.nextActTime - b.nextActTime;
    if (a.stats.speed !== b.stats.speed) return b.stats.speed - a.stats.speed;
    return a.id.localeCompare(b.id);
  });
  return alive[0];
}

function previewTurnOrder(combatants: Combatant[], steps: number): string[] {
  const sim = combatants
    .filter((c) => c.alive)
    .map((c) => ({ ...c, stats: { ...c.stats }, statuses: [...c.statuses] }));

  const order: string[] = [];
  const defaultAction = ACTIONS["attack"];

  for (let i = 0; i < steps; i++) {
    if (sim.length === 0) break;
    const actor = getNextActor(sim);
    order.push(actor.id);
    actor.nextActTime += computeTimeCost(actor, defaultAction);
  }

  return order;
}

function calcDamage(attacker: Combatant, defender: Combatant, power: number): number {
  const rawDmg = attacker.stats.attack * power;
  const mitigation = defender.statuses.includes("stop")
    ? 0 // stopped units can't defend
    : defender.stats.defense;
  const dmg = Math.max(1, Math.round(rawDmg - mitigation * 0.5));
  // Variance: +/- 10%
  const variance = 0.9 + Math.random() * 0.2;
  return Math.max(1, Math.round(dmg * variance));
}

function checkPhase(combatants: Combatant[]): BattlePhase {
  const partyAlive = combatants.some((c) => c.team === "party" && c.alive);
  const enemyAlive = combatants.some((c) => c.team === "enemy" && c.alive);

  if (!partyAlive) return "defeat";
  if (!enemyAlive) return "victory";
  return "awaiting_action";
}

function applyStatusTicks(combatant: Combatant): TurnRecord[] {
  const records: TurnRecord[] = [];

  if (combatant.statuses.includes("poison") && combatant.alive) {
    combatant.stats.hp = Math.max(1, combatant.stats.hp - POISON_DAMAGE);
    records.push({
      turn: 0, actorId: combatant.id, actorName: combatant.name,
      actionId: "poison_tick", damage: POISON_DAMAGE,
      message: `${combatant.name} takes ${POISON_DAMAGE} poison damage`,
    });
  }

  if (combatant.statuses.includes("regen") && combatant.alive) {
    const healed = Math.min(REGEN_HEAL, combatant.stats.maxHp - combatant.stats.hp);
    combatant.stats.hp += healed;
    if (healed > 0) {
      records.push({
        turn: 0, actorId: combatant.id, actorName: combatant.name,
        actionId: "regen_tick", healing: healed,
        message: `${combatant.name} regenerates ${healed} HP`,
      });
    }
  }

  return records;
}

// --- Defending state tracking (per turn, not persisted in Combatant) ---
const defendingSet = new Set<string>();

export class BattleEngine {
  private state: BattleState;
  private enemyXpValues: Map<string, number>;

  constructor(battleId: string, partyCombatants: Combatant[], enemyCombatants: Combatant[], enemyXpValues?: Map<string, number>) {
    const combatants = [...partyCombatants, ...enemyCombatants];
    this.enemyXpValues = enemyXpValues ?? new Map();

    // Initialize nextActTime based on speed (faster = lower initial time)
    for (const c of combatants) {
      c.nextActTime = Math.ceil(SPEED_BASE / Math.max(1, c.stats.speed));
    }

    const currentActor = getNextActor(combatants);

    this.state = {
      battleId,
      phase: "awaiting_action",
      combatants,
      turnOrder: previewTurnOrder(combatants, TURN_PREVIEW_COUNT),
      currentActorId: currentActor.id,
      turnCount: 0,
      log: [],
    };
  }

  getState(): BattleState {
    return {
      ...this.state,
      combatants: this.state.combatants.map((c) => ({
        ...c,
        stats: { ...c.stats },
        statuses: [...c.statuses],
      })),
      turnOrder: [...this.state.turnOrder],
      log: [...this.state.log],
    };
  }

  /** Process an action from the current actor. Returns the updated battle state. */
  submitAction(action: BattleAction): BattleState {
    if (this.state.phase !== "awaiting_action") {
      return this.getState();
    }

    const actor = this.state.combatants.find((c) => c.id === action.actorId);
    if (!actor || !actor.alive || actor.id !== this.state.currentActorId) {
      return this.getState();
    }

    const actionDef = ACTIONS[action.actionId];
    if (!actionDef) {
      return this.getState();
    }

    this.state.turnCount++;

    // Clear defend status from previous turn
    defendingSet.delete(actor.id);

    // Apply status ticks at start of turn
    const statusRecords = applyStatusTicks(actor);
    for (const r of statusRecords) {
      r.turn = this.state.turnCount;
      this.state.log.push(r);
    }

    // Resolve action
    const record = this.resolveAction(actor, actionDef, action);
    record.turn = this.state.turnCount;
    this.state.log.push(record);

    // Advance timeline
    const timeCost = computeTimeCost(actor, actionDef);
    actor.nextActTime += timeCost;

    // Check win/lose
    this.state.phase = checkPhase(this.state.combatants);

    if (this.state.phase === "victory") {
      this.state.rewards = this.calculateRewards();
    }

    if (this.state.phase === "awaiting_action") {
      // Determine next actor
      const next = getNextActor(this.state.combatants);
      this.state.currentActorId = next.id;
      this.state.turnOrder = previewTurnOrder(this.state.combatants, TURN_PREVIEW_COUNT);
    }

    return this.getState();
  }

  private resolveAction(actor: Combatant, actionDef: ActionDef, action: BattleAction): TurnRecord {
    switch (actionDef.kind) {
      case "attack":
      case "skill":
        return this.resolveAttack(actor, actionDef, action);
      case "defend":
        return this.resolveDefend(actor, actionDef);
      case "item":
        return this.resolveItem(actor, actionDef);
      case "flee":
        return this.resolveFlee(actor);
      default:
        return {
          turn: 0, actorId: actor.id, actorName: actor.name,
          actionId: action.actionId,
          message: `${actor.name} does nothing`,
        };
    }
  }

  private resolveAttack(actor: Combatant, actionDef: ActionDef, action: BattleAction): TurnRecord {
    const target = this.state.combatants.find((c) => c.id === action.targetId && c.alive);
    if (!target) {
      // Auto-target: pick first alive enemy
      const autoTarget = this.state.combatants.find(
        (c) => c.team !== actor.team && c.alive,
      );
      if (!autoTarget) {
        return {
          turn: 0, actorId: actor.id, actorName: actor.name,
          actionId: action.actionId, message: `${actor.name} finds no target`,
        };
      }
      return this.resolveDamage(actor, autoTarget, actionDef);
    }

    return this.resolveDamage(actor, target, actionDef);
  }

  private resolveDamage(actor: Combatant, target: Combatant, actionDef: ActionDef): TurnRecord {
    // If target is defending, boost their defense temporarily
    const originalDef = target.stats.defense;
    if (defendingSet.has(target.id)) {
      target.stats.defense = Math.round(target.stats.defense * (1 + DEFEND_DEFENSE_BONUS));
    }

    const damage = calcDamage(actor, target, actionDef.power);
    target.stats.hp = Math.max(0, target.stats.hp - damage);

    // Restore original defense
    target.stats.defense = originalDef;

    const killed = target.stats.hp <= 0;
    if (killed) {
      target.alive = false;
    }

    return {
      turn: 0,
      actorId: actor.id,
      actorName: actor.name,
      actionId: actionDef.kind === "skill" ? actionDef.name : "attack",
      targetId: target.id,
      targetName: target.name,
      damage,
      killed,
      message: killed
        ? `${actor.name} uses ${actionDef.name} on ${target.name} for ${damage} damage — ${target.name} is defeated!`
        : `${actor.name} uses ${actionDef.name} on ${target.name} for ${damage} damage (${target.stats.hp}/${target.stats.maxHp} HP)`,
    };
  }

  private resolveDefend(actor: Combatant, actionDef: ActionDef): TurnRecord {
    defendingSet.add(actor.id);
    return {
      turn: 0, actorId: actor.id, actorName: actor.name,
      actionId: "defend",
      message: `${actor.name} defends (+${Math.round(DEFEND_DEFENSE_BONUS * 100)}% defense until next turn)`,
    };
  }

  private resolveItem(actor: Combatant, actionDef: ActionDef): TurnRecord {
    // For now, "item" = heal self for actionDef.power flat HP
    const healed = Math.min(actionDef.power, actor.stats.maxHp - actor.stats.hp);
    actor.stats.hp += healed;
    return {
      turn: 0, actorId: actor.id, actorName: actor.name,
      actionId: "potion", healing: healed,
      message: `${actor.name} uses ${actionDef.name} and restores ${healed} HP (${actor.stats.hp}/${actor.stats.maxHp} HP)`,
    };
  }

  private resolveFlee(actor: Combatant): TurnRecord {
    if (actor.team !== "party") {
      return {
        turn: 0, actorId: actor.id, actorName: actor.name,
        actionId: "flee",
        message: `${actor.name} cannot flee`,
      };
    }

    const success = Math.random() < FLEE_CHANCE;
    if (success) {
      this.state.phase = "fled";
      return {
        turn: 0, actorId: actor.id, actorName: actor.name,
        actionId: "flee", fled: true,
        message: `${actor.name} fled the battle!`,
      };
    }

    return {
      turn: 0, actorId: actor.id, actorName: actor.name,
      actionId: "flee", fled: false,
      message: `${actor.name} tried to flee but failed!`,
    };
  }

  /** Calculate XP rewards on victory. Split among party members with party bonus. */
  private calculateRewards(): BattleReward {
    // Sum XP from all enemies
    const enemies = this.state.combatants.filter((c) => c.team === "enemy");
    let totalXp = 0;
    for (const enemy of enemies) {
      const xp = this.enemyXpValues.get(enemy.id) ?? this.fallbackXp(enemy);
      totalXp += xp;
    }

    // Party members (all, alive or dead)
    const partyMembers = this.state.combatants.filter((c) => c.team === "party");
    const partySize = partyMembers.length;

    // Party bonus: 10% per extra member (solo = 1.0, duo = 1.1, trio = 1.2, etc.)
    const partyBonus = 1.0 + (partySize - 1) * 0.1;
    const adjustedTotal = Math.round(totalXp * partyBonus);

    // Split: alive members get full share, dead members get half share
    const aliveCount = partyMembers.filter((m) => m.alive).length;
    const deadCount = partySize - aliveCount;
    const totalShares = aliveCount + deadCount * 0.5;

    const shares: XpShare[] = partyMembers.map((m) => {
      const shareMultiplier = m.alive ? 1.0 : 0.5;
      const xp = totalShares > 0 ? Math.floor((adjustedTotal / totalShares) * shareMultiplier) : 0;
      return { agentId: m.id, agentName: m.name, xp, alive: m.alive };
    });

    return { totalXp: adjustedTotal, partyBonus, shares };
  }

  /** Fallback XP for enemies without explicit xpReward (from stats) */
  private fallbackXp(combatant: Combatant): number {
    return Math.round(combatant.stats.maxHp * 0.5 + combatant.stats.attack * 2);
  }

  get phase(): BattlePhase {
    return this.state.phase;
  }

  get battleId(): string {
    return this.state.battleId;
  }
}
