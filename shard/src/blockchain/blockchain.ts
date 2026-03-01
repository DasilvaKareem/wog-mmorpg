import "dotenv/config";
import { getContract, prepareTransaction, sendTransaction } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import type { Account } from "thirdweb/wallets";
import { mintTo as mintERC20, transfer as transferERC20 } from "thirdweb/extensions/erc20";
import { getBalance } from "thirdweb/extensions/erc20";
import { mintAdditionalSupplyTo } from "thirdweb/extensions/erc1155";
import { mintTo as mintERC1155, nextTokenIdToMint } from "thirdweb/extensions/erc1155";
import { balanceOf as balanceOfERC1155, burn } from "thirdweb/extensions/erc1155";
import { mintTo as mintERC721, setTokenURI } from "thirdweb/extensions/erc721";
import { getOwnedNFTs } from "thirdweb/extensions/erc721";
import type { CharacterStats } from "../character/classes.js";
import { ITEM_CATALOG } from "../items/itemCatalog.js";
import { toWei } from "thirdweb/utils";
import { upload } from "thirdweb/storage";
import { thirdwebClient, skaleBase } from "./chain.js";
import { biteProvider } from "./biteChain.js";
import { ethers } from "ethers";

// SKALE-specific JSON-RPC provider to fetch the correct gas price for SKALE transactions
const skaleProvider = new ethers.JsonRpcProvider("https://skale-base.skalenodes.com/v1/base");
import { getNFT } from "thirdweb/extensions/erc721";

// =============================================================================
//  Balance Cache — avoids redundant RPC reads (TTL-based eviction)
// =============================================================================

interface CacheEntry<T> { value: T; expiresAt: number }

class BalanceCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return undefined; }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Invalidate all entries for an address (prefix match) */
  invalidate(addressPrefix: string): void {
    const prefix = addressPrefix.toLowerCase();
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Evict expired entries (call periodically) */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

const goldCache = new BalanceCache<string>(10_000);     // 10s TTL
const itemCache = new BalanceCache<bigint>(10_000);      // 10s TTL
const characterCache = new BalanceCache<any[]>(30_000);  // 30s TTL
const ownershipLookupWarnAt = new Map<string, number>();

// Promise coalescing — if a read is already in-flight, concurrent callers reuse the same promise
const inflightGold = new Map<string, Promise<string>>();
const inflightItem = new Map<string, Promise<bigint>>();

const ERC721_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function shouldLogOwnershipWarning(address: string, ttlMs = 60_000): boolean {
  const key = address.toLowerCase();
  const now = Date.now();
  const prev = ownershipLookupWarnAt.get(key) ?? 0;
  if (now - prev < ttlMs) return false;
  ownershipLookupWarnAt.set(key, now);
  return true;
}

// Prune expired entries every 60s to prevent unbounded growth
setInterval(() => { goldCache.prune(); itemCache.prune(); characterCache.prune(); }, 60_000);

// Server wallet — holds minter role on both contracts
const serverAccount = privateKeyToAccount({
  client: thirdwebClient,
  privateKey: process.env.SERVER_PRIVATE_KEY!,
});

// =============================================================================
//  Transaction Stats — track every on-chain tx
// =============================================================================

export interface TxStats {
  total: number;
  goldMints: number;
  goldTransfers: number;
  itemMints: number;
  itemBurns: number;
  characterMints: number;
  metadataUpdates: number;
  sfuelDistributions: number;
  itemSeeds: number;
  startedAt: number;
  recentTxs: Array<{ type: string; hash: string; ts: number }>;
}

const txStats: TxStats = {
  total: 0,
  goldMints: 0,
  goldTransfers: 0,
  itemMints: 0,
  itemBurns: 0,
  characterMints: 0,
  metadataUpdates: 0,
  sfuelDistributions: 0,
  itemSeeds: 0,
  startedAt: Date.now(),
  recentTxs: [],
};

function recordTx(type: string, hash: string) {
  txStats.total++;
  txStats.recentTxs.push({ type, hash, ts: Date.now() });
  if (txStats.recentTxs.length > 50) txStats.recentTxs.shift();
}

export function getTxStats(): TxStats & { uptime: string; txPerMinute: string } {
  const uptimeMs = Date.now() - txStats.startedAt;
  const uptimeMin = uptimeMs / 60000;
  const txPerMin = uptimeMin > 0 ? (txStats.total / uptimeMin).toFixed(2) : "0";
  const hours = Math.floor(uptimeMs / 3600000);
  const mins = Math.floor((uptimeMs % 3600000) / 60000);
  return { ...txStats, uptime: `${hours}h ${mins}m`, txPerMinute: txPerMin };
}

/**
 * Transaction queue — serializes all server-wallet transactions to prevent
 * nonce collisions on SKALE.  Each call to `queueTransaction` waits for every
 * earlier transaction to settle before sending the next one.  On nonce errors
 * it retries up to 3 times with short back-off.
 */
let txChain: Promise<void> = Promise.resolve();

const NONCE_ERROR_CODES = [-32004, -32000, -32603]; // common nonce / replacement error codes
const MAX_RETRIES = 3;

async function queueTransaction<T>(fn: () => Promise<T>): Promise<T> {
  let resolve!: (v: void) => void;
  const gate = new Promise<void>((r) => { resolve = r; });
  const prev = txChain;
  txChain = gate;

  await prev; // wait for all earlier txs to finish

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fn();
      resolve();
      return result;
    } catch (err: any) {
      lastError = err;
      const code = err?.code ?? err?.cause?.code ?? err?.data?.code;
      const msg = String(err?.message ?? err ?? "");
      const isNonceError =
        NONCE_ERROR_CODES.includes(code) ||
        msg.includes("nonce") ||
        msg.includes("replacement transaction");

      if (isNonceError && attempt < MAX_RETRIES) {
        const delay = 1000 * 2 ** attempt; // 1s, 2s, 4s
        console.warn(
          `[blockchain] Nonce error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  resolve(); // unblock queue even on failure
  throw lastError;
}

const goldContract = getContract({
  client: thirdwebClient,
  chain: skaleBase,
  address: process.env.GOLD_CONTRACT_ADDRESS!,
});

const itemsContract = getContract({
  client: thirdwebClient,
  chain: skaleBase,
  address: process.env.ITEMS_CONTRACT_ADDRESS!,
});

// Default dust amount for gas funding. Override via SFUEL_DISTRIBUTION_AMOUNT if needed.
const SFUEL_DISTRIBUTION_AMOUNT = process.env.SFUEL_DISTRIBUTION_AMOUNT || "0.001";
const TX_GAS_PRICE_CACHE_MS = 5_000;
let cachedGasPrice: { value: bigint; expiresAt: number } | null = null;

const itemByTokenId = new Map(ITEM_CATALOG.map((item) => [item.tokenId, item]));
let seedingPromise: Promise<void> | null = null;

/** Read nextTokenIdToMint with retry for transient RPC errors (SKALE 0x). */
async function safeNextTokenIdToMint(retries = 5): Promise<bigint> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await nextTokenIdToMint({ contract: itemsContract });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      const isTransient = msg.includes("zero data") || msg.includes("AbiDecoding") || msg.includes("0x");
      if (isTransient && attempt < retries) {
        const delay = 3000 * 2 ** attempt; // 3s, 6s, 12s, 24s, 48s
        console.warn(`[blockchain] nextTokenIdToMint RPC error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("safeNextTokenIdToMint: exhausted retries");
}

async function ensureItemTokenIdExists(targetTokenId: bigint): Promise<void> {
  const seedTask = async () => {
    let nextId = await safeNextTokenIdToMint();
    while (nextId <= targetTokenId) {
      const item = itemByTokenId.get(nextId);
      if (!item) {
        throw new Error(
          `No catalog entry found for tokenId ${nextId.toString()}`
        );
      }

      const receipt = await queueTransaction(async () => {
        const tx = mintERC1155({
          contract: itemsContract,
          to: serverAccount.address,
          supply: 1n,
          nft: {
            name: item.name,
            description: item.description,
          },
        });
        return sendTransactionWithManagedGas(tx, serverAccount);
      });
      txStats.itemSeeds++;
      recordTx("item-seed", receipt.transactionHash);
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

    const nextId = await safeNextTokenIdToMint();
    if (nextId > targetTokenId) return;
  }
}

/**
 * Resolve an explicit gasPrice and force legacy tx fee mode.
 * This avoids automatic EIP-1559 maxFee inflation (baseFee * 2 + tip),
 * which can make affordability checks fail for otherwise valid txs.
 */
async function resolveManagedGasPrice(): Promise<bigint> {
  const now = Date.now();
  if (cachedGasPrice && cachedGasPrice.expiresAt > now) {
    return cachedGasPrice.value;
  }

  // Query gas price from SKALE chain (where gold/items live), not BITE governance chain
  try {
    const feeData = await skaleProvider.getFeeData();
    if (feeData.gasPrice && feeData.gasPrice > 0n) {
      const buffered = (feeData.gasPrice * 125n) / 100n; // +25% buffer
      cachedGasPrice = {
        value: buffered,
        expiresAt: now + TX_GAS_PRICE_CACHE_MS,
      };
      return buffered;
    }
  } catch {
    // fallback to raw eth_gasPrice
  }

  const hexGasPrice = await skaleProvider.send("eth_gasPrice", []);
  const gasPrice = BigInt(hexGasPrice);
  if (gasPrice <= 0n) {
    throw new Error(`Invalid eth_gasPrice response: ${String(hexGasPrice)}`);
  }

  const buffered = (gasPrice * 125n) / 100n; // +25% buffer
  cachedGasPrice = {
    value: buffered,
    expiresAt: now + TX_GAS_PRICE_CACHE_MS,
  };
  return buffered;
}

async function sendTransactionWithManagedGas(
  transaction: any,
  account: Account
): Promise<Awaited<ReturnType<typeof sendTransaction>>> {
  const gasPrice = await resolveManagedGasPrice();
  const tx = {
    ...transaction,
    gasPrice,
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
    type: "legacy" as const,
  };
  return sendTransaction({ transaction: tx, account });
}

/**
 * Send a small amount of sFUEL so the wallet can transact on SKALE.
 * SKALE sFUEL is the native gas token — free, but wallets need a dust amount.
 */
export async function distributeSFuel(toAddress: string): Promise<string> {
  return queueTransaction(async () => {
    const tx = prepareTransaction({
      to: toAddress,
      value: toWei(SFUEL_DISTRIBUTION_AMOUNT),
      chain: skaleBase,
      client: thirdwebClient,
    });
    const receipt = await sendTransactionWithManagedGas(tx, serverAccount);
    txStats.sfuelDistributions++;
    recordTx("sfuel", receipt.transactionHash);
    return receipt.transactionHash;
  });
}

/** Mint gold (ERC-20) to a player address. `amount` is in whole tokens (e.g. "50"). */
export async function mintGold(toAddress: string, amount: string): Promise<string> {
  return queueTransaction(async () => {
    const tx = mintERC20({
      contract: goldContract,
      to: toAddress,
      amount,
    });
    const receipt = await sendTransactionWithManagedGas(tx, serverAccount);
    txStats.goldMints++;
    recordTx("gold-mint", receipt.transactionHash);
    goldCache.invalidate(toAddress.toLowerCase());
    return receipt.transactionHash;
  });
}

/** Get gold balance for a player address. Returns formatted string (e.g. "50.0"). Cached 10s. */
export async function getGoldBalance(address: string): Promise<string> {
  const cacheKey = address.toLowerCase();
  const cached = goldCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Promise coalescing — reuse in-flight request for the same address
  const inflight = inflightGold.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async (): Promise<string> => {
    // SKALE RPC sometimes returns 0x (empty data) transiently — retry up to 3 times
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const result = await getBalance({ contract: goldContract, address });
        goldCache.set(cacheKey, result.displayValue);
        return result.displayValue;
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        const isTransient = msg.includes("zero data") || msg.includes("AbiDecoding") || msg.includes("0x");
        if (isTransient && attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // 500ms, 1s, 2s
          continue;
        }
        if (isTransient) {
          if (shouldLogOwnershipWarning(address)) {
            console.warn(`[blockchain] getGoldBalance RPC error for ${address} after retries, returning 0: ${msg.slice(0, 120)}`);
          }
          return "0";
        }
        throw err;
      }
    }
    return "0";
  })();

  inflightGold.set(cacheKey, promise);
  promise.finally(() => inflightGold.delete(cacheKey));
  return promise;
}

/**
 * Transfer gold (ERC-20) from a custodial wallet to another address.
 * Uses the sender's account to sign — no new gold is minted.
 */
export async function transferGoldFrom(
  fromAccount: import("thirdweb/wallets").Account,
  toAddress: string,
  amount: string
): Promise<string> {
  const tx = transferERC20({
    contract: goldContract,
    to: toAddress,
    amount,
  });
  const receipt = await sendTransactionWithManagedGas(tx, fromAccount);
  txStats.goldTransfers++;
  recordTx("gold-transfer", receipt.transactionHash);
  goldCache.invalidate(fromAccount.address.toLowerCase());
  goldCache.invalidate(toAddress.toLowerCase());
  return receipt.transactionHash;
}

/** Mint an ERC-1155 item to a player address (existing tokenId). */
export async function mintItem(
  toAddress: string,
  tokenId: bigint,
  quantity: bigint
): Promise<string> {
  await ensureItemTokenIdExists(tokenId);
  return queueTransaction(async () => {
    const tx = mintAdditionalSupplyTo({
      contract: itemsContract,
      to: toAddress,
      tokenId,
      supply: quantity,
    });
    const receipt = await sendTransactionWithManagedGas(tx, serverAccount);
    txStats.itemMints++;
    recordTx("item-mint", receipt.transactionHash);
    itemCache.invalidate(toAddress.toLowerCase());
    return receipt.transactionHash;
  });
}

/** Get item balance for a specific tokenId. Cached 10s. */
export async function getItemBalance(
  address: string,
  tokenId: bigint
): Promise<bigint> {
  const cacheKey = `${address.toLowerCase()}:${tokenId}`;
  const cached = itemCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Promise coalescing — reuse in-flight request for the same address:tokenId
  const inflight = inflightItem.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async (): Promise<bigint> => {
    try {
      const balance = await balanceOfERC1155({ contract: itemsContract, owner: address, tokenId });
      itemCache.set(cacheKey, balance);
      return balance;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      // SKALE RPC sometimes returns 0x (empty data) — treat as 0
      if (msg.includes("zero data") || msg.includes("AbiDecoding") || msg.includes("0x")) {
        return 0n;
      }
      throw err;
    }
  })();

  inflightItem.set(cacheKey, promise);
  promise.finally(() => inflightItem.delete(cacheKey));
  return promise;
}

