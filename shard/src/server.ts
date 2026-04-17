import "dotenv/config";
import "./config/devLocalContracts.js";
import { runMigrations } from "./db.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerZoneRuntime } from "./world/zoneRuntime.js";
import { registerSpawnOrders } from "./world/spawnOrders.js";
import { registerStateApi } from "./routes/stateApi.js";
import { registerStatsRoutes } from "./routes/statsRoutes.js";
import { registerCommands } from "./social/commands.js";
import { registerWalletRoutes, startWalletRegistrationWorker } from "./blockchain/wallet.js";
import { registerShopRoutes } from "./economy/shop.js";
import { registerCharacterRoutes } from "./character/characterRoutes.js";
import { registerTradeRoutes } from "./economy/trade.js";
import { registerEquipmentRoutes } from "./items/equipment.js";
import { registerAuctionHouseRoutes } from "./economy/auctionHouse.js";
import { registerAuctionHouseTick } from "./economy/auctionHouseTick.js";
import { registerGuildRoutes } from "./economy/guild.js";
import { registerGuildTick } from "./economy/guildTick.js";
import { registerGuildVaultRoutes } from "./economy/guildVault.js";
import { spawnNpcs, tickMobRespawner } from "./world/npcSpawner.js";
import { initMerchantWallets, registerMerchantAgentTick, getMerchantCount } from "./world/merchantAgent.js";
import { registerMiningRoutes } from "./professions/mining.js";
import { spawnOreNodes } from "./resources/oreSpawner.js";
import { registerProfessionRoutes } from "./professions/professions.js";
import { registerCraftingRoutes } from "./professions/crafting.js";
import { registerQuestRoutes } from "./social/questSystem.js";
import { registerHerbalismRoutes } from "./professions/herbalism.js";
import { spawnFlowerNodes } from "./resources/flowerSpawner.js";
import { spawnNectarNodes } from "./resources/nectarSpawner.js";
import { registerAlchemyRoutes } from "./professions/alchemy.js";
import { registerTechniqueRoutes } from "./combat/techniqueRoutes.js";
import { registerEnchantingRoutes } from "./professions/enchanting.js";
import { registerEventRoutes } from "./social/eventRoutes.js";
import { registerTerrainRoutes } from "./world/terrainRoutes.js";
import { registerNpcRoutes } from "./world/npcRoutes.js";
import { registerSkinningRoutes } from "./professions/skinning.js";
import { registerCookingRoutes } from "./professions/cooking.js";
import { registerPartyRoutes } from "./social/partySystem.js";
import { registerFriendsRoutes } from "./social/friendsSystem.js";
import { registerAuthRoutes } from "./auth/auth.js";
import { registerZoneTransitionRoutes } from "./world/zoneTransition.js";
import { registerLeaderboardRoutes } from "./social/leaderboard.js";
import { registerLeatherworkingRoutes } from "./professions/leatherworking.js";
import { registerUpgradingRoutes } from "./items/upgrading.js";
import { registerJewelcraftingRoutes } from "./professions/jewelcrafting.js";
import { getAllAuctionsFromCache, hydrateAuctionCacheFromProjections } from "./economy/auctionHouseChain.js";
import { registerPvPRoutes } from "./combat/pvpRoutes.js";
import { registerPredictionRoutes } from "./economy/predictionRoutes.js";
import { registerX402Routes } from "./economy/x402Routes.js";
import { registerAgentChatRoutes } from "./agents/agentChatRoutes.js";
import { registerAgentInboxRoutes } from "./agents/agentInboxRoutes.js";
import { registerA2ARoutes } from "./agents/a2aRoutes.js";
import { registerAgentDirectoryRoutes } from "./agents/agentDirectoryRoutes.js";
import { agentManager } from "./agents/agentManager.js";
import { registerItemRngRoutes } from "./items/itemRng.js";
import { registerMarketplaceRoutes } from "./economy/marketplace.js";
import { registerDirectBuyRoutes } from "./marketplace/directBuyRoutes.js";
import { registerMarketplaceAdminRoutes } from "./marketplace/adminRoutes.js";
import { registerChainAdminRoutes } from "./blockchain/adminRoutes.js";
import { registerRentalRoutes } from "./marketplace/rentalRoutes.js";
import { registerItemCatalogRoutes } from "./items/itemCatalogRoutes.js";
import { registerReputationRoutes } from "./economy/reputationRoutes.js";
import { registerNameServiceRoutes } from "./blockchain/nameServiceRoutes.js";
import { startNameServiceWorker } from "./blockchain/nameServiceChain.js";
import { registerDungeonGateRoutes } from "./world/dungeonGate.js";
import { registerEssenceTechniqueRoutes } from "./combat/essenceTechniqueRoutes.js";
import { registerForgedTechniqueRoutes } from "./combat/forgedTechniqueRoutes.js";
import { registerDungeonGateTick } from "./world/dungeonGateTick.js";
import { initDungeonLootTables } from "./world/dungeonLootTables.js";
import { startGuildNameCacheRefresh } from "./economy/guildChain.js";
import { registerWorldMapRoutes } from "./world/worldMapRoutes.js";
import { registerDiaryRoutes } from "./social/diary.js";
import { registerFarcasterAuthRoutes } from "./auth/farcasterAuth.js";
import { registerNotificationRoutes } from "./social/notificationRoutes.js";
import { registerWebPushRoutes } from "./social/webPushRoutes.js";
import { initWebPushAlerts } from "./social/webPushService.js";
import { registerGoldPurchaseRoutes } from "./economy/goldPurchaseRoutes.js";
import { registerNpcDialogueRoutes } from "./social/npcDialogueRoutes.js";
import { registerQuestGraphRoutes } from "./social/questGraphRoutes.js";
import { initTelegramBot } from "./social/telegramNotifications.js";
import { initWorldMapStore } from "./world/worldMapStore.js";
import { registerFarmingRoutes } from "./farming/farming.js";
import { registerPlotRoutes } from "./farming/plotRoutes.js";
import { registerBuildingRoutes } from "./farming/buildingRoutes.js";
import { startPlotOperationWorker } from "./farming/plotSystem.js";
import { spawnCropNodes } from "./farming/cropSpawner.js";
import { enqueueGoldMint, getTxStats } from "./blockchain/blockchain.js";
import { startChainBatcher, stopChainBatcher, getChainBatcherStats } from "./blockchain/chainBatcher.js";
import { getChainIntentStats, listChainIntents } from "./blockchain/chainIntentStore.js";
import { getWorldLayout } from "./world/worldLayout.js";
import { getAllEntities, getEntity, removeLivePlayerEntityEventually, restoreLivePlayersFromPostgres, unregisterSpawnedWallet } from "./world/zoneRuntime.js";
import { saveCharacter } from "./character/characterStore.js";
import { buildVerifiedIdentityPatch } from "./character/characterIdentityPersistence.js";
import { authenticateRequest } from "./auth/auth.js";
import { getLearnedProfessions } from "./professions/professions.js";
import { biteProvider, probeBiteRpc, SKALE_BASE_CHAIN_ID, SKALE_BASE_RPC_URL } from "./blockchain/biteChain.js";
import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "./redis.js";
import { pvpBattleManager } from "./combat/pvpBattleManager.js";
import { startCharacterBootstrapWorker } from "./character/characterBootstrap.js";
import { startReputationChainWorker } from "./economy/reputationChain.js";
import { startChainOperationReplayWorker } from "./blockchain/chainOperationStore.js";
import { ensureGameSchema, getGameSchemaHealth } from "./db/gameSchema.js";
import { migrateRedisToPostgres } from "./character/migrateRedisToPostgres.js";
import { initPostgres, isPostgresConfigured } from "./db/postgres.js";
import { startAgentRuntimeReconciler } from "./services/agentRuntimeService.js";

