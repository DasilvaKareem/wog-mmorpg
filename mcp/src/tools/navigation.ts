/**
 * Navigation tools — the most critical module for AI agents.
 *
 * Problems solved vs raw /command:
 *  1. navigate_to        — blocking walk: polls until arrived, returns when done
 *  2. navigate_to_entity — look up entity position, then blocking walk
 *  3. navigate_to_npc    — find NPC by name/type in zone, blocking walk
 *  4. navigate_to_portal — walk to the correct portal for a target zone
 *  5. travel_to_zone     — multi-hop BFS travel across the world graph
 *  6. find_nearby        — spatial scan of zone entities by type/name/radius
 *
 * Coordinate note:
 *   Zone JSON stores positions as { x, z }
 *   /command move uses { x, y } where y == the world Z axis
 *   Portal positions come back as position.x / position.z from /portals/:zoneId
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard, ShardError } from "../shard.js";
import { requireSession } from "../session.js";

// ── Zone connection graph (BFS for travel_to_zone) ───────────────────────────
// portal: { portalId, destZone, x (world X), y (world Z mapped to move-y) }
const ZONE_PORTALS: Record<string, { portalId: string; destZone: string; x: number; y: number }[]> = {
  "village-square":    [{ portalId: "meadow-exit",       destZone: "wild-meadow",         x: 290, y: 150 }],
  "wild-meadow":       [{ portalId: "village-gate",       destZone: "village-square",      x: 35,  y: 175 },
                        { portalId: "forest-gate",        destZone: "dark-forest",         x: 336, y: 175 },
                        { portalId: "plains-gate",        destZone: "auroral-plains",      x: 175, y: 35  }],
  "dark-forest":       [{ portalId: "meadow-entrance",    destZone: "wild-meadow",         x: 13,  y: 200 },
                        { portalId: "plains-passage",     destZone: "auroral-plains",      x: 200, y: 35  },
                        { portalId: "woods-gate",         destZone: "emerald-woods",       x: 600, y: 320 }],
  "auroral-plains":    [{ portalId: "meadow-gate",        destZone: "wild-meadow",         x: 35,  y: 320 },
                        { portalId: "forest-passage",     destZone: "dark-forest",         x: 320, y: 605 }],
  "emerald-woods":     [{ portalId: "forest-entrance",    destZone: "dark-forest",         x: 35,  y: 320 },
                        { portalId: "range-path",         destZone: "viridian-range",      x: 320, y: 35  },
                        { portalId: "glade-path",         destZone: "moondancer-glade",    x: 320, y: 605 }],
  "viridian-range":    [{ portalId: "woods-entrance",     destZone: "emerald-woods",       x: 320, y: 605 },
                        { portalId: "citadel-pass",       destZone: "felsrock-citadel",    x: 605, y: 320 }],
  "moondancer-glade":  [{ portalId: "woods-entrance",     destZone: "emerald-woods",       x: 320, y: 35  },
                        { portalId: "citadel-path",       destZone: "felsrock-citadel",    x: 605, y: 320 }],
  "felsrock-citadel":  [{ portalId: "range-gate",         destZone: "viridian-range",      x: 35,  y: 320 },
                        { portalId: "glade-gate",         destZone: "moondancer-glade",    x: 320, y: 605 },
                        { portalId: "lumina-passage",     destZone: "lake-lumina",         x: 605, y: 320 }],
  "lake-lumina":       [{ portalId: "citadel-entrance",   destZone: "felsrock-citadel",    x: 35,  y: 320 },
                        { portalId: "chasm-descent",      destZone: "azurshard-chasm",     x: 605, y: 320 }],
  "azurshard-chasm":   [{ portalId: "lumina-ascent",      destZone: "lake-lumina",         x: 35,  y: 320 }],
};

// BFS: find the shortest zone-hop path from src to dest
function findRoute(from: string, to: string): string[] | null {
  if (from === to) return [from];
  const queue: string[][] = [[from]];
  const visited = new Set<string>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const cur = path[path.length - 1];
    for (const { destZone } of ZONE_PORTALS[cur] ?? []) {
      if (visited.has(destZone)) continue;
      const next = [...path, destZone];
      if (destZone === to) return next;
      visited.add(destZone);
      queue.push(next);
    }
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface EntitySnapshot {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level?: number;
  [key: string]: unknown;
}

async function getZoneEntities(zoneId: string): Promise<EntitySnapshot[]> {
  const state = await shard.get<any>("/state");
  const zone = state?.zones?.[zoneId];
  if (!zone) return [];
  return Object.values(zone.entities ?? {}) as EntitySnapshot[];
}

async function getEntityPosition(
  zoneId: string,
  entityId: string
): Promise<{ x: number; y: number } | null> {
  const entities = await getZoneEntities(zoneId);
  const e = entities.find((e) => e.id === entityId);
  return e ? { x: e.x, y: e.y } : null;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

const MOVE_SPEED = 30;        // units/tick (matches server)
const TICK_MS   = 500;        // server tick interval
const POLL_MS   = 600;        // slightly longer than tick so we always see updated pos
const ARRIVAL_THRESHOLD = 15; // units — "close enough" to target

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Issue one move command to the shard.
 */
