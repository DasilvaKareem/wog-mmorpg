/**
 * Gold Purchase Routes — buy gold packs with crypto (USDC on Base via thirdweb Pay)
 *
 * GET  /gold/packs             — list available packs
 * POST /gold/purchase          — initiate a gold pack purchase (auth required)
 * POST /gold/purchase/confirm  — confirm payment and mint gold (auth required)
 */

import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { mintGold } from "../blockchain/blockchain.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { getRedis } from "../redis.js";
import { randomUUID } from "crypto";

// ── Gold pack definitions ────────────────────────────────────────────────────

interface GoldPack {
  id: string;
  name: string;
  goldAmount: number;      // gold in copper (1 gold = 10,000 copper)
  priceUsd: number;        // price in USD
  /** USDC amount in base units (6 decimals). */
  priceUsdc: string;
}

const GOLD_PACKS: GoldPack[] = [
  { id: "pack-500",   name: "500 Gold",   goldAmount: 500,   priceUsd: 5,  priceUsdc: "5000000" },
  { id: "pack-1500",  name: "1,500 Gold", goldAmount: 1500,  priceUsd: 12, priceUsdc: "12000000" },
  { id: "pack-5000",  name: "5,000 Gold", goldAmount: 5000,  priceUsd: 35, priceUsdc: "35000000" },
];

/** Base chain ID for USDC payments */
const BASE_CHAIN_ID = 8453;
/** USDC contract on Base */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ── Pending payment Redis helpers ────────────────────────────────────────────

interface PendingPayment {
  paymentId: string;
  wallet: string;
  packId: string;
  goldAmount: number;
  priceUsdc: string;
  createdAt: number;
}

function pendingKey(paymentId: string) { return `gold:pending:${paymentId}`; }

async function storePending(p: PendingPayment): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis unavailable");
  // TTL 30 minutes — payment must be confirmed within that window
  await redis.set(pendingKey(p.paymentId), JSON.stringify(p), "EX", 1800);
}

async function getPending(paymentId: string): Promise<PendingPayment | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(pendingKey(paymentId));
  return raw ? (JSON.parse(raw) as PendingPayment) : null;
}

async function deletePending(paymentId: string): Promise<void> {
  const redis = getRedis();
  if (redis) await redis.del(pendingKey(paymentId));
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerGoldPurchaseRoutes(server: FastifyInstance): void {
  /**
   * GET /gold/packs — list available gold packs
   */
  server.get("/gold/packs", async () => {
    return {
      packs: GOLD_PACKS.map((p) => ({
        id: p.id,
        name: p.name,
        goldAmount: p.goldAmount,
        priceUsd: p.priceUsd,
        priceUsdc: p.priceUsdc,
        chainId: BASE_CHAIN_ID,
        currency: USDC_BASE,
      })),
    };
  });

  /**
   * POST /gold/purchase — initiate a gold pack purchase
   * Returns payment info for the client to invoke thirdweb Pay widget.
   */
  server.post<{
    Body: { packId: string };
  }>("/gold/purchase", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const wallet = (request as any).walletAddress as string;
    const { packId } = request.body;

    const pack = GOLD_PACKS.find((p) => p.id === packId);
    if (!pack) {
      return reply.code(400).send({ error: `Unknown pack: ${packId}` });
    }

    // Resolve the recipient — the user's custodial wallet (where gold will be minted)
    const custodial = await getAgentCustodialWallet(wallet);
    if (!custodial) {
      return reply.code(400).send({ error: "No custodial wallet found. Deploy an agent first." });
    }

    const paymentId = randomUUID();
    const pending: PendingPayment = {
      paymentId,
      wallet: wallet.toLowerCase(),
      packId,
      goldAmount: pack.goldAmount,
      priceUsdc: pack.priceUsdc,
      createdAt: Date.now(),
    };
    await storePending(pending);

    return reply.send({
      paymentId,
      packId: pack.id,
      packName: pack.name,
      goldAmount: pack.goldAmount,
      priceUsd: pack.priceUsd,
      payment: {
        chainId: BASE_CHAIN_ID,
        currency: USDC_BASE,
        amount: pack.priceUsdc,
        recipientWallet: custodial,
      },
    });
  });

  /**
   * POST /gold/purchase/confirm — confirm payment and mint gold
   * TODO: On-chain verification of USDC transfer (for now, trust-based).
   */
  server.post<{
    Body: { paymentId: string; transactionHash: string };
  }>("/gold/purchase/confirm", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const wallet = (request as any).walletAddress as string;
    const { paymentId, transactionHash } = request.body;

    if (!paymentId || !transactionHash) {
      return reply.code(400).send({ error: "paymentId and transactionHash required" });
    }

    const pending = await getPending(paymentId);
    if (!pending) {
      return reply.code(404).send({ error: "Payment not found or expired" });
    }

    if (pending.wallet !== wallet.toLowerCase()) {
      return reply.code(403).send({ error: "Payment belongs to a different wallet" });
    }

    // Resolve custodial wallet for gold mint
    const custodial = await getAgentCustodialWallet(wallet);
    if (!custodial) {
      return reply.code(400).send({ error: "No custodial wallet found" });
    }

    // TODO: Verify the USDC transfer on-chain using transactionHash
    // For now, trust-based — the client sends the hash after thirdweb Pay confirms.

    try {
      const tx = await mintGold(custodial, pending.goldAmount.toString());
      server.log.info(`[gold-purchase] Minted ${pending.goldAmount} gold to ${custodial} (payment ${paymentId}, tx ${transactionHash})`);

      await deletePending(paymentId);

      return reply.send({
        ok: true,
        goldMinted: pending.goldAmount,
        mintTx: tx,
        paymentTx: transactionHash,
      });
    } catch (err: any) {
      server.log.error(`[gold-purchase] Mint failed for ${paymentId}: ${err.message}`);
      return reply.code(500).send({ error: "Gold mint failed" });
    }
  });
}
