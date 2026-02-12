import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Zone, WorldMap } from "../types/zone.js";
import type { WorldAgentTemplate, AgentTier } from "../types/world-agent.js";
import { ALL_TIERS, TIER_MULTIPLIERS, TIER_NAME_PREFIX } from "../types/world-agent.js";
import type { ItemTemplate } from "../types/item.js";
import type { LootTable } from "../types/loot-table.js";
import type { TerrainGridData } from "../types/terrain.js";
import { TerrainGrid } from "../runtime/terrain-grid.js";
import { generateTerrainGrid, generateOreDeposits } from "./terrain-generator.js";
import type { OreDepositData } from "../types/ore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "../data");

export function loadWorldMap(): WorldMap {
  const path = resolve(dataDir, "world.json");
  return JSON.parse(readFileSync(path, "utf-8")) as WorldMap;
}

export function loadZone(id: string): Zone {
  const path = resolve(dataDir, "zones", `${id}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as Zone;
}

/** Loads all zones listed in world.json */
export function loadAllZones(worldMap: WorldMap): Map<string, Zone> {
  const zones = new Map<string, Zone>();
  for (const id of worldMap.zones) {
    zones.set(id, loadZone(id));
  }
  return zones;
}

export function loadTemplate(id: string): WorldAgentTemplate {
  const path = resolve(dataDir, "templates", `${id}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as WorldAgentTemplate;
}

/**
 * Loads base templates from JSON and generates all tier variants.
 * Base templates become "normal" tier. lesser/greater/elite are derived via multipliers.
 * templateId format: "lesser-wolf", "wolf", "greater-wolf", "elite-wolf"
 */
export function loadAllTemplates(): Map<string, WorldAgentTemplate> {
  const dir = resolve(dataDir, "templates");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const templates = new Map<string, WorldAgentTemplate>();

  for (const file of files) {
    const base = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as WorldAgentTemplate;

    for (const tier of ALL_TIERS) {
      const variant = applyTier(base, tier);
      templates.set(variant.templateId, variant);
    }
  }

  return templates;
}

function applyTier(base: WorldAgentTemplate, tier: AgentTier): WorldAgentTemplate {
  const m = TIER_MULTIPLIERS[tier];
  const prefix = TIER_NAME_PREFIX[tier];
  const tieredId = tier === "normal" ? base.templateId : `${tier}-${base.templateId}`;
  const tieredName = prefix ? `${prefix} ${base.name}` : base.name;

  return {
    ...base,
    templateId: tieredId,
    name: tieredName,
    tier,
    health: Math.round(base.health * m.health),
    threat: Math.round(base.threat * m.threat),
    speed: +(base.speed * m.speed).toFixed(1),
    perceptionRadius: Math.round(base.perceptionRadius * m.perceptionRadius),
    ttlTicks: base.ttlTicks > 0 ? Math.round(base.ttlTicks * m.ttlTicks) : 0,
    attack: Math.round(base.attack * m.attack),
    defense: Math.round(base.defense * m.defense),
    battleSpeed: Math.round(base.battleSpeed * m.battleSpeed),
  };
}

/** Loads every .json file in src/data/items/ into a Map keyed by itemId */
export function loadAllItems(): Map<string, ItemTemplate> {
  const dir = resolve(dataDir, "items");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const items = new Map<string, ItemTemplate>();

  for (const file of files) {
    const item = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as ItemTemplate;
    items.set(item.itemId, item);
  }

  return items;
}

/** Loads every .json file in src/data/loot-tables/ into a Map keyed by tableId */
export function loadAllLootTables(): Map<string, LootTable> {
  const dir = resolve(dataDir, "loot-tables");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const tables = new Map<string, LootTable>();

  for (const file of files) {
    const table = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as LootTable;
    tables.set(table.tableId, table);
  }

  return tables;
}

/** Load terrain grid from .terrain.json or auto-generate + save if missing */
export function loadTerrainGrid(zone: Zone): { grid: TerrainGrid; oreDeposits: OreDepositData[] } {
  const zonesDir = resolve(dataDir, "zones");
  const terrainPath = resolve(zonesDir, `${zone.id}.terrain.json`);
  const oresPath = resolve(zonesDir, `${zone.id}.ores.json`);

  let data: TerrainGridData;
  if (existsSync(terrainPath)) {
    data = JSON.parse(readFileSync(terrainPath, "utf-8")) as TerrainGridData;
    console.log(`[ContentLoader] Loaded terrain grid for "${zone.id}" (${data.width}x${data.height})`);
  } else {
    data = generateTerrainGrid(zone);
    writeFileSync(terrainPath, JSON.stringify(data), "utf-8");
    console.log(`[ContentLoader] Generated terrain grid for "${zone.id}" (${data.width}x${data.height})`);
  }

  let oreDeposits: OreDepositData[];
  if (existsSync(oresPath)) {
    oreDeposits = JSON.parse(readFileSync(oresPath, "utf-8")) as OreDepositData[];
    console.log(`[ContentLoader] Loaded ${oreDeposits.length} ore deposits for "${zone.id}"`);
  } else {
    oreDeposits = generateOreDeposits(zone, data.tiles, data.width, data.height);
    writeFileSync(oresPath, JSON.stringify(oreDeposits), "utf-8");
    console.log(`[ContentLoader] Generated ${oreDeposits.length} ore deposits for "${zone.id}"`);
  }

  return { grid: new TerrainGrid(data), oreDeposits };
}

/** Load terrain grids and ore deposits for all zones */
export function loadAllTerrainGrids(zones: Map<string, Zone>): {
  grids: Map<string, TerrainGrid>;
  oreDeposits: Map<string, OreDepositData[]>;
} {
  const grids = new Map<string, TerrainGrid>();
  const oreDeposits = new Map<string, OreDepositData[]>();
  for (const [id, zone] of zones) {
    const result = loadTerrainGrid(zone);
    grids.set(id, result.grid);
    oreDeposits.set(id, result.oreDeposits);
  }
  return { grids, oreDeposits };
}
