import Phaser from "phaser";
import type { TerrainGridData } from "./types.js";
import { fetchTerrainGrid } from "./ShardClient.js";
import { CLIENT_TILE_PX, TERRAIN_PALETTES, type TilePalette } from "./config.js";

const FALLBACK_PALETTE: TilePalette = { base: 0x444444, dark: 0x333333, light: 0x555555 };

/**
 * Fetches a zone's terrain grid from the server and renders it as a
 * pixel-art background image in Phaser. Each server tile becomes a
 * CLIENT_TILE_PX × CLIENT_TILE_PX block with SNES-style dithered color.
 */
export class TilemapRenderer {
  private scene: Phaser.Scene;
  private image: Phaser.GameObjects.Image | null = null;
  private currentTextureKey: string | null = null;

  /** Scale factor: multiply server world coords by this to get pixel coords */
  coordScale = 1;
  /** Pixel dimensions of the rendered world */
  worldPixelW = 0;
  worldPixelH = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Load terrain for a zone, generate the pixel-art image, display it.
   * Falls back to client-side generated terrain if the API is unavailable.
   */
  async loadZone(zoneId: string): Promise<boolean> {
    this.destroy();

    const fetched = await fetchTerrainGrid(zoneId);
    const data = fetched ?? TilemapRenderer.fallbackTerrain(zoneId);

    const T = CLIENT_TILE_PX;
    this.coordScale = T / data.tileSize;
    this.worldPixelW = data.width * T;
    this.worldPixelH = data.height * T;

    const textureKey = `terrain-${zoneId}-${Date.now()}`;
    const canvas = document.createElement("canvas");
    canvas.width = this.worldPixelW;
    canvas.height = this.worldPixelH;
    const ctx = canvas.getContext("2d")!;

    this.paintTerrain(ctx, data);

    this.scene.textures.addCanvas(textureKey, canvas);
    this.currentTextureKey = textureKey;

    this.image = this.scene.add
      .image(0, 0, textureKey)
      .setOrigin(0, 0)
      .setDepth(0);

    return true;
  }

  /** Convert server world coordinates to pixel position */
  worldToPixel(x: number, z: number): { px: number; py: number } {
    return {
      px: x * this.coordScale,
      py: z * this.coordScale,
    };
  }

