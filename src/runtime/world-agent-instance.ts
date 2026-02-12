import type { Vec2 } from "../types/zone.js";
import type { WorldAgentState, WorldAgentTemplate } from "../types/world-agent.js";
import type { TerrainGrid } from "./terrain-grid.js";

function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export class WorldAgentInstance {
  private state: WorldAgentState;
  private patrolTarget: Vec2 | null = null;
  private terrain: TerrainGrid | null;

  constructor(instanceId: string, template: WorldAgentTemplate, position: Vec2, terrain?: TerrainGrid) {
    this.terrain = terrain ?? null;
    this.state = {
      instanceId,
      templateId: template.templateId,
      tier: template.tier,
      name: template.name,
      position: { x: position.x, z: position.z },
      spawnPosition: { x: position.x, z: position.z },
      health: template.health,
      maxHealth: template.health,
      threat: template.threat,
      speed: template.speed,
      leashRadius: template.leashRadius,
      perceptionRadius: template.perceptionRadius,
      behavior: template.behavior,
      ticksAlive: 0,
      ttlTicks: template.ttlTicks,
      alive: true,
    };
  }

  tick(): void {
    if (!this.state.alive) return;

    this.state.ticksAlive++;

    // TTL check
    if (this.state.ttlTicks > 0 && this.state.ticksAlive >= this.state.ttlTicks) {
      this.state.alive = false;
      return;
    }

    switch (this.state.behavior) {
      case "patrol":
        this.tickPatrol();
        break;
      case "territorial":
      case "idle":
        // No movement — just age
        break;
    }

    // Clamp to walkable tile at end of tick
    if (this.terrain) {
      const clamped = this.terrain.clampToWalkable(this.state.position);
      this.state.position.x = clamped.x;
      this.state.position.z = clamped.z;
    }
  }

  private tickPatrol(): void {
    const { position, spawnPosition, speed, leashRadius } = this.state;

    // If too far from spawn, walk back
    const distFromSpawn = distance(position, spawnPosition);
    if (distFromSpawn > leashRadius) {
      this.moveToward(spawnPosition, speed);
      this.patrolTarget = null;
      return;
    }

    // Pick a new patrol target if we don't have one or reached current
    if (!this.patrolTarget || distance(position, this.patrolTarget) < speed) {
      this.patrolTarget = this.randomPointInLeash();
    }

    this.moveToward(this.patrolTarget, speed);
  }

  private moveToward(target: Vec2, maxStep: number): void {
    const dx = target.x - this.state.position.x;
    const dz = target.z - this.state.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist === 0) return;

    // Scale step by terrain movement cost
    const costMultiplier = this.terrain ? this.terrain.getMovementCost(this.state.position) : 1.0;
    const effectiveStep = Math.min(maxStep / costMultiplier, dist);

    const newX = this.state.position.x + (dx / dist) * effectiveStep;
    const newZ = this.state.position.z + (dz / dist) * effectiveStep;

    // Reject move if destination is not walkable
    if (this.terrain && !this.terrain.isWalkable({ x: newX, z: newZ })) {
      this.patrolTarget = null; // pick a new target next tick
      return;
    }

    this.state.position.x = newX;
    this.state.position.z = newZ;
  }

  private randomPointInLeash(): Vec2 {
    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * this.state.leashRadius * 0.8;
      const candidate: Vec2 = {
        x: this.state.spawnPosition.x + Math.cos(angle) * r,
        z: this.state.spawnPosition.z + Math.sin(angle) * r,
      };
      if (!this.terrain || this.terrain.isWalkable(candidate)) {
        return candidate;
      }
    }
    // Fallback to spawn position
    return { x: this.state.spawnPosition.x, z: this.state.spawnPosition.z };
  }

  getState(): WorldAgentState {
    return { ...this.state, position: { ...this.state.position } };
  }

  get alive(): boolean {
    return this.state.alive;
  }

  get threat(): number {
    return this.state.threat;
  }

  get instanceId(): string {
    return this.state.instanceId;
  }

  get position(): Vec2 {
    return this.state.position;
  }
}
