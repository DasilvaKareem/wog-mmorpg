import { randomUUID } from "node:crypto";
import type { Vec2, Zone } from "../types/zone.js";
import type { WorldAgentTemplate } from "../types/world-agent.js";
import type { WorldAgentState } from "../types/world-agent.js";
import type { SpawnOrder, SpawnOrderResult } from "../types/spawn-order.js";
import type { TerrainGrid } from "./terrain-grid.js";
import type { OreManager } from "./ore-manager.js";
import { WorldAgentInstance } from "./world-agent-instance.js";

const TICK_INTERVAL_MS = 500;

export class ZoneRuntime {
  private zone: Zone;
  private templates: Map<string, WorldAgentTemplate>;
  private agents: Map<string, WorldAgentInstance> = new Map();
  private processedOrders: Set<string> = new Set();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private terrain: TerrainGrid | null;
  private oreManager: OreManager | null;

  constructor(zone: Zone, templates: Map<string, WorldAgentTemplate>, terrain?: TerrainGrid, oreManager?: OreManager) {
    this.zone = zone;
    this.templates = templates;
    this.terrain = terrain ?? null;
    this.oreManager = oreManager ?? null;
  }

  start(): void {
    if (this.tickHandle) return;
    console.log(`[ZoneRuntime] Starting tick loop for "${this.zone.name}" (${TICK_INTERVAL_MS}ms)`);
    this.tickHandle = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      console.log(`[ZoneRuntime] Stopped tick loop for "${this.zone.name}"`);
    }
  }

  private tick(): void {
    this.tickCount++;

    for (const agent of this.agents.values()) {
      agent.tick();
    }

    // Remove dead agents
    for (const [id, agent] of this.agents) {
      if (!agent.alive) {
        this.agents.delete(id);
        console.log(`[ZoneRuntime] Agent ${id} despawned (tick ${this.tickCount})`);
      }
    }

    // Respawn depleted ore deposits
    if (this.oreManager) {
      this.oreManager.tickRespawn(this.tickCount);
    }
  }

  processSpawnOrder(order: SpawnOrder): SpawnOrderResult {
    // Idempotency
    if (this.processedOrders.has(order.orderId)) {
      return { orderId: order.orderId, status: "rejected", reason: "duplicate order" };
    }

    // Zone match
    if (order.zoneId !== this.zone.id) {
      return { orderId: order.orderId, status: "rejected", reason: "zone mismatch" };
    }

    // Template exists
    const template = this.templates.get(order.templateId);
    if (!template) {
      return { orderId: order.orderId, status: "rejected", reason: "unknown template" };
    }

    // Count validation
    if (order.count < 1 || order.count > 10) {
      return { orderId: order.orderId, status: "rejected", reason: "count must be 1-10" };
    }

    // Bounds check
    if (!this.inBounds(order.position)) {
      return { orderId: order.orderId, status: "rejected", reason: "position out of bounds" };
    }

    // Walkability check
    if (this.terrain && !this.terrain.isWalkable(order.position)) {
      return { orderId: order.orderId, status: "rejected", reason: "position not walkable" };
    }

    // Budget: population
    if (this.agents.size + order.count > this.zone.budget.maxPopulation) {
      return { orderId: order.orderId, status: "rejected", reason: "population budget exceeded" };
    }

    // Budget: threat
    const currentThreat = this.currentThreat();
    if (currentThreat + template.threat * order.count > this.zone.budget.maxThreat) {
      return { orderId: order.orderId, status: "rejected", reason: "threat budget exceeded" };
    }

    // Spawn
    const instanceIds: string[] = [];
    for (let i = 0; i < order.count; i++) {
      const id = randomUUID();
      const agent = new WorldAgentInstance(id, template, order.position, this.terrain ?? undefined);
      this.agents.set(id, agent);
      instanceIds.push(id);
    }

    this.processedOrders.add(order.orderId);
    console.log(`[ZoneRuntime] SpawnOrder ${order.orderId}: spawned ${order.count}x ${template.name}`);

    return { orderId: order.orderId, status: "accepted", instanceIds };
  }

  getEntitiesNear(position: Vec2, radius: number): { entities: WorldAgentState[]; tick: number } {
    const results: WorldAgentState[] = [];
    const r2 = radius * radius;

    for (const agent of this.agents.values()) {
      const pos = agent.position;
      const dx = pos.x - position.x;
      const dz = pos.z - position.z;
      if (dx * dx + dz * dz <= r2) {
        results.push(agent.getState());
      }
    }

    return { entities: results, tick: this.tickCount };
  }

  getStats(): { population: number; threat: number; tick: number; zoneId: string } {
    return {
      zoneId: this.zone.id,
      population: this.agents.size,
      threat: this.currentThreat(),
      tick: this.tickCount,
    };
  }

  getTerrainGrid(): TerrainGrid | null {
    return this.terrain;
  }

  getOreManager(): OreManager | null {
    return this.oreManager;
  }

  private currentThreat(): number {
    let threat = 0;
    for (const agent of this.agents.values()) {
      threat += agent.threat;
    }
    return threat;
  }

  private inBounds(pos: Vec2): boolean {
    const { min, max } = this.zone.bounds;
    return pos.x >= min.x && pos.x <= max.x && pos.z >= min.z && pos.z <= max.z;
  }
}
