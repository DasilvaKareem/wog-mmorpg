import Phaser from "phaser";
import type { TerrainGridDataV2 } from "./types.js";
import { fetchTerrainGridV2 } from "./ShardClient.js";
import { CLIENT_TILE_PX } from "./config.js";
import { createTileAtlas, TILE } from "./TileAtlas.js";

/**
 * Renders zone terrain using Phaser native tilemaps with the programmatic
 * tile atlas. Two layers: ground (depth 0) and overlay (depth 20).
 * Water tiles animate by swapping indices every 500ms.
 */
export class TilemapRenderer {
  private scene: Phaser.Scene;
  private tilemap: Phaser.Tilemaps.Tilemap | null = null;
  private groundLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private overlayLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private waterTimer: Phaser.Time.TimerEvent | null = null;
  private waterFrame = 0;
  private waterPositions: { x: number; y: number }[] = [];

  /** Scale factor: multiply server world coords by this to get pixel coords */
  coordScale = 1;
  /** Pixel dimensions of the rendered world */
  worldPixelW = 0;
  worldPixelH = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Load terrain for a zone using the v2 tile-indexed API.
   * Falls back to a flat grass grid if unavailable.
   */
  async loadZone(zoneId: string): Promise<boolean> {
    this.destroy();

    // Ensure the tile atlas is registered
    createTileAtlas(this.scene);

    const data = await fetchTerrainGridV2(zoneId);
    const terrain = data ?? TilemapRenderer.fallbackTerrainV2(zoneId);

    const T = CLIENT_TILE_PX;
    this.coordScale = T / terrain.tileSize;
    this.worldPixelW = terrain.width * T;
    this.worldPixelH = terrain.height * T;

    // Build 2D tile data arrays
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

        // Track water positions for animation
        if (g === TILE.WATER_STILL) {
          this.waterPositions.push({ x, y });
        }
      }
      groundData.push(groundRow);
      overlayData.push(overlayRow);
    }

    // Create Phaser tilemap from data
    this.tilemap = this.scene.make.tilemap({
      data: groundData,
      tileWidth: T,
      tileHeight: T,
    });

    const tileset = this.tilemap.addTilesetImage("tile-atlas")!;

    // Ground layer
    this.groundLayer = this.tilemap.createLayer(0, tileset, 0, 0)!;
    this.groundLayer.setDepth(0);

    // Overlay layer — create blank, then populate
    const overlayMap = this.scene.make.tilemap({
      data: overlayData,
      tileWidth: T,
      tileHeight: T,
    });
    const overlayTileset = overlayMap.addTilesetImage("tile-atlas")!;
    this.overlayLayer = overlayMap.createLayer(0, overlayTileset, 0, 0)!;
    this.overlayLayer.setDepth(20);

    // Start water animation
    if (this.waterPositions.length > 0) {
      this.waterTimer = this.scene.time.addEvent({
        delay: 500,
        callback: this.animateWater,
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

  destroy(): void {
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

  /** Cycle water tiles between 3 animation frames */
  private animateWater(): void {
    if (!this.groundLayer) return;
    this.waterFrame = (this.waterFrame + 1) % 3;
    const frames = [TILE.WATER_STILL, TILE.WATER_ANIM1, TILE.WATER_ANIM2];
    const tileIdx = frames[this.waterFrame];
    for (const pos of this.waterPositions) {
      this.groundLayer.putTileAt(tileIdx, pos.x, pos.y);
    }
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
