/**
 * One-time deployment script for WoG contracts on SKALE Base Sepolia.
 * Run: npx tsx src/deploy.ts
 *
 * Deploys:
 * 1. TokenERC20 — "WoG Gold" (GOLD)
 * 2. TokenERC1155 — "WoG Items" (WOGI)
 *
 * After deployment, paste the printed addresses into .env.
 */
import "dotenv/config";
import { deployPublishedContract } from "thirdweb/deploys";
import { privateKeyToAccount } from "thirdweb/wallets";
import { thirdwebClient, skaleBaseSepolia } from "./chain.js";

const rawAccount = privateKeyToAccount({
  client: thirdwebClient,
  privateKey: process.env.SERVER_PRIVATE_KEY!,
});

// Wrap account to force gas limit to 1M — required by this SKALE chain
const serverAccount: typeof rawAccount = {
  ...rawAccount,
  async sendTransaction(tx) {
    return rawAccount.sendTransaction({ ...tx, gas: 10_000_000n });
  },
};

async function main() {
  const serverAddress = serverAccount.address;
  console.log(`Deploying from server wallet: ${serverAddress}`);

  // GOLD + ITEMS already deployed — skip to Characters
  const goldAddress = "0x421699e71bBeC7d05FCbc79C690afD5D8585f182";
  const itemsAddress = "0xAe68cdA079fd699780506cc49381EE732837Ec35";
  console.log(`  GOLD_CONTRACT_ADDRESS=${goldAddress} (already deployed)`);
  console.log(`  ITEMS_CONTRACT_ADDRESS=${itemsAddress} (already deployed)`);

  console.log("\nDeploying TokenERC721 (WoG Characters)...");
  const characterAddress = await deployPublishedContract({
    client: thirdwebClient,
    chain: skaleBaseSepolia,
    account: serverAccount,
    contractId: "TokenERC721",
    contractParams: {
      _defaultAdmin: serverAddress,
      _name: "WoG Characters",
      _symbol: "WOGC",
      _contractURI: "",
      _trustedForwarders: [],
      _primarySaleRecipient: serverAddress,
      _saleRecipient: serverAddress,
      _royaltyRecipient: serverAddress,
      _royaltyBps: 0n,
      _platformFeeBps: 0n,
      _platformFeeRecipient: serverAddress,
    },
  });
  console.log(`  CHARACTER_CONTRACT_ADDRESS=${characterAddress}`);

  console.log("\nDone! Paste these into shard/.env");
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
