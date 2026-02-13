import { randomPrivateKey, privateKeyToAccount } from "thirdweb/wallets";
import { thirdwebClient } from "./chain.js";
import { encrypt, decrypt } from "./encryption.js";
import type { Account } from "thirdweb/wallets";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-key-change-in-production";

/**
 * Redis-backed storage for custodial wallets (production)
 * Falls back to in-memory if Redis not configured (development)
 */

let redis: any = null;

// Lazy-load Redis only if REDIS_URL is set
if (process.env.REDIS_URL) {
  try {
    // Dynamically import Redis to avoid errors if ioredis not installed
    const Redis = await import("ioredis").then(m => m.default);
    redis = new Redis(process.env.REDIS_URL);
    console.log("[custodial] Redis connected for wallet storage");
  } catch (err) {
    console.warn("[custodial] Redis not available, using in-memory storage:", err);
  }
}

// Fallback in-memory storage (dev mode)
const inMemoryStore = new Map<string, string>();

if (!redis) {
  console.warn("[custodial] WARNING: Using in-memory wallet storage (data will be lost on restart)");
}

export interface CustodialWalletInfo {
  address: string;
  createdAt: number;
}

/**
 * Create a new custodial wallet
 * Returns wallet address (private key is encrypted and stored)
 */
export function createCustodialWallet(): CustodialWalletInfo {
  const privateKey = randomPrivateKey();
  const account = privateKeyToAccount({ client: thirdwebClient, privateKey });

  // Encrypt private key before storing
  const encryptedPrivateKey = encrypt(privateKey, ENCRYPTION_KEY);

  // Store in Redis or in-memory
  const address = account.address.toLowerCase();
  if (redis) {
    redis.set(`wallet:${address}`, encryptedPrivateKey);
  } else {
    inMemoryStore.set(address, encryptedPrivateKey);
  }

  console.log(`[custodial] Created wallet: ${account.address}`);

  return {
    address: account.address,
    createdAt: Date.now(),
  };
}

/**
 * Retrieve an existing custodial wallet account
 * Throws error if wallet not found
 */
export async function getCustodialWallet(address: string): Promise<Account> {
  const normalizedAddress = address.toLowerCase();

  let encryptedPrivateKey: string | null;
  if (redis) {
    encryptedPrivateKey = await redis.get(`wallet:${normalizedAddress}`);
  } else {
    encryptedPrivateKey = inMemoryStore.get(normalizedAddress) || null;
  }

  if (!encryptedPrivateKey) {
    throw new Error(`Custodial wallet not found: ${address}`);
  }

  // Decrypt private key
  const privateKey = decrypt(encryptedPrivateKey, ENCRYPTION_KEY);
  return privateKeyToAccount({ client: thirdwebClient, privateKey });
}

/**
 * Check if a custodial wallet exists
 */
export async function hasCustodialWallet(address: string): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();

  if (redis) {
    const exists = await redis.exists(`wallet:${normalizedAddress}`);
    return exists === 1;
  } else {
    return inMemoryStore.has(normalizedAddress);
  }
}

/**
 * Export wallet private key (for user to claim custody)
 * ⚠️ Only use this when explicitly requested by the user
 */
export async function exportCustodialWallet(address: string): Promise<string> {
  const normalizedAddress = address.toLowerCase();

  let encryptedPrivateKey: string | null;
  if (redis) {
    encryptedPrivateKey = await redis.get(`wallet:${normalizedAddress}`);
  } else {
    encryptedPrivateKey = inMemoryStore.get(normalizedAddress) || null;
  }

  if (!encryptedPrivateKey) {
    throw new Error(`Custodial wallet not found: ${address}`);
  }

  // Decrypt and return private key
  return decrypt(encryptedPrivateKey, ENCRYPTION_KEY);
}

/**
 * Delete a custodial wallet (use with caution!)
 */
export async function deleteCustodialWallet(address: string): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();

  if (redis) {
    const deleted = await redis.del(`wallet:${normalizedAddress}`);
    return deleted === 1;
  } else {
    return inMemoryStore.delete(normalizedAddress);
  }
}

/**
 * Get all custodial wallet addresses (for admin/monitoring)
 */
export async function getAllCustodialWallets(): Promise<CustodialWalletInfo[]> {
  if (redis) {
    const keys = await redis.keys("wallet:*");
    return keys.map((key: string) => ({
      address: key.replace("wallet:", ""),
      createdAt: Date.now(), // TODO: Store actual creation time
    }));
  } else {
    return Array.from(inMemoryStore.keys()).map(address => ({
      address,
      createdAt: Date.now(),
    }));
  }
}