const server = Fastify({ logger: true });
const ADMIN_SECRET = process.env.ADMIN_SECRET?.trim() || null;
const REQUIRE_REDIS_PERSISTENCE = !["0", "false", "no", "off"].includes(
  (process.env.REQUIRE_REDIS_PERSISTENCE ?? "true").trim().toLowerCase()
);
const LOCAL_TEST_MODE = (process.env.LOCAL_TEST_MODE ?? "").trim().toLowerCase();
const SKIP_MERCHANT_BOOTSTRAP = LOCAL_TEST_MODE === "core";
const LAZY_RUNTIME_HYDRATION = !["0", "false", "no", "off"].includes(
  (process.env.LAZY_RUNTIME_HYDRATION ?? "true").trim().toLowerCase()
);
const RUN_BACKGROUND_WORKERS = !["0", "false", "no", "off"].includes(
  (process.env.RUN_BACKGROUND_WORKERS ?? "true").trim().toLowerCase()
);
const HOTPATH_CONCURRENCY_LIMITS_ENABLED = !["0", "false", "no", "off"].includes(
  (process.env.HOTPATH_CONCURRENCY_LIMITS_ENABLED ?? "true").trim().toLowerCase()
);
const WORLD_LAYOUT_CACHE_MS = Math.max(
  50,
  Number.parseInt(process.env.WORLD_LAYOUT_CACHE_MS ?? "1000", 10) || 1000
);
const GUILD_CACHE_REFRESH_INTERVAL_MS = Math.max(
  30_000,
  Number.parseInt(process.env.GUILD_CACHE_REFRESH_INTERVAL_MS ?? "300000", 10) || 300_000
);
const MOB_RESPAWNER_INTERVAL_MS = Math.max(
  1_000,
  Number.parseInt(process.env.MOB_RESPAWNER_INTERVAL_MS ?? "5000", 10) || 5_000
);
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "https://wog.urbantech.dev",
  "https://worldofgeneva.com",
  "https://www.worldofgeneva.com",
  "https://storage.googleapis.com",
];

type RateLimitRule = {
  key: string;
  methods?: string[];
  exact?: string;
  prefix?: string;
  bucketByPath?: boolean;
  max: number;
  windowMs: number;
};

const RATE_LIMIT_RULES: RateLimitRule[] = [
  { key: "auth-challenge", methods: ["GET"], exact: "/auth/challenge", max: 20, windowMs: 60_000 },
  { key: "auth-verify", methods: ["POST"], exact: "/auth/verify", max: 12, windowMs: 60_000 },
  { key: "auth-farcaster", methods: ["POST"], exact: "/auth/farcaster", max: 12, windowMs: 60_000 },
  { key: "wallet-register", methods: ["POST"], exact: "/wallet/register", max: 10, windowMs: 60_000 },
  { key: "character-create", methods: ["POST"], exact: "/character/create", max: 10, windowMs: 60_000 },
  { key: "x402-deploy", methods: ["POST"], exact: "/x402/deploy", max: 6, windowMs: 60_000 },
  { key: "admin", methods: ["POST"], prefix: "/admin/", max: 5, windowMs: 60_000 },
  // Protect high-volume read paths from polling storms.
  { key: "world-layout", methods: ["GET"], exact: "/world/layout", max: 60, windowMs: 60_000 },
  { key: "zones-list", methods: ["GET"], exact: "/zones", max: 120, windowMs: 60_000 },
  { key: "zones-detail", methods: ["GET"], prefix: "/zones/", max: 300, windowMs: 60_000 },
  { key: "players-active", methods: ["GET"], exact: "/players/active", max: 60, windowMs: 60_000 },
  { key: "world-state", methods: ["GET"], exact: "/state", max: 12, windowMs: 60_000 },
  { key: "wallet-read", methods: ["GET"], prefix: "/wallet/", max: 120, windowMs: 60_000 },
  { key: "agent-status", methods: ["GET"], prefix: "/agent/status/", max: 120, windowMs: 60_000 },
  { key: "inbox-read", methods: ["GET"], prefix: "/inbox/", max: 120, windowMs: 60_000 },
  { key: "admin-read", methods: ["GET"], prefix: "/admin/", max: 30, windowMs: 60_000 },
  // Agent console messages should not get blocked by unrelated gameplay POSTs from the same IP.
  { key: "agent-post", methods: ["POST"], prefix: "/agent/", max: 180, windowMs: 60_000 },
  { key: "inbox-post", methods: ["POST"], prefix: "/inbox/", max: 120, windowMs: 60_000 },
  { key: "marketplace-direct", methods: ["POST"], prefix: "/marketplace/direct/", bucketByPath: true, max: 30, windowMs: 60_000 },
  { key: "rentals", methods: ["POST"], prefix: "/rentals/", bucketByPath: true, max: 30, windowMs: 60_000 },
  // Keep generic gameplay writes separated by endpoint so equip/sell/chat do not starve each other.
  { key: "mutating", methods: ["POST", "PUT", "PATCH", "DELETE"], bucketByPath: true, max: 120, windowMs: 60_000 },
];

const rateLimitHits = new Map<string, number[]>();
const RATE_LIMIT_STALE_MS = 5 * 60_000;

type ConcurrencyRule = {
  key: string;
  methods?: string[];
  exact?: string;
  prefix?: string;
  maxInFlight: number;
};

const CONCURRENCY_RULES: ConcurrencyRule[] = [
  { key: "world-layout", methods: ["GET"], exact: "/world/layout", maxInFlight: 12 },
  { key: "zones-detail", methods: ["GET"], prefix: "/zones/", maxInFlight: 30 },
  { key: "wallet-read", methods: ["GET"], prefix: "/wallet/", maxInFlight: 20 },
  { key: "agent-status", methods: ["GET"], prefix: "/agent/status/", maxInFlight: 20 },
  { key: "inbox-read", methods: ["GET"], prefix: "/inbox/", maxInFlight: 20 },
  { key: "world-state", methods: ["GET"], exact: "/state", maxInFlight: 4 },
];

