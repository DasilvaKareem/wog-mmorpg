import { defineChain, createThirdwebClient } from "thirdweb";
import type { Chain } from "thirdweb/chains";

export const skaleBase: Chain = defineChain({
  id: 1187947933,
  rpc: "https://skale-base.skalenodes.com/v1/base",
});

export const thirdwebClient = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});
