import { TILE } from "./tileTypes";
import { OVERWORLD_COLS, packOwRaw } from "./overworldMapping";

/**
 * Multi-tile stamp prefabs for houses, villages, and decor clusters.
 * Each cell optionally sets ground, overlay, and elevation.
 * `undefined` means "leave the existing value alone".
 *
 * Tile composition mirrors shard/src/world/mapGenerator.ts placeStructure():
 *   - Walls live on the GROUND layer (they block movement as non-walkable ground)
 *   - Roofs live on the OVERLAY layer (drawn on top of walls)
 *   - Door is a GROUND tile (walkable)
 */
export interface PrefabCell {
  ground?: number;
  overlay?: number;
  elevation?: number;
}

export interface Prefab {
  id: string;
  name: string;
  category: "house" | "village" | "nature" | "path";
  width: number;
  height: number;
  /** Row-major: cells[y * width + x] */
  cells: PrefabCell[];
}

type C = PrefabCell;
const _ : C = {};

/** Build a cells array from a 2D string grid using a symbol→cell mapping. */
function fromGrid(grid: string[], legend: Record<string, C>): { cells: C[]; width: number; height: number } {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const cells: C[] = [];
  for (let y = 0; y < height; y++) {
    const row = grid[y];
    for (let x = 0; x < width; x++) {
      const sym = row[x] ?? ".";
      cells.push(legend[sym] ?? _);
    }
  }
  return { cells, width, height };
}

/**
 * Build a prefab directly from a rectangular region of Overworld.png.
 * Every cell in the region becomes an overlay tile pointing at its raw
 * atlas index — no per-tile legend required. Use this for pre-assembled
 * multi-tile art (houses, arches, fountains) where the atlas already
 * contains the composed building.
 *
 * `solidMask` is an optional 2D grid of "S" (solid, writes to ground so
 * the tile blocks movement) and "." (overlay only). Omit to treat every
 * cell as overlay.
 */
function fromAtlasRegion(opts: {
  row0: number;
  col0: number;
  rows: number;
  cols: number;
  solidMask?: string[];
}): { cells: C[]; width: number; height: number } {
  const { row0, col0, rows, cols, solidMask } = opts;
  const cells: C[] = [];
  for (let dy = 0; dy < rows; dy++) {
    for (let dx = 0; dx < cols; dx++) {
      const owIdx = (row0 + dy) * OVERWORLD_COLS + (col0 + dx);
      const solid = solidMask?.[dy]?.[dx] === "S";
      cells.push(solid
        ? { ground: packOwRaw(owIdx) }
        : { overlay: packOwRaw(owIdx) });
    }
  }
  return { cells, width: cols, height: rows };
}

// ── House prefabs ───────────────────────────────────────────────────

const SMALL_HOUSE_WOOD: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "RRRRR",
      "VIIIV",
      "VIIIV",
      "WWDWW",
    ],
    {
      R: { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED },
      V: { ground: TILE.WALL_WOOD_V },
      W: { ground: TILE.WALL_WOOD_H },
      I: { ground: TILE.INTERIOR_FLOOR },
      D: { ground: TILE.DOOR },
    },
  );
  // Roof edges use ROOF_RED_TOP
  cells[0] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED_TOP };
  cells[width - 1] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED_TOP };
  return { id: "small-house-wood", name: "Small House", category: "house", width, height, cells };
})();

// Large wooden manor: 5×5 pre-assembled house at Overworld.png (row 0-4, col 6-10).
// Walls (rows 1-3) stamp to ground so they block movement; the roof peak row
// and the shadow row below stamp to overlay so grass remains underneath.
const LARGE_HOUSE_WOOD: Prefab = (() => {
  const { cells, width, height } = fromAtlasRegion({
    row0: 0,
    col0: 6,
    rows: 5,
    cols: 5,
    solidMask: [
      ".....",  // roof peak — overlay (transparent edges)
      ".SSS.",  // upper wall — solid
      ".SSS.",  // lower wall — solid
      ".SSS.",  // archway + windows — solid
      ".....",  // ground shadow — overlay
    ],
  });
  return { id: "large-house-wood", name: "Large House", category: "house", width, height, cells };
})();

const STONE_HOUSE: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "RRRRR",
      "VIIIV",
      "VIIIV",
      "WWDWW",
    ],
    {
      R: { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_BLUE },
      V: { ground: TILE.WALL_STONE_V },
      W: { ground: TILE.WALL_STONE_H },
      I: { ground: TILE.INTERIOR_FLOOR },
      D: { ground: TILE.DOOR },
    },
  );
  cells[0] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_BLUE_TOP };
  cells[width - 1] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_BLUE_TOP };
  return { id: "stone-house", name: "Stone House", category: "house", width, height, cells };
})();

