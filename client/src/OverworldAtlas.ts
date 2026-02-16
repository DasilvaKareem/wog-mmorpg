import Phaser from "phaser";

/**
 * Overworld.png tileset loader and tile index mapping.
 *
 * Overworld.png: 640×576 = 40 cols × 36 rows of 16×16 pixel-art tiles.
 * This replaces the procedural TileAtlas.ts with real tileset art.
 *
 * Tile positions verified by pixel sampling (see Python analysis).
 */

export const OVERWORLD_COLS = 40;
export const OVERWORLD_ROWS = 36;
export const OVERWORLD_TILE_PX = 16;
export const OVERWORLD_KEY = "overworld";

/** Convert (row, col) in the Overworld spritesheet to a frame index */
function ow(row: number, col: number): number {
  return row * OVERWORLD_COLS + col;
}

// ── Overworld tile positions (pixel-verified) ───────────────────────
// All positions are (row, col) in the 40×36 grid of Overworld.png.
// Tile index = row * 40 + col.

export const OW_TILES = {
  // ── Grass variants (GROUND layer — must be fully opaque) ──────────
  GRASS_PLAIN:         ow(0, 0),    // =0   Medium grass (100% opaque)
  GRASS_DARK:          ow(5, 11),   // =211 Dark grass for forest (100% opaque)
  GRASS_LIGHT:         ow(5, 12),   // =212 Light grass variant (100% opaque)
  GRASS_FLOWERS_RED:   ow(9, 0),    // =360 Grass variant (100% opaque)
  GRASS_FLOWERS_YELLOW:ow(9, 1),    // =361 Grass variant (100% opaque)
  GRASS_FLOWERS_BLUE:  ow(10, 0),   // =400 Grass variant (100% opaque)

  // ── Dirt / Path (GROUND — fully opaque) ───────────────────────────
  DIRT_PLAIN:          ow(3, 12),   // =132 Brown dirt (100% opaque)
  DIRT_H:              ow(3, 13),   // =133 Dirt path (100% opaque)
  DIRT_V:              ow(3, 14),   // =134 Dirt path (100% opaque)
  DIRT_CROSS:          ow(3, 12),   // Dirt crossroads (fallback)
  DIRT_CORNER_NE:      ow(3, 12),   // Dirt corner (fallback)
  DIRT_CORNER_NW:      ow(3, 12),   // Dirt corner (fallback)
  DIRT_CORNER_SE:      ow(3, 12),   // Dirt corner (fallback)
  DIRT_CORNER_SW:      ow(3, 12),   // Dirt corner (fallback)

  // ── Stone (GROUND — fully opaque) ─────────────────────────────────
  STONE_FLOOR:         ow(11, 14),  // =454 Light gray stone floor
  STONE_DARK:          ow(12, 16),  // =496 Darker stone

  // ── Water (4×6 autotile at rows 0-3, cols 16-21) ─────────────────
  // 3 animation frames, each 2 cols wide:
  //   Frame 1: cols 16-17 | Frame 2: cols 18-19 | Frame 3: cols 20-21
  WATER_STILL:         ow(0, 16),   // =16   Frame 1 deep water
  WATER_ANIM1:         ow(0, 18),   // =18   Frame 2 deep water
  WATER_ANIM2:         ow(0, 20),   // =20   Frame 3 deep water
  WATER_EDGE_N:        ow(2, 16),   // =96   Shore at top
  WATER_EDGE_S:        ow(3, 17),   // =137  Shore at bottom
  WATER_EDGE_E:        ow(2, 17),   // =97   Shore at right
  WATER_EDGE_W:        ow(3, 16),   // =136  Shore at left
  WATER_CORNER:        ow(1, 16),   // =56   Shore corner

  // ── Structures (GROUND — fully opaque) ────────────────────────────
  WALL_WOOD_H:         ow(1, 8),    // =48  Wooden wall horizontal
  WALL_WOOD_V:         ow(1, 9),    // =49  Wooden wall vertical
  WALL_STONE_H:        ow(1, 22),   // =62  Stone wall horizontal
  WALL_STONE_V:        ow(1, 24),   // =64  Stone wall vertical
  DOOR:                ow(2, 8),    // =88  Wooden door/entrance
  WINDOW:              ow(1, 7),    // =47  Wall with window
  ROOF_RED:            ow(0, 7),    // =7   Brown wooden roof
  ROOF_BLUE:           ow(0, 11),   // =11  Gray/stone roof
  ROOF_RED_TOP:        ow(0, 9),    // =9   Roof peak/edge
  ROOF_BLUE_TOP:       ow(0, 14),   // =14  Stone roof edge
  INTERIOR_FLOOR:      ow(4, 17),   // =177 Brown floor (100% opaque)
  COUNTER:             ow(10, 9),   // =409 Stone counter surface
  CHIMNEY:             ow(0, 13),   // =13  Chimney top
  SIGN_POST:           ow(11, 7),   // =447 Wooden sign
  CRATE:               ow(12, 11),  // =491 Wooden crate
  BARREL:              ow(12, 12),  // =492 Barrel

  // ── Nature: Trees (OVERLAY — must have transparency!) ─────────────
  // Tree layout: 2×2 canopy on overlay, trunk on ground
  //   [canopy_TL] [canopy_TR]  ← overlay (row above trunk)
  //   [canopy_BL] [canopy_BR]  ← overlay (same row as trunk)
  //   [trunk]     [trunk]      ← ground (fully opaque)
  //
  // Regular tree — transparent sprites from rows 11+
  TREE_TRUNK:          ow(7, 4),    // =284 Trunk on grass (opaque ground tile)
  TREE_CANOPY_TL:      ow(11, 0),   // =440 Green canopy 88% vis (transparent overlay)
  TREE_CANOPY_TR:      ow(11, 1),   // =441 Green canopy 89% vis (transparent overlay)
  TREE_CANOPY_BL:      ow(11, 0),   // =440 Canopy bottom-left (reuse TL)
  TREE_CANOPY_BR:      ow(11, 1),   // =441 Canopy bottom-right (reuse TR)

  // Dark tree (forest) — transparent sprites from rows 13-14
  DARK_TREE_TRUNK:     ow(6, 11),   // =251 Dark trunk on grass (opaque ground tile)
  DARK_CANOPY_TL:      ow(13, 1),   // =521 Dark canopy 79% vis (transparent overlay)
  DARK_CANOPY_TR:      ow(13, 3),   // =523 Dark canopy 79% vis (transparent overlay)
  DARK_CANOPY_BL:      ow(14, 1),   // =561 Dark canopy 82% vis (transparent overlay)
  DARK_CANOPY_BR:      ow(14, 3),   // =563 Dark canopy 82% vis (transparent overlay)

  // ── Nature: Misc (OVERLAY — transparent sprites) ──────────────────
  ROCK_SMALL:          ow(8, 6),    // =326 Rock overlay 43% vis
  ROCK_LARGE:          ow(7, 8),    // =288 Rock overlay 44% vis
  BUSH:                ow(11, 3),   // =443 Bush overlay 37% vis
  TALL_GRASS:          ow(1, 32),   // =72  Tall grass overlay 50% vis
  STUMP:               ow(12, 0),   // =480 Stump overlay 24% vis
  LOG:                 ow(2, 4),    // =84  Log overlay 51% vis

  // ── Special ───────────────────────────────────────────────────────
  PORTAL_BASE:         ow(12, 14),  // =494 Gray stone base
  PORTAL_GLOW:         ow(11, 14),  // =454 Glowing stone
  FENCE_H:             ow(11, 7),   // =447 Horizontal fence
  FENCE_V:             ow(11, 8),   // =448 Vertical fence
  FENCE_CORNER:        ow(11, 7),   // Fence corner (fallback)
  BRIDGE_H:            ow(10, 9),   // =409 Stone bridge horizontal
  BRIDGE_V:            ow(10, 10),  // =410 Stone bridge vertical

  // ── Cliff / Elevation tiles (verified by quadrant analysis) ───────
  // 3×3 autotile at rows 3-5, cols 0-2.
  // Placed ON the higher terrain at cliff edges.
  // Named by WHERE the cliff face shows (e.g. EDGE_B = cliff at bottom).
  //
  // The auto-tiler uses these when elevation drops in a direction:
  //   dropS → CLIFF_EDGE_B   (cliff face at bottom of tile)
  //   dropN → CLIFF_EDGE_T   (cliff face at top)
  //   dropE → CLIFF_EDGE_R   (cliff face at right)
  //   dropW → CLIFF_EDGE_L   (cliff face at left)

  CLIFF_OUTER_TL:      ow(3, 0),    // =120 Top-left corner (dropN && dropW)
  CLIFF_EDGE_T:        ow(3, 1),    // =121 Top-center, cliff face at top (dropN)
  CLIFF_OUTER_TR:      ow(3, 2),    // =122 Top-right corner (dropN && dropE)
  CLIFF_EDGE_L:        ow(4, 0),    // =160 Middle-left, cliff face at left (dropW)
  CLIFF_FACE:          ow(4, 1),    // =161 Center, flat elevated terrain
  CLIFF_EDGE_R:        ow(4, 2),    // =162 Middle-right, cliff face at right (dropE)
  CLIFF_OUTER_BL:      ow(5, 0),    // =200 Bottom-left corner (dropS && dropW)
  CLIFF_EDGE_B:        ow(5, 1),    // =201 Bottom-center, cliff face at bottom (dropS)
  CLIFF_OUTER_BR:      ow(5, 2),    // =202 Bottom-right corner (dropS && dropE)

  // Inner corners: use grass (diagonal-only drops are very subtle)
  CLIFF_INNER_TL:      ow(0, 0),    // Use plain grass for inner corners
  CLIFF_INNER_TR:      ow(0, 0),
  CLIFF_INNER_BL:      ow(0, 0),
  CLIFF_INNER_BR:      ow(0, 0),

  // Alternate cliff set (reuse same tiles for consistency)
  CLIFF2_OUTER_TL:     ow(3, 0),
  CLIFF2_EDGE_T:       ow(3, 1),
  CLIFF2_OUTER_TR:     ow(3, 2),
  CLIFF2_EDGE_L:       ow(4, 0),
  CLIFF2_FACE:         ow(4, 1),
  CLIFF2_EDGE_R:       ow(4, 2),
  CLIFF2_OUTER_BL:     ow(5, 0),
  CLIFF2_EDGE_B:       ow(5, 1),
  CLIFF2_OUTER_BR:     ow(5, 2),

  // ── Fountain / Plaza ──────────────────────────────────────────────
  FOUNTAIN_TL:         ow(12, 14),  // Gray stone
  FOUNTAIN_TR:         ow(12, 14),
  FOUNTAIN_BL:         ow(12, 14),
  FOUNTAIN_BR:         ow(12, 14),
} as const;

