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
  acquireChainOperationLock,
  createChainOperation,
  getChainOperation,
  listDueChainOperations,
  markChainOperationRetryable,
  releaseChainOperationLock,
  updateChainOperation,
} from "./chainOperationStore.js";

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
  const record = await createChainOperation(NAME_REGISTER_OP, walletAddress.toLowerCase(), { walletAddress, name });
  try {
    await processNameOperation(record.operationId);
    const updated = await getChainOperation(record.operationId);
    const success = updated?.status === "completed";
    if (success || KEEP_OPTIMISTIC_LOCAL_NAME_CACHE) {
      setCache(addressToNameCache, addrKey, name);
      setCache(nameToAddressCache, nameKey, walletAddress);
    }
    return success || KEEP_OPTIMISTIC_LOCAL_NAME_CACHE;
  } catch (err) {
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
  const addr = await resolveNameOnChain(name);
  return addr === null;
}

async function isRegisteredToWallet(walletAddress: string, name: string): Promise<boolean> {
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
  if (!(await acquireChainOperationLock(operationId, 30_000))) return;

  try {
    await updateChainOperation(operationId, {
      status: "submitted",
      attemptCount: record.attemptCount + 1,
      lastAttemptAt: Date.now(),
      nextAttemptAt: Date.now(),
      lastError: undefined,
    });
    const payload = JSON.parse(record.payload) as { walletAddress: string; name?: string; cachedName?: string | null };
    const walletAddress = payload.walletAddress;
    let txHash: string | undefined;

    if (record.type === NAME_REGISTER_OP) {
      const name = String(payload.name ?? "");
      if (await isRegisteredToWallet(walletAddress, name)) {
        txHash = undefined;
      } else {
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
      console.log(`[nameServiceChain] registered "${name}.wog" → ${walletAddress}`);
    } else {
      const existingName = await reverseLookupOnChain(walletAddress);
      if (!existingName) {
        txHash = undefined;
      } else {
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
      console.log(`[nameServiceChain] released name for ${walletAddress}`);
    }

    await updateChainOperation(operationId, {
      status: "completed",
      completedAt: Date.now(),
      txHash,
      lastError: undefined,
    });
  } catch (err) {
    await markChainOperationRetryable(operationId, err);
    throw err;
  } finally {
    await releaseChainOperationLock(operationId).catch(() => {});
  }
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
