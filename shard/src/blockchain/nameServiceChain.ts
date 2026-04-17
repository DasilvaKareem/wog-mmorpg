/**
 * Name Service Chain Layer
 * Fire-and-forget bridge between in-memory name cache and
 * the WoGNameService contract on BITE v2.
 *
 * All functions silently swallow errors — chain failures never break gameplay.
 */

import { ethers } from "ethers";
import { biteSigner, biteWallet, SKALE_BASE_CHAIN_ID } from "./biteChain.js";
import { queueBiteTransaction, reserveServerNonce, waitForBiteReceipt, waitForBiteSubmission } from "./biteTxQueue.js";
import { traceTx } from "./txTracer.js";
import {
  createChainOperation,
  getChainOperation,
  listDueChainOperations,
  processTrackedChainOperation,
  registerChainOperationProcessor,
} from "./chainOperationStore.js";
import { deleteWalletName, getNameByWallet, getWalletByName, isWalletNameAvailable, markWalletChainRegistered, upsertWalletName } from "../db/nameStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

const NAME_SERVICE_ADDRESS = process.env.NAME_SERVICE_CONTRACT_ADDRESS;

const NAME_SERVICE_ABI = [
  "function registerName(address wallet, string name) external",
  "function releaseName(address wallet) external",
  "function resolve(string name) external view returns (address)",
  "function reverseLookup(address wallet) external view returns (string)",
  "function nameTaken(bytes32 nameHash) external view returns (bool)",
];

const nameServiceContract =
  NAME_SERVICE_ADDRESS && (biteSigner ?? biteWallet)
    ? new ethers.Contract(NAME_SERVICE_ADDRESS, NAME_SERVICE_ABI, biteSigner ?? biteWallet)
    : null;

export function isNameServiceEnabled(): boolean {
  return Boolean(nameServiceContract);
}

if (!nameServiceContract) {
  if (!NAME_SERVICE_ADDRESS) {
    console.warn(
      "[nameServiceChain] NAME_SERVICE_CONTRACT_ADDRESS not set — on-chain name service disabled"
    );
  }
}

// ============ In-Memory Cache (60s TTL) ============

interface CacheEntry {
  value: string | null;
  expiry: number;
}

const CACHE_TTL_MS = 60_000;
const KEEP_OPTIMISTIC_LOCAL_NAME_CACHE = SKALE_BASE_CHAIN_ID === 31337;
const NAME_REGISTER_OP = "name-register";
const NAME_RELEASE_OP = "name-release";
const BOOTSTRAP_CHAIN_PRIORITY = 10;
const REGISTER_COOLDOWN_MS = 30_000;

const registerInFlight = new Map<string, Promise<boolean>>();
const registerCooldown = new Map<string, { name: string; at: number; ok: boolean }>();

/** address (lowercase) → name */
const addressToNameCache = new Map<string, CacheEntry>();

/** name (lowercase) → address */
const nameToAddressCache = new Map<string, CacheEntry>();

function getCached(cache: Map<string, CacheEntry>, key: string): string | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined; // cache miss
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return undefined; // expired
  }
  return entry.value;
}

function setCache(cache: Map<string, CacheEntry>, key: string, value: string | null) {
  cache.set(key, { value, expiry: Date.now() + CACHE_TTL_MS });
}

// ============ Exported Functions ============

/**
 * Register a .wog name on-chain (fire-and-forget).
 * Also updates the in-memory cache immediately.
 */
