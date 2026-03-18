import type {
  ActivePlayersResponse,
  ZoneResponse,
  TerrainData,
  WorldLayout,
} from "./types.js";

// In dev, Vite proxy handles /zones etc. In prod (GCS), call shard directly.
const BASE = import.meta.env.VITE_API_URL || "";

export async function fetchZone(zoneId: string): Promise<ZoneResponse | null> {
  try {
    const res = await fetch(`${BASE}/zones/${zoneId}`);
    if (!res.ok) return null;
    return (await res.json()) as ZoneResponse;
  } catch {
    return null;
  }
}

export async function fetchZoneList(): Promise<Record<string, { entityCount: number; tick: number }>> {
  try {
    const res = await fetch(`${BASE}/zones`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/** Fetch full terrain for a zone (64x64 tiles, one call) */
export async function fetchTerrain(zoneId: string): Promise<TerrainData | null> {
  try {
    const res = await fetch(`${BASE}/v2/terrain/zone/${zoneId}`);
    if (!res.ok) return null;
    return (await res.json()) as TerrainData;
  } catch {
    return null;
  }
}

export async function fetchWorldLayout(): Promise<WorldLayout | null> {
  try {
    const res = await fetch(`${BASE}/world/layout`);
    if (!res.ok) return null;
    return (await res.json()) as WorldLayout;
  } catch {
    return null;
  }
}

export async function fetchActivePlayers(): Promise<ActivePlayersResponse | null> {
  try {
    const res = await fetch(`${BASE}/players/active`);
    if (!res.ok) return null;
    return (await res.json()) as ActivePlayersResponse;
  } catch {
    return null;
  }
}
