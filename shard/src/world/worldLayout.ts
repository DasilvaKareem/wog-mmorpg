import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve src/data/ — works both in dev (shard/src/) and production (dist/) */
function resolveDataDir(): string {
  // Production flat deploy: __dirname is dist/ → ../src/data/
  const prodPath = join(__dirname, "../src/data");
  if (existsSync(join(prodPath, "world.json"))) return prodPath;
  // Dev: __dirname is shard/src/world/ → ../../../src/data/
  const devPath = join(__dirname, "../../../src/data");
  if (existsSync(join(devPath, "world.json"))) return devPath;
  // Legacy: __dirname is shard/src/ → ../../src/data/
  const legacyPath = join(__dirname, "../../src/data");
  if (existsSync(join(legacyPath, "world.json"))) return legacyPath;
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
  "tutorial-island": 1,
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

function normalizeZoneKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a user-provided zone label to a canonical zone ID.
 * Accepts common variants like spaces/underscores/punctuation.
 */
export function resolveRegionId(zoneInput?: string | null): string | null {
  if (!zoneInput) return null;
  const raw = String(zoneInput).trim();
  if (!raw) return null;

  const layout = loadLayout();
  const zoneIds = Object.keys(layout.zones);

  const direct = raw.toLowerCase();
  if (zoneIds.includes(direct)) return direct;

  const slug = direct
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (zoneIds.includes(slug)) return slug;

  const targetKey = normalizeZoneKey(raw);
  if (!targetKey) return null;
  const keyedMatches = zoneIds.filter((id) => normalizeZoneKey(id) === targetKey);
  if (keyedMatches.length === 1) return keyedMatches[0];

  return null;
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

/** Determine which region (zone) a world-space position falls into. */
export function getRegionAtPosition(worldX: number, worldZ: number): string | null {
  const layout = loadLayout();
  for (const zone of Object.values(layout.zones)) {
    const localX = worldX - zone.offset.x;
    const localZ = worldZ - zone.offset.z;
    if (localX >= 0 && localX <= zone.size.width && localZ >= 0 && localZ <= zone.size.height) {
      return zone.id;
    }
  }
  return null;
}

/** Get the world-space center of a region. */
export function getRegionCenter(regionId: string): { x: number; z: number } | null {
  const layout = loadLayout();
  const zone = layout.zones[regionId];
  if (!zone) return null;
  return {
    x: zone.offset.x + zone.size.width / 2,
    z: zone.offset.z + zone.size.height / 2,
  };
}

/** Get the world-space offset for a zone/region. */
export function getZoneOffset(zoneId: string): Vec2 | null {
  const layout = loadLayout();
  const zone = layout.zones[zoneId];
  return zone?.offset ?? null;
}

/** Clamp entity position to stay within zone bounds (world-space). Returns true if clamped. */
export function clampToZoneBounds(
  entity: { x: number; y: number },
  zoneId: string
): boolean {
  const layout = loadLayout();
  const zone = layout.zones[zoneId];
  if (!zone) return false;

  let clamped = false;
  const margin = 1; // Keep 1 unit inside bounds
  const minX = zone.offset.x + margin;
  const maxX = zone.offset.x + zone.size.width - margin;
  const minY = zone.offset.z + margin;
  const maxY = zone.offset.z + zone.size.height - margin;

  if (entity.x < minX) {
    entity.x = minX;
    clamped = true;
  }
  if (entity.x > maxX) {
    entity.x = maxX;
    clamped = true;
  }
  if (entity.y < minY) {
    entity.y = minY;
    clamped = true;
  }
  if (entity.y > maxY) {
    entity.y = maxY;
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

