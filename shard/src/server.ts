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
import { initTelegramBot } from "./social/telegramNotifications.js";
import { initWorldMapStore } from "./world/worldMapStore.js";
import { restoreReservations } from "./blockchain/goldLedger.js";
import { getTxStats } from "./blockchain/blockchain.js";
import { getWorldLayout } from "./world/worldLayout.js";
import { getAllZones, clearMobTagsForPlayer, unregisterSpawnedWallet } from "./world/zoneRuntime.js";
import { saveCharacter } from "./character/characterStore.js";
import { authenticateRequest } from "./auth/auth.js";
import { getLearnedProfessions } from "./professions/professions.js";
import { biteProvider, SKALE_BASE_CHAIN_ID } from "./blockchain/biteChain.js";

const server = Fastify({ logger: true });

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

// Transaction stats — live blockchain activity dashboard
server.get("/stats/transactions", async () => getTxStats());

// World layout — zone positions for seamless world rendering
server.get("/world/layout", async () => getWorldLayout());

// Admin dashboard — aggregated server health + game state
server.get("/admin/dashboard", async () => {
  const mem = process.memoryUsage();
  const zones = getAllZones();
  let totalEntities = 0, playerCount = 0, mobCount = 0, npcCount = 0;
  const perZone: Array<{ zoneId: string; entities: number; players: number; mobs: number; npcs: number; tick: number }> = [];
  const onlinePlayers: Array<{ name: string; level: number; race: string; class: string; zone: string; hp: number; maxHp: number; kills: number }> = [];

  for (const [zoneId, zone] of zones) {
    let zPlayers = 0, zMobs = 0, zNpcs = 0;
    for (const e of zone.entities.values()) {
      totalEntities++;
      if (e.type === "player") {
        zPlayers++;
        onlinePlayers.push({
          name: e.name, level: e.level ?? 1, race: e.raceId ?? "?", class: e.classId ?? "?",
          zone: zoneId, hp: e.hp ?? 0, maxHp: e.maxHp ?? 0, kills: (e as any).kills ?? 0,
        });
      } else if (e.type === "mob") zMobs++;
      else if (e.type === "npc") zNpcs++;
    }
    playerCount += zPlayers; mobCount += zMobs; npcCount += zNpcs;
    perZone.push({ zoneId, entities: zone.entities.size, players: zPlayers, mobs: zMobs, npcs: zNpcs, tick: zone.tick });
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
    zones: { count: zones.size, totalEntities, players: playerCount, mobs: mobCount, npcs: npcCount, perZone },
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

  // Find the entity across all zones (might have transitioned)
  let foundZoneId: string | null = null;
  let entity: any = null;

  for (const [zId, zone] of getAllZones()) {
    const e = zone.entities.get(entityId);
    if (e) {
      foundZoneId = zId;
      entity = e;
      break;
    }
  }

  if (!entity) {
    reply.code(404);
    return { error: "Entity not found" };
  }

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
  const zone = getAllZones().get(foundZoneId!);
  if (zone) {
    clearMobTagsForPlayer(zone, entityId);
    if (entity.walletAddress) unregisterSpawnedWallet(entity.walletAddress);
    zone.entities.delete(entityId);
  }

  server.log.info(`[logout] ${entity.name} saved and despawned from ${foundZoneId}`);

  return {
    ok: true,
    saved: true,
    character: entity.name,
    zone: foundZoneId,
  };
});

// Register subsystems
server.register(cors, { origin: true });
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
registerItemRngRoutes(server);
registerMarketplaceRoutes(server);
registerItemCatalogRoutes(server);
registerReputationRoutes(server);
registerNameServiceRoutes(server);
registerDungeonGateRoutes(server);
registerEssenceTechniqueRoutes(server);
registerDungeonGateTick(server);
registerWorldMapRoutes(server);
registerDiaryRoutes(server);
registerNotificationRoutes(server);
initDungeonLootTables();
startGuildNameCacheRefresh();
spawnNpcs();
registerMerchantAgentTick(server);
initMerchantWallets().catch((err) => {
  server.log.warn(`[merchant] Wallet init failed (non-fatal): ${err.message?.slice(0, 100)}`);
});
spawnOreNodes();
spawnFlowerNodes();
spawnNectarNodes();

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

  // Restore agent loops only after HTTP server is live.
  // Agent auth + setup uses API calls that fail pre-listen.
  agentManager.restoreFromRedis().catch((err: any) => {
    server.log.warn(`[agent] Boot restore failed (non-fatal): ${err.message?.slice(0, 100)}`);
  });
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
