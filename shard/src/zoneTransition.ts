import type { FastifyInstance } from "fastify";
import { getOrCreateZone, type Entity } from "./zoneRuntime.js";
import { logZoneEvent } from "./zoneEvents.js";
import { authenticateRequest } from "./auth.js";
import { logDiary, narrativeZoneTransition } from "./diary.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Level requirements for each zone
const ZONE_LEVEL_REQUIREMENTS: Record<string, number> = {
  "village-square": 1,
  "wild-meadow": 5,
  "dark-forest": 10,
  "auroral-plains": 15,
  "emerald-woods": 20,
  "viridian-range": 25,
  "moondancer-glade": 30,
  "felsrock-citadel": 35,
  "lake-lumina": 40,
  "azurshard-chasm": 45,
};

// Portal interaction range
const PORTAL_RANGE = 30;

interface ZonePOI {
  id: string;
  name: string;
  type: string;
  position: { x: number; z: number };
  portal?: {
    destinationZone: string;
    destinationPoi: string;
    bidirectional: boolean;
  };
}

interface ZoneData {
  id: string;
  name: string;
  pois: ZonePOI[];
}

// Cache for zone data
const zoneDataCache = new Map<string, ZoneData>();

/**
 * Load zone data from JSON file
 */
function loadZoneData(zoneId: string): ZoneData | null {
  if (zoneDataCache.has(zoneId)) {
    return zoneDataCache.get(zoneId)!;
  }

  try {
    const zonePath = join(__dirname, "..", "..", "src", "data", "zones", `${zoneId}.json`);
    const raw = readFileSync(zonePath, "utf-8");
    const data: ZoneData = JSON.parse(raw);
    zoneDataCache.set(zoneId, data);
    return data;
  } catch (err) {
    console.error(`[transition] Failed to load zone ${zoneId}:`, err);
    return null;
  }
}

/**
 * Find a portal POI by ID in a zone
 */
function findPortal(zoneId: string, portalId: string): ZonePOI | null {
  const zoneData = loadZoneData(zoneId);
  if (!zoneData) return null;

  const portal = zoneData.pois.find((poi) => poi.id === portalId && poi.type === "portal");
  return portal || null;
}

/**
 * Find the closest portal to an entity's position
 */
function findNearestPortal(
  zoneId: string,
  x: number,
  y: number
): { portal: ZonePOI; distance: number } | null {
  const zoneData = loadZoneData(zoneId);
  if (!zoneData) return null;

  const portals = zoneData.pois.filter((poi) => poi.type === "portal");
  if (portals.length === 0) return null;

  let nearest: { portal: ZonePOI; distance: number } | null = null;
  for (const portal of portals) {
    const dx = portal.position.x - x;
    const dy = portal.position.z - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!nearest || dist < nearest.distance) {
      nearest = { portal, distance: dist };
    }
  }

  return nearest;
}

export function registerZoneTransitionRoutes(server: FastifyInstance) {
  /**
   * POST /transition/auto
   * Automatically transition through the nearest portal
   */
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
    };
  }>("/transition/auto", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    // Validate wallet
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    // Get entity
    const zone = getOrCreateZone(zoneId);
    const entity = zone.entities.get(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found in this zone" };
    }

    // Check wallet ownership
    if (entity.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
      reply.code(403);
      return { error: "This entity does not belong to your wallet" };
    }

    // Find nearest portal
    const nearest = findNearestPortal(zoneId, entity.x, entity.y);
    if (!nearest) {
      reply.code(404);
      return { error: "No portals found in this zone" };
    }

    // Check range
    if (nearest.distance > PORTAL_RANGE) {
      reply.code(400);
      return {
        error: "Too far from portal",
        nearestPortal: nearest.portal.name,
        distance: Math.round(nearest.distance),
        maxRange: PORTAL_RANGE,
        portalPosition: nearest.portal.position,
      };
    }

    // Use the nearest portal
    return performTransition(
      server,
      entity,
      zoneId,
      nearest.portal.id,
      reply
    );
  });

  /**
   * POST /transition/:zoneId/portal/:portalId
   * Transition through a specific portal
   */
  server.post<{
    Params: { zoneId: string; portalId: string };
    Body: {
      walletAddress: string;
      entityId: string;
    };
  }>("/transition/:zoneId/portal/:portalId", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { zoneId, portalId } = request.params;
    const { walletAddress, entityId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    // Validate wallet
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    // Verify authenticated wallet matches request wallet
    if (walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    // Get entity
    const zone = getOrCreateZone(zoneId);
    const entity = zone.entities.get(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found in this zone" };
    }

    // Check wallet ownership
    if (entity.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
      reply.code(403);
      return { error: "This entity does not belong to your wallet" };
    }

    // Find portal
    const portal = findPortal(zoneId, portalId);
    if (!portal || !portal.portal) {
      reply.code(404);
      return { error: "Portal not found" };
    }

    // Check range to portal
    const dx = portal.position.x - entity.x;
    const dy = portal.position.z - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > PORTAL_RANGE) {
      reply.code(400);
      return {
        error: "Too far from portal",
        distance: Math.round(dist),
        maxRange: PORTAL_RANGE,
        portalPosition: portal.position,
      };
    }

    return performTransition(server, entity, zoneId, portalId, reply);
  });

  /**
   * GET /portals/:zoneId
   * List all portals in a zone
   */
  server.get<{ Params: { zoneId: string } }>(
    "/portals/:zoneId",
    async (request, reply) => {
      const { zoneId } = request.params;
      const zoneData = loadZoneData(zoneId);

      if (!zoneData) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const portals = zoneData.pois
        .filter((poi) => poi.type === "portal")
        .map((poi) => ({
          id: poi.id,
          name: poi.name,
          position: poi.position,
          destination: poi.portal
            ? {
                zone: poi.portal.destinationZone,
                zoneName: loadZoneData(poi.portal.destinationZone)?.name || "Unknown",
                portal: poi.portal.destinationPoi,
                levelRequirement: ZONE_LEVEL_REQUIREMENTS[poi.portal.destinationZone] || 1,
              }
            : null,
        }));

      return {
        zoneId,
        zoneName: zoneData.name,
        portals,
      };
    }
  );
}

