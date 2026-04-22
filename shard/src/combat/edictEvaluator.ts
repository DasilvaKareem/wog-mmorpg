// ── Edict Evaluator ─────────────────────────────────────────────────
//
// Runs in the zone tick (synchronous, 1s cadence). Evaluates a player's
// edicts top-to-bottom. First full match wins. Edicts are the sole
// scheduler for player auto-combat — there is no pickTechnique fallback
// at the tick level. A `best_technique` action lets an edict delegate
// technique selection to the heuristic picker via a callback.

import type { Edict, EdictCondition, EdictAction } from "./edicts.js";
import { getTechniqueById, type TechniqueDefinition } from "./techniques.js";
import type { Entity, ActiveEffect, ZoneState } from "../world/zoneRuntime.js";
import { getPartyMembers, getPartyLeaderId } from "../social/partySystem.js";

// Injected by the tick to avoid circular import on zoneRuntime.pickTechnique.
// Accepts the full ZoneState because pickTechnique reads fields (zoneId) beyond
// what the evaluator itself touches.
export type BestTechniquePicker = (
  entity: Entity,
  target: Entity,
  zone: ZoneState,
) => TechniqueDefinition | null;

// ── Public result type ──────────────────────────────────────────────

export interface EdictResult {
  edict: Edict;
  /** Direct order to set on entity (for flee/skip/basic-attack). */
  order?: { action: string; targetId?: string; techniqueId?: string; x?: number; y?: number };
  /** Override pickTechnique — cast this technique instead. */
  techniqueOverride?: TechniqueDefinition;
  /** Override pickAutoCombatTarget — attack this entity instead. */
  targetOverride?: Entity;
}

// ── Main evaluator ──────────────────────────────────────────────────

export function evaluateEdicts(
  entity: Entity,
  zone: ZoneState,
  edicts: Edict[],
  currentTarget: Entity | null,
  pickBest?: BestTechniquePicker,
): EdictResult | null {
  for (const edict of edicts) {
    if (!edict.enabled) continue;
    if (edict.conditions.length === 0) continue;

    // AND: all conditions must pass
    let allMatch = true;
    for (const cond of edict.conditions) {
      if (!evaluateCondition(entity, zone, currentTarget, cond)) {
        allMatch = false;
        break;
      }
    }
    if (!allMatch) continue;

    // Conditions matched — resolve action
    const result = resolveAction(entity, zone, currentTarget, edict, pickBest);
    if (result) return result;
    // If action can't execute (cooldown, no essence), skip to next edict
  }
  return null;
}

// ── Condition evaluation ────────────────────────────────────────────

function evaluateCondition(
  entity: Entity,
  zone: ZoneState,
  currentTarget: Entity | null,
  cond: EdictCondition,
): boolean {
  // Resolve subject entity
  const subject = resolveSubject(cond.subject, entity, zone, currentTarget);
  if (!subject && cond.field !== "always") return false;

  // Read field value
  const actual = readField(subject, entity, zone, cond.field);
  if (actual === undefined && cond.field !== "always") return false;

  // Compare
  return compare(actual, cond.operator, cond.value);
}

function resolveSubject(
  subject: string,
  entity: Entity,
  zone: ZoneState,
  currentTarget: Entity | null,
): Entity | null {
  switch (subject) {
    case "self":
      return entity;
    case "target":
      return currentTarget;
    case "ally_lowest_hp": {
      const partyIds = getPartyMembers(entity.id);
      if (partyIds.length === 0) return null;
      let lowest: Entity | null = null;
      let lowestRatio = 1;
      for (const pid of partyIds) {
        if (pid === entity.id) continue;
        const ally = zone.entities.get(pid);
        if (!ally || ally.hp <= 0) continue;
        const ratio = ally.hp / Math.max(1, ally.maxHp);
        if (ratio < lowestRatio) {
          lowestRatio = ratio;
          lowest = ally;
        }
      }
      return lowest;
    }
    case "leader":
      return resolvePartyLeader(entity, zone);
    case "leader_target":
      return resolveLeaderTarget(entity, zone);
    default:
      return null;
  }
}

function resolvePartyLeader(entity: Entity, zone: ZoneState): Entity | null {
  const leaderId = getPartyLeaderId(entity.id);
  if (!leaderId || leaderId === entity.id) return null;
  const leader = zone.entities.get(leaderId);
  if (!leader || leader.hp <= 0) return null;
  return leader;
}

