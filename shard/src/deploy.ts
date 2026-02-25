/**
 * One-time deployment script for WoG contracts on SKALE Base mainnet.
 * Run: npx tsx src/deploy.ts
 *
 * Deploys:
 * 1. TokenERC20  — "WoG Gold" (GOLD)
 * 2. TokenERC1155 — "WoG Items" (WOGI)
 * 3. TokenERC721  — "WoG Characters" (WOGC)
 *
 * After deployment, paste the printed addresses into .env.
 */
import "dotenv/config";
import { deployPublishedContract } from "thirdweb/deploys";
import { privateKeyToAccount } from "thirdweb/wallets";
import { thirdwebClient, skaleBase } from "./chain.js";

const rawAccount = privateKeyToAccount({
  client: thirdwebClient,
  privateKey: process.env.SERVER_PRIVATE_KEY!,
});

// Wrap account to force gas limit — required by SKALE
const serverAccount: typeof rawAccount = {
  ...rawAccount,
  async sendTransaction(tx) {
    return rawAccount.sendTransaction({ ...tx, gas: 10_000_000n });
  },
};

async function main() {
  const serverAddress = serverAccount.address;
  console.log(`Deploying from server wallet: ${serverAddress}`);

  // 1. Deploy GOLD (ERC-20)
  console.log("\nDeploying TokenERC20 (WoG Gold)...");
  const goldAddress = await deployPublishedContract({
    client: thirdwebClient,
    chain: skaleBase,
    account: serverAccount,
    contractId: "TokenERC20",
    contractParams: {
      _defaultAdmin: serverAddress,
      _name: "WoG Gold",
      _symbol: "GOLD",
      _contractURI: "",
      _trustedForwarders: [],
      _primarySaleRecipient: serverAddress,
      _platformFeeBps: 0n,
      _platformFeeRecipient: serverAddress,
    },
  });
  console.log(`  GOLD_CONTRACT_ADDRESS=${goldAddress}`);

  // 2. Deploy WOGI (ERC-1155)
  console.log("\nDeploying TokenERC1155 (WoG Items)...");
  const itemsAddress = await deployPublishedContract({
    client: thirdwebClient,
    chain: skaleBase,
    account: serverAccount,
    contractId: "TokenERC1155",
    contractParams: {
      _defaultAdmin: serverAddress,
      _name: "WoG Items",
      _symbol: "WOGI",
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
  console.log(`  ITEMS_CONTRACT_ADDRESS=${itemsAddress}`);

  // 3. Deploy WOGC (ERC-721)
  console.log("\nDeploying TokenERC721 (WoG Characters)...");
  const characterAddress = await deployPublishedContract({
    client: thirdwebClient,
    chain: skaleBase,
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
