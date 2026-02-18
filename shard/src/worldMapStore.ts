/**
 * Redis-backed world map metadata store.
 * On boot: reads world.json + zone JSON files → builds WorldMapData → caches in Redis + memory.
 * Key: worldmap:data (JSON string)
 *
 * Falls back to in-memory when Redis is unavailable.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getRedis } from "./redis.js";
import { ZONE_LEVEL_REQUIREMENTS } from "./worldLayout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve src/data/ — works both in dev (shard/src/) and production (dist/) */
function resolveDataDir(): string {
  const prodPath = join(__dirname, "../src/data");
  if (existsSync(join(prodPath, "world.json"))) return prodPath;
  const devPath = join(__dirname, "../../src/data");
  if (existsSync(join(devPath, "world.json"))) return devPath;
  const cwdPath = join(process.cwd(), "src/data");
  if (existsSync(join(cwdPath, "world.json"))) return cwdPath;
  return devPath;
}

const DATA_DIR = resolveDataDir();

// ── Types ──────────────────────────────────────────────────────────

export interface SimplePOI {
  id: string;
  name: string;
  x: number;
  z: number;
  kind: "portal" | "shop" | "spawn" | "landmark" | "structure" | "road-node";
  destination?: string;
}

export interface ZoneMapInfo {
  id: string;
  name: string;
  levelRange: string;
  levelReq: number;
  bgTint: string;
  bounds: { width: number; height: number };
  pois: SimplePOI[];
}

export interface ContinentInfo {
  id: string;
  name: string;
  status: "active" | "placeholder";
  description: string;
  tint: string;
  icon: string;
}

export interface WorldMapData {
  zones: ZoneMapInfo[];
  connections: [string, string][];
  continents: ContinentInfo[];
}

// ── In-memory cache ────────────────────────────────────────────────

let cachedData: WorldMapData | null = null;

const REDIS_KEY = "worldmap:data";

// ── Level range labels ─────────────────────────────────────────────

function levelRangeLabel(zoneId: string, allZones: string[]): string {
  const req = ZONE_LEVEL_REQUIREMENTS[zoneId] ?? 1;

  // Find the next zone's level req to determine the upper bound
  const sorted = allZones
    .map((id) => ({ id, req: ZONE_LEVEL_REQUIREMENTS[id] ?? 1 }))
    .sort((a, b) => a.req - b.req);

  const idx = sorted.findIndex((z) => z.id === zoneId);
  const next = sorted[idx + 1];

  if (!next) return `L${req}+`;
  return `L${req}-${next.req - 1}`;
}

// ── POI type mapping ───────────────────────────────────────────────

function mapPoiKind(poi: any): SimplePOI["kind"] {
  const type: string = poi.type ?? "";

  if (type === "portal") return "portal";
  if (type === "road-node") return "road-node";
  if (type === "landmark") return "landmark";
  if (type === "spawn-point") return "spawn";

  // Structures: check if it's a shop
  if (type === "structure") {
    const structKind = poi.structure?.kind;
    const services: string[] = poi.structure?.services ?? [];
    if (structKind === "shop" || services.includes("buy") || services.includes("sell")) {
      return "shop";
    }
    return "structure";
  }

  return "landmark";
}

// ── Default tint palette (cycled if zone has no mapTint) ───────────

const DEFAULT_TINTS = [
  "rgba(180,140,80,0.12)",
  "rgba(80,180,80,0.12)",
  "rgba(100,60,160,0.12)",
  "rgba(80,140,200,0.12)",
  "rgba(200,80,80,0.12)",
];

// ── Build payload from disk ────────────────────────────────────────

function buildWorldMapData(): WorldMapData {
  const worldPath = join(DATA_DIR, "world.json");
  const world = JSON.parse(readFileSync(worldPath, "utf-8"));

  const zoneIds: string[] = world.zones ?? [];
  const connections: [string, string][] = (world.connections ?? []).map(
    (c: any) => [c.from, c.to] as [string, string]
  );

  const zones: ZoneMapInfo[] = zoneIds.map((zoneId, idx) => {
    const zonePath = join(DATA_DIR, `zones/${zoneId}.json`);
    let zoneData: any = {};
    try {
      zoneData = JSON.parse(readFileSync(zonePath, "utf-8"));
    } catch {
      console.warn(`[worldMapStore] Could not read zone file: ${zoneId}`);
    }

    // Bounds
    const boundsRaw = zoneData.bounds ?? { min: { x: 0, z: 0 }, max: { x: 300, z: 300 } };
    const width = boundsRaw.max.x - boundsRaw.min.x;
    const height = boundsRaw.max.z - boundsRaw.min.z;

    // POIs
    const pois: SimplePOI[] = (zoneData.pois ?? []).map((poi: any) => {
      const mapped: SimplePOI = {
        id: poi.id,
        name: poi.name,
        x: poi.position?.x ?? 0,
        z: poi.position?.z ?? 0,
        kind: mapPoiKind(poi),
      };
      if (poi.portal?.destinationZone) {
        mapped.destination = poi.portal.destinationZone;
      }
      return mapped;
    });

    // Tint
    const bgTint = zoneData.mapTint ?? DEFAULT_TINTS[idx % DEFAULT_TINTS.length];

    return {
      id: zoneId,
      name: zoneData.name ?? zoneId,
      levelRange: levelRangeLabel(zoneId, zoneIds),
      levelReq: ZONE_LEVEL_REQUIREMENTS[zoneId] ?? 1,
      bgTint,
      bounds: { width, height },
      pois,
    };
  });

  const continents: ContinentInfo[] = (world.continents ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    status: c.status ?? "placeholder",
    description: c.description ?? "",
    tint: c.tint ?? "rgba(100,100,100,0.10)",
    icon: c.icon ?? "🌍",
  }));

  return { zones, connections, continents };
}

// ── Public API ─────────────────────────────────────────────────────

export async function initWorldMapStore(): Promise<void> {
  cachedData = buildWorldMapData();

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(cachedData));
      console.log(`[worldMapStore] Wrote ${cachedData.zones.length} zones to Redis`);
    } catch {
      console.warn("[worldMapStore] Failed to write to Redis, using in-memory only");
    }
  } else {
    console.log(`[worldMapStore] No Redis, cached ${cachedData.zones.length} zones in-memory`);
  }
}

export async function getWorldMapData(): Promise<WorldMapData> {
  // Return in-memory cache if available
  if (cachedData) return cachedData;

  // Try Redis
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(REDIS_KEY);
      if (raw) {
        cachedData = JSON.parse(raw);
        return cachedData!;
      }
    } catch {
      // Redis failed, rebuild from disk
    }
  }

  // Rebuild from disk as last resort
  cachedData = buildWorldMapData();
  return cachedData;
}
