import type {
  ActivePlayersResponse,
  ZoneResponse,
  TerrainData,
  WorldLayout,
  CharacterListResponse,
  ClassDef,
  RaceDef,
  QuestLogResponse,
  ZoneQuestsResponse,
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

async function postJsonWithFallback<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? res.statusText };
      return { ok: true, data: data as T };
    } catch {
      // Try next candidate base.
    }
  }
  return { ok: false, error: "All API bases unreachable" };
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

// ── Character select APIs ──────────────────────────────────────────

export async function fetchCharacters(walletAddress: string, token: string): Promise<CharacterListResponse | null> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, `/character/${walletAddress}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      return (await res.json()) as CharacterListResponse;
    } catch {
      // Try next candidate base.
    }
  }
  return null;
}

export async function fetchClasses(): Promise<ClassDef[]> {
  return (await fetchJsonWithFallback<ClassDef[]>("/character/classes")) ?? [];
}

export async function fetchRaces(): Promise<RaceDef[]> {
  return (await fetchJsonWithFallback<RaceDef[]>("/character/races")) ?? [];
}

export async function createCharacter(
  token: string,
  body: { walletAddress: string; characterName: string; classId: string; raceId: string },
): Promise<{ ok: boolean; character?: { name: string }; error?: string }> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, "/character/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { ok: res.ok, character: data.character, error: data.error };
    } catch {
      // Try next candidate base.
    }
  }
  return { ok: false, error: "All API bases unreachable" };
}

export async function spawnCharacter(
  token: string,
  body: {
    zoneId: string;
    type: string;
    name: string;
    walletAddress: string;
    classId?: string;
    raceId?: string;
    characterTokenId?: string;
  },
): Promise<{ ok: boolean; spawned?: { id: string }; zone?: string; error?: string }> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, "/spawn"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { ok: res.ok, spawned: data.spawned, zone: data.zone, error: data.error };
    } catch {
      // Try next candidate base.
    }
  }
  return { ok: false, error: "All API bases unreachable" };
}

// ── Quest endpoints ───────────────────────────────────────────────

export async function fetchQuestLog(walletAddress: string): Promise<QuestLogResponse | null> {
  return fetchJsonWithFallback<QuestLogResponse>(`/questlog/${walletAddress}`);
}

export async function fetchZoneQuests(zoneId: string, playerId: string): Promise<ZoneQuestsResponse | null> {
  return fetchJsonWithFallback<ZoneQuestsResponse>(`/quests/zone/${zoneId}/${playerId}`);
}

export async function acceptQuest(
  token: string,
  entityId: string,
  questId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/quests/accept", token, { entityId, questId });
}

export async function completeQuest(
  token: string,
  entityId: string,
  questId: string,
  npcId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/quests/complete", token, { entityId, questId, npcId });
}

export async function talkToNpc(
  token: string,
  entityId: string,
  npcEntityId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/quests/talk", token, { entityId, npcEntityId });
}
