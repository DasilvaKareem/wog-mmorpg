/**
 * Agent Trigger Detection — pure function that scans game state for events
 * that should cause the AI supervisor to re-evaluate the current script.
 */

import { type BotScript, type TriggerEvent } from "../types/botScriptTypes.js";

export interface TriggerState {
  currentScript: BotScript | null;
  ticksSinceLastDecision: number;
  ticksOnCurrentScript: number;
  lastKnownLevel: number;
  lastKnownZone: string;
  currentRegion: string;
  maxStaleTicks: number;
}

/**
 * Detect whether a significant game-state event has occurred.
 * Returns a TriggerEvent if the supervisor should re-evaluate, or null to
 * keep executing the current script.
 *
 * This is a pure function — it reads state but does not modify it.
 * The caller is responsible for updating counters after the call.
 */
export function detectTrigger(
  entity: any,
  entities: Record<string, any>,
  state: TriggerState,
): TriggerEvent | null {
  // No script → supervisor must assign one
  if (!state.currentScript) {
    return { type: "no_script", detail: "Agent needs an initial script" };
  }

  // Script stuck too long — let supervisor re-evaluate on the same cadence as periodic review.
  // Give goto/travel scripts 3x longer since they need time to walk across zones.
  const isMovementScript = state.currentScript.type === "goto" || state.currentScript.type === "travel";
  const staleLimit = isMovementScript ? state.maxStaleTicks * 3 : state.maxStaleTicks;
  if (state.ticksOnCurrentScript >= staleLimit) {
    return {
      type: "stuck",
      detail: `Script "${state.currentScript.type}" running for ${state.ticksOnCurrentScript} ticks with no progress`,
    };
  }

  // Universal: level up
  const level = entity.level ?? 1;
  if (level > state.lastKnownLevel && state.lastKnownLevel > 0) {
    return { type: "level_up", detail: `Reached level ${level} — re-evaluating strategy` };
  }

  // Universal: arrived in a new zone (skip if still traveling to a different destination)
  if (state.currentRegion !== state.lastKnownZone && state.lastKnownZone !== "") {
    const isTransitZone =
      state.currentScript?.type === "travel" &&
      state.currentScript.targetZone &&
      state.currentScript.targetZone !== state.currentRegion;
    if (!isTransitZone) {
      return { type: "zone_arrived", detail: `Arrived in ${state.currentRegion}` };
    }
  }

  // Script-specific triggers
  switch (state.currentScript.type) {
    case "combat": {
      const hasTargets = Object.values(entities).some(
        (e: any) =>
          (e.type === "mob" || e.type === "boss") &&
          e.hp > 0,
      );
      if (!hasTargets) {
        return { type: "no_targets", detail: "No living mobs in zone — zone may be cleared" };
      }
      break;
    }

    case "gather": {
      const nt = state.currentScript.nodeType ?? "both";
      const hasNodes = Object.values(entities).some(
        (e: any) =>
          (nt !== "herb" && e.type === "ore-node") ||
          (nt !== "ore" && e.type === "flower-node"),
      );
      if (!hasNodes) {
        return { type: "no_targets", detail: "No resource nodes in zone" };
      }
      break;
    }

    case "travel": {
      if (
        state.currentScript.targetZone &&
        state.currentScript.targetZone === state.currentRegion
      ) {
        return { type: "script_done", detail: `Arrived at destination: ${state.currentRegion}` };
      }
      break;
    }

    case "shop": {
      const eq = entity.equipment ?? {};
      const emptySlots = ["weapon", "chest", "legs", "boots", "helm"].filter((s) => !eq[s]);
      if (emptySlots.length === 0) {
        return { type: "script_done", detail: "Fully equipped — shopping complete" };
      }
      break;
    }

    case "quest": {
      const hasEligibleMobs = Object.values(entities).some(
        (e: any) =>
          (e.type === "mob" || e.type === "boss") &&
          e.hp > 0 &&
          (e.level ?? 1) <= level + 3,
      );
      if (!hasEligibleMobs) {
        return {
          type: "no_targets",
          detail: "No mobs for quest progression — zone may be exhausted",
        };
      }
      break;
    }
  }

  // Safety-net: supervisor hasn't been called in too long
  if (state.ticksSinceLastDecision >= state.maxStaleTicks) {
    return { type: "periodic", detail: "Periodic strategic review" };
  }

  return null;
}
