// PvE asymmetry: mobs cannot dodge, crit, or block. The chance-based
// functions all return 0 for non-player entities, so mob attacks always
// land and mob defenses are purely raw math against the damage formula.

import type { Entity } from "../world/zoneRuntime.js";
import {
  MIN_DAMAGE,
  DODGE_CAP, DODGE_K, DODGE_SCALE,
  CRIT_CAP, CRIT_K, CRIT_SCALE, CRIT_MULTIPLIER,
  BLOCK_CAP, BLOCK_K, BLOCK_SCALE, BLOCK_REDUCTION,
  FAITH_HEAL_K, FAITH_HEAL_SCALE,
  FAITH_HOLY_COEFF,
} from "./combatConfig.js";

export interface HitResult {
  finalDamage: number;
  hpLost: number;
  dodged: boolean;
  critical: boolean;
  blocked: boolean;
}

export function getDodgeChance(entity: Entity): number {
  if (entity.type !== "player") return 0;
  const agi = entity.effectiveStats?.agi ?? entity.stats?.agi ?? 0;
  if (agi <= 0) return 0;
  return Math.min(DODGE_CAP, (agi / (agi + DODGE_K)) * DODGE_SCALE);
}

export function getCritChance(entity: Entity): number {
  if (entity.type !== "player") return 0;
  const luck = entity.effectiveStats?.luck ?? entity.stats?.luck ?? 0;
  if (luck <= 0) return 0;
  return Math.min(CRIT_CAP, (luck / (luck + CRIT_K)) * CRIT_SCALE);
}

export function getBlockChance(entity: Entity): number {
  if (entity.type !== "player") return 0;
  const def = entity.effectiveStats?.def ?? entity.stats?.def ?? 0;
  if (def <= 0) return 0;
  return Math.min(BLOCK_CAP, (def / (def + BLOCK_K)) * BLOCK_SCALE);
}

export function getFaithHealMultiplier(entity: Entity): number {
  const faith = entity.effectiveStats?.faith ?? entity.stats?.faith ?? 0;
  if (faith <= 0) return 1.0;
  return 1 + (faith / (faith + FAITH_HEAL_K)) * FAITH_HEAL_SCALE;
}

export function getHolyDamageBonus(entity: Entity): number {
  if (entity.type !== "player") return 0;
  const classId = entity.classId ?? "";
  if (classId !== "paladin" && classId !== "cleric") return 0;
  const faith = entity.effectiveStats?.faith ?? entity.stats?.faith ?? 0;
  return Math.floor(faith * FAITH_HOLY_COEFF);
}

export function resolveHit(attacker: Entity, defender: Entity, rawDamage: number): HitResult {
  // 1. Dodge (defender is player)
  if (defender.type === "player" && Math.random() < getDodgeChance(defender)) {
    return { finalDamage: 0, hpLost: 0, dodged: true, critical: false, blocked: false };
  }

  let damage = rawDamage;

  // 2. Critical hit (attacker is player)
  let critical = false;
  if (attacker.type === "player" && Math.random() < getCritChance(attacker)) {
    damage = Math.round(damage * CRIT_MULTIPLIER);
    critical = true;
  }

  // 3. Block (defender is player)
  let blocked = false;
  if (defender.type === "player" && Math.random() < getBlockChance(defender)) {
    damage = Math.round(damage * BLOCK_REDUCTION);
    blocked = true;
  }

  // 4. Clamp to MIN_DAMAGE
  damage = Math.max(MIN_DAMAGE, damage);

  // 5. Apply through shields → HP
  const hpLost = applyDamageWithShield(defender, damage);

  return { finalDamage: damage, hpLost, dodged: false, critical, blocked };
}

export function applyDamageWithShield(entity: Entity, rawDamage: number): number {
  let remaining = rawDamage;
  if (entity.activeEffects) {
    for (const effect of entity.activeEffects) {
      if (effect.type === "shield" && effect.shieldHp != null && effect.shieldHp > 0) {
        const absorbed = Math.min(effect.shieldHp, remaining);
        effect.shieldHp -= absorbed;
        remaining -= absorbed;
        if (remaining <= 0) break;
      }
    }
  }
  entity.hp -= remaining;
  return remaining;
}
