import type { Zone, Vec2, WorldMap } from "../types/zone.js";
import type { TerrainGrid } from "./terrain-grid.js";

/** A node in the world graph: zone + POI */
export interface NavNode {
  key: string;        // "zoneId:poiId"
  zoneId: string;
  poiId: string;
  position: Vec2;
}

export interface NavEdge {
  from: string;       // node key
  to: string;         // node key
  distance: number;
  type: "road" | "portal";
  roadName?: string;
}

export interface NavStep {
  zoneId: string;
  poiId: string;
  poiName: string;
  position: Vec2;
  action: "move" | "portal";
  roadName?: string;
  portalTo?: string;  // destination zone for portal steps
}

export interface NavPath {
  from: { zoneId: string; poiId: string };
  to: { zoneId: string; poiId: string };
  steps: NavStep[];
  totalDistance: number;
  zoneTransitions: number;
}

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function nodeKey(zoneId: string, poiId: string): string {
  return `${zoneId}:${poiId}`;
}

export class NavGraph {
  private nodes: Map<string, NavNode> = new Map();
  private adjacency: Map<string, NavEdge[]> = new Map();
  private zones: Map<string, Zone>;
  private terrainGrids: Map<string, TerrainGrid>;

  constructor(worldMap: WorldMap, zones: Map<string, Zone>, terrainGrids?: Map<string, TerrainGrid>) {
    this.zones = zones;
    this.terrainGrids = terrainGrids ?? new Map();
    this.buildGraph(zones);
  }

  /** Sample terrain cost along a line between two world positions within a zone */
  private averageTerrainCost(zoneId: string, from: Vec2, to: Vec2): number {
    const grid = this.terrainGrids.get(zoneId);
    if (!grid) return 1.0;

    const d = dist(from, to);
    if (d === 0) return grid.getMovementCost(from);

    const sampleInterval = 10;
    const numSamples = Math.max(1, Math.floor(d / sampleInterval));
    let totalCost = 0;

    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const pos: Vec2 = {
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
      };
      totalCost += grid.getMovementCost(pos);
    }

