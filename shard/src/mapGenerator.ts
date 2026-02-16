import fs from "fs";
import path from "path";
import { getWorldLayout } from "./worldLayout.js";

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
  bounds?: { min: Vec2; max: Vec2 };
  width?: number;
  height?: number;
  budget?: { maxPopulation: number; maxThreat: number };
  pois?: PoiDef[] | string[];
  roads?: RoadDef[];
  biome?: string;
}

export interface GeneratedMap {
  zoneId: string;
  width: number;
  height: number;
  tileSize: number;
  ground: number[];
  overlay: number[];
  elevation: number[];
  biome: string;
}

// ── Cache ────────────────────────────────────────────────────────────

const mapCache = new Map<string, GeneratedMap>();

export function getGeneratedMap(zoneId: string): GeneratedMap | null {
  return mapCache.get(zoneId) ?? null;
}

// ── World-space blending ─────────────────────────────────────────────

const BLEND_TILES = 8; // ~80 game units transition zone at biome edges

interface WorldZoneBlendInfo {
  id: string;
  biome: string;
  minWtx: number; // world tile x start (inclusive)
  maxWtx: number; // world tile x end (exclusive)
  minWtz: number; // world tile z start (inclusive)
  maxWtz: number; // world tile z end (exclusive)
}

let worldBlendInfos: WorldZoneBlendInfo[] = [];

function populateWorldBlendInfos(allZoneData: Map<string, ZoneData>): void {
  const layout = getWorldLayout();
  worldBlendInfos = [];

  for (const [zoneId, zoneLayout] of Object.entries(layout.zones)) {
    const zoneData = allZoneData.get(zoneId);
    const biome = zoneData ? detectBiome(zoneData) : "grassland";

    const offTx = Math.floor(zoneLayout.offset.x / TILE_SIZE);
    const offTz = Math.floor(zoneLayout.offset.z / TILE_SIZE);
    const widthTiles = Math.floor(zoneLayout.size.width / TILE_SIZE);
    const heightTiles = Math.floor(zoneLayout.size.height / TILE_SIZE);

    worldBlendInfos.push({
      id: zoneId,
      biome,
      minWtx: offTx,
      maxWtx: offTx + widthTiles,
      minWtz: offTz,
      maxWtz: offTz + heightTiles,
    });
  }
}

/** Get the base ground tile for a biome given a noise value */
function biomeBaseTile(biome: string, noise: number): number {
  if (biome === "forest") {
    return TILE.GRASS_DARK;
  } else if (biome === "village") {
    return noise < 0.08 ? TILE.GRASS_LIGHT : TILE.GRASS_PLAIN;
  } else {
    // grassland
    return noise < 0.12 ? TILE.GRASS_LIGHT : TILE.GRASS_PLAIN;
  }
}

/** Get the elevation profile for a biome */
function getElevProfile(biome: string): { noiseScale: number; maxElev: number; baseElev: number } {
  if (biome === "village") return { noiseScale: 0.02, maxElev: 1, baseElev: 0 };
  if (biome === "forest") return { noiseScale: 0.04, maxElev: 3, baseElev: 1 };
  return { noiseScale: 0.03, maxElev: 2, baseElev: 0 }; // grassland
}

/**
 * Find the nearest adjacent zone with a different biome and the distance to
 * the shared edge. Returns null if no adjacent zone within BLEND_TILES.
 */
