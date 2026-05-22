/**
 * Agent Trading Rule Routes
 *
 * Per-agent limit-order rules ("auto buy under X / auto sell over Y") that the
 * agent runner executes on a passive cadence independent of focus.
 *
 *  GET    /agent/trading-rules/:wallet          → list rules + global toggle
 *  POST   /agent/trading-rules/:wallet          → upsert one rule
 *  DELETE /agent/trading-rules/:wallet/:ruleId  → remove one rule
 *  POST   /agent/trading-rules/:wallet/toggle   → enable/disable globally
 */

import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import {
  getAgentConfig,
  getTradingRules,
  upsertTradingRule,
  removeTradingRule,
  patchAgentConfig,
  createTradingRuleId,
  type TradingRule,
} from "./agentConfigStore.js";
import { getItemByTokenId } from "../items/itemCatalog.js";

const VENUES = new Set<TradingRule["venue"]>(["auction", "direct", "both"]);
const MAX_RULES_PER_AGENT = 25;
const MAX_LIST_DURATION_DAYS = 30;

function assertOwner(req: any, walletParam: string): string | null {
  const auth = (req.walletAddress as string | undefined)?.toLowerCase();
  if (!auth) return null;
  if (auth !== walletParam.toLowerCase()) return null;
  return auth;
}

export function registerAgentTradingRoutes(server: FastifyInstance): void {
  // ── GET /agent/trading-rules/:wallet ────────────────────────────────────
  server.get<{ Params: { wallet: string } }>(
    "/agent/trading-rules/:wallet",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const auth = assertOwner(request, request.params.wallet);
      if (!auth) return reply.code(403).send({ error: "Not authorized for this wallet" });
      const rules = await getTradingRules(auth);
      const cfg = await getAgentConfig(auth);
      return reply.send({
        rules,
        tradingEnabled: cfg?.tradingEnabled === true,
      });
    },
  );

  // ── POST /agent/trading-rules/:wallet ───────────────────────────────────
  server.post<{
    Params: { wallet: string };
    Body: Partial<TradingRule>;
  }>(
    "/agent/trading-rules/:wallet",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const auth = assertOwner(request, request.params.wallet);
      if (!auth) return reply.code(403).send({ error: "Not authorized for this wallet" });

      const body = request.body ?? {};
      const tokenId = Number(body.tokenId);
      if (!Number.isFinite(tokenId) || tokenId <= 0) {
        return reply.code(400).send({ error: "tokenId required and must be > 0" });
      }
      const item = getItemByTokenId(BigInt(tokenId));
      if (!item) {
        return reply.code(400).send({ error: `Unknown tokenId ${tokenId}` });
      }
      if (body.maxBuy == null && body.minSell == null) {
        return reply.code(400).send({ error: "Provide at least one of maxBuy or minSell" });
      }
      if (body.venue && !VENUES.has(body.venue)) {
        return reply.code(400).send({ error: "venue must be auction | direct | both" });
      }
      const listDuration = body.listDurationDays != null ? Number(body.listDurationDays) : 7;
      if (!Number.isFinite(listDuration) || listDuration < 1 || listDuration > MAX_LIST_DURATION_DAYS) {
        return reply.code(400).send({ error: `listDurationDays must be 1..${MAX_LIST_DURATION_DAYS}` });
      }
      if (body.maxBuy != null && (!Number.isFinite(body.maxBuy) || body.maxBuy <= 0)) {
        return reply.code(400).send({ error: "maxBuy must be > 0 gold per unit" });
      }
      if (body.minSell != null && (!Number.isFinite(body.minSell) || body.minSell <= 0)) {
        return reply.code(400).send({ error: "minSell must be > 0 gold per unit" });
      }
      if (body.budget != null && (!Number.isFinite(body.budget) || body.budget < 0)) {
        return reply.code(400).send({ error: "budget must be >= 0" });
      }

      const existing = await getTradingRules(auth);
      const isUpdate = body.id && existing.some((r) => r.id === body.id);
      if (!isUpdate && existing.length >= MAX_RULES_PER_AGENT) {
        return reply.code(400).send({
          error: `Rule limit reached (${MAX_RULES_PER_AGENT}). Delete an existing rule first.`,
        });
      }

      const rule: TradingRule = {
        id: (body.id as string) ?? createTradingRuleId(),
        tokenId,
        itemName: item.name,
        maxBuy: body.maxBuy,
        minSell: body.minSell,
        maxQty: body.maxQty,
        budget: body.budget,
        listDurationDays: listDuration,
        venue: body.venue ?? "auction",
        enabled: body.enabled !== false,
        createdAt: Date.now(),
      };
      const rules = await upsertTradingRule(auth, rule);
      return reply.send({ ok: true, rule, rules });
    },
  );

  // ── DELETE /agent/trading-rules/:wallet/:ruleId ─────────────────────────
  server.delete<{ Params: { wallet: string; ruleId: string } }>(
    "/agent/trading-rules/:wallet/:ruleId",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const auth = assertOwner(request, request.params.wallet);
      if (!auth) return reply.code(403).send({ error: "Not authorized for this wallet" });
      const rules = await removeTradingRule(auth, request.params.ruleId);
      return reply.send({ ok: true, rules });
    },
  );

  // ── POST /agent/trading-rules/:wallet/toggle ────────────────────────────
  server.post<{
    Params: { wallet: string };
    Body: { enabled: boolean };
  }>(
    "/agent/trading-rules/:wallet/toggle",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const auth = assertOwner(request, request.params.wallet);
      if (!auth) return reply.code(403).send({ error: "Not authorized for this wallet" });
      const enabled = request.body?.enabled === true;
      await patchAgentConfig(auth, { tradingEnabled: enabled });
      return reply.send({ ok: true, tradingEnabled: enabled });
    },
  );
}
