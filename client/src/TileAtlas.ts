import Phaser from "phaser";

/**
 * Tile indices for the atlas. Each value maps to a 16x16 cell in the atlas texture.
 * Atlas layout: 16 cols x 4 rows = 64 tiles on a 256x64 canvas.
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

const ATLAS_COLS = 16;
const ATLAS_ROWS = 4;
const TILE_PX = 16;

// Color palettes
const C = {
  // Grass
  grassBase: [106, 190, 48],
  grassDark: [75, 137, 41],
  grassLight: [140, 214, 80],
  // Dirt
  dirtBase: [200, 160, 98],
  dirtDark: [160, 120, 64],
  dirtLight: [216, 184, 122],
  // Forest
  forestBase: [62, 106, 40],
  forestDark: [40, 74, 24],
  forestLight: [78, 122, 56],
  // Water
  waterBase: [48, 104, 136],
  waterDark: [32, 72, 104],
  waterLight: [72, 136, 176],
  waterFoam: [180, 220, 240],
  // Stone
  stoneBase: [152, 152, 144],
  stoneDark: [120, 120, 112],
  stoneLight: [176, 176, 168],
  // Wood
  woodBase: [139, 90, 43],
  woodDark: [100, 60, 20],
  woodLight: [170, 120, 60],
  // Roof
  roofRed: [180, 50, 40],
  roofRedDark: [140, 35, 28],
  roofBlue: [50, 80, 160],
  roofBlueDark: [35, 55, 120],
  // Dark tree
  dkTreeBase: [35, 70, 28],
  dkTreeDark: [20, 48, 16],
  dkTreeLight: [50, 85, 40],
  // Flowers
  flowerRed: [220, 50, 50],
  flowerYellow: [240, 210, 50],
  flowerBlue: [60, 100, 220],
  // Rock
  rockBase: [107, 107, 107],
  rockDark: [80, 80, 80],
  rockLight: [136, 136, 136],
  // Portal
  portalBase: [80, 40, 120],
  portalGlow: [160, 80, 240],
  portalBright: [220, 180, 255],
  // Misc
  fenceBase: [120, 80, 40],
  bridgeBase: [140, 100, 55],
  black: [0, 0, 0],
  white: [255, 255, 255],
  transparent: [0, 0, 0, 0],
  interiorFloor: [160, 130, 90],
  counterTop: [100, 70, 35],
  signWood: [150, 100, 50],
  crateWood: [130, 85, 38],
  barrelWood: [110, 72, 32],
  barrelBand: [80, 80, 80],
  chimneyBrick: [140, 70, 50],
  bushDark: [50, 100, 30],
  bushLight: [80, 150, 50],
  tallGrass: [80, 160, 50],
  stumpTop: [120, 85, 45],
  logBark: [100, 65, 30],
} as const;

type RGB = readonly number[];

/**
 * Generates the tile atlas as a canvas, registers it as a Phaser spritesheet.
 */
