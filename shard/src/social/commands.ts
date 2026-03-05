import type { FastifyInstance } from "fastify";
import { getEntity, type Order } from "../world/zoneRuntime.js";
import { authenticateRequest, verifyEntityOwnership } from "../auth/auth.js";
import {
  getZoneConnections,
  getSharedEdge,
  ZONE_LEVEL_REQUIREMENTS,
  getWorldLayout,
  findPortalInZone,
  getRegionCenter,
} from "../world/worldLayout.js";

interface CommandBody {
  zoneId: string;
  entityId: string;
  action: "move" | "attack" | "travel";
  x?: number;
  y?: number;
  targetId?: string;
  targetZone?: string;
}

export function registerCommands(server: FastifyInstance) {
  server.post<{ Body: CommandBody }>("/command", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId, entityId, action, x, y, targetId, targetZone } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    const entity = getEntity(entityId);
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
      if (!getEntity(targetId)) {
        reply.code(404);
        return { error: "Target entity not found" };
      }
      order = { action: "attack", targetId };
    } else if (action === "travel") {
      if (!targetZone) {
        reply.code(400);
        return { error: "travel requires targetZone" };
      }

      // In unified world, just walk toward target region center
      const center = getRegionCenter(targetZone);
      if (!center) {
        reply.code(400);
        return { error: `Unknown region: ${targetZone}` };
      }

      // Set move order toward the target region center (world-space)
      order = { action: "move", x: center.x, y: center.z };
      entity.travelTargetZone = targetZone;
    } else {
      reply.code(400);
      return { error: `Unknown action: ${action}` };
    }

    entity.order = order;
    return { ok: true, order };
  });

  // ── GET /neighbors/:zoneId — discovery endpoint for AI agents ──────
  server.get<{ Params: { zoneId: string } }>(
    "/neighbors/:zoneId",
    async (request, reply) => {
      const { zoneId } = request.params;

      const layout = getWorldLayout();
      if (!layout.zones[zoneId]) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const connections = getZoneConnections(zoneId);
      const neighbors = connections.map((connZone) => {
        const edge = getSharedEdge(zoneId, connZone);
        const levelReq = ZONE_LEVEL_REQUIREMENTS[connZone] ?? 1;

        if (edge) {
          return {
            zone: connZone,
            direction: edge,
            levelReq,
            type: "walk" as const,
          };
        } else {
          const portalPos = findPortalInZone(zoneId, connZone);
          return {
            zone: connZone,
            direction: "portal" as const,
            levelReq,
            type: "portal" as const,
            ...(portalPos && { portalPosition: { x: portalPos.x, z: portalPos.z } }),
          };
        }
      });

      return { zoneId, neighbors };
    }
  );
}
