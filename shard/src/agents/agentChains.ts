/**
 * Agent Chains — multi-step BotScript sequences enqueued through the action queue.
 *
 * The action queue suppresses autonomous triggers (see agentRunner.ts), so a
 * queued chain runs to completion without the supervisor hijacking it mid-flow.
 * That is exactly what we want for detours (shop, learn profession, bank) and
 * for auto-progression (level up → advance zone → start quest).
 *
 * All chain builders return a `BotScript[]` that the caller enqueues via
 * `runner.enqueueActions(chain, true)`.
 */

import { type BotScript } from "../types/botScriptTypes.js";
import { ZONE_LEVEL_REQUIREMENTS, QUEST_ZONES, FARM_ZONES } from "../world/worldLayout.js";

const PROFESSION_HUB_ZONE = "village-square";

/**
 * Pick the best accessible zone for a level that has quest content.
 * Returns the zone with the highest level requirement that the agent qualifies for.
 *
 * @param level Agent level
 * @param allowedZones "all" or list of zone IDs the tier is restricted to
 * @param excludeZone Optional zone to exclude (usually the current one)
 */
export function findBestProgressionZone(
  level: number,
  allowedZones: string[] | "all" = "all",
  excludeZone?: string,
): string | null {
  const sorted = Object.entries(ZONE_LEVEL_REQUIREMENTS)
    .filter(([zone]) => allowedZones === "all" || allowedZones.includes(zone))
    .filter(([zone]) => QUEST_ZONES.has(zone))
    .filter(([zone]) => !FARM_ZONES.has(zone))
    .filter(([zone]) => zone !== excludeZone)
    .sort(([, a], [, b]) => a - b);

  let best: string | null = null;
  for (const [zone, req] of sorted) {
    if (level >= req) best = zone;
  }
  return best;
}

/**
 * Pick the zone whose level requirement best matches the agent's current level
 * (within a ±3 band). Useful when the agent is either underleveled for the
 * current zone (no safe targets) or overleveled (no worthwhile targets) — we
 * want a zone that matches, not the hardest one they qualify for.
 *
 * Preference order:
 *   1. Zones with req ∈ [level - 2, level + 1]  (ideal band)
 *   2. Zones with req ∈ [level - 4, level + 2]  (acceptable band)
 *   3. Nearest req (fallback)
 */
export function findBestZoneForLevelBand(
  level: number,
  allowedZones: string[] | "all" = "all",
  excludeZone?: string,
): string | null {
  const candidates = Object.entries(ZONE_LEVEL_REQUIREMENTS)
    .filter(([zone]) => allowedZones === "all" || allowedZones.includes(zone))
    .filter(([zone]) => QUEST_ZONES.has(zone))
    .filter(([zone]) => !FARM_ZONES.has(zone))
    .filter(([zone]) => zone !== excludeZone)
    // Only include zones the agent can actually enter
    .filter(([, req]) => level >= req);

  if (candidates.length === 0) return null;

  const ideal = candidates.filter(([, req]) => req >= level - 2 && req <= level + 1);
  if (ideal.length > 0) {
    // Tightest match — closest to current level
    ideal.sort(([, a], [, b]) => Math.abs(a - level) - Math.abs(b - level));
    return ideal[0][0];
  }

  const acceptable = candidates.filter(([, req]) => req >= level - 4 && req <= level + 2);
  if (acceptable.length > 0) {
    acceptable.sort(([, a], [, b]) => Math.abs(a - level) - Math.abs(b - level));
    return acceptable[0][0];
  }

  // Fallback: whatever zone has the closest req
  candidates.sort(([, a], [, b]) => Math.abs(a - level) - Math.abs(b - level));
  return candidates[0][0];
}

/**
 * Build an auto-progression chain: travel to the best accessible zone, then
 * quest/combat there. Returns null if no better zone is accessible.
 */
