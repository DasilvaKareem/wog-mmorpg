import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerZoneRuntime } from "./zoneRuntime.js";
import { registerSpawnOrders } from "./spawnOrders.js";
import { registerStateApi } from "./stateApi.js";
import { registerCommands } from "./commands.js";
import { registerWalletRoutes } from "./wallet.js";
import { registerShopRoutes } from "./shop.js";
import { registerCharacterRoutes } from "./characterRoutes.js";
import { registerTradeRoutes } from "./trade.js";
import { registerEquipmentRoutes } from "./equipment.js";
import { registerAuctionHouseRoutes } from "./auctionHouse.js";
import { registerAuctionHouseTick } from "./auctionHouseTick.js";
import { registerGuildRoutes } from "./guild.js";
import { registerGuildTick } from "./guildTick.js";
import { registerGuildVaultRoutes } from "./guildVault.js";
import { spawnNpcs, tickMobRespawner } from "./npcSpawner.js";
import { initMerchantWallets, registerMerchantAgentTick } from "./merchantAgent.js";
import { registerMiningRoutes } from "./mining.js";
import { spawnOreNodes } from "./oreSpawner.js";
import { registerProfessionRoutes } from "./professions.js";
import { registerCraftingRoutes } from "./crafting.js";
import { registerQuestRoutes } from "./questSystem.js";
import { registerHerbalismRoutes } from "./herbalism.js";
import { spawnFlowerNodes } from "./flowerSpawner.js";
import { registerAlchemyRoutes } from "./alchemy.js";
import { registerTechniqueRoutes } from "./techniqueRoutes.js";
import { registerEnchantingRoutes } from "./enchanting.js";
import { registerEventRoutes } from "./eventRoutes.js";
import { registerTerrainRoutes } from "./terrainRoutes.js";
import { registerSkinningRoutes } from "./skinning.js";
import { registerCookingRoutes } from "./cooking.js";
import { registerPartyRoutes } from "./partySystem.js";
import { registerAuthRoutes } from "./auth.js";
import { registerZoneTransitionRoutes } from "./zoneTransition.js";
import { registerLeaderboardRoutes } from "./leaderboard.js";
import { registerLeatherworkingRoutes } from "./leatherworking.js";
import { registerUpgradingRoutes } from "./upgrading.js";
import { registerJewelcraftingRoutes } from "./jewelcrafting.js";
import { rebuildAuctionCache } from "./auctionHouseChain.js";
import { registerPvPRoutes } from "./pvpRoutes.js";
import { registerPredictionRoutes } from "./predictionRoutes.js";
import { registerX402Routes } from "./x402Routes.js";
import { registerItemRngRoutes } from "./itemRng.js";
import { registerMarketplaceRoutes } from "./marketplace.js";
import { registerItemCatalogRoutes } from "./itemCatalogRoutes.js";
import { registerReputationRoutes } from "./reputationRoutes.js";
import { registerDungeonGateRoutes } from "./dungeonGate.js";
import { registerEssenceTechniqueRoutes } from "./essenceTechniqueRoutes.js";
import { registerDungeonGateTick } from "./dungeonGateTick.js";
import { initDungeonLootTables } from "./dungeonLootTables.js";
import { startGuildNameCacheRefresh } from "./guildChain.js";
import { registerWorldMapRoutes } from "./worldMapRoutes.js";
import { registerDiaryRoutes } from "./diary.js";
import { initWorldMapStore } from "./worldMapStore.js";
import { getTxStats } from "./blockchain.js";
import { getWorldLayout } from "./worldLayout.js";
import { getAllZones } from "./zoneRuntime.js";
import { saveCharacter } from "./characterStore.js";
import { authenticateRequest } from "./auth.js";
import { getLearnedProfessions } from "./professions.js";

const server = Fastify({ logger: true });

// Health check — GCP and you use this to know the shard is alive
server.get("/health", async () => ({ ok: true, uptime: process.uptime() }));

// Transaction stats — live blockchain activity dashboard
server.get("/stats/transactions", async () => getTxStats());

// World layout — zone positions for seamless world rendering
server.get("/world/layout", async () => getWorldLayout());

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
  await saveCharacter(entity.walletAddress, {
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

  // Despawn entity
  const zone = getAllZones().get(foundZoneId!);
  if (zone) {
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
registerZoneTransitionRoutes(server);
registerLeaderboardRoutes(server);
registerLeatherworkingRoutes(server);
registerUpgradingRoutes(server);
registerJewelcraftingRoutes(server);
registerPvPRoutes(server);
registerPredictionRoutes(server);
registerItemRngRoutes(server);
registerMarketplaceRoutes(server);
registerItemCatalogRoutes(server);
registerReputationRoutes(server);
registerDungeonGateRoutes(server);
registerEssenceTechniqueRoutes(server);
registerDungeonGateTick(server);
registerWorldMapRoutes(server);
registerDiaryRoutes(server);
initDungeonLootTables();
startGuildNameCacheRefresh();
spawnNpcs();
registerMerchantAgentTick(server);
initMerchantWallets().catch((err) => {
  server.log.warn(`[merchant] Wallet init failed (non-fatal): ${err.message?.slice(0, 100)}`);
});
spawnOreNodes();
spawnFlowerNodes();

// Mob respawner - check every 5 seconds
setInterval(() => {
  tickMobRespawner();
}, 5000);

const start = async () => {
  // Rebuild auction cache from on-chain events (non-blocking — don't delay server start)
  rebuildAuctionCache().catch((err: any) => {
    server.log.warn(`[auction] Cache rebuild failed (non-fatal): ${err.message?.slice(0, 100)}`);
  });

  await initWorldMapStore();

  const port = Number(process.env.PORT) || 3000;
  const host = "0.0.0.0";

  await server.listen({ port, host });
  server.log.info(`Shard listening on ${host}:${port}`);
};

start();
