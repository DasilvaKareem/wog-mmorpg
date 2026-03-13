import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerZoneRuntime } from "./world/zoneRuntime.js";
import { registerSpawnOrders } from "./world/spawnOrders.js";
import { registerStateApi } from "./routes/stateApi.js";
import { registerCommands } from "./social/commands.js";
import { registerWalletRoutes } from "./blockchain/wallet.js";
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
import { rebuildAuctionCache, getAllAuctionsFromCache } from "./economy/auctionHouseChain.js";
import { registerPvPRoutes } from "./combat/pvpRoutes.js";
import { registerPredictionRoutes } from "./economy/predictionRoutes.js";
import { registerX402Routes } from "./economy/x402Routes.js";
import { registerAgentChatRoutes } from "./agents/agentChatRoutes.js";
import { registerAgentInboxRoutes } from "./agents/agentInboxRoutes.js";
import { registerA2ARoutes } from "./agents/a2aRoutes.js";
import { agentManager } from "./agents/agentManager.js";
import { registerItemRngRoutes } from "./items/itemRng.js";
import { registerMarketplaceRoutes } from "./economy/marketplace.js";
import { registerItemCatalogRoutes } from "./items/itemCatalogRoutes.js";
import { registerReputationRoutes } from "./economy/reputationRoutes.js";
import { registerNameServiceRoutes } from "./blockchain/nameServiceRoutes.js";
import { registerDungeonGateRoutes } from "./world/dungeonGate.js";
import { registerEssenceTechniqueRoutes } from "./combat/essenceTechniqueRoutes.js";
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
import { initTelegramBot } from "./social/telegramNotifications.js";
import { initWorldMapStore } from "./world/worldMapStore.js";
import { registerFarmingRoutes } from "./farming/farming.js";
import { registerPlotRoutes } from "./farming/plotRoutes.js";
import { registerBuildingRoutes } from "./farming/buildingRoutes.js";
import { spawnCropNodes } from "./farming/cropSpawner.js";
import { restoreReservations } from "./blockchain/goldLedger.js";
import { getTxStats, mintGold } from "./blockchain/blockchain.js";
import { getWorldLayout } from "./world/worldLayout.js";
import { getAllEntities, getEntity, unregisterSpawnedWallet } from "./world/zoneRuntime.js";
import { saveCharacter } from "./character/characterStore.js";
import { authenticateRequest } from "./auth/auth.js";
import { getLearnedProfessions } from "./professions/professions.js";
import { biteProvider, SKALE_BASE_CHAIN_ID } from "./blockchain/biteChain.js";

const server = Fastify({ logger: true });
const ADMIN_SECRET = process.env.ADMIN_SECRET?.trim() || null;
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://wog.urbantech.dev",
  "https://worldofgeneva.com",
  "https://www.worldofgeneva.com",
];

type RateLimitRule = {
  key: string;
  methods?: string[];
  exact?: string;
  prefix?: string;
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
  { key: "mutating", methods: ["POST", "PUT", "PATCH", "DELETE"], max: 120, windowMs: 60_000 },
];

const rateLimitHits = new Map<string, number[]>();

function getAllowedCorsOrigins(): Set<string> {
  const configured = process.env.CORS_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...(configured ?? []), ...DEFAULT_CORS_ORIGINS]);
}

function getRateLimitRule(method: string, url: string): RateLimitRule | null {
  const path = url.split("?", 1)[0] || url;

  for (const rule of RATE_LIMIT_RULES) {
    if (rule.methods && !rule.methods.includes(method)) continue;
    if (rule.exact && rule.exact !== path) continue;
    if (rule.prefix && !path.startsWith(rule.prefix)) continue;
    return rule;
  }

  return null;
}

function enforceRateLimit(ip: string, rule: RateLimitRule): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucketKey = `${rule.key}:${ip}`;
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

async function assertMainnetRpc(): Promise<void> {
  const network = await biteProvider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== SKALE_BASE_CHAIN_ID) {
    throw new Error(
      `RPC chainId mismatch: expected ${SKALE_BASE_CHAIN_ID} (SKALE Base mainnet), got ${chainId}`
    );
  }
}

// Health check — GCP and you use this to know the shard is alive
server.get("/health", async () => ({ ok: true, uptime: process.uptime() }));

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
    const tx = await mintGold(address, copper.toString());
    return reply.send({ ok: true, tx, copper });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message });
  }
});

// Transaction stats — live blockchain activity dashboard
server.get("/stats/transactions", async () => getTxStats());

// World layout — zone positions for seamless world rendering
server.get("/world/layout", async () => getWorldLayout());

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

  let rpcHealthy = false;
  let lastBlockNumber: number | null = null;
  try {
    const bn = await biteProvider.getBlockNumber();
    lastBlockNumber = Number(bn);
    rpcHealthy = lastBlockNumber > 0;
  } catch { /* RPC down */ }

  const activeAuctions = getAllAuctionsFromCache(0);
  const endedAuctions = getAllAuctionsFromCache(1);
  const totalVolume = endedAuctions.reduce((s, a) => s + a.highBid, 0);

  const runners = agentManager.listRunners();
  const agentSnapshots = runners.filter(r => r.running).map(r => r.getSnapshot());

  return {
    server: { uptime: process.uptime(), startedAt: Date.now() - process.uptime() * 1000, memoryMB: Math.round(mem.rss / 1048576) },
    blockchain: { rpcHealthy, lastBlockNumber, chainId: SKALE_BASE_CHAIN_ID, txStats: getTxStats() },
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
  await saveCharacter(entity.walletAddress, entity.name, {
    name: entity.name,
    level: entity.level ?? 1,
    xp: entity.xp ?? 0,
    raceId: entity.raceId ?? "human",
    classId: entity.classId ?? "warrior",
    calling: entity.calling,
    gender: entity.gender,
    zone: foundZoneId!,
    x: entity.x,
    y: entity.y,
    kills: entity.kills ?? 0,
    completedQuests: entity.completedQuests ?? [],
    learnedTechniques: entity.learnedTechniques ?? [],
    professions: getLearnedProfessions(entity.walletAddress),
  });

  // Clear mob tags owned by this player before despawn
  for (const e of getAllEntities().values()) {
    if ((e.type === "mob" || e.type === "boss") && (e as any).taggedBy === entityId) {
      (e as any).taggedBy = undefined;
      (e as any).taggedAtTick = undefined;
    }
  }
  if (entity.walletAddress) unregisterSpawnedWallet(entity.walletAddress);
  getAllEntities().delete(entityId);

  server.log.info(`[logout] ${entity.name} saved and despawned from ${foundZoneId}`);

  return {
    ok: true,
    saved: true,
    character: entity.name,
    zone: foundZoneId,
  };
});

