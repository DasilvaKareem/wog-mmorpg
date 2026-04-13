import type { FastifyInstance } from "fastify";
import { distributeSFuel, enqueueGoldTransferFrom, getGoldBalance, getItemBalance, getOnChainGoldBalance, getOnChainItemBalance, mintGold, transferGoldFrom } from "./blockchain.js";
import { biteProvider } from "./biteChain.js";
import { formatGold, getAvailableGoldAsync, getSpentGoldAsync } from "./goldLedger.js";
import { ITEM_CATALOG, getItemRarity } from "../items/itemCatalog.js";
import { goldToCopper, copperToGold } from "./currency.js";
import { createCustodialWallet, getCustodialWallet } from "./custodialWalletRedis.js";
import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "../redis.js";
import {
  acquireChainOperationLock,
  createChainOperation,
  findLatestChainOperationByTypeAndSubject,
  getChainOperation,
  listDueChainOperations,
  markChainOperationRetryable,
  recoverSubmittedChainOperationIfNeeded,
  releaseChainOperationLock,
  updateChainOperation,
} from "./chainOperationStore.js";
import { ethers } from "ethers";
import {
  getWalletRegistrationState as getWalletRegistrationStateProjection,
  getWalletRuntimeState,
  putWalletRegistrationState,
  putWalletRuntimeState,
} from "../db/walletInfraStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

// Track registered wallets to avoid duplicate welcome bonuses
const registeredWallets = new Set<string>();
let treasuryAddressCache: string | null = null;
let treasurySeededMem = false;
let treasuryInitPromise: Promise<string> | null = null;

const WELCOME_COPPER = 200;
const TREASURY_SEED_GOLD = "100000";
const TREASURY_ADDRESS_KEY = "wallet:welcome-treasury:address";
const TREASURY_SEEDED_KEY = "wallet:welcome-treasury:seeded";
const REGISTERED_WALLET_KEY_PREFIX = "wallet:registered:";
const WALLET_REGISTRATION_STATUS_KEY_PREFIX = "wallet:registration:";
const WELCOME_GOLD = copperToGold(WELCOME_COPPER);
const WALLET_REGISTRATION_OP_TYPE = "wallet-register";
const LOCAL_HARDHAT_CHAIN_ID = "31337";
const TREASURY_MIN_NATIVE_BALANCE = ethers.parseEther("0.1");
const LOCAL_TREASURY_TOP_UP_BALANCE = ethers.parseEther("1000");
const BOOTSTRAP_CHAIN_PRIORITY = 10;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

async function getStoredTreasuryAddress(): Promise<string | null> {
  if (treasuryAddressCache) return treasuryAddressCache;
  if (isPostgresConfigured()) {
    const stored = await getWalletRuntimeState<string>(TREASURY_ADDRESS_KEY);
    if (stored) {
      treasuryAddressCache = normalizeAddress(stored);
      return treasuryAddressCache;
    }
  }

  const redis = getRedis();
  if (redis) {
    try {
      const fromRedis = await redis.get(TREASURY_ADDRESS_KEY);
      if (fromRedis) {
        treasuryAddressCache = normalizeAddress(fromRedis);
        return treasuryAddressCache;
      }
      return null;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("getStoredTreasuryAddress");
  }
  return null;
}

async function storeTreasuryAddress(address: string): Promise<void> {
  const normalized = normalizeAddress(address);
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(TREASURY_ADDRESS_KEY, normalized);
  }

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(TREASURY_ADDRESS_KEY, normalized);
      treasuryAddressCache = normalized;
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("storeTreasuryAddress");
  }

  treasuryAddressCache = normalized;
}

