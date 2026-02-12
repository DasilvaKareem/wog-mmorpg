import type { Zone, Vec2 } from "../types/zone.js";
import { TILE_SIZE, type TerrainType, type TerrainGridData } from "../types/terrain.js";
import { ZONE_ORE_TABLES, ORE_CATALOG, type OreType, type OreDepositData } from "../types/ore.js";

/** Seeded PRNG (mulberry32) for deterministic terrain per zone */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple hash for zone id → seed number */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

const ZONE_DEFAULTS: Record<string, TerrainType> = {
  "village-square": "stone",
  "wild-meadow": "grass",
  "dark-forest": "forest",
};

const OBSTACLE_TYPES: TerrainType[] = ["water", "rock", "mud"];
const OBSTACLE_RATE = 0.02;

export function generateTerrainGrid(zone: Zone): TerrainGridData {
  const boundsW = zone.bounds.max.x - zone.bounds.min.x;
  const boundsH = zone.bounds.max.z - zone.bounds.min.z;
  const width = Math.floor(boundsW / TILE_SIZE);
  const height = Math.floor(boundsH / TILE_SIZE);

  const defaultType = ZONE_DEFAULTS[zone.id] ?? "grass";
  const tiles: TerrainType[] = new Array(width * height).fill(defaultType);
  const rng = mulberry32(hashString(zone.id));

  // Paint stone circles around structures and portals
  for (const poi of zone.pois) {
    if (poi.type === "structure" || poi.type === "portal") {
      paintCircle(tiles, width, height, zone.bounds.min, poi.position, poi.radius, "stone");
    }
  }

  // Paint grass clearings at landmarks (only in non-grass zones)
  if (defaultType !== "grass") {
    for (const poi of zone.pois) {
      if (poi.type === "landmark") {
        paintCircle(tiles, width, height, zone.bounds.min, poi.position, poi.radius, "grass");
      }
    }
  }

  // Paint dirt roads along road connections (Bresenham line, 2-tile brush)
  for (const road of zone.roads) {
    for (let i = 0; i < road.nodes.length - 1; i++) {
      const fromPoi = zone.pois.find((p) => p.id === road.nodes[i]);
      const toPoi = zone.pois.find((p) => p.id === road.nodes[i + 1]);
      if (!fromPoi || !toPoi) continue;
      paintRoad(tiles, width, height, zone.bounds.min, fromPoi.position, toPoi.position);
    }
  }

  // Scatter ~2% obstacles on default tiles only
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === defaultType && rng() < OBSTACLE_RATE) {
      tiles[i] = OBSTACLE_TYPES[Math.floor(rng() * OBSTACLE_TYPES.length)];
    }
  }

  return { zoneId: zone.id, width, height, tileSize: TILE_SIZE, tiles };
}

function worldToTile(worldPos: Vec2, boundsMin: Vec2): { tx: number; tz: number } {
  return {
    tx: Math.floor((worldPos.x - boundsMin.x) / TILE_SIZE),
    tz: Math.floor((worldPos.z - boundsMin.z) / TILE_SIZE),
  };
}

function setTile(tiles: TerrainType[], width: number, height: number, tx: number, tz: number, type: TerrainType): void {
  if (tx >= 0 && tx < width && tz >= 0 && tz < height) {
    tiles[tz * width + tx] = type;
  }
}

function paintCircle(
  tiles: TerrainType[], width: number, height: number,
  boundsMin: Vec2, center: Vec2, radius: number, type: TerrainType,
): void {
  const { tx: cx, tz: cz } = worldToTile(center, boundsMin);
  const tileRadius = Math.ceil(radius / TILE_SIZE);

  for (let dz = -tileRadius; dz <= tileRadius; dz++) {
    for (let dx = -tileRadius; dx <= tileRadius; dx++) {
      if (dx * dx + dz * dz <= tileRadius * tileRadius) {
        setTile(tiles, width, height, cx + dx, cz + dz, type);
      }
    }
  }
}

function paintRoad(
  tiles: TerrainType[], width: number, height: number,
  boundsMin: Vec2, from: Vec2, to: Vec2,
): void {
  const { tx: x0, tz: z0 } = worldToTile(from, boundsMin);
  const { tx: x1, tz: z1 } = worldToTile(to, boundsMin);

  // Bresenham's line algorithm
  let dx = Math.abs(x1 - x0);
  let dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  let cx = x0;
  let cz = z0;

  while (true) {
    // 2-tile brush: paint current tile and neighbors
    for (let bz = -1; bz <= 1; bz++) {
      for (let bx = -1; bx <= 1; bx++) {
        if (Math.abs(bx) + Math.abs(bz) <= 1) { // diamond brush
          setTile(tiles, width, height, cx + bx, cz + bz, "dirt");
        }
      }
    }

    if (cx === x1 && cz === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) { err -= dz; cx += sx; }
    if (e2 < dx) { err += dx; cz += sz; }
  }
}

/**
 * Scatter ore deposits on rock tiles based on per-zone ore tables.
 * Uses the same deterministic PRNG seeded from zoneId + "ores" salt.
 */
export function generateOreDeposits(
  zone: Zone,
  tiles: TerrainType[],
  width: number,
  height: number,
): OreDepositData[] {
  const table = ZONE_ORE_TABLES[zone.id];
  if (!table || Object.keys(table).length === 0) return [];

  const rng = mulberry32(hashString(zone.id + ":ores"));
  const deposits: OreDepositData[] = [];

  // Build weighted entries: [ [oreType, cumulativeWeight], ... ]
  const entries: Array<{ ore: OreType; weight: number }> = [];
  let totalWeight = 0;
  for (const [ore, rate] of Object.entries(table) as Array<[OreType, number]>) {
    entries.push({ ore, weight: rate });
    totalWeight += rate;
  }

  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const terrain = tiles[tz * width + tx];
      if (terrain !== "rock") continue;

      // Roll against total weight to decide if this rock tile gets an ore
      const roll = rng();
      if (roll >= totalWeight) continue;

      // Determine which ore type
      let cumulative = 0;
      for (const entry of entries) {
        cumulative += entry.weight;
        if (roll < cumulative) {
          deposits.push({ oreType: entry.ore, tx, tz });
          break;
        }
      }
    }
  }

  return deposits;
}
