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
  ShopResponse,
  NpcDialogueResponse,
  TechniqueInfo,
  CraftingRecipe,
  GuildSummary,
  AuctionListing,
  ProfessionEntry,
  EnchantmentEntry,
  ArenaInfo,
  PvpLeaderboardEntry,
} from "./types.js";

// Prefer explicit env, then same-origin (dev proxy), then local shard fallback.
const ENV_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";
export const CANDIDATE_BASES = ENV_BASE
  ? [ENV_BASE]
  : ["", "http://localhost:3003", "http://127.0.0.1:3003", "http://localhost:3000", "http://127.0.0.1:3000"];

function normalizeBase(base: string): string {
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function toUrl(base: string, path: string): string {
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
  body: {
    zoneId: string;
    entityId: string;
    action: string;
    x?: number;
    y?: number;
    targetId?: string;
    runEnabled?: boolean;
  }
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
): Promise<{
  ok: boolean;
  spawned?: { id: string };
  zone?: string;
  zoneId?: string;
  entityId?: string;
  error?: string;
}> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, "/spawn"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return {
        ok: res.ok,
        spawned: data.spawned,
        zone: data.zone,
        zoneId: data.zoneId,
        entityId: data.entityId,
        error: data.error,
      };
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

// ── NPC interaction endpoints ─────────────────────────────────────

export async function fetchShopInventory(entityId: string): Promise<ShopResponse | null> {
  return fetchJsonWithFallback<ShopResponse>(`/shop/npc/${entityId}`);
}

export async function buyShopItem(
  token: string,
  buyerAddress: string,
  tokenId: number,
  quantity: number,
  merchantEntityId: string,
): Promise<{ ok: boolean; data?: { item: string; totalCost: number; remainingGold: number }; error?: string }> {
  return postJsonWithFallback("/shop/buy", token, {
    buyerAddress, tokenId, quantity, merchantEntityId,
  });
}

export async function sendFriendRequest(
  token: string,
  fromWallet: string,
  toWallet: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/friends/request", token, { fromWallet, toWallet });
}

export async function sendInboxMessage(
  token: string,
  body: {
    to: string;
    type?: "direct" | "trade-request" | "party-invite" | "broadcast";
    body: string;
    data?: Record<string, unknown>;
  },
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/inbox/send", token, body);
}

export async function sendNpcDialogue(
  token: string,
  npcEntityId: string,
  entityId: string,
  message: string,
  recentHistory: { role: string; content: string }[],
): Promise<{ ok: boolean; data?: NpcDialogueResponse; error?: string }> {
  return postJsonWithFallback("/npc/dialogue", token, {
    npcEntityId, entityId, message, recentHistory,
  });
}

export async function fetchAvailableTechniques(entityId: string): Promise<TechniqueInfo[] | null> {
  const data = await fetchJsonWithFallback<{ techniques: TechniqueInfo[] }>(`/techniques/available/${entityId}`);
  return data?.techniques ?? null;
}

export async function learnTechnique(
  token: string,
  body: { entityId: string; techniqueId: string; trainerEntityId: string; zoneId: string },
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/techniques/learn", token, body);
}

// ── Crafting stations (generic) ───────────────────────────────────

export async function fetchRecipes(path: string): Promise<CraftingRecipe[] | null> {
  const data = await fetchJsonWithFallback<CraftingRecipe[] | { recipes: CraftingRecipe[] }>(path);
  if (!data) return null;
  return Array.isArray(data) ? data : data.recipes ?? null;
}

export async function craftAtStation(
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(path, token, body);
}

// ── Guild ─────────────────────────────────────────────────────────

export async function fetchGuildRegistrar(entityId: string): Promise<any | null> {
  return fetchJsonWithFallback(`/guild/registrar/${entityId}`);
}

export async function fetchGuilds(): Promise<GuildSummary[]> {
  return (await fetchJsonWithFallback<GuildSummary[]>("/guilds")) ?? [];
}

export async function createGuild(
  token: string,
  body: { founderAddress: string; name: string; description: string; initialDeposit: number },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback("/guild/create", token, body);
}

// ── Auction House ─────────────────────────────────────────────────

export async function fetchAuctions(zoneId: string): Promise<AuctionListing[]> {
  const data = await fetchJsonWithFallback<AuctionListing[]>(`/auctionhouse/${zoneId}/auctions`);
  return data ?? [];
}

export async function bidAuction(
  token: string,
  zoneId: string,
  body: { auctionId: string; bidderAddress: string; bidAmount: number },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(`/auctionhouse/${zoneId}/bid`, token, body);
}

export async function buyoutAuction(
  token: string,
  zoneId: string,
  body: { auctionId: string; buyerAddress: string },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(`/auctionhouse/${zoneId}/buyout`, token, body);
}

// ── Arena / PvP ───────────────────────────────────────────────────

export async function fetchColiseumInfo(entityId: string): Promise<ArenaInfo | null> {
  return fetchJsonWithFallback<ArenaInfo>(`/coliseum/npc/${entityId}`);
}

export async function joinPvpQueue(
  token: string,
  body: { agentId: string; walletAddress: string; characterTokenId?: string; level: number; format: string },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback("/api/pvp/queue/join", token, body);
}

export async function fetchPvpLeaderboard(): Promise<PvpLeaderboardEntry[]> {
  const data = await fetchJsonWithFallback<{ leaderboard: PvpLeaderboardEntry[] }>("/api/pvp/leaderboard");
  return data?.leaderboard ?? [];
}

// ── Professions ───────────────────────────────────────────────────

export async function fetchProfessionCatalog(): Promise<ProfessionEntry[]> {
  const data = await fetchJsonWithFallback<ProfessionEntry[]>("/professions/catalog");
  return data ?? [];
}

export async function learnProfession(
  token: string,
  body: { walletAddress: string; zoneId: string; entityId: string; trainerId: string; professionId: string },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback("/professions/learn", token, body);
}

// ── Enchanting ────────────────────────────────────────────────────

export async function fetchEnchantingCatalog(): Promise<EnchantmentEntry[]> {
  const data = await fetchJsonWithFallback<EnchantmentEntry[]>("/enchanting/catalog");
  return data ?? [];
}

export async function applyEnchantment(
  token: string,
  body: { walletAddress: string; zoneId: string; entityId: string; altarId: string; enchantmentElixirTokenId: string; equipmentSlot: string },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback("/enchanting/apply", token, body);
}
