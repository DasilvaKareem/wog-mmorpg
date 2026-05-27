import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import MessageValidator from "sns-validator";
import { authenticateRequest } from "../auth/auth.js";
import { getRedis } from "../redis.js";
import {
  getSessionBalance,
  initTopUp,
  collectPendingAuthorizations,
  markSettled,
  getSpendBreakdown,
  ACTION_COSTS_USDC,
} from "./sessionBudget.js";
import {
  getSellerBalance,
  submitAuthorizationsForSettlement,
  CIRCLE_GATEWAY_WALLET_CONTRACT,
  CIRCLE_SELLER_ADDRESS,
  DEFAULT_SESSION_BUDGET_USDC,
} from "./circleGateway.js";

const ADMIN_SECRET       = process.env.ADMIN_SECRET?.trim() || null;
const CIRCLE_SNS_TOPIC_ARN = process.env.CIRCLE_SNS_TOPIC_ARN?.trim() || null;

const snsValidator = new MessageValidator();

function snsValidate(envelope: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    snsValidator.validate(envelope, (err) => (err ? reject(err) : resolve()));
  });
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!ADMIN_SECRET) {
    reply.code(503).send({ error: "Admin route disabled: ADMIN_SECRET is not configured" });
    return false;
  }
  const secret = request.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export function registerNanopaymentRoutes(server: FastifyInstance): void {
  // ── GET /nanopay/status/:wallet ─────────────────────────────────────────────
  server.get<{ Params: { wallet: string } }>(
    "/nanopay/status/:wallet",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = (request as any).walletAddress as string;
      const { wallet } = request.params;
      if (wallet.toLowerCase() !== authWallet.toLowerCase()) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const balance = await getSessionBalance(wallet);
      return reply.send(balance);
    },
  );

  // ── GET /nanopay/breakdown/:wallet ──────────────────────────────────────────
  server.get<{ Params: { wallet: string } }>(
    "/nanopay/breakdown/:wallet",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const authWallet = (request as any).walletAddress as string;
      const { wallet } = request.params;
      if (wallet.toLowerCase() !== authWallet.toLowerCase()) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      return reply.send(await getSpendBreakdown(wallet));
    },
  );

  // ── GET /nanopay/gateway-info ────────────────────────────────────────────────
  // Public — clients use this to know where to deposit USDC and the pricing table.
  server.get("/nanopay/gateway-info", async (_req, reply) => {
    return reply.send({
      gatewayWalletContract: CIRCLE_GATEWAY_WALLET_CONTRACT,
      sellerAddress: CIRCLE_SELLER_ADDRESS,
      defaultSessionBudgetUsdc: DEFAULT_SESSION_BUDGET_USDC,
      freeStarterUsdc: 0.05,
      pricing: ACTION_COSTS_USDC,
      pricingLabel: {
        combat:     "Per combat / gathering tick",
        gather:     "Per combat / gathering tick",
        supervisor: "Per AI decision (supervisor LLM call)",
        chat:       "Per chat message with your agent",
        idle:       "Free (no activity)",
      },
    });
  });

  // ── POST /nanopay/settle ────────────────────────────────────────────────────
  // Admin-only manual trigger. The in-process cron (server.ts) is the normal driver.
  // Dormant while the non-custodial client-signed top-up path is disabled —
  // collectPendingAuthorizations() will return [] until that flow is reintroduced.
  server.post("/nanopay/settle", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const pending = await collectPendingAuthorizations();
    if (!pending.length) return reply.send({ settled: 0, settlementId: null });

    const settlementId = await submitAuthorizationsForSettlement(pending);
    if (settlementId) {
      await markSettled(pending.map((p) => p.wallet));
    }

    return reply.send({ settled: pending.length, settlementId: settlementId ?? null });
  });

  // ── GET /nanopay/balance/seller ─────────────────────────────────────────────
  server.get("/nanopay/balance/seller", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const usdc = await getSellerBalance();
    return reply.send({ usdc });
  });

  // ── POST /webhooks/circle ───────────────────────────────────────────────────
  // Circle delivers via AWS SNS. SNS first sends a SubscriptionConfirmation,
  // then wraps every Circle notification inside an SNS Notification envelope.
  //
  // Every envelope is verified against the AWS SNS signing-cert chain before
  // any branching. We also require the envelope's TopicArn to match the
  // configured CIRCLE_SNS_TOPIC_ARN — this blocks attackers who legitimately
  // publish to their own SNS topic.
  server.post<{ Body: any }>("/webhooks/circle", async (request, reply) => {
    if (!CIRCLE_SNS_TOPIC_ARN) {
      console.error("[nanopay:webhook] CIRCLE_SNS_TOPIC_ARN not configured — refusing webhook");
      return reply.code(503).send({ error: "Webhook not configured" });
    }

    const snsType  = (request.headers["x-amz-sns-message-type"] ?? "") as string;
    const envelope = (request.body ?? {}) as Record<string, unknown>;

    try {
      await snsValidate(envelope);
    } catch (err: any) {
      console.warn("[nanopay:webhook] SNS signature validation failed:", err.message);
      return reply.code(401).send({ error: "Invalid SNS signature" });
    }

    if (envelope.TopicArn !== CIRCLE_SNS_TOPIC_ARN) {
      console.warn(`[nanopay:webhook] Rejecting TopicArn ${envelope.TopicArn as string}`);
      return reply.code(401).send({ error: "Unrecognized TopicArn" });
    }

    // ── Step 1: confirm the SNS subscription ──────────────────────────────────
    if (snsType === "SubscriptionConfirmation") {
      const subscribeUrl = envelope.SubscribeURL as string;
      if (subscribeUrl?.startsWith("https://sns.")) {
        try {
          await fetch(subscribeUrl);
          console.log("[nanopay:webhook] SNS subscription confirmed");
        } catch (e: any) {
          console.error("[nanopay:webhook] SNS confirm failed:", e.message);
        }
      }
      return reply.send({ ok: true });
    }

    // ── Step 2: unwrap SNS Notification → Circle payload ─────────────────────
    let payload: any;
    if (snsType === "Notification") {
      try { payload = JSON.parse(envelope.Message as string); } catch { payload = envelope; }
    } else {
      payload = envelope;
    }

    const notifType = (payload?.notificationType ?? "") as string;
    const transfer  = payload?.notification ?? {};

    // Only care about confirmed inbound transfers to our seller wallet
    if (
      notifType !== "transfers" ||
      transfer.transactionType !== "INBOUND" ||
      transfer.state          !== "CONFIRMED" ||
      transfer.walletId       !== process.env.CIRCLE_SELLER_WALLET_ID
    ) {
      return reply.send({ ok: true, ignored: true });
    }

    // Deduplicate — SNS retries on timeout
    const redis     = getRedis();
    const dedupeKey = `nanopay:circle:processed:${transfer.id as string}`;
    const isNew     = await redis.set(dedupeKey, "1", "EX", 86400 * 7, "NX");
    if (isNew !== "OK") return reply.send({ ok: true, duplicate: true });

    const senderAddress: string = (transfer.sourceAddress ?? "").toLowerCase();
    const amount                = parseFloat(transfer.amounts?.[0] ?? "0");
    if (!senderAddress || amount <= 0) {
      return reply.send({ ok: true, skipped: "missing sender or zero amount" });
    }

    await initTopUp(senderAddress, `circle:${transfer.id as string}`, amount);
    console.log(`[nanopay:webhook] +${amount} USDC → ${senderAddress}  tx=${transfer.txHash as string}`);

    return reply.send({ ok: true, credited: amount, wallet: senderAddress });
  });
}

// Called from the settlement cron (every 5 min)
export async function runSettlementBatch(): Promise<void> {
  const pending = await collectPendingAuthorizations();
  if (!pending.length) return;

  const settlementId = await submitAuthorizationsForSettlement(pending);
  if (settlementId) {
    await markSettled(pending.map((p) => p.wallet));
    console.log(`[nanopay] Settled ${pending.length} authorization(s) — id=${settlementId}`);
  }
}