// ── Translation table: Old procedural TILE (0-63) → Overworld index ──

/**
 * Maps old procedural tile indices (from TileAtlas.ts TILE enum)
 * to Overworld.png spritesheet frame indices.
 *
 * Old atlas: 16 cols × 4 rows = 64 tiles
 * New atlas: 40 cols × 36 rows = 1440 tiles
 */
const OLD_TO_OVERWORLD: (number | -1)[] = [
  // 0-5: Ground
  OW_TILES.GRASS_PLAIN,         // 0: GRASS_PLAIN
  OW_TILES.GRASS_DARK,          // 1: GRASS_DARK
  OW_TILES.GRASS_LIGHT,         // 2: GRASS_LIGHT
  OW_TILES.GRASS_FLOWERS_RED,   // 3: GRASS_FLOWERS_RED
  OW_TILES.GRASS_FLOWERS_YELLOW,// 4: GRASS_FLOWERS_YELLOW
  OW_TILES.GRASS_FLOWERS_BLUE,  // 5: GRASS_FLOWERS_BLUE

  // 6-15: Paths
  OW_TILES.DIRT_PLAIN,          // 6: DIRT_PLAIN
  OW_TILES.DIRT_H,              // 7: DIRT_H
  OW_TILES.DIRT_V,              // 8: DIRT_V
  OW_TILES.DIRT_CROSS,          // 9: DIRT_CROSS
  OW_TILES.DIRT_CORNER_NE,      // 10: DIRT_CORNER_NE
  OW_TILES.DIRT_CORNER_NW,      // 11: DIRT_CORNER_NW
  OW_TILES.DIRT_CORNER_SE,      // 12: DIRT_CORNER_SE
  OW_TILES.DIRT_CORNER_SW,      // 13: DIRT_CORNER_SW
  OW_TILES.STONE_FLOOR,         // 14: STONE_FLOOR
  OW_TILES.STONE_DARK,          // 15: STONE_DARK

  // 16-23: Water
  OW_TILES.WATER_STILL,         // 16: WATER_STILL
  OW_TILES.WATER_ANIM1,         // 17: WATER_ANIM1
  OW_TILES.WATER_ANIM2,         // 18: WATER_ANIM2
  OW_TILES.WATER_EDGE_N,        // 19: WATER_EDGE_N
  OW_TILES.WATER_EDGE_S,        // 20: WATER_EDGE_S
  OW_TILES.WATER_EDGE_E,        // 21: WATER_EDGE_E
  OW_TILES.WATER_EDGE_W,        // 22: WATER_EDGE_W
  OW_TILES.WATER_CORNER,        // 23: WATER_CORNER

  // 24-39: Structures
  OW_TILES.WALL_WOOD_H,         // 24: WALL_WOOD_H
  OW_TILES.WALL_WOOD_V,         // 25: WALL_WOOD_V
  OW_TILES.WALL_STONE_H,        // 26: WALL_STONE_H
  OW_TILES.WALL_STONE_V,        // 27: WALL_STONE_V
  OW_TILES.DOOR,                // 28: DOOR
  OW_TILES.WINDOW,              // 29: WINDOW
  OW_TILES.ROOF_RED,            // 30: ROOF_RED
  OW_TILES.ROOF_BLUE,           // 31: ROOF_BLUE
  OW_TILES.ROOF_RED_TOP,        // 32: ROOF_RED_TOP
  OW_TILES.ROOF_BLUE_TOP,       // 33: ROOF_BLUE_TOP
  OW_TILES.INTERIOR_FLOOR,      // 34: INTERIOR_FLOOR
  OW_TILES.COUNTER,             // 35: COUNTER
  OW_TILES.CHIMNEY,             // 36: CHIMNEY
  OW_TILES.SIGN_POST,           // 37: SIGN_POST
  OW_TILES.CRATE,               // 38: CRATE
  OW_TILES.BARREL,              // 39: BARREL

  // 40-55: Nature
  OW_TILES.TREE_TRUNK,          // 40: TREE_TRUNK
  OW_TILES.TREE_CANOPY_TL,      // 41: TREE_CANOPY_TL
  OW_TILES.TREE_CANOPY_TR,      // 42: TREE_CANOPY_TR
  OW_TILES.TREE_CANOPY_BL,      // 43: TREE_CANOPY_BL
  OW_TILES.TREE_CANOPY_BR,      // 44: TREE_CANOPY_BR
  OW_TILES.DARK_TREE_TRUNK,     // 45: DARK_TREE_TRUNK
  OW_TILES.DARK_CANOPY_TL,      // 46: DARK_CANOPY_TL
  OW_TILES.DARK_CANOPY_TR,      // 47: DARK_CANOPY_TR
  OW_TILES.DARK_CANOPY_BL,      // 48: DARK_CANOPY_BL
  OW_TILES.DARK_CANOPY_BR,      // 49: DARK_CANOPY_BR
  OW_TILES.ROCK_SMALL,          // 50: ROCK_SMALL
  OW_TILES.ROCK_LARGE,          // 51: ROCK_LARGE
  OW_TILES.BUSH,                // 52: BUSH
  OW_TILES.TALL_GRASS,          // 53: TALL_GRASS
  OW_TILES.STUMP,               // 54: STUMP
  OW_TILES.LOG,                 // 55: LOG

  // 56-63: Special
  OW_TILES.PORTAL_BASE,         // 56: PORTAL_BASE
  OW_TILES.PORTAL_GLOW,         // 57: PORTAL_GLOW
  OW_TILES.FENCE_H,             // 58: FENCE_H
  OW_TILES.FENCE_V,             // 59: FENCE_V
  OW_TILES.FENCE_CORNER,        // 60: FENCE_CORNER
  OW_TILES.BRIDGE_H,            // 61: BRIDGE_H
  OW_TILES.BRIDGE_V,            // 62: BRIDGE_V
  -1,                            // 63: EMPTY (transparent)
];

/**
 * Translate an old procedural tile index (0-63) to an Overworld spritesheet
 * frame index. Returns -1 for empty/transparent tiles.
 */
export function mapOldTileToOverworld(oldTile: number): number {
  if (oldTile < 0 || oldTile >= OLD_TO_OVERWORLD.length) return -1;
  return OLD_TO_OVERWORLD[oldTile];
}

// ── Preloading ──────────────────────────────────────────────────────

/**
 * Preload the Overworld.png as an image in a Phaser scene.
 * Call this in the scene's `preload()` method.
 * Loaded as an image (not spritesheet) — Phaser's tilemap addTilesetImage
 * handles slicing into 16×16 tiles automatically.
 */
export function preloadOverworld(scene: Phaser.Scene): void {
  scene.load.image(OVERWORLD_KEY, "/assets/Overworld.png");
}

/**
 * Returns true if the overworld texture has been loaded.
 */
export function isOverworldLoaded(scene: Phaser.Scene): boolean {
  return scene.textures.exists(OVERWORLD_KEY);
}
