import type { FastifyInstance } from "fastify";
import {
  getChainIntent,
  getChainIntentStats,
  listChainIntents,
  listChainTxAttempts,
  type ChainIntentStatus,
} from "./chainIntentStore.js";

const ADMIN_SECRET = process.env.ADMIN_SECRET?.trim() || null;
const STALE_SUBMITTED_MS = Math.max(
  30_000,
  Number.parseInt(process.env.CHAIN_INTENT_SUBMITTED_RECOVERY_MS ?? "120000", 10) || 120_000
);

function verifyAdmin(
  request: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
): boolean {
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

function parseStatuses(raw?: string): ChainIntentStatus[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as ChainIntentStatus[];
  return values.length > 0 ? values : undefined;
}

export function registerChainAdminRoutes(server: FastifyInstance): void {
  server.get<{
    Querystring: {
      type?: string;
      wallet?: string;
      statuses?: string;
      limit?: string;
      offset?: string;
    };
  }>("/admin/chain/intents", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const intents = await listChainIntents({
      type: request.query.type,
      walletAddress: request.query.wallet,
      statuses: parseStatuses(request.query.statuses),
      limit: request.query.limit ? Number.parseInt(request.query.limit, 10) : 100,
      offset: request.query.offset ? Number.parseInt(request.query.offset, 10) : 0,
    });
    return { total: intents.length, intents };
  });

  server.get<{ Params: { intentId: string } }>("/admin/chain/intents/:intentId", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const intent = await getChainIntent(request.params.intentId);
    if (!intent) {
      return reply.code(404).send({ error: "Intent not found" });
    }
    const attempts = await listChainTxAttempts({ intentId: intent.intentId, limit: 50, offset: 0 });
    return { intent, attempts };
  });

  server.get<{
    Querystring: { intentId?: string; limit?: string; offset?: string };
  }>("/admin/chain/attempts", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const attempts = await listChainTxAttempts({
      intentId: request.query.intentId,
      limit: request.query.limit ? Number.parseInt(request.query.limit, 10) : 100,
      offset: request.query.offset ? Number.parseInt(request.query.offset, 10) : 0,
    });
    return { total: attempts.length, attempts };
  });

  server.get("/admin/chain/status", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const stats = await getChainIntentStats();
    const waitingFunds = await listChainIntents({ statuses: ["waiting_funds"], limit: 200, offset: 0 });
    const permanentFailures = await listChainIntents({ statuses: ["failed_permanent"], limit: 200, offset: 0 });
    const submitted = await listChainIntents({ statuses: ["submitted"], limit: 500, offset: 0 });
    const staleSubmitted = submitted.filter((intent) => {
      const submittedAt = intent.lastSubmittedAt ?? intent.updatedAt;
      return submittedAt <= (Date.now() - STALE_SUBMITTED_MS);
    });
    const recentAttempts = await listChainTxAttempts({ limit: 50, offset: 0 });

    return {
      stats,
      counts: {
        waitingFunds: waitingFunds.length,
        failedPermanent: permanentFailures.length,
        submitted: submitted.length,
        staleSubmitted: staleSubmitted.length,
      },
      waitingFunds,
      failedPermanent: permanentFailures,
      staleSubmitted,
      recentAttempts,
    };
  });
}
