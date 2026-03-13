/**
 * Crop Catalog — 20 crop types for the farming profession.
 * Each crop type defines its harvest yield, rarity, respawn behavior,
 * and required hoe tier.
 *
 * Day/night integration:
 *   preferredPhase — the time phase when this crop thrives.
 *     "day"   → can only be harvested during dawn/day, grows fastest in sunlight.
 *     "night" → can only be harvested during dusk/night, grows fastest under moonlight.
 *     "any"   → harvestable anytime, standard growth rate.
 *   Harvesting during the preferred phase doubles yield.
 *   Growth speed multipliers per phase (applied to respawn timer):
 *     dawn 1.25x | day 1.5x | dusk 1.0x | night 0.5x  (for day-crops)
 *     dawn 0.5x  | day 0.5x | dusk 1.0x | night 2.0x   (for night-crops)
 *     dawn 1.0x  | day 1.0x | dusk 1.0x | night 0.75x  (for any-phase crops)
 */

import type { TimePhase } from "../world/worldClock.js";

export type CropType =
  | "wheat" | "corn" | "carrots" | "potatoes" | "pumpkins"
  | "rice" | "watercress" | "mushrooms" | "berries" | "barley"
  | "hops" | "apples" | "grapes" | "moonberries" | "glowroot"
  | "turnips" | "ironwort" | "crystalmelon" | "starfruit" | "sunflower-seeds";

export type CropPhasePreference = "day" | "night" | "any";

export interface CropProps {
  label: string;
  rarity: "common" | "uncommon" | "rare" | "epic";
  tokenId: bigint;
  maxCharges: number;
  respawnTicks: number;
  requiredHoeTier: number;
  /** Min farming skill to harvest */
  minSkill: number;
  /** Farming XP per harvest */
  xpReward: number;
  /** When this crop can be harvested and grows fastest */
  preferredPhase: CropPhasePreference;
}

/** Growth speed multipliers by time phase for each preference type.
 *  Higher = faster regrowth (ticks pass "faster" toward respawn). */
export const GROWTH_MULTIPLIERS: Record<CropPhasePreference, Record<TimePhase, number>> = {
  day:   { dawn: 1.25, day: 1.5, dusk: 1.0, night: 0.5 },
  night: { dawn: 0.5,  day: 0.5, dusk: 1.0, night: 2.0 },
  any:   { dawn: 1.0,  day: 1.0, dusk: 1.0, night: 0.75 },
};

/** Which time phases allow harvesting for each preference */
export const HARVESTABLE_PHASES: Record<CropPhasePreference, Set<TimePhase>> = {
  day:   new Set(["dawn", "day"]),
  night: new Set(["dusk", "night"]),
  any:   new Set(["dawn", "day", "dusk", "night"]),
};

/** Is the current phase the *peak* bonus phase for this crop? (double yield) */
export function isBonusPhase(pref: CropPhasePreference, phase: TimePhase): boolean {
  if (pref === "day") return phase === "day";
  if (pref === "night") return phase === "night";
  return false; // "any" crops never get a bonus phase
}

