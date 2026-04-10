/**
 * Agent Directory Routes — ERC-8004 on-chain agent registry
 *
 * GET /api/agents — list all registered agent identities (blockchain source of truth),
 *                   enriched with off-chain character data where available
 */

import type { FastifyInstance } from "fastify";
import { listAllRegisteredIdentities } from "../blockchain/blockchain.js";
import { loadAllCharactersForWallet } from "../character/characterStore.js";
import { getAllEntities } from "../world/zoneRuntime.js";

interface AgentDirectoryEntry {
  agentId: string;
  agentUri: string;
  ownerAddress: string;
  blockNumber: number;
  txHash: string;
  character: {
    name: string;
    classId: string;
    raceId: string;
    level: number;
    zone: string;
    online: boolean;
  } | null;
}

interface CacheEntry {
  data: AgentDirectoryEntry[];
  expiresAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60_000;

export async function registerAgentDirectoryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/agents
   * Returns all ERC-8004 registered agent identities, sourced from on-chain
   * Registered events and enriched with Redis character data.
   *
   * Cached for 60 seconds — the blockchain query is the expensive part.
   */
  app.get("/api/agents", async (_req, reply) => {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      return reply.header("X-Cache", "HIT").send({ agents: cache.data, total: cache.data.length });
    }

    let identities;
    try {
      identities = await listAllRegisteredIdentities();
    } catch (err) {
      app.log.error({ err }, "[agentDirectory] Failed to fetch on-chain identities");
      return reply.code(502).send({ error: "Failed to query identity registry" });
    }

    const liveEntities = getAllEntities();
    const onlineByWallet = new Map<string, boolean>();
    for (const entity of liveEntities.values()) {
      if (entity.type === "player" && entity.walletAddress) {
        onlineByWallet.set(entity.walletAddress.toLowerCase(), true);
      }
    }

    const entries = await Promise.all(
      identities.map(async (identity): Promise<AgentDirectoryEntry> => {
        const ownerLower = identity.ownerAddress.toLowerCase();
        let character: AgentDirectoryEntry["character"] = null;

        try {
          const chars = await loadAllCharactersForWallet(ownerLower);
          // prefer the character that has this agentId set, fall back to highest-level
          const match =
            chars.find((c) => c.agentId === identity.agentId.toString()) ??
            chars.sort((a, b) => b.level - a.level)[0] ??
            null;

          if (match) {
            character = {
              name: match.name,
              classId: match.classId,
              raceId: match.raceId,
              level: match.level,
              zone: match.zone,
              online: onlineByWallet.get(ownerLower) ?? false,
            };
          }
        } catch { /* character data unavailable — identity still listed */ }

        return {
          agentId: identity.agentId.toString(),
          agentUri: identity.agentUri,
          ownerAddress: identity.ownerAddress,
          blockNumber: identity.blockNumber,
          txHash: identity.txHash,
          character,
        };
      })
    );

    cache = { data: entries, expiresAt: now + CACHE_TTL_MS };
    return reply.header("X-Cache", "MISS").send({ agents: entries, total: entries.length });
  });
}