export function createTileAtlas(scene: Phaser.Scene): void {
  if (scene.textures.exists("tile-atlas")) return;

  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(canvas.width, canvas.height);
  const px = imgData.data;

  // Draw each tile
  drawGrassPlain(px, TILE.GRASS_PLAIN);
  drawGrassDark(px, TILE.GRASS_DARK);
  drawGrassLight(px, TILE.GRASS_LIGHT);
  drawGrassFlowers(px, TILE.GRASS_FLOWERS_RED, C.flowerRed);
  drawGrassFlowers(px, TILE.GRASS_FLOWERS_YELLOW, C.flowerYellow);
  drawGrassFlowers(px, TILE.GRASS_FLOWERS_BLUE, C.flowerBlue);

  drawDirtPlain(px, TILE.DIRT_PLAIN);
  drawDirtH(px, TILE.DIRT_H);
  drawDirtV(px, TILE.DIRT_V);
  drawDirtCross(px, TILE.DIRT_CROSS);
  drawDirtCorner(px, TILE.DIRT_CORNER_NE, "ne");
  drawDirtCorner(px, TILE.DIRT_CORNER_NW, "nw");
  drawDirtCorner(px, TILE.DIRT_CORNER_SE, "se");
  drawDirtCorner(px, TILE.DIRT_CORNER_SW, "sw");
  drawStoneFloor(px, TILE.STONE_FLOOR);
  drawStoneDark(px, TILE.STONE_DARK);

  drawWaterStill(px, TILE.WATER_STILL);
  drawWaterAnim(px, TILE.WATER_ANIM1, 1);
  drawWaterAnim(px, TILE.WATER_ANIM2, 2);
  drawWaterEdge(px, TILE.WATER_EDGE_N, "n");
  drawWaterEdge(px, TILE.WATER_EDGE_S, "s");
  drawWaterEdge(px, TILE.WATER_EDGE_E, "e");
  drawWaterEdge(px, TILE.WATER_EDGE_W, "w");
  drawWaterCornerTile(px, TILE.WATER_CORNER);

  drawWallWood(px, TILE.WALL_WOOD_H, true);
  drawWallWood(px, TILE.WALL_WOOD_V, false);
  drawWallStone(px, TILE.WALL_STONE_H, true);
  drawWallStone(px, TILE.WALL_STONE_V, false);
  drawDoor(px, TILE.DOOR);
  drawWindow(px, TILE.WINDOW);
  drawRoof(px, TILE.ROOF_RED, C.roofRed, C.roofRedDark);
  drawRoof(px, TILE.ROOF_BLUE, C.roofBlue, C.roofBlueDark);
  drawRoofTop(px, TILE.ROOF_RED_TOP, C.roofRed, C.roofRedDark);
  drawRoofTop(px, TILE.ROOF_BLUE_TOP, C.roofBlue, C.roofBlueDark);
  drawInteriorFloor(px, TILE.INTERIOR_FLOOR);
  drawCounter(px, TILE.COUNTER);
  drawChimney(px, TILE.CHIMNEY);
  drawSignPost(px, TILE.SIGN_POST);
  drawCrate(px, TILE.CRATE);
  drawBarrel(px, TILE.BARREL);

  drawTreeTrunk(px, TILE.TREE_TRUNK, C.woodBase, C.woodDark);
  drawCanopy(px, TILE.TREE_CANOPY_TL, C.forestBase, C.forestDark, C.forestLight, "tl");
  drawCanopy(px, TILE.TREE_CANOPY_TR, C.forestBase, C.forestDark, C.forestLight, "tr");
  drawCanopy(px, TILE.TREE_CANOPY_BL, C.forestBase, C.forestDark, C.forestLight, "bl");
  drawCanopy(px, TILE.TREE_CANOPY_BR, C.forestBase, C.forestDark, C.forestLight, "br");

  drawTreeTrunk(px, TILE.DARK_TREE_TRUNK, C.dkTreeBase, C.dkTreeDark);
  drawCanopy(px, TILE.DARK_CANOPY_TL, C.dkTreeBase, C.dkTreeDark, C.dkTreeLight, "tl");
  drawCanopy(px, TILE.DARK_CANOPY_TR, C.dkTreeBase, C.dkTreeDark, C.dkTreeLight, "tr");
  drawCanopy(px, TILE.DARK_CANOPY_BL, C.dkTreeBase, C.dkTreeDark, C.dkTreeLight, "bl");
  drawCanopy(px, TILE.DARK_CANOPY_BR, C.dkTreeBase, C.dkTreeDark, C.dkTreeLight, "br");

  drawRockSmall(px, TILE.ROCK_SMALL);
  drawRockLarge(px, TILE.ROCK_LARGE);
  drawBush(px, TILE.BUSH);
  drawTallGrass(px, TILE.TALL_GRASS);
  drawStump(px, TILE.STUMP);
  drawLog(px, TILE.LOG);

  drawPortalBase(px, TILE.PORTAL_BASE);
  drawPortalGlow(px, TILE.PORTAL_GLOW);
  drawFence(px, TILE.FENCE_H, true);
  drawFence(px, TILE.FENCE_V, false);
  drawFenceCorner(px, TILE.FENCE_CORNER);
  drawBridge(px, TILE.BRIDGE_H, true);
  drawBridge(px, TILE.BRIDGE_V, false);
  // EMPTY tile (63) is left transparent

  ctx.putImageData(imgData, 0, 0);

  // Register as canvas texture, then manually add sprite frames
  const tex = scene.textures.addCanvas("tile-atlas", canvas);
  if (tex) {
    // Add individual frames for each tile (row-major, matching tilemap expectations)
    const cols = ATLAS_COLS;
    const rows = ATLAS_ROWS;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const frameIdx = r * cols + c;
        tex.add(frameIdx, 0, c * TILE_PX, r * TILE_PX, TILE_PX, TILE_PX);
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Get pixel offset in the atlas for a given tile index */
function tileOrigin(tileIdx: number): { ox: number; oy: number } {
  const col = tileIdx % ATLAS_COLS;
  const row = Math.floor(tileIdx / ATLAS_COLS);
  return { ox: col * TILE_PX, oy: row * TILE_PX };
}

/** Set a pixel in the atlas image data (2x2 chunky block for Pokemon feel) */
function setPixel2x2(
  px: Uint8ClampedArray,
  tileIdx: number,
  lx: number,
  ly: number,
  color: RGB,
): void {
  const { ox, oy } = tileOrigin(tileIdx);
  const bx = ox + lx * 2;
  const by = oy + ly * 2;
  const stride = ATLAS_COLS * TILE_PX * 4;
  const a = color.length > 3 ? color[3] : 255;
  for (let dy = 0; dy < 2 && by + dy < ATLAS_ROWS * TILE_PX; dy++) {
    for (let dx = 0; dx < 2 && bx + dx < ATLAS_COLS * TILE_PX; dx++) {
      const idx = (by + dy) * stride + (bx + dx) * 4;
      px[idx] = color[0];
      px[idx + 1] = color[1];
      px[idx + 2] = color[2];
      px[idx + 3] = a;
    }
  }
}

/** Set a single 1x1 pixel (for finer detail) */
function setPixel1x1(
  px: Uint8ClampedArray,
  tileIdx: number,
  lx: number,
  ly: number,
  color: RGB,
): void {
  const { ox, oy } = tileOrigin(tileIdx);
  const stride = ATLAS_COLS * TILE_PX * 4;
  const idx = (oy + ly) * stride + (ox + lx) * 4;
  const a = color.length > 3 ? color[3] : 255;
  px[idx] = color[0];
  px[idx + 1] = color[1];
  px[idx + 2] = color[2];
  px[idx + 3] = a;
}

/** Fill an entire tile with a solid color (2x2 blocks) */
function fillTile(px: Uint8ClampedArray, tileIdx: number, color: RGB): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      setPixel2x2(px, tileIdx, x, y, color);
    }
  }
}

