/**
 * Shared thirdweb client + in-app wallet singleton.
 * Using a single instance ensures autoConnect restores the same session.
 */
import { createThirdwebClient, defineChain } from "thirdweb";
import { inAppWallet } from "thirdweb/wallets";

export const thirdwebClient = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID || "placeholder",
});

export const skaleChain = defineChain({
  id: 1187947933,
  rpc: "https://skale-base.skalenodes.com/v1/base",
});

// Singleton wallet — both OnboardingFlow and auto-connect use this same instance
export const sharedInAppWallet = inAppWallet();
