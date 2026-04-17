import "../config/devLocalContracts.js";
import { ethers } from "ethers";
import { BITE } from "@skalenetwork/bite";
import { createManagedFeeProvider } from "./feePolicy.js";

/** SKALE Base Mainnet (ID 1187947933) — BITE V2 encryption */
export const SKALE_BASE_CHAIN_ID = Number(process.env.SKALE_BASE_CHAIN_ID || 1187947933);

export const SKALE_BASE_RPC_URL =
  process.env.SKALE_BASE_RPC_URL ||
  "https://skale-base.skalenodes.com/v1/base";

/** JSON-RPC provider for SKALE Base mainnet. */
export const biteProvider = createManagedFeeProvider(SKALE_BASE_RPC_URL);

export const biteSigner = process.env.SERVER_PRIVATE_KEY
  ? new ethers.Wallet(process.env.SERVER_PRIVATE_KEY, biteProvider)
  : null;

/** Server wallet on SKALE Base mainnet.
 *  Wrapped in NonceManager to prevent nonce collisions from concurrent transactions
 *  (auction house, guild, reputation all share this signer). */
export const biteWallet = biteSigner
  ? new ethers.NonceManager(biteSigner)
  : null;

if (!biteWallet) {
  console.warn("[skaleBase] SERVER_PRIVATE_KEY not set — chain wallet disabled");
}

/** BITE SDK instance for encrypting values (V1 on mainnet). */
export const bite = new BITE(SKALE_BASE_RPC_URL);

export interface BiteRpcProbeResult {
  ok: boolean;
  rpcUrl: string;
  chainId: number | null;
  latestBlock: number | null;
  error: string | null;
}

export async function probeBiteRpc(timeoutMs = 5_000): Promise<BiteRpcProbeResult> {
  try {
    const result = await Promise.race([
      (async () => {
        const [network, latestBlock] = await Promise.all([
          biteProvider.getNetwork(),
          biteProvider.getBlockNumber(),
        ]);
        return {
          ok: true,
          rpcUrl: SKALE_BASE_RPC_URL,
          chainId: Number(network.chainId),
          latestBlock: Number(latestBlock),
          error: null,
        } satisfies BiteRpcProbeResult;
      })(),
      new Promise<BiteRpcProbeResult>((resolve) => {
        setTimeout(() => resolve({
          ok: false,
          rpcUrl: SKALE_BASE_RPC_URL,
          chainId: null,
          latestBlock: null,
          error: `probe timeout after ${timeoutMs}ms`,
        }), timeoutMs);
      }),
    ]);
    return result;
  } catch (err) {
    return {
      ok: false,
      rpcUrl: SKALE_BASE_RPC_URL,
      chainId: null,
      latestBlock: null,
      error: err instanceof Error ? err.message : String(err ?? "unknown error"),
    };
  }
}