const SHOP: Prefab = (() => {
  // Counter row behind the door so shop interior reads as a shop.
  const { cells, width, height } = fromGrid(
    [
      "RRRRR",
      "VCCCV",
      "VIIIV",
      "WWDWW",
    ],
    {
      R: { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED },
      V: { ground: TILE.WALL_WOOD_V },
      W: { ground: TILE.WALL_WOOD_H },
      I: { ground: TILE.INTERIOR_FLOOR },
      C: { ground: TILE.INTERIOR_FLOOR, overlay: TILE.COUNTER },
      D: { ground: TILE.DOOR },
    },
  );
  cells[0] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED_TOP };
  cells[width - 1] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED_TOP };
  return { id: "shop", name: "Shop (w/ Counter)", category: "house", width, height, cells };
})();

const TAVERN: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "RRRRRR",
      "VIIIIV",
      "VIIIIV",
      "VIIIIV",
      "WWWDWW",
    ],
    {
      R: { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_BLUE },
      V: { ground: TILE.WALL_STONE_V },
      W: { ground: TILE.WALL_STONE_H },
      I: { ground: TILE.INTERIOR_FLOOR },
      D: { ground: TILE.DOOR },
    },
  );
  cells[0] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_BLUE_TOP };
  cells[width - 1] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_BLUE_TOP };
  return { id: "tavern", name: "Tavern", category: "house", width, height, cells };
})();

const BARN: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "RRRRRR",
      "VIIIIV",
      "VIIIIV",
      "WWDDWW",
    ],
    {
      R: { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED },
      V: { ground: TILE.WALL_WOOD_V },
      W: { ground: TILE.WALL_WOOD_H },
      I: { ground: TILE.INTERIOR_FLOOR },
      D: { ground: TILE.DOOR },
    },
  );
  cells[0] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED_TOP };
  cells[width - 1] = { ground: TILE.GRASS_PLAIN, overlay: TILE.ROOF_RED_TOP };
  return { id: "barn", name: "Barn (double door)", category: "house", width, height, cells };
})();

// ── Village decor ───────────────────────────────────────────────────

const FENCE_SQUARE_5: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "CHHHC",
      "V...V",
      "V...V",
      "V...V",
      "CHHHC",
    ],
    {
      H: { overlay: TILE.FENCE_H },
      V: { overlay: TILE.FENCE_V },
      C: { overlay: TILE.FENCE_CORNER },
    },
  );
  return { id: "fence-5x5", name: "Fence 5×5", category: "village", width, height, cells };
})();

const STONE_PLAZA_3: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "SSS",
      "SSS",
      "SSS",
    ],
    { S: { ground: TILE.STONE_FLOOR } },
  );
  return { id: "stone-plaza-3", name: "Stone Plaza 3×3", category: "village", width, height, cells };
})();

const STONE_PLAZA_5: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "DDDDD",
      "DSSSD",
      "DSSSD",
      "DSSSD",
      "DDDDD",
    ],
    {
      S: { ground: TILE.STONE_FLOOR },
      D: { ground: TILE.STONE_DARK },
    },
  );
  return { id: "stone-plaza-5", name: "Stone Plaza 5×5", category: "village", width, height, cells };
})();

const CRATES_PILE: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "CB.",
      "BCB",
      ".BC",
    ],
    {
      C: { overlay: TILE.CRATE },
      B: { overlay: TILE.BARREL },
    },
  );
  return { id: "crates-pile", name: "Crates & Barrels", category: "village", width, height, cells };
})();

const SIGN: Prefab = {
  id: "sign",
  name: "Sign Post",
  category: "village",
  width: 1,
  height: 1,
  cells: [{ overlay: TILE.SIGN_POST }],
};

// ── Nature clusters ─────────────────────────────────────────────────

const TREE_CLUSTER: Prefab = (() => {
  // A 3x3 grove: three trees offset so they don't overlap awkwardly.
  // Trees on this atlas use 5 tile indices (trunk + 4 canopy quadrants),
  // but the XR renderer just treats any TREE_* tile as a full 3D tree and
  // dedupes; so we place trunk tiles spaced apart.
  const { cells, width, height } = fromGrid(
    [
      "T.T",
      ".T.",
      "T.T",
    ],
    { T: { overlay: TILE.TREE_TRUNK } },
  );
  return { id: "tree-cluster", name: "Tree Cluster 3×3", category: "nature", width, height, cells };
})();

