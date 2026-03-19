/**
 * MPP client — wraps fetch with Tempo 402 auto-payment.
 *
 * When a request returns 402 Payment Required, the mppx client
 * automatically signs a USDC payment transaction from the player's
 * wallet and replays the request with the payment credential.
 *
 * Players need USDC on Base (or Base Sepolia for testnet) in the
 * same wallet they use to play.
 */

import { Mppx, tempo } from "mppx/client";
import { sharedInAppWallet } from "./inAppWalletClient";
import { WalletManager } from "./walletManager";

let mppxInstance: ReturnType<typeof Mppx.create> | null = null;

/**
 * Get or create the mppx client instance.
 * Uses the player's connected wallet account for signing payments.
 */
async function getMppx() {
  // Try to get a viem-compatible account from thirdweb in-app wallet first
  let account = await sharedInAppWallet.getAccount();

  // Fall back to external wallet from WalletManager
  if (!account) {
    const ext = WalletManager.getInstance().account;
    if (ext) account = ext as any;
  }

  // Recreate if account changed or first init
  if (!mppxInstance || !account) {
    mppxInstance = Mppx.create({
      methods: [
        tempo.charge({
          account: account as any,
        }),
      ],
      polyfill: false, // Don't override global fetch
    });
  }

  return mppxInstance;
}

/**
 * Payment-aware fetch. Use this instead of regular fetch for
 * marketplace endpoints that may return 402.
 *
 * On 402: automatically signs a Tempo payment and replays the request.
 * On success: returns the response as normal.
 */
export async function mppFetch(
  url: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const client = await getMppx();
  if (!client) {
    // No wallet connected — fall back to regular fetch
    return fetch(url, init);
  }
  return client.fetch(url, init);
}

/**
 * Reset the mppx instance (call on wallet disconnect/change).
 */
export function resetMppClient(): void {
  mppxInstance = null;
}