async function issueMove(
  entityId: string,
  zoneId: string,
  x: number,
  y: number,
  token: string
): Promise<void> {
  await shard.post("/command", { entityId, zoneId, action: "move", x, y }, token);
}

/**
 * Block until entityId reaches (tx, ty) ± ARRIVAL_THRESHOLD, or timeout expires.
 * Returns the final position.
 */
async function blockUntilArrived(
  entityId: string,
  zoneId: string,
  tx: number,
  ty: number,
  timeoutMs = 30_000
): Promise<{ arrived: boolean; x: number; y: number; distanceRemaining: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const pos = await getEntityPosition(zoneId, entityId);
    if (!pos) break; // entity disappeared (zone transition, death, etc.)
    const d = dist(pos.x, pos.y, tx, ty);
    if (d <= ARRIVAL_THRESHOLD) {
      return { arrived: true, ...pos, distanceRemaining: d };
    }
  }
  const pos = await getEntityPosition(zoneId, entityId);
  const d = pos ? dist(pos.x, pos.y, tx, ty) : Infinity;
  return { arrived: false, x: pos?.x ?? 0, y: pos?.y ?? 0, distanceRemaining: d };
}

/**
 * Blocking walk: move to (tx, ty), poll until arrived.
 * Re-issues the move command every 5s in case it got cleared.
 */
