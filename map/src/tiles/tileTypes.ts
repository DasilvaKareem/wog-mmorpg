/**
 * Tile indices matching the shard mapGenerator.ts and client TileAtlas.ts.
 * Old atlas: 16 cols x 4 rows = 64 tiles.
 * These values are stored in the terrain grid JSON.
 */
export const TILE = {
  // Ground (0-5)
  GRASS_PLAIN: 0,
  GRASS_DARK: 1,
  GRASS_LIGHT: 2,
  GRASS_FLOWERS_RED: 3,
  GRASS_FLOWERS_YELLOW: 4,
  GRASS_FLOWERS_BLUE: 5,

  // Paths (6-15)
  DIRT_PLAIN: 6,
  DIRT_H: 7,
  DIRT_V: 8,
  DIRT_CROSS: 9,
  DIRT_CORNER_NE: 10,
  DIRT_CORNER_NW: 11,
  DIRT_CORNER_SE: 12,
  DIRT_CORNER_SW: 13,
  STONE_FLOOR: 14,
  STONE_DARK: 15,

  // Water (16-23)
  WATER_STILL: 16,
  WATER_ANIM1: 17,
  WATER_ANIM2: 18,
  WATER_EDGE_N: 19,
  WATER_EDGE_S: 20,
  WATER_EDGE_E: 21,
  WATER_EDGE_W: 22,
  WATER_CORNER: 23,

  // Structures (24-39)
  WALL_WOOD_H: 24,
  WALL_WOOD_V: 25,
  WALL_STONE_H: 26,
  WALL_STONE_V: 27,
  DOOR: 28,
  WINDOW: 29,
  ROOF_RED: 30,
  ROOF_BLUE: 31,
  ROOF_RED_TOP: 32,
  ROOF_BLUE_TOP: 33,
  INTERIOR_FLOOR: 34,
  COUNTER: 35,
  CHIMNEY: 36,
  SIGN_POST: 37,
  CRATE: 38,
  BARREL: 39,

  // Nature (40-55)
  TREE_TRUNK: 40,
  TREE_CANOPY_TL: 41,
  TREE_CANOPY_TR: 42,
  TREE_CANOPY_BL: 43,
  TREE_CANOPY_BR: 44,
  DARK_TREE_TRUNK: 45,
  DARK_CANOPY_TL: 46,
  DARK_CANOPY_TR: 47,
  DARK_CANOPY_BL: 48,
  DARK_CANOPY_BR: 49,
  ROCK_SMALL: 50,
  ROCK_LARGE: 51,
  BUSH: 52,
  TALL_GRASS: 53,
  STUMP: 54,
  LOG: 55,

  // Special (56-63)
  PORTAL_BASE: 56,
  PORTAL_GLOW: 57,
  FENCE_H: 58,
  FENCE_V: 59,
  FENCE_CORNER: 60,
  BRIDGE_H: 61,
  BRIDGE_V: 62,
  EMPTY: 63,
} as const;

export type TileIndex = (typeof TILE)[keyof typeof TILE];
export type TileName = keyof typeof TILE;

/** Reverse lookup: tile index → tile name */
const _reverseMap = new Map<number, TileName>();
for (const [name, idx] of Object.entries(TILE)) {
  _reverseMap.set(idx, name as TileName);
}

export function tileName(idx: number): TileName | undefined {
  return _reverseMap.get(idx);
}
