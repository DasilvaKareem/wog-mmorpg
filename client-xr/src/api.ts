import type {
  ActivePlayersResponse,
  ZoneResponse,
  TerrainData,
  WorldLayout,
} from "./types.js";

// Prefer explicit env, then same-origin (dev proxy), then local shard fallback.
const ENV_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";
const CANDIDATE_BASES = ENV_BASE
  ? [ENV_BASE]
  : ["", "http://localhost:3003", "http://127.0.0.1:3003", "http://localhost:3000", "http://127.0.0.1:3000"];

function normalizeBase(base: string): string {
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function toUrl(base: string, path: string): string {
  const normalizedBase = normalizeBase(base);
  return normalizedBase ? `${normalizedBase}${path}` : path;
}

async function fetchJsonWithFallback<T>(path: string): Promise<T | null> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, path));
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      // Try next candidate base.
    }
  }
  return null;
}

export async function fetchZone(zoneId: string): Promise<ZoneResponse | null> {
  return fetchJsonWithFallback<ZoneResponse>(`/zones/${zoneId}`);
}

export async function fetchZoneList(): Promise<Record<string, { entityCount: number; tick: number }>> {
  return (await fetchJsonWithFallback<Record<string, { entityCount: number; tick: number }>>("/zones")) ?? {};
}

/** Fetch full terrain for a zone (64x64 tiles, one call) */
export async function fetchTerrain(zoneId: string): Promise<TerrainData | null> {
  return fetchJsonWithFallback<TerrainData>(`/v2/terrain/zone/${zoneId}`);
}

export async function fetchWorldLayout(): Promise<WorldLayout | null> {
  return fetchJsonWithFallback<WorldLayout>("/world/layout");
}

export async function fetchActivePlayers(): Promise<ActivePlayersResponse | null> {
  return fetchJsonWithFallback<ActivePlayersResponse>("/players/active");
}

// ── Authenticated commands ──────────────────────────────────────────

export async function postCommand(
  token: string,
  body: { zoneId: string; entityId: string; action: string; x?: number; y?: number; targetId?: string }
): Promise<{ ok: boolean; error?: string }> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, "/command"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { ok: res.ok, error: data.error };
    } catch {
      // Try next candidate base.
    }
  }
  return { ok: false, error: "All API bases unreachable" };
}