const DARK_TREE_CLUSTER: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "T.T",
      ".T.",
      "T.T",
    ],
    { T: { overlay: TILE.DARK_TREE_TRUNK } },
  );
  return { id: "dark-tree-cluster", name: "Dark Tree Cluster", category: "nature", width, height, cells };
})();

const ROCK_PILE: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      "L.S",
      ".L.",
      "S.L",
    ],
    {
      L: { overlay: TILE.ROCK_LARGE },
      S: { overlay: TILE.ROCK_SMALL },
    },
  );
  return { id: "rock-pile", name: "Rock Pile 3×3", category: "nature", width, height, cells };
})();

const POND: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      ".NNN.",
      "WWWWW",
      "WWWWW",
      "WWWWW",
      ".SSS.",
    ],
    {
      W: { ground: TILE.WATER_STILL },
      N: { ground: TILE.WATER_EDGE_N },
      S: { ground: TILE.WATER_EDGE_S },
    },
  );
  return { id: "pond", name: "Pond 5×5", category: "nature", width, height, cells };
})();

// ── Paths ───────────────────────────────────────────────────────────

const PATH_H_5: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    ["DDDDD"],
    { D: { ground: TILE.DIRT_H } },
  );
  return { id: "path-h-5", name: "Path — horizontal 5", category: "path", width, height, cells };
})();

const PATH_V_5: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    ["D", "D", "D", "D", "D"],
    { D: { ground: TILE.DIRT_V } },
  );
  return { id: "path-v-5", name: "Path — vertical 5", category: "path", width, height, cells };
})();

const PATH_CROSS: Prefab = (() => {
  const { cells, width, height } = fromGrid(
    [
      ".V.",
      "HXH",
      ".V.",
    ],
    {
      H: { ground: TILE.DIRT_H },
      V: { ground: TILE.DIRT_V },
      X: { ground: TILE.DIRT_CROSS },
    },
  );
  return { id: "path-cross", name: "Path — crossroads", category: "path", width, height, cells };
})();

export const PREFABS: Prefab[] = [
  SMALL_HOUSE_WOOD,
  LARGE_HOUSE_WOOD,
  STONE_HOUSE,
  SHOP,
  TAVERN,
  BARN,
  FENCE_SQUARE_5,
  STONE_PLAZA_3,
  STONE_PLAZA_5,
  CRATES_PILE,
  SIGN,
  TREE_CLUSTER,
  DARK_TREE_CLUSTER,
  ROCK_PILE,
  POND,
  PATH_H_5,
  PATH_V_5,
  PATH_CROSS,
];

export function getPrefab(id: string): Prefab | undefined {
  return PREFABS.find((p) => p.id === id);
}

/**
 * Rotate a prefab 90° clockwise. Wall tile indices are swapped H↔V so the
 * rotated structure still renders correctly.
 */
export function rotatePrefab(p: Prefab): Prefab {
  const rotated: PrefabCell[] = new Array(p.cells.length);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const src = p.cells[y * p.width + x];
      // New position after 90° CW: (x, y) → (height - 1 - y, x)
      const nx = p.height - 1 - y;
      const ny = x;
      const nw = p.height; // rotated width = original height
      rotated[ny * nw + nx] = rotateCell(src);
    }
  }
  return { ...p, width: p.height, height: p.width, cells: rotated };
}

function rotateCell(c: PrefabCell): PrefabCell {
  if (!c) return c;
  const out: PrefabCell = { ...c };
  if (c.ground !== undefined) out.ground = swapHV(c.ground);
  if (c.overlay !== undefined) out.overlay = swapHV(c.overlay);
  return out;
}

function swapHV(t: number): number {
  if (t === TILE.WALL_WOOD_H) return TILE.WALL_WOOD_V;
  if (t === TILE.WALL_WOOD_V) return TILE.WALL_WOOD_H;
  if (t === TILE.WALL_STONE_H) return TILE.WALL_STONE_V;
  if (t === TILE.WALL_STONE_V) return TILE.WALL_STONE_H;
  if (t === TILE.FENCE_H) return TILE.FENCE_V;
  if (t === TILE.FENCE_V) return TILE.FENCE_H;
  if (t === TILE.DIRT_H) return TILE.DIRT_V;
  if (t === TILE.DIRT_V) return TILE.DIRT_H;
  if (t === TILE.BRIDGE_H) return TILE.BRIDGE_V;
  if (t === TILE.BRIDGE_V) return TILE.BRIDGE_H;
  return t;
}
