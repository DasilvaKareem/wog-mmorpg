import { ethers } from "ethers";
import { BITE } from "@skalenetwork/bite";

/** SKALE Base mainnet chain (ID 1187947933) — BITE V1 encryption */
export const SKALE_BASE_CHAIN_ID = 1187947933;

const SKALE_BASE_RPC =
  process.env.SKALE_BASE_RPC_URL ||
  "https://skale-base.skalenodes.com/v1/base";

/** JSON-RPC provider for SKALE Base mainnet. */
export const biteProvider = new ethers.JsonRpcProvider(SKALE_BASE_RPC);

/** Server wallet on SKALE Base mainnet.
 *  Wrapped in NonceManager to prevent nonce collisions from concurrent transactions
 *  (auction house, guild, reputation all share this signer). */
export const biteWallet = process.env.SERVER_PRIVATE_KEY
  ? new ethers.NonceManager(new ethers.Wallet(process.env.SERVER_PRIVATE_KEY, biteProvider))
  : null;

if (!biteWallet) {
  console.warn("[skaleBase] SERVER_PRIVATE_KEY not set — chain wallet disabled");
}

/** BITE SDK instance for encrypting values (V1 on mainnet). */
export const bite = new BITE(SKALE_BASE_RPC);
