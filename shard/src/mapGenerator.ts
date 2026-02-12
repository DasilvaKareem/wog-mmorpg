import fs from "fs";
import path from "path";

/**
 * Tile indices matching the client TileAtlas.ts.
 * Keep in sync — the client interprets these numbers as atlas sprite indices.
 */
const TILE = {
  GRASS_PLAIN: 0,
  GRASS_DARK: 1,
  GRASS_LIGHT: 2,
  GRASS_FLOWERS_RED: 3,
  GRASS_FLOWERS_YELLOW: 4,
  GRASS_FLOWERS_BLUE: 5,
  DIRT_PLAIN: 6,
  DIRT_H: 7,
  DIRT_V: 8,
  DIRT_CROSS: 9,
  STONE_FLOOR: 14,
  STONE_DARK: 15,
  WATER_STILL: 16,
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
  PORTAL_BASE: 56,
  PORTAL_GLOW: 57,
  WALL_WOOD_H: 24,
  WALL_WOOD_V: 25,
  WALL_STONE_H: 26,
  WALL_STONE_V: 27,
  DOOR: 28,
  ROOF_RED: 30,
  ROOF_BLUE: 31,
  ROOF_RED_TOP: 32,
  ROOF_BLUE_TOP: 33,
  INTERIOR_FLOOR: 34,
  COUNTER: 35,
  FENCE_H: 58,
  FENCE_V: 59,
  EMPTY: -1,
} as const;

const TILE_SIZE = 10; // Server game-unit tile size

// ── Zone JSON types ──────────────────────────────────────────────────

interface Vec2 {
  x: number;
  z: number;
}

interface PoiDef {
  id: string;
  name: string;
  type: string;
  position: Vec2;
  radius: number;
  tags: string[];
  portal?: { destinationZone: string; destinationPoi: string };
  structure?: { kind: string; capacity: number; services: string[]; npcs: string[] };
}

interface RoadDef {
  id: string;
  name: string;
  nodes: string[];
}

interface ZoneData {
  id: string;
  name: string;
  bounds: { min: Vec2; max: Vec2 };
  budget: { maxPopulation: number; maxThreat: number };
  pois: PoiDef[];
  roads: RoadDef[];
}

export interface GeneratedMap {
  zoneId: string;
  width: number;
  height: number;
  tileSize: number;
  ground: number[];
  overlay: number[];
  biome: string;
}

// ── Cache ────────────────────────────────────────────────────────────

const mapCache = new Map<string, GeneratedMap>();

export function getGeneratedMap(zoneId: string): GeneratedMap | null {
  return mapCache.get(zoneId) ?? null;
}

export function generateAllMaps(): void {
  const zonesDir = path.join(process.cwd(), "..", "src", "data", "zones");
  if (!fs.existsSync(zonesDir)) return;

  const files = fs.readdirSync(zonesDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const data: ZoneData = JSON.parse(
      fs.readFileSync(path.join(zonesDir, file), "utf-8"),
    );
    const map = generateMap(data);
    mapCache.set(map.zoneId, map);
  }
}

// ── Main generator ───────────────────────────────────────────────────

function generateMap(zone: ZoneData): GeneratedMap {
  const w = Math.floor(
    (zone.bounds.max.x - zone.bounds.min.x) / TILE_SIZE,
  );
  const h = Math.floor(
    (zone.bounds.max.z - zone.bounds.min.z) / TILE_SIZE,
  );

  const ground = new Array(w * h).fill(TILE.GRASS_PLAIN);
  const overlay = new Array(w * h).fill(TILE.EMPTY);

  const biome = detectBiome(zone);

  // Build POI lookup
  const poiMap = new Map<string, PoiDef>();
  for (const poi of zone.pois) poiMap.set(poi.id, poi);

  // 1. Build exclusion zones (POI areas where we don't scatter trees)
  const exclusion = buildExclusionGrid(w, h, zone.pois);

  // 2. Base fill based on biome
  baseFill(ground, w, h, biome, zone.id);

  // 3. Scatter decorations
  scatterDecoration(ground, w, h, biome, exclusion, zone.id);

  // 4. Place trees
  placeTrees(ground, overlay, w, h, biome, exclusion, zone.id);

  // 5. Draw roads
  for (const road of zone.roads) {
    drawRoad(ground, w, h, road, poiMap, zone);
  }

  // 6. Stamp structures
  for (const poi of zone.pois) {
    if (poi.type === "structure" && poi.structure) {
      stampStructure(ground, overlay, w, h, poi, zone);
    }
  }

  // 7. Place landmarks
  for (const poi of zone.pois) {
    if (poi.type === "landmark") {
      placeLandmark(ground, w, h, poi, zone);
    }
  }

  // 8. Place portals
  for (const poi of zone.pois) {
    if (poi.type === "portal") {
      placePortal(ground, overlay, w, h, poi, zone);
    }
  }

  return { zoneId: zone.id, width: w, height: h, tileSize: TILE_SIZE, ground, overlay, biome };
}