    return totalCost / (numSamples + 1);
  }

  private buildGraph(zones: Map<string, Zone>): void {
    // Add all POI nodes
    for (const [zoneId, zone] of zones) {
      for (const poi of zone.pois) {
        const key = nodeKey(zoneId, poi.id);
        this.nodes.set(key, { key, zoneId, poiId: poi.id, position: poi.position });
        this.adjacency.set(key, []);
      }
    }

    // Add road edges (bidirectional, distance * terrain cost weighted)
    for (const [zoneId, zone] of zones) {
      for (const road of zone.roads) {
        for (let i = 0; i < road.nodes.length - 1; i++) {
          const fromPoi = zone.pois.find((p) => p.id === road.nodes[i]);
          const toPoi = zone.pois.find((p) => p.id === road.nodes[i + 1]);
          if (!fromPoi || !toPoi) continue;

          const fromKey = nodeKey(zoneId, fromPoi.id);
          const toKey = nodeKey(zoneId, toPoi.id);
          const d = dist(fromPoi.position, toPoi.position);
          const terrainCost = this.averageTerrainCost(zoneId, fromPoi.position, toPoi.position);
          const weight = d * terrainCost;

          this.addEdge(fromKey, toKey, weight, "road", road.name);
          this.addEdge(toKey, fromKey, weight, "road", road.name);
        }
      }
    }

    // Add portal edges (cross-zone, small fixed cost)
    for (const [zoneId, zone] of zones) {
      for (const poi of zone.pois) {
        if (poi.type !== "portal" || !poi.portal) continue;

        const fromKey = nodeKey(zoneId, poi.id);
        const toKey = nodeKey(poi.portal.destinationZone, poi.portal.destinationPoi);

        if (!this.nodes.has(toKey)) continue;

        // Portal traversal has a small fixed cost (simulates loading/transition)
        const PORTAL_COST = 10;
        this.addEdge(fromKey, toKey, PORTAL_COST, "portal");

        if (poi.portal.bidirectional) {
          this.addEdge(toKey, fromKey, PORTAL_COST, "portal");
        }
      }
    }

    console.log(`[NavGraph] Built graph: ${this.nodes.size} nodes, ${this.totalEdges()} edges`);
  }

  private addEdge(from: string, to: string, distance: number, type: "road" | "portal", roadName?: string): void {
    const edges = this.adjacency.get(from);
    if (!edges) return;
    // Avoid duplicate edges
    if (edges.some((e) => e.to === to && e.type === type)) return;
    edges.push({ from, to, distance, type, roadName });
  }

  private totalEdges(): number {
    let count = 0;
    for (const edges of this.adjacency.values()) {
      count += edges.length;
    }
    return count;
  }

  /** Dijkstra: find shortest path between two POIs (can be cross-zone) */
  findPath(fromZone: string, fromPoi: string, toZone: string, toPoi: string): NavPath | string {
    const startKey = nodeKey(fromZone, fromPoi);
    const endKey = nodeKey(toZone, toPoi);

    if (!this.nodes.has(startKey)) return `unknown start: ${fromZone}:${fromPoi}`;
    if (!this.nodes.has(endKey)) return `unknown destination: ${toZone}:${toPoi}`;

    if (startKey === endKey) {
      return {
        from: { zoneId: fromZone, poiId: fromPoi },
        to: { zoneId: toZone, poiId: toPoi },
        steps: [],
        totalDistance: 0,
        zoneTransitions: 0,
      };
    }

    // Dijkstra
    const distMap = new Map<string, number>();
    const prev = new Map<string, string>();
    const prevEdge = new Map<string, NavEdge>();
    const visited = new Set<string>();

    for (const key of this.nodes.keys()) {
      distMap.set(key, Infinity);
    }
    distMap.set(startKey, 0);

    while (true) {
      // Find unvisited node with smallest distance
      let current: string | null = null;
      let currentDist = Infinity;
      for (const [key, d] of distMap) {
        if (!visited.has(key) && d < currentDist) {
          current = key;
          currentDist = d;
        }
      }

      if (current === null || current === endKey) break;
      visited.add(current);

      const edges = this.adjacency.get(current) ?? [];
      for (const edge of edges) {
        if (visited.has(edge.to)) continue;
        const newDist = currentDist + edge.distance;
        if (newDist < (distMap.get(edge.to) ?? Infinity)) {
          distMap.set(edge.to, newDist);
          prev.set(edge.to, current);
          prevEdge.set(edge.to, edge);
        }
      }
    }

    if (!prev.has(endKey)) {
      return `no path from ${fromZone}:${fromPoi} to ${toZone}:${toPoi}`;
    }

    // Reconstruct path
    const pathKeys: string[] = [];
    let cursor = endKey;
    while (cursor !== startKey) {
      pathKeys.unshift(cursor);
      cursor = prev.get(cursor)!;
    }

    // Build steps
    const steps: NavStep[] = [];
    let zoneTransitions = 0;

    for (const key of pathKeys) {
      const node = this.nodes.get(key)!;
      const edge = prevEdge.get(key)!;
      const zone = this.zones.get(node.zoneId)!;
      const poi = zone.pois.find((p) => p.id === node.poiId)!;

      if (edge.type === "portal") {
        zoneTransitions++;
        steps.push({
          zoneId: node.zoneId,
          poiId: node.poiId,
          poiName: poi.name,
          position: node.position,
          action: "portal",
          portalTo: node.zoneId,
        });
      } else {
        steps.push({
          zoneId: node.zoneId,
          poiId: node.poiId,
          poiName: poi.name,
          position: node.position,
          action: "move",
          roadName: edge.roadName,
        });
      }
    }

    return {
      from: { zoneId: fromZone, poiId: fromPoi },
      to: { zoneId: toZone, poiId: toPoi },
      steps,
      totalDistance: Math.round(distMap.get(endKey)!),
      zoneTransitions,
    };
  }

  /** Get all POIs reachable from a given POI (direct neighbors via roads/portals) */
  getNeighbors(zoneId: string, poiId: string): NavEdge[] {
    return this.adjacency.get(nodeKey(zoneId, poiId)) ?? [];
  }

  /** Check if two POIs are directly connected */
  isAdjacent(fromZone: string, fromPoi: string, toZone: string, toPoi: string): boolean {
    const edges = this.adjacency.get(nodeKey(fromZone, fromPoi)) ?? [];
    return edges.some((e) => e.to === nodeKey(toZone, toPoi));
  }
}