function findAdjacentBlend(
  wtx: number, wtz: number, currentZoneId: string,
): { biome: string; distance: number } | null {
  const current = worldBlendInfos.find(z => z.id === currentZoneId);
  if (!current) return null;

  // Distance from tile to each edge of current zone
  const distLeft = wtx - current.minWtx;
  const distRight = current.maxWtx - 1 - wtx;
  const distTop = wtz - current.minWtz;
  const distBottom = current.maxWtz - 1 - wtz;

  let bestDist = BLEND_TILES;
  let adjacentBiome: string | null = null;

  for (const other of worldBlendInfos) {
    if (other.id === currentZoneId) continue;
    if (other.biome === current.biome) continue; // same biome, no visible seam

    // Right edge: other zone starts where current ends
    if (other.minWtx === current.maxWtx && wtz >= other.minWtz && wtz < other.maxWtz) {
      if (distRight < bestDist) { bestDist = distRight; adjacentBiome = other.biome; }
    }
    // Left edge
    if (other.maxWtx === current.minWtx && wtz >= other.minWtz && wtz < other.maxWtz) {
      if (distLeft < bestDist) { bestDist = distLeft; adjacentBiome = other.biome; }
    }
    // Bottom edge
    if (other.minWtz === current.maxWtz && wtx >= other.minWtx && wtx < other.maxWtx) {
      if (distBottom < bestDist) { bestDist = distBottom; adjacentBiome = other.biome; }
    }
    // Top edge
    if (other.maxWtz === current.minWtz && wtx >= other.minWtx && wtx < other.maxWtx) {
      if (distTop < bestDist) { bestDist = distTop; adjacentBiome = other.biome; }
    }
  }

  if (adjacentBiome === null) return null;
  return { biome: adjacentBiome, distance: bestDist };
}

// ── Map generation ──────────────────────────────────────────────────

export function generateAllMaps(): void {
  const zonesDir = path.join(process.cwd(), "..", "world", "content", "zones");
  if (!fs.existsSync(zonesDir)) {
    console.warn(`[mapGenerator] Zones directory not found: ${zonesDir}`);
    return;
  }

  const files = fs.readdirSync(zonesDir).filter((f) => f.endsWith(".json"));
  const allZoneData = new Map<string, ZoneData>();

  for (const file of files) {
    const data: ZoneData = JSON.parse(
      fs.readFileSync(path.join(zonesDir, file), "utf-8"),
    );
    allZoneData.set(data.id, data);
  }

  // Populate blend info before generating maps
  populateWorldBlendInfos(allZoneData);

  for (const data of allZoneData.values()) {
    const map = generateMap(data);
    mapCache.set(map.zoneId, map);
  }
}

// ── Main generator ───────────────────────────────────────────────────

function generateMap(zone: ZoneData): GeneratedMap {
  // Handle both bounds-based and width/height-based zone formats
  let w: number, h: number;
  if (zone.bounds) {
    w = Math.floor((zone.bounds.max.x - zone.bounds.min.x) / TILE_SIZE);
    h = Math.floor((zone.bounds.max.z - zone.bounds.min.z) / TILE_SIZE);
  } else if (zone.width && zone.height) {
    w = Math.floor(zone.width / TILE_SIZE);
    h = Math.floor(zone.height / TILE_SIZE);
  } else {
    throw new Error(`Zone ${zone.id} missing bounds or width/height`);
  }

  const ground = new Array(w * h).fill(TILE.GRASS_PLAIN);
  const overlay = new Array(w * h).fill(TILE.EMPTY);

  const biome = detectBiome(zone);

  // World-space tile offsets for seamless noise
  const layout = getWorldLayout();
  const zoneLayout = layout.zones[zone.id];
  const worldOffTx = zoneLayout ? Math.floor(zoneLayout.offset.x / TILE_SIZE) : 0;
  const worldOffTz = zoneLayout ? Math.floor(zoneLayout.offset.z / TILE_SIZE) : 0;

  // Build POI lookup (handle both full POI objects and POI ID strings)
  const poiMap = new Map<string, PoiDef>();
  const validPois: PoiDef[] = [];
  if (zone.pois && Array.isArray(zone.pois)) {
    for (const poi of zone.pois) {
      if (typeof poi === 'object' && 'id' in poi) {
        poiMap.set(poi.id, poi);
        validPois.push(poi);
      }
      // Skip string POI IDs - we can't render them without full data
    }
  }

  // 1. Build exclusion zones (POI areas where we don't scatter trees)
  const exclusion = buildExclusionGrid(w, h, validPois);

  // 2. Base fill based on biome (world-space noise + blending)
  baseFill(ground, w, h, biome, zone.id, worldOffTx, worldOffTz);

  // 3. Scatter decorations (world-space noise + blending)
  scatterDecoration(ground, w, h, biome, exclusion, zone.id, worldOffTx, worldOffTz);

  // 4. Place trees (world-space noise + blending)
  placeTrees(ground, overlay, w, h, biome, exclusion, zone.id, worldOffTx, worldOffTz);

  // 5. Draw roads (if zone has roads defined)
  if (zone.roads && Array.isArray(zone.roads)) {
    for (const road of zone.roads) {
      drawRoad(ground, w, h, road, poiMap, zone);
    }
  }

  // 6. Stamp structures
  for (const poi of validPois) {
    if (poi.type === "structure" && poi.structure) {
      stampStructure(ground, overlay, w, h, poi, zone);
    }
  }

  // 7. Place landmarks
  for (const poi of validPois) {
    if (poi.type === "landmark") {
      placeLandmark(ground, w, h, poi, zone);
    }
  }

  // 8. Place portals
  for (const poi of validPois) {
    if (poi.type === "portal") {
      placePortal(ground, overlay, w, h, poi, zone);
    }
  }

  // 9. Generate elevation (world-space noise + blending)
  const elevation = generateElevation(ground, w, h, biome, exclusion, validPois, zone, worldOffTx, worldOffTz);

  return { zoneId: zone.id, width: w, height: h, tileSize: TILE_SIZE, ground, overlay, elevation, biome };
}