// ── Biome detection ──────────────────────────────────────────────────

function detectBiome(zone: ZoneData): string {
  const name = zone.name.toLowerCase();
  if (name.includes("forest") || name.includes("dark")) return "forest";
  if (name.includes("village") || name.includes("square")) return "village";
  return "grassland";
}

// ── Exclusion grid ───────────────────────────────────────────────────

function buildExclusionGrid(w: number, h: number, pois: PoiDef[]): boolean[] {
  const grid = new Array(w * h).fill(false);
  for (const poi of pois) {
    const cx = Math.floor(poi.position.x / TILE_SIZE);
    const cy = Math.floor(poi.position.z / TILE_SIZE);
    const r = Math.ceil(poi.radius / TILE_SIZE) + 2; // Extra buffer
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          if (dx * dx + dy * dy <= r * r) {
            grid[ty * w + tx] = true;
          }
        }
      }
    }
  }
  return grid;
}

// ── Base fill ────────────────────────────────────────────────────────

function baseFill(ground: number[], w: number, h: number, biome: string, seed: string): void {
  const s = hashStr(seed);
  for (let i = 0; i < w * h; i++) {
    const n = seededNoise(i, s);
    if (biome === "forest") {
      ground[i] = n < 0.15 ? TILE.GRASS_DARK : TILE.GRASS_DARK;
    } else if (biome === "village") {
      ground[i] = n < 0.08 ? TILE.GRASS_LIGHT : TILE.GRASS_PLAIN;
    } else {
      // grassland
      ground[i] = n < 0.12 ? TILE.GRASS_LIGHT : TILE.GRASS_PLAIN;
    }
  }
}

// ── Scatter decoration ───────────────────────────────────────────────

function scatterDecoration(
  ground: number[],
  w: number,
  h: number,
  biome: string,
  exclusion: boolean[],
  seed: string,
): void {
  const s = hashStr(seed + "deco");
  for (let i = 0; i < w * h; i++) {
    if (exclusion[i]) continue;
    const n = seededNoise(i, s);
    if (biome === "grassland") {
      if (n < 0.015) ground[i] = TILE.GRASS_FLOWERS_RED;
      else if (n < 0.03) ground[i] = TILE.GRASS_FLOWERS_YELLOW;
      else if (n < 0.04) ground[i] = TILE.GRASS_FLOWERS_BLUE;
      else if (n < 0.06) ground[i] = TILE.GRASS_LIGHT;
      else if (n < 0.008) ground[i] = TILE.WATER_STILL;
    } else if (biome === "forest") {
      if (n < 0.02) ground[i] = TILE.GRASS_DARK;
      else if (n < 0.025) ground[i] = TILE.GRASS_PLAIN;
    } else {
      // village
      if (n < 0.01) ground[i] = TILE.GRASS_FLOWERS_RED;
      else if (n < 0.02) ground[i] = TILE.GRASS_FLOWERS_YELLOW;
    }
  }
}

// ── Place trees ──────────────────────────────────────────────────────

