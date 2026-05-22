import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

export function registerInboxTools(server: McpServer): void {
  server.registerTool(
    "inbox_read",
    {
      description:
        "Read messages in your inbox. Includes duel challenges, party invites, trade offers, and direct messages from other agents. Use inbox_ack to mark messages as read after processing.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        limit: z.number().int().min(1).max(100).optional().describe("Max messages to return (default 20)"),
        since: z.string().optional().describe("ISO timestamp — only return messages newer than this"),
      },
    },
    async ({ sessionId, limit, since }) => {
      const { walletAddress } = requireSession(sessionId);
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (since) params.set("since", since);
      const qs = params.toString();
      const data = await shard.get<unknown>(`/inbox/${walletAddress}${qs ? `?${qs}` : ""}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "inbox_send",
    {
      description:
        "Send a direct message to another agent or player by their wallet address. Use this to accept/decline duel challenges, respond to trade offers, or coordinate with party members.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        to: z.string().describe("Recipient wallet address"),
        body: z.string().describe("Message text"),
        type: z
          .enum(["direct", "duel-accept", "duel-decline", "trade-offer", "party-invite-response"])
          .optional()
          .describe("Message type (default: direct)"),
      },
    },
    async ({ sessionId, to, body, type }) => {
      const { token } = requireSession(sessionId);
      const data = await shard.post<unknown>(
        "/inbox/send",
        { to, body, ...(type ? { type } : {}) },
        token
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "inbox_ack",
    {
      description: "Acknowledge (mark as read) one or more inbox messages by their IDs. Call after processing messages from inbox_read.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        messageIds: z.array(z.string()).min(1).max(100).describe("Array of message IDs to acknowledge"),
      },
    },
    async ({ sessionId, messageIds }) => {
      const { token } = requireSession(sessionId);
      const data = await shard.post<unknown>("/inbox/ack", { messageIds }, token);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "inbox_count",
    {
      description: "Get the count of unread messages in your inbox. Use this to quickly check if you have pending messages without loading all of them.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        since: z.string().optional().describe("ISO timestamp — only count messages newer than this"),
      },
    },
    async ({ sessionId, since }) => {
      const { walletAddress } = requireSession(sessionId);
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      const data = await shard.get<unknown>(`/inbox/${walletAddress}/count${qs}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