function resolveLeaderTarget(entity: Entity, zone: ZoneState): Entity | null {
  const leader = resolvePartyLeader(entity, zone);
  if (!leader) return null;
  const order = leader.order;
  if (!order || (order.action !== "attack" && order.action !== "technique")) return null;
  const targetId = order.targetId;
  if (!targetId) return null;
  const target = zone.entities.get(targetId);
  if (!target || target.hp <= 0) return null;
  if (target.type !== "mob" && target.type !== "boss" && target.type !== "player") return null;
  return target;
}

function readField(
  subject: Entity | null,
  self: Entity,
  zone: ZoneState,
  field: string,
): number | string | boolean | undefined {
  switch (field) {
    case "hp_pct":
      return subject ? Math.round((subject.hp / Math.max(1, subject.maxHp)) * 100) : undefined;
    case "essence_pct":
      return subject?.essence != null && subject?.maxEssence
        ? Math.round((subject.essence / subject.maxEssence) * 100)
        : undefined;
    case "type":
      return subject?.type;
    case "active_effect":
      // Returns the type string of the first active effect, or "none"
      // Operator will be "has" or "not_has" with value = effect type
      return hasEffectType(subject?.activeEffects, undefined) ? "present" : "none";
    case "effect_from_self":
      return hasEffectFromCaster(subject?.activeEffects, self.id) ? "present" : "none";
    case "nearby_enemies": {
      let count = 0;
      const RANGE = 70;
      for (const e of zone.entities.values()) {
        if (e.id === self.id) continue;
        if (e.hp <= 0) continue;
        if (e.type !== "mob" && e.type !== "boss") continue;
        const dx = e.x - self.x, dy = (e.y ?? 0) - (self.y ?? 0);
        if (dx * dx + dy * dy <= RANGE * RANGE) count++;
      }
      return count;
    }
    case "always":
      return true;
    default:
      return undefined;
  }
}

function hasEffectType(effects: ActiveEffect[] | undefined, _unused: unknown): boolean {
  return !!effects && effects.length > 0;
}

function hasEffectFromCaster(effects: ActiveEffect[] | undefined, casterId: string): boolean {
  if (!effects) return false;
  return effects.some(e => e.casterId === casterId);
}

// Special-case: for "active_effect" and "effect_from_self" fields,
// the operator/value work differently — we check for specific effect types
function compare(
  actual: number | string | boolean | undefined,
  operator: string,
  value: number | string | boolean,
): boolean {
  // Special handling for effect-presence fields
  if (typeof value === "string" && (operator === "has" || operator === "not_has")) {
    // "has"/"not_has" with effect type value — delegate to special check
    // actual is "present" or "none" (simplified), but we need the real check
    // This is handled via the field reader returning "present"/"none"
    if (operator === "has") return actual === "present";
    if (operator === "not_has") return actual === "none";
  }

  // Numeric comparisons
  if (typeof actual === "number" && typeof value === "number") {
    switch (operator) {
      case "lt": return actual < value;
      case "gt": return actual > value;
      case "gte": return actual >= value;
      case "eq": return actual === value;
      default: return false;
    }
  }

  // String/type comparisons
  if (operator === "is") return actual === value;
  if (operator === "eq") return actual === value;

  return false;
}

// ── Action resolution ───────────────────────────────────────────────

function resolveAction(
  entity: Entity,
  zone: ZoneState,
  currentTarget: Entity | null,
  edict: Edict,
  pickBest?: BestTechniquePicker,
): EdictResult | null {
  const action = edict.action;

  switch (action.type) {
    case "use_technique":
      return resolveTechniqueAction(entity, zone, edict, action);

    case "best_technique":
      return resolveBestTechniqueAction(entity, zone, currentTarget, edict, action, pickBest);

    case "attack":
      if (!currentTarget) return null;
      return { edict, order: { action: "attack", targetId: currentTarget.id } };

    case "prefer_target":
      return resolveTargetPreference(entity, zone, edict, action);

    case "flee":
      return resolveFlee(entity, currentTarget, edict);

    case "skip":
      return { edict, order: { action: "move", x: entity.x, y: entity.y } };

    default:
      return null;
  }
}

