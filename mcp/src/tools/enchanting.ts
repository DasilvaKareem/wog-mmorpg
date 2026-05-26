import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

const EQUIPMENT_SLOTS = ["weapon", "chest", "legs", "boots", "helm", "shoulders", "gloves", "belt"] as const;

export function registerEnchantingTools(server: McpServer): void {
  server.registerTool(
    "enchanting_catalog",
    {
      description:
        "List all available enchantments with their stat bonuses and required Enchantment Elixir token IDs. Use items_get_inventory to check if you have the elixirs.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/enchanting/catalog");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "enchanting_apply",
    {
      description:
        "Apply an enchantment to an equipped gear slot. Must be standing next to an Enchanting Altar NPC. Consumes one Enchantment Elixir from your inventory.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        altarId: z.string().describe("Enchanting Altar NPC entity ID (from scan_zone)"),
        enchantmentElixirTokenId: z.number().int().describe("Token ID of the Enchantment Elixir to consume"),
        equipmentSlot: z.enum(EQUIPMENT_SLOTS).describe("Gear slot to enchant"),
      },
    },
    async ({ sessionId, entityId, zoneId, altarId, enchantmentElixirTokenId, equipmentSlot }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/enchanting/apply",
        { walletAddress, zoneId, entityId, altarId, enchantmentElixirTokenId, equipmentSlot },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "enchanting_get_item",
    {
      description: "Check the current enchantment on a specific gear slot for any entity.",
      inputSchema: {
        zoneId: z.string().describe("Zone where the entity is"),
        entityId: z.string().describe("Entity ID to inspect"),
        slot: z.enum(EQUIPMENT_SLOTS).describe("Gear slot to inspect"),
      },
    },
    async ({ zoneId, entityId, slot }) => {
      const data = await shard.get<unknown>(`/enchanting/item/${zoneId}/${entityId}/${slot}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "enchanting_remove",
    {
      description:
        "Remove the enchantment from a gear slot. Must be at an Enchanting Altar. The elixir is NOT refunded.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        altarId: z.string().describe("Enchanting Altar NPC entity ID"),
        equipmentSlot: z.enum(EQUIPMENT_SLOTS).describe("Gear slot to remove enchantment from"),
      },
    },
    async ({ sessionId, entityId, zoneId, altarId, equipmentSlot }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/enchanting/remove",
        { walletAddress, zoneId, entityId, altarId, equipmentSlot },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
