/**
 * A2A (Agent-to-Agent) Protocol Routes — ERC-8004 service discovery on SKALE.
 *
 * GET  /a2a/:wallet            — Agent Card (Google A2A protocol compatible)
 * POST /a2a/:wallet            — A2A JSON-RPC messaging endpoint
 * GET  /a2a/resolve/:agentId   — Resolve on-chain A2A endpoint by identity ID
 * GET  /.well-known/agent.json — Default shard agent card (game server itself)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getAgentEndpoint, getAgentOwnerWallet } from "../erc8004/identity.js";
import { sendInboxMessage } from "./agentInbox.js";
import { getAllEntities } from "../world/zoneRuntime.js";

const BASE_URL = process.env.WOG_SHARD_URL || "https://wog.urbantech.dev";

/** Supported A2A JSON-RPC methods */
const A2A_METHODS = ["message/send", "message/read", "agent/card"] as const;

/**
 * Build an A2A Agent Card for a WoG agent.
 * Follows the Google A2A protocol spec.
 */
function buildAgentCard(walletAddress: string, entity?: { name: string; classId?: string; level?: number; zoneId?: string }) {
  return {
    name: entity?.name ?? `WoG Agent ${walletAddress.slice(0, 8)}`,
    description: entity
      ? `Level ${entity.level ?? 1} ${entity.classId ?? "adventurer"} in World of Geneva${entity.zoneId ? `, currently in ${entity.zoneId}` : ""}`
      : "An AI agent playing World of Geneva MMORPG",
    url: `${BASE_URL}/a2a/${walletAddress}`,
    provider: {
      organization: "World of Geneva",
      url: BASE_URL,
    },
    version: "1.0.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    authentication: {
      schemes: ["none"],
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [
      {
        id: "trade",
        name: "Trade",
        description: "Propose and negotiate trades with this agent",
        tags: ["trading", "economy"],
      },
      {
        id: "party",
        name: "Party",
        description: "Send party invitations to this agent",
        tags: ["social", "party"],
      },
      {
        id: "chat",
        name: "Chat",
        description: "Send direct messages to this agent",
        tags: ["social", "communication"],
      },
    ],
    // ERC-8004 identity metadata
    erc8004: {
      chain: "skale-bite-v2-sandbox",
      chainId: 103698795,
      registry: process.env.IDENTITY_REGISTRY_ADDRESS ?? null,
      walletAddress,
    },
  };
}

/** Find an entity by wallet address across all zones */
function findEntityByWallet(wallet: string) {
  const lower = wallet.toLowerCase();
  for (const [, entities] of getAllEntities()) {
    for (const entity of Object.values(entities)) {
      if (entity.walletAddress?.toLowerCase() === lower) {
        return entity;
      }
    }
  }
  return undefined;
}

export function registerA2ARoutes(server: FastifyInstance): void {

  // ── Agent Card (GET) ──────────────────────────────────────────────────────
  server.get("/a2a/:wallet", async (
    req: FastifyRequest<{ Params: { wallet: string } }>,
    reply: FastifyReply,
  ) => {
    const { wallet } = req.params;
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.status(400).send({ error: "Invalid wallet address" });
    }

    const entity = findEntityByWallet(wallet);
    const card = buildAgentCard(wallet, entity as any);

    reply.header("content-type", "application/json");
    return card;
  });

  // ── A2A JSON-RPC Endpoint (POST) ──────────────────────────────────────────
  server.post("/a2a/:wallet", async (
    req: FastifyRequest<{
      Params: { wallet: string };
      Body: { jsonrpc?: string; method?: string; id?: string | number; params?: Record<string, unknown> };
    }>,
    reply: FastifyReply,
  ) => {
    const { wallet } = req.params;
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.status(400).send({ error: "Invalid wallet address" });
    }

    const body = req.body as any;
    if (!body || body.jsonrpc !== "2.0" || !body.method) {
      return reply.status(400).send({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid JSON-RPC request" },
        id: body?.id ?? null,
      });
    }

    const { method, params, id } = body;

    switch (method) {
      case "message/send": {
        // Forward as an inbox message
        const from = (params as any)?.from as string | undefined;
        const fromName = (params as any)?.fromName as string | undefined;
        const message = (params as any)?.message as string | undefined;
        const type = ((params as any)?.type as string) || "direct";

        if (!from || !message) {
          return reply.status(400).send({
            jsonrpc: "2.0",
            error: { code: -32602, message: "Missing required params: from, message" },
            id,
          });
        }

        const msgId = await sendInboxMessage({
          from,
          fromName: fromName ?? from.slice(0, 10),
          to: wallet,
          type: type as any,
          body: message,
          data: (params as any)?.data,
        });

        return {
          jsonrpc: "2.0",
          result: { messageId: msgId, status: "delivered" },
          id,
        };
      }

      case "agent/card": {
        const entity = findEntityByWallet(wallet);
        return {
          jsonrpc: "2.0",
          result: buildAgentCard(wallet, entity as any),
          id,
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          error: { code: -32601, message: `Method not found: ${method}` },
          id,
        };
    }
  });

  // ── Resolve on-chain A2A endpoint ─────────────────────────────────────────
  server.get("/a2a/resolve/:agentId", async (
    req: FastifyRequest<{ Params: { agentId: string } }>,
    reply: FastifyReply,
  ) => {
    const agentId = req.params.agentId;
    let id: bigint;
    try {
      id = BigInt(agentId);
    } catch {
      return reply.status(400).send({ error: "Invalid agentId — must be a number" });
    }

    const endpoint = await getAgentEndpoint(id);
    const wallet = await getAgentOwnerWallet(id);

    if (!endpoint && !wallet) {
      return reply.status(404).send({ error: "Agent identity not found" });
    }

    return {
      agentId: agentId,
      endpoint: endpoint ?? null,
      walletAddress: wallet ?? null,
      chainId: 103698795,
      registry: process.env.IDENTITY_REGISTRY_ADDRESS ?? null,
    };
  });

  // ── Shard-level agent card ────────────────────────────────────────────────
  server.get("/.well-known/agent.json", async (_req, reply) => {
    reply.header("content-type", "application/json");
    return {
      name: "World of Geneva Shard",
      description: "On-chain MMORPG game shard. AI agents are the players — deploy one with POST /x402/deploy, then explore, fight, quest, craft, and trade via the REST API.",
      url: `${BASE_URL}/a2a`,
      provider: {
        organization: "World of Geneva",
        url: BASE_URL,
      },
      version: "1.0.0",
      capabilities: {
        streaming: false,
        pushNotifications: false,
      },
      authentication: {
        schemes: ["none"],
      },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      skills: [
        {
          id: "deploy",
          name: "Deploy Agent",
          description: "Deploy an AI agent into the MMORPG — creates wallet, mints character, spawns in-world",
          tags: ["onboarding", "deployment"],
          examples: ["Deploy a warrior named Kronos", "Create a new agent in the game"],
        },
        {
          id: "play",
          name: "API Reference",
          description: "Get the full REST API reference for interacting with the game world",
          tags: ["documentation", "api"],
        },
      ],
      erc8004: {
        chain: "skale-bite-v2-sandbox",
        chainId: 103698795,
        registry: process.env.IDENTITY_REGISTRY_ADDRESS ?? null,
      },
    };
  });
}
