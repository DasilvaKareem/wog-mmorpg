import type { FastifyInstance } from "fastify";
import type { WorldManager } from "../../runtime/world-manager.js";
import type { SpawnOrder } from "../../types/spawn-order.js";

export function registerSpawnOrderRoute(app: FastifyInstance, world: WorldManager): void {
  app.post<{ Body: SpawnOrder }>("/v1/spawn-order", (req, reply) => {
    const body = req.body;

    if (!body || !body.orderId || !body.zoneId || !body.templateId || !body.position || !body.count) {
      return reply.status(400).send({ error: "missing required fields: orderId, zoneId, templateId, position, count" });
    }

    if (typeof body.position.x !== "number" || typeof body.position.z !== "number") {
      return reply.status(400).send({ error: "position must have numeric x and z" });
    }

    const runtime = world.getRuntime(body.zoneId);
    if (!runtime) {
      return reply.status(404).send({ error: `zone "${body.zoneId}" not found` });
    }

    const result = runtime.processSpawnOrder(body);

    const status = result.status === "accepted" ? 200 : 409;
    return reply.status(status).send(result);
  });
}