async function isTreasurySeeded(): Promise<boolean> {
  if (treasurySeededMem) return true;
  if (isPostgresConfigured()) {
    const seeded = await getWalletRuntimeState<string>(TREASURY_SEEDED_KEY);
    if (seeded === "1") {
      treasurySeededMem = true;
      return true;
    }
  }

  const redis = getRedis();
  if (redis) {
    try {
      const seeded = await redis.get(TREASURY_SEEDED_KEY);
      if (seeded === "1") {
        treasurySeededMem = true;
        return true;
      }
      return false;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("isTreasurySeeded");
  }
  return false;
}

async function hasTreasuryGold(treasuryAddress: string, minimumGold: number): Promise<boolean> {
  try {
    const balance = parseFloat(await getGoldBalance(treasuryAddress));
    return Number.isFinite(balance) && balance >= minimumGold;
  } catch {
    return false;
  }
}

async function ensureTreasuryGasBalance(server: FastifyInstance, treasuryAddress: string): Promise<void> {
  try {
    const balance = await biteProvider.getBalance(treasuryAddress);
    if (balance >= TREASURY_MIN_NATIVE_BALANCE) return;

    const chainId = process.env.SKALE_BASE_CHAIN_ID?.trim() || String((await biteProvider.getNetwork()).chainId);
    if (chainId === LOCAL_HARDHAT_CHAIN_ID) {
      await biteProvider.send("hardhat_setBalance", [
        treasuryAddress,
        ethers.toBeHex(LOCAL_TREASURY_TOP_UP_BALANCE),
      ]);
      server.log.info(`[wallet/register] Auto-topped local treasury gas for ${treasuryAddress}`);
      return;
    }

    await distributeSFuel(treasuryAddress);
    server.log.info(`[wallet/register] Topped up treasury gas for ${treasuryAddress}`);
  } catch (err: any) {
    server.log.warn(`[wallet/register] Failed ensuring treasury gas for ${treasuryAddress}: ${err.message}`);
  }
}

async function markTreasurySeeded(): Promise<void> {
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(TREASURY_SEEDED_KEY, "1");
  }
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(TREASURY_SEEDED_KEY, "1");
      treasurySeededMem = true;
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) assertRedisAvailable("markTreasurySeeded");
  }

  treasurySeededMem = true;
}

async function isWalletRegistered(address: string): Promise<boolean> {
  const normalized = normalizeAddress(address);
  if (registeredWallets.has(normalized)) return true;
  if (isPostgresConfigured()) {
    const persisted = await getWalletRuntimeState<string>(`${REGISTERED_WALLET_KEY_PREFIX}${normalized}`);
    if (persisted === "1") {
      registeredWallets.add(normalized);
      return true;
    }
  }

  const redis = getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(`${REGISTERED_WALLET_KEY_PREFIX}${normalized}`);
      if (exists === 1) {
        registeredWallets.add(normalized);
        return true;
      }
      return false;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("isWalletRegistered");
    }
  }

  return false;
}

async function markWalletRegistered(address: string): Promise<void> {
  const normalized = normalizeAddress(address);
  if (isPostgresConfigured()) {
    await putWalletRuntimeState(`${REGISTERED_WALLET_KEY_PREFIX}${normalized}`, "1");
  }

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`${REGISTERED_WALLET_KEY_PREFIX}${normalized}`, "1");
      registeredWallets.add(normalized);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("markWalletRegistered");
    }
  }

  registeredWallets.add(normalized);
}

function walletRegistrationStatusKey(address: string): string {
  return `${WALLET_REGISTRATION_STATUS_KEY_PREFIX}${normalizeAddress(address)}`;
}

async function getWalletRegistrationStatus(address: string): Promise<Record<string, string> | null> {
  if (isPostgresConfigured()) {
    const status = await getWalletRegistrationStateProjection(address);
    if (status) return status;
  }
  const redis = getRedis();
  if (!redis) {
    if (!isPostgresConfigured()) {
      assertRedisAvailable("getWalletRegistrationStatus");
    }
    return null;
  }
  const raw = await redis.hgetall(walletRegistrationStatusKey(address));
  return raw && Object.keys(raw).length > 0 ? raw : null;
}

