import "dotenv/config";
import "./config/devLocalContracts.js";
import { createServer } from "node:http";
import type { FastifyInstance } from "fastify";
import { startChainBatcher, stopChainBatcher } from "./blockchain/chainBatcher.js";
import { startWalletRegistrationWorker } from "./blockchain/wallet.js";
import { startCharacterBootstrapWorker } from "./character/characterBootstrap.js";
import { startNameServiceWorker } from "./blockchain/nameServiceChain.js";
import { startPlotOperationWorker } from "./farming/plotSystem.js";
import { startReputationChainWorker } from "./economy/reputationChain.js";
import { startChainOperationReplayWorker } from "./blockchain/chainOperationStore.js";
import { probeBiteRpc, SKALE_BASE_CHAIN_ID, SKALE_BASE_RPC_URL } from "./blockchain/biteChain.js";
import { ensureGameSchema, getGameSchemaHealth } from "./db/gameSchema.js";
import { initPostgres, isPostgresConfigured } from "./db/postgres.js";

// Ensure all registered chain-operation processors are loaded in this process.
import "./blockchain/blockchain.js";
import "./blockchain/bite.js";
import "./economy/auctionHouseChain.js";
import "./economy/guildChain.js";
import "./economy/guildVaultChain.js";
import "./economy/predictionPoolManager.js";

const WORKER_ENABLED = !["0", "false", "no", "off"].includes(
  (process.env.RUN_BLOCKCHAIN_WORKERS ?? "true").trim().toLowerCase()
);
const WORKER_HEALTH_PORT = Math.max(
  1,
  Number.parseInt(process.env.BLOCKCHAIN_WORKER_PORT ?? "3002", 10) || 3002
);

const logger = {
  info(message: string) {
    console.log(`[blockchain-worker] ${message}`);
  },
  warn(message: string) {
    console.warn(`[blockchain-worker] ${message}`);
  },
  error(err: unknown, message?: string) {
    if (message) {
      console.error(`[blockchain-worker] ${message}`, err);
      return;
    }
    console.error("[blockchain-worker] error", err);
  },
};

const onCloseHooks: Array<() => Promise<void> | void> = [];
const workerServerLike = {
  log: logger,
  addHook(name: string, hook: () => Promise<void> | void) {
    if (name === "onClose") {
      onCloseHooks.push(hook);
    }
  },
} as unknown as FastifyInstance;

let shuttingDown = false;
let workersStarted = false;
let startupError: string | null = null;

const startedAt = Date.now();
const healthServer = createServer((req, res) => {
  if ((req.url ?? "").split("?", 1)[0] !== "/health") {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }
  res.setHeader("content-type", "application/json");
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: true,
      worker: "blockchain",
      workerEnabled: WORKER_ENABLED,
      workersStarted,
      startupError,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    })
  );
});

async function assertConfiguredRpc(): Promise<void> {
  const probe = await probeBiteRpc();
  if (!probe.ok) {
    logger.warn(`RPC verification skipped due to probe failure: ${String(probe.error ?? "unknown error").slice(0, 160)}`);
    return;
  }
  if (probe.chainId !== SKALE_BASE_CHAIN_ID) {
    throw new Error(`RPC chainId mismatch: expected ${SKALE_BASE_CHAIN_ID}, got ${probe.chainId}`);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`received ${signal}; stopping blockchain worker`);
  healthServer.close();
  await Promise.allSettled(onCloseHooks.map((hook) => Promise.resolve().then(hook)));
  await stopChainBatcher().catch((err) => {
    logger.error(err, "failed to stop chain batcher cleanly");
  });
  process.exit(0);
}

async function start(): Promise<void> {
  if (!WORKER_ENABLED) {
    logger.warn("RUN_BLOCKCHAIN_WORKERS=false, worker will stay idle");
    return;
  }

  await initPostgres();
  if (isPostgresConfigured()) {
    await ensureGameSchema();
    const health = await getGameSchemaHealth().catch(() => null);
    logger.info(
      health
        ? `postgres ready (chainOps=${health.chainOperationCount}, bootstrapJobs=${health.characterBootstrapJobCount})`
        : "postgres ready"
    );
  } else {
    logger.warn("DATABASE_URL not configured; chain replay persistence is reduced");
  }

  logger.info(`RPC target ${SKALE_BASE_RPC_URL} (expected chainId=${SKALE_BASE_CHAIN_ID})`);
  await assertConfiguredRpc();
  logger.info(`verified RPC chainId=${SKALE_BASE_CHAIN_ID}`);

  startChainBatcher();
  startWalletRegistrationWorker(workerServerLike);
  await startCharacterBootstrapWorker(workerServerLike).catch((err: any) => {
    logger.warn(`character bootstrap worker failed to start: ${String(err?.message ?? err).slice(0, 140)}`);
  });
  startNameServiceWorker(logger);
  startPlotOperationWorker(logger);
  startReputationChainWorker(logger);
  startChainOperationReplayWorker(logger);
  workersStarted = true;
  logger.info("all blockchain workers started");
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("unhandledRejection", (reason) => {
  logger.error(reason, "unhandled promise rejection in blockchain worker");
});

void start().catch((err) => {
  startupError = String((err as Error)?.message ?? err);
  logger.error(err, "blockchain worker failed during startup");
  process.exit(1);
});

healthServer.listen(WORKER_HEALTH_PORT, "0.0.0.0", () => {
  logger.info(`health endpoint listening on 0.0.0.0:${WORKER_HEALTH_PORT}/health`);
});