// ── Biome detection ──────────────────────────────────────────────────

function detectBiome(zone: ZoneData): string {
  if (zone.biome) return zone.biome;
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

// ── Base fill (world-space noise + biome blending) ───────────────────

function baseFill(
  ground: number[], w: number, h: number, biome: string,
  zoneId: string, worldOffTx: number, worldOffTz: number,
): void {
  const s = hashStr("world-base");

  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const wtx = worldOffTx + tx;
      const wtz = worldOffTz + tz;
      const n = seededNoise2D(wtx, wtz, s);

      const adj = findAdjacentBlend(wtx, wtz, zoneId);
      if (adj && adj.distance < BLEND_TILES) {
        // Probabilistic blend: closer to edge = higher chance of adjacent biome tile
        const blendWeight = (1.0 - adj.distance / BLEND_TILES) * 0.5;
        const blendNoise = seededNoise2D(wtx, wtz, s + 7777);
        if (blendNoise < blendWeight) {
          ground[tz * w + tx] = biomeBaseTile(adj.biome, n);
        } else {
          ground[tz * w + tx] = biomeBaseTile(biome, n);
        }
      } else {
        ground[tz * w + tx] = biomeBaseTile(biome, n);
      }
    }
  }
}

// ── Scatter decoration (world-space noise + biome blending) ──────────

function scatterDecoration(
  ground: number[], w: number, h: number, biome: string,
  exclusion: boolean[], zoneId: string,
  worldOffTx: number, worldOffTz: number,
): void {
  const s = hashStr("world-deco");

  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const idx = tz * w + tx;
      if (exclusion[idx]) continue;

      const wtx = worldOffTx + tx;
      const wtz = worldOffTz + tz;
      const n = seededNoise2D(wtx, wtz, s);

      // Determine effective biome (blend near edges)
      let effectiveBiome = biome;
      const adj = findAdjacentBlend(wtx, wtz, zoneId);
      if (adj && adj.distance < BLEND_TILES) {
        const blendWeight = (1.0 - adj.distance / BLEND_TILES) * 0.5;
        const blendNoise = seededNoise2D(wtx, wtz, s + 7777);
        if (blendNoise < blendWeight) {
          effectiveBiome = adj.biome;
        }
      }

      if (effectiveBiome === "grassland") {
        if (n < 0.015) ground[idx] = TILE.GRASS_FLOWERS_RED;
        else if (n < 0.03) ground[idx] = TILE.GRASS_FLOWERS_YELLOW;
        else if (n < 0.04) ground[idx] = TILE.GRASS_FLOWERS_BLUE;
        else if (n < 0.06) ground[idx] = TILE.GRASS_LIGHT;
        else if (n < 0.008) ground[idx] = TILE.WATER_STILL;
      } else if (effectiveBiome === "forest") {
        if (n < 0.02) ground[idx] = TILE.GRASS_DARK;
        else if (n < 0.025) ground[idx] = TILE.GRASS_PLAIN;
      } else {
        // village
        if (n < 0.01) ground[idx] = TILE.GRASS_FLOWERS_RED;
        else if (n < 0.02) ground[idx] = TILE.GRASS_FLOWERS_YELLOW;
      }
    }
  }
}

