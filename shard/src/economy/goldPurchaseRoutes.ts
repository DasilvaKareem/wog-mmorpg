/**
 * Gold Purchase Routes — buy gold packs with crypto (USDC on Base via thirdweb Pay)
 *
 * GET  /gold/packs             — list available packs
 * POST /gold/purchase          — initiate a gold pack purchase (auth required)
 * POST /gold/purchase/confirm  — confirm payment and mint gold (auth required)
 */

import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { distributeSFuel, getGoldBalance, mintGold, transferGoldFrom } from "../blockchain/blockchain.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { getRedis } from "../redis.js";
import { randomUUID } from "crypto";
import { getCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import { copperToGold, formatCopperString, goldToCopper } from "../blockchain/currency.js";
import { formatGold, getAvailableGold, recordGoldSpend } from "../blockchain/goldLedger.js";
import { areFriends } from "../social/friendsSystem.js";

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

const FRIEND_TRANSFER_FEE_COPPER = 25;
const FRIEND_TRANSFER_FEE_GOLD = copperToGold(FRIEND_TRANSFER_FEE_COPPER);

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

async function transferGoldWithGasRetry(
  server: FastifyInstance,
  fromAddress: string,
  toAddress: string,
  amount: number,
): Promise<string> {
  const senderAccount = await getCustodialWallet(fromAddress);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await transferGoldFrom(senderAccount, toAddress, formatGold(amount));
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "");
      const lowGasBalance =
        msg.includes("Account balance is too low") ||
        msg.includes("insufficient funds for gas");
      if (!lowGasBalance || attempt === 2) throw err;

      try {
        await distributeSFuel(fromAddress);
        server.log.info(`[gold-transfer] Topped up sFUEL for ${fromAddress} after transfer attempt ${attempt + 1}`);
      } catch (sfuelErr: any) {
        server.log.warn(`[gold-transfer] Failed topping up sFUEL for ${fromAddress}: ${String(sfuelErr?.message ?? sfuelErr).slice(0, 150)}`);
      }
    }
  }

  throw new Error("Failed to transfer gold");
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerGoldPurchaseRoutes(server: FastifyInstance): void {
  server.get("/gold/transfer/config", async () => ({
    feeCopper: FRIEND_TRANSFER_FEE_COPPER,
    feeGold: formatGold(FRIEND_TRANSFER_FEE_GOLD),
    feeLabel: formatCopperString(FRIEND_TRANSFER_FEE_COPPER),
  }));

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

  /**
   * POST /gold/transfer — send ERC-20 gold from your custodial wallet to a friend.
   * Charges a fixed protocol fee tracked in the spend ledger.
   */
  server.post<{
    Body: { toWallet: string; amount: number };
  }>("/gold/transfer", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const ownerWallet = (request as any).walletAddress as string;
    const { toWallet, amount } = request.body;

    if (!toWallet || !/^0x[a-fA-F0-9]{40}$/.test(toWallet)) {
      return reply.code(400).send({ error: "Invalid recipient wallet" });
    }

    const senderCustodial = await getAgentCustodialWallet(ownerWallet);
    if (!senderCustodial) {
      return reply.code(400).send({ error: "No custodial wallet found. Deploy an agent first." });
    }

    if (senderCustodial.toLowerCase() === toWallet.toLowerCase()) {
      return reply.code(400).send({ error: "Cannot transfer gold to yourself" });
    }

    if (!(await areFriends(senderCustodial, toWallet))) {
      return reply.code(403).send({ error: "Can only send gold to friends" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ error: "Transfer amount must be greater than zero" });
    }

    const transferCopper = goldToCopper(amount);
    if (transferCopper <= 0) {
      return reply.code(400).send({ error: "Transfer amount must be at least 1 copper" });
    }
    const normalizedAmount = copperToGold(transferCopper);
    const totalCharge = normalizedAmount + FRIEND_TRANSFER_FEE_GOLD;

    try {
      const onChainGold = parseFloat(await getGoldBalance(senderCustodial));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = getAvailableGold(senderCustodial, safeOnChainGold);

      if (availableGold < totalCharge) {
        return reply.code(400).send({
          error: "Insufficient gold",
          available: formatGold(availableGold),
          required: formatGold(totalCharge),
          breakdown: {
            transfer: formatGold(normalizedAmount),
            fee: formatGold(FRIEND_TRANSFER_FEE_GOLD),
            total: formatGold(totalCharge),
          },
        });
      }

      const txHash = await transferGoldWithGasRetry(server, senderCustodial, toWallet, normalizedAmount);
      recordGoldSpend(senderCustodial, FRIEND_TRANSFER_FEE_GOLD);

      server.log.info(
        `[gold-transfer] ${senderCustodial} sent ${formatGold(normalizedAmount)} GOLD to ${toWallet} (fee ${formatGold(FRIEND_TRANSFER_FEE_GOLD)}) tx=${txHash}`,
      );

      return reply.send({
        ok: true,
        txHash,
        fromWallet: senderCustodial,
        toWallet: toWallet.toLowerCase(),
        amount: formatGold(normalizedAmount),
        fee: formatGold(FRIEND_TRANSFER_FEE_GOLD),
        feeLabel: formatCopperString(FRIEND_TRANSFER_FEE_COPPER),
        total: formatGold(totalCharge),
        remainingGold: formatGold(Math.max(0, availableGold - totalCharge)),
      });
    } catch (err: any) {
      server.log.error(`[gold-transfer] Failed ${senderCustodial} -> ${toWallet}: ${String(err?.message ?? err).slice(0, 150)}`);
      return reply.code(500).send({ error: "Gold transfer failed" });
    }
  });
}
