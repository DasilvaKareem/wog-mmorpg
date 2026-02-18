import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerCharacterTools(server: McpServer): void {
  server.registerTool(
    "character_list_classes",
    {
      description:
        "List all 8 playable classes with base stats (strength, intelligence, agility, etc.). Call this before creating a character.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/character/classes");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "character_list_races",
    {
      description:
        "List all 4 playable races with stat modifiers. Call this before creating a character.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/character/races");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "character_create",
    {
      description:
        "Mint a new character NFT (ERC-721). Choose a name, race, and class. Requires a registered wallet. The character is owned by the wallet on-chain.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        name: z.string().describe("Character name (3-20 characters)"),
        raceId: z.string().describe("Race ID from character_list_races"),
        classId: z.string().describe("Class ID from character_list_classes"),
      },
    },
    async ({ sessionId, name, raceId, classId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/character/create",
        { walletAddress, name, raceId, classId },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "character_get",
    {
      description:
        "Get all character NFTs owned by a wallet, including stats, level, class, race, and equipped gear.",
      inputSchema: {
        walletAddress: z.string().describe("Ethereum wallet address to look up"),
      },
    },
    async ({ walletAddress }) => {
      const data = await shard.get<unknown>(`/character/${walletAddress}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "character_spawn",
    {
      description:
        "Spawn (log in) a character into a zone. Restores saved state and makes the character visible to other players and mobs. Must be called before any gameplay actions. Returns the entityId used for commands.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        zoneId: z
          .string()
          .describe(
            "Zone to spawn in (e.g. village-square, wild-meadow, dark-forest, auroral-plains, emerald-woods, viridian-range, moondancer-glade, felsrock-citadel, lake-lumina, azurshard-chasm)"
          ),
        characterId: z.string().describe("Character NFT token ID"),
        x: z.number().optional().describe("Spawn X coordinate (default: zone center)"),
        z: z.number().optional().describe("Spawn Z coordinate (default: zone center)"),
      },
    },
    async ({ sessionId, zoneId, characterId, x, z: zCoord }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/spawn",
        { walletAddress, zoneId, characterId, x, z: zCoord },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "character_logout",
    {
      description:
        "Save character state and despawn from the current zone. Always call this before ending a session to preserve XP, inventory, and position.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Entity ID returned by character_spawn"),
        zoneId: z.string().describe("Zone the character is currently in"),
      },
    },
    async ({ sessionId, entityId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/logout",
        { walletAddress, entityId, zoneId },
        token
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
