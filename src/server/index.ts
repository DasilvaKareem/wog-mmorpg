import Fastify from "fastify";
import type { WorldManager } from "../runtime/world-manager.js";
import type { InventoryManager } from "../runtime/inventory.js";
import type { LootRoller } from "../runtime/loot-roller.js";
import type { BattleManager } from "../runtime/battle-manager.js";
import type { ChatManager } from "../runtime/chat-manager.js";
import type { PartyManager } from "../runtime/party-manager.js";
import type { WorldAgentTemplate } from "../types/world-agent.js";
import type { ItemTemplate } from "../types/item.js";
import type { NavGraph } from "../runtime/nav-graph.js";
import type { AgentRegistry } from "../runtime/agent-registry.js";
import type { TerrainGrid } from "../runtime/terrain-grid.js";
import type { OreManager } from "../runtime/ore-manager.js";
import type { Zone } from "../types/zone.js";
import { registerSpawnOrderRoute } from "./routes/spawn-order.js";
import { registerAgentStateRoute } from "./routes/agent-state.js";
import { registerTemplatesRoute } from "./routes/templates.js";
import { registerInventoryRoutes } from "./routes/inventory.js";
import { registerWorldRoutes } from "./routes/world.js";
import { registerBattleRoutes } from "./routes/battle.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerPartyRoutes } from "./routes/party.js";
import { registerNavigateRoutes } from "./routes/navigate.js";
import { registerTerrainRoutes } from "./routes/terrain.js";
import { registerMiningRoutes } from "./routes/mining.js";
import { registerChunkRoutes } from "./routes/chunks.js";

export interface ServerDeps {
  world: WorldManager;
  templates: Map<string, WorldAgentTemplate>;
  items: Map<string, ItemTemplate>;
  inventory: InventoryManager;
  lootRoller: LootRoller;
  battles: BattleManager;
  chat: ChatManager;
  parties: PartyManager;
  navGraph: NavGraph;
  agentRegistry: AgentRegistry;
  zones: Map<string, Zone>;
  terrainGrids: Map<string, TerrainGrid>;
  oreManagers: Map<string, OreManager>;
}

export function buildServer(deps: ServerDeps) {
  const app = Fastify({ logger: false });

  registerWorldRoutes(app, deps.world);
  registerSpawnOrderRoute(app, deps.world);
  registerAgentStateRoute(app, deps.world);
  registerTemplatesRoute(app, deps.templates);
  registerInventoryRoutes(app, deps.inventory, deps.lootRoller, deps.items);
  registerBattleRoutes(app, deps.battles);
  registerChatRoutes(app, deps.chat);
  registerPartyRoutes(app, deps.parties);
  registerNavigateRoutes(app, deps.navGraph, deps.agentRegistry, deps.zones);
  registerTerrainRoutes(app, deps.terrainGrids);
  registerMiningRoutes(app, deps.oreManagers, deps.world);
  registerChunkRoutes(app, deps.world);

  return app;
}
