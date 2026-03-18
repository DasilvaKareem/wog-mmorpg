/**
 * Seeder for ERC-1155 item definitions.
 * Run: npx tsx src/seedItems.ts
 *
 * Game tokenIds are catalog IDs. Chain tokenIds are dense, append-only IDs
 * managed by itemTokenMapping.ts and seeded in that order.
 */
import "dotenv/config";
import { getContract, sendTransaction } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { mintTo, nextTokenIdToMint } from "thirdweb/extensions/erc1155";
import { thirdwebClient, skaleBase } from "../blockchain/chain.js";
import { getCatalogItemsInChainOrder } from "./itemTokenMapping.js";

const serverAccount = privateKeyToAccount({
  client: thirdwebClient,
  privateKey: process.env.SERVER_PRIVATE_KEY!,
});

const itemsContract = getContract({
  client: thirdwebClient,
  chain: skaleBase,
  address: process.env.ITEMS_CONTRACT_ADDRESS!,
});

async function main() {
  const serverAddress = serverAccount.address;
  const itemsInChainOrder = await getCatalogItemsInChainOrder();
  let nextChainTokenId = await nextTokenIdToMint({ contract: itemsContract });

  // Each mintTo call creates the next dense chain tokenId. Seed only the
  // missing definitions so the script is safe to re-run.
  for (const { item, gameTokenId, chainTokenId } of itemsInChainOrder) {
    if (chainTokenId < nextChainTokenId) {
      console.log(
        `Skipping game tokenId ${gameTokenId.toString()} (${item.name}) -> chain tokenId ${chainTokenId.toString()} [already seeded]`
      );
      continue;
    }

    if (chainTokenId > nextChainTokenId) {
      throw new Error(
        `Contract nextTokenIdToMint is ${nextChainTokenId.toString()}, but mapping expects chain tokenId ${chainTokenId.toString()} for game tokenId ${gameTokenId.toString()}`
      );
    }

    console.log(
      `Seeding game tokenId ${gameTokenId.toString()} (${item.name}) as chain tokenId ${chainTokenId.toString()}...`
    );
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
    nextChainTokenId += 1n;
  }

  console.log("\nAll items seeded!");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
