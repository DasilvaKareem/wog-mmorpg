import type {
  ActivePlayersResponse,
  FriendRequestsResponse,
  FriendsResponse,
  ZoneResponse,
  TerrainData,
  WorldLayout,
  CharacterListResponse,
  ClassDef,
  RaceDef,
  QuestLogResponse,
  ZoneQuestsResponse,
  ShopResponse,
  SellPricesResponse,
  SellResult,
  RecycleResult,
  NpcDialogueResponse,
  TechniqueInfo,
  CraftingRecipe,
  GuildSummary,
  GuildProposal,
  GuildProposalType,
  MyGuildResponse,
  AuctionListing,
  ProfessionEntry,
  EnchantmentEntry,
  ArenaInfo,
  PvpLeaderboardEntry,
  InventoryResponse,
  ProfessionStatusResponse,
} from "./types.js";

// Prefer explicit env, then same-origin (dev proxy), then canonical prod shard,
// then local shard fallback.
const ENV_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";
const PRODUCTION_API_FALLBACK = "https://wog.preyanshu.me";
export const CANDIDATE_BASES = ENV_BASE
  ? [ENV_BASE]
  : import.meta.env.DEV
    ? ["", "http://localhost:3003", "http://127.0.0.1:3003", "http://localhost:3000", "http://127.0.0.1:3000"]
    : ["", PRODUCTION_API_FALLBACK];

function normalizeBase(base: string): string {
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function toUrl(base: string, path: string): string {
  const normalizedBase = normalizeBase(base);
  return normalizedBase ? `${normalizedBase}${path}` : path;
}

const NETWORK_TIMEOUT_MS = 12_000;

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryCount = 2,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
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
  throw lastError ?? new Error("Network request failed");
}

async function fetchJsonWithFallback<T>(path: string): Promise<T | null> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, path));
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

