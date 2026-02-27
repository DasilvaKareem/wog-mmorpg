import { randomPrivateKey, privateKeyToAccount } from "thirdweb/wallets";
import { thirdwebClient } from "./chain.js";
import { encrypt, decrypt } from "./encryption.js";
import type { Account } from "thirdweb/wallets";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-key-change-in-production";

/**
 * In-memory storage for custodial wallets
 * Format: Map<walletAddress, encryptedPrivateKey>
 *
 * TODO: Replace with persistent database storage in production
 */
const custodialWallets = new Map<string, string>();

export interface CustodialWalletInfo {
  address: string;
  createdAt: number;
}

/**
 * Create a new custodial wallet
 * Returns wallet address (private key is encrypted and stored internally)
 */
export function createCustodialWallet(): CustodialWalletInfo {
  const privateKey = randomPrivateKey();
  const account = privateKeyToAccount({ client: thirdwebClient, privateKey });

  // Encrypt private key before storing
  const encryptedPrivateKey = encrypt(privateKey, ENCRYPTION_KEY);
  custodialWallets.set(account.address.toLowerCase(), encryptedPrivateKey);

  console.log(`[x402] Created custodial wallet: ${account.address}`);

  return {
    address: account.address,
    createdAt: Date.now(),
  };
}

/**
 * Retrieve an existing custodial wallet account
 * Throws error if wallet not found
 */
export function getCustodialWallet(address: string): Account {
  const normalizedAddress = address.toLowerCase();
  const encryptedPrivateKey = custodialWallets.get(normalizedAddress);

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
export function hasCustodialWallet(address: string): boolean {
  return custodialWallets.has(address.toLowerCase());
}

/**
 * Export wallet private key (for user to claim custody)
 * ⚠️ Only use this when explicitly requested by the user
 */
export function exportCustodialWallet(address: string): string {
  const normalizedAddress = address.toLowerCase();
  const encryptedPrivateKey = custodialWallets.get(normalizedAddress);

  if (!encryptedPrivateKey) {
    throw new Error(`Custodial wallet not found: ${address}`);
  }

  // Decrypt and return private key
  return decrypt(encryptedPrivateKey, ENCRYPTION_KEY);
}

/**
 * Delete a custodial wallet (use with caution!)
 */
export function deleteCustodialWallet(address: string): boolean {
  return custodialWallets.delete(address.toLowerCase());
}

/**
 * Get all custodial wallet addresses (for admin/monitoring)
 */
export function getAllCustodialWallets(): CustodialWalletInfo[] {
  return Array.from(custodialWallets.keys()).map(address => ({
    address,
    createdAt: Date.now(), // TODO: Store actual creation time in production
  }));
}
