import type { FastifyInstance } from "fastify";
import { getOrCreateZone, type Order } from "./zoneRuntime.js";
import { authenticateRequest, verifyEntityOwnership } from "./auth.js";
import {
  getZoneConnections,
  getSharedEdge,
  ZONE_LEVEL_REQUIREMENTS,
  getWorldLayout,
  findPortalInZone,
} from "./worldLayout.js";

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
    } else if (action === "travel") {
      if (!targetZone) {
        reply.code(400);
        return { error: "travel requires targetZone" };
      }

      // Verify connection exists
      const connections = getZoneConnections(zoneId);
      if (!connections.includes(targetZone)) {
        reply.code(400);
        return { error: `${targetZone} is not connected to ${zoneId}`, connectedZones: connections };
      }

      // Level check
      const requiredLevel = ZONE_LEVEL_REQUIREMENTS[targetZone] ?? 1;
      const entityLevel = entity.level ?? 1;
      if (entityLevel < requiredLevel) {
        reply.code(400);
        return {
          error: `Level ${requiredLevel} required for ${targetZone}`,
          currentLevel: entityLevel,
          requiredLevel,
        };
      }

      // Determine shared edge direction
      const edge = getSharedEdge(zoneId, targetZone);

      if (edge) {
        // Edge-adjacent: set move order to walk just past the boundary
        const layout = getWorldLayout();
        const zoneSize = layout.zones[zoneId]?.size;
        if (!zoneSize) {
          reply.code(500);
          return { error: "Zone layout not found" };
        }

        let tx: number;
        let ty: number;
        switch (edge) {
          case "east":
            tx = zoneSize.width + 5;
            ty = entity.y;
            break;
          case "west":
            tx = -5;
            ty = entity.y;
            break;
          case "north":
            tx = entity.x;
            ty = -5;
            break;
          case "south":
            tx = entity.x;
            ty = zoneSize.height + 5;
            break;
        }

        order = { action: "move", x: tx, y: ty };
      } else {
        // Corner-only connection (e.g. DF↔AP): walk to portal, auto-transition on arrival
        const portalPos = findPortalInZone(zoneId, targetZone);
        if (!portalPos) {
          reply.code(500);
          return { error: `No portal found from ${zoneId} to ${targetZone}` };
        }

        // Set move toward portal and flag for auto-portal transition
        order = { action: "move", x: portalPos.x, y: portalPos.z };
        entity.travelTargetZone = targetZone;
      }
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