/** Deterministic noise 0..1 */
function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h >>> 0) & 0xffff) / 0xffff;
}

// ── Ground tiles ─────────────────────────────────────────────────────

function drawGrassPlain(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 13, y + idx * 7);
      const c = n < 0.15 ? C.grassDark : n > 0.85 ? C.grassLight : C.grassBase;
      setPixel2x2(px, idx, x, y, c);
    }
  }
}

function drawGrassDark(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 11, y + idx * 5);
      const c = n < 0.35 ? C.grassDark : n > 0.9 ? C.grassBase : C.forestBase;
      setPixel2x2(px, idx, x, y, c);
    }
  }
}

function drawGrassLight(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 17, y + idx * 3);
      const c = n < 0.1 ? C.grassBase : n > 0.7 ? C.grassLight : C.grassBase;
      setPixel2x2(px, idx, x, y, c);
    }
  }
}

function drawGrassFlowers(px: Uint8ClampedArray, idx: number, flowerColor: RGB): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 19, y + idx * 11);
      if (n > 0.82) {
        setPixel2x2(px, idx, x, y, flowerColor);
      } else {
        const gc = n < 0.12 ? C.grassDark : n > 0.7 ? C.grassLight : C.grassBase;
        setPixel2x2(px, idx, x, y, gc);
      }
    }
  }
}

