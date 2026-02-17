import { randomPrivateKey, privateKeyToAccount } from "thirdweb/wallets";
import { thirdwebClient } from "./chain.js";
import { encrypt, decrypt } from "./encryption.js";
import { getRedis } from "./redis.js";
import type { Account } from "thirdweb/wallets";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-key-change-in-production";

/**
 * Redis-backed storage for custodial wallets (production)
 * Falls back to in-memory if Redis not configured or errors.
 * Uses shared Redis client from redis.ts
 */

// In-memory storage (always available as fallback)
const inMemoryStore = new Map<string, string>();

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

  // Always write to in-memory
  const address = account.address.toLowerCase();
  inMemoryStore.set(address, encryptedPrivateKey);

  // Try Redis too
  const redis = getRedis();
  if (redis) {
    try { redis.set(`wallet:${address}`, encryptedPrivateKey); } catch {}
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

  let encryptedPrivateKey: string | null = null;
  const redis = getRedis();
  if (redis) {
    try { encryptedPrivateKey = await redis.get(`wallet:${normalizedAddress}`); } catch {}
  }
  if (!encryptedPrivateKey) {
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
  const redis = getRedis();

  if (redis) {
    try {
      const exists = await redis.exists(`wallet:${normalizedAddress}`);
      if (exists === 1) return true;
    } catch {}
  }
  return inMemoryStore.has(normalizedAddress);
}

/**
 * Export wallet private key (for user to claim custody)
 * Only use this when explicitly requested by the user
 */
export async function exportCustodialWallet(address: string): Promise<string> {
  const normalizedAddress = address.toLowerCase();

  let encryptedPrivateKey: string | null = null;
  const redis = getRedis();
  if (redis) {
    try { encryptedPrivateKey = await redis.get(`wallet:${normalizedAddress}`); } catch {}
  }
  if (!encryptedPrivateKey) {
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
  const memDeleted = inMemoryStore.delete(normalizedAddress);

  const redis = getRedis();
  if (redis) {
    try {
      const deleted = await redis.del(`wallet:${normalizedAddress}`);
      return deleted === 1 || memDeleted;
    } catch {}
  }
  return memDeleted;
}

/**
 * Get all custodial wallet addresses (for admin/monitoring)
 */
export async function getAllCustodialWallets(): Promise<CustodialWalletInfo[]> {
  const redis = getRedis();

  if (redis) {
    try {
      const keys = await redis.keys("wallet:*");
      return keys.map((key: string) => ({
        address: key.replace("wallet:", ""),
        createdAt: Date.now(),
      }));
    } catch {}
  }
  return Array.from(inMemoryStore.keys()).map(address => ({
    address,
    createdAt: Date.now(),
  }));
}
