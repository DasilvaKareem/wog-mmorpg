// Technique resolution. Applies the effects of a single technique cast
// once the windup has completed. Covers attack (single + AoE), healing
// (instant + HoT), buffs/shields, debuffs/DoTs. Status effects use
// addActiveEffectInternal so the tick loop applies them each tick.

import { randomUUID } from "crypto";
import type { Entity, ZoneState } from "../world/zoneRuntime.js";
import {
  addActiveEffectInternal,
  getEffectiveStats,
  recalculateEntityVitals,
} from "../world/zoneRuntime.js";
import { getPartyMembers } from "../social/partySystem.js";
import { getEntity } from "../world/zoneRuntime.js";
import type { TechniqueDefinition } from "./techniques.js";
import {
  getFaithHealMultiplier,
  getHolyDamageBonus,
  resolveHit,
} from "./hitResolution.js";

export interface TechniqueHitResult {
  damage?: number;
  dodged?: boolean;
  critical?: boolean;
  blocked?: boolean;
}

/**
 * Resolve a single technique cast against `target`. The return value only
 * carries data for attack techniques (the tick loop logs damage/dodged etc.);
 * healing/buff/debuff outcomes are persisted via active effects on the target.
 */
export function applyTechniqueInCombat(
  caster: Entity,
  target: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState,
): TechniqueHitResult {
  const { effects, type } = technique;
  const result: TechniqueHitResult = {};

  if (type === "attack" && effects.damageMultiplier) {
    const stats = caster.effectiveStats ?? getEffectiveStats(caster);
    const isCaster = ["mage", "cleric", "warlock"].includes(caster.classId ?? "");
    const primaryStat = isCaster
      ? (stats?.int ?? caster.stats?.int ?? 10)
      : (stats?.str ?? caster.stats?.str ?? 10);
    const baseDmg = Math.floor(5 + primaryStat * 0.5);
    let damage = Math.floor(baseDmg * effects.damageMultiplier);

    damage += getHolyDamageBonus(caster);

    if (effects.maxTargets && effects.maxTargets > 1) {
      // AoE — hit multiple targets (each rolls dodge/crit/block independently).
      const nearby: Entity[] = [];
      for (const e of zone.entities.values()) {
        if (e.type !== "mob" && e.type !== "boss") continue;
        if (e.hp <= 0 || e.id === caster.id) continue;
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        if (Math.sqrt(dx * dx + dy * dy) <= (effects.areaRadius ?? 50)) {
          nearby.push(e);
          if (nearby.length >= effects.maxTargets) break;
        }
      }
      for (const t of nearby) {
        resolveHit(caster, t, damage);
      }
      result.damage = damage;
    } else {
      const hit = resolveHit(caster, target, damage);
      result.damage = hit.finalDamage;
      result.dodged = hit.dodged;
      result.critical = hit.critical;
      result.blocked = hit.blocked;
    }

    // Lifesteal (amplified by faith for paladin/cleric)
    if (effects.healAmount && !result.dodged) {
      const healBase = Math.floor((result.damage ?? 0) * (effects.healAmount / 100));
      const heal = Math.floor(healBase * getFaithHealMultiplier(caster));
      caster.hp = Math.min(caster.maxHp, caster.hp + heal);
    }
  }

  if (type === "healing" && effects.healAmount) {
    const faithMult = getFaithHealMultiplier(caster);
    if (effects.duration && effects.duration > 0) {
      const totalHeal = Math.floor(target.maxHp * (effects.healAmount / 100) * faithMult);
      const healPerTick = Math.max(1, Math.floor(totalHeal / effects.duration));
      addActiveEffectInternal(target, {
        id: randomUUID(),
        techniqueId: technique.id,
        name: technique.name,
        type: "hot",
        casterId: caster.id,
        appliedAtTick: zone.tick,
        durationTicks: effects.duration,
        remainingTicks: effects.duration,
        hotHealPerTick: healPerTick,
      });
    } else {
      const healAmount = Math.floor(target.maxHp * (effects.healAmount / 100) * faithMult);
      const actualHeal = Math.min(healAmount, target.maxHp - target.hp);
      target.hp = Math.min(target.maxHp, target.hp + actualHeal);
    }
  }

  if (type === "buff" && effects.duration) {
    addActiveEffectInternal(target, {
      id: randomUUID(),
      techniqueId: technique.id,
      name: technique.name,
      type: effects.shield ? "shield" : "buff",
      casterId: caster.id,
      appliedAtTick: zone.tick,
      durationTicks: effects.duration,
      remainingTicks: effects.duration,
      statModifiers: effects.statBonus,
      shieldHp: effects.shield ? Math.floor(target.maxHp * (effects.shield / 100)) : undefined,
      shieldMaxHp: effects.shield ? Math.floor(target.maxHp * (effects.shield / 100)) : undefined,
    });
    if (effects.statBonus) recalculateEntityVitals(target);
  }

  if (type === "debuff" && effects.duration) {
    addActiveEffectInternal(target, {
      id: randomUUID(),
      techniqueId: technique.id,
      name: technique.name,
      type: effects.dotDamage ? "dot" : "debuff",
      casterId: caster.id,
      appliedAtTick: zone.tick,
      durationTicks: effects.duration,
      remainingTicks: effects.duration,
      statModifiers: effects.statReduction,
      dotDamage: effects.dotDamage,
    });
    if (effects.statReduction) recalculateEntityVitals(target);
  }

  return result;
}

/**
 * Cast a "party"-targeted technique on every party member in the caster's zone.
 * If the caster is solo (no party members alive in zone), it falls back to
 * casting on the caster themselves so the technique still has an effect.
 */
export function applyPartyTechniqueInCombat(
  caster: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState,
): { affectedIds: string[] } {
  const affectedIds: string[] = [];
  const memberIds = getPartyMembers(caster.id);

  for (const memberId of memberIds) {
    const member = getEntity(memberId);
    if (!member || member.type !== "player" || member.hp <= 0) continue;
    if (member.region !== zone.zoneId) continue;

    applyTechniqueInCombat(caster, member, technique, zone);
    affectedIds.push(member.id);
  }

  if (affectedIds.length === 0) {
    applyTechniqueInCombat(caster, caster, technique, zone);
    affectedIds.push(caster.id);
  }

  return { affectedIds };
}
