import type { ChunkPayloadV2 } from "./types.js";
import { fetchChunkAt } from "./ShardClient.js";
import type { WorldLayoutData } from "./WorldLayoutManager.js";

/** Chunk size in tiles (must match server CHUNK_SIZE) */
export const CHUNK_SIZE = 64;

/** How many chunks to load in each direction around the camera center */
export const STREAM_RADIUS = 2;

/** How far beyond stream radius before unloading (prevents thrashing at edges) */
const UNLOAD_RADIUS = STREAM_RADIUS + 1;

function chunkKey(zoneId: string, cx: number, cz: number): string {
  return `${zoneId}_${cx}_${cz}`;
}

export interface LoadedChunk {
  cx: number;
  cz: number;
  zoneId: string;
  payload: ChunkPayloadV2;
}

interface ZoneChunkBounds {
  id: string;
  /** Zone offset in game units */
  offsetX: number;
  offsetZ: number;
  /** Zone size in tiles */
  tilesW: number;
  tilesH: number;
  /** Zone size in chunks */
  chunksW: number;
  chunksH: number;
}

/**
 * Manages loading and unloading of terrain chunks across multiple zones
 * as the camera moves through the seamless world.
 */
export class ChunkStreamManager {
  private loaded: Map<string, LoadedChunk> = new Map();
  private loading: Set<string> = new Set();
  private tileSize: number;
  private zones: ZoneChunkBounds[] = [];

  /** Called when a new chunk is loaded and needs to be rendered */
  onChunkLoaded: ((chunk: LoadedChunk) => void) | null = null;
  /** Called when a chunk should be removed from the renderer */
  onChunkUnloaded: ((key: string) => void) | null = null;

  /** Last camera chunk coord (used to detect movement across chunk boundaries) */
  private lastCameraCx = -9999;
  private lastCameraCz = -9999;

  constructor(worldLayout: WorldLayoutData, tileSize: number) {
    this.tileSize = tileSize;

    // Build zone chunk bounds from layout
    for (const zone of Object.values(worldLayout.zones)) {
      const tilesW = Math.ceil(zone.size.width / tileSize) || 1;
      const tilesH = Math.ceil(zone.size.height / tileSize) || 1;
      this.zones.push({
        id: zone.id,
        offsetX: zone.offset.x,
        offsetZ: zone.offset.z,
        tilesW,
        tilesH,
        chunksW: Math.ceil(tilesW / CHUNK_SIZE),
        chunksH: Math.ceil(tilesH / CHUNK_SIZE),
      });
    }
  }

  /** Unload all chunks and notify renderer */
  unloadAll(): void {
    for (const key of this.loaded.keys()) {
      this.onChunkUnloaded?.(key);
    }
    this.loaded.clear();
    this.loading.clear();
  }

  /**
   * Called every frame with the camera's world position (in game units).
   * Determines which chunks across all zones should be loaded/unloaded.
   */
  update(cameraWorldX: number, cameraWorldZ: number): void {
    const chunkWorldSize = CHUNK_SIZE * this.tileSize;
    const cameraCx = Math.floor(cameraWorldX / chunkWorldSize);
    const cameraCz = Math.floor(cameraWorldZ / chunkWorldSize);

    // Only re-evaluate if camera moved to a different chunk
    if (cameraCx === this.lastCameraCx && cameraCz === this.lastCameraCz) return;
    this.lastCameraCx = cameraCx;
    this.lastCameraCz = cameraCz;

    // Collect all needed chunk keys across all zones
    const needed = new Set<string>();

    for (const zone of this.zones) {
      // Convert camera world position to zone-local chunk coords
      const localX = cameraWorldX - zone.offsetX;
      const localZ = cameraWorldZ - zone.offsetZ;
      const zoneCameraCx = Math.floor(localX / chunkWorldSize);
      const zoneCameraCz = Math.floor(localZ / chunkWorldSize);

      for (let dz = -STREAM_RADIUS; dz <= STREAM_RADIUS; dz++) {
        for (let dx = -STREAM_RADIUS; dx <= STREAM_RADIUS; dx++) {
          const cx = zoneCameraCx + dx;
          const cz = zoneCameraCz + dz;

          // Skip chunks outside zone tile bounds
          if (cx < 0 || cz < 0) continue;
          if (cx >= zone.chunksW || cz >= zone.chunksH) continue;

          needed.add(chunkKey(zone.id, cx, cz));
        }
      }
    }

    // Load missing chunks
    for (const key of needed) {
      if (!this.loaded.has(key) && !this.loading.has(key)) {
        const [zoneId, cxStr, czStr] = key.split("_");
        const cx = parseInt(cxStr, 10);
        const cz = parseInt(czStr, 10);
        void this.loadChunk(zoneId, cx, cz);
      }
    }

    // Unload chunks that are no longer needed
    for (const key of this.loaded.keys()) {
      if (!needed.has(key)) {
        this.loaded.delete(key);
        this.onChunkUnloaded?.(key);
      }
    }
  }

  private async loadChunk(zoneId: string, cx: number, cz: number): Promise<void> {
    const key = chunkKey(zoneId, cx, cz);
    this.loading.add(key);

    const payload = await fetchChunkAt(zoneId, cx, cz);
    this.loading.delete(key);

    if (!payload) return; // Chunk doesn't exist

    const chunk: LoadedChunk = { cx, cz, zoneId, payload };
    this.loaded.set(key, chunk);
    this.onChunkLoaded?.(chunk);
  }

  /** Number of currently loaded chunks */
  get loadedCount(): number {
    return this.loaded.size;
  }
}
