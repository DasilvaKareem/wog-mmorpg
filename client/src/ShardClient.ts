import type {
  ZoneResponse,
  ZoneListEntry,
  ClassInfo,
  RaceInfo,
  CharacterCreateResponse,
  OwnedCharacter,
  TerrainGridData,
  TerrainGridDataV2,
  ChunkPayloadV2,
  ChunkStreamResponse,
  ChunkInfo,
  ZoneChunkInfo,
} from "./types.js";
import { API_URL } from "./config.js";

export async function fetchZone(zoneId: string): Promise<ZoneResponse | null> {
  try {
    const res = await fetch(`${API_URL}/zones/${zoneId}`);
    if (res.status === 404) {
      // Zone doesn't exist yet — treat as empty
      return { zoneId, tick: 0, entities: {} };
    }
    if (!res.ok) return null;
    return (await res.json()) as ZoneResponse;
  } catch {
    return null;
  }
}

export async function fetchZoneList(): Promise<ZoneListEntry[]> {
  try {
    const res = await fetch(`${API_URL}/zones`);
    if (!res.ok) return [];
    const data: Record<string, { entityCount: number; tick: number }> =
      await res.json();
    return Object.entries(data).map(([zoneId, info]) => ({
      zoneId,
      entityCount: info.entityCount,
      tick: info.tick,
    }));
  } catch {
    return [];
  }
}

export async function fetchClasses(): Promise<ClassInfo[]> {
  try {
    const res = await fetch(`${API_URL}/character/classes`);
    if (!res.ok) return [];
    return (await res.json()) as ClassInfo[];
  } catch {
    return [];
  }
}

export async function fetchRaces(): Promise<RaceInfo[]> {
  try {
    const res = await fetch(`${API_URL}/character/races`);
    if (!res.ok) return [];
    return (await res.json()) as RaceInfo[];
  } catch {
    return [];
  }
}

export async function createCharacter(
  walletAddress: string,
  name: string,
  race: string,
  className: string
): Promise<CharacterCreateResponse | { error: string }> {
  try {
    const res = await fetch(`${API_URL}/character/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, name, race, className }),
    });
    return await res.json();
  } catch {
    return { error: "Network error" };
  }
}

export async function fetchCharacters(
  walletAddress: string
): Promise<OwnedCharacter[]> {
  try {
    const res = await fetch(`${API_URL}/character/${walletAddress}`);
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        detail = "";
      }
      console.error("Failed to fetch characters:", res.status, detail);
      return [];
    }
    const data: {
      characters: Array<Partial<OwnedCharacter> & { tokenId?: string; name?: string; description?: string }>;
    } = await res.json();

    return data.characters.map((character) => ({
      tokenId: character.tokenId ?? "unknown",
      name: character.name ?? "Unnamed Character",
      description: character.description ?? "",
      properties: {
        race: character.properties?.race ?? "unknown",
        class: character.properties?.class ?? "unknown",
        level: character.properties?.level ?? 1,
        xp: character.properties?.xp ?? 0,
        stats: {
          str: character.properties?.stats?.str ?? 0,
          def: character.properties?.stats?.def ?? 0,
          hp: character.properties?.stats?.hp ?? 0,
          agi: character.properties?.stats?.agi ?? 0,
          int: character.properties?.stats?.int ?? 0,
          mp: character.properties?.stats?.mp ?? 0,
          faith: character.properties?.stats?.faith ?? 0,
          luck: character.properties?.stats?.luck ?? 0,
        },
      },
    }));
  } catch {
    console.error("Failed to fetch characters: network error");
    return [];
  }
}

export interface WalletCharacterProgress {
  name: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  zoneId?: string;
  source: "live" | "nft";
}

export async function fetchWalletCharacterInZone(
  walletAddress: string,
  zoneId: string
): Promise<WalletCharacterProgress | null> {
  const zone = await fetchZone(zoneId);
  if (!zone) return null;

  const normalizedWallet = walletAddress.toLowerCase();
  for (const entity of Object.values(zone.entities)) {
    if (entity.type !== "player") continue;
    if (!entity.walletAddress) continue;
    if (entity.walletAddress.toLowerCase() !== normalizedWallet) continue;

    return {
      name: entity.name,
      level: entity.level ?? 1,
      xp: entity.xp ?? 0,
      hp: entity.hp,
      maxHp: entity.maxHp,
      zoneId,
      source: "live",
    };
  }

  return null;
}

export async function fetchTerrainGrid(
  zoneId: string
): Promise<TerrainGridData | null> {
  try {
    const res = await fetch(`${API_URL}/v1/terrain/zone/${zoneId}`);
    if (!res.ok) return null;
    return (await res.json()) as TerrainGridData;
  } catch {
    return null;
  }
}

export async function fetchTerrainGridV2(
  zoneId: string
): Promise<TerrainGridDataV2 | null> {
  try {
    const res = await fetch(`${API_URL}/v2/terrain/zone/${zoneId}`);
    if (!res.ok) return null;
    return (await res.json()) as TerrainGridDataV2;
  } catch {
    return null;
  }
}

// ── Chunk streaming API ──────────────────────────────────────────────

export async function fetchChunkInfo(): Promise<ChunkInfo | null> {
  try {
    const res = await fetch(`${API_URL}/v1/chunks/info`);
    if (!res.ok) return null;
    return (await res.json()) as ChunkInfo;
  } catch {
    return null;
  }
}

export async function fetchZoneChunkInfo(zoneId: string): Promise<ZoneChunkInfo | null> {
  try {
    const res = await fetch(`${API_URL}/v1/chunks/zone/${zoneId}`);
    if (!res.ok) return null;
    return (await res.json()) as ZoneChunkInfo;
  } catch {
    return null;
  }
}

export async function fetchChunkAt(
  zoneId: string, cx: number, cz: number
): Promise<ChunkPayloadV2 | null> {
  try {
    const res = await fetch(`${API_URL}/v1/chunks/at?zone=${zoneId}&cx=${cx}&cz=${cz}`);
    if (!res.ok) return null;
    return (await res.json()) as ChunkPayloadV2;
  } catch {
    return null;
  }
}

export async function fetchChunkStream(
  zoneId: string, worldX: number, worldZ: number, radius = 2
): Promise<ChunkStreamResponse | null> {
  try {
    const res = await fetch(
      `${API_URL}/v1/chunks/stream?zone=${zoneId}&x=${worldX}&z=${worldZ}&radius=${radius}`
    );
    if (!res.ok) return null;
    return (await res.json()) as ChunkStreamResponse;
  } catch {
    return null;
  }
}

export interface ProfessionInfo {
  professionType: string;
  name: string;
  description: string;
  cost: number;
}

export interface ProfessionsResponse {
  learned: string[];
  available: ProfessionInfo[];
}

export async function fetchProfessions(
  walletAddress: string
): Promise<ProfessionsResponse> {
  try {
    const res = await fetch(`${API_URL}/professions/${walletAddress}`);
    if (!res.ok) return { learned: [], available: [] };
    const data = await res.json();
    return {
      learned: data.learned || [],
      available: data.available || [],
    };
  } catch {
    return { learned: [], available: []};
  }
}