async function walkTo(
  entityId: string,
  zoneId: string,
  tx: number,
  ty: number,
  token: string,
  timeoutMs = 30_000
): Promise<{ arrived: boolean; x: number; y: number; distanceRemaining: number }> {
  await issueMove(entityId, zoneId, tx, ty, token);

  const deadline = Date.now() + timeoutMs;
  let lastReissue = Date.now();

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const pos = await getEntityPosition(zoneId, entityId);
    if (!pos) break;
    const d = dist(pos.x, pos.y, tx, ty);
    if (d <= ARRIVAL_THRESHOLD) {
      return { arrived: true, ...pos, distanceRemaining: d };
    }
    // Re-issue every 5s (move orders can get overwritten by attacks)
    if (Date.now() - lastReissue > 5_000) {
      await issueMove(entityId, zoneId, tx, ty, token).catch(() => {});
      lastReissue = Date.now();
    }
  }

  const pos = await getEntityPosition(zoneId, entityId) ?? { x: 0, y: 0 };
  return { arrived: false, ...pos, distanceRemaining: dist(pos.x, pos.y, tx, ty) };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerNavigationTools(server: McpServer): void {
  /**
   * Spatial scan — find entities near a position, filtered by type/name.
   */
  server.registerTool(
    "find_nearby",
    {
      description:
        "Find entities (mobs, NPCs, players, ore nodes, flower nodes) near a position in a zone. Useful for locating targets, merchants, and resource nodes before navigating to them.",
      inputSchema: {
        zoneId: z.string().describe("Zone to search in"),
        x: z.number().describe("Center X coordinate"),
        y: z.number().describe("Center Y/Z coordinate"),
        radius: z.number().min(1).max(640).default(200).describe("Search radius in units (default 200)"),
        type: z
          .enum(["player", "mob", "boss", "npc", "merchant", "ore_node", "flower_node", "portal", "corpse", "any"])
          .default("any")
          .describe("Entity type filter"),
        name: z.string().optional().describe("Filter by name (case-insensitive substring match)"),
      },
    },
    async ({ zoneId, x, y, radius, type, name }) => {
      const entities = await getZoneEntities(zoneId);
      const results = entities.filter((e) => {
        const d = dist(e.x, e.y, x, y);
        if (d > radius) return false;
        if (type !== "any" && e.type !== type) return false;
        if (name && !e.name.toLowerCase().includes(name.toLowerCase())) return false;
        return true;
      }).map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        x: Math.round(e.x),
        y: Math.round(e.y),
        distance: Math.round(dist(e.x, e.y, x, y)),
        hp: e.hp,
        maxHp: e.maxHp,
        level: e.level,
      })).sort((a, b) => a.distance - b.distance);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ zoneId, center: { x, y }, radius, count: results.length, entities: results }, null, 2),
        }],
      };
    }
  );

  /**
   * Blocking walk to absolute coordinates.
   */
  server.registerTool(
    "navigate_to",
    {
      description:
        "Move your character to target coordinates and WAIT until arrived (blocking). Returns when the character reaches within 15 units of the target, or after 30s timeout. Use this instead of player_move when you need to know arrival.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        x: z.number().describe("Target X coordinate"),
        y: z.number().describe("Target Y/Z coordinate"),
        timeoutSeconds: z.number().min(5).max(60).default(30).describe("Max wait time in seconds"),
      },
    },
    async ({ sessionId, entityId, zoneId, x, y, timeoutSeconds }) => {
      const { token } = requireSession(sessionId);
      const result = await walkTo(entityId, zoneId, x, y, token, timeoutSeconds * 1000);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            arrived: result.arrived,
            position: { x: Math.round(result.x), y: Math.round(result.y) },
            target: { x, y },
            distanceRemaining: Math.round(result.distanceRemaining),
            message: result.arrived
              ? `Arrived at (${Math.round(result.x)}, ${Math.round(result.y)})`
              : `Timed out — still ${Math.round(result.distanceRemaining)} units from target`,
          }, null, 2),
        }],
      };
    }
  );

  /**
   * Walk to a specific entity by ID.
   */
  server.registerTool(
    "navigate_to_entity",
    {
      description:
        "Move your character to another entity (mob, NPC, player) by their entity ID and WAIT until arrived. Automatically looks up their current position.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        targetEntityId: z.string().describe("Entity ID to walk toward"),
        stopDistance: z.number().min(5).max(100).default(30).describe("Stop when within this many units (default 30 = attack/interact range)"),
      },
    },
    async ({ sessionId, entityId, zoneId, targetEntityId, stopDistance }) => {
      const { token } = requireSession(sessionId);

      const pos = await getEntityPosition(zoneId, targetEntityId);
      if (!pos) {
        return {
          content: [{ type: "text" as const, text: `Entity ${targetEntityId} not found in zone ${zoneId}` }],
        };
      }

      const result = await walkTo(entityId, zoneId, pos.x, pos.y, token, 30_000);
      const d = dist(result.x, result.y, pos.x, pos.y);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            arrived: d <= stopDistance,
            position: { x: Math.round(result.x), y: Math.round(result.y) },
            target: { entityId: targetEntityId, x: Math.round(pos.x), y: Math.round(pos.y) },
            distance: Math.round(d),
          }, null, 2),
        }],
      };
    }
  );

  /**
   * Find an NPC by name/type in zone and walk to it.
   */
  server.registerTool(
    "navigate_to_npc",
    {
      description:
        "Find an NPC (merchant, auctioneer, guild registrar, quest-giver, etc.) by name or type in the current zone and walk to it. Returns the NPC's entity ID for follow-up interactions.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        name: z.string().optional().describe("NPC name (case-insensitive, partial match)"),
        type: z.string().optional().describe("NPC type: merchant, auctioneer, guild-registrar, quest-giver, lore-npc, crafting-station, etc."),
      },
    },
    async ({ sessionId, entityId, zoneId, name, type }) => {
      const { token } = requireSession(sessionId);

      if (!name && !type) {
        return { content: [{ type: "text" as const, text: "Provide at least one of: name, type" }] };
      }

      const entities = await getZoneEntities(zoneId);
      const npc = entities.find((e) => {
        const nameMatch = !name || e.name.toLowerCase().includes(name.toLowerCase());
        const typeMatch = !type || e.type.toLowerCase().includes(type.toLowerCase());
        return nameMatch && typeMatch && e.type !== "player" && e.type !== "mob" && e.type !== "boss";
      });

      if (!npc) {
        const available = [...new Set(entities.filter(e => e.type !== "player" && e.type !== "mob" && e.type !== "boss").map(e => `${e.name} (${e.type})`))].slice(0, 15);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "NPC not found", available }, null, 2),
          }],
        };
      }

      const result = await walkTo(entityId, zoneId, npc.x, npc.y, token, 30_000);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            arrived: result.arrived,
            npc: { id: npc.id, name: npc.name, type: npc.type, x: Math.round(npc.x), y: Math.round(npc.y) },
            yourPosition: { x: Math.round(result.x), y: Math.round(result.y) },
            distance: Math.round(result.distanceRemaining),
            message: result.arrived
              ? `Arrived at ${npc.name}. NPC entity ID: ${npc.id}`
              : `Timed out — still moving toward ${npc.name}`,
          }, null, 2),
        }],
      };
    }
  );

  /**
   * Full zone-to-zone travel — multi-hop BFS route with blocking walks + transitions.
   */
  server.registerTool(
    "travel_to_zone",
    {
      description:
        "Travel from your current zone to any other zone in the world. Automatically plans the portal route (BFS shortest path), walks to each portal, and transitions through. Handles multi-hop travel (e.g. village-square → dark-forest = 2 hops). Returns when you arrive in the destination zone.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        currentZoneId: z.string().describe("Your current zone ID"),
        destinationZoneId: z
          .string()
          .describe(
            "Target zone: village-square, wild-meadow, dark-forest, auroral-plains, emerald-woods, viridian-range, moondancer-glade, felsrock-citadel, lake-lumina, azurshard-chasm"
          ),
      },
    },
    async ({ sessionId, entityId, currentZoneId, destinationZoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);

      if (currentZoneId === destinationZoneId) {
        return {
          content: [{ type: "text" as const, text: `Already in ${destinationZoneId}` }],
        };
      }

      const route = findRoute(currentZoneId, destinationZoneId);
      if (!route) {
        return {
          content: [{
            type: "text" as const,
            text: `No route found from ${currentZoneId} to ${destinationZoneId}. Check zone names.`,
          }],
        };
      }

      const log: string[] = [`Route: ${route.join(" → ")}`];
      let currentZone = currentZoneId;

      for (let hop = 0; hop < route.length - 1; hop++) {
        const fromZone = route[hop];
        const toZone = route[hop + 1];

        // Find the portal from fromZone → toZone
        const portal = ZONE_PORTALS[fromZone]?.find((p) => p.destZone === toZone);
        if (!portal) {
          log.push(`ERROR: No portal from ${fromZone} → ${toZone}`);
          break;
        }

        // Walk to the portal
        log.push(`[${hop + 1}/${route.length - 1}] Walking to ${portal.portalId} portal in ${fromZone}...`);
        const walkResult = await walkTo(entityId, fromZone, portal.x, portal.y, token, 40_000);

        if (!walkResult.arrived) {
          log.push(`Timed out walking to portal in ${fromZone} (${Math.round(walkResult.distanceRemaining)} units remaining)`);
          break;
        }
        log.push(`Reached portal at (${Math.round(walkResult.x)}, ${Math.round(walkResult.y)})`);

        // Transition through the portal
        log.push(`Transitioning ${fromZone} → ${toZone}...`);
        try {
          const tx = await shard.post<any>(
            `/transition/${fromZone}/portal/${portal.portalId}`,
            { walletAddress, entityId, zoneId: fromZone },
            token
          );
          currentZone = toZone;
          log.push(`Arrived in ${toZone}${tx.position ? ` at (${Math.round(tx.position.x)}, ${Math.round(tx.position.z ?? tx.position.y)})` : ""}`);
        } catch (err) {
          const msg = err instanceof ShardError ? err.message : String(err);
          log.push(`Transition failed: ${msg}`);
          break;
        }
      }

      const success = currentZone === destinationZoneId;
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success,
            currentZone,
            destination: destinationZoneId,
            hops: route.length - 1,
            log,
          }, null, 2),
        }],
      };
    }
  );

  /**
   * Walk to the portal for a specific destination zone and stop (without transitioning).
   * Useful when the agent wants to manually trigger the transition.
   */
  server.registerTool(
    "navigate_to_portal",
    {
      description:
        "Walk to the portal that leads toward a destination zone and WAIT until arrived. Does NOT transition — use zone_transition after this to cross. Useful when you want to control the transition yourself.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        currentZoneId: z.string().describe("Your current zone ID"),
        destinationZoneId: z.string().describe("The zone you want to reach via the portal"),
      },
    },
    async ({ sessionId, entityId, currentZoneId, destinationZoneId }) => {
      const { token } = requireSession(sessionId);

      const portal = ZONE_PORTALS[currentZoneId]?.find((p) => p.destZone === destinationZoneId);
      if (!portal) {
        const available = (ZONE_PORTALS[currentZoneId] ?? []).map((p) => p.destZone);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `No direct portal from ${currentZoneId} to ${destinationZoneId}`,
              availableDestinations: available,
            }, null, 2),
          }],
        };
      }

      const result = await walkTo(entityId, currentZoneId, portal.x, portal.y, token, 40_000);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            arrived: result.arrived,
            portal: { id: portal.portalId, x: portal.x, y: portal.y, leadsTo: destinationZoneId },
            position: { x: Math.round(result.x), y: Math.round(result.y) },
            distanceFromPortal: Math.round(result.distanceRemaining),
            nextStep: result.arrived
              ? `Call zone_transition with portalId: "${portal.portalId}" to cross into ${destinationZoneId}`
              : "Still moving — try again or increase timeout",
          }, null, 2),
        }],
      };
    }
  );

  /**
   * Estimate travel time to a target in the current zone.
   */
  server.registerTool(
    "estimate_travel_time",
    {
      description:
        "Estimate how long (in seconds) it will take to walk from your current position to a target position or entity.",
      inputSchema: {
        zoneId: z.string().describe("Zone ID"),
        entityId: z.string().describe("Your entity ID"),
        targetX: z.number().optional().describe("Target X coordinate"),
        targetY: z.number().optional().describe("Target Y/Z coordinate"),
        targetEntityId: z.string().optional().describe("Target entity ID (use instead of coordinates)"),
      },
    },
    async ({ zoneId, entityId, targetX, targetY, targetEntityId }) => {
      const entities = await getZoneEntities(zoneId);
      const me = entities.find((e) => e.id === entityId);
      if (!me) {
        return { content: [{ type: "text" as const, text: `Entity ${entityId} not found` }] };
      }

      let tx = targetX;
      let ty = targetY;

      if (targetEntityId) {
        const target = entities.find((e) => e.id === targetEntityId);
        if (!target) {
          return { content: [{ type: "text" as const, text: `Target entity ${targetEntityId} not found` }] };
        }
        tx = target.x;
        ty = target.y;
      }

      if (tx == null || ty == null) {
        return { content: [{ type: "text" as const, text: "Provide targetX+targetY or targetEntityId" }] };
      }

      const d = dist(me.x, me.y, tx, ty);
      const ticks = Math.ceil(d / MOVE_SPEED);
      const seconds = (ticks * TICK_MS) / 1000;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            from: { x: Math.round(me.x), y: Math.round(me.y) },
            to: { x: Math.round(tx), y: Math.round(ty) },
            distance: Math.round(d),
            estimatedTicks: ticks,
            estimatedSeconds: Math.round(seconds * 10) / 10,
          }, null, 2),
        }],
      };
    }
  );
}
