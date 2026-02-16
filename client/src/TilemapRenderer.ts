import Phaser from "phaser";
import type { TerrainGridDataV2 } from "./types.js";
import { fetchTerrainGridV2 } from "./ShardClient.js";
import { CLIENT_TILE_PX } from "./config.js";
import { createTileAtlas, TILE } from "./TileAtlas.js";
import {
  isOverworldLoaded,
  mapOldTileToOverworld,
  OVERWORLD_KEY,
  OVERWORLD_TILE_PX,
  OVERWORLD_COLS,
  OW_TILES,
} from "./OverworldAtlas.js";
import { generateCliffLayer } from "./ElevationAutoTiler.js";
import type { LoadedChunk } from "./ChunkStreamManager.js";
import { CHUNK_SIZE } from "./ChunkStreamManager.js";
import type { WorldLayoutManager } from "./WorldLayoutManager.js";

function chunkKey(zoneId: string, cx: number, cz: number): string {
  return `${zoneId}_${cx}_${cz}`;
}

/** Elevation tint values: lower elevations are darker, higher are brighter */
const ELEVATION_TINTS: Record<number, number> = {
  0: 0xbbbbbb,  // shadowed (lowest)
  1: 0xdddddd,  // slightly dim
  2: 0xffffff,  // full brightness
  3: 0xffffff,  // full brightness
};

/** Extra tilemap layer for cliff edge rendering */
interface ElevationLayer {
  map: Phaser.Tilemaps.Tilemap;
  layer: Phaser.Tilemaps.TilemapLayer;
}

/** Per-chunk tilemap layers stored in the renderer */
interface ChunkVisual {
  cx: number;
  cz: number;
  groundMap: Phaser.Tilemaps.Tilemap;
  groundLayer: Phaser.Tilemaps.TilemapLayer;
  overlayMap: Phaser.Tilemaps.Tilemap;
  overlayLayer: Phaser.Tilemaps.TilemapLayer;
  cliffLayer: ElevationLayer | null;
  waterPositions: { x: number; y: number }[];
  /** Per-tile elevation for entity depth sorting */
  elevation: number[] | null;
}

/**
 * Renders zone terrain using Phaser native tilemaps with the programmatic
 * tile atlas. Supports both legacy full-zone loading and chunked streaming.
 *
 * In chunk mode, each chunk is an independent tilemap positioned at the
 * correct pixel offset. Chunks can be added/removed dynamically.
 */
export class TilemapRenderer {
  private scene: Phaser.Scene;
  private waterTimer: Phaser.Time.TimerEvent | null = null;
  private waterFrame = 0;

  /** Which tileset is active: "overworld" for real art, "tile-atlas" for procedural */
  private activeTileset: "overworld" | "tile-atlas" = "tile-atlas";

  /** Chunk mode: individual tilemaps per chunk */
  private chunkVisuals: Map<string, ChunkVisual> = new Map();

  /** Legacy mode: single tilemap for whole zone */
  private tilemap: Phaser.Tilemaps.Tilemap | null = null;
  private groundLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private overlayLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private waterPositions: { x: number; y: number }[] = [];

  /** Scale factor: multiply server world coords by this to get pixel coords */
  coordScale = 1;
  /** Pixel dimensions of the rendered world (legacy mode only) */
  worldPixelW = 0;
  worldPixelH = 0;

  /** World layout for zone offsets in multi-zone mode */
  private worldLayout: WorldLayoutManager | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Set the world layout manager for multi-zone chunk positioning */
  setWorldLayout(layout: WorldLayoutManager): void {
    this.worldLayout = layout;
  }

  // ─── Chunk streaming mode ──────────────────────────────────────────