/** Burn (destroy) ERC-1155 items from a player address. */
export async function burnItem(
  fromAddress: string,
  tokenId: bigint,
  quantity: bigint
): Promise<string> {
  return queueTransaction(async () => {
    const tx = burn({
      contract: itemsContract,
      account: fromAddress,
      id: tokenId,
      value: quantity,
    });
    const receipt = await sendTransactionWithManagedGas(tx, serverAccount);
    txStats.itemBurns++;
    recordTx("item-burn", receipt.transactionHash);
    itemCache.invalidate(fromAddress.toLowerCase());
    return receipt.transactionHash;
  });
}

// --- ERC-721 Character NFTs ---

const characterContract = getContract({
  client: thirdwebClient,
  chain: skaleBase,
  address: process.env.CHARACTER_CONTRACT_ADDRESS!,
});

/** getLogs with automatic chunking if the RPC enforces a block range limit. */
async function paginatedGetLogs(
  address: string,
  topics: (string | null)[],
  latestBlock: bigint,
): Promise<ethers.Log[]> {
  // Try the full range first — most RPCs allow it
  try {
    return await biteProvider.getLogs({ address, fromBlock: 0, toBlock: latestBlock, topics });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    if (!msg.includes("Block range") && !msg.includes("block range") && !msg.includes("too many")) {
      throw err;
    }
  }

  // RPC enforces a 2000-block limit — paginate accordingly
  const chunkSize = 1999n;
  const all: ethers.Log[] = [];
  for (let from = 0n; from <= latestBlock; from += chunkSize + 1n) {
    const to = from + chunkSize > latestBlock ? latestBlock : from + chunkSize;
    const logs = await biteProvider.getLogs({ address, fromBlock: from, toBlock: to, topics });
    all.push(...logs);
  }
  return all;
}

