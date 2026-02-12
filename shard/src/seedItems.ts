/**
 * One-time script to create the initial token IDs on the ERC-1155 contract.
 * Run: npx tsx src/seedItems.ts
 *
 * This mints 0 supply of each item to register its tokenId + metadata on-chain.
 */
import "dotenv/config";
import { getContract, sendTransaction } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { mintTo } from "thirdweb/extensions/erc1155";
import { thirdwebClient, skaleBaseSepolia } from "./chain.js";
import { ITEM_CATALOG } from "./itemCatalog.js";

const serverAccount = privateKeyToAccount({
  client: thirdwebClient,
  privateKey: process.env.SERVER_PRIVATE_KEY!,
});

const itemsContract = getContract({
  client: thirdwebClient,
  chain: skaleBaseSepolia,
  address: process.env.ITEMS_CONTRACT_ADDRESS!,
});

async function main() {
  const serverAddress = serverAccount.address;

  // Each call to the high-level mintTo creates the next tokenId (0, 1, 2, ...)
  // Mint 1 to the server wallet to register metadata on-chain.
  for (const item of ITEM_CATALOG) {
    console.log(`Seeding tokenId ${item.tokenId}: ${item.name}...`);
    const tx = mintTo({
      contract: itemsContract,
      to: serverAddress,
      supply: 1n,
      nft: {
        name: item.name,
        description: item.description,
      },
    });
    const receipt = await sendTransaction({ transaction: tx, account: serverAccount });
    console.log(`  tx: ${receipt.transactionHash}`);
  }

  console.log("\nAll items seeded!");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
