#!/usr/bin/env tsx
/**
 * Authentication Helper for AI Agents
 * Handles wallet signature authentication and JWT token management
 */

import { privateKeyToAccount } from "viem/accounts";

const API = process.env.API_URL || "http://localhost:3000";

/**
 * Authenticate with wallet signature and get JWT token
 */
export async function authenticateWithWallet(privateKey: string): Promise<string> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletAddress = account.address;

  // Step 1: Get challenge message
  const challengeRes = await fetch(`${API}/auth/challenge?wallet=${walletAddress}`);
  const challenge = await challengeRes.json();

  if (!challenge.message) {
    throw new Error("Failed to get authentication challenge");
  }

  // Step 2: Sign the message (local signing — no chain needed)
  const signature = await account.signMessage({
    message: challenge.message,
  });

  // Step 3: Verify signature and get JWT token
  const verifyRes = await fetch(`${API}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress,
      signature,
      timestamp: challenge.timestamp,
    }),
  });

  const result = await verifyRes.json();

  if (!result.success) {
    throw new Error("Authentication failed: " + (result.error || "Unknown error"));
  }

  console.log(`✅ Authenticated: ${walletAddress}`);
  console.log(`🔑 Token expires in: ${result.expiresIn}`);

  return result.token;
}

/**
 * Create authenticated API caller
 */
export function createAuthenticatedAPI(token: string) {
  return async function api(method: string, path: string, body?: any) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`API Error: ${error}`);
    }

    return res.json();
  };
}

/**
 * Test authentication
 */
export async function testAuth(privateKey: string): Promise<void> {
  console.log("🔐 Testing wallet authentication...\n");

  try {
    // Authenticate
    const token = await authenticateWithWallet(privateKey);

    // Create authenticated API
    const api = createAuthenticatedAPI(token);

    // Test token verification
    console.log("\n✅ Testing token verification...");
    const verify = await api("GET", "/auth/verify-token");
    console.log(`✅ Token valid for wallet: ${verify.walletAddress}`);

    console.log("\n🎉 Authentication system working!");
  } catch (err: any) {
    console.error("❌ Authentication failed:", err.message);
    throw err;
  }
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testKey = process.env.SERVER_PRIVATE_KEY;
  if (!testKey) {
    console.error("❌ Missing SERVER_PRIVATE_KEY in .env");
    process.exit(1);
  }

  testAuth(testKey).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
