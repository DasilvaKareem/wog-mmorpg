import { loadWorldMap, loadAllZones, loadAllTemplates, loadAllItems, loadAllLootTables, loadAllTerrainGrids } from "./loader/content-loader.js";
import { WorldManager } from "./runtime/world-manager.js";
import { OreManager } from "./runtime/ore-manager.js";
import { InventoryManager } from "./runtime/inventory.js";
import { LootRoller } from "./runtime/loot-roller.js";
import { BattleManager } from "./runtime/battle-manager.js";
import { ChatManager } from "./runtime/chat-manager.js";
import { PartyManager } from "./runtime/party-manager.js";
import { NavGraph } from "./runtime/nav-graph.js";
import { AgentRegistry } from "./runtime/agent-registry.js";
import { buildServer } from "./server/index.js";

const PORT = 3000;

// Load world
const worldMap = loadWorldMap();
const zones = loadAllZones(worldMap);
console.log(`[Shard] Loaded world: ${zones.size} zones (${worldMap.connections.length} connections)`);
for (const zone of zones.values()) {
  const portals = zone.pois.filter((p) => p.type === "portal").length;
  const structures = zone.pois.filter((p) => p.type === "structure").length;
  console.log(`  - ${zone.name}: ${zone.pois.length} POIs (${portals} portals, ${structures} structures), ${zone.roads.length} roads`);
}

// Load templates + items
const templates = loadAllTemplates();
console.log(`[Shard] Loaded ${templates.size} templates`);

const items = loadAllItems();
console.log(`[Shard] Loaded ${items.size} items`);

const lootTables = loadAllLootTables();
console.log(`[Shard] Loaded ${lootTables.size} loot tables`);

// Load terrain grids + ore deposits (auto-generates on first run)
const { grids: terrainGrids, oreDeposits } = loadAllTerrainGrids(zones);
console.log(`[Shard] Loaded ${terrainGrids.size} terrain grids`);

// Create ore managers per zone
const oreManagers = new Map<string, OreManager>();
for (const [id, grid] of terrainGrids) {
  const deposits = oreDeposits.get(id) ?? [];
  const mgr = new OreManager(grid, deposits);
  oreManagers.set(id, mgr);
  if (mgr.size > 0) {
    console.log(`[Shard] Zone "${id}": ${mgr.size} ore deposits`);
  }
}

// Start world
const world = new WorldManager(worldMap, zones, templates, terrainGrids, oreManagers);
world.start();

const inventory = new InventoryManager(items);
const lootRoller = new LootRoller(lootTables, items);
const chat = new ChatManager();
const parties = new PartyManager();
const battles = new BattleManager(templates, parties);

// Navigation
const navGraph = new NavGraph(worldMap, zones, terrainGrids);
const agentRegistry = new AgentRegistry(navGraph);

// Start server
const server = buildServer({ world, templates, items, inventory, lootRoller, battles, chat, parties, navGraph, agentRegistry, zones, terrainGrids, oreManagers });
server.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`[Shard] Listening on ${address}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Shard] Shutting down...");
  world.stop();
  server.close();
  process.exit(0);
});
