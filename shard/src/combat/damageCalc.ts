import type { Entity } from "../world/zoneRuntime.js";
import { getEffectiveStats } from "../world/zoneRuntime.js";
import { getAttackMultiplier, getDefenseMultiplier } from "./elementSystem.js";
import { MIN_DAMAGE, FALLBACK_ATTACK } from "./combatConfig.js";

export function getAttackPower(entity: Entity): number {
  const stats = entity.effectiveStats ?? getEffectiveStats(entity);
  if (stats) {
    const classId = entity.classId ?? "";
    const isCaster = ["mage", "warlock", "cleric"].includes(classId);
    const primary = isCaster
      ? stats.int * 0.45 + stats.str * 0.08
      : stats.str * 0.32 + stats.int * 0.12;
    return Math.max(
      5,
      Math.round(primary + stats.agi * 0.1 + stats.faith * 0.08),
    );
  }
  return Math.max(5, FALLBACK_ATTACK + Math.max(0, (entity.level ?? 1) - 1) * 2);
}

export function getDefensePower(entity: Entity): number {
  const stats = entity.effectiveStats ?? getEffectiveStats(entity);
  if (stats) {
    return Math.max(0, Math.round(stats.def * 0.45 + stats.agi * 0.06));
  }
  return Math.max(0, Math.round((entity.level ?? 1) * 2));
}

export function computeDamage(attacker: Entity, defender: Entity, zoneId?: string): number {
  const raw = getAttackPower(attacker) - getDefensePower(defender) * 0.50;
  let damage = Math.max(MIN_DAMAGE, Math.round(raw));

  if (zoneId) {
    if (attacker.type === "player" && defender.type !== "player") {
      damage = Math.round(damage * getAttackMultiplier(zoneId, attacker.activeEffects));
    } else if (attacker.type !== "player" && defender.type === "player") {
      damage = Math.round(damage * getDefenseMultiplier(zoneId, defender.activeEffects));
    }
  }

  return Math.max(MIN_DAMAGE, damage);
}
