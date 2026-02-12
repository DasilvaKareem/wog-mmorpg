import type { Vec2 } from "../types/zone.js";
import {
  TILE_SIZE,
  TERRAIN_CATALOG,
  type TerrainType,
  type TerrainGridData,
  type TileInfo,
} from "../types/terrain.js";

export class TerrainGrid {
  readonly zoneId: string;
  readonly width: number;
  readonly height: number;
  private tiles: TerrainType[];

  constructor(data: TerrainGridData) {
    this.zoneId = data.zoneId;
    this.width = data.width;
    this.height = data.height;
    this.tiles = data.tiles;
  }

  /** Convert world position to tile coordinate */
  worldToTile(pos: Vec2): { tx: number; tz: number } {
    return {
      tx: Math.floor(pos.x / TILE_SIZE),
      tz: Math.floor(pos.z / TILE_SIZE),
    };
  }

  /** Convert tile coordinate to world position (center of tile) */
  tileToWorld(tx: number, tz: number): Vec2 {
    return {
      x: tx * TILE_SIZE + TILE_SIZE / 2,
      z: tz * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  /** Check if a world position is on a walkable tile */
  isWalkable(pos: Vec2): boolean {
    const { tx, tz } = this.worldToTile(pos);
    if (tx < 0 || tx >= this.width || tz < 0 || tz >= this.height) return false;
    const type = this.tiles[tz * this.width + tx];
    return TERRAIN_CATALOG[type].walkable;
  }

  /** Get movement cost multiplier at a world position */
  getMovementCost(pos: Vec2): number {
    const { tx, tz } = this.worldToTile(pos);
    if (tx < 0 || tx >= this.width || tz < 0 || tz >= this.height) return 1.0;
    const type = this.tiles[tz * this.width + tx];
    return TERRAIN_CATALOG[type].movementCost;
  }

  /** Get full tile info at a world position */
  getTileInfo(pos: Vec2): TileInfo | null {
    const { tx, tz } = this.worldToTile(pos);
    if (tx < 0 || tx >= this.width || tz < 0 || tz >= this.height) return null;
    const type = this.tiles[tz * this.width + tx];
    const props = TERRAIN_CATALOG[type];
    return { tx, tz, terrain: type, walkable: props.walkable, movementCost: props.movementCost, label: props.label };
  }

  /** Get a rectangular sub-grid of tile info */
  getRegion(fromTx: number, fromTz: number, toTx: number, toTz: number): TileInfo[] {
    const result: TileInfo[] = [];
    const minTx = Math.max(0, fromTx);
    const maxTx = Math.min(this.width - 1, toTx);
    const minTz = Math.max(0, fromTz);
    const maxTz = Math.min(this.height - 1, toTz);

    for (let tz = minTz; tz <= maxTz; tz++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const type = this.tiles[tz * this.width + tx];
        const props = TERRAIN_CATALOG[type];
        result.push({ tx, tz, terrain: type, walkable: props.walkable, movementCost: props.movementCost, label: props.label });
      }
    }
    return result;
  }

  /** Clamp position to zone bounds, then BFS to nearest walkable tile if on impassable */
  clampToWalkable(pos: Vec2): Vec2 {
    // Clamp to grid bounds in world space
    const maxX = this.width * TILE_SIZE;
    const maxZ = this.height * TILE_SIZE;
    const clamped: Vec2 = {
      x: Math.max(0, Math.min(maxX - 1, pos.x)),
      z: Math.max(0, Math.min(maxZ - 1, pos.z)),
    };

    if (this.isWalkable(clamped)) return clamped;

    // BFS from current tile to find nearest walkable
    const { tx: startTx, tz: startTz } = this.worldToTile(clamped);
    const visited = new Set<string>();
    const queue: Array<{ tx: number; tz: number }> = [{ tx: startTx, tz: startTz }];
    visited.add(`${startTx},${startTz}`);

    const dirs = [
      { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
      { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
      { dx: 1, dz: 1 }, { dx: -1, dz: 1 },
      { dx: 1, dz: -1 }, { dx: -1, dz: -1 },
    ];

    while (queue.length > 0) {
      const { tx, tz } = queue.shift()!;
      const type = this.tileAt(tx, tz);
      if (type !== null && TERRAIN_CATALOG[type].walkable) {
        return this.tileToWorld(tx, tz);
      }

      for (const { dx, dz } of dirs) {
        const nx = tx + dx;
        const nz = tz + dz;
        const key = `${nx},${nz}`;
        if (nx >= 0 && nx < this.width && nz >= 0 && nz < this.height && !visited.has(key)) {
          visited.add(key);
          queue.push({ tx: nx, tz: nz });
        }
      }
    }

    // Fallback (shouldn't happen unless entire grid is impassable)
    return clamped;
  }

  /** Get terrain type at tile coordinates, or null if out of bounds */
  tileAt(tx: number, tz: number): TerrainType | null {
    if (tx < 0 || tx >= this.width || tz < 0 || tz >= this.height) return null;
    return this.tiles[tz * this.width + tx];
  }

  /** Serialize back to JSON-compatible data */
  toData(): TerrainGridData {
    return {
      zoneId: this.zoneId,
      width: this.width,
      height: this.height,
      tileSize: TILE_SIZE,
      tiles: [...this.tiles],
    };
  }
}
