/**
 * Overworld.png tileset mapping — extracted from client/OverworldAtlas.ts.
 * No Phaser dependency.
 *
 * Overworld.png: 640x576 = 40 cols x 36 rows of 16x16 pixel-art tiles.
 */

export const OVERWORLD_COLS = 40;
export const OVERWORLD_ROWS = 36;
export const OVERWORLD_TILE_PX = 16;

/** Convert (row, col) in the Overworld spritesheet to a frame index */
function ow(row: number, col: number): number {
  return row * OVERWORLD_COLS + col;
}

export const OW_TILES = {
  // Grass variants (GROUND layer)
  GRASS_PLAIN:         ow(0, 0),
  GRASS_DARK:          ow(5, 11),
  GRASS_LIGHT:         ow(5, 12),
  GRASS_FLOWERS_RED:   ow(9, 0),
  GRASS_FLOWERS_YELLOW:ow(9, 1),
  GRASS_FLOWERS_BLUE:  ow(10, 0),

  // Dirt / Path (GROUND) — 3×3 autotile block at (row 13-14, col 12-14).
  // Center tile (14,13) is pure dirt; surrounding tiles are grass-dirt
  // transition edges so paths blend into grass terrain automatically.
  DIRT_PLAIN:          ow(14, 13),  // center — pure dirt
  DIRT_H:              ow(14, 13),  // tileable along horizontal
  DIRT_V:              ow(14, 13),  // tileable along vertical
  DIRT_CROSS:          ow(14, 13),  // 4-way intersection
  DIRT_CORNER_NE:      ow(13, 14),  // top-right transition
  DIRT_CORNER_NW:      ow(13, 12),  // top-left transition
  DIRT_CORNER_SE:      ow(14, 14),  // right edge transition
  DIRT_CORNER_SW:      ow(14, 12),  // left edge transition
  DIRT_EDGE_N:         ow(13, 13),  // top edge (dirt south of grass)

  // Stone (GROUND)
  STONE_FLOOR:         ow(11, 14),
  STONE_DARK:          ow(12, 16),

  // Water
  WATER_STILL:         ow(0, 16),
  WATER_ANIM1:         ow(0, 18),
  WATER_ANIM2:         ow(0, 20),
  WATER_EDGE_N:        ow(2, 16),
  WATER_EDGE_S:        ow(3, 17),
  WATER_EDGE_E:        ow(2, 17),
  WATER_EDGE_W:        ow(3, 16),
  WATER_CORNER:        ow(1, 16),

  // Structures (GROUND)
  WALL_WOOD_H:         ow(1, 8),
  WALL_WOOD_V:         ow(1, 9),
  WALL_STONE_H:        ow(1, 22),
  WALL_STONE_V:        ow(1, 24),
  DOOR:                ow(2, 8),
  WINDOW:              ow(1, 7),
  ROOF_RED:            ow(0, 7),
  ROOF_BLUE:           ow(0, 11),
  ROOF_RED_TOP:        ow(0, 9),
  ROOF_BLUE_TOP:       ow(0, 14),
  INTERIOR_FLOOR:      ow(4, 17),
  COUNTER:             ow(10, 9),
  CHIMNEY:             ow(0, 13),
  SIGN_POST:           ow(11, 7),
  CRATE:               ow(12, 11),
  BARREL:              ow(12, 12),

  // Nature: Trees (OVERLAY)
  TREE_TRUNK:          ow(7, 4),
  TREE_CANOPY_TL:      ow(11, 0),
  TREE_CANOPY_TR:      ow(11, 1),
  TREE_CANOPY_BL:      ow(11, 0),
  TREE_CANOPY_BR:      ow(11, 1),
  DARK_TREE_TRUNK:     ow(6, 11),
  DARK_CANOPY_TL:      ow(13, 1),
  DARK_CANOPY_TR:      ow(13, 3),
  DARK_CANOPY_BL:      ow(14, 1),
  DARK_CANOPY_BR:      ow(14, 3),

  // Nature: Misc (OVERLAY)
  ROCK_SMALL:          ow(8, 6),
  ROCK_LARGE:          ow(7, 8),
  BUSH:                ow(11, 3),
  TALL_GRASS:          ow(1, 32),
  STUMP:               ow(12, 0),
  LOG:                 ow(2, 4),

  // Special
  PORTAL_BASE:         ow(12, 14),
  PORTAL_GLOW:         ow(11, 14),
  FENCE_H:             ow(11, 7),
  FENCE_V:             ow(11, 8),
  FENCE_CORNER:        ow(11, 7),
  BRIDGE_H:            ow(10, 9),
  BRIDGE_V:            ow(10, 10),

  // Cliff / Elevation
  CLIFF_OUTER_TL:      ow(3, 0),
  CLIFF_EDGE_T:        ow(3, 1),
  CLIFF_OUTER_TR:      ow(3, 2),
  CLIFF_EDGE_L:        ow(4, 0),
  CLIFF_FACE:          ow(4, 1),
  CLIFF_EDGE_R:        ow(4, 2),
  CLIFF_OUTER_BL:      ow(5, 0),
  CLIFF_EDGE_B:        ow(5, 1),
  CLIFF_OUTER_BR:      ow(5, 2),
} as const;

