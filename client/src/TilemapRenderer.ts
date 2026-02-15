import Phaser from "phaser";
import type { TerrainGridDataV2 } from "./types.js";
import { fetchTerrainGridV2 } from "./ShardClient.js";
import { CLIENT_TILE_PX } from "./config.js";
import { createTileAtlas, TILE } from "./TileAtlas.js";
import type { LoadedChunk } from "./ChunkStreamManager.js";
import { CHUNK_SIZE } from "./ChunkStreamManager.js";

function chunkKey(cx: number, cz: number): string {
  return `${cx}_${cz}`;
}

/** Per-chunk tilemap layers stored in the renderer */
interface ChunkVisual {
  cx: number;
  cz: number;
  groundMap: Phaser.Tilemaps.Tilemap;
  groundLayer: Phaser.Tilemaps.TilemapLayer;
  overlayMap: Phaser.Tilemaps.Tilemap;
  overlayLayer: Phaser.Tilemaps.TilemapLayer;
  waterPositions: { x: number; y: number }[];
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

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ─── Chunk streaming mode ──────────────────────────────────────────

  /** Initialize chunk streaming mode */
  initChunkMode(tileSize: number): void {
    this.destroyAll();
    this.coordScale = tileSize > 0 ? CLIENT_TILE_PX / tileSize : 1.6;
    createTileAtlas(this.scene);

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
    const key = chunkKey(chunk.cx, chunk.cz);
    if (this.chunkVisuals.has(key)) return;

    const T = CLIENT_TILE_PX;
    const offsetX = chunk.cx * CHUNK_SIZE * T;
    const offsetY = chunk.cz * CHUNK_SIZE * T;

    const groundData: number[][] = [];
    const overlayData: number[][] = [];
    const waterPos: { x: number; y: number }[] = [];

    for (let y = 0; y < CHUNK_SIZE; y++) {
      const groundRow: number[] = [];
      const overlayRow: number[] = [];
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = y * CHUNK_SIZE + x;
        const g = chunk.payload.ground[idx];
        groundRow.push(g);
        const o = chunk.payload.overlay[idx];
        overlayRow.push(o >= 0 ? o : -1);
        if (g === TILE.WATER_STILL) {
          waterPos.push({ x, y });
        }
      }
      groundData.push(groundRow);
      overlayData.push(overlayRow);
    }

    const groundMap = this.scene.make.tilemap({
      data: groundData,
      tileWidth: T,
      tileHeight: T,
    });
    const groundTileset = groundMap.addTilesetImage("tile-atlas");
    if (!groundTileset) return;
    const groundLayer = groundMap.createLayer(0, groundTileset, offsetX, offsetY);
    if (!groundLayer) return;
    groundLayer.setDepth(0);

    const overlayMap = this.scene.make.tilemap({
      data: overlayData,
      tileWidth: T,
      tileHeight: T,
    });
    const overlayTileset = overlayMap.addTilesetImage("tile-atlas");
    if (!overlayTileset) return;
    const overlayLayer = overlayMap.createLayer(0, overlayTileset, offsetX, offsetY);
    if (!overlayLayer) return;
    overlayLayer.setDepth(20);

    this.chunkVisuals.set(key, {
      cx: chunk.cx,
      cz: chunk.cz,
      groundMap,
      groundLayer,
      overlayMap,
      overlayLayer,
      waterPositions: waterPos,
    });
  }

  /** Remove a chunk from the renderer */
  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const visual = this.chunkVisuals.get(key);
    if (!visual) return;

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

  // ─── Water animation (works for both modes) ───────────────────────

  private animateWaterAll(): void {
    this.waterFrame = (this.waterFrame + 1) % 3;
    const frames = [TILE.WATER_STILL, TILE.WATER_ANIM1, TILE.WATER_ANIM2];
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

    createTileAtlas(this.scene);

    const data = await fetchTerrainGridV2(zoneId);
    const terrain = data ?? TilemapRenderer.fallbackTerrainV2(zoneId);

    const T = CLIENT_TILE_PX;
    this.coordScale = T / terrain.tileSize;
    this.worldPixelW = terrain.width * T;
    this.worldPixelH = terrain.height * T;

    const groundData: number[][] = [];
    const overlayData: number[][] = [];
    this.waterPositions = [];

    for (let y = 0; y < terrain.height; y++) {
      const groundRow: number[] = [];
      const overlayRow: number[] = [];
      for (let x = 0; x < terrain.width; x++) {
        const idx = y * terrain.width + x;
        const g = terrain.ground[idx];
        groundRow.push(g);
        const o = terrain.overlay[idx];
        overlayRow.push(o >= 0 ? o : -1);
        if (g === TILE.WATER_STILL) {
          this.waterPositions.push({ x, y });
        }
      }
      groundData.push(groundRow);
      overlayData.push(overlayRow);
    }

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

    const tileset = this.tilemap.addTilesetImage("tile-atlas");
    if (!tileset) {
      console.error("[TilemapRenderer] Failed to add tileset image 'tile-atlas'");
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

    const overlayTileset = overlayMap.addTilesetImage("tile-atlas");
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
      "village-square": { w: 30, h: 30, biome: "village" },
      "human-meadow": { w: 100, h: 100, biome: "grassland" },
      "wild-meadow": { w: 50, h: 50, biome: "grassland" },
      "dark-forest": { w: 60, h: 60, biome: "forest" },
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
      biome: cfg.biome,
    };
  }
}
