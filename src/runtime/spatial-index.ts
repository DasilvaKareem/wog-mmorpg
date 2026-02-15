import type { Vec2 } from "../types/zone.js";
import { TILE_SIZE } from "../types/terrain.js";
import { CHUNK_SIZE } from "../types/chunk.js";

/** Cell size in world units — one chunk's worth of space */
const CELL_SIZE = CHUNK_SIZE * TILE_SIZE;

/** Lightweight positional entry stored in the index */
export interface SpatialEntry<T> {
  item: T;
  position: Vec2;
}

/**
 * Grid-based spatial index for fast radius queries.
 *
 * Divides the world into cells of CELL_SIZE (= 1 chunk in world units).
 * Queries only scan cells that overlap the search radius instead of
 * iterating every entity in the zone.
 */
export class SpatialIndex<T> {
  private cells: Map<string, SpatialEntry<T>[]> = new Map();
  private count = 0;

  /** Insert an item at a world position */
  insert(item: T, position: Vec2): void {
    const key = this.cellKey(position);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push({ item, position });
    this.count++;
  }

  /** Clear all entries (call at the start of each tick before re-inserting) */
  clear(): void {
    this.cells.clear();
    this.count = 0;
  }

  /** Query all items within a radius of a world position */
  queryRadius(center: Vec2, radius: number): T[] {
    const results: T[] = [];
    const r2 = radius * radius;

    // Determine which cells overlap the search circle
    const minCellX = Math.floor((center.x - radius) / CELL_SIZE);
    const maxCellX = Math.floor((center.x + radius) / CELL_SIZE);
    const minCellZ = Math.floor((center.z - radius) / CELL_SIZE);
    const maxCellZ = Math.floor((center.z + radius) / CELL_SIZE);

    for (let gz = minCellZ; gz <= maxCellZ; gz++) {
      for (let gx = minCellX; gx <= maxCellX; gx++) {
        const cell = this.cells.get(`${gx}_${gz}`);
        if (!cell) continue;

        for (const entry of cell) {
          const dx = entry.position.x - center.x;
          const dz = entry.position.z - center.z;
          if (dx * dx + dz * dz <= r2) {
            results.push(entry.item);
          }
        }
      }
    }

    return results;
  }

  /** Get all items in a specific cell (useful for chunk-level operations) */
  getCell(cellX: number, cellZ: number): T[] {
    const cell = this.cells.get(`${cellX}_${cellZ}`);
    return cell ? cell.map(e => e.item) : [];
  }

  /** Number of items in the index */
  get size(): number {
    return this.count;
  }

  /** Number of occupied cells */
  get cellCount(): number {
    return this.cells.size;
  }

  private cellKey(pos: Vec2): string {
    const gx = Math.floor(pos.x / CELL_SIZE);
    const gz = Math.floor(pos.z / CELL_SIZE);
    return `${gx}_${gz}`;
  }
}
