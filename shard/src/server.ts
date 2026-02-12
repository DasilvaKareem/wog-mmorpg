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
import { registerPartyRoutes } from "./partySystem.js";

const server = Fastify({ logger: true });

// Health check — GCP and you use this to know the shard is alive
server.get("/health", async () => ({ ok: true, uptime: process.uptime() }));

// Register subsystems
server.register(cors, { origin: true });
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
registerPartyRoutes(server);
spawnNpcs();
spawnOreNodes();
spawnFlowerNodes();

// Mob respawner - check every 5 seconds
setInterval(() => {
  tickMobRespawner();
}, 5000);

const start = async () => {
  const port = Number(process.env.PORT) || 3000;
  const host = "0.0.0.0";

  await server.listen({ port, host });
  server.log.info(`Shard listening on ${host}:${port}`);
};

start();
