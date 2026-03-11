import type { FastifyInstance } from "fastify";
import { getEntity, getOrCreateZone, type Order, type Entity } from "../world/zoneRuntime.js";
import { authenticateRequest } from "../auth/auth.js";
import { getAgentCustodialWallet, getAgentEntityRef } from "../agents/agentConfigStore.js";
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
  action: "move" | "attack" | "attack-nearest" | "travel";
  x?: number;
  y?: number;
  targetId?: string;
  targetZone?: string;
  mobName?: string;
}

export function registerCommands(server: FastifyInstance) {
  server.post<{ Body: CommandBody }>("/command", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId, entityId, action, x, y, targetId, targetZone, mobName } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    // Verify the authenticated user owns this entity
    const entityWallet = entity.walletAddress?.toLowerCase();
    const authWallet = authenticatedWallet.toLowerCase();
    let cmdAuthorized = entityWallet === authWallet;
    if (!cmdAuthorized) {
      const custodial = await getAgentCustodialWallet(authenticatedWallet);
      cmdAuthorized = !!custodial && entityWallet === custodial.toLowerCase();
    }
    if (!cmdAuthorized) {
      const ref = await getAgentEntityRef(authenticatedWallet);
      cmdAuthorized = !!ref && ref.entityId === entity.id;
    }
    if (!cmdAuthorized) {
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
    } else if (action === "attack-nearest") {
      // Find nearest mob (optionally filtered by name)
      const regionId = entity.region;
      if (!regionId) {
        reply.code(400);
        return { error: "Entity not in a region" };
      }
      const zone = getOrCreateZone(regionId);
      let nearestMob: Entity | null = null;
      let nearestDist = Infinity;

      for (const other of zone.entities.values()) {
        if (other.type !== "mob" && other.type !== "boss") continue;
        if (other.hp <= 0) continue;
        if (mobName && !other.name.toLowerCase().includes(mobName.toLowerCase())) continue;
        const dx = other.x - entity.x;
        const dy = other.y - entity.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestMob = other;
        }
      }

      if (!nearestMob) {
        reply.code(404);
        return { error: mobName ? `No "${mobName}" found nearby` : "No mobs found nearby" };
      }

      order = { action: "attack", targetId: nearestMob.id };
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

    // Return enriched response with player state + quest progress
    const questProgress = (entity.activeQuests ?? []).map((aq: any) => ({
      questId: aq.questId,
      progress: aq.progress,
    }));

    return {
      ok: true,
      order,
      entity: {
        id: entity.id,
        position: { x: entity.x, y: entity.y },
        hp: entity.hp,
        maxHp: entity.maxHp,
        level: entity.level,
        xp: entity.xp,
        region: entity.region,
      },
      questProgress: questProgress.length > 0 ? questProgress : undefined,
    };
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
