import type { Vec2 } from "../types/zone.js";
import type { NavGraph, NavPath } from "./nav-graph.js";

export interface AgentLocation {
  agentId: string;
  name: string;
  zoneId: string;
  poiId: string;
  position: Vec2;
  registeredAt: number;
}

export interface MoveResult {
  success: boolean;
  agent: AgentLocation;
  action: "move" | "portal";
  message: string;
}

export class AgentRegistry {
  private agents: Map<string, AgentLocation> = new Map();
  private navGraph: NavGraph;

  constructor(navGraph: NavGraph) {
    this.navGraph = navGraph;
  }

  /** Register an agent at a starting POI */
  register(agentId: string, name: string, zoneId: string, poiId: string, position: Vec2): AgentLocation | string {
    if (this.agents.has(agentId)) return "agent already registered";

    const agent: AgentLocation = {
      agentId,
      name,
      zoneId,
      poiId,
      position: { ...position },
      registeredAt: Date.now(),
    };

    this.agents.set(agentId, agent);
    console.log(`[AgentRegistry] ${name} registered at ${zoneId}:${poiId}`);
    return agent;
  }

  /** Get an agent's current location */
  getLocation(agentId: string): AgentLocation | undefined {
    return this.agents.get(agentId);
  }

  /** Find path for an agent from current location to a destination */
  navigate(agentId: string, toZone: string, toPoi: string): NavPath | string {
    const agent = this.agents.get(agentId);
    if (!agent) return "agent not registered";

    return this.navGraph.findPath(agent.zoneId, agent.poiId, toZone, toPoi);
  }

  /** Move an agent to an adjacent POI. Validates road connectivity. Handles portal transitions. */
  move(agentId: string, toPoi: string, toZone?: string): MoveResult | string {
    const agent = this.agents.get(agentId);
    if (!agent) return "agent not registered";

    // Determine target zone: if toPoi is a portal destination, toZone is the destination zone
    const targetZone = toZone ?? agent.zoneId;

    // Check adjacency
    if (!this.navGraph.isAdjacent(agent.zoneId, agent.poiId, targetZone, toPoi)) {
      return `cannot move from ${agent.zoneId}:${agent.poiId} to ${targetZone}:${toPoi} — not connected by road or portal`;
    }

    // Determine if this is a portal transition
    const neighbors = this.navGraph.getNeighbors(agent.zoneId, agent.poiId);
    const edge = neighbors.find((e) => e.to === `${targetZone}:${toPoi}`);
    const isPortal = edge?.type === "portal";

    // Get destination position from the nav graph
    const path = this.navGraph.findPath(agent.zoneId, agent.poiId, targetZone, toPoi);
    if (typeof path === "string") return path;

    // Update agent location
    const step = path.steps[0];
    agent.zoneId = targetZone;
    agent.poiId = toPoi;
    agent.position = { ...step.position };

    const action = isPortal ? "portal" : "move";
    const message = isPortal
      ? `${agent.name} traveled through portal to ${targetZone}:${toPoi}`
      : `${agent.name} moved to ${agent.zoneId}:${toPoi}`;

    return { success: true, agent: { ...agent, position: { ...agent.position } }, action, message };
  }

  /** Get all agents in a specific zone */
  getAgentsInZone(zoneId: string): AgentLocation[] {
    const results: AgentLocation[] = [];
    for (const agent of this.agents.values()) {
      if (agent.zoneId === zoneId) {
        results.push({ ...agent, position: { ...agent.position } });
      }
    }
    return results;
  }

  /** Unregister an agent */
  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }
}