// ── Path tiles ───────────────────────────────────────────────────────

function drawDirtPlain(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 13, y + idx * 9);
      const c = n < 0.18 ? C.dirtDark : n > 0.88 ? C.dirtLight : C.dirtBase;
      setPixel2x2(px, idx, x, y, c);
    }
  }
}

function drawDirtH(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (y === 0 || y === 7) {
        // Grass border
        const n = noise(x + idx * 7, y);
        setPixel2x2(px, idx, x, y, n > 0.5 ? C.grassBase : C.grassDark);
      } else {
        const n = noise(x + idx * 13, y + idx * 9);
        const c = n < 0.15 ? C.dirtDark : n > 0.85 ? C.dirtLight : C.dirtBase;
        setPixel2x2(px, idx, x, y, c);
      }
    }
  }
}

function drawDirtV(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 || x === 7) {
        const n = noise(x, y + idx * 7);
        setPixel2x2(px, idx, x, y, n > 0.5 ? C.grassBase : C.grassDark);
      } else {
        const n = noise(x + idx * 13, y + idx * 9);
        const c = n < 0.15 ? C.dirtDark : n > 0.85 ? C.dirtLight : C.dirtBase;
        setPixel2x2(px, idx, x, y, c);
      }
    }
  }
}

function drawDirtCross(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const isPath = (x >= 1 && x <= 6) || (y >= 1 && y <= 6);
      if (isPath) {
        const n = noise(x + idx * 13, y + idx * 9);
        const c = n < 0.15 ? C.dirtDark : n > 0.85 ? C.dirtLight : C.dirtBase;
        setPixel2x2(px, idx, x, y, c);
      } else {
        const n = noise(x + idx * 5, y + idx * 3);
        setPixel2x2(px, idx, x, y, n > 0.5 ? C.grassBase : C.grassDark);
      }
    }
  }
}

function drawDirtCorner(
  px: Uint8ClampedArray,
  idx: number,
  dir: "ne" | "nw" | "se" | "sw",
): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let isPath = false;
      if (dir === "ne") isPath = x >= 1 && y <= 6;
      else if (dir === "nw") isPath = x <= 6 && y <= 6;
      else if (dir === "se") isPath = x >= 1 && y >= 1;
      else isPath = x <= 6 && y >= 1;

      if (isPath) {
        const n = noise(x + idx * 13, y + idx * 9);
        const c = n < 0.15 ? C.dirtDark : n > 0.85 ? C.dirtLight : C.dirtBase;
        setPixel2x2(px, idx, x, y, c);
      } else {
        const n = noise(x + idx * 5, y + idx * 3);
        setPixel2x2(px, idx, x, y, n > 0.5 ? C.grassBase : C.grassDark);
      }
    }
  }
}

function drawStoneFloor(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Paving pattern: grout lines
      const offset = y >= 4 ? 2 : 0;
      const gx = (x + offset) % 4;
      if (gx === 0 || y % 4 === 0) {
        setPixel2x2(px, idx, x, y, C.stoneDark);
      } else {
        const n = noise(x + idx * 11, y + idx * 13);
        setPixel2x2(px, idx, x, y, n > 0.85 ? C.stoneLight : C.stoneBase);
      }
    }
  }
}

