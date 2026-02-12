import type { FastifyInstance } from "fastify";
import { getZoneEvents, getAllZoneEvents, logZoneEvent } from "./zoneEvents.js";
import { getOrCreateZone } from "./zoneRuntime.js";

export function registerEventRoutes(server: FastifyInstance) {
  /**
   * GET /events/:zoneId — get recent events for a specific zone
   * Query params: limit (default 100), since (timestamp filter)
   */
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
   * GET /events — get recent events across all zones (global feed)
   * Query params: limit (default 100), since (timestamp filter)
   */
  server.get<{
    Querystring: { limit?: string; since?: string };
  }>("/events", async (request, reply) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
    const since = request.query.since ? parseInt(request.query.since, 10) : undefined;

    const events = getAllZoneEvents(limit, since);

    return {
      count: events.length,
      events,
    };
  });

  /**
   * POST /chat/:zoneId — AI agent sends a public chat message in a zone
   * Body: { entityId, message }
   */
  server.post<{
    Params: { zoneId: string };
    Body: { entityId: string; message: string };
  }>("/chat/:zoneId", async (request, reply) => {
    const { zoneId } = request.params;
    const { entityId, message } = request.body;

    if (!entityId || !message || typeof message !== "string") {
      reply.code(400);
      return { error: "Missing entityId or message" };
    }

    const zone = getOrCreateZone(zoneId);
    const entity = zone.entities.get(entityId);

    if (!entity) {
      reply.code(404);
      return { error: "Entity not found in zone" };
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
      tick: zone.tick,
      message: `${entity.name}: ${sanitized}`,
      entityId: entity.id,
      entityName: entity.name,
    });

    return { ok: true };
  });
}
