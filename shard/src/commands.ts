import type { FastifyInstance } from "fastify";
import { getOrCreateZone, type Order } from "./zoneRuntime.js";
import { authenticateRequest, verifyEntityOwnership } from "./auth.js";

interface CommandBody {
  zoneId: string;
  entityId: string;
  action: "move" | "attack";
  x?: number;
  y?: number;
  targetId?: string;
}

export function registerCommands(server: FastifyInstance) {
  server.post<{ Body: CommandBody }>("/command", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId, entityId, action, x, y, targetId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    const zone = getOrCreateZone(zoneId);
    const entity = zone.entities.get(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    // Verify the authenticated user owns this entity
    if (!verifyEntityOwnership(entity.walletAddress, authenticatedWallet)) {
      reply.code(403);
      return { error: "Not authorized to control this entity" };
    }

    let order: Order;

    if (action === "move") {
      if (x == null || y == null) {
        reply.code(400);
        return { error: "move requires x and y" };
      }
      order = { action: "move", x, y };
    } else if (action === "attack") {
      if (!targetId) {
        reply.code(400);
        return { error: "attack requires targetId" };
      }
      if (!zone.entities.has(targetId)) {
        reply.code(404);
        return { error: "Target entity not found" };
      }
      order = { action: "attack", targetId };
    } else {
      reply.code(400);
      return { error: `Unknown action: ${action}` };
    }

    entity.order = order;
    return { ok: true, order };
  });
}