function drawStoneDark(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 7, y + idx * 11);
      const c = n < 0.3 ? C.stoneDark : n > 0.9 ? C.stoneBase : C.stoneDark;
      setPixel2x2(px, idx, x, y, c);
    }
  }
}

// ── Water tiles ──────────────────────────────────────────────────────

function drawWaterStill(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 3, y + idx * 7);
      const wave = (y + x * 0.3) % 4;
      let c: RGB;
      if (wave < 1) c = C.waterLight;
      else if (wave < 3) c = C.waterBase;
      else c = C.waterDark;
      if (n > 0.9) c = C.waterLight;
      setPixel2x2(px, idx, x, y, c);
    }
  }
}

function drawWaterAnim(px: Uint8ClampedArray, idx: number, frame: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const wave = (y + x * 0.3 + frame * 2) % 4;
      let c: RGB;
      if (wave < 1) c = C.waterLight;
      else if (wave < 3) c = C.waterBase;
      else c = C.waterDark;
      setPixel2x2(px, idx, x, y, c);
    }
  }
}

function drawWaterEdge(
  px: Uint8ClampedArray,
  idx: number,
  dir: "n" | "s" | "e" | "w",
): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let isEdge = false;
      if (dir === "n") isEdge = y <= 1;
      else if (dir === "s") isEdge = y >= 6;
      else if (dir === "e") isEdge = x >= 6;
      else isEdge = x <= 1;

      if (isEdge) {
        const n = noise(x + idx * 5, y + idx * 3);
        setPixel2x2(px, idx, x, y, n > 0.5 ? C.grassBase : C.waterFoam);
      } else {
        const wave = (y + x * 0.3) % 4;
        const c = wave < 1 ? C.waterLight : wave < 3 ? C.waterBase : C.waterDark;
        setPixel2x2(px, idx, x, y, c);
      }
    }
  }
}

function drawWaterCornerTile(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x <= 1 && y <= 1) {
        setPixel2x2(px, idx, x, y, C.grassBase);
      } else if (x <= 1 || y <= 1) {
        setPixel2x2(px, idx, x, y, C.waterFoam);
      } else {
        const wave = (y + x * 0.3) % 4;
        const c = wave < 1 ? C.waterLight : wave < 3 ? C.waterBase : C.waterDark;
        setPixel2x2(px, idx, x, y, c);
      }
    }
  }
}

// ── Structure tiles ──────────────────────────────────────────────────

function drawWallWood(px: Uint8ClampedArray, idx: number, horiz: boolean): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (horiz) {
        const isPlank = y >= 2 && y <= 5;
        if (isPlank) {
          const n = noise(x + idx * 3, y);
          setPixel2x2(px, idx, x, y, n > 0.8 ? C.woodLight : C.woodBase);
        } else {
          setPixel2x2(px, idx, x, y, C.woodDark);
        }
      } else {
        const isPlank = x >= 2 && x <= 5;
        if (isPlank) {
          const n = noise(x, y + idx * 3);
          setPixel2x2(px, idx, x, y, n > 0.8 ? C.woodLight : C.woodBase);
        } else {
          setPixel2x2(px, idx, x, y, C.woodDark);
        }
      }
    }
  }
}

function drawWallStone(px: Uint8ClampedArray, idx: number, horiz: boolean): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (horiz) {
        if (y === 0 || y === 7) {
          setPixel2x2(px, idx, x, y, C.stoneDark);
        } else {
          const offset = y >= 4 ? 2 : 0;
          const gx = (x + offset) % 4;
          if (gx === 0) setPixel2x2(px, idx, x, y, C.stoneDark);
          else setPixel2x2(px, idx, x, y, C.stoneBase);
        }
      } else {
        if (x === 0 || x === 7) {
          setPixel2x2(px, idx, x, y, C.stoneDark);
        } else {
          const offset = x >= 4 ? 2 : 0;
          const gy = (y + offset) % 4;
          if (gy === 0) setPixel2x2(px, idx, x, y, C.stoneDark);
          else setPixel2x2(px, idx, x, y, C.stoneBase);
        }
      }
    }
  }
}