function resolveBestTechniqueAction(
  entity: Entity,
  zone: ZoneState,
  currentTarget: Entity | null,
  edict: Edict,
  action: EdictAction,
  pickBest?: BestTechniquePicker,
): EdictResult | null {
  // Target resolution: explicit preference > currentTarget.
  let target: Entity | null = currentTarget;
  if (action.targetPreference) {
    const pref = resolveTargetPreference(entity, zone, edict, action);
    if (pref?.targetOverride) target = pref.targetOverride;
  }
  if (!target) return null;

  const tech = pickBest ? pickBest(entity, target, zone) : null;
  if (tech) {
    return { edict, techniqueOverride: tech, targetOverride: target };
  }
  // No usable technique — fall back to basic attack on the chosen target.
  return { edict, targetOverride: target, order: { action: "attack", targetId: target.id } };
}

function resolveTechniqueAction(
  entity: Entity,
  zone: ZoneState,
  edict: Edict,
  action: EdictAction,
): EdictResult | null {
  if (!action.techniqueId) return null;

  const tech = getTechniqueById(action.techniqueId);
  if (!tech) return null;

  // Must have learned the technique
  if (!entity.learnedTechniques?.includes(tech.id)) return null;

  // Check cooldown
  if (entity.cooldowns?.has(tech.id)) {
    const expiresAtTick = entity.cooldowns.get(tech.id)!;
    if (zone.tick < expiresAtTick) return null; // on cooldown — skip to next edict
  }

  // Check essence cost
  if (tech.essenceCost > 0) {
    const currentEssence = entity.essence ?? 0;
    if (currentEssence < tech.essenceCost) return null; // not enough — skip to next edict
  }

  return { edict, techniqueOverride: tech };
}

function resolveTargetPreference(
  entity: Entity,
  zone: ZoneState,
  edict: Edict,
  action: EdictAction,
): EdictResult | null {
  const pref = action.targetPreference ?? "nearest";

  if (pref === "leader_target") {
    const lt = resolveLeaderTarget(entity, zone);
    return lt ? { edict, targetOverride: lt } : null;
  }

  if (pref === "party_tagged") {
    const tagged = resolvePartyTaggedTarget(entity, zone);
    return tagged ? { edict, targetOverride: tagged } : null;
  }

  let best: Entity | null = null;
  let bestScore = -Infinity;
  const RANGE = 100;

  for (const e of zone.entities.values()) {
    if (e.id === entity.id) continue;
    if (e.hp <= 0) continue;
    if (e.type !== "mob" && e.type !== "boss") continue;
    const dx = e.x - entity.x, dy = (e.y ?? 0) - (entity.y ?? 0);
    const distSq = dx * dx + dy * dy;
    if (distSq > RANGE * RANGE) continue;

    let score = 0;
    switch (pref) {
      case "nearest":
        score = -distSq; // lower distance = higher score
        break;
      case "weakest":
        score = -(e.hp / Math.max(1, e.maxHp)); // lower HP ratio = higher score
        break;
      case "strongest":
        score = e.level ?? 0; // higher level = higher score
        break;
      case "boss":
        score = e.type === "boss" ? 1000 : -distSq; // strongly prefer bosses
        break;
    }

    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }

  if (!best) return null;
  return { edict, targetOverride: best };
}

function resolvePartyTaggedTarget(entity: Entity, zone: ZoneState): Entity | null {
  const partyIds = new Set(getPartyMembers(entity.id));
  if (partyIds.size <= 1) return null;

  let best: Entity | null = null;
  let bestDistSq = Infinity;
  const RANGE_SQ = 100 * 100;

  for (const e of zone.entities.values()) {
    if (e.hp <= 0) continue;
    if (e.type !== "mob" && e.type !== "boss") continue;
    if (!e.taggedBy || !partyIds.has(e.taggedBy)) continue;
    const dx = e.x - entity.x, dy = (e.y ?? 0) - (entity.y ?? 0);
    const distSq = dx * dx + dy * dy;
    if (distSq > RANGE_SQ) continue;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = e;
    }
  }
  return best;
}

function resolveFlee(
  entity: Entity,
  currentTarget: Entity | null,
  edict: Edict,
): EdictResult | null {
  // Move 80 units away from current threat
  const threatX = currentTarget?.x ?? entity.x;
  const threatY = currentTarget?.y ?? entity.y;
  const dx = entity.x - threatX;
  const dy = (entity.y ?? 0) - (threatY ?? 0);
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const fleeX = entity.x + (dx / dist) * 80;
  const fleeY = (entity.y ?? 0) + (dy / dist) * 80;

  return { edict, order: { action: "move", x: Math.round(fleeX), y: Math.round(fleeY) } as unknown as EdictResult["order"] };
}