function placeTrees(
  ground: number[],
  overlay: number[],
  w: number,
  h: number,
  biome: string,
  exclusion: boolean[],
  seed: string,
): void {
  const s = hashStr(seed + "tree");
  const density = biome === "forest" ? 0.08 : biome === "village" ? 0.01 : 0.03;
  const isDark = biome === "forest";

  // Place 2x2 metatile trees (trunk at bottom-center, canopy 2x2 above)
  for (let ty = 2; ty < h - 1; ty += 2) {
    for (let tx = 1; tx < w - 1; tx += 2) {
      const idx = ty * w + tx;
      const n = seededNoise(idx, s);
      if (n > density) continue;

      // Check exclusion for 2x2 area
      if (exclusion[idx] || exclusion[idx + 1] || exclusion[(ty - 1) * w + tx] || exclusion[(ty - 1) * w + tx + 1]) {
        continue;
      }

      // Trunk on ground layer (bottom two tiles)
      const trunk = isDark ? TILE.DARK_TREE_TRUNK : TILE.TREE_TRUNK;
      ground[ty * w + tx] = trunk;
      ground[ty * w + tx + 1] = trunk;

      // Canopy on overlay layer (top two tiles)
      const tl = isDark ? TILE.DARK_CANOPY_TL : TILE.TREE_CANOPY_TL;
      const tr = isDark ? TILE.DARK_CANOPY_TR : TILE.TREE_CANOPY_TR;
      const bl = isDark ? TILE.DARK_CANOPY_BL : TILE.TREE_CANOPY_BL;
      const br = isDark ? TILE.DARK_CANOPY_BR : TILE.TREE_CANOPY_BR;

      overlay[(ty - 1) * w + tx] = tl;
      overlay[(ty - 1) * w + tx + 1] = tr;
      overlay[ty * w + tx] = bl;
      overlay[ty * w + tx + 1] = br;

      // Also mark exclusion so trees don't overlap
      exclusion[idx] = true;
      exclusion[idx + 1] = true;
      exclusion[(ty - 1) * w + tx] = true;
      exclusion[(ty - 1) * w + tx + 1] = true;
    }
  }

  // Scatter individual bushes and rocks
  const s2 = hashStr(seed + "scatter");
  for (let i = 0; i < w * h; i++) {
    if (exclusion[i]) continue;
    if (overlay[i] !== TILE.EMPTY) continue;
    const n = seededNoise(i, s2);
    if (biome === "forest") {
      if (n < 0.02) overlay[i] = TILE.BUSH;
      else if (n < 0.025) overlay[i] = TILE.ROCK_SMALL;
      else if (n < 0.04) overlay[i] = TILE.TALL_GRASS;
    } else if (biome === "grassland") {
      if (n < 0.008) overlay[i] = TILE.BUSH;
      else if (n < 0.012) overlay[i] = TILE.ROCK_SMALL;
    }
  }
}

// ── Draw roads ───────────────────────────────────────────────────────

function drawRoad(
  ground: number[],
  w: number,
  h: number,
  road: RoadDef,
  poiMap: Map<string, PoiDef>,
  zone: ZoneData,
): void {
  const nodes: Vec2[] = [];
  for (const nodeId of road.nodes) {
    const poi = poiMap.get(nodeId);
    if (poi) nodes.push(poi.position);
  }

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    drawPath(ground, w, h, from, to, zone);
  }
}

function drawPath(
  ground: number[],
  w: number,
  h: number,
  from: Vec2,
  to: Vec2,
  zone: ZoneData,
): void {
  const x0 = Math.floor(from.x / TILE_SIZE);
  const y0 = Math.floor(from.z / TILE_SIZE);
  const x1 = Math.floor(to.x / TILE_SIZE);
  const y1 = Math.floor(to.z / TILE_SIZE);

  // Bresenham line with 3-wide path
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  // Determine if road is more horizontal or vertical
  const isHorizontal = dx >= dy;

  while (true) {
    // 3-wide path
    const halfWidth = 1;
    for (let d = -halfWidth; d <= halfWidth; d++) {
      let tx: number, ty: number;
      if (isHorizontal) {
        tx = cx;
        ty = cy + d;
      } else {
        tx = cx + d;
        ty = cy;
      }
      if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
        ground[ty * w + tx] = TILE.DIRT_PLAIN;
      }
    }

    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
}

// ── Stamp structures ─────────────────────────────────────────────────

