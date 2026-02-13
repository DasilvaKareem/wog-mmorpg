/**
 * Coliseum Arena Map Configurations
 * Different arenas for different level ranges and formats
 */

import type { ColiseumMap } from "./types/pvp.js";

export const COLISEUM_MAPS: Record<string, ColiseumMap> = {
  bronze_arena: {
    mapId: "bronze_arena",
    name: "Bronze Coliseum",
    tileSet: "roman_coliseum",
    width: 40,
    height: 40,
    spawnPoints: {
      red: [
        { x: 5, y: 20 },
        { x: 5, y: 18 },
        { x: 5, y: 22 },
        { x: 7, y: 20 },
        { x: 7, y: 18 },
      ],
      blue: [
        { x: 35, y: 20 },
        { x: 35, y: 18 },
        { x: 35, y: 22 },
        { x: 33, y: 20 },
        { x: 33, y: 18 },
      ],
    },
    obstacles: [
      // Center pillars for line of sight blocking
      { x: 18, y: 18, width: 2, height: 2, type: "pillar" },
      { x: 18, y: 22, width: 2, height: 2, type: "pillar" },
      { x: 22, y: 18, width: 2, height: 2, type: "pillar" },
      { x: 22, y: 22, width: 2, height: 2, type: "pillar" },
      { x: 20, y: 20, width: 2, height: 2, type: "pillar" },
    ],
    powerUps: [
      // Health shrines
      { x: 10, y: 10, type: "health", respawnTicks: 300, active: true },
      { x: 30, y: 10, type: "health", respawnTicks: 300, active: true },
      { x: 10, y: 30, type: "health", respawnTicks: 300, active: true },
      { x: 30, y: 30, type: "health", respawnTicks: 300, active: true },
      // Damage buffs
      { x: 20, y: 10, type: "damage", respawnTicks: 600, active: true },
      { x: 20, y: 30, type: "damage", respawnTicks: 600, active: true },
    ],
    hazards: [
      // Fire zones at corners
      { x: 2, y: 2, width: 3, height: 3, type: "fire", damagePerTick: 5 },
      { x: 35, y: 2, width: 3, height: 3, type: "fire", damagePerTick: 5 },
      { x: 2, y: 35, width: 3, height: 3, type: "fire", damagePerTick: 5 },
      { x: 35, y: 35, width: 3, height: 3, type: "fire", damagePerTick: 5 },
    ],
  },

  silver_arena: {
    mapId: "silver_arena",
    name: "Silver Arena",
    tileSet: "roman_coliseum",
    width: 50,
    height: 50,
    spawnPoints: {
      red: [
        { x: 5, y: 25 },
        { x: 5, y: 23 },
        { x: 5, y: 27 },
        { x: 7, y: 25 },
        { x: 7, y: 23 },
      ],
      blue: [
        { x: 45, y: 25 },
        { x: 45, y: 23 },
        { x: 45, y: 27 },
        { x: 43, y: 25 },
        { x: 43, y: 23 },
      ],
    },
    obstacles: [
      // More complex pillar layout
      { x: 15, y: 15, width: 3, height: 3, type: "pillar" },
      { x: 32, y: 15, width: 3, height: 3, type: "pillar" },
      { x: 15, y: 32, width: 3, height: 3, type: "pillar" },
      { x: 32, y: 32, width: 3, height: 3, type: "pillar" },
      { x: 23, y: 23, width: 4, height: 4, type: "pillar" },
      // Walls
      { x: 12, y: 24, width: 1, height: 3, type: "wall" },
      { x: 37, y: 24, width: 1, height: 3, type: "wall" },
    ],
    powerUps: [
      // Strategic positions
      { x: 12, y: 12, type: "health", respawnTicks: 300, active: true },
      { x: 38, y: 12, type: "health", respawnTicks: 300, active: true },
      { x: 12, y: 38, type: "health", respawnTicks: 300, active: true },
      { x: 38, y: 38, type: "health", respawnTicks: 300, active: true },
      { x: 25, y: 12, type: "damage", respawnTicks: 600, active: true },
      { x: 25, y: 38, type: "damage", respawnTicks: 600, active: true },
      { x: 12, y: 25, type: "speed", respawnTicks: 600, active: true },
      { x: 38, y: 25, type: "speed", respawnTicks: 600, active: true },
    ],
    hazards: [
      // Spike traps in lanes
      { x: 10, y: 24, width: 2, height: 2, type: "spikes", damagePerTick: 8 },
      { x: 38, y: 24, width: 2, height: 2, type: "spikes", damagePerTick: 8 },
      { x: 24, y: 10, width: 2, height: 2, type: "spikes", damagePerTick: 8 },
      { x: 24, y: 38, width: 2, height: 2, type: "spikes", damagePerTick: 8 },
    ],
  },

  gold_coliseum: {
    mapId: "gold_coliseum",
    name: "Gold Coliseum",
    tileSet: "roman_coliseum",
    width: 60,
    height: 60,
    spawnPoints: {
      red: [
        { x: 5, y: 30 },
        { x: 5, y: 28 },
        { x: 5, y: 32 },
        { x: 7, y: 30 },
        { x: 7, y: 28 },
      ],
      blue: [
        { x: 55, y: 30 },
        { x: 55, y: 28 },
        { x: 55, y: 32 },
        { x: 53, y: 30 },
        { x: 53, y: 28 },
      ],
    },
    obstacles: [
      // Grand arena with multiple levels
      { x: 20, y: 20, width: 4, height: 4, type: "pillar" },
      { x: 36, y: 20, width: 4, height: 4, type: "pillar" },
      { x: 20, y: 36, width: 4, height: 4, type: "pillar" },
      { x: 36, y: 36, width: 4, height: 4, type: "pillar" },
      { x: 28, y: 28, width: 5, height: 5, type: "pillar" },
      // Outer walls
      { x: 15, y: 15, width: 1, height: 30, type: "wall" },
      { x: 44, y: 15, width: 1, height: 30, type: "wall" },
      { x: 15, y: 15, width: 30, height: 1, type: "wall" },
      { x: 15, y: 44, width: 30, height: 1, type: "wall" },
    ],
    powerUps: [
      // Center control points
      { x: 30, y: 15, type: "damage", respawnTicks: 600, active: true },
      { x: 30, y: 45, type: "damage", respawnTicks: 600, active: true },
      { x: 15, y: 30, type: "health", respawnTicks: 300, active: true },
      { x: 45, y: 30, type: "health", respawnTicks: 300, active: true },
      { x: 22, y: 22, type: "speed", respawnTicks: 600, active: true },
      { x: 38, y: 22, type: "speed", respawnTicks: 600, active: true },
      { x: 22, y: 38, type: "speed", respawnTicks: 600, active: true },
      { x: 38, y: 38, type: "speed", respawnTicks: 600, active: true },
    ],
    hazards: [
      // Poison pools
      { x: 10, y: 10, width: 4, height: 4, type: "poison", damagePerTick: 10 },
      { x: 46, y: 10, width: 4, height: 4, type: "poison", damagePerTick: 10 },
      { x: 10, y: 46, width: 4, height: 4, type: "poison", damagePerTick: 10 },
      { x: 46, y: 46, width: 4, height: 4, type: "poison", damagePerTick: 10 },
      // Fire lanes
      { x: 30, y: 20, width: 1, height: 5, type: "fire", damagePerTick: 7 },
      { x: 30, y: 35, width: 1, height: 5, type: "fire", damagePerTick: 7 },
    ],
  },

  quick_match_arena: {
    mapId: "quick_match_arena",
    name: "Quick Match Arena",
    tileSet: "roman_coliseum",
    width: 30,
    height: 30,
    spawnPoints: {
      red: [{ x: 5, y: 15 }, { x: 5, y: 13 }],
      blue: [{ x: 25, y: 15 }, { x: 25, y: 13 }],
    },
    obstacles: [
      // Minimal obstacles for fast combat
      { x: 14, y: 14, width: 2, height: 2, type: "pillar" },
    ],
    powerUps: [
      // Single central power-up
      { x: 15, y: 15, type: "damage", respawnTicks: 150, active: true },
    ],
    hazards: [],
  },

  ffa_chaos_pit: {
    mapId: "ffa_chaos_pit",
    name: "Chaos Pit (FFA)",
    tileSet: "roman_coliseum",
    width: 45,
    height: 45,
    spawnPoints: {
      red: [
        { x: 22, y: 5 },
        { x: 40, y: 22 },
        { x: 22, y: 40 },
        { x: 5, y: 22 },
      ],
      blue: [
        { x: 15, y: 15 },
        { x: 30, y: 15 },
        { x: 30, y: 30 },
        { x: 15, y: 30 },
      ],
    },
    obstacles: [
      // Circular pillar arrangement
      { x: 20, y: 20, width: 2, height: 2, type: "pillar" },
      { x: 23, y: 20, width: 2, height: 2, type: "pillar" },
      { x: 20, y: 23, width: 2, height: 2, type: "pillar" },
      { x: 23, y: 23, width: 2, height: 2, type: "pillar" },
    ],
    powerUps: [
      // Multiple power-ups for chaos
      { x: 10, y: 10, type: "health", respawnTicks: 200, active: true },
      { x: 35, y: 10, type: "health", respawnTicks: 200, active: true },
      { x: 10, y: 35, type: "health", respawnTicks: 200, active: true },
      { x: 35, y: 35, type: "health", respawnTicks: 200, active: true },
      { x: 22, y: 22, type: "damage", respawnTicks: 400, active: true },
    ],
    hazards: [
      // Central danger zone
      { x: 21, y: 21, width: 4, height: 4, type: "fire", damagePerTick: 12 },
    ],
  },
};

export function getColiseumMap(mapId: string): ColiseumMap | undefined {
  return COLISEUM_MAPS[mapId];
}

export function getMapByLevel(level: number): ColiseumMap {
  if (level <= 20) return COLISEUM_MAPS.bronze_arena;
  if (level <= 40) return COLISEUM_MAPS.silver_arena;
  return COLISEUM_MAPS.gold_coliseum;
}

export function getMapByFormat(format: string): ColiseumMap {
  if (format === "ffa") return COLISEUM_MAPS.ffa_chaos_pit;
  return COLISEUM_MAPS.bronze_arena;
}
