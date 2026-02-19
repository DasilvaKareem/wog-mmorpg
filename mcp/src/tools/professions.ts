import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerProfessionTools(server: McpServer): void {
  // ── Discovery ────────────────────────────────────────────────────────────

  server.registerTool(
    "professions_list",
    {
      description: "List all available professions (mining, herbalism, alchemy, etc.) with requirements.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/professions/catalog");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "professions_get_player",
    {
      description: "Get the professions a player has learned and their skill levels.",
      inputSchema: {
        walletAddress: z.string().describe("Player wallet address"),
      },
    },
    async ({ walletAddress }) => {
      const data = await shard.get<unknown>(`/professions/${walletAddress}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Mining ───────────────────────────────────────────────────────────────

  server.registerTool(
    "mining_list_nodes",
    {
      description: "List all ore nodes in a zone with their positions and remaining charges.",
      inputSchema: {
        zoneId: z.string().describe("Zone to inspect"),
      },
    },
    async ({ zoneId }) => {
      const data = await shard.get<unknown>(`/mining/nodes/${zoneId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "mining_gather",
    {
      description:
        "Mine an ore node to gather raw materials. Requires a pickaxe and Mining profession. Node must be in range. Returns ore type and quantity.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Zone ID"),
        nodeId: z.string().describe("Ore node ID from mining_list_nodes"),
      },
    },
    async ({ sessionId, entityId, zoneId, nodeId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/mining/gather",
        { walletAddress, entityId, zoneId, nodeId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Herbalism ────────────────────────────────────────────────────────────

  server.registerTool(
    "herbalism_list_flowers",
    {
      description: "List all flower nodes in a zone with their positions.",
      inputSchema: {
        zoneId: z.string().describe("Zone to inspect"),
      },
    },
    async ({ zoneId }) => {
      const data = await shard.get<unknown>(`/herbalism/flowers/${zoneId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "herbalism_gather",
    {
      description:
        "Gather flowers from a herb node. Requires Herbalism profession. Returns herb type and quantity.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Zone ID"),
        nodeId: z.string().describe("Flower node ID from herbalism_list_flowers"),
      },
    },
    async ({ sessionId, entityId, zoneId, nodeId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/herbalism/gather",
        { walletAddress, entityId, zoneId, nodeId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Crafting ─────────────────────────────────────────────────────────────

  server.registerTool(
    "crafting_list_recipes",
    {
      description: "List all crafting recipes (blacksmithing, leatherworking, jewelcrafting, etc.) with material requirements.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/crafting/recipes");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "crafting_forge",
    {
      description:
        "Forge an item using materials in your inventory (blacksmithing). Burns the materials and mints the crafted item NFT to your wallet.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        recipeId: z.string().describe("Recipe ID from crafting_list_recipes"),
        zoneId: z.string().describe("Zone where a forge/anvil NPC is present"),
      },
    },
    async ({ sessionId, recipeId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/crafting/forge",
        { walletAddress, recipeId, zoneId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Alchemy ──────────────────────────────────────────────────────────────

  server.registerTool(
    "alchemy_list_recipes",
    {
      description: "List all alchemy recipes for brewing potions with herb requirements.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/alchemy/recipes");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "alchemy_brew",
    {
      description:
        "Brew a potion using herbs from your inventory. Mints the potion NFT to your wallet.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        recipeId: z.string().describe("Recipe ID from alchemy_list_recipes"),
        zoneId: z.string().describe("Zone with an alchemy station"),
      },
    },
    async ({ sessionId, recipeId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/alchemy/brew",
        { walletAddress, recipeId, zoneId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Cooking ──────────────────────────────────────────────────────────────

  server.registerTool(
    "cooking_list_recipes",
    {
      description: "List all cooking recipes with ingredient requirements and stat buffs.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/cooking/recipes");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "cooking_cook",
    {
      description:
        "Cook a meal using ingredients from your inventory. Cooked food restores HP/MP or provides combat buffs.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        recipeId: z.string().describe("Recipe ID from cooking_list_recipes"),
        zoneId: z.string().describe("Zone with a cooking fire"),
      },
    },
    async ({ sessionId, recipeId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/cooking/cook",
        { walletAddress, recipeId, zoneId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Skinning ─────────────────────────────────────────────────────────────

  server.registerTool(
    "skinning_skin_corpse",
    {
      description:
        "Skin a dead mob corpse for leather and hides. Requires Skinning profession and a skinning knife.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Zone ID"),
        corpseId: z.string().describe("Entity ID of the dead mob corpse"),
      },
    },
    async ({ sessionId, entityId, zoneId, corpseId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/skinning/skin",
        { walletAddress, entityId, zoneId, corpseId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Quests ───────────────────────────────────────────────────────────────

  server.registerTool(
    "quests_get_catalog",
    {
      description: "List all available quests with objectives and rewards.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/quests/catalog");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "quests_get_active",
    {
      description: "Get all active quests for a player and their progress.",
      inputSchema: {
        walletAddress: z.string().describe("Player wallet address"),
      },
    },
    async ({ walletAddress }) => {
      const data = await shard.get<unknown>(`/quests/${walletAddress}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "quests_accept",
    {
      description: "Accept a quest from a quest-giver NPC.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        questId: z.string().describe("Quest ID from quests_get_catalog"),
        npcEntityId: z.string().describe("Quest-giver NPC entity ID"),
        zoneId: z.string().describe("Zone where the NPC is located"),
      },
    },
    async ({ sessionId, questId, npcEntityId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/quests/accept",
        { walletAddress, questId, npcEntityId, zoneId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "cooking_consume",
    {
      description:
        "Eat a cooked food item to restore HP. Burns the item from your wallet. Use cooking_list_recipes to see which food items restore how much HP, and items_get_inventory to see what you have.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        foodTokenId: z.number().describe("Token ID of the cooked food item to consume (e.g. 81=Cooked Meat, 82=Hearty Stew)"),
      },
    },
    async ({ sessionId, entityId, zoneId, foodTokenId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/cooking/consume",
        { walletAddress, zoneId, entityId, foodTokenId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "quests_complete",
    {
      description: "Complete a quest and claim XP and gold rewards.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        questId: z.string().describe("Quest ID to complete"),
        npcEntityId: z.string().describe("Quest-giver NPC entity ID"),
        zoneId: z.string().describe("Zone where the NPC is located"),
      },
    },
    async ({ sessionId, questId, npcEntityId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/quests/complete",
        { walletAddress, questId, npcEntityId, zoneId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
