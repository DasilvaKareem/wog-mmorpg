/**
 * Client-side auth token management for agent API calls.
 * Obtains a JWT by challenge-signing with the thirdweb in-app wallet.
 */

import { API_URL } from "@/config";
import { sharedInAppWallet } from "@/lib/inAppWalletClient";

const TOKEN_KEY = "wog:agent:jwt";
const EXPIRY_KEY = "wog:agent:jwt:expiry";

export function getCachedToken(): string | null {
  try {
    const expiry = Number(localStorage.getItem(EXPIRY_KEY) ?? "0");
    if (Date.now() > expiry - 300_000) {
      // Expired or about to expire — clear
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      return null;
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function cacheToken(token: string): void {
  try {
    // JWT lasts 24h; cache for 23h
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + 23 * 3_600_000));
  } catch {}
}

export function clearCachedToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  } catch {}
}

/**
 * Get (or refresh) a JWT for the given wallet address by signing a challenge
 * with the shared in-app wallet.
 */
export async function getAuthToken(walletAddress: string): Promise<string | null> {
  // Return cached token if still valid
  const cached = getCachedToken();
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

    const signature = await account.signMessage({ message });

    // Verify + get token
    const verifyRes = await fetch(`${API_URL}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, signature, timestamp }),
    });
    if (!verifyRes.ok) return null;

    const { token } = await verifyRes.json();
    if (token) cacheToken(token);
    return token ?? null;
  } catch (err) {
    console.warn("[agentAuth] Failed to get token:", err);
    return null;
  }
}
