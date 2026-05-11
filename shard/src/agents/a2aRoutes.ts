/**
 * A2A (Agent-to-Agent) Protocol Routes — ERC-8004 service discovery on the
 * supported WoG networks.
 *
 * GET  /a2a/:wallet            — Legacy wallet-keyed Agent Card
 * POST /a2a/:wallet            — Legacy wallet-keyed A2A JSON-RPC messaging endpoint
 * GET  /a2a/agent/:agentId     — Canonical agent-id-keyed Agent Card
 * POST /a2a/agent/:agentId     — Canonical agent-id-keyed A2A JSON-RPC endpoint
 * GET  /a2a/resolve/:agentId   — Resolve on-chain A2A endpoint by identity ID
 * GET  /.well-known/agent.json — Default shard agent card (game server itself)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getErc8004ChainName, getOfficialErc8004Addresses } from "../erc8004/official.js";
import { sendInboxMessage } from "./agentInbox.js";
import { getAllEntities } from "../world/zoneRuntime.js";
import { SKALE_BASE_CHAIN_ID } from "../blockchain/biteChain.js";
import {
  getCharacterProjectionByAgentId,
  listCharacterProjectionsForWallets,
} from "../character/characterProjectionStore.js";

const BASE_URL = process.env.WOG_A2A_BASE_URL || "https://wog.urbantech.dev";
const A2A_CHAIN_NAME = getErc8004ChainName(SKALE_BASE_CHAIN_ID);
const OFFICIAL_ERC8004 = getOfficialErc8004Addresses(SKALE_BASE_CHAIN_ID);
const ERC8004_MODE = OFFICIAL_ERC8004 ? "official" : "local-mock";
const ERC8004_REGISTRY = OFFICIAL_ERC8004?.identity ?? process.env.IDENTITY_REGISTRY_ADDRESS ?? null;
const ERC8004_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
const A2A_VERSION = "0.3.0";
const DEFAULT_CHARACTER_SPRITE_DATA_URI = (() => {
  const candidates = [
    resolve(process.cwd(), "../client/public/sprites/character.png"),
    resolve(process.cwd(), "../../client/public/sprites/character.png"),
    resolve(process.cwd(), "client/public/sprites/character.png"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return `data:image/png;base64,${readFileSync(candidate).toString("base64")}`;
    } catch {
      continue;
    }
  }
  return null;
})();

/** Supported A2A JSON-RPC methods */
const A2A_METHODS = ["message/send", "message/read", "agent/card"] as const;

/**
 * Build an A2A Agent Card for a WoG agent.
 * Follows the Google A2A protocol spec.
 */