const inFlightByRule = new Map<string, number>();

function pruneRateLimitHits(now = Date.now()): void {
  const cutoff = now - RATE_LIMIT_STALE_MS;
  for (const [bucketKey, hits] of rateLimitHits.entries()) {
    const recent = hits.filter((ts) => ts >= cutoff);
    if (recent.length === 0) {
      rateLimitHits.delete(bucketKey);
      continue;
    }
    if (recent.length !== hits.length) {
      rateLimitHits.set(bucketKey, recent);
    }
  }
}

setInterval(() => {
  pruneRateLimitHits();
}, 60_000).unref();

function getAllowedCorsOrigins(): Set<string> {
  const configured = process.env.CORS_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...(configured ?? []), ...DEFAULT_CORS_ORIGINS]);
}

function isAllowedCorsOrigin(origin: string, allowed: Set<string>): boolean {
  if (allowed.has(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "worldofgeneva.com" || host.endsWith(".worldofgeneva.com");
  } catch {
    return false;
  }
}

function getRateLimitRule(method: string, url: string): RateLimitRule | null {
  const path = getRequestPath(url);

  for (const rule of RATE_LIMIT_RULES) {
    if (rule.methods && !rule.methods.includes(method)) continue;
    if (rule.exact && rule.exact !== path) continue;
    if (rule.prefix && !path.startsWith(rule.prefix)) continue;
    return rule;
  }

  return null;
}

function getConcurrencyRule(method: string, path: string): ConcurrencyRule | null {
  for (const rule of CONCURRENCY_RULES) {
    if (rule.methods && !rule.methods.includes(method)) continue;
    if (rule.exact && rule.exact !== path) continue;
    if (rule.prefix && !path.startsWith(rule.prefix)) continue;
    return rule;
  }
  return null;
}

function getRequestPath(url: string): string {
  return url.split("?", 1)[0] || url;
}

function enforceRateLimit(ip: string, path: string, rule: RateLimitRule): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucketKey = rule.bucketByPath
    ? `${rule.key}:${path}:${ip}`
    : `${rule.key}:${ip}`;
  const existing = rateLimitHits.get(bucketKey) ?? [];
  const recent = existing.filter((ts) => now - ts < rule.windowMs);

  if (recent.length >= rule.max) {
    const retryAfterMs = rule.windowMs - (now - recent[0]);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  recent.push(now);
  rateLimitHits.set(bucketKey, recent);
  return { ok: true, retryAfterSeconds: 0 };
}

function isTransientRpcError(err: unknown): boolean {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  const haystack = `${code} ${message}`.toLowerCase();
  return (
    haystack.includes("timeout") ||
    haystack.includes("network") ||
    haystack.includes("socket") ||
    haystack.includes("econnreset") ||
    haystack.includes("econnrefused") ||
    haystack.includes("etimedout") ||
    haystack.includes("failed to detect network") ||
    haystack.includes("missing response") ||
    haystack.includes("server error")
  );
}

async function assertConfiguredRpc(): Promise<void> {
  const probe = await probeBiteRpc();
  if (!probe.ok) {
    server.log.warn(`[chain] RPC verification skipped due to probe failure: ${String(probe.error ?? "unknown error").slice(0, 160)}`);
    return;
  }
  if (probe.chainId !== SKALE_BASE_CHAIN_ID) {
    throw new Error(
      `RPC chainId mismatch: expected ${SKALE_BASE_CHAIN_ID}, got ${probe.chainId}`
    );
  }
}

// Health check — GCP and you use this to know the shard is alive
server.get("/health", async () => {
  const rpc = await probeBiteRpc().catch(() => ({
    ok: false,
    rpcUrl: SKALE_BASE_RPC_URL,
    chainId: null,
    latestBlock: null,
    error: "probe failed",
  }));
  return {
    ok: true,
    uptime: process.uptime(),
    persistence: {
      redisConnected: Boolean(getRedis()),
      redisRequired: REQUIRE_REDIS_PERSISTENCE,
      memoryFallbackAllowed: isMemoryFallbackAllowed(),
    },
    rpc,
  };
});

// Agent discovery — how AI agents find and join the game
server.get("/.well-known/ai-plugin.json", async (_req, reply) => {
  reply.header("content-type", "application/json");
  return {
    schema_version: "v1",
    name_for_human: "World of Geneva",
    name_for_model: "world_of_geneva",
    description_for_human: "An on-chain MMORPG where AI agents are the players.",
    description_for_model: "World of Geneva is a persistent MMORPG. Deploy an AI agent with POST /x402/deploy to get a wallet, character, and JWT. Then use the REST API to move, fight, quest, craft, and trade. GET /play returns the full API reference.",
    auth: { type: "none" },
    api: { type: "openapi", url: "/play" },
    logo_url: "https://wog.urbantech.dev/logo.png",
    contact_email: "agents@worldofgeneva.com",
    legal_info_url: "https://wog.urbantech.dev",
  };
});

server.get("/play", async (_req, reply) => {
  const base = process.env.WOG_SHARD_URL || "https://wog.urbantech.dev";
  reply.header("content-type", "application/json");
  return {
    game: "World of Geneva",
    description: "On-chain MMORPG where AI agents are the players. Deploy a character, get a wallet and JWT, then explore, fight, quest, craft, and trade.",
    shard: base,
    quickstart: {
      step1: "POST /x402/deploy with { agentName, character: { name, race, class }, payment: { method: 'free' } }",
      step2: "Extract credentials.jwtToken, credentials.walletAddress, gameState.entityId from response",
      step3: "Use Authorization: Bearer <JWT> header on all subsequent requests",
      step4: "GET /zones/village-square to see the world, then POST /command to move and fight",
    },
    deploy: {
      method: "POST",
      path: "/x402/deploy",
      body: {
        agentName: "string — your agent's display name",
        character: {
          name: "string (2-20 chars, letters/spaces/hyphens)",
          race: "human | elf | dwarf | beastkin (default: human)",
          class: "warrior | paladin | rogue | ranger | mage | cleric | warlock | monk (default: warrior)",
        },
        payment: { method: "free | starter | pro" },
        deployment_zone: "village-square",
      },
      response: {
        credentials: { walletAddress: "string", jwtToken: "string" },
        gameState: { entityId: "string", zoneId: "string" },
      },
    },
    api: {
      movement_combat: {
        "POST /command": {
          actions: ["move", "attack", "travel"],
          body: "{ zoneId, entityId, action, x?, y?, targetId?, targetZone? }",
        },
      },
      world: {
        "GET /zones/:zoneId": "All entities, events, tick in a region",
        "GET /mining/nodes/:zoneId": "Ore nodes",
        "GET /herbalism/nodes/:zoneId": "Herb nodes",
        "GET /shop/catalog": "Full item catalog with prices",
        "GET /shop/npc/:merchantEntityId": "Merchant inventory",
      },
      inventory: {
        "GET /inventory/:walletAddress": "Gold + items",
        "GET /equipment/slots": "Equipment slot info",
        "POST /equipment/:entityId/equip": "{ tokenId }",
      },
      shopping: {
        "POST /shop/buy": "{ buyerAddress, tokenId, quantity }",
        "POST /shop/sell": "{ sellerAddress, tokenId, quantity }",
        "POST /shop/recycle": "{ sellerAddress, tokenId, quantity }",
      },
      quests: {
        "GET /quests/npc/:npcEntityId": "Available quests from NPC",
        "GET /quests/active/:entityId": "Your active quests",
        "POST /quests/accept": "{ entityId, npcEntityId, questId }",
        "POST /quests/complete": "{ entityId, npcEntityId, questId }",
        "POST /quests/talk": "{ zoneId, playerId, npcEntityId }",
      },
      techniques: {
        "GET /techniques/available/:entityId": "Learnable skills from trainers",
        "GET /techniques/learned/:entityId": "Your techniques",
        "POST /techniques/learn": "{ playerEntityId, techniqueId, trainerEntityId }",
        "POST /techniques/use": "{ casterEntityId, targetEntityId, techniqueId }",
      },
      professions: {
        "POST /mining/gather": "{ entityId, nodeId }",
        "POST /herbalism/gather": "{ walletAddress, zoneId, entityId, flowerNodeId }",
        "POST /crafting/craft": "{ entityId, stationId, recipeId }",
        "POST /cooking/cook": "{ entityId, stationId, recipeId }",
        "POST /alchemy/brew": "{ entityId, stationId, recipeId }",
        "GET /crafting/recipes": "All crafting recipes",
        "GET /cooking/recipes": "All cooking recipes",
        "GET /alchemy/recipes": "All alchemy recipes",
      },
      social: {
        "POST /chat": "{ entityId, message }",
        "POST /party/invite": "{ inviterId, targetId }",
        "GET /leaderboard": "Top players",
      },
      auction_house: {
        "GET /auctionhouse/auctions": "Browse listings",
        "POST /auctionhouse/create": "List an item",
        "POST /auctionhouse/bid": "Bid on an item",
      },
      guilds: {
        "GET /guild/registrar/:registrarEntityId": "Guild info",
        "POST /guild/create": "Create guild (150 gold)",
      },
      a2a: {
        "GET /a2a/:wallet": "Agent Card — A2A protocol service discovery (ERC-8004)",
        "POST /a2a/:wallet": "A2A JSON-RPC endpoint — send messages via { jsonrpc: '2.0', method: 'message/send', params: { from, message } }",
        "GET /a2a/resolve/:agentId": "Resolve on-chain A2A endpoint by identity ID",
        "GET /.well-known/agent.json": "Shard-level agent card (Google A2A protocol)",
        "POST /inbox/send": "Direct inbox message { from, fromName, to, type, body }",
        "GET /inbox/:wallet": "Read agent inbox messages",
      },
    },
    world_regions: [
      { id: "village-square", level: "1-5", connects: ["wild-meadow"] },
      { id: "wild-meadow", level: "5-10", connects: ["village-square", "dark-forest"] },
      { id: "dark-forest", level: "10-16", connects: ["wild-meadow", "auroral-plains", "emerald-woods"] },
      { id: "auroral-plains", level: "15", connects: ["dark-forest"] },
      { id: "emerald-woods", level: "20", connects: ["dark-forest", "viridian-range", "moondancer-glade"] },
      { id: "viridian-range", level: "25", connects: ["emerald-woods", "felsrock-citadel"] },
      { id: "moondancer-glade", level: "30", connects: ["emerald-woods", "felsrock-citadel"] },
      { id: "felsrock-citadel", level: "35", connects: ["viridian-range", "moondancer-glade", "lake-lumina"] },
      { id: "lake-lumina", level: "40", connects: ["felsrock-citadel", "azurshard-chasm"] },
      { id: "azurshard-chasm", level: "45", connects: ["lake-lumina"] },
    ],
    classes: ["warrior", "paladin", "rogue", "ranger", "mage", "cleric", "warlock", "monk"],
    races: ["human", "elf", "dwarf", "beastkin"],
    tips: [
      "Start at Level 1 in Village Square. Kill Giant Rats and Wolves for gold and XP.",
      "Buy a weapon from a Merchant NPC as soon as you can afford one.",
      "Accept quests from Quest Givers for gold + XP rewards.",
      "At Level 5, travel to Wild Meadow for harder mobs and better loot.",
      "Learn combat techniques from Trainers to deal more damage.",
      "Mine ore and pick herbs to craft items at stations.",
    ],
  };
});

// Admin: mint gold to any wallet — protected by ADMIN_SECRET env var
server.post<{ Body: { address: string; copper: number } }>("/admin/mint-gold", async (req, reply) => {
  if (!ADMIN_SECRET) {
    return reply.code(503).send({ error: "Admin route disabled: ADMIN_SECRET is not configured" });
  }

  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const { address, copper } = req.body;
  if (!address || !copper || copper <= 0) return reply.code(400).send({ error: "address and copper required" });
  try {
    const operationId = await enqueueGoldMint(address, copper.toString());
    return reply.send({ ok: true, operationId, copper });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message });
  }
});

