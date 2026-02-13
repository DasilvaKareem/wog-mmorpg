import "dotenv/config";
import { getContract, prepareTransaction, sendTransaction } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { mintTo as mintERC20 } from "thirdweb/extensions/erc20";
import { getBalance } from "thirdweb/extensions/erc20";
import { mintAdditionalSupplyTo } from "thirdweb/extensions/erc1155";
import { mintTo as mintERC1155, nextTokenIdToMint } from "thirdweb/extensions/erc1155";
import { balanceOf as balanceOfERC1155, burn } from "thirdweb/extensions/erc1155";
import { mintTo as mintERC721, setTokenURI } from "thirdweb/extensions/erc721";
import { getOwnedNFTs } from "thirdweb/extensions/erc721";
import type { CharacterStats } from "./classes.js";
import { ITEM_CATALOG } from "./itemCatalog.js";
import { toWei } from "thirdweb/utils";
import { upload } from "thirdweb/storage";
import { thirdwebClient, skaleBaseSepolia } from "./chain.js";

// Server wallet — holds minter role on both contracts
const serverAccount = privateKeyToAccount({
  client: thirdwebClient,
  privateKey: process.env.SERVER_PRIVATE_KEY!,
});

const goldContract = getContract({
  client: thirdwebClient,
  chain: skaleBaseSepolia,
  address: process.env.GOLD_CONTRACT_ADDRESS!,
});

const itemsContract = getContract({
  client: thirdwebClient,
  chain: skaleBaseSepolia,
  address: process.env.ITEMS_CONTRACT_ADDRESS!,
});

const itemByTokenId = new Map(ITEM_CATALOG.map((item) => [item.tokenId, item]));
let seedingPromise: Promise<void> | null = null;

async function ensureItemTokenIdExists(targetTokenId: bigint): Promise<void> {
  const seedTask = async () => {
    let nextId = await nextTokenIdToMint({ contract: itemsContract });
    while (nextId <= targetTokenId) {
      const item = itemByTokenId.get(nextId);
      if (!item) {
        throw new Error(
          `No catalog entry found for tokenId ${nextId.toString()}`
        );
      }

      const tx = mintERC1155({
        contract: itemsContract,
        to: serverAccount.address,
        supply: 1n,
        nft: {
          name: item.name,
          description: item.description,
        },
      });

      const receipt = await sendTransaction({ transaction: tx, account: serverAccount });
      console.log(
        `[items] Seeded tokenId ${item.tokenId.toString()} (${item.name}): ${receipt.transactionHash}`
      );
      nextId += 1n;
    }
  };

  while (true) {
    if (!seedingPromise) {
      seedingPromise = seedTask().finally(() => {
        seedingPromise = null;
      });
    }

    await seedingPromise;

    const nextId = await nextTokenIdToMint({ contract: itemsContract });
    if (nextId > targetTokenId) return;
  }
}

/**
 * Send a small amount of sFUEL so the wallet can transact on SKALE.
 * SKALE sFUEL is the native gas token — free, but wallets need a dust amount.
 */
export async function distributeSFuel(toAddress: string): Promise<string> {
  const tx = prepareTransaction({
    to: toAddress,
    value: toWei("0.00001"),
    chain: skaleBaseSepolia,
    client: thirdwebClient,
  });
  const receipt = await sendTransaction({ transaction: tx, account: serverAccount });
  return receipt.transactionHash;
}

/** Mint gold (ERC-20) to a player address. `amount` is in whole tokens (e.g. "50"). */
export async function mintGold(toAddress: string, amount: string): Promise<string> {
  const tx = mintERC20({
    contract: goldContract,
    to: toAddress,
    amount,
  });
  const receipt = await sendTransaction({ transaction: tx, account: serverAccount });
  return receipt.transactionHash;
}

/** Get gold balance for a player address. Returns formatted string (e.g. "50.0"). */
export async function getGoldBalance(address: string): Promise<string> {
  const result = await getBalance({ contract: goldContract, address });
  return result.displayValue;
}

/** Mint an ERC-1155 item to a player address (existing tokenId). */
export async function mintItem(
  toAddress: string,
  tokenId: bigint,
  quantity: bigint
): Promise<string> {
  await ensureItemTokenIdExists(tokenId);
  const tx = mintAdditionalSupplyTo({
    contract: itemsContract,
    to: toAddress,
    tokenId,
    supply: quantity,
  });
  const receipt = await sendTransaction({ transaction: tx, account: serverAccount });
  return receipt.transactionHash;
}

/** Get item balance for a specific tokenId. */
export async function getItemBalance(
  address: string,
  tokenId: bigint
): Promise<bigint> {
  return balanceOfERC1155({ contract: itemsContract, owner: address, tokenId });
}

/** Burn (destroy) ERC-1155 items from a player address. */
export async function burnItem(
  fromAddress: string,
  tokenId: bigint,
  quantity: bigint
): Promise<string> {
  const tx = burn({
    contract: itemsContract,
    account: fromAddress,
    id: tokenId,
    value: quantity,
  });
  const receipt = await sendTransaction({ transaction: tx, account: serverAccount });
  return receipt.transactionHash;
}

// --- ERC-721 Character NFTs ---

const characterContract = getContract({
  client: thirdwebClient,
  chain: skaleBaseSepolia,
  address: process.env.CHARACTER_CONTRACT_ADDRESS!,
});

/** Mint a character NFT (ERC-721) to a player address. Returns tx hash. */
export async function mintCharacter(
  toAddress: string,
  nft: { name: string; description: string; properties: Record<string, unknown> }
): Promise<string> {
  const tx = mintERC721({
    contract: characterContract,
    to: toAddress,
    nft,
  });
  const receipt = await sendTransaction({ transaction: tx, account: serverAccount });
  return receipt.transactionHash;
}

/** Get all character NFTs owned by a wallet address. */
export async function getOwnedCharacters(address: string) {
  return getOwnedNFTs({ contract: characterContract, owner: address });
}

/** Update on-chain NFT metadata after a level-up. Uploads new metadata to IPFS and sets token URI. */
export async function updateCharacterMetadata(entity: {
  characterTokenId: bigint;
  name: string;
  raceId: string;
  classId: string;
  level: number;
  xp: number;
  stats: CharacterStats;
}): Promise<string> {
  const metadata = {
    name: entity.name,
    description: `Level ${entity.level} ${entity.raceId} ${entity.classId}`,
    properties: {
      race: entity.raceId,
      class: entity.classId,
      level: entity.level,
      xp: entity.xp,
      stats: entity.stats,
    },
  };

  const uri = await upload({ client: thirdwebClient, files: [metadata] });

  const tx = setTokenURI({
    contract: characterContract,
    tokenId: entity.characterTokenId,
    uri,
  });
  const receipt = await sendTransaction({ transaction: tx, account: serverAccount });
  return receipt.transactionHash;
}
