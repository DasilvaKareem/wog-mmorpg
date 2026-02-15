import type { Vec2 } from "../types/zone.js";
import {
  TILE_SIZE,
  TERRAIN_CATALOG,
  type TerrainType,
  type TerrainGridData,
  type TileInfo,
} from "../types/terrain.js";
import {
  CHUNK_SIZE,
  chunkKey,
  tileToChunk,
  chunkOrigin,
  type ChunkData,
  type ChunkPayload,
  type ChunkState,
} from "../types/chunk.js";

export class TerrainGrid {
  readonly zoneId: string;
  /** Total width of the zone in tiles */
  readonly width: number;
  /** Total height of the zone in tiles */
  readonly height: number;

  /** Chunk storage: key = "cx_cz" → ChunkData */
  private chunks: Map<string, ChunkData> = new Map();
  /** Runtime state overlays per chunk (diffs from base) */
  private chunkStates: Map<string, ChunkState> = new Map();

  constructor(data: TerrainGridData) {
    this.zoneId = data.zoneId;
    this.width = data.width;
    this.height = data.height;
    this.importFromFlatArray(data.tiles);
  }

  // ─── Chunk management ──────────────────────────────────────────────

  /** Break a flat tile array into chunk storage */
  private importFromFlatArray(tiles: TerrainType[]): void {
    // Determine how many chunks we span
    const chunksX = Math.ceil(this.width / CHUNK_SIZE);
    const chunksZ = Math.ceil(this.height / CHUNK_SIZE);

    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunkTiles: TerrainType[] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill("grass");
        const origin = chunkOrigin(cx, cz);

        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const globalTx = origin.tx + lx;
            const globalTz = origin.tz + lz;
            if (globalTx < this.width && globalTz < this.height) {
              chunkTiles[lz * CHUNK_SIZE + lx] = tiles[globalTz * this.width + globalTx];
            }
          }
        }

        this.chunks.set(chunkKey(cx, cz), { cx, cz, tiles: chunkTiles });
      }
    }
  }

  /** Get a loaded chunk, or null if it doesn't exist */
  getChunk(cx: number, cz: number): ChunkData | null {
    return this.chunks.get(chunkKey(cx, cz)) ?? null;
  }

  /** Check if a chunk coordinate is within zone bounds */
  isChunkInBounds(cx: number, cz: number): boolean {
    const origin = chunkOrigin(cx, cz);
    // Chunk is in bounds if its origin overlaps with the zone tile grid
    return origin.tx < this.width && origin.tz < this.height && cx >= 0 && cz >= 0;
  }

  /** Get all loaded chunk keys */
  getLoadedChunkKeys(): string[] {
    return Array.from(this.chunks.keys());
  }

  /** Total number of chunks spanning this zone */
  get chunksX(): number {
    return Math.ceil(this.width / CHUNK_SIZE);
  }

  get chunksZ(): number {
    return Math.ceil(this.height / CHUNK_SIZE);
  }

  // ─── Chunk state (diffs) ───────────────────────────────────────────

  /** Get the state overlay for a chunk */
  getChunkState(cx: number, cz: number): ChunkState | null {
    return this.chunkStates.get(chunkKey(cx, cz)) ?? null;
  }

  /** Apply a tile modification to a chunk's state overlay */
  setTileDiff(tx: number, tz: number, terrain: TerrainType): void {
    const { cx, cz } = tileToChunk(tx, tz);
    const key = chunkKey(cx, cz);
    const origin = chunkOrigin(cx, cz);
    const localTx = tx - origin.tx;
    const localTz = tz - origin.tz;

    let state = this.chunkStates.get(key);
    if (!state) {
      state = { cx, cz, tileDiffs: [], objectStates: {} };
      this.chunkStates.set(key, state);
    }

    // Update the actual chunk tile data
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.tiles[localTz * CHUNK_SIZE + localTx] = terrain;
    }

    // Record the diff
    const existing = state.tileDiffs.find(d => d.localTx === localTx && d.localTz === localTz);
    if (existing) {
      existing.terrain = terrain;
    } else {
      state.tileDiffs.push({ localTx, localTz, terrain });
    }
  }

  /** Build a ChunkPayload for streaming to clients */
  getChunkPayload(cx: number, cz: number): ChunkPayload | null {
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return null;

    const state = this.getChunkState(cx, cz);
    const objects = state ? Object.values(state.objectStates) : [];

    return {
      cx,
      cz,
      zoneId: this.zoneId,
      tiles: [...chunk.tiles],
      objects,
    };
  }

  /** Get chunk payloads in a radius around a world position */
  getChunksAround(worldX: number, worldZ: number, radius: number): {
    chunks: ChunkPayload[];
    outOfBounds: Array<{ cx: number; cz: number }>;
  } {
    const { tx, tz } = this.worldToTile({ x: worldX, z: worldZ });
    const { cx: centerCx, cz: centerCz } = tileToChunk(tx, tz);

    const chunks: ChunkPayload[] = [];
    const outOfBounds: Array<{ cx: number; cz: number }> = [];

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = centerCx + dx;
        const cz = centerCz + dz;

        if (!this.isChunkInBounds(cx, cz)) {
          outOfBounds.push({ cx, cz });
          continue;
        }

        const payload = this.getChunkPayload(cx, cz);
        if (payload) {
          chunks.push(payload);
        } else {
          outOfBounds.push({ cx, cz });
        }
      }
    }

    return { chunks, outOfBounds };
  }

  // ─── Tile access (same public API as before) ──────────────────────

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
    const type = this.tileAt(tx, tz);
    if (type === null) return false;
    return TERRAIN_CATALOG[type].walkable;
  }

  /** Get movement cost multiplier at a world position */
  getMovementCost(pos: Vec2): number {
    const { tx, tz } = this.worldToTile(pos);
    const type = this.tileAt(tx, tz);
    if (type === null) return 1.0;
    return TERRAIN_CATALOG[type].movementCost;
  }

  /** Get full tile info at a world position */
  getTileInfo(pos: Vec2): TileInfo | null {
    const { tx, tz } = this.worldToTile(pos);
    const type = this.tileAt(tx, tz);
    if (type === null) return null;
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
        const type = this.tileAt(tx, tz);
        if (type === null) continue;
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

    // Resolve via chunk storage
    const { cx, cz } = tileToChunk(tx, tz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return null;

    const origin = chunkOrigin(cx, cz);
    const localTx = tx - origin.tx;
    const localTz = tz - origin.tz;
    return chunk.tiles[localTz * CHUNK_SIZE + localTx];
  }

  /** Serialize back to JSON-compatible data (flat array for backward compat) */
  toData(): TerrainGridData {
    const tiles: TerrainType[] = new Array(this.width * this.height).fill("grass");

    for (const chunk of this.chunks.values()) {
      const origin = chunkOrigin(chunk.cx, chunk.cz);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const globalTx = origin.tx + lx;
          const globalTz = origin.tz + lz;
          if (globalTx < this.width && globalTz < this.height) {
            tiles[globalTz * this.width + globalTx] = chunk.tiles[lz * CHUNK_SIZE + lx];
          }
        }
      }
    }

    return {
      zoneId: this.zoneId,
      width: this.width,
      height: this.height,
      tileSize: TILE_SIZE,
      tiles,
    };
  }
}
