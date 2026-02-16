import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  z: number;
}

export interface ZoneLayout {
  id: string;
  offset: Vec2;
  size: { width: number; height: number };
  levelReq: number;
}

export interface WorldLayout {
  zones: Record<string, ZoneLayout>;
  tileSize: number;
  totalSize: { width: number; height: number };
}

// ── Level requirements ───────────────────────────────────────────────

export const ZONE_LEVEL_REQUIREMENTS: Record<string, number> = {
  "village-square": 1,
  "village-square": 1,
  "wild-meadow": 5,
  "dark-forest": 10,
};

// ── Load layout from data files at startup ───────────────────────────

let cachedLayout: WorldLayout | null = null;

function loadLayout(): WorldLayout {
  if (cachedLayout) return cachedLayout;

  const worldPath = join(__dirname, "../../src/data/world.json");
  const world = JSON.parse(readFileSync(worldPath, "utf-8"));

  const offsets: Record<string, Vec2> = world.worldOffsets ?? {};
  const zoneIds: string[] = world.zones ?? [];

  const zones: Record<string, ZoneLayout> = {};
  let maxX = 0;
  let maxZ = 0;

  for (const zoneId of zoneIds) {
    // Read zone bounds from src/data/zones/<zoneId>.json
    const zonePath = join(__dirname, `../../src/data/zones/${zoneId}.json`);
    let width = 300;
    let height = 300;
    try {
      const zoneData = JSON.parse(readFileSync(zonePath, "utf-8"));
      if (zoneData.bounds) {
        width = zoneData.bounds.max.x - zoneData.bounds.min.x;
        height = zoneData.bounds.max.z - zoneData.bounds.min.z;
      }
    } catch {
      console.warn(`[worldLayout] Could not read zone file for ${zoneId}, using default 300x300`);
    }

    const offset = offsets[zoneId] ?? { x: 0, z: 0 };

    zones[zoneId] = {
      id: zoneId,
      offset,
      size: { width, height },
      levelReq: ZONE_LEVEL_REQUIREMENTS[zoneId] ?? 1,
    };

    maxX = Math.max(maxX, offset.x + width);
    maxZ = Math.max(maxZ, offset.z + height);
  }

  cachedLayout = {
    zones,
    tileSize: 10,
    totalSize: { width: maxX, height: maxZ },
  };

  console.log(
    `[worldLayout] Loaded ${zoneIds.length} zones, total world: ${maxX}x${maxZ}`
  );

  return cachedLayout;
}

// ── Public API ───────────────────────────────────────────────────────

export function getWorldLayout(): WorldLayout {
  return loadLayout();
}

/** Convert zone-local coordinates to world coordinates */
export function localToWorld(
  zoneId: string,
  localX: number,
  localZ: number
): { worldX: number; worldZ: number } | null {
  const layout = loadLayout();
  const zone = layout.zones[zoneId];
  if (!zone) return null;
  return {
    worldX: zone.offset.x + localX,
    worldZ: zone.offset.z + localZ,
  };
}

/** Convert world coordinates to zone-local coordinates. Returns the first zone containing the point. */
export function worldToLocal(
  worldX: number,
  worldZ: number
): { zoneId: string; localX: number; localZ: number } | null {
  const layout = loadLayout();
  for (const zone of Object.values(layout.zones)) {
    const localX = worldX - zone.offset.x;
    const localZ = worldZ - zone.offset.z;
    if (
      localX >= 0 &&
      localX <= zone.size.width &&
      localZ >= 0 &&
      localZ <= zone.size.height
    ) {
      return { zoneId: zone.id, localX, localZ };
    }
  }
  return null;
}

/**
 * When an entity moves out of its zone bounds, find the adjacent zone it entered.
 * Returns destination zone ID and new local coordinates, or null if no adjacent zone.
 */
export function getAdjacentZone(
  sourceZoneId: string,
  localX: number,
  localZ: number
): { destZoneId: string; destLocalX: number; destLocalZ: number } | null {
  const layout = loadLayout();
  const source = layout.zones[sourceZoneId];
  if (!source) return null;

  // Check if entity is actually out of bounds
  if (
    localX >= 0 &&
    localX <= source.size.width &&
    localZ >= 0 &&
    localZ <= source.size.height
  ) {
    return null; // Still inside source zone
  }

  // Convert to world coords
  const worldX = source.offset.x + localX;
  const worldZ = source.offset.z + localZ;

  // Find which zone contains this world position
  for (const zone of Object.values(layout.zones)) {
    if (zone.id === sourceZoneId) continue;
    const destLocalX = worldX - zone.offset.x;
    const destLocalZ = worldZ - zone.offset.z;
    if (
      destLocalX >= 0 &&
      destLocalX <= zone.size.width &&
      destLocalZ >= 0 &&
      destLocalZ <= zone.size.height
    ) {
      return {
        destZoneId: zone.id,
        destLocalX,
        destLocalZ,
      };
    }
  }

  return null;
}

/** Clamp entity position to stay within zone bounds. Returns true if clamped. */
export function clampToZoneBounds(
  entity: { x: number; y: number },
  zoneId: string
): boolean {
  const layout = loadLayout();
  const zone = layout.zones[zoneId];
  if (!zone) return false;

  let clamped = false;
  const margin = 1; // Keep 1 unit inside bounds

  if (entity.x < margin) {
    entity.x = margin;
    clamped = true;
  }
  if (entity.x > zone.size.width - margin) {
    entity.x = zone.size.width - margin;
    clamped = true;
  }
  if (entity.y < margin) {
    entity.y = margin;
    clamped = true;
  }
  if (entity.y > zone.size.height - margin) {
    entity.y = zone.size.height - margin;
    clamped = true;
  }

  return clamped;
}
