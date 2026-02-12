import type { FastifyInstance } from "fastify";
import type { WorldManager } from "../../runtime/world-manager.js";

interface AgentStateQuery {
  zone: string;
  x: string;
  z: string;
  radius: string;
}

export function registerAgentStateRoute(app: FastifyInstance, world: WorldManager): void {
  app.get<{ Querystring: AgentStateQuery }>("/v1/agent/state", (req, reply) => {
    const zoneId = req.query.zone;
    if (!zoneId) {
      return reply.status(400).send({ error: "zone query param is required" });
    }

    const runtime = world.getRuntime(zoneId);
    if (!runtime) {
      return reply.status(404).send({ error: `zone "${zoneId}" not found` });
    }

    const x = parseFloat(req.query.x);
    const z = parseFloat(req.query.z);
    const radius = parseFloat(req.query.radius);

    if (isNaN(x) || isNaN(z) || isNaN(radius)) {
      return reply.status(400).send({ error: "x, z, and radius are required numeric query params" });
    }

    if (radius <= 0 || radius > 500) {
      return reply.status(400).send({ error: "radius must be between 0 and 500" });
    }

    const result = runtime.getEntitiesNear({ x, z }, radius);
    return reply.send({ zoneId, ...result });
  });
}
