import type { FastifyInstance } from "fastify";
import type { WorldManager } from "../../runtime/world-manager.js";

export function registerWorldRoutes(app: FastifyInstance, world: WorldManager): void {
  // Full world overview: all zones, stats, connections
  app.get("/v1/world", (_req, reply) => {
    return reply.send(world.getWorldOverview());
  });

  // Single zone detail: POIs, roads, budget, stats
  app.get<{ Params: { zoneId: string } }>("/v1/world/zones/:zoneId", (req, reply) => {
    const zone = world.getZone(req.params.zoneId);
    if (!zone) {
      return reply.status(404).send({ error: "zone not found" });
    }

    const runtime = world.getRuntime(req.params.zoneId)!;
    const stats = runtime.getStats();
    const connections = world.getConnectionsFrom(req.params.zoneId);

    return reply.send({
      ...zone,
      stats,
      connections,
    });
  });
}
