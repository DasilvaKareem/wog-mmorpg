import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getZoneEvents, getAllZoneEvents, logZoneEvent } from "../world/zoneEvents.js";
import { getOrCreateZone, getEntity, getAllEntities, getEntitiesInRegion } from "../world/zoneRuntime.js";

export function registerEventRoutes(server: FastifyInstance) {
  /**
   * GET /events — get recent events, optionally filtered by region
   * Query params: region (optional), limit (default 100), since (timestamp filter)
   */
  server.get<{
    Querystring: { region?: string; limit?: string; since?: string };
  }>("/events", async (request, reply) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
    const since = request.query.since ? parseInt(request.query.since, 10) : undefined;
    const region = request.query.region;

    if (region) {
      const events = getZoneEvents(region, limit, since);
      return {
        region,
        count: events.length,
        events,
      };
    }

    const events = getAllZoneEvents(limit, since);

    return {
      count: events.length,
      events,
    };
  });

  // Backward compat alias: GET /events/:zoneId
  server.get<{
    Params: { zoneId: string };
    Querystring: { limit?: string; since?: string };
  }>("/events/:zoneId", async (request, reply) => {
    const { zoneId } = request.params;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
    const since = request.query.since ? parseInt(request.query.since, 10) : undefined;

    const events = getZoneEvents(zoneId, limit, since);

    return {
      zoneId,
      count: events.length,
      events,
    };
  });

  /**
   * POST /chat — AI agent sends a public chat message
   * Body: { entityId, message }
   */
  server.post<{
    Body: { entityId: string; message: string };
  }>("/chat", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { entityId, message } = request.body;

    if (!entityId || !message || typeof message !== "string") {
      reply.code(400);
      return { error: "Missing entityId or message" };
    }

    const entity = getEntity(entityId);

    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    // Trim and limit message length
    const sanitized = message.trim().slice(0, 200);
    if (!sanitized) {
      reply.code(400);
      return { error: "Empty message" };
    }

    // Log chat event using entity's region
    const zoneId = (entity as any).region ?? "unknown";
    logZoneEvent({
      zoneId,
      type: "chat",
      tick: 0,
      message: `${entity.name}: ${sanitized}`,
      entityId: entity.id,
      entityName: entity.name,
    });

    return { ok: true };
  });

  // Backward compat alias: POST /chat/:zoneId
  server.post<{
    Params: { zoneId: string };
    Body: { entityId: string; message: string };
  }>("/chat/:zoneId", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId } = request.params;
    const { entityId, message } = request.body;

    if (!entityId || !message || typeof message !== "string") {
      reply.code(400);
      return { error: "Missing entityId or message" };
    }

    const entity = getEntity(entityId);

    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    // Trim and limit message length
    const sanitized = message.trim().slice(0, 200);
    if (!sanitized) {
      reply.code(400);
      return { error: "Empty message" };
    }

    // Log chat event
    logZoneEvent({
      zoneId,
      type: "chat",
      tick: 0,
      message: `${entity.name}: ${sanitized}`,
      entityId: entity.id,
      entityName: entity.name,
    });

    return { ok: true };
  });
}
