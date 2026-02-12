import type { FastifyInstance } from "fastify";
import type { NavGraph } from "../../runtime/nav-graph.js";
import type { AgentRegistry } from "../../runtime/agent-registry.js";
import type { Zone } from "../../types/zone.js";

interface RegisterBody {
  agentId: string;
  name: string;
  zoneId: string;
  poiId: string;
}

interface MoveBody {
  agentId: string;
  toPoi: string;
  toZone?: string;
}

export function registerNavigateRoutes(
  app: FastifyInstance,
  navGraph: NavGraph,
  registry: AgentRegistry,
  zones: Map<string, Zone>,
): void {
  // Register an agent at a starting POI
  app.post<{ Body: RegisterBody }>("/v1/agent/register", (req, reply) => {
    const { agentId, name, zoneId, poiId } = req.body ?? {};
    if (!agentId || !name || !zoneId || !poiId) {
      return reply.status(400).send({ error: "agentId, name, zoneId, and poiId are required" });
    }

    const zone = zones.get(zoneId);
    if (!zone) return reply.status(404).send({ error: `zone not found: ${zoneId}` });

    const poi = zone.pois.find((p) => p.id === poiId);
    if (!poi) return reply.status(404).send({ error: `POI not found: ${poiId} in zone ${zoneId}` });

    const result = registry.register(agentId, name, zoneId, poiId, poi.position);
    if (typeof result === "string") {
      return reply.status(409).send({ error: result });
    }
    return reply.send(result);
  });

  // Get agent's current location
  app.get<{ Params: { agentId: string } }>("/v1/agent/:agentId/location", (req, reply) => {
    const location = registry.getLocation(req.params.agentId);
    if (!location) return reply.status(404).send({ error: "agent not registered" });
    return reply.send(location);
  });

  // Find path from agent's current location to a destination
  app.get<{ Querystring: { agentId: string; toZone: string; toPoi: string } }>(
    "/v1/navigate",
    (req, reply) => {
      const { agentId, toZone, toPoi } = req.query;
      if (!agentId || !toZone || !toPoi) {
        return reply.status(400).send({ error: "agentId, toZone, and toPoi are required" });
      }

      const result = registry.navigate(agentId, toZone, toPoi);
      if (typeof result === "string") {
        return reply.status(409).send({ error: result });
      }
      return reply.send(result);
    },
  );

  // Move agent one step (validates adjacency)
  app.post<{ Body: MoveBody }>("/v1/move", (req, reply) => {
    const { agentId, toPoi, toZone } = req.body ?? {};
    if (!agentId || !toPoi) {
      return reply.status(400).send({ error: "agentId and toPoi are required" });
    }

    const result = registry.move(agentId, toPoi, toZone);
    if (typeof result === "string") {
      return reply.status(409).send({ error: result });
    }
    return reply.send(result);
  });

  // Get all agents in a zone
  app.get<{ Params: { zoneId: string } }>("/v1/agents/zone/:zoneId", (req, reply) => {
    const agents = registry.getAgentsInZone(req.params.zoneId);
    return reply.send({ zoneId: req.params.zoneId, agents, count: agents.length });
  });

  // Unregister an agent
  app.delete<{ Params: { agentId: string } }>("/v1/agent/:agentId", (req, reply) => {
    const removed = registry.unregister(req.params.agentId);
    if (!removed) return reply.status(404).send({ error: "agent not registered" });
    return reply.send({ status: "unregistered", agentId: req.params.agentId });
  });
}
