/**
 * Public blockchain & game stats — for fundraising, dashboards, and social proof.
 * GET /stats  →  no auth required, cached 60s
 */

import type { FastifyInstance } from "fastify";
import { getTxStats } from "../blockchain/blockchain.js";
import { getRedis } from "../redis.js";
import { getAllZones, getAllEntities } from "../world/zoneRuntime.js";
import { agentManager } from "../agents/agentManager.js";
import { readContract, getContract } from "thirdweb";
import { thirdwebClient, skaleBase } from "../blockchain/chain.js";
import { ethers } from "ethers";

// ── Config ─────────────────────────────────────────────────────────────────

const EXPLORER_BASE = "https://skale-base-explorer.skalenodes.com/api/v2";

function deriveServerWallet(): string | null {
  if (process.env.SERVER_WALLET_ADDRESS) return process.env.SERVER_WALLET_ADDRESS;
  try {
    return new ethers.Wallet(process.env.SERVER_PRIVATE_KEY!).address;
  } catch {
    return null;
  }
}
const SERVER_WALLET = deriveServerWallet();

const GOLD_ADDR    = process.env.GOLD_CONTRACT_ADDRESS!;
const CHAR_ADDR    = process.env.CHARACTER_CONTRACT_ADDRESS!;
const ITEMS_ADDR   = process.env.ITEMS_CONTRACT_ADDRESS!;

// Cache results 60 seconds so we don't hammer the explorer/RPC on every request
let cache: { data: StatsPayload; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

interface StatsPayload {
  game: {
    activePlayers: number;
    activeAgents: number;
    activeZones: number;
    registeredPlayers: number;
  };
  onChain: {
    lifetimeTransactions: number;
    sessionTransactions: number;
    charactersMinted: number;
    goldSupply: string;
    txBreakdown: {
      goldMints: number;
      goldTransfers: number;
      itemMints: number;
      characterMints: number;
      sfuelDistributions: number;
    };
  };
  meta: {
    chain: string;
    chainId: number;
    explorerUrl: string;
    cachedAt: string;
  };
}

// ── Data fetchers ──────────────────────────────────────────────────────────

async function fetchLifetimeTxCount(): Promise<number> {
  if (!SERVER_WALLET) return 0;
  try {
    const res = await fetch(`${EXPLORER_BASE}/addresses/${SERVER_WALLET}/counters`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return 0;
    const json = await res.json() as { transactions_count?: string };
    return parseInt(json.transactions_count ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

async function fetchCharactersMinted(): Promise<number> {
  if (!CHAR_ADDR) return 0;
  try {
    const contract = getContract({ client: thirdwebClient, chain: skaleBase, address: CHAR_ADDR });
    const supply = await readContract({ contract, method: "function totalSupply() view returns (uint256)", params: [] });
    return Number(supply);
  } catch {
    return 0;
  }
}

async function fetchGoldSupply(): Promise<string> {
  if (!GOLD_ADDR) return "0";
  try {
    const contract = getContract({ client: thirdwebClient, chain: skaleBase, address: GOLD_ADDR });
    const raw = await readContract({ contract, method: "function totalSupply() view returns (uint256)", params: [] });
    // ERC-20 with 18 decimals — format to whole tokens
    const whole = Number(BigInt(raw as bigint) / BigInt(1e18));
    return whole.toLocaleString("en-US");
  } catch {
    return "0";
  }
}

async function fetchRegisteredPlayers(): Promise<number> {
  try {
    const redis = getRedis();
    if (!redis) return 0;
    const keys = await redis.keys("wallet:registered:*");
    return keys.length;
  } catch {
    return 0;
  }
}

// ── Route ──────────────────────────────────────────────────────────────────

export async function registerStatsRoutes(server: FastifyInstance): Promise<void> {
  server.get("/stats", async (_req, reply) => {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      return reply.header("X-Cache", "HIT").send(cache.data);
    }

    const [lifetimeTx, charactersMinted, goldSupply, registeredPlayers] = await Promise.all([
      fetchLifetimeTxCount(),
      fetchCharactersMinted(),
      fetchGoldSupply(),
      fetchRegisteredPlayers(),
    ]);

    const txStats = getTxStats();
    const zones = getAllZones();
    const entities = getAllEntities();
    const activePlayers = Array.from(entities.values()).filter(e => e.type === "player").length;
    const activeAgents = agentManager.listRunning().length;

    const data: StatsPayload = {
      game: {
        activePlayers,
        activeAgents,
        activeZones: zones.size,
        registeredPlayers,
      },
      onChain: {
        lifetimeTransactions: lifetimeTx,
        sessionTransactions: txStats.total,
        charactersMinted,
        goldSupply,
        txBreakdown: {
          goldMints: txStats.goldMints,
          goldTransfers: txStats.goldTransfers,
          itemMints: txStats.itemMints,
          characterMints: txStats.characterMints,
          sfuelDistributions: txStats.sfuelDistributions,
        },
      },
      meta: {
        chain: "SKALE Base",
        chainId: Number(process.env.SKALE_BASE_CHAIN_ID ?? 1187947933),
        explorerUrl: `https://skale-base-explorer.skalenodes.com/address/${SERVER_WALLET}`,
        cachedAt: new Date().toISOString(),
      },
    };

    cache = { data, expiresAt: now + CACHE_TTL_MS };
    reply.header("X-Cache", "MISS").send(data);
  });
}