export async function registerNameOnChain(
  walletAddress: string,
  name: string
): Promise<boolean> {
  const addrKey = walletAddress.toLowerCase();
  const nameKey = name.toLowerCase();
  if (!nameServiceContract) return false;

  if (getCached(addressToNameCache, addrKey) === name) return true;

  const inFlight = registerInFlight.get(addrKey);
  if (inFlight) return inFlight;

  const cooldown = registerCooldown.get(addrKey);
  if (cooldown && cooldown.name === name && Date.now() - cooldown.at < REGISTER_COOLDOWN_MS) {
    return cooldown.ok;
  }

  const task = (async () => {
    if (isPostgresConfigured()) {
      await upsertWalletName(walletAddress, name);
    }
    const record = await createChainOperation(
      NAME_REGISTER_OP,
      walletAddress.toLowerCase(),
      { walletAddress, name },
      { priority: BOOTSTRAP_CHAIN_PRIORITY }
    );
    try {
      await processNameOperation(record.operationId);
      const updated = await getChainOperation(record.operationId);
      const success = updated?.status === "completed";
      if (success || KEEP_OPTIMISTIC_LOCAL_NAME_CACHE) {
        setCache(addressToNameCache, addrKey, name);
        setCache(nameToAddressCache, nameKey, walletAddress);
      }
      if (success) {
        await markWalletChainRegistered(walletAddress, name);
      }
      return success || KEEP_OPTIMISTIC_LOCAL_NAME_CACHE;
    } catch (err) {
      const errMsg = String((err as any)?.message ?? (err as any)?.reason ?? err ?? "");
      if (errMsg.includes("WalletAlreadyHasName")) {
        const existing = (await getNameByWallet(walletAddress)) ?? name;
        setCache(addressToNameCache, addrKey, existing);
        setCache(nameToAddressCache, existing.toLowerCase(), walletAddress);
        await markWalletChainRegistered(walletAddress, existing);
        return true;
      }
      if (KEEP_OPTIMISTIC_LOCAL_NAME_CACHE) {
        setCache(addressToNameCache, addrKey, name);
        setCache(nameToAddressCache, nameKey, walletAddress);
        return true;
      }
      addressToNameCache.delete(addrKey);
      nameToAddressCache.delete(nameKey);
      console.warn(`[nameServiceChain] registerName failed for ${walletAddress}:`, err);
      return false;
    }
  })();

  registerInFlight.set(addrKey, task);
  try {
    const ok = await task;
    registerCooldown.set(addrKey, { name, at: Date.now(), ok });
    return ok;
  } finally {
    if (registerInFlight.get(addrKey) === task) {
      registerInFlight.delete(addrKey);
    }
  }
}

/**
 * Release a wallet's .wog name on-chain (fire-and-forget).
 */
export async function releaseNameOnChain(
  walletAddress: string
): Promise<boolean> {
  const addrKey = walletAddress.toLowerCase();

  if (!nameServiceContract) return false;
  const cachedName = getCached(addressToNameCache, addrKey);
  if (isPostgresConfigured()) {
    await deleteWalletName(walletAddress);
  }
  const record = await createChainOperation(NAME_RELEASE_OP, walletAddress.toLowerCase(), {
    walletAddress,
    cachedName,
  });
  try {
    await processNameOperation(record.operationId);
    const updated = await getChainOperation(record.operationId);
    const success = updated?.status === "completed";
    if (success || KEEP_OPTIMISTIC_LOCAL_NAME_CACHE) {
      if (cachedName) nameToAddressCache.delete(cachedName.toLowerCase());
      addressToNameCache.delete(addrKey);
    }
    return success || KEEP_OPTIMISTIC_LOCAL_NAME_CACHE;
  } catch (err) {
    console.warn(`[nameServiceChain] releaseName failed for ${walletAddress}:`, err);
    return false;
  }
}

/**
 * Resolve a name to an address. Checks cache first, then chain.
 */
export async function resolveNameOnChain(
  name: string
): Promise<string | null> {
  if (isPostgresConfigured()) {
    return await getWalletByName(name);
  }
  const nameKey = name.toLowerCase();
  const cached = getCached(nameToAddressCache, nameKey);
  if (cached !== undefined) return cached;

  if (!nameServiceContract) return null;
  try {
    const addr: string = await nameServiceContract.resolve(name);
    const result = addr === ethers.ZeroAddress ? null : addr;
    setCache(nameToAddressCache, nameKey, result);
    return result;
  } catch (err) {
    console.warn(`[nameServiceChain] resolve failed for "${name}":`, err);
    return null;
  }
}

/**
 * Reverse lookup — get the .wog name for a wallet. Checks cache first.
 */
export async function reverseLookupOnChain(
  walletAddress: string
): Promise<string | null> {
  if (isPostgresConfigured()) {
    return await getNameByWallet(walletAddress);
  }
  const addrKey = walletAddress.toLowerCase();
  const cached = getCached(addressToNameCache, addrKey);
  if (cached !== undefined) return cached;

  if (!nameServiceContract) return null;
  try {
    const name: string = await nameServiceContract.reverseLookup(walletAddress);
    const result = name === "" ? null : name;
    setCache(addressToNameCache, addrKey, result);
    if (result) {
      setCache(nameToAddressCache, result.toLowerCase(), walletAddress);
    }
    return result;
  } catch (err) {
    console.warn(`[nameServiceChain] reverseLookup failed for ${walletAddress}:`, err);
    return null;
  }
}

/**
 * Check if a name is available (not taken). Uses cache + chain.
 */
export async function isNameAvailable(name: string): Promise<boolean> {
  if (isPostgresConfigured()) {
    return await isWalletNameAvailable(name);
  }
  const addr = await resolveNameOnChain(name);
  return addr === null;
}