export function buildProgressChain(
  level: number,
  currentZone: string,
  allowedZones: string[] | "all" = "all",
): BotScript[] | null {
  const bestZone = findBestProgressionZone(level, allowedZones, currentZone);
  if (!bestZone || bestZone === currentZone) return null;

  // If the agent already qualifies for a zone higher than the current one, go.
  const currentReq = ZONE_LEVEL_REQUIREMENTS[currentZone] ?? 1;
  const bestReq = ZONE_LEVEL_REQUIREMENTS[bestZone] ?? 1;
  if (bestReq <= currentReq) return null;

  return [
    {
      type: "travel",
      targetZone: bestZone,
      reason: `Auto-progress: Lv${level} → ${bestZone} (L${bestReq})`,
    },
    {
      type: "quest",
      reason: `Auto-progress: quest in ${bestZone}`,
    },
  ];
}

/**
 * Build a "zone rescue" chain — travel to a zone whose mobs match the agent's
 * level band, then quest there. Used when the current zone produces no
 * usable targets (over-/underleveled, or quest mob not present).
 *
 * Returns null if the best level-band match IS the current zone (nothing to
 * rescue with) or no zone is accessible.
 */
export function buildLevelBandChain(
  level: number,
  currentZone: string,
  allowedZones: string[] | "all" = "all",
): BotScript[] | null {
  const target = findBestZoneForLevelBand(level, allowedZones, currentZone);
  if (!target || target === currentZone) return null;

  const req = ZONE_LEVEL_REQUIREMENTS[target] ?? 1;
  return [
    {
      type: "travel",
      targetZone: target,
      reason: `Rescue: ${currentZone} has no usable targets → ${target} (L${req})`,
    },
    {
      type: "quest",
      reason: `Rescue: quest/combat in ${target}`,
    },
  ];
}

/**
 * Build a detour chain: go somewhere specific, do something, then come back
 * to the home zone and resume productive activity.
 *
 * Example: shopping detour from emerald-woods to village-square merchant →
 *   [travel(village-square), shop, travel(emerald-woods), quest]
 */
export function buildDetourChain(
  detourZone: string,
  detourAction: BotScript,
  homeZone: string | undefined,
  homeActivity: BotScript["type"] = "quest",
): BotScript[] {
  const chain: BotScript[] = [];

  // Step 1: travel to detour zone (skip if already there)
  chain.push({
    type: "travel",
    targetZone: detourZone,
    reason: `Detour: travel to ${detourZone}`,
  });

  // Step 2: perform the detour action in that zone
  chain.push(detourAction);

  // Step 3 + 4: travel home and resume work (only if we have a home to return to
  // and it's different from the detour zone)
  if (homeZone && homeZone !== detourZone) {
    chain.push({
      type: "travel",
      targetZone: homeZone,
      reason: `Detour: return to ${homeZone}`,
    });
    chain.push({
      type: homeActivity,
      reason: `Detour: resume ${homeActivity} in ${homeZone}`,
    });
  }

  return chain;
}

/**
 * Build a profession-learn detour chain.
 * `[travel(village-square), goto(trainer - resolved at runtime), travel(home), quest(home)]`
 *
 * We can't know the trainer's entity ID at queue-build time, so we enqueue a
 * generic `learn` script. The `learn` behaviour finds the trainer in village-square
 * and interacts. Once complete, the next queue entry travels home.
 */
export function buildProfessionLearnChain(
  professionId: string,
  homeZone: string | undefined,
): BotScript[] {
  return buildDetourChain(
    PROFESSION_HUB_ZONE,
    {
      type: "learn",
      reason: `Learn ${professionId}`,
    },
    homeZone,
    "quest",
  );
}

/**
 * Build a shopping detour chain — buy gear at a hub, then return to grinding.
 */
export function buildShoppingDetourChain(
  shopZone: string,
  homeZone: string | undefined,
): BotScript[] {
  return buildDetourChain(
    shopZone,
    {
      type: "shop",
      reason: `Shop at ${shopZone}`,
    },
    homeZone,
    "quest",
  );
}