/**
 * Perform the actual zone transition
 */
async function performTransition(
  server: FastifyInstance,
  entity: Entity,
  sourceZoneId: string,
  portalId: string,
  reply: any
) {
  // Find source portal
  const sourcePortal = findPortal(sourceZoneId, portalId);
  if (!sourcePortal || !sourcePortal.portal) {
    reply.code(404);
    return { error: "Portal configuration invalid" };
  }

  const destZoneId = sourcePortal.portal.destinationZone;
  const destPortalId = sourcePortal.portal.destinationPoi;

  // Check level requirement
  const requiredLevel = ZONE_LEVEL_REQUIREMENTS[destZoneId] || 1;
  const entityLevel = entity.level || 1;
  if (entityLevel < requiredLevel) {
    reply.code(400);
    return {
      error: `Level ${requiredLevel} required for ${destZoneId}`,
      currentLevel: entityLevel,
      requiredLevel,
    };
  }

  // Find destination portal
  const destPortal = findPortal(destZoneId, destPortalId);
  if (!destPortal) {
    reply.code(500);
    return { error: "Destination portal not found" };
  }

  // Remove entity from source zone
  const sourceZone = getOrCreateZone(sourceZoneId);
  sourceZone.entities.delete(entity.id);

  // Update entity position to destination portal
  entity.x = destPortal.position.x;
  entity.y = destPortal.position.z;

  // Add entity to destination zone
  const destZone = getOrCreateZone(destZoneId);
  destZone.entities.set(entity.id, entity);

  // Log zone events
  logZoneEvent({
    zoneId: sourceZoneId,
    type: "system",
    message: `${entity.name} departed through ${sourcePortal.name}`,
    tick: Date.now(),
  });

  logZoneEvent({
    zoneId: destZoneId,
    type: "system",
    message: `${entity.name} arrived from ${sourceZoneId}`,
    tick: Date.now(),
  });

  // Log zone transition diary entry
  if (entity.walletAddress) {
    const { headline, narrative } = narrativeZoneTransition(entity.name, entity.raceId, entity.classId, sourceZoneId, destZoneId, sourcePortal.name);
    logDiary(entity.walletAddress, entity.name, destZoneId, entity.x, entity.y, "zone_transition", headline, narrative, {
      fromZone: sourceZoneId,
      toZone: destZoneId,
      portalName: sourcePortal.name,
    });
  }

  server.log.info(
    `[transition] ${entity.name} (${entity.id}) transitioned from ${sourceZoneId} → ${destZoneId}`
  );

  return {
    ok: true,
    transition: {
      from: {
        zone: sourceZoneId,
        portal: sourcePortal.name,
      },
      to: {
        zone: destZoneId,
        zoneName: loadZoneData(destZoneId)?.name || destZoneId,
        portal: destPortal.name,
        position: { x: entity.x, y: entity.y },
      },
    },
    entity: {
      id: entity.id,
      name: entity.name,
      level: entity.level,
      x: entity.x,
      y: entity.y,
      hp: entity.hp,
      maxHp: entity.maxHp,
    },
  };
}
