import { API_URL, CLIENT_TILE_PX } from "./config.js";

export interface ZoneLayoutInfo {
  id: string;
  offset: { x: number; z: number };
  size: { width: number; height: number };
  levelReq: number;
}

export interface WorldLayoutData {
  zones: Record<string, ZoneLayoutInfo>;
  tileSize: number;
  totalSize: { width: number; height: number };
}

/**
 * Fetches and caches the world layout from the server.
 * Provides pixel-space offsets for multi-zone rendering.
 */
export class WorldLayoutManager {
  private layout: WorldLayoutData | null = null;
  private coordScale = 1;

  private async fetchLayoutWithRetry(retryCount = 2): Promise<Response> {
    const timeoutMs = 12_000;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${API_URL}/world/layout`, { signal: controller.signal });
        clearTimeout(timeout);
        if (response.status === 522 && attempt < retryCount) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        return response;
      } catch (err) {
        clearTimeout(timeout);
        lastError = err;
        if (attempt < retryCount) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
      }
    }
    throw lastError ?? new Error("Failed to fetch world layout");
  }

  /** Fetch layout from server. Call once at startup. */
  async load(): Promise<boolean> {
    try {
      const res = await this.fetchLayoutWithRetry();
      if (!res.ok) return false;
      this.layout = (await res.json()) as WorldLayoutData;
      if (this.layout.tileSize > 0) {
        this.coordScale = CLIENT_TILE_PX / this.layout.tileSize;
      }
      console.log(
        `[WorldLayout] Loaded ${Object.keys(this.layout.zones).length} zones, ` +
          `total: ${this.layout.totalSize.width}x${this.layout.totalSize.height}, ` +
          `coordScale: ${this.coordScale}`
      );
      return true;
    } catch {
      console.warn("[WorldLayout] Failed to fetch world layout");
      return false;
    }
  }

  get loaded(): boolean {
    return this.layout !== null;
  }

  get data(): WorldLayoutData | null {
    return this.layout;
  }

  get scale(): number {
    return this.coordScale;
  }

  /** Get all zone IDs */
  getZoneIds(): string[] {
    if (!this.layout) return [];
    return Object.keys(this.layout.zones);
  }

  /** Get zone info by ID */
  getZone(zoneId: string): ZoneLayoutInfo | undefined {
    return this.layout?.zones[zoneId];
  }

  /** Get the pixel offset for a zone (for positioning chunks and entities) */
  getZonePixelOffset(zoneId: string): { x: number; z: number } {
    if (!this.layout) return { x: 0, z: 0 };
    const zone = this.layout.zones[zoneId];
    if (!zone) return { x: 0, z: 0 };
    return {
      x: zone.offset.x * this.coordScale,
      z: zone.offset.z * this.coordScale,
    };
  }

  /** Get the pixel center of a zone (for camera positioning) */
  getZonePixelCenter(zoneId: string): { x: number; z: number } {
    if (!this.layout) return { x: 0, z: 0 };
    const zone = this.layout.zones[zoneId];
    if (!zone) return { x: 0, z: 0 };
    return {
      x: (zone.offset.x + zone.size.width / 2) * this.coordScale,
      z: (zone.offset.z + zone.size.height / 2) * this.coordScale,
    };
  }

  /** Get the world center in pixels */
  getWorldPixelCenter(): { x: number; z: number } {
    if (!this.layout) return { x: 0, z: 0 };
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const zone of Object.values(this.layout.zones)) {
      minX = Math.min(minX, zone.offset.x);
      minZ = Math.min(minZ, zone.offset.z);
      maxX = Math.max(maxX, zone.offset.x + zone.size.width);
      maxZ = Math.max(maxZ, zone.offset.z + zone.size.height);
    }
    return {
      x: ((minX + maxX) / 2) * this.coordScale,
      z: ((minZ + maxZ) / 2) * this.coordScale,
    };
  }

  /** Find which zone a pixel position falls within */
  pixelToZone(px: number, py: number): string | null {
    if (!this.layout) return null;
    const worldX = px / this.coordScale;
    const worldZ = py / this.coordScale;
    for (const zone of Object.values(this.layout.zones)) {
      if (
        worldX >= zone.offset.x &&
        worldX <= zone.offset.x + zone.size.width &&
        worldZ >= zone.offset.z &&
        worldZ <= zone.offset.z + zone.size.height
      ) {
        return zone.id;
      }
    }
    return null;
  }

  /** Get tile size from server */
  get tileSize(): number {
    return this.layout?.tileSize ?? 10;
  }
}