async function saveWalletRegistrationStatus(address: string, fields: Record<string, string | number | null | undefined>): Promise<void> {
  const existing = (await getWalletRegistrationStatus(address)) ?? {};
  const redis = getRedis();
  if (!redis && !isPostgresConfigured()) {
    assertRedisAvailable("saveWalletRegistrationStatus");
    return;
  }

  const key = walletRegistrationStatusKey(address);
  const data: Record<string, string> = {};
  const deletes: string[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (value == null || value === "") {
      deletes.push(field);
    } else {
      data[field] = String(value);
    }
  }
  const nextState = { ...existing, ...data };
  for (const field of deletes) {
    delete nextState[field];
  }
  if (isPostgresConfigured()) {
    await putWalletRegistrationState(address, nextState);
  }
  if (redis) {
    if (Object.keys(data).length > 0) await redis.hset(key, data);
    if (deletes.length > 0) await redis.hdel(key, ...deletes);
  }
}

async function findPendingWalletRegistrationOperation(address: string): Promise<string | null> {
  const status = await getWalletRegistrationStatus(address);
  const operationId = status?.operationId;
  if (operationId) {
    const record = await getChainOperation(operationId);
    if (record && record.status !== "completed" && record.status !== "failed_permanent") {
      return operationId;
    }
  }

  const latest = await findLatestChainOperationByTypeAndSubject(WALLET_REGISTRATION_OP_TYPE, normalizeAddress(address));
  if (!latest) return null;
  if (latest.status === "completed" || latest.status === "failed_permanent") return null;
  return latest.operationId;
}

async function createAndSeedTreasury(server: FastifyInstance): Promise<string> {
  const treasury = await createCustodialWallet();
  const treasuryAddress = normalizeAddress(treasury.address);
  await storeTreasuryAddress(treasuryAddress);
  console.log(`[wallet/register] Created treasury wallet ${treasuryAddress}, funding...`);

  try {
    await distributeSFuel(treasuryAddress);
    console.log(`[wallet/register] sFUEL sent to treasury ${treasuryAddress}`);
  } catch (err: any) {
    console.warn(`[wallet/register] Failed to fund treasury gas ${treasuryAddress}: ${err.message}`);
  }
  await ensureTreasuryGasBalance(server, treasuryAddress);

  console.log(`[wallet/register] Minting ${TREASURY_SEED_GOLD} GOLD to treasury...`);
  const seedTx = await mintGold(treasuryAddress, TREASURY_SEED_GOLD);
  await markTreasurySeeded();
  console.log(`[wallet/register] Treasury ${treasuryAddress} seeded with ${TREASURY_SEED_GOLD} GOLD: ${seedTx}`);
  return treasuryAddress;
}

async function ensureWelcomeTreasury(server: FastifyInstance): Promise<string> {
  if (treasuryInitPromise) {
    console.log(`[wallet/register] Treasury init already in progress, waiting...`);
    return treasuryInitPromise;
  }

  treasuryInitPromise = (async () => {
    let treasuryAddress = await getStoredTreasuryAddress();
    console.log(`[wallet/register] Stored treasury address: ${treasuryAddress ?? "none"}`);

    if (treasuryAddress) {
      try {
        await getCustodialWallet(treasuryAddress);
        console.log(`[wallet/register] Treasury wallet ${treasuryAddress} key found`);
      } catch (err: any) {
        console.warn(
          `[wallet/register] Treasury key missing for ${treasuryAddress}; creating new treasury (${err.message})`
        );
        treasuryAddress = null;
        treasurySeededMem = false;
      }
    }

    if (!treasuryAddress) {
      return createAndSeedTreasury(server);
    }

    const seeded = await isTreasurySeeded();
    const funded = await hasTreasuryGold(treasuryAddress, WELCOME_GOLD);

    if (!seeded || !funded) {
      console.log(`[wallet/register] Treasury ${treasuryAddress} not seeded, minting ${TREASURY_SEED_GOLD} GOLD...`);
      const seedTx = await mintGold(treasuryAddress, TREASURY_SEED_GOLD);
      await markTreasurySeeded();
      console.log(`[wallet/register] Treasury ${treasuryAddress} seeded: ${seedTx}`);
    }

    await ensureTreasuryGasBalance(server, treasuryAddress);

    return treasuryAddress;
  })();

  try {
    return await treasuryInitPromise;
  } finally {
    treasuryInitPromise = null;
  }
}