async function getOwnedCharacterTokenIdsFromTransfers(owner: string): Promise<bigint[]> {
  const normalized = owner.toLowerCase();
  const ownerTopic = ethers.zeroPadValue(normalized as `0x${string}`, 32);
  const contractAddress = process.env.CHARACTER_CONTRACT_ADDRESS!;

  const latestBlock = BigInt(await biteProvider.getBlockNumber());

  const [received, sent] = await Promise.all([
    paginatedGetLogs(contractAddress, [ERC721_TRANSFER_TOPIC, null, ownerTopic], latestBlock),
    paginatedGetLogs(contractAddress, [ERC721_TRANSFER_TOPIC, ownerTopic, null], latestBlock),
  ]);

  const owned = new Set<string>();
  for (const log of received) {
    const tokenTopic = log.topics?.[3];
    if (tokenTopic) owned.add(BigInt(tokenTopic).toString());
  }
  for (const log of sent) {
    const tokenTopic = log.topics?.[3];
    if (tokenTopic) owned.delete(BigInt(tokenTopic).toString());
  }

  return Array.from(owned).map((id) => BigInt(id));
}

/** Mint a character NFT (ERC-721) to a player address. Returns tx hash. */
export async function mintCharacter(
  toAddress: string,
  nft: { name: string; description: string; properties: Record<string, unknown> }
): Promise<string> {
  return queueTransaction(async () => {
    const tx = mintERC721({
      contract: characterContract,
      to: toAddress,
      nft,
    });
    const receipt = await sendTransactionWithManagedGas(tx, serverAccount);
    txStats.characterMints++;
    recordTx("character-mint", receipt.transactionHash);
    characterCache.invalidate(toAddress.toLowerCase());
    return receipt.transactionHash;
  });
}

