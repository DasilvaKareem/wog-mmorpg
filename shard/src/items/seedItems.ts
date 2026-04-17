/**
 * Seeder for ERC-1155 item definitions.
 * Run: npx tsx src/seedItems.ts
 *
 * Game tokenIds are catalog IDs. Chain tokenIds are dense, append-only IDs
 * managed by itemTokenMapping.ts and seeded in that order.
 */
import "dotenv/config";
import "../config/devLocalContracts.js";
import { getContract, sendTransaction } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { mintTo, nextTokenIdToMint } from "thirdweb/extensions/erc1155";
import { thirdwebClient, skaleBase } from "../blockchain/chain.js";
import { createManagedFeeProvider, resolveManagedFeeOverrides, toManagedTxFeeFields } from "../blockchain/feePolicy.js";
import { getCatalogItemsInChainOrder } from "./itemTokenMapping.js";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const DEV_ENABLED = TRUE_VALUES.has((process.env.DEV ?? "").trim().toLowerCase());

function toInlineMetadataUri(metadata: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
}

const serverAccount = privateKeyToAccount({
  client: thirdwebClient,
  privateKey: process.env.SERVER_PRIVATE_KEY!,
});

const itemsContract = getContract({
  client: thirdwebClient,
  chain: skaleBase,
  address: process.env.ITEMS_CONTRACT_ADDRESS!,
});
const skaleProvider = createManagedFeeProvider(
  process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base"
);

function isNonceConflict(err: any): boolean {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return msg.includes("same nonce") || msg.includes("invalid transaction nonce");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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
    for (let attempt = 0; attempt < 10; attempt++) {
      const currentNextChainTokenId = await nextTokenIdToMint({ contract: itemsContract });
      if (currentNextChainTokenId > chainTokenId) {
        console.log(
          `  chain tokenId ${chainTokenId.toString()} already exists after retry; continuing`
        );
        nextChainTokenId = currentNextChainTokenId;
        break;
      }
      if (currentNextChainTokenId < chainTokenId) {
        if (attempt === 9) {
          throw new Error(
            `Contract nextTokenIdToMint remained at ${currentNextChainTokenId.toString()} while waiting to seed expected chain tokenId ${chainTokenId.toString()}`
          );
        }
        const delayMs = 3000 * (attempt + 1);
        console.warn(
          `  waiting for chain tokenId ${chainTokenId.toString()} to become available (currently ${currentNextChainTokenId.toString()}), retrying in ${delayMs}ms`
        );
        await sleep(delayMs);
        continue;
      }

      try {
        const nftMetadata = {
          name: item.name,
          description: item.description,
        };
        const tx = mintTo({
          contract: itemsContract,
          to: serverAddress,
          supply: 1n,
          nft: DEV_ENABLED ? toInlineMetadataUri(nftMetadata) : nftMetadata,
        });
        const managedFees = await resolveManagedFeeOverrides(skaleProvider);
        const txFees = toManagedTxFeeFields(managedFees);
        const txWithManagedFees: any = { ...tx, ...txFees };
        delete txWithManagedFees.type;
        const receipt = await sendTransaction({
          transaction: txWithManagedFees,
          account: serverAccount,
        });
        console.log(`  tx: ${receipt.transactionHash}`);
        nextChainTokenId = chainTokenId + 1n;
        break;
      } catch (err: any) {
        if (!isNonceConflict(err) || attempt === 9) {
          throw err;
        }
        const delayMs = 3000 * (attempt + 1);
        console.warn(
          `  nonce conflict while seeding chain tokenId ${chainTokenId.toString()}, retrying in ${delayMs}ms`
        );
        await sleep(delayMs);
      }
    }
  }

  console.log("\nAll items seeded!");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