function drawDoor(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.woodDark);
  // Door planks
  for (let y = 1; y < 7; y++) {
    for (let x = 2; x < 6; x++) {
      const n = noise(x + idx, y);
      setPixel2x2(px, idx, x, y, n > 0.7 ? C.woodLight : C.woodBase);
    }
  }
  // Doorknob
  setPixel2x2(px, idx, 5, 4, [220, 180, 50]);
}

function drawWindow(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.woodBase);
  // Window pane
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 7; x++) {
      setPixel2x2(px, idx, x, y, [140, 200, 220]);
    }
  }
  // Cross frame
  for (let i = 1; i < 7; i++) {
    setPixel2x2(px, idx, 4, i, C.woodDark);
    setPixel2x2(px, idx, i, 4, C.woodDark);
  }
}

function drawRoof(px: Uint8ClampedArray, idx: number, base: RGB, dark: RGB): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Horizontal shingle lines
      if (y % 3 === 0) setPixel2x2(px, idx, x, y, dark);
      else setPixel2x2(px, idx, x, y, base);
    }
  }
}

function drawRoofTop(px: Uint8ClampedArray, idx: number, base: RGB, dark: RGB): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Peaked roof: narrowing from bottom
      const half = Math.floor(y / 2);
      if (x < half || x >= 8 - half) {
        setPixel2x2(px, idx, x, y, C.transparent);
      } else if (y % 3 === 0) {
        setPixel2x2(px, idx, x, y, dark);
      } else {
        setPixel2x2(px, idx, x, y, base);
      }
    }
  }
}

function drawInteriorFloor(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Checkerboard wood floor
      const checker = ((x >> 1) + (y >> 1)) % 2;
      setPixel2x2(px, idx, x, y, checker ? C.interiorFloor : C.woodLight);
    }
  }
}

function drawCounter(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (y <= 2) {
        setPixel2x2(px, idx, x, y, C.counterTop);
      } else {
        const n = noise(x + idx, y);
        setPixel2x2(px, idx, x, y, n > 0.7 ? C.woodLight : C.woodBase);
      }
    }
  }
}

function drawChimney(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  // Brick chimney 4x6 centered
  for (let y = 1; y < 7; y++) {
    for (let x = 2; x < 6; x++) {
      const isMortar = y % 3 === 0 || (x + (y > 3 ? 1 : 0)) % 3 === 0;
      setPixel2x2(px, idx, x, y, isMortar ? C.stoneDark : C.chimneyBrick);
    }
  }
}

function drawSignPost(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  // Post
  for (let y = 3; y < 8; y++) {
    setPixel2x2(px, idx, 4, y, C.woodDark);
  }
  // Sign board
  for (let y = 1; y < 4; y++) {
    for (let x = 2; x < 7; x++) {
      setPixel2x2(px, idx, x, y, C.signWood);
    }
  }
}

function drawCrate(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 7; x++) {
      if (y === 1 || y === 6 || x === 1 || x === 6) {
        setPixel2x2(px, idx, x, y, C.woodDark);
      } else {
        setPixel2x2(px, idx, x, y, C.crateWood);
      }
    }
  }
  // Cross bands
  setPixel2x2(px, idx, 3, 3, C.woodDark);
  setPixel2x2(px, idx, 4, 4, C.woodDark);
  setPixel2x2(px, idx, 4, 3, C.woodDark);
  setPixel2x2(px, idx, 3, 4, C.woodDark);
}