  /**
   * Generate a simple fallback terrain grid when the server API is unavailable.
   * Uses the zone's known default terrain type and dimensions.
   */
  private static fallbackTerrain(zoneId: string): TerrainGridData {
    const ZONE_DEFAULTS: Record<string, { type: string; w: number; h: number }> = {
      "village-square": { type: "stone", w: 30, h: 30 },
      "wild-meadow":    { type: "grass", w: 50, h: 50 },
      "dark-forest":    { type: "forest", w: 60, h: 60 },
      "human-meadow":   { type: "grass", w: 100, h: 100 },
    };
    const cfg = ZONE_DEFAULTS[zoneId] ?? { type: "grass", w: 100, h: 100 };

    // Fill with default type, scatter ~2% obstacles for visual interest
    const total = cfg.w * cfg.h;
    const tiles: string[] = new Array(total).fill(cfg.type);
    // Deterministic scatter using simple hash
    for (let i = 0; i < total; i++) {
      let h = (i * 374761393 + cfg.w * 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const r = ((h >>> 0) & 0xffff) / 0xffff;
      if (r < 0.008) tiles[i] = "water";
      else if (r < 0.016) tiles[i] = "rock";
      else if (r < 0.020) tiles[i] = "mud";
    }

    return { zoneId, width: cfg.w, height: cfg.h, tileSize: 10, tiles };
  }

  destroy(): void {
    this.image?.destroy();
    this.image = null;
    if (this.currentTextureKey && this.scene.textures.exists(this.currentTextureKey)) {
      this.scene.textures.remove(this.currentTextureKey);
    }
    this.currentTextureKey = null;
  }

  // ─── Pixel-art terrain painting ────────────────────────────────────

  private paintTerrain(ctx: CanvasRenderingContext2D, data: TerrainGridData): void {
    const T = CLIENT_TILE_PX;
    const w = data.width * T;
    const h = data.height * T;
    const imageData = ctx.createImageData(w, h);
    const px = imageData.data;

    for (let tz = 0; tz < data.height; tz++) {
      for (let tx = 0; tx < data.width; tx++) {
        const terrainType = data.tiles[tz * data.width + tx];
        const palette = TERRAIN_PALETTES[terrainType] ?? FALLBACK_PALETTE;

        for (let ly = 0; ly < T; ly++) {
          for (let lx = 0; lx < T; lx++) {
            const worldPx = tx * T + lx;
            const worldPy = tz * T + ly;
            const color = this.pickColor(terrainType, palette, lx, ly, tx, tz);

            const idx = (worldPy * w + worldPx) * 4;
            px[idx] = (color >> 16) & 0xff;
            px[idx + 1] = (color >> 8) & 0xff;
            px[idx + 2] = color & 0xff;
            px[idx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Pick a pixel color for a given terrain type. Uses tile-local coords
   * (lx, ly) and tile position (tx, tz) for deterministic variation.
   */
  private pickColor(
    type: string,
    pal: TilePalette,
    lx: number,
    ly: number,
    tx: number,
    tz: number,
  ): number {
    const n = this.noise(tx * CLIENT_TILE_PX + lx, tz * CLIENT_TILE_PX + ly);

    switch (type) {
      case "water":
        return this.waterPattern(pal, lx, ly, tx, tz);
      case "stone":
        return this.stonePattern(pal, n, lx, ly);
      case "forest":
        // Dense foliage: heavier dark mix
        if (n < 0.40) return pal.dark;
        if (n < 0.82) return pal.base;
        return pal.light;
      case "rock":
        // Craggy: add diagonal crack lines
        if (((lx + ly) & 7) === 0 && n < 0.5) return pal.dark;
        if (n < 0.25) return pal.dark;
        if (n < 0.85) return pal.base;
        return pal.light;
      case "mud":
        // Wet look: more dark spots
        if (n < 0.35) return pal.dark;
        if (n < 0.85) return pal.base;
        return pal.light;
      case "dirt":
        // Path texture: sparse pebbles
        if (n < 0.18) return pal.dark;
        if (n < 0.88) return pal.base;
        return pal.light;
      case "grass":
      default:
        // Grass tufts: small darker clumps
        return this.grassPattern(pal, n, lx, ly, tx, tz);
    }
  }

  private grassPattern(
    pal: TilePalette,
    n: number,
    lx: number,
    ly: number,
    tx: number,
    tz: number,
  ): number {
    // Create 2×1 "tuft" shapes using a second noise sample
    const n2 = this.noise(tx * 97 + lx, tz * 131 + ly);
    // Tufts: check if this pixel AND its right neighbor are both "dark noise"
    if (n < 0.20 && n2 < 0.40) return pal.dark;
    // Small bright flower-like dots
    if (n > 0.96 && (lx & 3) === 1 && (ly & 3) === 2) return pal.light;
    if (n < 0.22) return pal.dark;
    if (n < 0.88) return pal.base;
    return pal.light;
  }

  private waterPattern(
    pal: TilePalette,
    lx: number,
    ly: number,
    tx: number,
    tz: number,
  ): number {
    // Horizontal wave bands with slight diagonal drift
    const wave = (ly + lx * 0.3 + tx * 3.7 + tz * 5.1) % 8;
    if (wave < 1.5) return pal.light;
    if (wave < 5.5) return pal.base;
    return pal.dark;
  }

  private stonePattern(pal: TilePalette, n: number, lx: number, ly: number): number {
    // Paving stone grid: grout lines every 8px, offset alternating rows
    const offset = (ly >= 8) ? 4 : 0;
    const gx = (lx + offset) % 8;
    if (gx === 0 || ly % 8 === 0) return pal.dark;
    if (n < 0.12) return pal.dark;
    if (n < 0.88) return pal.base;
    return pal.light;
  }

  /** Fast integer hash → 0..1 for deterministic pixel noise */
  private noise(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return ((h >>> 0) & 0xffff) / 0xffff;
  }
}