// Transaction stats — live blockchain activity dashboard
server.get("/stats/transactions", async () => getTxStats());

// Transaction error tracing — all blockchain errors with structured data
import { getRecentTxErrors, getTxErrorsByType, getTxErrorsByChain, getTxErrorSummary } from "./blockchain/txTracer.js";

server.get<{ Querystring: { limit?: string; type?: string; chain?: string } }>(
  "/stats/tx-errors",
  async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? "50") || 50, 200);
    const { type, chain } = request.query;
    if (type) return { errors: getTxErrorsByType(type, limit) };
    if (chain === "skale" || chain === "bite") return { errors: getTxErrorsByChain(chain, limit) };
    return { summary: getTxErrorSummary(), errors: getRecentTxErrors(limit) };
  }
);

// Transaction error dashboard — shareable HTML page at /tx-errors
server.get("/tx-errors", async (_request, reply) => {
  reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WoG — Blockchain Tx Errors</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0f1a;color:#c8d6e5;font-family:'Courier New',monospace;font-size:13px;padding:16px}
  h1{font-size:16px;color:#ffcc00;margin-bottom:4px;letter-spacing:.1em;text-transform:uppercase}
  .subtitle{font-size:11px;color:#556b8a;margin-bottom:16px}
  .controls{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}
  .controls select,.controls input,.controls button{background:#121a2e;border:1px solid #24314d;color:#c8d6e5;padding:5px 8px;font-family:inherit;font-size:12px;border-radius:2px}
  .controls button{cursor:pointer;color:#ffcc00;border-color:#ffcc00}
  .controls button:hover{background:#1a2e1a}
  .summary{display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap}
  .stat{background:#121a2e;border:1px solid #24314d;padding:8px 14px;min-width:90px}
  .stat .label{font-size:9px;color:#556b8a;text-transform:uppercase;letter-spacing:.1em}
  .stat .value{font-size:18px;color:#ff6b6b;font-weight:bold;margin-top:2px}
  .stat .value.zero{color:#54f28b}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;padding:6px 8px;background:#121a2e;color:#ffcc00;font-size:10px;text-transform:uppercase;letter-spacing:.08em;border-bottom:2px solid #24314d;position:sticky;top:0}
  td{padding:5px 8px;border-bottom:1px solid #1a2233;vertical-align:top;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  tr:hover td{background:#121a2e}
  .chain-skale{color:#54f28b}.chain-bite{color:#a78bfa}
  .retryable{color:#ffcc00}.permanent{color:#ff6b6b}
  .type-badge{background:#1a2e1a;padding:1px 6px;border-radius:2px;font-size:11px;color:#54f28b}
  .code{color:#ff6b6b;font-weight:bold}
  .ts{color:#556b8a;font-size:11px}
  .error-msg{color:#ff9f43;cursor:pointer}
  .error-msg:hover{white-space:normal;word-break:break-all}
  .args{color:#556b8a;cursor:pointer;font-size:11px}
  .args:hover{white-space:normal;word-break:break-all}
  .empty{text-align:center;padding:40px;color:#3a4a6a;font-size:14px}
  .auto-label{font-size:10px;color:#3a4a6a}
  #last-refresh{font-size:10px;color:#3a4a6a;margin-left:auto}
</style>
</head>
<body>
<h1>Blockchain Tx Errors</h1>
<div class="subtitle">World of Geneva — live error trace dashboard</div>

<div class="controls">
  <select id="filterType"><option value="">All types</option></select>
  <select id="filterChain"><option value="">All chains</option><option value="skale">SKALE</option><option value="bite">BITE</option></select>
  <input id="filterLimit" type="number" value="50" min="1" max="200" style="width:60px" title="Limit">
  <button onclick="fetchErrors()">Refresh</button>
  <label class="auto-label"><input type="checkbox" id="autoRefresh" checked> Auto 10s</label>
  <span id="last-refresh"></span>
</div>

<div class="summary" id="summary"></div>
<div id="table-container"></div>

<script>
let autoTimer;
const API = location.origin + '/stats/tx-errors';

async function fetchErrors() {
  const type = document.getElementById('filterType').value;
  const chain = document.getElementById('filterChain').value;
  const limit = document.getElementById('filterLimit').value;
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (chain) params.set('chain', chain);
  if (limit) params.set('limit', limit);
  try {
    const res = await fetch(API + '?' + params);
    const data = await res.json();
    renderSummary(data.summary);
    renderTable(data.errors || []);
    populateTypeFilter(data.summary);
    document.getElementById('last-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('table-container').innerHTML = '<div class="empty">Failed to fetch: ' + e.message + '</div>';
  }
}

function renderSummary(s) {
  if (!s) { document.getElementById('summary').innerHTML = ''; return; }
  let html = '<div class="stat"><div class="label">Total errors</div><div class="value ' + (s.total===0?'zero':'') + '">' + s.total + '</div></div>';
  if (s.byChain) for (const [c,n] of Object.entries(s.byChain)) {
    html += '<div class="stat"><div class="label">' + c + '</div><div class="value">' + n + '</div></div>';
  }
  if (s.byType) for (const [t,n] of Object.entries(s.byType)) {
    html += '<div class="stat"><div class="label">' + t + '</div><div class="value">' + n + '</div></div>';
  }
  document.getElementById('summary').innerHTML = html;
}

function renderTable(errors) {
  if (!errors.length) {
    document.getElementById('table-container').innerHTML = '<div class="empty">No errors recorded — blockchain is healthy</div>';
    return;
  }
  let html = '<table><thead><tr><th>Time</th><th>Chain</th><th>Type</th><th>Function</th><th>Code</th><th>Error</th><th>Retry?</th><th>Args</th></tr></thead><tbody>';
  for (const e of [...errors].reverse()) {
    const t = new Date(e.timestamp);
    const ts = t.toLocaleTimeString() + '.' + String(t.getMilliseconds()).padStart(3,'0');
    html += '<tr>'
      + '<td class="ts">' + ts + '</td>'
      + '<td class="chain-' + e.chain + '">' + e.chain.toUpperCase() + '</td>'
      + '<td><span class="type-badge">' + e.type + '</span></td>'
      + '<td>' + e.fn + '</td>'
      + '<td class="code">' + (e.code ?? '-') + '</td>'
      + '<td class="error-msg" title="' + esc(e.error) + '">' + esc(e.error.slice(0,120)) + '</td>'
      + '<td class="' + (e.retryable?'retryable':'permanent') + '">' + (e.retryable?'yes':'NO') + '</td>'
      + '<td class="args" title="' + esc(JSON.stringify(e.args)) + '">' + esc(JSON.stringify(e.args).slice(0,80)) + '</td>'
      + '</tr>';
  }
  html += '</tbody></table>';
  document.getElementById('table-container').innerHTML = html;
}

function populateTypeFilter(s) {
  const sel = document.getElementById('filterType');
  const cur = sel.value;
  const types = s?.byType ? Object.keys(s.byType) : [];
  sel.innerHTML = '<option value="">All types</option>' + types.map(t => '<option value="'+t+'"' + (t===cur?' selected':'') + '>'+t+'</option>').join('');
}

function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

function toggleAuto() {
  clearInterval(autoTimer);
  if (document.getElementById('autoRefresh').checked) {
    autoTimer = setInterval(fetchErrors, 10000);
  }
}

document.getElementById('autoRefresh').addEventListener('change', toggleAuto);
fetchErrors();
toggleAuto();
</script>
</body>
</html>`);
});

// World layout — zone positions for seamless world rendering
let worldLayoutCache: { data: ReturnType<typeof getWorldLayout>; expiresAt: number } | null = null;
server.get("/world/layout", async () => {
  const now = Date.now();
  if (worldLayoutCache && worldLayoutCache.expiresAt > now) {
    return worldLayoutCache.data;
  }
  const data = getWorldLayout();
  worldLayoutCache = { data, expiresAt: now + WORLD_LAYOUT_CACHE_MS };
  return data;
});

// Admin dashboard — aggregated server health + game state
server.get("/admin/dashboard", async () => {
  const mem = process.memoryUsage();
  const allEntities = getAllEntities();
  let totalEntities = 0, playerCount = 0, mobCount = 0, npcCount = 0;
  const regionCounts = new Map<string, { entities: number; players: number; mobs: number; npcs: number }>();
  const onlinePlayers: Array<{ name: string; level: number; race: string; class: string; zone: string; hp: number; maxHp: number; kills: number }> = [];

  for (const e of allEntities.values()) {
    totalEntities++;
    const region = (e as any).region ?? "unknown";
    if (!regionCounts.has(region)) regionCounts.set(region, { entities: 0, players: 0, mobs: 0, npcs: 0 });
    const rc = regionCounts.get(region)!;
    rc.entities++;
    if (e.type === "player") {
      playerCount++;
      rc.players++;
      onlinePlayers.push({
        name: e.name, level: e.level ?? 1, race: e.raceId ?? "?", class: e.classId ?? "?",
        zone: region, hp: e.hp ?? 0, maxHp: e.maxHp ?? 0, kills: (e as any).kills ?? 0,
      });
    } else if (e.type === "mob") { mobCount++; rc.mobs++; }
    else if (e.type === "npc") { npcCount++; rc.npcs++; }
  }

  const perZone: Array<{ zoneId: string; entities: number; players: number; mobs: number; npcs: number; tick: number }> = [];
  for (const [zoneId, counts] of regionCounts) {
    perZone.push({ zoneId, entities: counts.entities, players: counts.players, mobs: counts.mobs, npcs: counts.npcs, tick: 0 });
  }

  const rpcProbe = await probeBiteRpc().catch(() => ({
    ok: false,
    rpcUrl: SKALE_BASE_RPC_URL,
    chainId: null,
    latestBlock: null,
    error: "probe failed",
  }));
  const rpcHealthy = rpcProbe.ok;
  const lastBlockNumber = rpcProbe.latestBlock;

  const activeAuctions = getAllAuctionsFromCache(0);
  const endedAuctions = getAllAuctionsFromCache(1);
  const totalVolume = endedAuctions.reduce((s, a) => s + a.highBid, 0);

  const runners = agentManager.listRunners();
  const agentSnapshots = runners.filter(r => r.running).map(r => r.getSnapshot());
  const chainIntentStats = await getChainIntentStats();
  const waitingFunds = await listChainIntents({ statuses: ["waiting_funds"], limit: 200, offset: 0 });
  const failedPermanent = await listChainIntents({ statuses: ["failed_permanent"], limit: 200, offset: 0 });
  const staleSubmitted = (await listChainIntents({ statuses: ["submitted"], limit: 500, offset: 0 }))
    .filter((intent) => (intent.lastSubmittedAt ?? intent.updatedAt) <= (Date.now() - 120_000));

  return {
    server: { uptime: process.uptime(), startedAt: Date.now() - process.uptime() * 1000, memoryMB: Math.round(mem.rss / 1048576) },
    blockchain: {
      rpcHealthy,
      lastBlockNumber,
      chainId: SKALE_BASE_CHAIN_ID,
      rpcUrl: SKALE_BASE_RPC_URL,
      rpcError: rpcProbe.error,
      txStats: getTxStats(),
      chainBatcher: getChainBatcherStats(),
      chainIntents: {
        byType: chainIntentStats,
        waitingFunds: waitingFunds.length,
        failedPermanent: failedPermanent.length,
        staleSubmitted: staleSubmitted.length,
      },
    },
    zones: { count: regionCounts.size, totalEntities, players: playerCount, mobs: mobCount, npcs: npcCount, perZone },
    agents: { active: agentSnapshots.length, list: agentSnapshots },
    merchants: { initialized: getMerchantCount(), total: perZone.reduce((s, z) => s + z.npcs, 0) },
    economy: { activeListings: activeAuctions.length, totalSales: endedAuctions.length, totalVolume },
    players: { online: onlinePlayers },
  };
});

// POST /logout — save character state and despawn entity
server.post<{
  Body: { zoneId: string; entityId: string };
}>("/logout", {
  preHandler: authenticateRequest,
}, async (request, reply) => {
  const { zoneId, entityId } = request.body;
  const authenticatedWallet = (request as any).walletAddress;

  if (!zoneId || !entityId) {
    reply.code(400);
    return { error: "zoneId and entityId are required" };
  }

  // Find the entity in the unified world map
  const entity: any = getEntity(entityId);

  if (!entity) {
    reply.code(404);
    return { error: "Entity not found" };
  }

  const foundZoneId: string = (entity as any).region ?? zoneId;

  // Verify wallet ownership
  if (!entity.walletAddress || entity.walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
    reply.code(403);
    return { error: "Not authorized to log out this character" };
  }

  // Save full character state
  const verifiedIdentityPatch = await buildVerifiedIdentityPatch(entity.walletAddress, {
    characterTokenId: entity.characterTokenId?.toString(),
    agentId: entity.agentId?.toString(),
  });
  await saveCharacter(entity.walletAddress, entity.name, {
    name: entity.name,
    level: entity.level ?? 1,
    xp: entity.xp ?? 0,
    ...verifiedIdentityPatch,
    raceId: entity.raceId ?? "human",
    classId: entity.classId ?? "warrior",
    calling: entity.calling,
    gender: entity.gender,
    skinColor: entity.skinColor,
    hairStyle: entity.hairStyle,
    eyeColor: entity.eyeColor,
    origin: entity.origin,
    zone: foundZoneId!,
    x: entity.x,
    y: entity.y,
    kills: entity.kills ?? 0,
    activeQuests: entity.activeQuests ?? [],
    completedQuests: entity.completedQuests ?? [],
    learnedTechniques: entity.learnedTechniques ?? [],
    professions: getLearnedProfessions(entity.walletAddress),
    runEnergy: entity.runEnergy,
    maxRunEnergy: entity.maxRunEnergy,
    runModeEnabled: entity.runModeEnabled,
    equipment: entity.equipment ?? undefined,
  });

  // Clear mob tags owned by this player before despawn
  for (const e of getAllEntities().values()) {
    if ((e.type === "mob" || e.type === "boss") && (e as any).taggedBy === entityId) {
      (e as any).taggedBy = undefined;
      (e as any).taggedAtTick = undefined;
    }
  }
  if (entity.walletAddress) {
    unregisterSpawnedWallet(entity.walletAddress);
    removeLivePlayerEntityEventually(entity.walletAddress, "logout");
  }
  getAllEntities().delete(entityId);

  server.log.info(`[logout] ${entity.name} saved and despawned from ${foundZoneId}`);

  return {
    ok: true,
    saved: true,
    character: entity.name,
    zone: foundZoneId,
  };
});

const allowedCorsOrigins = getAllowedCorsOrigins();
server.register(cors, {
  origin(origin, cb) {
    if (!origin || isAllowedCorsOrigin(origin, allowedCorsOrigins)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
});

// Register subsystems
server.addHook("onRequest", async (request, reply) => {
  const path = getRequestPath(request.url);

  if (HOTPATH_CONCURRENCY_LIMITS_ENABLED) {
    const concurrencyRule = getConcurrencyRule(request.method, path);
    if (concurrencyRule) {
      const active = inFlightByRule.get(concurrencyRule.key) ?? 0;
      if (active >= concurrencyRule.maxInFlight) {
        reply.header("Retry-After", "1");
        reply.code(429).send({ error: "Server busy, please retry shortly" });
        return;
      }
      inFlightByRule.set(concurrencyRule.key, active + 1);
      (request as any).__concurrencyRuleKey = concurrencyRule.key;
    }
  }

  const rule = getRateLimitRule(request.method, request.url);
  if (!rule) return;
  const verdict = enforceRateLimit(request.ip, path, rule);
  if (verdict.ok) return;

  server.log.warn(
    { ip: request.ip, method: request.method, path, rule: rule.key, retryAfterSeconds: verdict.retryAfterSeconds },
    "[rate-limit] Request rejected",
  );
  reply.header("Retry-After", verdict.retryAfterSeconds.toString());
  reply.code(429).send({ error: "Rate limit exceeded" });
});
server.addHook("onResponse", async (request) => {
  const ruleKey = (request as any).__concurrencyRuleKey as string | undefined;
  if (!ruleKey) return;
  const active = inFlightByRule.get(ruleKey) ?? 0;
  if (active <= 1) {
    inFlightByRule.delete(ruleKey);
    return;
  }
  inFlightByRule.set(ruleKey, active - 1);
});
registerAuthRoutes(server);
registerFarcasterAuthRoutes(server);
registerX402Routes(server);
registerZoneRuntime(server);
if (RUN_BACKGROUND_WORKERS) {
  startChainBatcher();
} else {
  server.log.warn("[workers] RUN_BACKGROUND_WORKERS=false — chain batcher disabled on this node");
}
registerSpawnOrders(server);
registerCommands(server);
registerStateApi(server);
registerStatsRoutes(server);
registerWalletRoutes(server);
registerShopRoutes(server);
registerCharacterRoutes(server);
registerTradeRoutes(server);
registerEquipmentRoutes(server);
registerAuctionHouseRoutes(server);
if (RUN_BACKGROUND_WORKERS) registerAuctionHouseTick(server);
registerGuildRoutes(server);
if (RUN_BACKGROUND_WORKERS) registerGuildTick(server);
registerGuildVaultRoutes(server);
registerMiningRoutes(server);
registerProfessionRoutes(server);
registerCraftingRoutes(server);
registerQuestRoutes(server);
registerNpcDialogueRoutes(server);
registerQuestGraphRoutes(server);
registerHerbalismRoutes(server);
registerAlchemyRoutes(server);
registerTechniqueRoutes(server);
registerEnchantingRoutes(server);
registerEventRoutes(server);
registerTerrainRoutes(server);
registerNpcRoutes(server);
registerSkinningRoutes(server);
registerCookingRoutes(server);
registerPartyRoutes(server);
registerFriendsRoutes(server);
registerZoneTransitionRoutes(server);
registerLeaderboardRoutes(server);
registerLeatherworkingRoutes(server);
registerUpgradingRoutes(server);
registerJewelcraftingRoutes(server);
registerPvPRoutes(server);
registerPredictionRoutes(server);
registerAgentChatRoutes(server);
registerAgentInboxRoutes(server);
registerA2ARoutes(server);
registerAgentDirectoryRoutes(server);
registerGoldPurchaseRoutes(server);
registerItemRngRoutes(server);
registerMarketplaceRoutes(server);
registerDirectBuyRoutes(server);
registerRentalRoutes(server);
registerMarketplaceAdminRoutes(server);
registerChainAdminRoutes(server);
registerItemCatalogRoutes(server);
registerReputationRoutes(server);
registerNameServiceRoutes(server);
registerDungeonGateRoutes(server);
registerEssenceTechniqueRoutes(server);
registerForgedTechniqueRoutes(server);
if (RUN_BACKGROUND_WORKERS) registerDungeonGateTick(server);
registerFarmingRoutes(server);
registerPlotRoutes(server);
registerBuildingRoutes(server);
registerWorldMapRoutes(server);
registerDiaryRoutes(server);
registerNotificationRoutes(server);
registerWebPushRoutes(server);
initDungeonLootTables();
if (RUN_BACKGROUND_WORKERS) {
  startGuildNameCacheRefresh(GUILD_CACHE_REFRESH_INTERVAL_MS);
}
spawnNpcs();
if (!RUN_BACKGROUND_WORKERS) {
  server.log.info("[merchant] RUN_BACKGROUND_WORKERS=false — merchant tick disabled on this node");
} else if (SKIP_MERCHANT_BOOTSTRAP) {
  server.log.info("[merchant] Skipping merchant bootstrap in LOCAL_TEST_MODE=core");
} else {
  registerMerchantAgentTick(server);
  // Defer merchant wallet init so the tx queue isn't flooded at boot
  setTimeout(() => {
    initMerchantWallets().catch((err) => {
      server.log.warn(`[merchant] Wallet init failed (non-fatal): ${err.message?.slice(0, 100)}`);
    });
  }, 60_000);
}
spawnOreNodes();
spawnFlowerNodes();
spawnNectarNodes();
spawnCropNodes();

// Mob respawner - check every 5 seconds
if (RUN_BACKGROUND_WORKERS) {
  setInterval(() => {
    tickMobRespawner();
  }, MOB_RESPAWNER_INTERVAL_MS);
}

const start = async () => {
  server.log.info(
    `[runtime] backgroundWorkers=${RUN_BACKGROUND_WORKERS} hotpathConcurrency=${HOTPATH_CONCURRENCY_LIMITS_ENABLED} worldLayoutCacheMs=${WORLD_LAYOUT_CACHE_MS}`
  );
  await initPostgres();
  if (isPostgresConfigured()) {
    await ensureGameSchema();
    const health = await getGameSchemaHealth().catch(() => null);
    server.log.info(
      health
        ? `[postgres] Ready (characters=${health.characterCount}, identities=${health.identityStateCount}, walletLinks=${health.walletLinkCount}, characterProjections=${health.characterProjectionCount}, outbox=${health.outboxCount}, chainOps=${health.chainOperationCount}, professions=${health.professionStateCount}, equipment=${health.equipmentStateCount}, parties=${health.partyCount}, listings=${health.listingCount}, plots=${health.plotStateCount}, itemMappings=${health.itemTokenMappingCount}, itemInstances=${health.craftedItemInstanceCount}, friendEdges=${health.friendEdgeCount}, friendRequests=${health.friendRequestCount}, auctions=${health.auctionProjectionCount}, guilds=${health.guildCount}, guildMembers=${health.guildMembershipCount}, guildProposals=${health.guildProposalCount}, pushSubs=${health.webPushSubscriptionCount}, telegramLinks=${health.telegramLinkCount}, marketplaceOps=${health.marketplaceOperationCount}, marketplacePayments=${health.marketplacePendingPaymentCount}, goldPayments=${health.goldPendingPaymentCount}, rentals=${health.rentalListingCount}, rentalGrants=${health.rentalGrantCount}, rentalEntities=${health.characterRentalEntityCount}, diaryEntries=${health.diaryEntryCount}, reputationScores=${health.reputationScoreCount}, reputationFeedback=${health.reputationFeedbackCount}, custodialWallets=${health.custodialWalletCount}, walletRuntime=${health.walletRuntimeStateCount}, walletRegistrations=${health.walletRegistrationStateCount}, bootstrapJobs=${health.characterBootstrapJobCount}, inbox=${health.agentInboxMessageCount}, inboxHistory=${health.agentInboxHistoryCount}, merchants=${health.merchantStateCount}, partyInvites=${health.partyInviteCount}, promoCodes=${health.promoCodeCount}, promoRedemptions=${health.promoCodeRedemptionCount}, goldReservations=${health.goldReservationCount})`
        : "[postgres] Ready"
    );
    // Migrate Redis data into Postgres (safe to run multiple times — all upserts use ON CONFLICT)
    if (getRedis()) {
      try {
        const result = await migrateRedisToPostgres();
        server.log.info(`[migrate] Characters: ${result.characters.migrated} migrated, ${result.characters.errors} errors`);
        server.log.info(`[migrate] Items: ${result.items.migrated} migrated, ${result.items.errors} errors`);
      } catch (err: any) {
        server.log.warn(`[migrate] Redis→Postgres migration failed (non-fatal): ${err.message?.slice(0, 100)}`);
      }
    }
  } else {
    server.log.warn("[postgres] DATABASE_URL not configured; authoritative persistent read models are disabled");
  }

  if (REQUIRE_REDIS_PERSISTENCE && !isPostgresConfigured()) {
    assertRedisAvailable("server boot");
    server.log.info("[redis] Redis persistence required and available");
  } else if (REQUIRE_REDIS_PERSISTENCE && isPostgresConfigured() && !getRedis()) {
    server.log.warn("[redis] Redis persistence requested but Postgres is authoritative; continuing without Redis");
  } else if (!getRedis() && isMemoryFallbackAllowed() && !isPostgresConfigured()) {
    server.log.warn("[redis] Running with memory fallback enabled; persistence guarantees are reduced");
  }

  await hydrateAuctionCacheFromProjections().then((count) => {
    if (count > 0) {
      server.log.info(`[auction] Hydrated ${count} auction projection(s) from Postgres`);
    }
  }).catch((err: any) => {
    server.log.warn(`[auction] Failed to hydrate Postgres auction projections: ${err.message?.slice(0, 100)}`);
  });

  // Start Telegram bot (non-blocking — no bot token = graceful no-op)
  initTelegramBot().catch((err: any) => {
    server.log.warn(`[telegram] Bot init failed (non-fatal): ${err.message?.slice(0, 100)}`);
  });

  // Wire web push alerts into the diary system (graceful no-op if VAPID keys not set)
  initWebPushAlerts();

  // Wire inbox notifications for game events (level-up, death, quest complete)
  {
    const { setDiaryInboxHook } = await import("./social/diary.js");
    const { sendSystemNotification } = await import("./agents/agentInbox.js");
    setDiaryInboxHook((wallet, action, entry) => {
      const name = entry.characterName;
      let body = "";
      if (action === "level_up") {
        const level = (entry.details.newLevel as number) ?? "?";
        body = `${name} reached level ${level}!`;
      } else if (action === "death") {
        const zone = entry.zoneId.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        body = `${name} was slain in ${zone}.`;
      } else if (action === "quest_complete") {
        const quest = (entry.details.questName as string) ?? "a quest";
        body = `${name} completed "${quest}"!`;
      }
      if (body) {
        void sendSystemNotification(wallet, name, body, { action, ...entry.details });
      }
    });
    server.log.info("[inbox] Diary inbox hook registered — game events now go to inbox");
  }

  if (RUN_BACKGROUND_WORKERS) {
    startWalletRegistrationWorker(server);
  }

  const port = Number(process.env.PORT) || 3000;
  const host = "0.0.0.0";
  await server.listen({ port, host });
  server.log.info(`Shard listening on ${host}:${port}`);

  if (LAZY_RUNTIME_HYDRATION) {
    server.log.info("[runtime] Lazy hydration enabled; skipping eager restore of live sessions, parties, PvP, merchants, agents, plots, and gold reservations");
  } else {
    await pvpBattleManager.restoreFromRedis().catch((err: any) => {
      server.log.warn(`[pvp] PvP restore failed (non-fatal): ${err.message?.slice(0, 100)}`);
    });
    await restoreLivePlayersFromPostgres().then((count) => {
      if (count > 0) {
        server.log.info(`[live-player] Restored ${count} active player session(s) from Postgres`);
      }
    }).catch((err: any) => {
      server.log.warn(`[live-player] Postgres restore failed (non-fatal): ${err.message?.slice(0, 100)}`);
    });
  }

  if (RUN_BACKGROUND_WORKERS) {
    startAgentRuntimeReconciler(server.log);

    await startCharacterBootstrapWorker(server).catch((err: any) => {
      server.log.warn(`[character-bootstrap] Worker start failed (non-fatal): ${err.message?.slice(0, 100)}`);
    });
    startNameServiceWorker(server.log);
    startPlotOperationWorker(server.log);
    startReputationChainWorker(server.log);
    startChainOperationReplayWorker(server.log);
  } else {
    server.log.warn("[workers] RUN_BACKGROUND_WORKERS=false — async workers not started on this node");
  }

  await Promise.race([
    initWorldMapStore(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("initWorldMapStore timed out after 10s")), 10_000)
    ),
  ]).catch((err) => {
    server.log.warn(`[worldMapStore] Init failed (non-fatal): ${err.message}`);
  });

  server.log.info(`[chain] RPC target ${SKALE_BASE_RPC_URL} (expected chainId=${SKALE_BASE_CHAIN_ID})`);
  await assertConfiguredRpc();
  server.log.info(`[chain] Verified RPC chainId=${SKALE_BASE_CHAIN_ID}`);
};

// Graceful shutdown: stop all agent loops, flush batched chain writes
process.on("SIGTERM", async () => {
  await stopChainBatcher();
  await agentManager.stopAll();
  await server.close();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await stopChainBatcher();
  await agentManager.stopAll();
  await server.close();
  process.exit(0);
});
process.on("unhandledRejection", (reason) => {
  if (isTransientRpcError(reason)) {
    server.log.warn(`[rpc] Suppressed transient unhandled rejection: ${String((reason as Error)?.message ?? reason).slice(0, 160)}`);
    return;
  }
  server.log.error(reason, "Unhandled promise rejection");
  process.exit(1);
});

start();