function drawBarrel(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  // Oval barrel
  for (let y = 1; y < 7; y++) {
    const widthAtY = y >= 2 && y <= 5 ? 3 : 2;
    const startX = 4 - widthAtY;
    for (let x = startX; x < startX + widthAtY * 2; x++) {
      if (x >= 0 && x < 8) {
        if (y === 2 || y === 5) setPixel2x2(px, idx, x, y, C.barrelBand);
        else setPixel2x2(px, idx, x, y, C.barrelWood);
      }
    }
  }
}

// ── Nature tiles ─────────────────────────────────────────────────────

function drawTreeTrunk(px: Uint8ClampedArray, idx: number, base: RGB, dark: RGB): void {
  // Grass base with trunk in center
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 3, y + idx * 5);
      setPixel2x2(px, idx, x, y, n < 0.15 ? C.grassDark : C.grassBase);
    }
  }
  // Trunk: 2 blocks wide centered
  for (let y = 0; y < 8; y++) {
    setPixel2x2(px, idx, 3, y, base);
    setPixel2x2(px, idx, 4, y, dark);
  }
}

function drawCanopy(
  px: Uint8ClampedArray,
  idx: number,
  base: RGB,
  dark: RGB,
  light: RGB,
  corner: "tl" | "tr" | "bl" | "br",
): void {
  // Draw a quarter of a circular canopy
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Distance from the inner corner of this quadrant
      let cx: number, cy: number;
      if (corner === "tl") { cx = 7 - x; cy = 7 - y; }
      else if (corner === "tr") { cx = x; cy = 7 - y; }
      else if (corner === "bl") { cx = 7 - x; cy = y; }
      else { cx = x; cy = y; }

      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist > 8) {
        setPixel2x2(px, idx, x, y, C.transparent);
      } else {
        const n = noise(x + idx * 7, y + idx * 11);
        let c: RGB;
        if (dist > 6.5) c = dark;
        else if (n < 0.2) c = dark;
        else if (n > 0.8) c = light;
        else c = base;
        setPixel2x2(px, idx, x, y, c);
      }
    }
  }
}

function drawRockSmall(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  // Small 4x3 rock centered
  for (let y = 3; y < 6; y++) {
    for (let x = 2; x < 6; x++) {
      const n = noise(x + idx, y);
      setPixel2x2(px, idx, x, y, n > 0.6 ? C.rockLight : n < 0.3 ? C.rockDark : C.rockBase);
    }
  }
  // Highlight top
  setPixel2x2(px, idx, 3, 3, C.rockLight);
}

function drawRockLarge(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  for (let y = 1; y < 7; y++) {
    const w = y >= 2 && y <= 5 ? 3 : 2;
    const sx = 4 - w;
    for (let x = sx; x < sx + w * 2; x++) {
      if (x >= 0 && x < 8) {
        const n = noise(x + idx * 3, y + idx * 5);
        setPixel2x2(px, idx, x, y, n > 0.6 ? C.rockLight : n < 0.3 ? C.rockDark : C.rockBase);
      }
    }
  }
}

function drawBush(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  for (let y = 2; y < 7; y++) {
    const w = y >= 3 && y <= 5 ? 3 : 2;
    const sx = 4 - w;
    for (let x = sx; x < sx + w * 2; x++) {
      if (x >= 0 && x < 8) {
        const n = noise(x + idx * 5, y + idx * 3);
        setPixel2x2(px, idx, x, y, n > 0.7 ? C.bushLight : n < 0.25 ? C.bushDark : C.grassBase);
      }
    }
  }
}

function drawTallGrass(px: Uint8ClampedArray, idx: number): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = noise(x + idx * 9, y + idx * 7);
      if (y < 4 && (x % 2 === 0) && n > 0.4) {
        setPixel2x2(px, idx, x, y, C.tallGrass);
      } else {
        setPixel2x2(px, idx, x, y, n < 0.15 ? C.grassDark : C.grassBase);
      }
    }
  }
}