function buildAgentImageDataUri(name: string, classId?: string): string {
  if (DEFAULT_CHARACTER_SPRITE_DATA_URI) return DEFAULT_CHARACTER_SPRITE_DATA_URI;
  const safeName = (name || "WoG Agent").trim();
  const initials = safeName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "WG";
  const subtitle = (classId || "adventurer").slice(0, 18);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f4d3a" />
      <stop offset="100%" stop-color="#c08b2f" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="48" fill="url(#bg)" />
  <circle cx="256" cy="220" r="92" fill="rgba(255,255,255,0.18)" />
  <text x="256" y="248" text-anchor="middle" font-family="Georgia, serif" font-size="88" font-weight="700" fill="#fff">${initials}</text>
  <text x="256" y="392" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="#f7e6b5">${subtitle}</text>
</svg>`.trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildRegistrations(agentId?: string | null) {
  if (!agentId || !ERC8004_REGISTRY) return [];
  return [
    {
      agentId: Number(agentId),
      agentRegistry: `eip155:${SKALE_BASE_CHAIN_ID}:${ERC8004_REGISTRY}`,
    },
  ];
}

function buildCanonicalAgentCardUrl(agentId?: string | null, walletAddress?: string | null) {
  if (agentId?.trim()) {
    return `${BASE_URL}/a2a/agent/${agentId.trim()}`;
  }
  if (walletAddress?.trim()) {
    return `${BASE_URL}/a2a/${walletAddress.trim()}`;
  }
  return `${BASE_URL}/a2a`;
}

function buildServices(agentId?: string | null, walletAddress?: string | null) {
  const a2aEndpoint = buildCanonicalAgentCardUrl(agentId, walletAddress);
  return [
    {
      name: "web",
      endpoint: BASE_URL,
    },
    {
      name: "A2A",
      endpoint: a2aEndpoint,
      version: A2A_VERSION,
    },
  ];
}

function buildAgentCard(walletAddress: string, entity?: {
  name: string;
  classId?: string;
  level?: number;
  zoneId?: string;
  agentId?: string | null;
  walletAddress?: string | null;
}) {
  const resolvedName = entity?.name ?? `WoG Agent ${walletAddress.slice(0, 8)}`;
  const resolvedWallet = entity?.walletAddress ?? walletAddress;
  const resolvedUrl = buildCanonicalAgentCardUrl(entity?.agentId, resolvedWallet);
  return {
    type: ERC8004_TYPE,
    image: buildAgentImageDataUri(resolvedName, entity?.classId),
    name: entity?.name ?? `WoG Agent ${walletAddress.slice(0, 8)}`,
    description: entity
      ? `Level ${entity.level ?? 1} ${entity.classId ?? "adventurer"} in World of Geneva${entity.zoneId ? `, currently in ${entity.zoneId}` : ""}`
      : "An AI agent playing World of Geneva MMORPG",
    url: resolvedUrl,
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
    services: buildServices(entity?.agentId, resolvedWallet),
    registrations: buildRegistrations(entity?.agentId),
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
      chain: A2A_CHAIN_NAME,
      chainId: SKALE_BASE_CHAIN_ID,
      mode: ERC8004_MODE,
      registry: ERC8004_REGISTRY,
      walletAddress: resolvedWallet,
    },
  };
}

/** Find an entity by wallet address across all zones */
function findEntityByWallet(wallet: string) {
  const lower = wallet.toLowerCase();
  for (const entity of getAllEntities().values()) {
    if (entity.walletAddress?.toLowerCase() === lower) {
      return entity;
    }
  }
  return undefined;
}

function findEntityByAgentId(agentId: string) {
  for (const entity of getAllEntities().values()) {
    if (entity.agentId?.toString() === agentId) {
      return entity;
    }
  }
  return undefined;
}

async function findProjectionByWallet(wallet: string) {
  const projections = await listCharacterProjectionsForWallets([wallet]).catch(() => []);
  if (projections.length === 0) return null;
  return projections.find((projection) => projection.chainRegistrationStatus === "registered") ?? projections[0] ?? null;
}

async function resolveAgentCardEntity(wallet: string) {
  const liveEntity = findEntityByWallet(wallet);
  const projection = await findProjectionByWallet(wallet);
  if (liveEntity) {
    return {
      name: liveEntity.name,
      classId: liveEntity.classId,
      level: liveEntity.level,
      zoneId: liveEntity.region,
      agentId: liveEntity.agentId?.toString() ?? projection?.agentId ?? null,
      walletAddress: liveEntity.walletAddress ?? projection?.walletAddress ?? wallet,
    };
  }

  if (!projection) return undefined;
  return {
    name: projection.characterName,
    classId: projection.classId,
    level: projection.level,
    zoneId: projection.zoneId,
    agentId: projection.agentId,
    walletAddress: projection.walletAddress,
  };
}

async function resolveAgentCardEntityByAgentId(agentId: string) {
  const projection = await getCharacterProjectionByAgentId(agentId);
  const liveEntity = findEntityByAgentId(agentId);
  if (liveEntity) {
    return {
      name: liveEntity.name,
      classId: liveEntity.classId,
      level: liveEntity.level,
      zoneId: liveEntity.region,
      agentId,
      walletAddress: liveEntity.walletAddress ?? projection?.walletAddress ?? null,
    };
  }
  if (!projection) return undefined;
  return {
    name: projection.characterName,
    classId: projection.classId,
    level: projection.level,
    zoneId: projection.zoneId,
    agentId,
    walletAddress: projection.walletAddress,
  };
}

async function resolveWalletByAgentId(agentId: string): Promise<string | null> {
  const liveEntity = findEntityByAgentId(agentId);
  if (liveEntity?.walletAddress) return liveEntity.walletAddress;
  const projection = await getCharacterProjectionByAgentId(agentId);
  return projection?.walletAddress ?? null;
}

async function handleA2aRpcForWallet(
  wallet: string,
  body: { jsonrpc?: string; method?: string; id?: string | number; params?: Record<string, unknown> },
  reply: FastifyReply,
  cardEntity?: {
    name: string;
    classId?: string;
    level?: number;
    zoneId?: string;
    agentId?: string | null;
    walletAddress?: string | null;
  },
) {
  if (!body || body.jsonrpc !== "2.0" || !body.method) {
    return reply.status(400).send({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid JSON-RPC request" },
      id: body?.id ?? null,
    });
  }

  const { method, params, id } = body as any;

  switch (method) {
    case "message/send": {
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
      const entity = cardEntity ?? await resolveAgentCardEntity(wallet);
      return {
        jsonrpc: "2.0",
        result: buildAgentCard(wallet, entity),
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

    const entity = await resolveAgentCardEntity(wallet);
    const card = buildAgentCard(wallet, entity);

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

    return handleA2aRpcForWallet(wallet, req.body as any, reply);
  });

  server.get("/a2a/agent/:agentId", async (
    req: FastifyRequest<{ Params: { agentId: string } }>,
    reply: FastifyReply,
  ) => {
    const { agentId } = req.params;
    const wallet = await resolveWalletByAgentId(agentId);
    if (!wallet) {
      return reply.status(404).send({ error: "Agent identity not found" });
    }

    const entity = await resolveAgentCardEntityByAgentId(agentId);
    const card = buildAgentCard(wallet, entity);

    reply.header("content-type", "application/json");
    return card;
  });

  server.post("/a2a/agent/:agentId", async (
    req: FastifyRequest<{
      Params: { agentId: string };
      Body: { jsonrpc?: string; method?: string; id?: string | number; params?: Record<string, unknown> };
    }>,
    reply: FastifyReply,
  ) => {
    const { agentId } = req.params;
    const wallet = await resolveWalletByAgentId(agentId);
    if (!wallet) {
      return reply.status(404).send({ error: "Agent identity not found" });
    }
    const entity = await resolveAgentCardEntityByAgentId(agentId);
    return handleA2aRpcForWallet(wallet, req.body as any, reply, entity);
  });

  // ── Resolve agent A2A endpoint from local authoritative state ────────────
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

    const projection = await getCharacterProjectionByAgentId(agentId);
    const wallet = projection?.walletAddress ?? null;
    const endpoint = projection?.agentId ? `${BASE_URL}/a2a/agent/${projection.agentId}` : null;

    if (!endpoint && !wallet) {
      return reply.status(404).send({ error: "Agent identity not found" });
    }

    return {
      agentId: agentId,
      endpoint: endpoint ?? null,
      walletAddress: wallet ?? null,
      chainId: SKALE_BASE_CHAIN_ID,
      mode: ERC8004_MODE,
      registry: ERC8004_REGISTRY,
    };
  });

  // ── Shard-level agent card ────────────────────────────────────────────────
  server.get("/.well-known/agent.json", async (_req, reply) => {
    reply.header("content-type", "application/json");
    return {
      type: ERC8004_TYPE,
      image: buildAgentImageDataUri("World of Geneva Shard", "mmorpg-shard"),
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
      services: [
        {
          name: "web",
          endpoint: BASE_URL,
        },
        {
          name: "A2A",
          endpoint: `${BASE_URL}/.well-known/agent.json`,
          version: A2A_VERSION,
        },
      ],
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
        chain: A2A_CHAIN_NAME,
        chainId: SKALE_BASE_CHAIN_ID,
        mode: ERC8004_MODE,
        registry: ERC8004_REGISTRY,
      },
    };
  });
}
