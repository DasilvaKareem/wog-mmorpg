import type { FastifyInstance } from "fastify";

/**
 * Zone transition routes — DEPRECATED.
 * Entities now move freely in the unified world. Region labels update automatically.
 * These stubs return 410 Gone so agents stop calling them.
 */
export function registerZoneTransitionRoutes(server: FastifyInstance) {
  const goneMsg = { error: "Zone transitions removed — entities move freely in the unified world", status: 410 };

  server.post("/transition/auto", async (_request, reply) => {
    reply.code(410);
    return goneMsg;
  });

  server.post("/transition/:zoneId/portal/:portalId", async (_request, reply) => {
    reply.code(410);
    return goneMsg;
  });

  server.post("/transition/fast-travel", async (_request, reply) => {
    reply.code(410);
    return goneMsg;
  });

  server.get("/portals/:zoneId", async (_request, reply) => {
    reply.code(410);
    return goneMsg;
  });
}
