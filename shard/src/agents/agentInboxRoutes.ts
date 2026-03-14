/**
 * Agent Inbox Routes — HTTP API for agent-to-agent messaging.
 *
 * POST /inbox/send          — send a message to another agent
 * GET  /inbox/:wallet       — read messages (optionally since a stream ID)
 * POST /inbox/ack           — acknowledge (delete) processed messages
 * GET  /inbox/:wallet/count — get inbox message count
 * POST /inbox/broadcast     — broadcast to all agents in a zone
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import {
  sendInboxMessage,
  readInbox,
  ackInboxMessages,
  countInbox,
  countNewMessages,
  broadcastToZone,
  getMessageHistory,
  type InboxMessageType,
} from "./agentInbox.js";
import { getAgentEntityRef, getAgentCustodialWallet } from "./agentConfigStore.js";
import { getAllEntities, getEntitiesInRegion, getEntity } from "../world/zoneRuntime.js";

const VALID_TYPES: InboxMessageType[] = ["direct", "trade-request", "party-invite", "broadcast", "quest-approval"];

export function registerAgentInboxRoutes(server: FastifyInstance): void {

  // ── Send a message ─────────────────────────────────────────────────────────

  server.post<{
    Body: {
      to: string;
      type?: InboxMessageType;
      body: string;
      data?: Record<string, unknown>;
    };
  }>("/inbox/send", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const fromWallet: string = (request as any).walletAddress;
    const { to, type = "direct", body, data } = request.body ?? {};

    if (!to || !body) {
      reply.code(400);
      return { error: "Missing required fields: to, body" };
    }
    if (!VALID_TYPES.includes(type)) {
      reply.code(400);
      return { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` };
    }
    if (to.toLowerCase() === fromWallet.toLowerCase()) {
      reply.code(400);
      return { error: "Cannot send a message to yourself" };
    }

    // Resolve sender name from zone entities
    const fromName = resolveEntityName(fromWallet) ?? fromWallet.slice(0, 8);

    const messageId = await sendInboxMessage({
      from: fromWallet,
      fromName,
      to,
      type,
      body,
      data,
    });

    return { ok: true, messageId };
  });

  // ── Read inbox ─────────────────────────────────────────────────────────────

  server.get<{
    Params: { wallet: string };
    Querystring: { limit?: string; since?: string };
  }>("/inbox/:wallet", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { wallet } = request.params;
    const authedWallet: string = (request as any).walletAddress;

    // Agents can only read their own inbox
    if (wallet.toLowerCase() !== authedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Cannot read another agent's inbox" };
    }

    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
    const since = request.query.since || undefined;

    const messages = await readInbox(wallet, limit, since);
    return { ok: true, messages, count: messages.length };
  });

  // ── Acknowledge messages ───────────────────────────────────────────────────

  server.post<{
    Body: { messageIds: string[] };
  }>("/inbox/ack", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const wallet: string = (request as any).walletAddress;
    const { messageIds } = request.body ?? {};

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      reply.code(400);
      return { error: "messageIds must be a non-empty array" };
    }
    if (messageIds.length > 100) {
      reply.code(400);
      return { error: "Cannot ack more than 100 messages at once" };
    }

    const deleted = await ackInboxMessages(wallet, messageIds);
    return { ok: true, deleted };
  });

  // ── Count ──────────────────────────────────────────────────────────────────

  server.get<{
    Params: { wallet: string };
    Querystring: { since?: string };
  }>("/inbox/:wallet/count", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { wallet } = request.params;
    const authedWallet: string = (request as any).walletAddress;

    if (wallet.toLowerCase() !== authedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Cannot count another agent's inbox" };
    }

    const since = request.query.since;
    const total = await countInbox(wallet);
    const newCount = since ? await countNewMessages(wallet, since) : total;

    return { ok: true, total, new: newCount };
  });

  // ── Zone broadcast ─────────────────────────────────────────────────────────

  server.post<{
    Body: {
      zoneId: string;
      body: string;
      data?: Record<string, unknown>;
    };
  }>("/inbox/broadcast", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const fromWallet: string = (request as any).walletAddress;
    const { zoneId, body, data } = request.body ?? {};

    if (!zoneId || !body) {
      reply.code(400);
      return { error: "Missing required fields: zoneId, body" };
    }

    // Find all player wallets in the region
    const regionEntities = getEntitiesInRegion(zoneId);

    const recipientWallets: string[] = [];
    for (const entity of regionEntities) {
      if (entity.type === "player" && entity.walletAddress) {
        recipientWallets.push(entity.walletAddress);
      }
    }

    const fromName = resolveEntityName(fromWallet) ?? fromWallet.slice(0, 8);
    const sent = await broadcastToZone(fromWallet, fromName, body, recipientWallets, data);

    return { ok: true, sent, zone: zoneId };
  });

  // ── Message history (public — spectator view) ──────────────────────────────

  server.get<{
    Params: { wallet: string };
    Querystring: { limit?: string; offset?: string };
  }>("/inbox/:wallet/history", async (request, reply) => {
    const { wallet } = request.params;
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(request.query.offset) || 0, 0);

    const { messages, total } = await getMessageHistory(wallet, limit, offset);
    return { ok: true, messages, total, limit, offset };
  });

  // ── Quest approval (summoner accepts/denies quest for their champion) ─────

  server.post<{
    Body: {
      questId: string;
      approved: boolean;
    };
  }>("/inbox/quest-approve", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const userWallet: string = (request as any).walletAddress;
    const { questId, approved } = request.body ?? {};

    if (!questId || typeof approved !== "boolean") {
      reply.code(400);
      return { error: "Missing required fields: questId, approved" };
    }

    // Look up the agent's entity
    const ref = await getAgentEntityRef(userWallet);
    if (!ref?.entityId) {
      reply.code(404);
      return { error: "No agent entity found" };
    }

    const entity = getEntity(ref.entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Agent entity not in world" };
    }

    // Remove from pending approvals
    if (!entity.pendingQuestApprovals) entity.pendingQuestApprovals = [];
    entity.pendingQuestApprovals = entity.pendingQuestApprovals.filter(
      (id: string) => id !== questId,
    );

    if (!approved) {
      // Notify agent that summoner denied the quest
      const custodialWallet = await getAgentCustodialWallet(userWallet);
      if (custodialWallet) {
        void sendInboxMessage({
          from: userWallet,
          fromName: "Summoner",
          to: custodialWallet,
          type: "direct",
          body: `Quest denied. Skip this one.`,
        });
      }
      return { ok: true, approved: false, questId };
    }

    // Accept the quest for the agent by calling the quest accept internally
    // (same logic as POST /quests/accept but done server-side)
    try {
      const injectRes = await server.inject({
        method: "POST",
        url: "/quests/accept",
        headers: { authorization: request.headers.authorization },
        payload: {
          zoneId: ref.zoneId,
          entityId: ref.entityId,
          questId,
        },
      });
      const data = JSON.parse(injectRes.body);
      if (injectRes.statusCode === 200 && data.accepted) {
        // Notify agent
        const custodialWallet = await getAgentCustodialWallet(userWallet);
        if (custodialWallet) {
          void sendInboxMessage({
            from: userWallet,
            fromName: "Summoner",
            to: custodialWallet,
            type: "direct",
            body: `Quest approved! Get to it, champion.`,
          });
        }
        return { ok: true, approved: true, questId, quest: data.quest };
      }
      reply.code(injectRes.statusCode);
      return { error: data.error ?? "Failed to accept quest" };
    } catch (err: any) {
      reply.code(500);
      return { error: err.message ?? "Internal error accepting quest" };
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Look up entity name from wallet address across all entities. */
function resolveEntityName(wallet: string): string | null {
  const w = wallet.toLowerCase();
  for (const entity of getAllEntities().values()) {
    if (entity.walletAddress?.toLowerCase() === w && entity.name) {
      return entity.name;
    }
  }
  return null;
}
