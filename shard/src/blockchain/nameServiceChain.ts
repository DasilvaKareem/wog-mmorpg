/**
 * Name Service Chain Layer
 * Fire-and-forget bridge between in-memory name cache and
 * the WoGNameService contract on BITE v2.
 *
 * All functions silently swallow errors — chain failures never break gameplay.
 */

import { ethers } from "ethers";
import { biteWallet } from "./biteChain.js";
import { traceTx } from "./txTracer.js";

const NAME_SERVICE_ADDRESS = process.env.NAME_SERVICE_CONTRACT_ADDRESS;

const NAME_SERVICE_ABI = [
  "function registerName(address wallet, string name) external",
  "function releaseName(address wallet) external",
  "function resolve(string name) external view returns (address)",
  "function reverseLookup(address wallet) external view returns (string)",
  "function nameTaken(bytes32 nameHash) external view returns (bool)",
];

const nameServiceContract =
  NAME_SERVICE_ADDRESS && biteWallet
    ? new ethers.Contract(NAME_SERVICE_ADDRESS, NAME_SERVICE_ABI, biteWallet)
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
  // Update cache optimistically
  const addrKey = walletAddress.toLowerCase();
  const nameKey = name.toLowerCase();
  setCache(addressToNameCache, addrKey, name);
  setCache(nameToAddressCache, nameKey, walletAddress);

  if (!nameServiceContract) return false;
  try {
    return await traceTx("name-register", "registerNameOnChain", { wallet: walletAddress, name }, "bite", async () => {
      const tx = await nameServiceContract.registerName(walletAddress, name);
      await tx.wait();
      console.log(`[nameServiceChain] registered "${name}.wog" → ${walletAddress}`);
      return true;
    });
  } catch (err) {
    // Revert cache on failure
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

  // Clear cache
  const cachedName = getCached(addressToNameCache, addrKey);
  if (cachedName) {
    nameToAddressCache.delete(cachedName.toLowerCase());
  }
  addressToNameCache.delete(addrKey);

  if (!nameServiceContract) return false;
  try {
    return await traceTx("name-release", "releaseNameOnChain", { wallet: walletAddress }, "bite", async () => {
      const tx = await nameServiceContract.releaseName(walletAddress);
      await tx.wait();
      console.log(`[nameServiceChain] released name for ${walletAddress}`);
      return true;
    });
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
