import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerShopTools(server: McpServer): void {
  server.registerTool(
    "shop_get_catalog",
    {
      description:
        "Get the full item catalog with names, token IDs, stats, and gold prices. Use shop_get_npc_catalog to see what a specific merchant sells.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/shop/catalog");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "shop_get_npc_catalog",
    {
      description:
        "Get the item catalog for a specific NPC merchant in a zone. Shows only what that merchant sells, along with dynamic prices if the merchant has an agent active.",
      inputSchema: {
        zoneId: z.string().describe("Zone where the NPC is located"),
        entityId: z.string().describe("NPC entity ID"),
      },
    },
    async ({ zoneId, entityId }) => {
      const data = await shard.get<unknown>(`/shop/npc/${zoneId}/${entityId}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "shop_buy_item",
    {
      description:
        "Purchase an item from an NPC merchant using GOLD tokens. The item NFT is minted directly to your wallet. Use shop_get_npc_catalog to see available items and prices.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        npcEntityId: z.string().describe("Merchant NPC entity ID"),
        zoneId: z.string().describe("Zone where the NPC is located"),
        itemTokenId: z.number().describe("ERC-1155 token ID of the item to buy"),
        quantity: z.number().min(1).describe("Number of items to purchase"),
      },
    },
    async ({ sessionId, npcEntityId, zoneId, itemTokenId, quantity }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/shop/buy",
        { walletAddress, npcEntityId, zoneId, itemTokenId, quantity },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "shop_sell_item",
    {
      description:
        "Sell an item from your inventory to an NPC merchant for GOLD tokens. Use shop_get_sell_prices to see what the merchant will pay.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        merchantEntityId: z.string().describe("Merchant NPC entity ID"),
        zoneId: z.string().describe("Zone where the NPC is located"),
        itemTokenId: z.number().describe("ERC-1155 token ID of the item to sell"),
        quantity: z.number().min(1).describe("Number of items to sell"),
      },
    },
    async ({ sessionId, merchantEntityId, zoneId, itemTokenId, quantity }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/shop/sell",
        { walletAddress, merchantEntityId, zoneId, itemTokenId, quantity },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "shop_get_sell_prices",
    {
      description: "Get the buy-back prices a specific merchant offers for each item.",
      inputSchema: {
        merchantEntityId: z.string().describe("Merchant NPC entity ID"),
      },
    },
    async ({ merchantEntityId }) => {
      const data = await shard.get<unknown>(`/shop/sell-prices/${merchantEntityId}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "items_get_inventory",
    {
      description: "Get all items (NFTs) in a wallet's inventory with metadata.",
      inputSchema: {
        walletAddress: z.string().describe("Ethereum wallet address"),
      },
    },
    async ({ walletAddress }) => {
      const data = await shard.get<unknown>(`/items/${walletAddress}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "equipment_equip",
    {
      description:
        "Equip an item from inventory to an equipment slot (head, chest, legs, feet, weapon, offhand, ring, amulet). Item must be owned by the player.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        itemTokenId: z.number().describe("ERC-1155 token ID of item to equip"),
        slot: z.string().describe("Equipment slot: head, chest, legs, feet, weapon, offhand, ring, amulet"),
      },
    },
    async ({ sessionId, entityId, zoneId, itemTokenId, slot }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/equipment/equip",
        { walletAddress, entityId, zoneId, itemTokenId, slot },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "equipment_get",
    {
      description:
        "Get the currently equipped items and total stats for a player entity.",
      inputSchema: {
        zoneId: z.string().describe("Zone where the entity is"),
        entityId: z.string().describe("Entity ID of the player"),
      },
    },
    async ({ zoneId, entityId }) => {
      const data = await shard.get<unknown>(`/equipment/${zoneId}/${entityId}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