/** Get all character NFTs owned by a wallet address. Cached 30s (empty results not cached). */
export async function getOwnedCharacters(address: string) {
  const cacheKey = address.toLowerCase();
  const cached = characterCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let nfts: any[] = [];
  try {
    // Primary: use thirdweb getOwnedNFTs (requires ERC721Enumerable)
    nfts = await getOwnedNFTs({ contract: characterContract, owner: address });
  } catch (err: any) {
    // Fallback: parse Transfer event logs (slow but always works)
    if (shouldLogOwnershipWarning(address)) {
      console.warn(`[blockchain] getOwnedNFTs failed for ${address}, trying Transfer logs: ${String(err?.message ?? "").slice(0, 120)}`);
    }
    try {
      const tokenIds = await getOwnedCharacterTokenIdsFromTransfers(address);
      if (tokenIds.length > 0) {
        const results = await Promise.all(
          tokenIds.map(async (tokenId) => {
            try { return await getNFT({ contract: characterContract, tokenId }); } catch { return null; }
          })
        );
        nfts = results.filter((nft): nft is NonNullable<typeof nft> => nft !== null);
      }
    } catch (fallbackErr: any) {
      if (shouldLogOwnershipWarning(address)) {
        console.warn(`[blockchain] getOwnedCharacters fallback failed for ${address}: ${String(fallbackErr?.message ?? "").slice(0, 120)}`);
      }
    }
  }

  // Don't cache empty results — a mint may be pending confirmation
  if (nfts.length > 0) {
    characterCache.set(cacheKey, nfts);
  }
  return nfts;
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

  return queueTransaction(async () => {
    const tx = setTokenURI({
      contract: characterContract,
      tokenId: entity.characterTokenId,
      uri,
    });
    const receipt = await sendTransactionWithManagedGas(tx, serverAccount);
    txStats.metadataUpdates++;
    recordTx("metadata-update", receipt.transactionHash);
    return receipt.transactionHash;
  });
}