function stampStructure(
  ground: number[],
  overlay: number[],
  w: number,
  h: number,
  poi: PoiDef,
  zone: ZoneData,
): void {
  const cx = Math.floor(poi.position.x / TILE_SIZE);
  const cy = Math.floor(poi.position.z / TILE_SIZE);
  const kind = poi.structure?.kind ?? "house";

  // Structure size based on kind
  let sw = 4, sh = 4;
  if (kind === "shop") { sw = 5; sh = 4; }
  else if (kind === "tavern") { sw = 6; sh = 5; }
  else if (kind === "barracks") { sw = 5; sh = 5; }
  else if (kind === "temple") { sw = 4; sh = 5; }

  const left = cx - Math.floor(sw / 2);
  const top = cy - Math.floor(sh / 2);

  const useStone = kind === "barracks" || kind === "temple";
  const roofColor = kind === "tavern" || kind === "temple" ? TILE.ROOF_BLUE : TILE.ROOF_RED;
  const roofTop = kind === "tavern" || kind === "temple" ? TILE.ROOF_BLUE_TOP : TILE.ROOF_RED_TOP;

  for (let dy = 0; dy < sh; dy++) {
    for (let dx = 0; dx < sw; dx++) {
      const tx = left + dx;
      const ty = top + dy;
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
      const idx = ty * w + tx;

      if (dy === 0) {
        // Roof row (top) — overlay
        overlay[idx] = dx === 0 || dx === sw - 1 ? roofTop : roofColor;
        ground[idx] = TILE.GRASS_PLAIN;
      } else if (dy === sh - 1) {
        // Bottom row — door in center, walls elsewhere
        if (dx === Math.floor(sw / 2)) {
          ground[idx] = TILE.DOOR;
        } else {
          ground[idx] = useStone ? TILE.WALL_STONE_H : TILE.WALL_WOOD_H;
        }
      } else if (dx === 0 || dx === sw - 1) {
        // Side walls
        ground[idx] = useStone ? TILE.WALL_STONE_V : TILE.WALL_WOOD_V;
      } else {
        // Interior
        ground[idx] = TILE.INTERIOR_FLOOR;
        // Add counter in shops
        if (kind === "shop" && dy === 1 && dx >= 1 && dx <= sw - 2) {
          overlay[idx] = TILE.COUNTER;
        }
      }
    }
  }
}

// ── Place landmarks ──────────────────────────────────────────────────

function placeLandmark(
  ground: number[],
  w: number,
  h: number,
  poi: PoiDef,
  zone: ZoneData,
): void {
  const cx = Math.floor(poi.position.x / TILE_SIZE);
  const cy = Math.floor(poi.position.z / TILE_SIZE);
  const r = Math.ceil(poi.radius / TILE_SIZE);

  // Stone clearing
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r) {
        const idx = ty * w + tx;
        if (dist > r - 1.5) {
          ground[idx] = TILE.STONE_DARK;
        } else {
          ground[idx] = TILE.STONE_FLOOR;
        }
      }
    }
  }

  // Fountain in center for safe zones
  if (poi.tags.includes("safe-zone")) {
    if (cx >= 0 && cx < w && cy >= 0 && cy < h) {
      ground[cy * w + cx] = TILE.WATER_STILL;
      // Ring of stone around fountain
      for (let d = -1; d <= 1; d++) {
        for (let e = -1; e <= 1; e++) {
          if (d === 0 && e === 0) continue;
          const fx = cx + d;
          const fy = cy + e;
          if (fx >= 0 && fx < w && fy >= 0 && fy < h) {
            if (Math.abs(d) + Math.abs(e) === 2) continue; // Skip diagonals
            ground[fy * w + fx] = TILE.STONE_DARK;
          }
        }
      }
    }
  }
}

// ── Place portals ────────────────────────────────────────────────────

function placePortal(
  ground: number[],
  overlay: number[],
  w: number,
  h: number,
  poi: PoiDef,
  zone: ZoneData,
): void {
  const cx = Math.floor(poi.position.x / TILE_SIZE);
  const cy = Math.floor(poi.position.z / TILE_SIZE);

  // 3x3 portal
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
      const idx = ty * w + tx;

      if (dx === 0 && dy === 0) {
        ground[idx] = TILE.PORTAL_BASE;
        overlay[idx] = TILE.PORTAL_GLOW;
      } else {
        ground[idx] = TILE.STONE_DARK;
      }
    }
  }
}

// ── Seeded RNG ───────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  }
  return h >>> 0;
}

function seededNoise(i: number, seed: number): number {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h >>> 0) & 0xffff) / 0xffff;
}