/**
 * Maps old procedural tile indices (0-63) to Overworld.png frame indices.
 * Index in array = old TILE enum value; value = Overworld frame index.
 */
export const OLD_TO_OVERWORLD: (number | -1)[] = [
  // 0-5: Ground
  OW_TILES.GRASS_PLAIN,
  OW_TILES.GRASS_DARK,
  OW_TILES.GRASS_LIGHT,
  OW_TILES.GRASS_FLOWERS_RED,
  OW_TILES.GRASS_FLOWERS_YELLOW,
  OW_TILES.GRASS_FLOWERS_BLUE,
  // 6-15: Paths
  OW_TILES.DIRT_PLAIN,
  OW_TILES.DIRT_H,
  OW_TILES.DIRT_V,
  OW_TILES.DIRT_CROSS,
  OW_TILES.DIRT_CORNER_NE,
  OW_TILES.DIRT_CORNER_NW,
  OW_TILES.DIRT_CORNER_SE,
  OW_TILES.DIRT_CORNER_SW,
  OW_TILES.STONE_FLOOR,
  OW_TILES.STONE_DARK,
  // 16-23: Water
  OW_TILES.WATER_STILL,
  OW_TILES.WATER_ANIM1,
  OW_TILES.WATER_ANIM2,
  OW_TILES.WATER_EDGE_N,
  OW_TILES.WATER_EDGE_S,
  OW_TILES.WATER_EDGE_E,
  OW_TILES.WATER_EDGE_W,
  OW_TILES.WATER_CORNER,
  // 24-39: Structures
  OW_TILES.WALL_WOOD_H,
  OW_TILES.WALL_WOOD_V,
  OW_TILES.WALL_STONE_H,
  OW_TILES.WALL_STONE_V,
  OW_TILES.DOOR,
  OW_TILES.WINDOW,
  OW_TILES.ROOF_RED,
  OW_TILES.ROOF_BLUE,
  OW_TILES.ROOF_RED_TOP,
  OW_TILES.ROOF_BLUE_TOP,
  OW_TILES.INTERIOR_FLOOR,
  OW_TILES.COUNTER,
  OW_TILES.CHIMNEY,
  OW_TILES.SIGN_POST,
  OW_TILES.CRATE,
  OW_TILES.BARREL,
  // 40-55: Nature
  OW_TILES.TREE_TRUNK,
  OW_TILES.TREE_CANOPY_TL,
  OW_TILES.TREE_CANOPY_TR,
  OW_TILES.TREE_CANOPY_BL,
  OW_TILES.TREE_CANOPY_BR,
  OW_TILES.DARK_TREE_TRUNK,
  OW_TILES.DARK_CANOPY_TL,
  OW_TILES.DARK_CANOPY_TR,
  OW_TILES.DARK_CANOPY_BL,
  OW_TILES.DARK_CANOPY_BR,
  OW_TILES.ROCK_SMALL,
  OW_TILES.ROCK_LARGE,
  OW_TILES.BUSH,
  OW_TILES.TALL_GRASS,
  OW_TILES.STUMP,
  OW_TILES.LOG,
  // 56-63: Special
  OW_TILES.PORTAL_BASE,
  OW_TILES.PORTAL_GLOW,
  OW_TILES.FENCE_H,
  OW_TILES.FENCE_V,
  OW_TILES.FENCE_CORNER,
  OW_TILES.BRIDGE_H,
  OW_TILES.BRIDGE_V,
  -1, // 63: EMPTY
];

/**
 * Offset used to pack a raw Overworld atlas index into the old-tile grid.
 * Values >= OW_RAW_OFFSET are interpreted as (value - OW_RAW_OFFSET) raw
 * Overworld.png frame indices, bypassing the OLD_TO_OVERWORLD legacy map.
 *
 * This lets prefabs reference pre-assembled atlas art (full houses, etc.)
 * without needing a named TILE entry for every unique 16x16 tile.
 */
export const OW_RAW_OFFSET = 10000;

/** Encode a raw Overworld atlas index for storage in the ground/overlay grids. */
export function packOwRaw(owIdx: number): number {
  return OW_RAW_OFFSET + owIdx;
}

/**
 * Translate a stored tile value to an Overworld spritesheet frame index.
 * Returns -1 for empty/transparent tiles.
 *
 * Accepts either an old procedural tile enum (0-63) or a packed raw atlas
 * index (>= OW_RAW_OFFSET).
 */
export function mapOldTileToOverworld(oldTile: number): number {
  if (oldTile >= OW_RAW_OFFSET) return oldTile - OW_RAW_OFFSET;
  if (oldTile < 0 || oldTile >= OLD_TO_OVERWORLD.length) return -1;
  return OLD_TO_OVERWORLD[oldTile];
}
