import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve src/data/ — works both in dev (shard/src/) and production (dist/) */
function resolveDataDir(): string {
  // Production flat deploy: __dirname is dist/ → ../src/data/
  const prodPath = join(__dirname, "../src/data");
  if (existsSync(join(prodPath, "world.json"))) return prodPath;
  // Dev: __dirname is shard/src/ or shard/dist/ → ../../src/data/
  const devPath = join(__dirname, "../../src/data");
  if (existsSync(join(devPath, "world.json"))) return devPath;
  // Fallback: cwd-relative
  const cwdPath = join(process.cwd(), "src/data");
  if (existsSync(join(cwdPath, "world.json"))) return cwdPath;
  return devPath; // default, will fail with readable error
}

const DATA_DIR = resolveDataDir();

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
  "wild-meadow": 5,
  "dark-forest": 10,
  "auroral-plains": 15,
  "emerald-woods": 20,
  "viridian-range": 25,
  "moondancer-glade": 30,
  "felsrock-citadel": 35,
  "lake-lumina": 40,
  "azurshard-chasm": 45,
};

// ── Connection graph (loaded from world.json) ───────────────────────

interface WorldConnection {
  from: string;
  to: string;
  portal: string;
}

let cachedConnections: WorldConnection[] | null = null;

function loadConnections(): WorldConnection[] {
  if (cachedConnections) return cachedConnections;
  const worldPath = join(DATA_DIR, "world.json");
  const world = JSON.parse(readFileSync(worldPath, "utf-8"));
  cachedConnections = (world.connections ?? []) as WorldConnection[];
  return cachedConnections;
}

/** Get all zone IDs connected to the given zone (bidirectional). */
export function getZoneConnections(zoneId: string): string[] {
  const conns = loadConnections();
  const result: string[] = [];
  for (const c of conns) {
    if (c.from === zoneId) result.push(c.to);
    else if (c.to === zoneId) result.push(c.from);
  }
  return result;
}

/**
 * Determine the shared edge direction between two adjacent zones based on world offsets.
 * Returns 'east'|'west'|'north'|'south' if they share a full edge, or null (corner-only).
 */
export function getSharedEdge(
  fromZone: string,
  toZone: string
): "east" | "west" | "north" | "south" | null {
  const layout = loadLayout();
  const from = layout.zones[fromZone];
  const to = layout.zones[toZone];
  if (!from || !to) return null;

  const dx = to.offset.x - from.offset.x;
  const dz = to.offset.z - from.offset.z;

  // East/west: offset differs by exactly one zone width, same z
  if (dx === from.size.width && dz === 0) return "east";
  if (dx === -to.size.width && dz === 0) return "west";
  // North/south: offset differs by exactly one zone height, same x
  if (dz === -to.size.height && dx === 0) return "north";
  if (dz === from.size.height && dx === 0) return "south";

  return null; // corner-only or not adjacent
}

/** Get the portal ID for a connection (from world.json). Returns null if not found. */
export function getConnectionPortal(
  fromZone: string,
  toZone: string
): string | null {
  const conns = loadConnections();
  for (const c of conns) {
    if (c.from === fromZone && c.to === toZone) return c.portal;
    if (c.to === fromZone && c.from === toZone) return c.portal;
  }
  return null;
}

// ── Load layout from data files at startup ───────────────────────────

let cachedLayout: WorldLayout | null = null;

function loadLayout(): WorldLayout {
  if (cachedLayout) return cachedLayout;

  const worldPath = join(DATA_DIR, "world.json");
  const world = JSON.parse(readFileSync(worldPath, "utf-8"));

  const offsets: Record<string, Vec2> = world.worldOffsets ?? {};
  const zoneIds: string[] = world.zones ?? [];

  const zones: Record<string, ZoneLayout> = {};
  let maxX = 0;
  let maxZ = 0;

  for (const zoneId of zoneIds) {
    // Read zone bounds from src/data/zones/<zoneId>.json
    const zonePath = join(DATA_DIR, `zones/${zoneId}.json`);
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

// ── Portal position lookups (for travel command) ─────────────────────

interface ZonePOI {
  id: string;
  type: string;
  position: { x: number; z: number };
  portal?: {
    destinationZone: string;
    destinationPoi: string;
  };
}

const zonePoiCache = new Map<string, ZonePOI[]>();

function loadZonePois(zoneId: string): ZonePOI[] {
  if (zonePoiCache.has(zoneId)) return zonePoiCache.get(zoneId)!;
  try {
    const zonePath = join(DATA_DIR, `zones/${zoneId}.json`);
    const data = JSON.parse(readFileSync(zonePath, "utf-8"));
    const pois: ZonePOI[] = data.pois ?? [];
    zonePoiCache.set(zoneId, pois);
    return pois;
  } catch {
    return [];
  }
}

/** Find the position of a portal POI in a zone (by portal ID or by destination zone). */
export function findPortalInZone(
  zoneId: string,
  targetZone: string
): { x: number; z: number } | null {
  const pois = loadZonePois(zoneId);
  // Find portal POI that leads to targetZone
  const portal = pois.find(
    (p) => p.type === "portal" && p.portal?.destinationZone === targetZone
  );
  return portal?.position ?? null;
}

/** Find the destination portal position when traveling from sourceZone through a portal to destZone. */
export function findDestPortalPosition(
  sourceZone: string,
  destZone: string
): { x: number; z: number } | null {
  const sourcePois = loadZonePois(sourceZone);
  const sourcePortal = sourcePois.find(
    (p) => p.type === "portal" && p.portal?.destinationZone === destZone
  );
  if (!sourcePortal?.portal?.destinationPoi) return null;

  const destPois = loadZonePois(destZone);
  const destPortal = destPois.find((p) => p.id === sourcePortal.portal!.destinationPoi);
  return destPortal?.position ?? null;
}
