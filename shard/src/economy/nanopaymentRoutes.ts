import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
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