export const CROP_CATALOG: Record<CropType, CropProps> = {
  wheat: {
    label: "Wheat",
    rarity: "common",
    tokenId: 200n,
    maxCharges: 5,
    respawnTicks: 20,
    requiredHoeTier: 1,
    minSkill: 1,
    xpReward: 5,
    preferredPhase: "day",
  },
  corn: {
    label: "Corn",
    rarity: "common",
    tokenId: 201n,
    maxCharges: 5,
    respawnTicks: 20,
    requiredHoeTier: 1,
    minSkill: 1,
    xpReward: 5,
    preferredPhase: "day",
  },
  carrots: {
    label: "Carrots",
    rarity: "common",
    tokenId: 202n,
    maxCharges: 4,
    respawnTicks: 25,
    requiredHoeTier: 1,
    minSkill: 10,
    xpReward: 8,
    preferredPhase: "any",
  },
  potatoes: {
    label: "Potatoes",
    rarity: "common",
    tokenId: 203n,
    maxCharges: 4,
    respawnTicks: 25,
    requiredHoeTier: 1,
    minSkill: 15,
    xpReward: 8,
    preferredPhase: "any",
  },
  pumpkins: {
    label: "Pumpkins",
    rarity: "uncommon",
    tokenId: 204n,
    maxCharges: 3,
    respawnTicks: 30,
    requiredHoeTier: 1,
    minSkill: 25,
    xpReward: 12,
    preferredPhase: "any",
  },
  rice: {
    label: "Rice",
    rarity: "uncommon",
    tokenId: 205n,
    maxCharges: 4,
    respawnTicks: 28,
    requiredHoeTier: 1,
    minSkill: 30,
    xpReward: 12,
    preferredPhase: "day",
  },
  watercress: {
    label: "Watercress",
    rarity: "uncommon",
    tokenId: 206n,
    maxCharges: 3,
    respawnTicks: 30,
    requiredHoeTier: 2,
    minSkill: 40,
    xpReward: 15,
    preferredPhase: "any",
  },
  mushrooms: {
    label: "Mushrooms",
    rarity: "uncommon",
    tokenId: 207n,
    maxCharges: 4,
    respawnTicks: 25,
    requiredHoeTier: 1,
    minSkill: 20,
    xpReward: 10,
    preferredPhase: "night",
  },
  berries: {
    label: "Berries",
    rarity: "common",
    tokenId: 208n,
    maxCharges: 5,
    respawnTicks: 22,
    requiredHoeTier: 1,
    minSkill: 5,
    xpReward: 6,
    preferredPhase: "day",
  },
  barley: {
    label: "Barley",
    rarity: "uncommon",
    tokenId: 209n,
    maxCharges: 4,
    respawnTicks: 28,
    requiredHoeTier: 2,
    minSkill: 35,
    xpReward: 14,
    preferredPhase: "day",
  },
  hops: {
    label: "Hops",
    rarity: "uncommon",
    tokenId: 210n,
    maxCharges: 3,
    respawnTicks: 30,
    requiredHoeTier: 2,
    minSkill: 45,
    xpReward: 16,
    preferredPhase: "any",
  },
  apples: {
    label: "Apples",
    rarity: "uncommon",
    tokenId: 211n,
    maxCharges: 4,
    respawnTicks: 26,
    requiredHoeTier: 2,
    minSkill: 50,
    xpReward: 18,
    preferredPhase: "day",
  },
  grapes: {
    label: "Grapes",
    rarity: "rare",
    tokenId: 212n,
    maxCharges: 3,
    respawnTicks: 35,
    requiredHoeTier: 2,
    minSkill: 60,
    xpReward: 22,
    preferredPhase: "any",
  },
  moonberries: {
    label: "Moonberries",
    rarity: "rare",
    tokenId: 213n,
    maxCharges: 2,
    respawnTicks: 40,
    requiredHoeTier: 3,
    minSkill: 80,
    xpReward: 30,
    preferredPhase: "night",
  },
  glowroot: {
    label: "Glowroot",
    rarity: "rare",
    tokenId: 214n,
    maxCharges: 2,
    respawnTicks: 40,
    requiredHoeTier: 3,
    minSkill: 90,
    xpReward: 35,
    preferredPhase: "night",
  },
  turnips: {
    label: "Turnips",
    rarity: "common",
    tokenId: 215n,
    maxCharges: 5,
    respawnTicks: 22,
    requiredHoeTier: 1,
    minSkill: 1,
    xpReward: 5,
    preferredPhase: "any",
  },
  ironwort: {
    label: "Ironwort",
    rarity: "rare",
    tokenId: 216n,
    maxCharges: 2,
    respawnTicks: 45,
    requiredHoeTier: 3,
    minSkill: 100,
    xpReward: 40,
    preferredPhase: "night",
  },
  crystalmelon: {
    label: "Crystalmelon",
    rarity: "epic",
    tokenId: 217n,
    maxCharges: 1,
    respawnTicks: 60,
    requiredHoeTier: 4,
    minSkill: 150,
    xpReward: 60,
    preferredPhase: "night",
  },
  starfruit: {
    label: "Starfruit",
    rarity: "epic",
    tokenId: 218n,
    maxCharges: 1,
    respawnTicks: 60,
    requiredHoeTier: 4,
    minSkill: 175,
    xpReward: 70,
    preferredPhase: "night",
  },
  "sunflower-seeds": {
    label: "Sunflower Seeds",
    rarity: "common",
    tokenId: 219n,
    maxCharges: 5,
    respawnTicks: 20,
    requiredHoeTier: 1,
    minSkill: 1,
    xpReward: 5,
    preferredPhase: "day",
  },
};