export async function fetchZonesBatch(zoneIds: string[]): Promise<Record<string, ZoneResponse>> {
  if (zoneIds.length === 0) return {};
  const query = encodeURIComponent(zoneIds.join(","));
  return (await fetchJsonWithFallback<Record<string, ZoneResponse>>(`/zones/batch?ids=${query}`)) ?? {};
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

export interface CatalogItem {
  tokenId: string;
  name: string;
  description?: string;
  category?: string;
  equipSlot?: string | null;
  armorSlot?: string | null;
  statBonuses?: Record<string, number>;
  maxDurability?: number | null;
}

let itemCatalogPromise: Promise<Map<string, CatalogItem>> | null = null;
export function fetchItemCatalog(): Promise<Map<string, CatalogItem>> {
  if (itemCatalogPromise) return itemCatalogPromise;
  itemCatalogPromise = (async () => {
    const list = (await fetchJsonWithFallback<CatalogItem[]>("/shop/catalog")) ?? [];
    const map = new Map<string, CatalogItem>();
    for (const item of list) map.set(String(item.tokenId), item);
    return map;
  })();
  return itemCatalogPromise;
}

export async function fetchFriends(walletAddress: string): Promise<FriendsResponse | null> {
  return fetchJsonWithFallback<FriendsResponse>(`/friends/${walletAddress}`);
}

export async function fetchFriendRequests(walletAddress: string): Promise<FriendRequestsResponse | null> {
  return fetchJsonWithFallback<FriendRequestsResponse>(`/friends/requests/${walletAddress}`);
}

async function postJsonWithFallback<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, path), {
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
      const res = await fetchWithRetry(toUrl(base, "/command"), {
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

export async function fetchCharacters(walletAddress: string, token: string | null = null): Promise<CharacterListResponse | null> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, `/character/${walletAddress}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
): Promise<{
  ok: boolean;
  character?: {
    name: string;
    race?: string;
    class?: string;
    level?: number;
    xp?: number;
  };
  bootstrap?: {
    status?: string;
    chainRegistrationStatus?: string | null;
  };
  error?: string;
}> {
  const payload = {
    walletAddress: body.walletAddress,
    name: body.characterName,
    race: body.raceId,
    className: body.classId,
  };
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, "/character/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return {
        ok: res.ok,
        character: data.character,
        bootstrap: data.bootstrap,
        error: data.error,
      };
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
      const res = await fetchWithRetry(toUrl(base, "/spawn"), {
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

export async function deployAgent(
  token: string,
  body: {
    walletAddress: string;
    characterName: string;
    characterTokenId?: string;
    raceId?: string;
    classId?: string;
  },
): Promise<{
  ok: boolean;
  entityId?: string;
  zoneId?: string;
  custodialWallet?: string;
  error?: string;
}> {
  // Stop any existing agent first (mirrors client web app's deploy flow).
  for (const base of CANDIDATE_BASES) {
    try {
      await fetchWithRetry(toUrl(base, "/agent/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ walletAddress: body.walletAddress }),
      });
      break;
    } catch {
      // Try next base; if all fail we'll still attempt deploy.
    }
  }

  const payload = {
    walletAddress: body.walletAddress,
    characterName: body.characterName.replace(/\s+the\s+\w+$/i, ""),
    characterTokenId: body.characterTokenId,
    raceId: body.raceId,
    classId: body.classId,
  };

  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, "/agent/deploy"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return {
        ok: res.ok,
        entityId: data.entityId,
        zoneId: data.zoneId,
        custodialWallet: data.custodialWallet,
        error: data.error,
      };
    } catch {
      // Try next candidate base.
    }
  }
  return { ok: false, error: "All API bases unreachable" };
}

export async function sendAgentChat(
  token: string,
  message: string,
): Promise<{ ok: boolean; response?: string; error?: string }> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, "/agent/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return { ok: true, response: data.response };
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

export async function abandonQuest(
  token: string,
  entityId: string,
  questId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/quests/abandon", token, { entityId, questId });
}

// ── Targeted P2P Trade ───────────────────────────────────────────

export interface IncomingTradeOffer {
  tradeId: number;
  sellerWallet: string;
  sellerName: string;
  tokenId: number;
  quantity: number;
  askPrice: number;
  itemName: string | null;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface TradeStatusResponse {
  tradeId: number;
  seller: string;
  buyer: string;
  tokenId: number;
  quantity: number;
  status: string;
  askPrice: number | string;
  bidPrice: number | string;
  matched: boolean;
}

export type OutgoingTradeStatus = "pending" | "matched" | "cancelled" | "expired";

export interface OutgoingTradeListing {
  tradeId: number;
  sellerWallet: string;
  sellerName: string;
  targetBuyerWallet: string | null;
  tokenId: number;
  quantity: number;
  askPrice: number;
  itemName: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  cancelledAtMs: number | null;
  matchedAtMs: number | null;
  status: OutgoingTradeStatus;
}

export async function listTrade(
  token: string,
  body: {
    sellerAddress: string;
    tokenId: number;
    quantity: number;
    askPrice: number;
    targetBuyerWallet?: string;
    expiresAtMs?: number;
  },
): Promise<{ ok: boolean; tradeId?: number; expiresAtMs?: number; error?: string }> {
  return postJsonWithFallback("/trade/list", token, body);
}

export async function acceptTradeOffer(
  token: string,
  body: { tradeId: number; buyerAddress: string; bidPrice: number },
): Promise<{ ok: boolean; matched?: boolean; error?: string; reason?: string }> {
  return postJsonWithFallback("/trade/offer", token, body);
}

export async function rejectTradeOffer(
  token: string,
  tradeId: number,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/trade/reject", token, { tradeId });
}

export async function fetchIncomingTrades(
  token: string,
  wallet: string,
): Promise<{ offers: IncomingTradeOffer[] } | null> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, `/trade/incoming/${wallet}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      return (await res.json()) as { offers: IncomingTradeOffer[] };
    } catch {
      // Try next candidate base.
    }
  }
  return null;
}

export async function fetchTradeStatus(
  tradeId: number,
): Promise<TradeStatusResponse | null> {
  return fetchJsonWithFallback<TradeStatusResponse>(`/trade/${tradeId}`);
}