async function transferWelcomeBonus(
  server: FastifyInstance,
  treasuryAddress: string,
  recipientAddress: string,
  welcomeGold: number
): Promise<string> {
  await ensureTreasuryGasBalance(server, treasuryAddress);
  return await enqueueGoldTransferFrom(
    treasuryAddress,
    recipientAddress,
    welcomeGold.toString(),
    { priority: BOOTSTRAP_CHAIN_PRIORITY }
  );
}

export interface WalletRegistrationResult {
  ok: true;
  message: "Already registered" | "Wallet registered";
  sfuelTx?: string;
  goldTx?: string;
  treasuryWallet?: string;
  welcomeBonus?: {
    copper: number;
    gold: number;
  };
}

export async function processWalletRegistrationOperation(
  server: FastifyInstance,
  operationId: string,
): Promise<void> {
  const record = await getChainOperation(operationId);
  if (!record || record.type !== WALLET_REGISTRATION_OP_TYPE) return;
  if (await recoverSubmittedChainOperationIfNeeded(record)) return;
  if (!(await acquireChainOperationLock(operationId, 30_000))) return;

  const payload = JSON.parse(record.payload) as { address?: string };
  const address = normalizeAddress(payload.address ?? record.subject);
  const now = Date.now();

  try {
    await updateChainOperation(operationId, {
      status: "processing",
      attemptCount: record.attemptCount + 1,
      lastAttemptAt: now,
      nextAttemptAt: now,
      txHash: undefined,
      lastError: undefined,
    });
    await saveWalletRegistrationStatus(address, {
      operationId,
      status: "processing",
      updatedAt: now,
    });

    const status = (await getWalletRegistrationStatus(address)) ?? {};
    let sfuelTx = status.sfuelTx || "";
    let treasuryWallet = status.treasuryWallet || "";
    let goldTx = status.goldTx || "";

    if (!sfuelTx) {
      sfuelTx = await distributeSFuel(address);
      await saveWalletRegistrationStatus(address, { sfuelTx, updatedAt: Date.now() });
      console.log(`[wallet/register] sFUEL sent to ${address}: ${sfuelTx}`);
    }

    if (!goldTx) {
      treasuryWallet = await ensureWelcomeTreasury(server);
      await saveWalletRegistrationStatus(address, { treasuryWallet, updatedAt: Date.now() });
      await ensureTreasuryGasBalance(server, treasuryWallet);
      goldTx = await transferWelcomeBonus(server, treasuryWallet, address, WELCOME_GOLD);
      await saveWalletRegistrationStatus(address, { goldTx, updatedAt: Date.now() });
      console.log(`[wallet/register] Welcome bonus ${WELCOME_COPPER}c sent to ${address}: ${goldTx}`);
    }

    await markWalletRegistered(address);
    await updateChainOperation(operationId, {
      status: "completed",
      completedAt: Date.now(),
      txHash: undefined,
      lastError: undefined,
    });
    await saveWalletRegistrationStatus(address, {
      status: "completed",
      completedAt: Date.now(),
      updatedAt: Date.now(),
      operationId,
      sfuelTx,
      goldTx,
      treasuryWallet,
      lastError: null,
    });
  } catch (err: any) {
    await markChainOperationRetryable(operationId, err);
    const updated = await getChainOperation(operationId);
    await saveWalletRegistrationStatus(address, {
      operationId,
      status: updated?.status ?? "failed_retryable",
      updatedAt: Date.now(),
      lastError: String(err?.message ?? err ?? "").slice(0, 240),
      nextAttemptAt: updated?.nextAttemptAt ?? "",
    });
    console.warn(`[wallet/register] Registration retry scheduled for ${address}: ${String(err?.message ?? err ?? "").slice(0, 160)}`);
  } finally {
    await releaseChainOperationLock(operationId).catch(() => {});
  }
}