  /** Initialize chunk streaming mode */
  initChunkMode(tileSize: number): void {
    this.destroyAll();
    this.coordScale = tileSize > 0 ? CLIENT_TILE_PX / tileSize : 1.6;

    // Prefer overworld tileset if loaded, fall back to procedural atlas
    if (isOverworldLoaded(this.scene)) {
      this.activeTileset = "overworld";
      const tex = this.scene.textures.get(OVERWORLD_KEY);
      const src = tex.source[0];
      console.log(`[TilemapRenderer] Using Overworld.png tileset (${src.width}x${src.height}, ${OVERWORLD_COLS} cols, GRASS_PLAIN=${OW_TILES.GRASS_PLAIN})`);
    } else {
      this.activeTileset = "tile-atlas";
      createTileAtlas(this.scene);
      console.log("[TilemapRenderer] Overworld not loaded, using procedural atlas");
    }

    // Start water animation timer
    this.waterTimer = this.scene.time.addEvent({
      delay: 500,
      callback: this.animateWaterAll,
      callbackScope: this,
      loop: true,
    });
  }

  /** Add a loaded chunk to the renderer */
  addChunk(chunk: LoadedChunk): void {
    const key = chunkKey(chunk.zoneId, chunk.cx, chunk.cz);
    if (this.chunkVisuals.has(key)) return;

    const useOverworld = this.activeTileset === "overworld";
    const T = CLIENT_TILE_PX;

    // Include zone world offset for multi-zone positioning
    const zoneOffset = this.worldLayout
      ? this.worldLayout.getZonePixelOffset(chunk.zoneId)
      : { x: 0, z: 0 };
    const offsetX = zoneOffset.x + chunk.cx * CHUNK_SIZE * T;
    const offsetY = zoneOffset.z + chunk.cz * CHUNK_SIZE * T;

    const groundData: number[][] = [];
    const overlayData: number[][] = [];
    const waterPos: { x: number; y: number }[] = [];

    // Get elevation data (may be undefined for old payloads)
    const elevation = chunk.payload.elevation;
    const hasElevation = useOverworld && elevation && elevation.length === CHUNK_SIZE * CHUNK_SIZE;

    // Fallback for unmapped tiles: use grass instead of tile 0 (water)
    const fallbackGround = useOverworld ? OW_TILES.GRASS_PLAIN : 0;

    for (let y = 0; y < CHUNK_SIZE; y++) {
      const groundRow: number[] = [];
      const overlayRow: number[] = [];
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = y * CHUNK_SIZE + x;
        const g = chunk.payload.ground[idx];
        const gMapped = useOverworld ? mapOldTileToOverworld(g) : g;
        groundRow.push(g === -1 ? -1 : (gMapped >= 0 ? gMapped : fallbackGround));
        const o = chunk.payload.overlay[idx];
        const oMapped = useOverworld && o >= 0 ? mapOldTileToOverworld(o) : o;
        overlayRow.push(oMapped >= 0 ? oMapped : -1);
        if (g === TILE.WATER_STILL) {
          waterPos.push({ x, y });
        }
      }
      groundData.push(groundRow);
      overlayData.push(overlayRow);
    }

    const tilesetKey = useOverworld ? OVERWORLD_KEY : "tile-atlas";

    // Debug: log first chunk's tile data
    if (this.chunkVisuals.size === 0) {
      const sampleGround = groundData[0]?.slice(0, 5) ?? [];
      console.log(`[TilemapRenderer] First chunk (${chunk.cx},${chunk.cz}) tileset=${tilesetKey} sample ground=[${sampleGround}]`);
    }

    const groundMap = this.scene.make.tilemap({
      data: groundData,
      tileWidth: T,
      tileHeight: T,
    });
    const groundTileset = useOverworld
      ? groundMap.addTilesetImage(tilesetKey, tilesetKey, OVERWORLD_TILE_PX, OVERWORLD_TILE_PX)
      : groundMap.addTilesetImage(tilesetKey);
    if (!groundTileset) return;
    const groundLayer = groundMap.createLayer(0, groundTileset, offsetX, offsetY);
    if (!groundLayer) return;
    groundLayer.setDepth(0);

