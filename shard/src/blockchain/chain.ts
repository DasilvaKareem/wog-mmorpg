import "../config/devLocalContracts.js";
import { defineChain, createThirdwebClient } from "thirdweb";
import type { Chain } from "thirdweb/chains";

export const skaleBase: Chain = defineChain({
  id: Number(process.env.SKALE_BASE_CHAIN_ID || 1187947933),
  rpc: process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base",
});

export const thirdwebClient = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY || "local-dev-thirdweb-key",
});