function drawStump(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  // Stump: circle of bark
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) {
      const dist = Math.sqrt((x - 3.5) ** 2 + (y - 3.5) ** 2);
      if (dist < 2.2) {
        setPixel2x2(px, idx, x, y, dist < 1.2 ? C.stumpTop : C.woodDark);
      }
    }
  }
}

function drawLog(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  // Horizontal log
  for (let y = 3; y < 5; y++) {
    for (let x = 1; x < 7; x++) {
      const n = noise(x + idx, y);
      setPixel2x2(px, idx, x, y, n > 0.6 ? C.woodLight : C.logBark);
    }
  }
  // End caps (rings)
  setPixel2x2(px, idx, 1, 3, C.woodDark);
  setPixel2x2(px, idx, 1, 4, C.woodDark);
  setPixel2x2(px, idx, 6, 3, C.stumpTop);
  setPixel2x2(px, idx, 6, 4, C.stumpTop);
}

// ── Special tiles ────────────────────────────────────────────────────

function drawPortalBase(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.stoneDark);
  // Stone ring
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const dist = Math.sqrt((x - 3.5) ** 2 + (y - 3.5) ** 2);
      if (dist < 3.5 && dist > 2) {
        setPixel2x2(px, idx, x, y, C.stoneBase);
      } else if (dist <= 2) {
        setPixel2x2(px, idx, x, y, C.portalBase);
      }
    }
  }
}

function drawPortalGlow(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const dist = Math.sqrt((x - 3.5) ** 2 + (y - 3.5) ** 2);
      if (dist < 3) {
        const n = noise(x + idx * 3, y + idx * 7);
        if (n > 0.6) setPixel2x2(px, idx, x, y, C.portalBright);
        else setPixel2x2(px, idx, x, y, C.portalGlow);
      }
    }
  }
}

function drawFence(px: Uint8ClampedArray, idx: number, horiz: boolean): void {
  fillTile(px, idx, C.transparent);
  if (horiz) {
    // Horizontal rail
    for (let x = 0; x < 8; x++) {
      setPixel2x2(px, idx, x, 3, C.fenceBase);
      setPixel2x2(px, idx, x, 5, C.fenceBase);
    }
    // Posts at ends
    for (let y = 1; y < 7; y++) {
      setPixel2x2(px, idx, 0, y, C.woodDark);
      setPixel2x2(px, idx, 7, y, C.woodDark);
    }
  } else {
    for (let y = 0; y < 8; y++) {
      setPixel2x2(px, idx, 3, y, C.fenceBase);
      setPixel2x2(px, idx, 5, y, C.fenceBase);
    }
    for (let x = 1; x < 7; x++) {
      setPixel2x2(px, idx, x, 0, C.woodDark);
      setPixel2x2(px, idx, x, 7, C.woodDark);
    }
  }
}

function drawFenceCorner(px: Uint8ClampedArray, idx: number): void {
  fillTile(px, idx, C.transparent);
  // Corner post
  for (let y = 1; y < 7; y++) setPixel2x2(px, idx, 4, y, C.fenceBase);
  for (let x = 4; x < 8; x++) setPixel2x2(px, idx, x, 3, C.fenceBase);
  for (let x = 4; x < 8; x++) setPixel2x2(px, idx, x, 5, C.fenceBase);
  setPixel2x2(px, idx, 4, 4, C.woodDark);
}

function drawBridge(px: Uint8ClampedArray, idx: number, horiz: boolean): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (horiz) {
        if (y === 0 || y === 7) {
          setPixel2x2(px, idx, x, y, C.woodDark);
        } else {
          const plank = x % 3 === 0;
          setPixel2x2(px, idx, x, y, plank ? C.woodDark : C.bridgeBase);
        }
      } else {
        if (x === 0 || x === 7) {
          setPixel2x2(px, idx, x, y, C.woodDark);
        } else {
          const plank = y % 3 === 0;
          setPixel2x2(px, idx, x, y, plank ? C.woodDark : C.bridgeBase);
        }
      }
    }
  }
}
