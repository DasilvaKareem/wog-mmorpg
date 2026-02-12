import { defineChain, createThirdwebClient } from "thirdweb";
import type { Chain } from "thirdweb/chains";

export const skaleBaseSepolia: Chain = defineChain({
  id: 103698795,
  rpc: "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox",
});

export const thirdwebClient = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});
