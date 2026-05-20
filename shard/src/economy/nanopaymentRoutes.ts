import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getRedis } from "../redis.js";
import {
  getSessionBalance,
  initTopUp,
  collectPendingAuthorizations,
  markSettled,
  ACTION_COSTS_USDC,
} from "./sessionBudget.js";
import {
  getSellerBalance,
  submitAuthorizationsForSettlement,
  verifyEIP3009Auth,
  CIRCLE_GATEWAY_WALLET_CONTRACT,
  CIRCLE_SELLER_ADDRESS,
  DEFAULT_SESSION_BUDGET_USDC,
} from "./circleGateway.js";

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

  // ── POST /nanopay/topup ─────────────────────────────────────────────────────
  // signedAuth is optional — custodial wallets top up without a client signature;
  // the server generates the EIP-3009 auth internally when Circle is configured.
  server.post<{
    Body: { budgetUsdc?: number; signedAuth?: string };
  }>(
    "/nanopay/topup",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const wallet = (request as any).walletAddress as string;
      const { budgetUsdc = DEFAULT_SESSION_BUDGET_USDC, signedAuth } = request.body;

      if (budgetUsdc <= 0 || budgetUsdc > 100) {
        return reply.code(400).send({ error: "budgetUsdc must be between 0 and 100" });
      }

      // If a signed auth is provided, verify it (non-custodial / Circle flow).
      // Without one, credits are added directly (custodial mode — server holds key).
      if (signedAuth) {
        const valid = await verifyEIP3009Auth(signedAuth, budgetUsdc, wallet);
        if (!valid) {
          return reply.code(400).send({ error: "Invalid payment authorization signature" });
        }
        await initTopUp(wallet, signedAuth, budgetUsdc);
      } else {
        // Custodial top-up: add credits directly, no Circle auth stored yet.
        // When Circle settlement is wired, the server will sign on behalf of the custodial key.
        await initTopUp(wallet, "custodial", budgetUsdc);
      }

      const balance = await getSessionBalance(wallet);
      return reply.send({ ok: true, balance });
    },
  );

  // ── POST /nanopay/settle ────────────────────────────────────────────────────
  // Called by the background cron every 5 min, or manually by admin.
  server.post("/nanopay/settle", async (_req, reply) => {
    const pending = await collectPendingAuthorizations();
    if (!pending.length) return reply.send({ settled: 0, settlementId: null });

    const settlementId = await submitAuthorizationsForSettlement(pending);
    if (settlementId) {
      await markSettled(pending.map((p) => p.wallet));
    }

    return reply.send({ settled: pending.length, settlementId: settlementId ?? null });
  });

  // ── GET /nanopay/balance/seller ─────────────────────────────────────────────
  server.get("/nanopay/balance/seller", async (_req, reply) => {
    const usdc = await getSellerBalance();
    return reply.send({ usdc });
  });

  // ── POST /webhooks/circle ───────────────────────────────────────────────────
  // Circle delivers via AWS SNS. SNS first sends a SubscriptionConfirmation,
  // then wraps every Circle notification inside an SNS Notification envelope.
  server.post<{ Body: any }>("/webhooks/circle", async (request, reply) => {
    const snsType = (request.headers["x-amz-sns-message-type"] ?? "") as string;
    const body    = request.body ?? {};

    // ── Step 1: confirm the SNS subscription ──────────────────────────────────
    if (snsType === "SubscriptionConfirmation") {
      const subscribeUrl = body.SubscribeURL as string;
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
      try { payload = JSON.parse(body.Message as string); } catch { payload = body; }
    } else {
      payload = body; // direct delivery (non-SNS path)
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
    const isNew     = await redis.set(dedupeKey, "1", { NX: true, EX: 86400 * 7 });
    if (!isNew) return reply.send({ ok: true, duplicate: true });

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