export async function processPendingWalletRegistrations(server: FastifyInstance): Promise<void> {
  const ops = await listDueChainOperations(WALLET_REGISTRATION_OP_TYPE);
  for (const op of ops) {
    await processWalletRegistrationOperation(server, op.operationId);
  }
}

export function startWalletRegistrationWorker(server: FastifyInstance): void {
  const tick = async () => {
    await processPendingWalletRegistrations(server);
  };

  void tick().catch((err) => {
    server.log.error(err, "[wallet/register] initial worker tick failed");
  });

  const interval = setInterval(() => {
    tick().catch((err) => server.log.error(err, "[wallet/register] worker tick failed"));
  }, 5_000);

  server.addHook("onClose", async () => {
    clearInterval(interval);
  });
}

/**
 * Transfer gold from the treasury to a player wallet (e.g. mob loot rewards).
 * Returns the transaction hash, or throws on failure.
 * The treasury is lazily initialised on first call.
 */
export async function transferFromTreasury(
  toAddress: string,
  goldAmount: string
): Promise<string> {
  // Resolve treasury address (cached after first call)
  if (!treasuryAddressCache) {
    const stored = await getStoredTreasuryAddress();
    if (!stored) throw new Error("Treasury not initialised — call registerWalletWithWelcomeBonus first");
    treasuryAddressCache = stored;
  }
  const treasuryAccount = await getCustodialWallet(treasuryAddressCache);

  // Retry with sFUEL top-up if treasury is out of gas
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await transferGoldFrom(treasuryAccount, toAddress, goldAmount);
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "");
      const lowGas =
        msg.includes("Account balance is too low") ||
        msg.includes("insufficient funds for gas");
      if (!lowGas || attempt === 2) throw err;

      try {
        await distributeSFuel(treasuryAddressCache);
        console.log(`[treasury] Topped up sFUEL for treasury after attempt ${attempt + 1}`);
      } catch {
        // sFUEL top-up failed — next attempt will likely fail too, but try anyway
      }
    }
  }
  throw new Error("Failed to transfer from treasury");
}

export async function enqueueTransferFromTreasury(
  toAddress: string,
  goldAmount: string
): Promise<string> {
  if (!treasuryAddressCache) {
    const stored = await getStoredTreasuryAddress();
    if (!stored) throw new Error("Treasury not initialised — call registerWalletWithWelcomeBonus first");
    treasuryAddressCache = stored;
  }
  return await enqueueGoldTransferFrom(treasuryAddressCache, toAddress, goldAmount);
}

/**
 * Idempotent wallet registration flow:
 * - first call gives sFUEL + marks registered immediately
 * - welcome gold bonus is sent in the background (non-blocking)
 * - subsequent calls return "Already registered"
 */