// ── Place trees (world-space noise + biome blending) ─────────────────

function placeTrees(
  ground: number[], overlay: number[], w: number, h: number,
  biome: string, exclusion: boolean[], zoneId: string,
  worldOffTx: number, worldOffTz: number,
): void {
  const s = hashStr("world-tree");

  // Place 2x2 metatile trees (trunk at bottom-center, canopy 2x2 above)
  for (let ty = 2; ty < h - 1; ty += 2) {
    for (let tx = 1; tx < w - 1; tx += 2) {
      const idx = ty * w + tx;
      const wtx = worldOffTx + tx;
      const wtz = worldOffTz + ty;
      const n = seededNoise2D(wtx, wtz, s);

      // Blended density
      let density = biome === "forest" ? 0.08 : biome === "village" ? 0.01 : 0.03;
      let isDark = biome === "forest";

      const adj = findAdjacentBlend(wtx, wtz, zoneId);
      if (adj && adj.distance < BLEND_TILES) {
        const blendWeight = (1.0 - adj.distance / BLEND_TILES) * 0.5;
        const adjDensity = adj.biome === "forest" ? 0.08 : adj.biome === "village" ? 0.01 : 0.03;
        density = density * (1 - blendWeight) + adjDensity * blendWeight;

        // Blend tree type (dark vs normal) probabilistically
        const typeNoise = seededNoise2D(wtx, wtz, s + 9999);
        if (typeNoise < blendWeight) {
          isDark = adj.biome === "forest";
        }
      }

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

  // Scatter individual bushes and rocks (world-space noise + blending)
  const s2 = hashStr("world-scatter");
  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const idx = tz * w + tx;
      if (exclusion[idx]) continue;
      if (overlay[idx] !== TILE.EMPTY) continue;

      const wtx = worldOffTx + tx;
      const wtz = worldOffTz + tz;
      const n = seededNoise2D(wtx, wtz, s2);

      // Determine effective biome (blend near edges)
      let effectiveBiome = biome;
      const adj = findAdjacentBlend(wtx, wtz, zoneId);
      if (adj && adj.distance < BLEND_TILES) {
        const blendWeight = (1.0 - adj.distance / BLEND_TILES) * 0.5;
        const blendNoise = seededNoise2D(wtx, wtz, s2 + 7777);
        if (blendNoise < blendWeight) {
          effectiveBiome = adj.biome;
        }
      }

      if (effectiveBiome === "forest") {
        if (n < 0.02) overlay[idx] = TILE.BUSH;
        else if (n < 0.025) overlay[idx] = TILE.ROCK_SMALL;
        else if (n < 0.04) overlay[idx] = TILE.TALL_GRASS;
      } else if (effectiveBiome === "grassland") {
        if (n < 0.008) overlay[idx] = TILE.BUSH;
        else if (n < 0.012) overlay[idx] = TILE.ROCK_SMALL;
      }
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

// ── Elevation generation (world-space noise + biome blending) ────────

/**
 * 2D value noise for elevation. Uses multi-octave sampling for natural terrain.
 * Returns a value 0.0-1.0 for the given tile coordinates.
 */
function valueNoise2D(tx: number, tz: number, seed: number, scale: number): number {
  // Sample at multiple octaves for natural-looking terrain
  let value = 0;
  let amplitude = 1;
  let totalAmp = 0;

  for (let octave = 0; octave < 3; octave++) {
    const freq = scale * Math.pow(2, octave);
    const sx = tx * freq;
    const sz = tz * freq;

    // Hash-based 2D noise with interpolation
    const ix = Math.floor(sx);
    const iz = Math.floor(sz);
    const fx = sx - ix;
    const fz = sz - iz;

    // Smoothstep for interpolation
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);

    // Corner values
    const n00 = seededNoise2D(ix, iz, seed + octave * 1000);
    const n10 = seededNoise2D(ix + 1, iz, seed + octave * 1000);
    const n01 = seededNoise2D(ix, iz + 1, seed + octave * 1000);
    const n11 = seededNoise2D(ix + 1, iz + 1, seed + octave * 1000);

    // Bilinear interpolation
    const nx0 = n00 + (n10 - n00) * ux;
    const nx1 = n01 + (n11 - n01) * ux;
    const n = nx0 + (nx1 - nx0) * uz;

    value += n * amplitude;
    totalAmp += amplitude;
    amplitude *= 0.5;
  }

  return value / totalAmp;
}

/** 2D seeded noise — deterministic hash for grid position */
function seededNoise2D(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h >>> 0) & 0xffff) / 0xffff;
}

