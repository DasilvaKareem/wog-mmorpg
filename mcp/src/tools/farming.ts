import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerFarmingTools(server: McpServer): void {
  // ── Farming ────────────────────────────────────────────────────────────

  server.registerTool(
    "farming_list_crops",
    {
      description: "List all crop types with their harvest requirements and rarity.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/farming/catalog");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "farming_list_nodes",
    {
      description: "List all crop nodes in a zone with positions, charges, and harvest requirements.",
      inputSchema: {
        zoneId: z.string().describe("Zone to inspect for crop nodes"),
      },
    },
    async ({ zoneId }) => {
      const data = await shard.get<unknown>(`/farming/nodes?region=${zoneId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "farming_harvest",
    {
      description:
        "Harvest a crop from a crop node. Requires a hoe equipped and the Farming profession. Node must be in range.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Zone ID"),
        cropNodeId: z.string().describe("Crop node ID from farming_list_nodes"),
      },
    },
    async ({ sessionId, entityId, zoneId, cropNodeId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/farming/harvest",
        { walletAddress, entityId, zoneId, cropNodeId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Plots ──────────────────────────────────────────────────────────────

  server.registerTool(
    "plot_list_zone",
    {
      description: "List all building plots in a farmland zone with ownership status and cost.",
      inputSchema: {
        zoneId: z.string().describe("Zone to list plots for"),
      },
    },
    async ({ zoneId }) => {
      const data = await shard.get<unknown>(`/plots/${zoneId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "plot_list_owned",
    {
      description: "Check what plot (if any) a player owns.",
      inputSchema: {
        walletAddress: z.string().describe("Player wallet address"),
      },
    },
    async ({ walletAddress }) => {
      const data = await shard.get<unknown>(`/plots/owned/${walletAddress}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "plot_claim",
    {
      description: "Claim a building plot in a farmland zone for gold. One plot per player.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        plotId: z.string().describe("Plot ID from plot_list_zone"),
      },
    },
    async ({ sessionId, entityId, plotId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/plots/claim",
        { walletAddress, entityId, plotId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "plot_release",
    {
      description: "Release your claimed plot, losing the building and ownership.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
      },
    },
    async ({ sessionId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/plots/release",
        { walletAddress },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Building ───────────────────────────────────────────────────────────

  server.registerTool(
    "building_list_blueprints",
    {
      description: "List all building blueprints (cottage, farmhouse, manor, estate) with material costs per stage.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/building/blueprints");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "building_status",
    {
      description: "Get the current building status on a plot — type, stage, completion.",
      inputSchema: {
        plotId: z.string().describe("Plot ID to check building status"),
      },
    },
    async ({ plotId }) => {
      const data = await shard.get<unknown>(`/building/status/${plotId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "building_start",
    {
      description: "Start building on your claimed plot. Choose a building type: cottage, farmhouse, manor, or estate.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        plotId: z.string().describe("Your plot ID"),
        buildingType: z.string().describe("Building type: cottage, farmhouse, manor, or estate"),
      },
    },
    async ({ sessionId, entityId, plotId, buildingType }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/building/start",
        { walletAddress, entityId, plotId, buildingType },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "building_advance",
    {
      description:
        "Advance your building to the next construction stage. Burns required materials and gold from your wallet.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        plotId: z.string().describe("Your plot ID"),
      },
    },
    async ({ sessionId, entityId, plotId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/building/construct",
        { walletAddress, entityId, plotId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