    // Apply elevation tinting to ground layer
    if (hasElevation) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const elev = elevation[y * CHUNK_SIZE + x];
          const tint = ELEVATION_TINTS[elev] ?? 0xffffff;
          if (tint !== 0xffffff) {
            const tile = groundLayer.getTileAt(x, y);
            if (tile) tile.tint = tint;
          }
        }
      }
    }

    const overlayMap = this.scene.make.tilemap({
      data: overlayData,
      tileWidth: T,
      tileHeight: T,
    });
    const overlayTileset = useOverworld
      ? overlayMap.addTilesetImage(tilesetKey, tilesetKey, OVERWORLD_TILE_PX, OVERWORLD_TILE_PX)
      : overlayMap.addTilesetImage(tilesetKey);
    if (!overlayTileset) return;
    const overlayLayer = overlayMap.createLayer(0, overlayTileset, offsetX, offsetY);
    if (!overlayLayer) return;
    overlayLayer.setDepth(20);

    // Generate cliff overlay layer if elevation data exists
    let cliffLayerResult: ElevationLayer | null = null;
    if (hasElevation) {
      cliffLayerResult = this.createCliffLayer(
        elevation,
        CHUNK_SIZE,
        CHUNK_SIZE,
        offsetX,
        offsetY,
        T,
      );
    }

    this.chunkVisuals.set(key, {
      cx: chunk.cx,
      cz: chunk.cz,
      groundMap,
      groundLayer,
      overlayMap,
      overlayLayer,
      cliffLayer: cliffLayerResult,
      waterPositions: waterPos,
      elevation: hasElevation ? [...elevation] : null,
    });
  }

  /** Create a cliff edge overlay layer from elevation data */
  private createCliffLayer(
    elevation: number[],
    w: number,
    h: number,
    offsetX: number,
    offsetY: number,
    tileSize: number,
  ): ElevationLayer | null {
    const { cliffTiles } = generateCliffLayer(elevation, w, h);

    // Check if there are any cliff tiles to render
    const hasCliffs = cliffTiles.some((t) => t >= 0);
    if (!hasCliffs) return null;

    const cliffData: number[][] = [];
    for (let z = 0; z < h; z++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) {
        row.push(cliffTiles[z * w + x]);
      }
      cliffData.push(row);
    }

    const map = this.scene.make.tilemap({
      data: cliffData,
      tileWidth: tileSize,
      tileHeight: tileSize,
    });
    const tileset = map.addTilesetImage(
      OVERWORLD_KEY,
      OVERWORLD_KEY,
      OVERWORLD_TILE_PX,
      OVERWORLD_TILE_PX,
    );
    if (!tileset) return null;

    const layer = map.createLayer(0, tileset, offsetX, offsetY);
    if (!layer) return null;

    // Cliff edges render between ground (0) and overlay (20)
    layer.setDepth(5);

    return { map, layer };
  }

  /** Remove a chunk from the renderer by composite key (zoneId_cx_cz) */
  removeChunk(key: string): void {
    const visual = this.chunkVisuals.get(key);
    if (!visual) return;

    visual.cliffLayer?.layer.destroy();
    visual.cliffLayer?.map.destroy();
    visual.overlayLayer.destroy();
    visual.overlayMap.destroy();
    visual.groundLayer.destroy();
    visual.groundMap.destroy();
    this.chunkVisuals.delete(key);
  }

  /** Number of chunks currently rendered */
  get renderedChunkCount(): number {
    return this.chunkVisuals.size;
  }

  /**
   * Get the elevation at a world position (server coords, zone-local).
   * In multi-zone mode, worldX/worldZ are world-space coords.
   * Returns 0 if elevation data is unavailable for that position.
   */
  getElevationAt(worldX: number, worldZ: number): number {
    // In multi-zone mode, find which zone this position falls in
    if (this.worldLayout) {
      const zoneId = this.worldLayout.pixelToZone(
        worldX * this.coordScale,
        worldZ * this.coordScale,
      );
      if (!zoneId) return 0;
      const zone = this.worldLayout.getZone(zoneId);
      if (!zone) return 0;

      // Convert to zone-local tile coords
      const localX = worldX - zone.offset.x;
      const localZ = worldZ - zone.offset.z;
      const tileX = Math.floor(localX * this.coordScale / CLIENT_TILE_PX);
      const tileZ = Math.floor(localZ * this.coordScale / CLIENT_TILE_PX);
      const cx = Math.floor(tileX / CHUNK_SIZE);
      const cz = Math.floor(tileZ / CHUNK_SIZE);
      const key = chunkKey(zoneId, cx, cz);
      const visual = this.chunkVisuals.get(key);
      if (!visual?.elevation) return 0;
      const lx = tileX - cx * CHUNK_SIZE;
      const lz = tileZ - cz * CHUNK_SIZE;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return 0;
      return visual.elevation[lz * CHUNK_SIZE + lx];
    }

    // Legacy single-zone mode
    const tileX = Math.floor(worldX * this.coordScale / CLIENT_TILE_PX);
    const tileZ = Math.floor(worldZ * this.coordScale / CLIENT_TILE_PX);
    const cx = Math.floor(tileX / CHUNK_SIZE);
    const cz = Math.floor(tileZ / CHUNK_SIZE);
    // In legacy mode, try all possible zone prefixes
    for (const [key, visual] of this.chunkVisuals) {
      if (!visual.elevation) continue;
      if (visual.cx !== cx || visual.cz !== cz) continue;
      const localX = tileX - cx * CHUNK_SIZE;
      const localZ = tileZ - cz * CHUNK_SIZE;
      if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) continue;
      return visual.elevation[localZ * CHUNK_SIZE + localX];
    }
    return 0;
  }

  // ─── Water animation (works for both modes) ───────────────────────

  private animateWaterAll(): void {
    this.waterFrame = (this.waterFrame + 1) % 3;
    const useOverworld = this.activeTileset === "overworld";
    const frames = useOverworld
      ? [OW_TILES.WATER_STILL, OW_TILES.WATER_ANIM1, OW_TILES.WATER_ANIM2]
      : [TILE.WATER_STILL, TILE.WATER_ANIM1, TILE.WATER_ANIM2];
    const tileIdx = frames[this.waterFrame];

    // Chunk mode
    for (const visual of this.chunkVisuals.values()) {
      for (const pos of visual.waterPositions) {
        visual.groundLayer.putTileAt(tileIdx, pos.x, pos.y);
      }
    }

    // Legacy mode
    if (this.groundLayer) {
      for (const pos of this.waterPositions) {
        this.groundLayer.putTileAt(tileIdx, pos.x, pos.y);
      }
    }
  }

  // ─── Legacy full-zone mode (kept for backward compat) ─────────────

  async loadZone(zoneId: string): Promise<boolean> {
    this.destroyAll();

    // Prefer overworld tileset if loaded
    if (isOverworldLoaded(this.scene)) {
      this.activeTileset = "overworld";
    } else {
      this.activeTileset = "tile-atlas";
      createTileAtlas(this.scene);
    }

    const useOverworld = this.activeTileset === "overworld";
    const data = await fetchTerrainGridV2(zoneId);
    const terrain = data ?? TilemapRenderer.fallbackTerrainV2(zoneId);

    const T = CLIENT_TILE_PX;
    this.coordScale = T / terrain.tileSize;
    this.worldPixelW = terrain.width * T;
    this.worldPixelH = terrain.height * T;

    const groundData: number[][] = [];
    const overlayData: number[][] = [];
    this.waterPositions = [];
    const fallbackGround = useOverworld ? OW_TILES.GRASS_PLAIN : 0;

    for (let y = 0; y < terrain.height; y++) {
      const groundRow: number[] = [];
      const overlayRow: number[] = [];
      for (let x = 0; x < terrain.width; x++) {
        const idx = y * terrain.width + x;
        const g = terrain.ground[idx];
        const gMapped = useOverworld ? mapOldTileToOverworld(g) : g;
        groundRow.push(gMapped >= 0 ? gMapped : fallbackGround);
        const o = terrain.overlay[idx];
        const oMapped = useOverworld && o >= 0 ? mapOldTileToOverworld(o) : o;
        overlayRow.push(oMapped >= 0 ? oMapped : -1);
        if (g === TILE.WATER_STILL) {
          this.waterPositions.push({ x, y });
        }
      }
      groundData.push(groundRow);
      overlayData.push(overlayRow);
    }

    console.log(`[TilemapRenderer] Legacy load ${zoneId}: ${terrain.width}x${terrain.height}, tileset=${useOverworld ? "overworld" : "procedural"}, sample=[${groundData[0]?.slice(0, 5)}]`);

    if (!this.scene || !this.scene.make || !this.scene.textures) {
      console.error("[TilemapRenderer] Scene not properly initialized");
      return false;
    }

    this.tilemap = this.scene.make.tilemap({
      data: groundData,
      tileWidth: T,
      tileHeight: T,
    });

    if (!this.tilemap) {
      console.error("[TilemapRenderer] Failed to create tilemap");
      return false;
    }

    const tilesetKey = useOverworld ? OVERWORLD_KEY : "tile-atlas";
    const tileset = useOverworld
      ? this.tilemap.addTilesetImage(tilesetKey, tilesetKey, OVERWORLD_TILE_PX, OVERWORLD_TILE_PX)
      : this.tilemap.addTilesetImage(tilesetKey);
    if (!tileset) {
      console.error(`[TilemapRenderer] Failed to add tileset image '${tilesetKey}'`);
      return false;
    }

    this.groundLayer = this.tilemap.createLayer(0, tileset, 0, 0);
    if (!this.groundLayer) {
      console.error("[TilemapRenderer] Failed to create ground layer");
      return false;
    }
    this.groundLayer.setDepth(0);

    const overlayMap = this.scene.make.tilemap({
      data: overlayData,
      tileWidth: T,
      tileHeight: T,
    });
    if (!overlayMap) {
      console.error("[TilemapRenderer] Failed to create overlay map");
      return false;
    }

    const overlayTileset = useOverworld
      ? overlayMap.addTilesetImage(tilesetKey, tilesetKey, OVERWORLD_TILE_PX, OVERWORLD_TILE_PX)
      : overlayMap.addTilesetImage(tilesetKey);
    if (!overlayTileset) {
      console.error("[TilemapRenderer] Failed to add overlay tileset");
      return false;
    }

    this.overlayLayer = overlayMap.createLayer(0, overlayTileset, 0, 0);
    if (!this.overlayLayer) {
      console.error("[TilemapRenderer] Failed to create overlay layer");
      return false;
    }
    this.overlayLayer.setDepth(20);

    if (this.waterPositions.length > 0) {
      this.waterTimer = this.scene.time.addEvent({
        delay: 500,
        callback: this.animateWaterAll,
        callbackScope: this,
        loop: true,
      });
    }

    return true;
  }

  /** Convert server world coordinates to pixel position */
  worldToPixel(x: number, z: number): { px: number; py: number } {
    return {
      px: x * this.coordScale,
      py: z * this.coordScale,
    };
  }

  /** Clean up everything */
  destroyAll(): void {
    for (const visual of this.chunkVisuals.values()) {
      visual.cliffLayer?.layer.destroy();
      visual.cliffLayer?.map.destroy();
      visual.overlayLayer.destroy();
      visual.overlayMap.destroy();
      visual.groundLayer.destroy();
      visual.groundMap.destroy();
    }
    this.chunkVisuals.clear();

    this.waterTimer?.destroy();
    this.waterTimer = null;
    this.overlayLayer?.destroy();
    this.overlayLayer = null;
    this.groundLayer?.destroy();
    this.groundLayer = null;
    this.tilemap?.destroy();
    this.tilemap = null;
    this.waterPositions = [];
  }

  destroy(): void {
    this.destroyAll();
  }

  /** Fallback: flat grass grid when v2 API unavailable */
  private static fallbackTerrainV2(zoneId: string): TerrainGridDataV2 {
    const ZONE_DEFAULTS: Record<string, { w: number; h: number; biome: string }> = {
      "village-square": { w: 64, h: 64, biome: "village" },
      "wild-meadow": { w: 64, h: 64, biome: "grassland" },
      "dark-forest": { w: 64, h: 64, biome: "forest" },
    };
    const cfg = ZONE_DEFAULTS[zoneId] ?? { w: 100, h: 100, biome: "grassland" };
    const total = cfg.w * cfg.h;
    const baseTile = cfg.biome === "forest" ? TILE.GRASS_DARK : TILE.GRASS_PLAIN;

    return {
      zoneId,
      width: cfg.w,
      height: cfg.h,
      tileSize: 10,
      ground: new Array(total).fill(baseTile),
      overlay: new Array(total).fill(-1),
      elevation: new Array(total).fill(0),
      biome: cfg.biome,
    };
  }
}
