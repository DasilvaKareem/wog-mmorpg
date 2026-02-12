import type { Zone, WorldMap, ZoneConnection } from "../types/zone.js";
import type { WorldAgentTemplate } from "../types/world-agent.js";
import type { TerrainGrid } from "./terrain-grid.js";
import type { OreManager } from "./ore-manager.js";
import { ZoneRuntime } from "./zone-runtime.js";

export class WorldManager {
  private worldMap: WorldMap;
  private zones: Map<string, Zone>;
  private runtimes: Map<string, ZoneRuntime> = new Map();
  private templates: Map<string, WorldAgentTemplate>;

  constructor(
    worldMap: WorldMap,
    zones: Map<string, Zone>,
    templates: Map<string, WorldAgentTemplate>,
    terrainGrids?: Map<string, TerrainGrid>,
    oreManagers?: Map<string, OreManager>,
  ) {
    this.worldMap = worldMap;
    this.zones = zones;
    this.templates = templates;

    for (const [id, zone] of zones) {
      this.runtimes.set(id, new ZoneRuntime(zone, templates, terrainGrids?.get(id), oreManagers?.get(id)));
    }
  }

  start(): void {
    for (const [id, runtime] of this.runtimes) {
      runtime.start();
    }
    console.log(`[WorldManager] Started ${this.runtimes.size} zone runtimes`);
  }

  stop(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.stop();
    }
  }

  getRuntime(zoneId: string): ZoneRuntime | undefined {
    return this.runtimes.get(zoneId);
  }

  getZone(zoneId: string): Zone | undefined {
    return this.zones.get(zoneId);
  }

  getWorldMap(): WorldMap {
    return this.worldMap;
  }

  /** Get all zone IDs */
  getZoneIds(): string[] {
    return Array.from(this.zones.keys());
  }

  /** Get connections for a specific zone */
  getConnectionsFrom(zoneId: string): ZoneConnection[] {
    return this.worldMap.connections.filter(
      (c) => c.from === zoneId || c.to === zoneId,
    );
  }

  /** Get overview of all zones with stats */
  getWorldOverview(): {
    zones: Array<{
      id: string;
      name: string;
      population: number;
      threat: number;
      tick: number;
      poiCount: number;
      portals: string[];
    }>;
    connections: ZoneConnection[];
  } {
    const zones = [];
    for (const [id, zone] of this.zones) {
      const runtime = this.runtimes.get(id)!;
      const stats = runtime.getStats();
      const portals = zone.pois
        .filter((p) => p.type === "portal")
        .map((p) => p.portal!.destinationZone);

      zones.push({
        id: zone.id,
        name: zone.name,
        population: stats.population,
        threat: stats.threat,
        tick: stats.tick,
        poiCount: zone.pois.length,
        portals,
      });
    }

    return { zones, connections: this.worldMap.connections };
  }
}
