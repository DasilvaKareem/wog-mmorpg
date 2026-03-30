import "dotenv/config";

const HARDHAT_ACCOUNT_0_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.DEV = "true";
process.env.SHARD_CHAIN_ENV = "local";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.HARDHAT_RPC_URL = "http://127.0.0.1:8545";
process.env.SKALE_BASE_RPC_URL = "http://127.0.0.1:8545";
process.env.SKALE_BASE_CHAIN_ID = "31337";
process.env.SERVER_PRIVATE_KEY = HARDHAT_ACCOUNT_0_PRIVATE_KEY;

await import("../src/config/devLocalContracts.ts");

import Redis from "ioredis";
import { ethers } from "ethers";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

type LoggerLike = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type ServerLike = {
  log: LoggerLike;
  addHook: (_name: string, _fn: () => Promise<void> | void) => void;
};

const redis = new Redis(REDIS_URL);
const logger: LoggerLike = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
const server: ServerLike = {
  log: logger,
  addHook: () => {},
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, details?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
    return;
  }
  console.error(`  ✗ ${label}`);
  if (details !== undefined) {
    console.error(`    ${typeof details === "string" ? details : JSON.stringify(details)}`);
  }
  failed++;
}

function requireOk(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function poll<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<T> {
  const start = Date.now();
  let lastValue: T | undefined;
  while (Date.now() - start < timeoutMs) {
    lastValue = await fn();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function walletStatusKey(wallet: string): string {
  return `wallet:registration:${wallet.toLowerCase()}`;
}

function plotKey(plotId: string): string {
  return `plot:${plotId}`;
}

function plotOwnerKey(wallet: string): string {
  return `plot:owner:${wallet.toLowerCase()}`;
}

async function clearPlotRedis(plotId: string, wallet?: string): Promise<void> {
  await redis.del(plotKey(plotId));
  if (wallet) {
    await redis.del(plotOwnerKey(wallet));
  }
}

async function writePlotRedis(plotId: string, zoneId: string, wallet: string, ownerName: string): Promise<void> {
  await redis.hset(plotKey(plotId), {
    owner: wallet.toLowerCase(),
    ownerName,
    claimedAt: String(Date.now()),
    buildingType: "",
    buildingStage: "0",
    zoneId,
  });
  await redis.set(plotOwnerKey(wallet), plotId);
}

async function main() {
  const {
    createChainOperation,
    getChainOperation,
    updateChainOperation,
  } = await import("../src/blockchain/chainOperationStore.js");
  const {
    processPendingWalletRegistrations,
  } = await import("../src/blockchain/wallet.js");
  const {
    processPendingNameOperations,
    reverseLookupOnChain,
  } = await import("../src/blockchain/nameServiceChain.js");
  const {
    getAllPlotDefs,
    getOwnedPlot,
    getPlotById,
    initializePlotsFromRedis,
    processPendingPlotOperations,
    releasePlot,
  } = await import("../src/farming/plotSystem.js");
  const {
    getReputationOnChain,
    processPendingReputationOperations,
  } = await import("../src/economy/reputationChain.js");
  const { mintCharacterWithIdentity } = await import("../src/blockchain/blockchain.js");

  console.log("\n── Chain Reconciliation Recovery ──");

  await initializePlotsFromRedis();

  console.log("\n── Wallet Recovery ──");
  const walletSuccess = ethers.Wallet.createRandom().address.toLowerCase();
  const walletSuccessOp = await createChainOperation("wallet-register", walletSuccess, { address: walletSuccess });
  await redis.hset(walletStatusKey(walletSuccess), {
    operationId: walletSuccessOp.operationId,
    status: "queued",
    updatedAt: String(Date.now()),
  });
  await processPendingWalletRegistrations(server as never);

  const walletSuccessRecord = await poll(
    "wallet success operation completion",
    async () => await getChainOperation(walletSuccessOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(walletSuccessRecord !== null, "wallet success record should exist");
  const walletSuccessStatus = await redis.hgetall(walletStatusKey(walletSuccess));
  assert(walletSuccessRecord.status === "completed", "wallet op completes after queued recovery", walletSuccessRecord);
  assert(walletSuccessStatus.status === "completed", "wallet status projection completes", walletSuccessStatus);
  assert((await redis.get(`wallet:registered:${walletSuccess}`)) === "1", "wallet registered marker is written");

  const walletFailure = "0x1234";
  const walletFailureOp = await createChainOperation("wallet-register", walletFailure, { address: walletFailure });
  await redis.hset(walletStatusKey(walletFailure), {
    operationId: walletFailureOp.operationId,
    status: "queued",
    updatedAt: String(Date.now()),
  });
  await processPendingWalletRegistrations(server as never);

  const walletFailureRecord = await poll(
    "wallet failure retryable state",
    async () => await getChainOperation(walletFailureOp.operationId),
    (value) => value?.status === "failed_retryable",
  );
  requireOk(walletFailureRecord !== null, "wallet failure record should exist");
  assert(Boolean(walletFailureRecord.lastError), "wallet failure stores retryable error", walletFailureRecord);
  assert((await redis.zscore("chainop:pending", walletFailureOp.operationId)) !== null, "wallet failure stays pending");

  const walletRetryTarget = ethers.Wallet.createRandom().address.toLowerCase();
  await updateChainOperation(walletFailureOp.operationId, {
    payload: JSON.stringify({ address: walletRetryTarget }),
    status: "queued",
    nextAttemptAt: 0,
    lastError: undefined,
  });
  await redis.hset(walletStatusKey(walletRetryTarget), {
    operationId: walletFailureOp.operationId,
    status: "queued",
    updatedAt: String(Date.now()),
  });
  await processPendingWalletRegistrations(server as never);

  const walletRecoveredRecord = await poll(
    "wallet recovered completion",
    async () => await getChainOperation(walletFailureOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(walletRecoveredRecord !== null, "wallet recovered record should exist");
  const walletRecoveredStatus = await redis.hgetall(walletStatusKey(walletRetryTarget));
  assert(walletRecoveredRecord.status === "completed", "wallet retry succeeds after payload correction", walletRecoveredRecord);
  assert(walletRecoveredStatus.status === "completed", "wallet retry updates status projection", walletRecoveredStatus);
  assert(!walletRecoveredStatus.lastError, "wallet retry clears stale status error", walletRecoveredStatus);

  console.log("\n── Name Recovery ──");
  const nameWallet = ethers.Wallet.createRandom().address;
  const nameValue = `name${Math.random().toString(36).slice(2, 8)}`;
  const nameSuccessOp = await createChainOperation("name-register", nameWallet.toLowerCase(), {
    walletAddress: nameWallet,
    name: nameValue,
  });
  await processPendingNameOperations(logger);

  const nameSuccessRecord = await poll(
    "name success operation completion",
    async () => await getChainOperation(nameSuccessOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(nameSuccessRecord !== null, "name success record should exist");
  const lookedUpName = await poll(
    "reverse lookup on-chain",
    async () => await reverseLookupOnChain(nameWallet),
    (value) => value === nameValue,
  );
  assert(nameSuccessRecord.status === "completed", "name op completes after queued recovery", nameSuccessRecord);
  assert(lookedUpName === nameValue, "name reverse lookup converges after replay", lookedUpName);

  const badNameOp = await createChainOperation("name-register", "bad-name-subject", {
    walletAddress: "0x1234",
    name: `bad${Math.random().toString(36).slice(2, 8)}`,
  });
  await processPendingNameOperations(logger);

  const badNameRecord = await poll(
    "name failure retryable state",
    async () => await getChainOperation(badNameOp.operationId),
    (value) => value?.status === "failed_retryable",
  );
  requireOk(badNameRecord !== null, "bad name record should exist");
  assert(Boolean(badNameRecord.lastError), "name failure stores retryable error", badNameRecord);
  assert((await redis.zscore("chainop:pending", badNameOp.operationId)) !== null, "name failure stays pending");

  const retryNameWallet = ethers.Wallet.createRandom().address;
  const retryName = `retry${Math.random().toString(36).slice(2, 8)}`;
  await updateChainOperation(badNameOp.operationId, {
    payload: JSON.stringify({ walletAddress: retryNameWallet, name: retryName }),
    status: "queued",
    nextAttemptAt: 0,
    lastError: undefined,
  });
  await processPendingNameOperations(logger);

  const recoveredNameRecord = await poll(
    "name retry success",
    async () => await getChainOperation(badNameOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(recoveredNameRecord !== null, "recovered name record should exist");
  const recoveredNameLookup = await poll(
    "recovered name lookup",
    async () => await reverseLookupOnChain(retryNameWallet),
    (value) => value === retryName,
  );
  assert(recoveredNameRecord.status === "completed", "name retry succeeds after payload correction", recoveredNameRecord);
  assert(recoveredNameLookup === retryName, "name retry reaches on-chain lookup", recoveredNameLookup);

  console.log("\n── Plot Recovery ──");
  await initializePlotsFromRedis();
  const freePlotDef = getAllPlotDefs().find((def) => !getPlotById(def.plotId)?.owner);
  requireOk(Boolean(freePlotDef), "expected at least one free plot");
  const plotWallet = ethers.Wallet.createRandom().address.toLowerCase();
  await clearPlotRedis(freePlotDef!.plotId, plotWallet);
  await writePlotRedis(freePlotDef!.plotId, freePlotDef!.zoneId, plotWallet, "Plot Tester");
  await initializePlotsFromRedis();

  const plotSuccessOp = await createChainOperation("plot-claim", freePlotDef!.plotId, {
    plotId: freePlotDef!.plotId,
    zoneId: freePlotDef!.zoneId,
    x: freePlotDef!.x,
    y: freePlotDef!.y,
    ownerAddress: plotWallet,
  });
  await processPendingPlotOperations(logger);

  const plotSuccessRecord = await poll(
    "plot success operation completion",
    async () => await getChainOperation(plotSuccessOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(plotSuccessRecord !== null, "plot success record should exist");
  assert(plotSuccessRecord.status === "completed", "plot queued op completes", plotSuccessRecord);
  assert(getOwnedPlot(plotWallet)?.plotId === freePlotDef!.plotId, "plot Redis projection remains owned after chain replay", getOwnedPlot(plotWallet));

  const badPlotOp = await createChainOperation("plot-claim", "bad-plot-op", {
    plotId: "missing-plot",
    zoneId: "sunflower-fields",
    x: 0,
    y: 0,
    ownerAddress: "0x1234",
  });
  await processPendingPlotOperations(logger);

  const badPlotRecord = await poll(
    "plot failure retryable state",
    async () => await getChainOperation(badPlotOp.operationId),
    (value) => value?.status === "failed_retryable",
  );
  requireOk(badPlotRecord !== null, "bad plot record should exist");
  assert(Boolean(badPlotRecord.lastError), "plot failure stores retryable error", badPlotRecord);
  assert((await redis.zscore("chainop:pending", badPlotOp.operationId)) !== null, "plot failure stays pending");

  const retryPlotDef = getAllPlotDefs().find((def) => !getPlotById(def.plotId)?.owner && def.plotId !== freePlotDef!.plotId);
  requireOk(Boolean(retryPlotDef), "expected second free plot for retry");
  const retryPlotWallet = ethers.Wallet.createRandom().address.toLowerCase();
  await clearPlotRedis(retryPlotDef!.plotId, retryPlotWallet);
  await writePlotRedis(retryPlotDef!.plotId, retryPlotDef!.zoneId, retryPlotWallet, "Retry Plot");
  await initializePlotsFromRedis();
  await updateChainOperation(badPlotOp.operationId, {
    payload: JSON.stringify({
      plotId: retryPlotDef!.plotId,
      zoneId: retryPlotDef!.zoneId,
      x: retryPlotDef!.x,
      y: retryPlotDef!.y,
      ownerAddress: retryPlotWallet,
    }),
    status: "queued",
    nextAttemptAt: 0,
    lastError: undefined,
  });
  await processPendingPlotOperations(logger);

  const recoveredPlotRecord = await poll(
    "plot retry success",
    async () => await getChainOperation(badPlotOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(recoveredPlotRecord !== null, "recovered plot record should exist");
  assert(recoveredPlotRecord.status === "completed", "plot retry succeeds after payload correction", recoveredPlotRecord);
  assert(getOwnedPlot(retryPlotWallet)?.plotId === retryPlotDef!.plotId, "plot retry keeps Redis ownership projection", getOwnedPlot(retryPlotWallet));

  releasePlot(plotWallet);
  releasePlot(retryPlotWallet);
  await processPendingPlotOperations(logger);
  await poll("plot cleanup release one", async () => getOwnedPlot(plotWallet), (value) => value === null);
  await poll("plot cleanup release two", async () => getOwnedPlot(retryPlotWallet), (value) => value === null);
  await clearPlotRedis(freePlotDef!.plotId, plotWallet);
  await clearPlotRedis(retryPlotDef!.plotId, retryPlotWallet);

  console.log("\n── Reputation Recovery ──");
  const reputationWallet = ethers.Wallet.createRandom().address;
  const minted = await mintCharacterWithIdentity(reputationWallet, {
    name: `Rep${Math.random().toString(36).slice(2, 8)} the Warrior`,
    description: "Recovery reputation test",
    properties: { race: "human", class: "warrior", level: 1, xp: 0 },
  });
  requireOk(minted.identity?.agentId != null, "expected minted identity agentId");
  const agentId = minted.identity!.agentId!.toString();

  const repSuccessOp = await createChainOperation("reputation-feedback", agentId, {
    agentId,
    deltas: [0, 3, 0, 0, 0],
    reason: "success-case",
  });
  await processPendingReputationOperations(logger);

  const repSuccessRecord = await poll(
    "reputation success completion",
    async () => await getChainOperation(repSuccessOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(repSuccessRecord !== null, "reputation success record should exist");
  const reputationSummary = await poll(
    "reputation summary after success",
    async () => await getReputationOnChain(agentId),
    (value) => value !== null,
  );
  assert(repSuccessRecord.status === "completed", "reputation op completes", repSuccessRecord);
  assert(reputationSummary !== null, "reputation summary is readable after successful replay", reputationSummary);

  const badRepOp = await createChainOperation("reputation-feedback", agentId, {
    agentId,
    deltas: ["oops", 0, 0, 0, 0],
    reason: "bad-delta",
  });
  await processPendingReputationOperations(logger);

  const badRepRecord = await poll(
    "reputation failure retryable state",
    async () => await getChainOperation(badRepOp.operationId),
    (value) => value?.status === "failed_retryable",
  );
  requireOk(badRepRecord !== null, "bad reputation record should exist");
  assert(Boolean(badRepRecord.lastError), "reputation failure stores retryable error", badRepRecord);
  assert((await redis.zscore("chainop:pending", badRepOp.operationId)) !== null, "reputation failure stays pending");

  await updateChainOperation(badRepOp.operationId, {
    payload: JSON.stringify({
      agentId,
      deltas: [2, 0, 0, 0, 0],
      reason: "retry-success",
    }),
    status: "queued",
    nextAttemptAt: 0,
    lastError: undefined,
  });
  await processPendingReputationOperations(logger);

  const recoveredRepRecord = await poll(
    "reputation retry success",
    async () => await getChainOperation(badRepOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(recoveredRepRecord !== null, "recovered reputation record should exist");
  const recoveredSummary = await poll(
    "reputation summary after retry",
    async () => await getReputationOnChain(agentId),
    (value) => value !== null,
  );
  assert(recoveredRepRecord.status === "completed", "reputation retry succeeds after payload correction", recoveredRepRecord);
  assert(recoveredSummary !== null, "reputation summary still resolves after retry completion", recoveredSummary);

  console.log("\n==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("==================================================");

  await redis.quit();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nFATAL:", err instanceof Error ? err.message : err);
  await redis.quit();
  process.exit(1);
});