export async function registerWalletWithWelcomeBonus(
  server: FastifyInstance,
  address: string
): Promise<WalletRegistrationResult> {
  const normalized = address.toLowerCase();
  if (await isWalletRegistered(normalized)) {
    return { ok: true, message: "Already registered" };
  }
  const existingPending = await findPendingWalletRegistrationOperation(normalized);
  let operationId = existingPending;
  if (!operationId) {
    const record = await createChainOperation(
      WALLET_REGISTRATION_OP_TYPE,
      normalized,
      { address: normalized },
      { priority: BOOTSTRAP_CHAIN_PRIORITY }
    );
    operationId = record.operationId;
    await saveWalletRegistrationStatus(normalized, {
      operationId,
      status: "queued",
      updatedAt: Date.now(),
      lastError: null,
    });
  }
  void processWalletRegistrationOperation(server, operationId).catch((err) => {
    server.log.warn(`[wallet/register] async registration dispatch failed for ${normalized}: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
  });

  return {
    ok: true,
    message: "Wallet registered",
    welcomeBonus: {
      copper: WELCOME_COPPER,
      gold: WELCOME_GOLD,
    },
  };
}

export async function ensureWalletRegistrationQueued(
  server: FastifyInstance,
  address: string
): Promise<"already_registered" | "already_queued" | "queued"> {
  const normalized = normalizeAddress(address);
  if (await isWalletRegistered(normalized)) {
    return "already_registered";
  }

  const existingPending = await findPendingWalletRegistrationOperation(normalized);
  if (existingPending) {
    void processWalletRegistrationOperation(server, existingPending).catch((err) => {
      server.log.warn(`[wallet/register] async registration dispatch failed for ${normalized}: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    });
    return "already_queued";
  }

  await registerWalletWithWelcomeBonus(server, normalized);
  return "queued";
}

export function registerWalletRoutes(server: FastifyInstance) {
  /**
   * POST /wallet/register { address } (or { walletAddress })
   * First-time wallet setup: distributes sFUEL + transfers 200 copper from welcome treasury.
   */
  server.post<{ Body: { address?: string; walletAddress?: string } }>(
    "/wallet/register",
    async (request, reply) => {
      const address = request.body.address ?? request.body.walletAddress;

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        reply.code(400);
        return { error: "Invalid Ethereum address" };
      }

      try {
        return await registerWalletWithWelcomeBonus(server, address);
      } catch (err: any) {
        const msg = String(err?.message ?? err ?? "").slice(0, 300);
        console.error(`[wallet/register] FAILED for ${address}: ${msg}`);
        server.log.error(err, `Failed to register wallet ${address}`);
        reply.code(500);
        return { error: "Blockchain transaction failed", detail: msg };
      }
    }
  );

  /**
   * GET /wallet/:address/balance
   * Returns gold balance + all item balances from chain.
   */
  server.get<{ Params: { address: string } }>(
    "/wallet/:address/balance",
    async (request, reply) => {
      const { address } = request.params;

      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        reply.code(400);
        return { error: "Invalid Ethereum address" };
      }

      try {
        const onChainGold = parseFloat(await getOnChainGoldBalance(address));
        const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
        const spentGold = await getSpentGoldAsync(address);
        const availableGold = await getAvailableGoldAsync(address, safeOnChainGold);

        // Fetch all item balances in parallel (cached 10s in blockchain.ts)
        const balanceResults = await Promise.all(
          ITEM_CATALOG.map((item) => getOnChainItemBalance(address, item.tokenId))
        );

        const items: {
          tokenId: string;
          name: string;
          balance: string;
          category: string;
          rarity: string;
          equipSlot: string | null;
          armorSlot: string | null;
          statBonuses: Record<string, number>;
          maxDurability: number | null;
        }[] = [];
        for (let i = 0; i < ITEM_CATALOG.length; i++) {
          const balance = balanceResults[i];
          if (balance > 0n) {
            const item = ITEM_CATALOG[i];
            items.push({
              tokenId: item.tokenId.toString(),
              name: item.name,
              balance: balance.toString(),
              category: item.category,
              rarity: getItemRarity(item.copperPrice),
              equipSlot: item.equipSlot ?? null,
              armorSlot: item.armorSlot ?? null,
              statBonuses: item.statBonuses ?? {},
              maxDurability: item.maxDurability ?? null,
            });
          }
        }

        return {
          address,
          copper: goldToCopper(availableGold),
          gold: formatGold(availableGold),
          onChainGold: formatGold(safeOnChainGold),
          spentGold: formatGold(spentGold),
          items,
        };
      } catch (err) {
        server.log.error(err, `Failed to fetch balance for ${address}`);
        reply.code(500);
        return { error: "Failed to read blockchain state" };
      }
    }
  );
}