// Register subsystems
server.addHook("onRequest", async (request, reply) => {
  const rule = getRateLimitRule(request.method, request.url);
  if (!rule) return;

  const verdict = enforceRateLimit(request.ip, rule);
  if (verdict.ok) return;

  reply.header("Retry-After", verdict.retryAfterSeconds.toString());
  reply.code(429).send({ error: "Rate limit exceeded" });
});

const allowedCorsOrigins = getAllowedCorsOrigins();
server.register(cors, {
  origin(origin, cb) {
    if (!origin || allowedCorsOrigins.has(origin)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
});
registerAuthRoutes(server);
registerFarcasterAuthRoutes(server);
registerX402Routes(server);
registerZoneRuntime(server);
registerSpawnOrders(server);
registerCommands(server);
registerStateApi(server);
registerWalletRoutes(server);
registerShopRoutes(server);
registerCharacterRoutes(server);
registerTradeRoutes(server);
registerEquipmentRoutes(server);
registerAuctionHouseRoutes(server);
registerAuctionHouseTick(server);
registerGuildRoutes(server);
registerGuildTick(server);
registerGuildVaultRoutes(server);
registerMiningRoutes(server);
registerProfessionRoutes(server);
registerCraftingRoutes(server);
registerQuestRoutes(server);
registerHerbalismRoutes(server);
registerAlchemyRoutes(server);
registerTechniqueRoutes(server);
registerEnchantingRoutes(server);
registerEventRoutes(server);
registerTerrainRoutes(server);
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
registerGoldPurchaseRoutes(server);
registerItemRngRoutes(server);
registerMarketplaceRoutes(server);
registerItemCatalogRoutes(server);
registerReputationRoutes(server);
registerNameServiceRoutes(server);
registerDungeonGateRoutes(server);
registerEssenceTechniqueRoutes(server);
registerDungeonGateTick(server);
registerFarmingRoutes(server);
registerPlotRoutes(server);
registerBuildingRoutes(server);
registerWorldMapRoutes(server);
registerDiaryRoutes(server);
registerNotificationRoutes(server);
registerWebPushRoutes(server);
initDungeonLootTables();
startGuildNameCacheRefresh();
spawnNpcs();
registerMerchantAgentTick(server);
// Defer merchant wallet init so the tx queue isn't flooded at boot
setTimeout(() => {
  initMerchantWallets().catch((err) => {
    server.log.warn(`[merchant] Wallet init failed (non-fatal): ${err.message?.slice(0, 100)}`);
  });
}, 60_000);
spawnOreNodes();
spawnFlowerNodes();
spawnNectarNodes();
spawnCropNodes();

// Mob respawner - check every 5 seconds
setInterval(() => {
  tickMobRespawner();
}, 5000);

const start = async () => {
  // Rebuild auction cache from on-chain events (non-blocking — don't delay server start)
  rebuildAuctionCache().catch((err: any) => {
    server.log.warn(`[auction] Cache rebuild failed (non-fatal): ${err.message?.slice(0, 100)}`);
  });

  // Start Telegram bot (non-blocking — no bot token = graceful no-op)
  initTelegramBot().catch((err: any) => {
    server.log.warn(`[telegram] Bot init failed (non-fatal): ${err.message?.slice(0, 100)}`);
  });

  // Wire web push alerts into the diary system (graceful no-op if VAPID keys not set)
  initWebPushAlerts();

  // Restore gold reservations from Redis (prevents double-spend after restart)
  restoreReservations().catch((err: any) => {
    server.log.warn(`[goldLedger] Reservation restore failed (non-fatal): ${err.message?.slice(0, 100)}`);
  });

  await Promise.race([
    initWorldMapStore(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("initWorldMapStore timed out after 10s")), 10_000)
    ),
  ]).catch((err) => {
    server.log.warn(`[worldMapStore] Init failed (non-fatal): ${err.message}`);
  });

  await assertMainnetRpc();
  server.log.info(`[chain] Verified SKALE Base mainnet (chainId=${SKALE_BASE_CHAIN_ID})`);

  const port = Number(process.env.PORT) || 3000;
  const host = "0.0.0.0";

  await server.listen({ port, host });
  server.log.info(`Shard listening on ${host}:${port}`);

  // Agent boot restore disabled — agents deploy on demand via /agent/deploy.
  // agentManager.restoreFromRedis().catch((err: any) => {
  //   server.log.warn(`[agent] Boot restore failed (non-fatal): ${err.message?.slice(0, 100)}`);
  // });
};

// Graceful shutdown: stop all agent loops
process.on("SIGTERM", async () => {
  await agentManager.stopAll();
  await server.close();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await agentManager.stopAll();
  await server.close();
  process.exit(0);
});

start();
