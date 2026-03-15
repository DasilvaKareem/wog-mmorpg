import type { TerrainData } from "../types.js";

/**
 * Overlay tile indices that block movement.
 * Matches the tile sets in TerrainRenderer.
 */
const BLOCKED_OVERLAY = new Set([
  // Walls / doors
  24, 25, 26, 27, 28, 30, 31, 32, 33,
  // Trees
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  // Rocks
  50, 51,
  // Fences
  58, 59,
]);

/** Ground tiles that block movement */
const BLOCKED_GROUND = new Set([
  // Deep water
  16, 17, 18, 19, 20, 21, 22, 23,
]);

/**
 * Tile-based walkability grid for a single zone.
 * Built from TerrainData, provides O(1) collision checks.
 */
export class CollisionMap {
  /** 0 = walkable, 1 = blocked */
  private grid: Uint8Array;
  readonly width: number;
  readonly height: number;

  constructor(data: TerrainData) {
    this.width = data.width;
    this.height = data.height;
    this.grid = new Uint8Array(this.width * this.height);

    for (let i = 0; i < this.width * this.height; i++) {
      const overlay = data.overlay[i] ?? -1;
      const ground = data.ground[i] ?? 0;

      if (
        (overlay >= 0 && BLOCKED_OVERLAY.has(overlay)) ||
        BLOCKED_GROUND.has(ground)
      ) {
        this.grid[i] = 1;
      }
    }
  }

  /** Check if a tile is walkable (local tile coords, 0-based integers) */
  isWalkableTile(tx: number, tz: number): boolean {
    if (tx < 0 || tx >= this.width || tz < 0 || tz >= this.height) return false;
    return this.grid[tz * this.width + tx] === 0;
  }

  /** Check if a position is walkable (local 3D coords within zone, float) */
  isWalkable(localX: number, localZ: number): boolean {
    const tx = Math.floor(localX);
    const tz = Math.floor(localZ);
    return this.isWalkableTile(tx, tz);
  }
}
