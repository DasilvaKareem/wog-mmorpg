import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerWorldTools(server: McpServer): void {
  server.registerTool(
    "world_get_zone_state",
    {
      description:
        "Get the full live state of a zone: all entities (players, mobs, NPCs), their positions, HP, level, and status. Use this to locate targets, NPCs, and resources.",
      inputSchema: {
        zoneId: z
          .string()
          .optional()
          .describe(
            "Zone ID to inspect. Omit to get all zones. Valid zones: village-square, wild-meadow, dark-forest, auroral-plains, emerald-woods, viridian-range, moondancer-glade, felsrock-citadel, lake-lumina, azurshard-chasm"
          ),
      },
    },
    async ({ zoneId }) => {
      const data = await shard.get<unknown>("/state");
      if (zoneId && typeof data === "object" && data !== null && "zones" in data) {
        const zone = (data as any).zones?.[zoneId];
        if (!zone) {
          return {
            content: [{ type: "text" as const, text: `Zone '${zoneId}' not found.` }],
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ zoneId, ...zone }, null, 2) }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "world_list_zones",
    {
      description:
        "List all zones in the world with entity counts and connections. Shows the zone map (which zones connect to which) and level requirements for each zone.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/zones");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "world_list_portals",
    {
      description:
        "List all portals in a zone, their positions, destinations, and level requirements. Move within 30 units of a portal before using zone_transition.",
      inputSchema: {
        zoneId: z.string().describe("Zone ID to list portals for"),
      },
    },
    async ({ zoneId }) => {
      const data = await shard.get<unknown>(`/portals/${zoneId}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "zone_transition",
    {
      description:
        "Transition your character to an adjacent zone through a portal. Must be within 30 units of the portal. Use world_list_portals to find portal positions.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        portalId: z
          .string()
          .optional()
          .describe(
            "Specific portal ID to use. Omit to auto-transition through the nearest portal."
          ),
      },
    },
    async ({ sessionId, entityId, zoneId, portalId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const path = portalId
        ? `/transition/${zoneId}/portal/${portalId}`
        : "/transition/auto";

      const data = await shard.post<unknown>(
        path,
        { walletAddress, entityId, zoneId },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "world_get_events",
    {
      description:
        "Get recent events in a zone: combat logs, chat messages, kills, level-ups, loot drops. Useful for understanding what's happening in the zone.",
      inputSchema: {
        zoneId: z.string().describe("Zone ID to get events for"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe("Max events to return (default 50)"),
        since: z
          .number()
          .optional()
          .describe("Unix timestamp — only return events after this time"),
      },
    },
    async ({ zoneId, limit, since }) => {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (since) params.set("since", String(since));
      const qs = params.toString() ? `?${params}` : "";
      const data = await shard.get<unknown>(`/events/${zoneId}${qs}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "world_send_chat",
    {
      description:
        "Send a chat message visible to all players in a zone. Appears in the zone event log.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        zoneId: z.string().describe("Zone ID to send the message in"),
        message: z.string().max(256).describe("Chat message text (max 256 chars)"),
        senderName: z.string().describe("Display name to show in chat"),
      },
    },
    async ({ sessionId, zoneId, message, senderName }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        `/chat/${zoneId}`,
        { walletAddress, message, senderName },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "world_get_leaderboard",
    {
      description: "Get the player power rankings leaderboard.",
      inputSchema: {
        limit: z.number().min(1).max(100).optional().describe("Number of players (default 20)"),
        sortBy: z
          .string()
          .optional()
          .describe("Sort field: level, power, kills, etc."),
      },
    },
    async ({ limit, sortBy }) => {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (sortBy) params.set("sortBy", sortBy);
      const qs = params.toString() ? `?${params}` : "";
      const data = await shard.get<unknown>(`/leaderboard${qs}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "world_get_map",
    {
      description:
        "Get the world map: zone positions, connections, and level requirements. Useful for planning travel routes.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/worldmap");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