/**
 * Generate elevation map for a zone. Uses world-space value noise with
 * biome-blended profiles for seamless cross-zone terrain.
 *
 * Elevation values:
 *   0 = lowest (valleys, water level)
 *   1 = normal ground
 *   2 = hills
 *   3 = highest (ridges, peaks)
 */
function generateElevation(
  ground: number[],
  w: number,
  h: number,
  biome: string,
  exclusion: boolean[],
  pois: PoiDef[],
  zone: ZoneData,
  worldOffTx: number,
  worldOffTz: number,
): number[] {
  const elevation = new Array(w * h).fill(0);
  const worldSeed = hashStr("world-elev");

  const profile = getElevProfile(biome);

  // Generate raw elevation from world-space noise
  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const idx = tz * w + tx;
      const wtx = worldOffTx + tx;
      const wtz = worldOffTz + tz;

      const n = valueNoise2D(wtx, wtz, worldSeed, profile.noiseScale);
      let elev = Math.floor(n * (profile.maxElev + 1));
      elev = Math.min(elev, profile.maxElev);
      elev = Math.max(elev, 0);
      elev = Math.min(elev + profile.baseElev, 3);

      // Blend elevation with adjacent zone's profile at edges
      const adj = findAdjacentBlend(wtx, wtz, zone.id);
      if (adj && adj.distance < BLEND_TILES) {
        const adjProfile = getElevProfile(adj.biome);
        const adjN = valueNoise2D(wtx, wtz, worldSeed, adjProfile.noiseScale);
        let adjElev = Math.floor(adjN * (adjProfile.maxElev + 1));
        adjElev = Math.min(adjElev, adjProfile.maxElev);
        adjElev = Math.max(adjElev, 0);
        adjElev = Math.min(adjElev + adjProfile.baseElev, 3);

        // Smooth lerp: 0.5 at edge, 0 at BLEND_TILES away
        const blendWeight = (1.0 - adj.distance / BLEND_TILES) * 0.5;
        elev = Math.round(elev * (1 - blendWeight) + adjElev * blendWeight);
      }

      elevation[idx] = elev;
    }
  }

  // Force water tiles to elevation 0
  for (let i = 0; i < w * h; i++) {
    if (ground[i] === TILE.WATER_STILL) {
      elevation[i] = 0;
    }
  }

  // Flatten POI areas (portals, structures, landmarks)
  for (const poi of pois) {
    const cx = Math.floor(poi.position.x / TILE_SIZE);
    const cy = Math.floor(poi.position.z / TILE_SIZE);
    const r = Math.ceil(poi.radius / TILE_SIZE) + 2;

    // Find average elevation around POI center
    let totalElev = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = cx + dx;
        const tz = cy + dy;
        if (tx >= 0 && tx < w && tz >= 0 && tz < h) {
          totalElev += elevation[tz * w + tx];
          count++;
        }
      }
    }
    const avgElev = count > 0 ? Math.round(totalElev / count) : 0;

    // Flatten the POI area to the average
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cy + dy;
        if (tx >= 0 && tx < w && tz >= 0 && tz < h) {
          if (dx * dx + dy * dy <= r * r) {
            elevation[tz * w + tx] = avgElev;
          }
        }
      }
    }
  }

  // Flatten road tiles (any DIRT tile gets flattened to neighbor average)
  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const idx = tz * w + tx;
      const tile = ground[idx];
      if (tile === TILE.DIRT_PLAIN || tile === TILE.DIRT_H || tile === TILE.DIRT_V || tile === TILE.DIRT_CROSS) {
        // Set road tiles to minimum elevation of surroundings for smooth paths
        let minElev = elevation[idx];
        for (let d = -1; d <= 1; d++) {
          for (let e = -1; e <= 1; e++) {
            const nx = tx + d;
            const nz = tz + e;
            if (nx >= 0 && nx < w && nz >= 0 && nz < h) {
              minElev = Math.min(minElev, elevation[nz * w + nx]);
            }
          }
        }
        elevation[idx] = minElev;
      }
    }
  }

  return elevation;
}

