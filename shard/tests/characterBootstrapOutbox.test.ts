import Redis from "ioredis";
import { ethers } from "ethers";

process.env.CHARACTER_BOOTSTRAP_MAX_RETRIES ??= "2";

type JsonResult = { status: number; body: any };

const SHARD_URL = process.env.SHARD_URL || "http://127.0.0.1:3000";
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

const redis = new Redis(REDIS_URL);
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
  if (!condition) {
    throw new Error(message);
  }
}

async function json(method: string, pathName: string, body?: unknown, token?: string): Promise<JsonResult> {
  const response = await fetch(`${SHARD_URL}${pathName}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep text response
  }
  return { status: response.status, body: parsed };
}

function characterKey(walletAddress: string, characterName: string): string {
  return `character:${walletAddress.toLowerCase()}:${characterName}`;
}

function bootstrapKey(walletAddress: string, characterName: string): string {
  return `character:bootstrap:${walletAddress.toLowerCase()}:${characterName}`;
}

function bootstrapId(walletAddress: string, characterName: string): string {
  return `${walletAddress.toLowerCase()}:${characterName}`;
}

async function poll<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 30_000, intervalMs = 1_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value != null) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const {
    processPendingCharacterBootstraps,
    markCharacterBootstrapRetryableFailure,
    getCharacterBootstrapMaxRetries,
  } = await import("../src/character/characterBootstrap.js");
  const wallet = ethers.Wallet.createRandom();
  const walletAddress = await wallet.getAddress();
  const characterName = `Outbox${Math.random().toString(36).slice(2, 8)}`;

  console.log("\n── Auth + Wallet ──");
  const challenge = await json("GET", `/auth/challenge?wallet=${walletAddress}`);
  requireOk(challenge.status === 200, `challenge failed: ${JSON.stringify(challenge.body)}`);
  const signature = await wallet.signMessage(String(challenge.body.message));
  const verify = await json("POST", "/auth/verify", {
    walletAddress,
    signature,
    timestamp: challenge.body.timestamp,
  });
  requireOk(verify.status === 200 && verify.body?.token, `verify failed: ${JSON.stringify(verify.body)}`);
  const token = String(verify.body.token);
  await json("POST", "/wallet/register", { walletAddress }, token);
  assert(true, "wallet registration completed");

  console.log("\n── Initial Bootstrap ──");
  const create = await json("POST", "/character/create", {
    walletAddress,
    name: characterName,
    race: "human",
    className: "warrior",
  }, token);
  requireOk(create.status === 200 && create.body?.ok === true, `character create failed: ${JSON.stringify(create.body)}`);
  assert(create.body?.bootstrap?.sourceOfTruth === "blockchain-eventual", "create response exposes blockchain eventual source of truth", create.body);

  const initialCharacter = await poll("initial character bootstrap", async () => {
    const raw = await redis.hgetall(characterKey(walletAddress, characterName));
    if (!raw.characterTokenId || !raw.agentId) return null;
    return raw;
  });
  const initialBootstrap = await poll("initial completed bootstrap job", async () => {
    const raw = await redis.hgetall(bootstrapKey(walletAddress, characterName));
    return raw.status === "completed" ? raw : null;
  });

  const originalTokenId = initialCharacter.characterTokenId;
  const originalAgentId = initialCharacter.agentId;
  assert(Boolean(originalTokenId), "characterTokenId persisted after bootstrap", initialCharacter);
  assert(Boolean(originalAgentId), "agentId persisted after bootstrap", initialCharacter);
  assert(initialCharacter.chainRegistrationStatus === "registered", "character save is marked registered after bootstrap", initialCharacter);
  assert(initialBootstrap.status === "completed", "bootstrap job reaches completed state", initialBootstrap);

  console.log("\n── Recovery: Lost Chain Fields In Redis ──");
  await redis.hdel(characterKey(walletAddress, characterName), "characterTokenId", "agentId");
  await redis.hset(bootstrapKey(walletAddress, characterName), {
    status: "failed_retryable",
    nextAttemptAt: "0",
    updatedAt: String(Date.now()),
    lastError: "simulated redis write miss",
  });
  await redis.zadd("character:bootstrap:pending", 0, bootstrapId(walletAddress, characterName));

  await processPendingCharacterBootstraps();

  const recoveredCharacter = await poll("recovered chain-backed fields", async () => {
    const raw = await redis.hgetall(characterKey(walletAddress, characterName));
    if (!raw.characterTokenId || !raw.agentId) return null;
    return raw;
  });
  assert(recoveredCharacter.characterTokenId === originalTokenId, "worker recovers existing tokenId from chain without remint", recoveredCharacter);
  assert(recoveredCharacter.agentId === originalAgentId, "worker recovers existing agentId from chain without duplicate identity", recoveredCharacter);
  assert(recoveredCharacter.chainRegistrationStatus === "registered", "recovered character returns to registered state", recoveredCharacter);

  console.log("\n── Recovery: Lost AgentId Only ──");
  await redis.hdel(characterKey(walletAddress, characterName), "agentId");
  await redis.hset(bootstrapKey(walletAddress, characterName), {
    status: "failed_retryable",
    nextAttemptAt: "0",
    updatedAt: String(Date.now()),
    lastError: "simulated missing agent id",
  });
  await redis.zadd("character:bootstrap:pending", 0, bootstrapId(walletAddress, characterName));

  await processPendingCharacterBootstraps();

  const recoveredAgentOnly = await poll("agentId-only recovery", async () => {
    const raw = await redis.hgetall(characterKey(walletAddress, characterName));
    if (!raw.agentId) return null;
    return raw;
  });
  const finalBootstrap = await redis.hgetall(bootstrapKey(walletAddress, characterName));
  const pendingMembership = await redis.zscore("character:bootstrap:pending", bootstrapId(walletAddress, characterName));

  assert(recoveredAgentOnly.agentId === originalAgentId, "worker restores missing agentId from on-chain identity metadata", recoveredAgentOnly);
  assert(finalBootstrap.status === "completed", "bootstrap job returns to completed after recovery", finalBootstrap);
  assert(!finalBootstrap.lastError, "completed bootstrap job clears stale lastError", finalBootstrap);
  assert(pendingMembership === null, "completed bootstrap job is removed from pending index");
  assert(recoveredAgentOnly.chainRegistrationStatus === "registered", "agent-only recovery restores registered marker", recoveredAgentOnly);

  console.log("\n── Retry Cap ──");
  const cappedWallet = ethers.Wallet.createRandom();
  const cappedWalletAddress = await cappedWallet.getAddress();
  const cappedCharacterName = `Outbox${Math.random().toString(36).slice(2, 8)}`;

  const cappedChallenge = await json("GET", `/auth/challenge?wallet=${cappedWalletAddress}`);
  requireOk(cappedChallenge.status === 200, `challenge failed: ${JSON.stringify(cappedChallenge.body)}`);
  const cappedSignature = await cappedWallet.signMessage(String(cappedChallenge.body.message));
  const cappedVerify = await json("POST", "/auth/verify", {
    walletAddress: cappedWalletAddress,
    signature: cappedSignature,
    timestamp: cappedChallenge.body.timestamp,
  });
  requireOk(cappedVerify.status === 200 && cappedVerify.body?.token, `verify failed: ${JSON.stringify(cappedVerify.body)}`);
  const cappedToken = String(cappedVerify.body.token);
  await json("POST", "/wallet/register", { walletAddress: cappedWalletAddress }, cappedToken);

  const cappedCreate = await json("POST", "/character/create", {
    walletAddress: cappedWalletAddress,
    name: cappedCharacterName,
    race: "human",
    className: "warrior",
  }, cappedToken);
  requireOk(cappedCreate.status === 200 && cappedCreate.body?.ok === true, `character create failed: ${JSON.stringify(cappedCreate.body)}`);

  await poll("capped bootstrap completion", async () => {
    const raw = await redis.hgetall(characterKey(cappedWalletAddress, cappedCharacterName));
    if (!raw.characterTokenId || !raw.agentId) return null;
    return raw;
  });

  await redis.hdel(characterKey(cappedWalletAddress, cappedCharacterName), "agentId");
  await redis.hset(bootstrapKey(cappedWalletAddress, cappedCharacterName), {
    status: "failed_retryable",
    attemptCount: String(Math.max(0, getCharacterBootstrapMaxRetries() - 1)),
    nextAttemptAt: "0",
    updatedAt: String(Date.now()),
    lastError: "simulated repeated failure",
  });
  await redis.zadd("character:bootstrap:pending", 0, bootstrapId(cappedWalletAddress, cappedCharacterName));
  await markCharacterBootstrapRetryableFailure(
    cappedWalletAddress,
    cappedCharacterName,
    new Error("simulated repeated failure")
  );

  const cappedCharacter = await redis.hgetall(characterKey(cappedWalletAddress, cappedCharacterName));
  const cappedBootstrap = await redis.hgetall(bootstrapKey(cappedWalletAddress, cappedCharacterName));
  const cappedPendingMembership = await redis.zscore("character:bootstrap:pending", bootstrapId(cappedWalletAddress, cappedCharacterName));

  assert(cappedBootstrap.status === "failed_permanent", "bootstrap stops retrying after max retries", cappedBootstrap);
  assert(
    cappedBootstrap.attemptCount === String(getCharacterBootstrapMaxRetries()),
    "bootstrap records the capped retry attempt count",
    cappedBootstrap
  );
  assert(cappedPendingMembership === null, "capped bootstrap is removed from pending retries", cappedBootstrap);
  assert(cappedCharacter.chainRegistrationStatus === "failed_permanent", "character save is marked failed_permanent after retry cap", cappedCharacter);
  assert(!cappedCharacter.agentId, "character save remains unregistered when retry cap is hit", cappedCharacter);

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
