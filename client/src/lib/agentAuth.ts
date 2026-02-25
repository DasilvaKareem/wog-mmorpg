/**
 * Client-side auth token management for agent API calls.
 * Obtains a JWT by challenge-signing with the thirdweb in-app wallet.
 */

import { API_URL } from "@/config";
import { sharedInAppWallet } from "@/lib/inAppWalletClient";

const LEGACY_TOKEN_KEY = "wog:agent:jwt";
const LEGACY_EXPIRY_KEY = "wog:agent:jwt:expiry";

function walletKey(walletAddress: string): string {
  return `wog:agent:jwt:${walletAddress.toLowerCase()}`;
}

function expiryKey(walletAddress: string): string {
  return `wog:agent:jwt:expiry:${walletAddress.toLowerCase()}`;
}

export function getCachedToken(walletAddress: string): string | null {
  try {
    const expiry = Number(localStorage.getItem(expiryKey(walletAddress)) ?? "0");
    if (Date.now() > expiry - 300_000) {
      // Expired or about to expire — clear
      localStorage.removeItem(walletKey(walletAddress));
      localStorage.removeItem(expiryKey(walletAddress));
      return null;
    }
    const token = localStorage.getItem(walletKey(walletAddress));
    if (token) return token;

    // Legacy fallback (single-token cache) is intentionally discarded to avoid
    // cross-wallet token reuse after multi-account sessions.
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_EXPIRY_KEY);

    return null;
  } catch {
    return null;
  }
}

function cacheToken(walletAddress: string, token: string): void {
  try {
    // JWT lasts 24h; cache for 23h
    localStorage.setItem(walletKey(walletAddress), token);
    localStorage.setItem(expiryKey(walletAddress), String(Date.now() + 23 * 3_600_000));
  } catch {}
}

export function clearCachedToken(walletAddress?: string): void {
  try {
    if (walletAddress) {
      localStorage.removeItem(walletKey(walletAddress));
      localStorage.removeItem(expiryKey(walletAddress));
    } else {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("wog:agent:jwt:")) keysToRemove.push(k);
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(LEGACY_EXPIRY_KEY);
    }
  } catch {}
}

/**
 * Get (or refresh) a JWT for the given wallet address by signing a challenge
 * with the shared in-app wallet.
 */
export async function getAuthToken(walletAddress: string): Promise<string | null> {
  // Return cached token if still valid
  const cached = getCachedToken(walletAddress);
  if (cached) return cached;

  try {
    // Get challenge
    const challengeRes = await fetch(
      `${API_URL}/auth/challenge?wallet=${walletAddress}`
    );
    if (!challengeRes.ok) return null;
    const { message, timestamp } = await challengeRes.json();

    // Sign with in-app wallet
    const account = await sharedInAppWallet.getAccount();
    if (!account) return null;
    if (account.address.toLowerCase() !== walletAddress.toLowerCase()) {
      console.warn(`[agentAuth] Wallet mismatch: connected=${account.address} requested=${walletAddress}`);
      return null;
    }

    const signature = await account.signMessage({ message });

    // Verify + get token
    const verifyRes = await fetch(`${API_URL}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, signature, timestamp }),
    });
    if (!verifyRes.ok) return null;

    const { token } = await verifyRes.json();
    if (token) cacheToken(walletAddress, token);
    return token ?? null;
  } catch (err) {
    console.warn("[agentAuth] Failed to get token:", err);
    return null;
  }
}
