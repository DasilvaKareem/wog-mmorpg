import { ethers } from "ethers";
import { BITE } from "@skalenetwork/bite";

/** BITE v2 Sandbox chain (ID 103698795) */
export const BITE_V2_CHAIN_ID = 103698795;

const BITE_V2_RPC =
  process.env.BITE_V2_RPC_URL ||
  "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2";

/** JSON-RPC provider for the BITE v2 sandbox chain. */
export const biteProvider = new ethers.JsonRpcProvider(BITE_V2_RPC);

/** Server wallet on the BITE v2 sandbox chain (same private key, different chain). */
export const biteWallet = new ethers.Wallet(
  process.env.SERVER_PRIVATE_KEY!,
  biteProvider
);

/** BITE SDK instance for encrypting values. */
export const bite = new BITE(BITE_V2_RPC);
