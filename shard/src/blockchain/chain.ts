import "../config/devLocalContracts.js";
import { defineChain, createThirdwebClient } from "thirdweb";
import type { Chain } from "thirdweb/chains";

export const SKALE_BASE_CHAIN_ID = Number(process.env.SKALE_BASE_CHAIN_ID || 1187947933);
export const BASE_MAINNET_CHAIN_ID = 8453;

export const skaleBase: Chain = defineChain({
  id: SKALE_BASE_CHAIN_ID,
  rpc: process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base",
});

export const baseMainnet: Chain = defineChain({
  id: BASE_MAINNET_CHAIN_ID,
  rpc: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
});

export const thirdwebClient = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY || "local-dev-thirdweb-key",
});
