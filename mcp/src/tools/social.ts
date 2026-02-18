import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerSocialTools(server: McpServer): void {
  // ── Auction House ────────────────────────────────────────────────────────

  server.registerTool(
    "auction_get_npc_info",
    {
      description:
        "Get info about an Auctioneer NPC: their active auctions and available API endpoints. Use this first to find the auctioneer before listing or bidding.",
      inputSchema: {
        zoneId: z.string().describe("Zone where the auctioneer is located"),
        entityId: z.string().describe("Auctioneer NPC entity ID"),
      },
    },
    async ({ zoneId, entityId }) => {
      const data = await shard.get<unknown>(`/auctionhouse/npc/${zoneId}/${entityId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "auction_list_active",
    {
      description: "List all active auctions in a zone with current bids, buyout prices, and time remaining.",
      inputSchema: {
        zoneId: z.string().describe("Zone to list auctions for"),
      },
    },
    async ({ zoneId }) => {
      const data = await shard.get<unknown>(`/auctionhouse/${zoneId}/auctions`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "auction_create",
    {
      description:
        "Create an English auction for an item from your inventory. Set starting bid and optional buyout price. Duration in seconds.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        zoneId: z.string().describe("Zone where the auctioneer NPC is"),
        auctioneerEntityId: z.string().describe("Auctioneer NPC entity ID"),
        itemTokenId: z.number().describe("ERC-1155 token ID of the item to auction"),
        quantity: z.number().min(1).describe("Quantity to auction"),
        startingBid: z.number().describe("Starting bid in GOLD (smallest unit)"),
        buyoutPrice: z.number().optional().describe("Optional instant buyout price in GOLD"),
        durationSeconds: z.number().describe("Auction duration in seconds (min 300, max 604800)"),
      },
    },
    async ({ sessionId, zoneId, auctioneerEntityId, itemTokenId, quantity, startingBid, buyoutPrice, durationSeconds }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        `/auctionhouse/${zoneId}/create`,
        { walletAddress, auctioneerEntityId, itemTokenId, quantity, startingBid, buyoutPrice, durationSeconds },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "auction_place_bid",
    {
      description:
        "Place a bid on an active auction. Bid must exceed current highest bid. GOLD is reserved until outbid or auction ends.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        zoneId: z.string().describe("Zone where the auction is listed"),
        auctionId: z.string().describe("Auction ID from auction_list_active"),
        bidAmount: z.number().describe("Bid amount in GOLD (must exceed current bid)"),
      },
    },
    async ({ sessionId, zoneId, auctionId, bidAmount }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        `/auctionhouse/${zoneId}/bid`,
        { walletAddress, auctionId, bidAmount },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "auction_buyout",
    {
      description: "Instantly purchase an auctioned item at the buyout price (if set).",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        zoneId: z.string().describe("Zone where the auction is listed"),
        auctionId: z.string().describe("Auction ID"),
      },
    },
    async ({ sessionId, zoneId, auctionId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        `/auctionhouse/${zoneId}/buyout`,
        { walletAddress, auctionId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Guilds ───────────────────────────────────────────────────────────────

  server.registerTool(
    "guild_get_registrar_info",
    {
      description:
        "Get info from a Guild Registrar NPC: active guilds, creation cost, and endpoints.",
      inputSchema: {
        zoneId: z.string().describe("Zone where the registrar NPC is"),
        entityId: z.string().describe("Registrar NPC entity ID"),
      },
    },
    async ({ zoneId, entityId }) => {
      const data = await shard.get<unknown>(`/guild/registrar/${zoneId}/${entityId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "guild_list",
    {
      description: "List all active guilds with member counts and treasury balances.",
      inputSchema: {},
    },
    async () => {
      const data = await shard.get<unknown>("/guilds");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "guild_create",
    {
      description:
        "Create a new guild. Costs 50 GOLD protocol fee + 100 GOLD minimum treasury deposit = 150 GOLD total. Caller becomes the Founder.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        name: z.string().describe("Guild name (unique)"),
        description: z.string().optional().describe("Guild description"),
        zoneId: z.string().describe("Zone where a Guild Registrar NPC is present"),
        registrarEntityId: z.string().describe("Guild Registrar NPC entity ID"),
      },
    },
    async ({ sessionId, name, description, zoneId, registrarEntityId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/guild/create",
        { walletAddress, name, description, zoneId, registrarEntityId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "guild_join",
    {
      description: "Join an existing guild. The guild must be open to applications.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        guildId: z.string().describe("Guild ID from guild_list"),
      },
    },
    async ({ sessionId, guildId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        `/guild/${guildId}/join`,
        { walletAddress },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "guild_propose",
    {
      description:
        "Create a governance proposal in your guild. Types: withdraw-gold, kick-member, promote-officer, demote-officer, disband-guild. Requires Officer or Founder rank.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        guildId: z.string().describe("Your guild ID"),
        type: z
          .enum(["withdraw-gold", "kick-member", "promote-officer", "demote-officer", "disband-guild"])
          .describe("Proposal type"),
        targetWallet: z.string().optional().describe("Target wallet for member-related proposals"),
        amount: z.number().optional().describe("GOLD amount for withdraw-gold proposals"),
        reason: z.string().optional().describe("Reason for the proposal"),
      },
    },
    async ({ sessionId, guildId, type, targetWallet, amount, reason }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        `/guild/${guildId}/propose`,
        { walletAddress, type, targetWallet, amount, reason },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "guild_vote",
    {
      description: "Vote on an active guild governance proposal. All members can vote.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        guildId: z.string().describe("Your guild ID"),
        proposalId: z.string().describe("Proposal ID"),
        vote: z.enum(["yes", "no"]).describe("Your vote"),
      },
    },
    async ({ sessionId, guildId, proposalId, vote }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        `/guild/${guildId}/vote`,
        { walletAddress, proposalId, vote },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Party ────────────────────────────────────────────────────────────────

  server.registerTool(
    "party_create",
    {
      description: "Create a new party. Returns the party ID to share with other players.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
      },
    },
    async ({ sessionId, entityId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/party/create",
        { walletAddress, entityId, zoneId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "party_invite",
    {
      description: "Invite another player to your party by their entity ID.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        partyId: z.string().describe("Your party ID"),
        targetEntityId: z.string().describe("Entity ID of the player to invite"),
        zoneId: z.string().describe("Zone where both players are"),
      },
    },
    async ({ sessionId, partyId, targetEntityId, zoneId }) => {
      const { walletAddress, token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/party/invite",
        { walletAddress, partyId, targetEntityId, zoneId },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