export async function fetchOutgoingTrades(
  token: string,
  wallet: string,
): Promise<{ offers: OutgoingTradeListing[] } | null> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, `/trade/outgoing/${wallet}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      return (await res.json()) as { offers: OutgoingTradeListing[] };
    } catch {
      // Try next candidate base.
    }
  }
  return null;
}

export async function cancelTrade(
  token: string,
  tradeId: number,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/trade/cancel", token, { tradeId });
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

export async function fetchSellPrices(merchantEntityId: string): Promise<SellPricesResponse | null> {
  return fetchJsonWithFallback<SellPricesResponse>(`/shop/sell-prices/${merchantEntityId}`);
}

export async function sellShopItem(
  token: string,
  sellerAddress: string,
  merchantEntityId: string,
  tokenId: number,
  quantity: number,
): Promise<{ ok: boolean; data?: SellResult; error?: string }> {
  return postJsonWithFallback("/shop/sell", token, {
    sellerAddress, merchantEntityId, tokenId, quantity,
  });
}

export async function recycleItem(
  token: string,
  sellerAddress: string,
  tokenId: number,
  quantity: number,
): Promise<{ ok: boolean; data?: RecycleResult; error?: string }> {
  return postJsonWithFallback("/shop/recycle", token, {
    sellerAddress, tokenId, quantity,
  });
}

export async function fetchInventory(walletAddress: string): Promise<InventoryResponse | null> {
  return fetchJsonWithFallback<InventoryResponse>(`/inventory/${walletAddress}`);
}

export interface WalletBalanceResponse {
  address: string;
  copper: number;
  gold: string;
  onChainGold?: string;
  spentGold?: string;
}

export async function fetchWalletBalance(walletAddress: string): Promise<WalletBalanceResponse | null> {
  return fetchJsonWithFallback<WalletBalanceResponse>(`/wallet/${walletAddress}/balance`);
}

export async function equipItem(
  token: string,
  body: { zoneId: string; entityId: string; tokenId: number; instanceId?: string },
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/equipment/equip", token, body);
}

export async function unequipItem(
  token: string,
  body: { zoneId: string; entityId: string; slot: string },
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/equipment/unequip", token, body);
}

export async function fetchProfessionStatus(walletAddress: string): Promise<ProfessionStatusResponse | null> {
  return fetchJsonWithFallback<ProfessionStatusResponse>(`/professions/${walletAddress}`);
}

export async function sendFriendRequest(
  token: string,
  fromWallet: string,
  toWallet: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/friends/request", token, { fromWallet, toWallet });
}

export async function sendFriendRequestByName(
  token: string,
  fromWallet: string,
  toName: string,
): Promise<{ ok: boolean; error?: string; resolvedWallet?: string }> {
  return postJsonWithFallback("/friends/request-by-name", token, { fromWallet, toName });
}

export async function acceptFriendRequest(
  token: string,
  wallet: string,
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/friends/accept", token, { wallet, requestId });
}

export async function declineFriendRequest(
  token: string,
  wallet: string,
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/friends/decline", token, { wallet, requestId });
}

export async function removeFriend(
  token: string,
  wallet: string,
  targetWallet: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/friends/remove", token, { wallet, targetWallet });
}

export async function inviteToParty(
  token: string,
  fromEntityId: string,
  fromZoneId: string,
  toCustodialWallet: string,
): Promise<{ ok: boolean; error?: string; inviteId?: string }> {
  return postJsonWithFallback("/party/invite-champion", token, { fromEntityId, fromZoneId, toCustodialWallet });
}

export async function fetchPartyStatus(custodialWallet: string): Promise<{
  inParty: boolean;
  partyId?: string;
  members: Array<{ entityId: string; name: string; level: number; hp: number; maxHp: number; classId?: string; isLeader: boolean }>;
} | null> {
  return fetchJsonWithFallback(`/party/status/${custodialWallet}`);
}

export async function leaveParty(
  token: string,
  custodialWallet: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/party/leave-wallet", token, { custodialWallet });
}

export async function acceptPartyInvite(
  token: string,
  custodialWallet: string,
  inviteId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/party/accept-invite", token, { custodialWallet, inviteId });
}

export async function declinePartyInvite(
  token: string,
  custodialWallet: string,
  inviteId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/party/decline-invite", token, { custodialWallet, inviteId });
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

export async function logoutCharacter(
  token: string,
  body: { zoneId: string; entityId: string },
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/logout", token, body);
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

export async function sendNpcAction(
  token: string,
  npcEntityId: string,
  entityId: string,
  action: import("./types.js").NpcActionBinding,
): Promise<{ ok: boolean; data?: { ok: boolean; result?: Record<string, unknown>; dialogue: NpcDialogueResponse }; error?: string }> {
  return postJsonWithFallback("/npc/action", token, {
    npcEntityId, entityId, action,
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

export async function joinGuild(
  token: string,
  guildId: number,
  memberAddress: string,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(`/guild/${guildId}/join`, token, { memberAddress });
}

export async function fetchMyGuild(walletAddress: string): Promise<MyGuildResponse | null> {
  return fetchJsonWithFallback<MyGuildResponse>(`/guild/wallet/${walletAddress}`);
}

export async function leaveGuild(
  token: string,
  guildId: number,
  memberAddress: string,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(`/guild/${guildId}/leave`, token, { memberAddress });
}

export async function inviteToGuild(
  token: string,
  guildId: number,
  memberAddress: string,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(`/guild/${guildId}/invite`, token, { memberAddress });
}

export async function depositToGuild(
  token: string,
  guildId: number,
  memberAddress: string,
  amount: number,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(`/guild/${guildId}/deposit`, token, { memberAddress, amount });
}

export async function proposeGuildAction(
  token: string,
  guildId: number,
  body: {
    proposerAddress: string;
    proposalType: GuildProposalType | string;
    description: string;
    targetAddress?: string;
    targetAmount?: number;
  },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(`/guild/${guildId}/propose`, token, body);
}

export async function voteOnGuildProposal(
  token: string,
  guildId: number,
  body: { proposalId: number; voterAddress: string; vote: boolean },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback(`/guild/${guildId}/vote`, token, body);
}

export async function fetchGuildProposals(
  guildId: number,
  status?: string,
): Promise<GuildProposal[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return (await fetchJsonWithFallback<GuildProposal[]>(`/guild/${guildId}/proposals${qs}`)) ?? [];
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

export async function joinPvpPartyQueue(
  token: string,
  body: { leaderId: string; format: string },
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return postJsonWithFallback("/api/pvp/queue/join-party", token, body);
}

/**
 * Pin the agent's quest behavior to a single quest, or clear focus by passing
 * null. Server biases doQuestObjective's combat/gather work to this quest and
 * auto-clears the focus once the quest leaves the active list.
 */
export async function focusAgentQuest(
  token: string,
  questId: string | null,
): Promise<{ ok: boolean; focusedQuestId?: string | null; error?: string }> {
  return postJsonWithFallback("/agent/focus-quest", token, { questId });
}

export async function cancelPvpBattle(
  token: string,
  battleId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback(`/api/pvp/battle/${battleId}/cancel`, token, {});
}

// ── Duels ────────────────────────────────────────────────────────

export async function challengeDuel(
  token: string,
  body: { targetWallet: string; format?: string },
): Promise<{ ok: boolean; challengeId?: string; expiresAtMs?: number; error?: string }> {
  return postJsonWithFallback("/api/pvp/duel/challenge", token, body);
}

export async function acceptDuel(
  token: string,
  challengeId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/api/pvp/duel/accept", token, { challengeId });
}

export async function declineDuel(
  token: string,
  challengeId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/api/pvp/duel/decline", token, { challengeId });
}

// ── Prediction markets ────────────────────────────────────────────

export interface PredictionPoolStats {
  poolId: string;
  battleId: string;
  status: string;
  totalStaked: string;
  participantCount: number;
  lockTimestamp: number;
  timeUntilLock?: number;
}

export interface BetHistoryRecord {
  positionId: string;
  poolId: string;
  battleId: string;
  choice: "RED" | "BLUE";
  amount: string;
  timestamp: number;
  result?: "win" | "loss";
  payout?: string;
  profit?: string;
  claimed: boolean;
}

export async function fetchActivePools(): Promise<PredictionPoolStats[]> {
  const data = await fetchJsonWithFallback<{ pools: PredictionPoolStats[] }>(
    "/api/prediction/pools/active",
  );
  return data?.pools ?? [];
}

export async function placeBet(
  token: string,
  body: { poolId: string; choice: "RED" | "BLUE"; amount: number; walletAddress: string },
): Promise<{ ok: boolean; position?: { positionId: string }; error?: string }> {
  return postJsonWithFallback("/api/prediction/bet", token, body);
}

export async function claimWinnings(
  token: string,
  poolId: string,
  walletAddress: string,
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  return postJsonWithFallback(`/api/prediction/pool/${poolId}/claim`, token, { walletAddress });
}

export async function fetchBettingHistory(
  walletAddress: string,
): Promise<{ bets: BetHistoryRecord[]; totalStaked: string; netProfit: string } | null> {
  const data = await fetchJsonWithFallback<{
    history: { bets: BetHistoryRecord[]; totalStaked: string; netProfit: string };
  }>(`/api/prediction/history/${walletAddress}`);
  return data?.history ?? null;
}

export async function fetchPvpLeaderboard(): Promise<PvpLeaderboardEntry[]> {
  const data = await fetchJsonWithFallback<{ leaderboard: PvpLeaderboardEntry[] }>("/api/pvp/leaderboard");
  return data?.leaderboard ?? [];
}

export async function fetchActiveBattles(): Promise<ActiveBattle[]> {
  const data = await fetchJsonWithFallback<{ battles: ActiveBattle[] }>("/api/pvp/battles/active");
  return data?.battles ?? [];
}

export async function fetchQueueStatus(agentId?: string): Promise<{ queues: QueueStatusEntry[]; queuedFormats: string[] }> {
  const url = agentId ? `/api/pvp/queue/all?agentId=${encodeURIComponent(agentId)}` : "/api/pvp/queue/all";
  const data = await fetchJsonWithFallback<{ queues: QueueStatusEntry[]; queuedFormats?: string[] }>(url);
  return { queues: data?.queues ?? [], queuedFormats: data?.queuedFormats ?? [] };
}

export async function leavePvpQueue(
  token: string,
  body: { agentId: string; format: string },
): Promise<{ ok: boolean; error?: string }> {
  return postJsonWithFallback("/api/pvp/queue/leave", token, body);
}

export async function fetchCurrentBattle(agentId: string): Promise<{ inBattle: boolean; battleId?: string; status?: string } | null> {
  return fetchJsonWithFallback<{ inBattle: boolean; battleId?: string; status?: string }>(`/api/pvp/player/${encodeURIComponent(agentId)}/current-battle`);
}

export async function fetchBattleDetails(battleId: string): Promise<BattleDetails | null> {
  return fetchJsonWithFallback<BattleDetails>(`/api/pvp/battle/${encodeURIComponent(battleId)}`);
}

export interface ActiveBattle {
  battleId: string;
  status: string;
  config: {
    format: string;
    arena: { name: string };
    teamRed: Array<{ name: string }>;
    teamBlue: Array<{ name: string }>;
  };
  turnCount: number;
  winner?: "red" | "blue";
}

export interface QueueStatusEntry {
  format: string;
  playersInQueue: number;
  playersNeeded: number;
  averageWaitTime: number;
}

export interface BattleDetails {
  battleId: string;
  status: string;
  turnCount: number;
  winner?: "red" | "blue";
  config: {
    format: string;
    arena: { name: string };
    teamRed: Array<{ name: string; hp: number; maxHp: number; level: number }>;
    teamBlue: Array<{ name: string; hp: number; maxHp: number; level: number }>;
  };
  combatLog?: Array<{ turn: number; description: string }>;
  /**
   * MVP may be returned as an object by the new arena adapter or as a bare
   * entity ID by the legacy adapter. Renderers must handle both.
   */
  mvp?: string | { name: string; damage: number };
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

// ── Nanopayments ─────────────────────────────────────────────────

export interface NanopayStatus {
  budget: number;
  spent: number;
  remaining: number;
  freeGranted: boolean;
  needsTopUp: boolean;
  lowBalance: boolean;
  hasAuth: boolean;
}

export async function fetchNanopayStatus(wallet: string, token: string): Promise<NanopayStatus | null> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, `/nanopay/status/${encodeURIComponent(wallet)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      return (await res.json()) as NanopayStatus;
    } catch { /* try next */ }
  }
  return null;
}

