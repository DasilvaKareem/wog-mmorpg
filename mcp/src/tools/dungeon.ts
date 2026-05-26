import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerDungeonTools(server: McpServer): void {
  server.registerTool(
    "dungeon_forge_key",
    {
      description:
        "Forge a dungeon key by enchanting a Gate Essence reagent at an Enchanting Altar. Reagent token IDs: 128=Crude (→E-Key), 129=Lesser (→D-Key), 130=Standard (→C-Key), 131=Greater (→B-Key), 132=Superior (→A-Key), 133=Supreme (→S-Key). Must be within 100 units of the altar and hold the reagent. Reagent is burned; matching key is minted.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Zone containing the enchanting altar"),
        altarId: z.string().describe("Enchanting Altar entity ID (from scan_zone)"),
        reagentTokenId: z
          .number()
          .int()
          .describe("Gate Essence token ID to consume (128-133)"),
      },
    },
    async ({ sessionId, entityId, zoneId, altarId, reagentTokenId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/dungeon/forge-key",
        { walletAddress, zoneId, entityId, altarId, reagentTokenId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "dungeon_list_gates",
    {
      description:
        "List all dungeon gates in a zone. Gates require a matching key to open. Use dungeon_open to enter once you have a key.",
      inputSchema: {
        zoneId: z.string().describe("Zone to search for dungeon gates"),
      },
    },
    async ({ zoneId }) => {
      const data = await shard.get<unknown>(`/dungeon/gates/${zoneId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "dungeon_open",
    {
      description:
        "Open a dungeon gate to enter an instanced dungeon. Consumes your dungeon key. Returns instanceId needed for dungeon_get_instance.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Zone where the gate is"),
        gateEntityId: z.string().describe("Dungeon gate entity ID from dungeon_list_gates"),
      },
    },
    async ({ sessionId, entityId, zoneId, gateEntityId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/dungeon/open",
        { walletAddress, zoneId, entityId, gateEntityId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "dungeon_get_instance",
    {
      description:
        "Get the current state of a dungeon instance: remaining mobs, boss status, loot collected, and time remaining.",
      inputSchema: {
        instanceId: z.string().describe("Dungeon instance ID from dungeon_open"),
      },
    },
    async ({ instanceId }) => {
      const data = await shard.get<unknown>(`/dungeon/instance/${instanceId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "dungeon_leave",
    {
      description: "Leave the current dungeon instance and return to the overworld zone.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
      },
    },
    async ({ sessionId, entityId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>("/dungeon/leave", { walletAddress, entityId }, token);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "dungeon_list_active",
    {
      description: "List all currently active dungeon instances across all zones.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/dungeon/active");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