async function isRegisteredToWallet(walletAddress: string, name: string): Promise<boolean> {
  if (isPostgresConfigured()) {
    const [resolvedWallet, reverseName] = await Promise.all([
      getWalletByName(name).catch(() => null),
      getNameByWallet(walletAddress).catch(() => null),
    ]);
    return (
      resolvedWallet?.toLowerCase() === walletAddress.toLowerCase() &&
      reverseName?.toLowerCase() === name.toLowerCase()
    );
  }
  const [resolvedWallet, reverseName] = await Promise.all([
    resolveNameOnChain(name).catch(() => null),
    reverseLookupOnChain(walletAddress).catch(() => null),
  ]);
  return (
    resolvedWallet?.toLowerCase() === walletAddress.toLowerCase() &&
    reverseName?.toLowerCase() === name.toLowerCase()
  );
}

export async function processNameOperation(operationId: string): Promise<void> {
  const record = await getChainOperation(operationId);
  if (!record || (record.type !== NAME_REGISTER_OP && record.type !== NAME_RELEASE_OP)) return;
  await processTrackedChainOperation(operationId);
}

export async function processPendingNameOperations(
  logger: { error: (err: unknown, msg?: string) => void } = console,
): Promise<void> {
  for (const type of [NAME_REGISTER_OP, NAME_RELEASE_OP]) {
    const ops = await listDueChainOperations(type);
    for (const op of ops) {
      try {
        await processNameOperation(op.operationId);
      } catch (err) {
        logger.error(err, `[nameServiceChain] worker failed for ${op.operationId}`);
      }
    }
  }
}

export function startNameServiceWorker(logger: { error: (err: unknown, msg?: string) => void }): void {
  const tick = async () => {
    await processPendingNameOperations(logger);
  };

  void tick().catch((err) => logger.error(err, "[nameServiceChain] initial worker tick failed"));
  setInterval(() => {
    tick().catch((err) => logger.error(err, "[nameServiceChain] worker tick failed"));
  }, 5_000);
}

registerChainOperationProcessor(NAME_REGISTER_OP, async (record) => {
  const payload = JSON.parse(record.payload) as { walletAddress: string; name?: string };
  const walletAddress = payload.walletAddress;
  const name = String(payload.name ?? "");
  let txHash: string | undefined;
  if (!(await isRegisteredToWallet(walletAddress, name))) {
    txHash = await traceTx("name-register", "registerNameOnChain", { wallet: walletAddress, name }, "bite", async () => {
      try {
        const receipt = await queueBiteTransaction(`name-register:${walletAddress}`, async () => {
          const tx = await waitForBiteSubmission(
            nameServiceContract!.registerName(walletAddress, name, { nonce: await reserveServerNonce() ?? undefined })
          );
          return waitForBiteReceipt(tx.wait());
        });
        return (receipt as any).hash;
      } catch (err) {
        if (await isRegisteredToWallet(walletAddress, name)) {
          return "already-registered";
        }
        throw err;
      }
    });
  }
  setCache(addressToNameCache, walletAddress.toLowerCase(), name);
  setCache(nameToAddressCache, name.toLowerCase(), walletAddress);
  if (isPostgresConfigured()) {
    await upsertWalletName(walletAddress, name);
  }
  console.log(`[nameServiceChain] registered "${name}.wog" → ${walletAddress}`);
  return { result: txHash ?? "already-registered", txHash };
});

registerChainOperationProcessor(NAME_RELEASE_OP, async (record) => {
  const payload = JSON.parse(record.payload) as { walletAddress: string; cachedName?: string | null };
  const walletAddress = payload.walletAddress;
  let txHash: string | undefined;
  const existingName = await reverseLookupOnChain(walletAddress);
  if (existingName) {
    txHash = await traceTx("name-release", "releaseNameOnChain", { wallet: walletAddress }, "bite", async () => {
      try {
        const receipt = await queueBiteTransaction(`name-release:${walletAddress}`, async () => {
          const tx = await waitForBiteSubmission(
            nameServiceContract!.releaseName(walletAddress, { nonce: await reserveServerNonce() ?? undefined })
          );
          return waitForBiteReceipt(tx.wait());
        });
        return (receipt as any).hash;
      } catch (err) {
        if ((await reverseLookupOnChain(walletAddress)) === null) {
          return "already-released";
        }
        throw err;
      }
    });
  }
  const cachedName = payload.cachedName || getCached(addressToNameCache, walletAddress.toLowerCase());
  if (cachedName) nameToAddressCache.delete(String(cachedName).toLowerCase());
  addressToNameCache.delete(walletAddress.toLowerCase());
  if (isPostgresConfigured()) {
    await deleteWalletName(walletAddress);
  }
  console.log(`[nameServiceChain] released name for ${walletAddress}`);
  return { result: txHash ?? "already-released", txHash };
});