// ── Chunk extraction ─────────────────────────────────────────────────

export const CHUNK_SIZE = 64; // tiles per chunk dimension

export interface ChunkPayloadV2 {
  cx: number;
  cz: number;
  zoneId: string;
  ground: number[];
  overlay: number[];
  elevation: number[];
  biome: string;
}

/** Extract a single chunk from a generated map by chunk coordinates */
export function getChunkFromMap(zoneId: string, cx: number, cz: number): ChunkPayloadV2 | null {
  const map = mapCache.get(zoneId);
  if (!map) return null;

  const originTx = cx * CHUNK_SIZE;
  const originTz = cz * CHUNK_SIZE;

  // Check if chunk overlaps the map at all
  if (originTx >= map.width || originTz >= map.height || cx < 0 || cz < 0) return null;

  const ground: number[] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(-1);
  const overlay: number[] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(TILE.EMPTY);
  const elevation: number[] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(0);

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const globalTx = originTx + lx;
      const globalTz = originTz + lz;
      if (globalTx >= map.width || globalTz >= map.height) continue;

      const srcIdx = globalTz * map.width + globalTx;
      const dstIdx = lz * CHUNK_SIZE + lx;
      ground[dstIdx] = map.ground[srcIdx];
      overlay[dstIdx] = map.overlay[srcIdx];
      elevation[dstIdx] = map.elevation[srcIdx];
    }
  }

  return { cx, cz, zoneId, ground, overlay, elevation, biome: map.biome };
}

/** Get chunks in a radius around a world position */
export function getChunksAroundPosition(
  zoneId: string,
  worldX: number,
  worldZ: number,
  radius: number,
): { chunks: ChunkPayloadV2[]; outOfBounds: { cx: number; cz: number }[] } | null {
  const map = mapCache.get(zoneId);
  if (!map) return null;

  const tileX = Math.floor(worldX / TILE_SIZE);
  const tileZ = Math.floor(worldZ / TILE_SIZE);
  const centerCx = Math.floor(tileX / CHUNK_SIZE);
  const centerCz = Math.floor(tileZ / CHUNK_SIZE);

  const chunks: ChunkPayloadV2[] = [];
  const outOfBounds: { cx: number; cz: number }[] = [];

  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = centerCx + dx;
      const cz = centerCz + dz;
      const chunk = getChunkFromMap(zoneId, cx, cz);
      if (chunk) {
        chunks.push(chunk);
      } else {
        outOfBounds.push({ cx, cz });
      }
    }
  }

  return { chunks, outOfBounds };
}

/** Get chunk layout info for a zone */
export function getZoneChunkInfo(zoneId: string): { chunksX: number; chunksZ: number; width: number; height: number } | null {
  const map = mapCache.get(zoneId);
  if (!map) return null;
  return {
    chunksX: Math.ceil(map.width / CHUNK_SIZE),
    chunksZ: Math.ceil(map.height / CHUNK_SIZE),
    width: map.width,
    height: map.height,
  };
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
