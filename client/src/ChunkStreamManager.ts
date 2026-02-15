import type { ChunkPayloadV2 } from "./types.js";
import { fetchChunkAt } from "./ShardClient.js";

/** Chunk size in tiles (must match server CHUNK_SIZE) */
export const CHUNK_SIZE = 64;

/** How many chunks to load in each direction around the camera center */
export const STREAM_RADIUS = 2;

/** How far beyond stream radius before unloading (prevents thrashing at edges) */
const UNLOAD_RADIUS = STREAM_RADIUS + 1;

function chunkKey(cx: number, cz: number): string {
  return `${cx}_${cz}`;
}

export interface LoadedChunk {
  cx: number;
  cz: number;
  zoneId: string;
  payload: ChunkPayloadV2;
}

/**
 * Manages loading and unloading of terrain chunks as the camera moves.
 *
 * The manager tracks which chunks are loaded and triggers callbacks when
 * chunks need to be created or destroyed in the renderer.
 */
export class ChunkStreamManager {
  private loaded: Map<string, LoadedChunk> = new Map();
  private loading: Set<string> = new Set();
  private zoneId: string;
  private tileSize: number;

  /** Called when a new chunk is loaded and needs to be rendered */
  onChunkLoaded: ((chunk: LoadedChunk) => void) | null = null;
  /** Called when a chunk should be removed from the renderer */
  onChunkUnloaded: ((cx: number, cz: number) => void) | null = null;

  /** Last chunk coord the camera was in (used to detect movement across chunk boundaries) */
  private lastCameraCx = -9999;
  private lastCameraCz = -9999;

  constructor(zoneId: string, tileSize: number) {
    this.zoneId = zoneId;
    this.tileSize = tileSize;
  }

  /** Switch to a different zone — clears all loaded chunks */
  setZone(zoneId: string): void {
    if (zoneId === this.zoneId) return;
    this.zoneId = zoneId;
    this.unloadAll();
    this.lastCameraCx = -9999;
    this.lastCameraCz = -9999;
  }

  /** Unload all chunks and notify renderer */
  unloadAll(): void {
    for (const [, chunk] of this.loaded) {
      this.onChunkUnloaded?.(chunk.cx, chunk.cz);
    }
    this.loaded.clear();
    this.loading.clear();
  }

  /**
   * Called every frame (or on camera move) with the camera's world position.
   * Determines which chunks should be loaded/unloaded.
   */
  update(cameraWorldX: number, cameraWorldZ: number): void {
    const chunkWorldSize = CHUNK_SIZE * this.tileSize;
    const cameraCx = Math.floor(cameraWorldX / chunkWorldSize);
    const cameraCz = Math.floor(cameraWorldZ / chunkWorldSize);

    // Only re-evaluate if camera moved to a different chunk
    if (cameraCx === this.lastCameraCx && cameraCz === this.lastCameraCz) return;
    this.lastCameraCx = cameraCx;
    this.lastCameraCz = cameraCz;

    // Determine which chunks should be loaded
    const needed = new Set<string>();
    for (let dz = -STREAM_RADIUS; dz <= STREAM_RADIUS; dz++) {
      for (let dx = -STREAM_RADIUS; dx <= STREAM_RADIUS; dx++) {
        const cx = cameraCx + dx;
        const cz = cameraCz + dz;
        if (cx < 0 || cz < 0) continue; // No negative chunks
        needed.add(chunkKey(cx, cz));
      }
    }

    // Load missing chunks
    for (const key of needed) {
      if (!this.loaded.has(key) && !this.loading.has(key)) {
        const [cxStr, czStr] = key.split("_");
        const cx = parseInt(cxStr, 10);
        const cz = parseInt(czStr, 10);
        void this.loadChunk(cx, cz);
      }
    }

    // Unload chunks that are too far away
    for (const [key, chunk] of this.loaded) {
      const dx = Math.abs(chunk.cx - cameraCx);
      const dz = Math.abs(chunk.cz - cameraCz);
      if (dx > UNLOAD_RADIUS || dz > UNLOAD_RADIUS) {
        this.loaded.delete(key);
        this.onChunkUnloaded?.(chunk.cx, chunk.cz);
      }
    }
  }

  private async loadChunk(cx: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cz);
    this.loading.add(key);

    const payload = await fetchChunkAt(this.zoneId, cx, cz);
    this.loading.delete(key);

    if (!payload) return; // Chunk doesn't exist (out of zone bounds)

    const chunk: LoadedChunk = { cx, cz, zoneId: this.zoneId, payload };
    this.loaded.set(key, chunk);
    this.onChunkLoaded?.(chunk);
  }

  /** Check if a chunk is loaded */
  isLoaded(cx: number, cz: number): boolean {
    return this.loaded.has(chunkKey(cx, cz));
  }

  /** Get a loaded chunk */
  getChunk(cx: number, cz: number): LoadedChunk | undefined {
    return this.loaded.get(chunkKey(cx, cz));
  }

  /** Number of currently loaded chunks */
  get loadedCount(): number {
    return this.loaded.size;
  }

  get currentZoneId(): string {
    return this.zoneId;
  }
}
