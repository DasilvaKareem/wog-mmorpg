import type { FastifyBaseLogger } from "fastify";
import { agentManager } from "../agents/agentManager.js";

const DEFAULT_RECONCILE_INTERVAL_MS = Math.max(
  15_000,
  Number.parseInt(process.env.AGENT_RECONCILE_INTERVAL_MS ?? "30000", 10) || 30_000
);

let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileInFlight: Promise<void> | null = null;

async function runReconcile(logger?: FastifyBaseLogger): Promise<void> {
  if (reconcileInFlight) return await reconcileInFlight;
  reconcileInFlight = agentManager.restoreEnabledAgents()
    .catch((err: any) => {
      logger?.warn?.(`[agent] Reconcile failed (non-fatal): ${String(err?.message ?? err).slice(0, 120)}`);
    })
    .finally(() => {
      reconcileInFlight = null;
    });
  await reconcileInFlight;
}

export function startAgentRuntimeReconciler(logger?: FastifyBaseLogger): void {
  if (reconcileTimer) return;
  void runReconcile(logger);
  reconcileTimer = setInterval(() => {
    void runReconcile(logger);
  }, DEFAULT_RECONCILE_INTERVAL_MS);
}

