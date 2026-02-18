import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerCombatTools(server: McpServer): void {
  server.registerTool(
    "player_move",
    {
      description:
        "Move a player character to a new position in the current zone. Coordinates range 0–640. Use world_get_zone_state to see the current position and nearby entities.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Entity ID returned by character_spawn"),
        zoneId: z.string().describe("Current zone ID"),
        x: z.number().min(0).max(640).describe("Target X coordinate (0–640)"),
        z: z.number().min(0).max(640).describe("Target Z coordinate (0–640)"),
      },
    },
    async ({ sessionId, entityId, zoneId, x, z: zCoord }) => {
      const { token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/command",
        { entityId, zoneId, action: "move", x, z: zCoord },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "player_attack",
    {
      description:
        "Attack a target entity (mob or player) in the current zone. The target must be within attack range. Returns damage dealt, target HP, and any loot on kill.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID (attacker)"),
        zoneId: z.string().describe("Current zone ID"),
        targetId: z.string().describe("Entity ID of the target mob or player"),
      },
    },
    async ({ sessionId, entityId, zoneId, targetId }) => {
      const { token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/command",
        { entityId, zoneId, action: "attack", targetId },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "technique_cast",
    {
      description:
        "Cast a learned technique (ability/spell) during combat. Use technique_list_catalog to see available techniques for your class.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        techniqueId: z.string().describe("Technique ID to cast"),
        targetId: z.string().optional().describe("Target entity ID (if targeted technique)"),
      },
    },
    async ({ sessionId, entityId, zoneId, techniqueId, targetId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/technique/cast",
        { walletAddress, entityId, zoneId, techniqueId, targetId },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "technique_list_catalog",
    {
      description: "List all available techniques (abilities/spells) grouped by class.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/techniques/catalog");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "technique_learn",
    {
      description: "Learn a new technique from a trainer NPC. Requires the appropriate class level.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        techniqueId: z.string().describe("Technique ID to learn"),
        zoneId: z.string().describe("Zone where the trainer NPC is located"),
      },
    },
    async ({ sessionId, techniqueId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/technique/learn",
        { walletAddress, techniqueId, zoneId },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "pvp_queue_join",
    {
      description:
        "Join the PvP matchmaking queue for arena combat. Formats: 1v1, 2v2, 5v5, FFA.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        format: z.enum(["1v1", "2v2", "5v5", "FFA"]).describe("Battle format"),
      },
    },
    async ({ sessionId, entityId, zoneId, format }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/api/pvp/queue/join",
        { walletAddress, entityId, zoneId, format },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "pvp_get_battle",
    {
      description: "Get the current state of a PvP battle including positions, HP, and actions.",
      inputSchema: {
        battleId: z.string().describe("Battle ID from pvp_queue_join or pvp_list_active"),
      },
    },
    async ({ battleId }) => {
      const data = await shard.get<unknown>(`/api/pvp/battle/${battleId}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