export async function submitTopUp(
  token: string,
  budgetUsdc: number,
): Promise<{ ok: boolean; balance?: NanopayStatus; error?: string }> {
  const result = await postJsonWithFallback<{ balance: NanopayStatus }>("/nanopay/topup", token, { budgetUsdc });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, balance: result.data?.balance };
}

export interface SpendBreakdown {
  breakdown: Record<string, number>;
  topups: Array<{ ts: number; amount: number }>;
}

export async function fetchNanopayBreakdown(wallet: string, token: string): Promise<SpendBreakdown | null> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetchWithRetry(toUrl(base, `/nanopay/breakdown/${encodeURIComponent(wallet)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      return (await res.json()) as SpendBreakdown;
    } catch { /* try next */ }
  }
  return null;
}

export async function fetchNanopayGatewayInfo(): Promise<{
  gatewayWalletContract: string;
  sellerAddress: string;
  defaultSessionBudgetUsdc: number;
  freeStarterUsdc: number;
  pricing: Record<string, number>;
} | null> {
  return fetchJsonWithFallback("/nanopay/gateway-info");
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

// ── Telegram notifications ────────────────────────────────────────

export async function fetchTelegramStatus(wallet: string): Promise<{ linked: boolean } | null> {
  return fetchJsonWithFallback(`/notifications/telegram/status/${encodeURIComponent(wallet)}`);
}

export async function fetchTelegramBotLink(wallet: string): Promise<{ url: string | null; botUsername: string | null } | null> {
  return fetchJsonWithFallback(`/notifications/telegram/bot-link/${encodeURIComponent(wallet)}`);
}
