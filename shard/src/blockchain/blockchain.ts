import "dotenv/config";
import "../config/devLocalContracts.js";
import { getContract, prepareTransaction, sendTransaction } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import type { Account } from "thirdweb/wallets";
import { mintTo as mintERC20, transfer as transferERC20 } from "thirdweb/extensions/erc20";
import { getBalance } from "thirdweb/extensions/erc20";
import { mintAdditionalSupplyTo } from "thirdweb/extensions/erc1155";
import { mintTo as mintERC1155, nextTokenIdToMint } from "thirdweb/extensions/erc1155";
import { balanceOf as balanceOfERC1155, burn } from "thirdweb/extensions/erc1155";
import { getOwnedNFTs } from "thirdweb/extensions/erc721";
import type { CharacterStats } from "../character/classes.js";
import {
  getCatalogItemsInChainOrder,
  getChainTokenIdForGameTokenId,
} from "../items/itemTokenMapping.js";
import { toWei } from "thirdweb/utils";
import { upload } from "thirdweb/storage";
import { thirdwebClient, skaleBase } from "./chain.js";
import { biteProvider, biteSigner, biteWallet } from "./biteChain.js";
import { bumpServerNonceFloor, isLocalServerNonceMode, isTransientRpcSendError, queueAccountTransaction, queueBiteTransaction, queueServerWalletTransaction, reserveServerNonce, resetServerNonce, waitForBiteReceipt, waitForBiteSubmission } from "./biteTxQueue.js";
import { ethers } from "ethers";
import { OFFICIAL_IDENTITY_REGISTRY_ABI } from "../erc8004/official.js";
import { traceTx } from "./txTracer.js";
import {
  clearManagedFeeCache,
  createManagedFeeProvider,
  resolveManagedFeeOverrides,
} from "./feePolicy.js";
import { getCustodialWallet } from "./custodialWalletRedis.js";
import {
  createChainOperation,
  executeRegisteredChainOperation,
  registerChainOperationProcessor,
  type ChainOperationRecord,
  updateChainOperation,
} from "./chainOperationStore.js";
import { isPostgresConfigured } from "../db/postgres.js";
import {
  addWalletGold,
  addWalletItem,
  getWalletGoldBalance,
  getWalletItemBalance,
  subtractWalletGold,
  subtractWalletItem,
  transferWalletGold,
} from "../db/walletBalanceStore.js";

// SKALE-specific JSON-RPC provider to fetch the correct gas price for SKALE transactions
const skaleProvider = createManagedFeeProvider(
  process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base"
);
import { getNFT } from "thirdweb/extensions/erc721";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const DEV_ENABLED = TRUE_VALUES.has((process.env.DEV ?? "").trim().toLowerCase());
const INLINE_TEST_METADATA = DEV_ENABLED;

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

  /** Return the cached value even if expired (for fallback on RPC errors). */
  getStale(key: string): T | undefined {
    return this.store.get(key)?.value;
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

const goldCache = new BalanceCache<string>(60_000);     // 60s TTL (invalidated on mint/transfer/spend)
const itemCache = new BalanceCache<bigint>(60_000);      // 60s TTL (invalidated on mint/burn)
const characterCache = new BalanceCache<any[]>(30_000);  // 30s TTL
const ownershipLookupWarnAt = new Map<string, number>();

// Promise coalescing — if a read is already in-flight, concurrent callers reuse the same promise
const inflightGold = new Map<string, Promise<string>>();
const inflightItem = new Map<string, Promise<bigint>>();
const BOOTSTRAP_CHAIN_PRIORITY = 10;

const ERC721_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const IDENTITY_RECEIPT_TIMEOUT_MS = DEV_ENABLED ? 10_000 : 20_000;
const IDENTITY_RECEIPT_FAST_TIMEOUT_MS = DEV_ENABLED ? 8_000 : 10_000;
const IDENTITY_POST_SUBMIT_RECOVERY_TIMEOUT_MS = DEV_ENABLED ? 6_000 : 8_000;
const CHARACTER_WRITE_ABI = [
  "function mintTo(address to, string tokenUri) returns (uint256)",
  "function setTokenURI(uint256 tokenId, string tokenUri)",
];

async function resolveMintedCharacterTokenId(
  transactionHash: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const fullReceipt = await skaleProvider.getTransactionReceipt(transactionHash).catch(() => null);
    const transferLog = fullReceipt?.logs.find(
      (log) =>
        log.address.toLowerCase() === process.env.CHARACTER_CONTRACT_ADDRESS!.toLowerCase() &&
        log.topics[0] === ERC721_TRANSFER_TOPIC &&
        log.topics.length > 3
    );
    if (transferLog?.topics[3]) {
      return BigInt(transferLog.topics[3]).toString();
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  // Never infer the minted tokenId from unrelated transfers to the same wallet.
  // If the receipt is still unavailable, fall back to "unknown" and let the
  // higher-level recovery path rediscover the correct token from chain later.
  return null;
}

function extractMintedCharacterTokenIdFromReceipt(receipt: any): string | null {
  const transferLog = receipt?.logs?.find(
    (log: any) =>
      log?.address?.toLowerCase?.() === process.env.CHARACTER_CONTRACT_ADDRESS!.toLowerCase() &&
      log?.topics?.[0] === ERC721_TRANSFER_TOPIC &&
      log?.topics?.length > 3
  );
  if (transferLog?.topics?.[3]) {
    return BigInt(transferLog.topics[3]).toString();
  }
  return null;
}

export async function recoverCharacterTokenIdFromTransaction(
  transactionHash: string,
  timeoutMs = DEV_ENABLED ? 10_000 : 90_000,
  intervalMs = DEV_ENABLED ? 1_000 : 3_000,
): Promise<bigint | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tokenId = await resolveMintedCharacterTokenId(transactionHash).catch(() => null);
    if (tokenId != null) {
      return BigInt(tokenId);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

function toInlineMetadataUri(metadata: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
}

async function resolveCharacterMetadataUri(metadata: Record<string, unknown>): Promise<string> {
  if (INLINE_TEST_METADATA) {
    return toInlineMetadataUri(metadata);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const uploaded = await Promise.race<string | string[]>([
        upload({ client: thirdwebClient, files: [metadata as any] }) as Promise<string | string[]>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Metadata upload timed out (15s)")), 15_000)
        ),
      ]);
      if (Array.isArray(uploaded)) {
        if (!uploaded[0]) throw new Error("Metadata upload returned no URI");
        return uploaded[0];
      }
      return uploaded;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (
        (msg.includes("timed out") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed") || msg.includes("ECONNRESET"))
        && attempt < 2
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw new Error("Metadata upload failed after 3 attempts");
}

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

const MAX_RETRIES = 3;

async function queueTransaction<T>(account: Account, label: string, fn: () => Promise<T>): Promise<T> {
  return isServerSignerAccount(account)
    ? queueServerWalletTransaction(label, fn)
    : queueAccountTransaction(account.address, label, fn);
}

function isServerSignerAccount(account: Account): boolean {
  return account.address.toLowerCase() === serverAccount.address.toLowerCase();
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

const characterWriteContract = process.env.CHARACTER_CONTRACT_ADDRESS && biteSigner
  ? new ethers.Contract(process.env.CHARACTER_CONTRACT_ADDRESS, CHARACTER_WRITE_ABI, biteSigner)
  : null;

// Default dust amount for gas funding. Override via SFUEL_DISTRIBUTION_AMOUNT if needed.
// Keep the default conservative on testnet so repeated bootstrap/test runs do not
// drain the server wallet. Deployments can raise this explicitly if needed.
const SFUEL_DISTRIBUTION_AMOUNT = process.env.SFUEL_DISTRIBUTION_AMOUNT || "0.000001";
const AUTO_SFUEL_TOP_UP_MIN_BALANCE = ethers.parseEther(
  process.env.AUTO_SFUEL_TOP_UP_MIN_BALANCE || "0.01"
);
const AUTO_SFUEL_TOP_UP_TARGET_BALANCE = ethers.parseEther(
  process.env.AUTO_SFUEL_TOP_UP_TARGET_BALANCE || "0.05"
);
const inflightGasTopUps = new Map<string, Promise<void>>();

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

async function ensureItemTokenIdExists(targetChainTokenId: bigint): Promise<void> {
  const seedTask = async () => {
    const itemByChainTokenId = new Map(
      (await getCatalogItemsInChainOrder()).map(({ item, chainTokenId }) => [chainTokenId, item])
    );
    let nextId = await safeNextTokenIdToMint();
    while (nextId <= targetChainTokenId) {
      const item = itemByChainTokenId.get(nextId);
      if (!item) {
        throw new Error(
          `No catalog entry found for chain tokenId ${nextId.toString()}`
        );
      }

      const receipt = await queueTransaction(serverAccount, `item-seed:${item.tokenId.toString()}:${nextId.toString()}`, async () => {
        const nftMetadata = {
          name: item.name,
          description: item.description,
        };
        const tx = mintERC1155({
          contract: itemsContract,
          to: serverAccount.address,
          supply: 1n,
          nft: DEV_ENABLED ? toInlineMetadataUri(nftMetadata) : nftMetadata,
        });
        return sendTransactionWithManagedGas(tx, serverAccount);
      });
      txStats.itemSeeds++;
      recordTx("item-seed", receipt.transactionHash);
      console.log(
        `[items] Seeded game tokenId ${item.tokenId.toString()} as chain tokenId ${nextId.toString()} (${item.name}): ${receipt.transactionHash}`
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
    if (nextId > targetChainTokenId) return;
  }
}

async function sendTransactionWithManagedGas(
  transaction: any,
  account: Account
): Promise<Awaited<ReturnType<typeof sendTransaction>>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const managedNonce = isServerSignerAccount(account)
      ? await reserveServerNonce()
      : null;
    try {
      if (!isServerSignerAccount(account)) {
        await ensureAccountHasGasBalance(account.address);
      }
      const managedFees = await resolveManagedFeeOverrides(skaleProvider);
      const { gasPrice: _gasPrice, ...eip1559Fees } = managedFees;
      const tx = {
        ...transaction,
        gasPrice: undefined,
        ...eip1559Fees,
        type: undefined,
        nonce: managedNonce ?? undefined,
      };
      return await sendTransaction({ transaction: tx, account });
    } catch (err: any) {
      lastError = err;
      if (managedNonce != null) {
        err.attemptedNonce = managedNonce;
        if (String(err?.message ?? err ?? "").toLowerCase().includes("nonce")) {
          if (isLocalServerNonceMode()) {
            resetServerNonce();
          } else {
            bumpServerNonceFloor(managedNonce + 1);
          }
        }
      }
      if (!isServerSignerAccount(account) && isLowGasBalanceError(err)) {
        try {
          await ensureAccountHasGasBalance(account.address, { force: true });
          continue;
        } catch (topUpErr) {
          err.topUpError = topUpErr;
        }
      }
      if (!isTransientRpcSendError(err) || attempt >= MAX_RETRIES) {
        throw err;
      }
      clearManagedFeeCache(skaleProvider);
      const delay = 1000 * 2 ** attempt; // 1s, 2s, 4s
      console.warn(
        `[blockchain] sendTransaction transport error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// Minimum sFUEL a wallet must have before we bother distributing more.
// The gas cost to send sFUEL (~0.00125 sFUEL) far exceeds the distribution
// amount (0.000001 sFUEL), so skip if the wallet already has enough to transact.
const SFUEL_SKIP_THRESHOLD = parseFloat(process.env.SFUEL_SKIP_THRESHOLD || "0.0001");

function isLowGasBalanceError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return msg.includes("Account balance is too low")
    || msg.includes("insufficient funds for gas");
}

async function topUpAccountGasBalance(toAddress: string, amountWei: bigint): Promise<void> {
  if (amountWei <= 0n) return;
  const tx = prepareTransaction({
    to: toAddress,
    value: amountWei,
    chain: skaleBase,
    client: thirdwebClient,
  });
  await queueTransaction(serverAccount, `sfuel-auto-topup:${toAddress.toLowerCase()}:${amountWei.toString()}`, async () => {
    await sendTransactionWithManagedGas(tx, serverAccount);
  });
}

async function ensureAccountHasGasBalance(
  address: string,
  options?: { force?: boolean }
): Promise<void> {
  const normalized = address.toLowerCase();
  if (normalized === serverAccount.address.toLowerCase()) return;

  const existing = inflightGasTopUps.get(normalized);
  if (existing) {
    await existing;
    return;
  }

  const topUpPromise = (async () => {
    const balance = await biteProvider.getBalance(normalized);
    const minimum = options?.force ? AUTO_SFUEL_TOP_UP_TARGET_BALANCE : AUTO_SFUEL_TOP_UP_MIN_BALANCE;
    if (balance >= minimum) return;

    const target = AUTO_SFUEL_TOP_UP_TARGET_BALANCE > minimum
      ? AUTO_SFUEL_TOP_UP_TARGET_BALANCE
      : minimum;
    const deficit = target - balance;
    if (deficit <= 0n) return;

    await topUpAccountGasBalance(normalized, deficit);
    console.log(`[sfuel] Auto-topped ${normalized} by ${ethers.formatEther(deficit)} sFUEL`);
  })();

  inflightGasTopUps.set(normalized, topUpPromise);
  try {
    await topUpPromise;
  } finally {
    if (inflightGasTopUps.get(normalized) === topUpPromise) {
      inflightGasTopUps.delete(normalized);
    }
  }
}

/**
 * Send a small amount of sFUEL so the wallet can transact on SKALE.
 * Skips the distribution (and its gas cost) if the recipient already has
 * enough sFUEL to cover several transactions.
 */
export async function distributeSFuel(toAddress: string): Promise<string> {
  try {
    const balance = await skaleProvider.getBalance(toAddress);
    const balEth = parseFloat(ethers.formatEther(balance));
    if (balEth >= SFUEL_SKIP_THRESHOLD) {
      console.log(`[distributeSFuel] Skipping ${toAddress.slice(0, 8)} — already has ${balEth.toFixed(6)} sFUEL`);
      return "skipped";
    }
  } catch {
    // RPC error — proceed with distribution rather than skipping
  }
  return executeRegisteredChainOperation(
    "sfuel-distribute",
    toAddress.toLowerCase(),
    { toAddress },
    { priority: BOOTSTRAP_CHAIN_PRIORITY }
  );
}

export async function enqueueSfuelDistribution(toAddress: string): Promise<string> {
  const record = await createChainOperation(
    "sfuel-distribute",
    toAddress.toLowerCase(),
    { toAddress },
    { priority: BOOTSTRAP_CHAIN_PRIORITY }
  );
  return record.operationId;
}

/** Mint gold (ERC-20) to a player address. `amount` is in whole tokens (e.g. "50"). */
export async function mintGold(toAddress: string, amount: string): Promise<string> {
  if (isPostgresConfigured()) {
    await addWalletGold(toAddress, Number(amount));
    goldCache.invalidate(toAddress.toLowerCase());
  }
  return executeRegisteredChainOperation("gold-mint", `${toAddress.toLowerCase()}:${amount}`, { toAddress, amount });
}

export async function enqueueGoldMint(toAddress: string, amount: string): Promise<string> {
  if (isPostgresConfigured()) {
    await addWalletGold(toAddress, Number(amount));
    goldCache.invalidate(toAddress.toLowerCase());
  }
  const record = await createChainOperation(
    "gold-mint",
    `${toAddress.toLowerCase()}:${amount}`,
    { toAddress, amount },
    { priority: BOOTSTRAP_CHAIN_PRIORITY }
  );
  return record.operationId;
}

export async function getOnChainGoldBalance(address: string): Promise<string> {
  const cacheKey = address.toLowerCase();
  const cached = goldCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const inflight = inflightGold.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async (): Promise<string> => {
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const result = await getBalance({ contract: goldContract, address });
        goldCache.set(cacheKey, result.displayValue);
        return result.displayValue;
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        const code = String(err?.code ?? err?.cause?.code ?? err?.data?.code ?? "");
        const isTransient =
          msg.includes("zero data") ||
          msg.includes("AbiDecoding") ||
          msg.includes("0x") ||
          msg.includes("fetch failed") ||
          msg.includes("UND_ERR_SOCKET") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("socket hang up") ||
          code === "UND_ERR_SOCKET";
        if (isTransient && attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        if (isTransient) {
          const stale = goldCache.getStale(cacheKey);
          if (shouldLogOwnershipWarning(address)) {
            console.warn(`[blockchain] getGoldBalance RPC error for ${address} after retries, returning ${stale ? "stale" : "0"}: ${msg.slice(0, 120)}`);
          }
          if (stale !== undefined) {
            goldCache.set(cacheKey, stale);
            return stale;
          }
          return "0";
        }
        throw err;
      }
    }
    return goldCache.getStale(cacheKey) ?? "0";
  })();

  inflightGold.set(cacheKey, promise);
  void promise.finally(() => inflightGold.delete(cacheKey));
  return promise;
}

/** Get gold balance for a player address. Returns formatted string (e.g. "50.0"). Cached 10s. */
export async function getGoldBalance(address: string): Promise<string> {
  if (isPostgresConfigured()) {
    return String(await getWalletGoldBalance(address));
  }
  return await getOnChainGoldBalance(address);
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
  if (isPostgresConfigured()) {
    await transferWalletGold(fromAccount.address, toAddress, Number(amount));
    goldCache.invalidate(fromAccount.address.toLowerCase());
    goldCache.invalidate(toAddress.toLowerCase());
  }
  return executeRegisteredChainOperation("gold-transfer", `${fromAccount.address.toLowerCase()}:${toAddress.toLowerCase()}:${amount}`, {
    fromAddress: fromAccount.address,
    toAddress,
    amount,
  });
}

export async function enqueueGoldTransferFrom(
  fromAddress: string,
  toAddress: string,
  amount: string,
  options?: { priority?: number }
): Promise<string> {
  if (isPostgresConfigured()) {
    await transferWalletGold(fromAddress, toAddress, Number(amount));
    goldCache.invalidate(fromAddress.toLowerCase());
    goldCache.invalidate(toAddress.toLowerCase());
  }
  const record = await createChainOperation(
    "gold-transfer",
    `${fromAddress.toLowerCase()}:${toAddress.toLowerCase()}:${amount}`,
    {
      fromAddress,
      toAddress,
      amount,
    },
    { priority: options?.priority }
  );
  return record.operationId;
}

/** Mint an ERC-1155 item to a player address using the catalog/game tokenId. */
export async function mintItem(
  toAddress: string,
  tokenId: bigint,
  quantity: bigint
): Promise<string> {
  if (isPostgresConfigured()) {
    await addWalletItem(toAddress, tokenId, quantity);
    itemCache.invalidate(toAddress.toLowerCase());
  }
  return executeRegisteredChainOperation("item-mint", `${toAddress.toLowerCase()}:${tokenId.toString()}:${quantity.toString()}`, {
    toAddress,
    tokenId: tokenId.toString(),
    quantity: quantity.toString(),
  });
}

export async function enqueueItemMint(
  toAddress: string,
  tokenId: bigint,
  quantity: bigint
): Promise<string> {
  if (isPostgresConfigured()) {
    await addWalletItem(toAddress, tokenId, quantity);
    itemCache.invalidate(toAddress.toLowerCase());
  }
  const record = await createChainOperation("item-mint", `${toAddress.toLowerCase()}:${tokenId.toString()}:${quantity.toString()}`, {
    toAddress,
    tokenId: tokenId.toString(),
    quantity: quantity.toString(),
  });
  return record.operationId;
}

/** Get item balance for a catalog/game tokenId. Cached 10s. */
export async function getOnChainItemBalance(
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
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const chainTokenId = await getChainTokenIdForGameTokenId(tokenId);
        const balance = await balanceOfERC1155({
          contract: itemsContract,
          owner: address,
          tokenId: chainTokenId,
        });
        itemCache.set(cacheKey, balance);
        return balance;
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        const code = String(err?.code ?? err?.cause?.code ?? err?.data?.code ?? "");
        const isTransient =
          msg.includes("zero data") ||
          msg.includes("AbiDecoding") ||
          msg.includes("0x") ||
          msg.includes("fetch failed") ||
          msg.includes("UND_ERR_SOCKET") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("socket hang up") ||
          code === "UND_ERR_SOCKET";

        if (isTransient && attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        if (isTransient) {
          const stale = itemCache.getStale(cacheKey);
          if (stale !== undefined) {
            itemCache.set(cacheKey, stale);
            return stale;
          }
          return 0n;
        }
        throw err;
      }
    }
    return itemCache.getStale(cacheKey) ?? 0n;
  })();

  inflightItem.set(cacheKey, promise);
  void promise.then(
    () => inflightItem.delete(cacheKey),
    () => inflightItem.delete(cacheKey)
  );
  return promise;
}

/** Get authoritative item balance for a catalog/game tokenId. */
export async function getItemBalance(
  address: string,
  tokenId: bigint
): Promise<bigint> {
  if (isPostgresConfigured()) {
    return await getWalletItemBalance(address, tokenId);
  }
  return await getOnChainItemBalance(address, tokenId);
}

/** Burn (destroy) ERC-1155 items from a player address.
 *  Signs with the player's own custodial account so the ERC-1155 contract
 *  recognises the caller as the token owner.  Falls back to server account
 *  for non-custodial addresses (shouldn't happen in practice).
 *  `tokenId` is the catalog/game tokenId. */
export async function burnItem(
  fromAddress: string,
  tokenId: bigint,
  quantity: bigint
): Promise<string> {
  if (isPostgresConfigured()) {
    await subtractWalletItem(fromAddress, tokenId, quantity);
    itemCache.invalidate(fromAddress.toLowerCase());
  }
  return executeRegisteredChainOperation("item-burn", `${fromAddress.toLowerCase()}:${tokenId.toString()}:${quantity.toString()}`, {
    fromAddress,
    tokenId: tokenId.toString(),
    quantity: quantity.toString(),
  });
}

export async function enqueueItemBurn(
  fromAddress: string,
  tokenId: bigint,
  quantity: bigint
): Promise<string> {
  if (isPostgresConfigured()) {
    await subtractWalletItem(fromAddress, tokenId, quantity);
    itemCache.invalidate(fromAddress.toLowerCase());
  }
  const record = await createChainOperation("item-burn", `${fromAddress.toLowerCase()}:${tokenId.toString()}:${quantity.toString()}`, {
    fromAddress,
    tokenId: tokenId.toString(),
    quantity: quantity.toString(),
  });
  return record.operationId;
}

// --- ERC-8004 Identity Registry (IdentityRegistryUpgradeable / AgentIdentity) ---

const identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS;
const identityRegistryContract = identityRegistryAddress && (biteSigner ?? biteWallet)
  ? new ethers.Contract(identityRegistryAddress, OFFICIAL_IDENTITY_REGISTRY_ABI, biteSigner ?? biteWallet)
  : null;

if (identityRegistryAddress) {
  console.log(`[blockchain] Identity registry (ERC-8004) at ${identityRegistryAddress}`);
} else {
  console.warn("[blockchain] IDENTITY_REGISTRY_ADDRESS not set — identity registration disabled");
}

export interface IdentityRegistrationResult {
  agentId: bigint | null;
  txHash: string | null;
  agentUri: string | null;
}

export interface IdentityRegistrationOptions {
  beforeTransfer?: (agentId: bigint) => Promise<void>;
  validationTags?: string[];
}

interface CharacterMintPayload {
  toAddress: string;
  nft: { name: string; description: string; properties: Record<string, unknown> };
}

interface IdentityRegistrationPayload {
  characterTokenId: string;
  ownerAddress: string;
  metadataURI: string;
  validationTags: string[];
}

interface CharacterMintProcessorResult {
  txHash: string;
  tokenId: string | null;
}

interface IdentityRegistrationProcessorResult {
  agentId: string | null;
  txHash: string | null;
  agentUri: string | null;
}

function extractAgentIdFromIdentityReceipt(receipt: any): bigint | null {
  const registeredEvent = receipt?.logs?.find(
    (log: any) =>
      log?.fragment?.name === "Registered" ||
      log?.topics?.[0] === ethers.id("Registered(uint256,string,address)")
  );
  const agentId = registeredEvent?.args?.[0]
    ?? (registeredEvent?.topics?.[1] ? BigInt(registeredEvent.topics[1]) : null);
  return agentId != null ? BigInt(agentId) : null;
}

async function recoverIdentityRegistrationByTxHash(
  txHash: string,
  agentUri: string,
  timeoutMs = IDENTITY_POST_SUBMIT_RECOVERY_TIMEOUT_MS,
  intervalMs = 1_000,
): Promise<IdentityRegistrationProcessorResult | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await biteProvider.getTransactionReceipt(txHash).catch(() => null);
    if (receipt) {
      const agentId = extractAgentIdFromIdentityReceipt(receipt);
      if (agentId != null) {
        return {
          agentId: agentId.toString(),
          txHash,
          agentUri,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

interface CharacterMetadataPayload {
  characterTokenId: string;
  name: string;
  raceId: string;
  classId: string;
  level: number;
  xp: number;
  stats: CharacterStats;
}

async function processCharacterMintPayload(payload: CharacterMintPayload): Promise<CharacterMintProcessorResult> {
  return traceTx("character-mint", "mintCharacter", { to: payload.toAddress, name: payload.nft.name }, "skale", async () => {
    if (!characterWriteContract) {
      throw new Error("Character write contract unavailable");
    }
    const tokenUri = await resolveCharacterMetadataUri(payload.nft);
    const receipt = await queueBiteTransaction(`character-mint:${payload.toAddress.toLowerCase()}`, async () => {
      const managedFees = await resolveManagedFeeOverrides(skaleProvider);
      const tx = await waitForBiteSubmission(
        characterWriteContract.mintTo(payload.toAddress, tokenUri, {
          ...managedFees,
          nonce: await reserveServerNonce() ?? undefined,
        })
      );
      return await waitForBiteReceipt(tx.wait(), DEV_ENABLED ? 10_000 : 60_000);
    });
    const txHash = String((receipt as any).hash ?? (receipt as any).transactionHash);
    txStats.characterMints++;
    recordTx("character-mint", txHash);
    characterCache.invalidate(payload.toAddress.toLowerCase());
    const tokenId =
      extractMintedCharacterTokenIdFromReceipt(receipt) ??
      await resolveMintedCharacterTokenId(txHash);
    return {
      txHash,
      tokenId,
    };
  });
}

async function processIdentityRegistrationPayload(
  payload: IdentityRegistrationPayload,
  record?: ChainOperationRecord,
): Promise<IdentityRegistrationProcessorResult> {
  if (!identityRegistryAddress || !(biteSigner ?? biteWallet) || !biteWallet) {
    return { agentId: null, txHash: null, agentUri: null };
  }
  if (!ethers.isAddress(payload.ownerAddress)) {
    throw new Error(`Invalid owner address: ${payload.ownerAddress}`);
  }

  const characterTokenId = BigInt(payload.characterTokenId);
  const serverAddress = await (biteWallet as ethers.NonceManager).getAddress();
  const identityWriteProvider = createManagedFeeProvider(
    process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base"
  );
  const identityWriteSigner = process.env.SERVER_PRIVATE_KEY
    ? new ethers.Wallet(process.env.SERVER_PRIVATE_KEY, identityWriteProvider)
    : null;
  const identityWriteContract = new ethers.Contract(
    identityRegistryAddress,
    OFFICIAL_IDENTITY_REGISTRY_ABI,
    identityWriteSigner ?? biteSigner ?? biteWallet
  );
  const base = process.env.WOG_SHARD_URL || "https://wog.urbantech.dev";
  const agentURI = `${base}/a2a/${payload.ownerAddress}`;
  const metadataEntries = [
    {
      metadataKey: "characterTokenId",
      metadataValue: ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [characterTokenId]),
    },
    {
      metadataKey: "metadataURI",
      metadataValue: ethers.AbiCoder.defaultAbiCoder().encode(["string"], [payload.metadataURI]),
    },
  ];

  const findExistingIdentityWithTimeout = async (
    requestedOwner?: string,
    timeoutMs = DEV_ENABLED ? 1_500 : 2_500
  ) => {
    return await Promise.race<
      Awaited<ReturnType<typeof findIdentityByCharacterTokenId>> | null
    >([
      findIdentityByCharacterTokenId(characterTokenId, requestedOwner).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  };

  const reuseExistingIdentity = async (): Promise<IdentityRegistrationProcessorResult | null> => {
    const existingForOwner = await findExistingIdentityWithTimeout(payload.ownerAddress);
    if (existingForOwner?.agentId) {
      return {
        agentId: existingForOwner.agentId.toString(),
        txHash: null,
        agentUri: existingForOwner.agentUri ?? agentURI,
      };
    }

    const existing = await findExistingIdentityWithTimeout(undefined, DEV_ENABLED ? 2_000 : 3_000);
    if (!existing?.agentId) return null;

    const currentOwner = existing.ownerAddress?.toLowerCase() ?? null;
    const desiredOwner = payload.ownerAddress.toLowerCase();
    const serverOwner = serverAddress.toLowerCase();

    if (currentOwner === desiredOwner) {
      return {
        agentId: existing.agentId.toString(),
        txHash: null,
        agentUri: existing.agentUri ?? agentURI,
      };
    }

    if (currentOwner !== serverOwner) {
      return null;
    }

    await traceTx("identity-transfer", "transferIdentity", { agentId: existing.agentId.toString(), to: payload.ownerAddress }, "bite", () =>
      queueBiteTransaction(`identity-transfer:${existing.agentId}`, async () =>
        waitForBiteSubmission(identityWriteContract.transferFrom(
          serverAddress,
          payload.ownerAddress,
          existing.agentId,
          { nonce: await reserveServerNonce() ?? undefined }
        ))
          .then((tx: any) => waitForBiteReceipt(tx.wait()))
      )
    );
    console.log(`[identity] Recovered and transferred agent #${existing.agentId} -> ${payload.ownerAddress}`);
    return {
      agentId: existing.agentId.toString(),
      txHash: null,
      agentUri: existing.agentUri ?? agentURI,
    };
  };

  const waitForExistingIdentity = async (
    timeoutMs = IDENTITY_POST_SUBMIT_RECOVERY_TIMEOUT_MS,
    intervalMs = 1_500
  ): Promise<IdentityRegistrationProcessorResult | null> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const recovered = await reuseExistingIdentity();
      if (recovered) {
        return recovered;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  };

  const alreadyOwned = await reuseExistingIdentity();
  if (alreadyOwned) {
    return alreadyOwned;
  }

  const submitIdentityMetadataUpdate = async (agentId: bigint): Promise<void> => {
    const tx = await traceTx(
      "identity-setMetadata",
      "setCharacterTokenId",
      { agentId: agentId.toString(), characterTokenId: characterTokenId.toString() },
      "bite",
      () =>
        queueBiteTransaction(`identity-metadata:${agentId}`, async () =>
          await waitForBiteSubmission(
            identityWriteContract.setMetadata(
              agentId,
              "characterTokenId",
              ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [characterTokenId]),
              { nonce: await reserveServerNonce() ?? undefined }
            )
          )
        )
    );

    void waitForBiteReceipt(tx.wait(), IDENTITY_RECEIPT_TIMEOUT_MS)
      .then(() => console.log(`[identity] Set characterTokenId=${characterTokenId} metadata on agent #${agentId}`))
      .catch((err) =>
        console.warn(`[identity] Metadata receipt failed for agent #${agentId}: ${(err as Error).message?.slice(0, 120)}`)
      );
  };

  const submitIdentityTransfer = async (agentId: bigint): Promise<void> => {
    const tx = await traceTx(
      "identity-transfer",
      "transferIdentity",
      { agentId: agentId.toString(), to: payload.ownerAddress },
      "bite",
      () =>
        queueBiteTransaction(`identity-transfer:${agentId}`, async () =>
          await waitForBiteSubmission(
            identityWriteContract.transferFrom(
              serverAddress,
              payload.ownerAddress,
              agentId,
              { nonce: await reserveServerNonce() ?? undefined }
            )
          )
        )
    );

    void waitForBiteReceipt(tx.wait(), IDENTITY_RECEIPT_TIMEOUT_MS)
      .then(() => console.log(`[identity] Transferred agent #${agentId} -> ${payload.ownerAddress}`))
      .catch(async (err) => {
        const currentOwner = await getIdentityOwner(agentId).catch(() => null);
        if (currentOwner?.toLowerCase() !== payload.ownerAddress.toLowerCase()) {
          console.warn(`[identity] Transfer receipt failed for agent #${agentId}: ${(err as Error).message?.slice(0, 120)}`);
        }
      });
  };

  const scheduleIdentityFollowUps = (agentId: bigint): void => {
    void (async () => {
      try {
        await submitIdentityMetadataUpdate(agentId);
      } catch (err) {
        console.warn(`[identity] Failed to submit metadata update for agent #${agentId}: ${(err as Error).message?.slice(0, 120)}`);
      }

      if (payload.ownerAddress.toLowerCase() !== serverAddress.toLowerCase()) {
        try {
          await submitIdentityTransfer(agentId);
        } catch (err) {
          const currentOwner = await getIdentityOwner(agentId).catch(() => null);
          if (currentOwner?.toLowerCase() !== payload.ownerAddress.toLowerCase()) {
            console.warn(`[identity] Failed to submit transfer for agent #${agentId}: ${(err as Error).message?.slice(0, 120)}`);
          }
        }
      }
    })();
  };

  let receipt: any = null;
  let submittedTxHash: string | null = null;
  try {
    const registerTx = await traceTx("identity-register", "registerIdentity", { characterTokenId: characterTokenId.toString(), owner: payload.ownerAddress }, "bite", () => queueBiteTransaction(`identity-register:${characterTokenId}`, async () => {
      const registerTx = await waitForBiteSubmission(
        identityWriteContract["register(string)"](
          agentURI,
          { nonce: await reserveServerNonce() ?? undefined }
        )
      );
      return registerTx;
    }));
    submittedTxHash = registerTx.hash ?? null;
    if (!submittedTxHash) {
      throw new Error(`Identity registration submission returned no tx hash for character ${characterTokenId.toString()}`);
    }
    if (record) {
      await updateChainOperation(record.operationId, { txHash: submittedTxHash });
    }
    receipt = await waitForBiteReceipt(registerTx.wait(), IDENTITY_RECEIPT_FAST_TIMEOUT_MS).catch(() => null);
  } catch (err) {
    if (submittedTxHash) {
      const recoveredFromTx = await recoverIdentityRegistrationByTxHash(submittedTxHash, agentURI);
      if (recoveredFromTx) {
        return recoveredFromTx;
      }
    }
    const recovered = await waitForExistingIdentity();
    if (recovered) {
      return recovered;
    }
    throw err;
  }

  if (!receipt) {
    if (submittedTxHash) {
      const recoveredFromTx = await recoverIdentityRegistrationByTxHash(submittedTxHash, agentURI);
      if (recoveredFromTx) {
        return recoveredFromTx;
      }
    }
    const recovered = await waitForExistingIdentity();
    if (recovered) {
      return recovered;
    }
    throw new Error(`Identity registration receipt not available for tx ${submittedTxHash}`);
  }

  const agentId = extractAgentIdFromIdentityReceipt(receipt);

  if (agentId == null) {
    const recovered = await waitForExistingIdentity();
    if (recovered) {
      return recovered;
    }
    console.warn(`[identity] Registered but could not extract agentId from tx ${receipt.hash}`);
    return { agentId: null, txHash: receipt.hash, agentUri: agentURI };
  }

  console.log(`[identity] Registered agent #${agentId} for character ${characterTokenId} -> tx ${receipt.hash}`);
  scheduleIdentityFollowUps(BigInt(agentId));

  return { agentId: BigInt(agentId).toString(), txHash: receipt.hash, agentUri: agentURI };
}

async function processCharacterMetadataPayload(payload: CharacterMetadataPayload): Promise<string> {
  return traceTx(
    "metadata-update",
    "updateCharacterMetadata",
    { tokenId: payload.characterTokenId, name: payload.name, level: payload.level },
    "skale",
    async () => {
      if (!characterWriteContract) {
        throw new Error("Character write contract unavailable");
      }
      const metadata = {
        name: payload.name,
        description: `Level ${payload.level} ${payload.raceId} ${payload.classId}`,
        properties: {
          race: payload.raceId,
          class: payload.classId,
          level: payload.level,
          xp: payload.xp,
          stats: payload.stats,
        },
      };

      const uri = await resolveCharacterMetadataUri(metadata);

      const tx = await queueBiteTransaction(`character-metadata:${payload.characterTokenId}`, async () => {
        const managedFees = await resolveManagedFeeOverrides(skaleProvider);
        return await waitForBiteSubmission(
          characterWriteContract.setTokenURI(BigInt(payload.characterTokenId), uri, {
            ...managedFees,
            nonce: await reserveServerNonce() ?? undefined,
          })
        );
      });
      const receipt = await waitForBiteReceipt(tx.wait(), DEV_ENABLED ? 10_000 : 90_000);
      const txHash = String((receipt as any).hash ?? (receipt as any).transactionHash);
      txStats.metadataUpdates++;
      recordTx("metadata-update", txHash);
      lastSyncedLevel.set(payload.characterTokenId, payload.level);
      return txHash;
    }
  );
}

async function waitForCharacterMetadataReceiptByHash(
  txHash: string,
  timeoutMs = DEV_ENABLED ? 10_000 : 90_000,
  intervalMs = 3_000,
): Promise<ethers.TransactionReceipt> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await skaleProvider.getTransactionReceipt(txHash).catch(() => null);
    if (receipt) {
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for on-chain receipt after ${timeoutMs}ms`);
}

/**
 * Register an agent identity on the ERC-8004 identity registry.
 * Uses the metadata-aware registration path when available, then transfers
 * the minted identity NFT to the character owner.
 */
export async function registerIdentity(
  characterTokenId: bigint,
  ownerAddress: string,
  metadataURI: string,
  options?: IdentityRegistrationOptions
): Promise<IdentityRegistrationResult> {
  if (!identityRegistryContract || !biteWallet) {
    return { agentId: null, txHash: null, agentUri: null };
  }

  const recoverExistingIdentity = async (
    timeoutMs = DEV_ENABLED ? 5_000 : 20_000,
    intervalMs = 1_500
  ): Promise<IdentityRegistrationResult | null> => {
    const desiredOwner = ownerAddress.toLowerCase();
    const serverAddress = await biteWallet!.getAddress();
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const existing = await Promise.race([
        findIdentityByCharacterTokenId(characterTokenId, ownerAddress).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (existing?.agentId != null) {
        return {
          agentId: existing.agentId,
          txHash: null,
          agentUri: existing.agentUri,
        };
      }

      const anyOwnerIdentity = await Promise.race([
        findIdentityByCharacterTokenId(characterTokenId).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (anyOwnerIdentity?.agentId != null) {
        const currentOwner = anyOwnerIdentity.ownerAddress?.toLowerCase() ?? null;
        if (currentOwner === desiredOwner) {
          return {
            agentId: anyOwnerIdentity.agentId,
            txHash: null,
            agentUri: anyOwnerIdentity.agentUri,
          };
        }
        if (currentOwner === serverAddress.toLowerCase() && desiredOwner !== currentOwner) {
          try {
            await queueBiteTransaction(`identity-transfer:${anyOwnerIdentity.agentId}`, async () =>
              waitForBiteSubmission(identityRegistryContract.transferFrom(
                serverAddress,
                ownerAddress,
                anyOwnerIdentity.agentId,
                { nonce: await reserveServerNonce() ?? undefined }
              ))
                .then((tx: any) => waitForBiteReceipt(tx.wait(), IDENTITY_RECEIPT_TIMEOUT_MS).catch(() => null))
            );
          } catch {}
          return {
            agentId: anyOwnerIdentity.agentId,
            txHash: null,
            agentUri: anyOwnerIdentity.agentUri,
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  };

  try {
    const existing = await Promise.race([
      findIdentityByCharacterTokenId(characterTokenId, ownerAddress).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    if (existing) {
      return { ...existing, txHash: null };
    }

    const validationTags = options?.validationTags ?? [];
    const result = await executeRegisteredChainOperation<IdentityRegistrationProcessorResult>(
      "identity-register",
      `${characterTokenId.toString()}:${ownerAddress.toLowerCase()}`,
      {
        characterTokenId: characterTokenId.toString(),
        ownerAddress,
        metadataURI,
        validationTags,
      } satisfies IdentityRegistrationPayload,
      { priority: BOOTSTRAP_CHAIN_PRIORITY }
    );
    if (result.agentId == null) {
      const recovered = await recoverExistingIdentity();
      if (recovered) return recovered;
      throw new Error(`Identity registration completed without agentId for character ${characterTokenId.toString()}`);
    }
    if (result.agentId != null && options?.beforeTransfer && validationTags.length === 0) {
      await options.beforeTransfer(BigInt(result.agentId));
    }
    return {
      agentId: result.agentId != null ? BigInt(result.agentId) : null,
      txHash: result.txHash,
      agentUri: result.agentUri,
    };
  } catch (err: any) {
    const recovered = await recoverExistingIdentity();
    if (recovered) {
      return recovered;
    }
    throw err;
  }
}

/**
 * Read the A2A endpoint (agentURI) for a given agent identity from the ERC-8004 registry.
 * Returns the URL string or null if not set / contract unavailable.
 */
export async function getA2AEndpoint(agentId: bigint): Promise<string | null> {
  if (!identityRegistryContract) return null;
  try {
    const uri: string = await identityRegistryContract.tokenURI(agentId);
    return uri || null;
  } catch {
    return null;
  }
}

/**
 * Update the A2A endpoint (agentURI) for a registered agent identity.
 * Fire-and-forget safe — logs errors but never throws.
 */
export async function setA2AEndpoint(agentId: bigint, endpointUrl: string): Promise<string | null> {
  if (!identityRegistryContract) return null;
  try {
    return await executeRegisteredChainOperation("identity-agent-uri", agentId.toString(), {
      agentId: agentId.toString(),
      endpointUrl,
    });
  } catch (err: any) {
    console.warn(`[identity] Failed to set A2A endpoint for agent #${agentId}: ${err.message?.slice(0, 80)}`);
    return null;
  }
}

/**
 * Look up the agent wallet address for a given agent identity.
 */
export async function getAgentWallet(agentId: bigint): Promise<string | null> {
  if (!identityRegistryContract) return null;
  try {
    return await identityRegistryContract.getAgentWallet(agentId);
  } catch {
    return null;
  }
}

export async function getIdentityOwner(agentId: bigint): Promise<string | null> {
  if (!identityRegistryContract) return null;
  try {
    return await identityRegistryContract.ownerOf(agentId);
  } catch {
    return null;
  }
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
  fromBlock: bigint = 0n,
): Promise<ethers.Log[]> {
  // Try the full range first — most RPCs allow it
  try {
    return await biteProvider.getLogs({ address, fromBlock, toBlock: latestBlock, topics });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    if (!msg.includes("Block range") && !msg.includes("block range") && !msg.includes("too many")) {
      throw err;
    }
  }

  // RPC enforces a 2000-block limit — paginate accordingly
  const chunkSize = 1999n;
  const all: ethers.Log[] = [];
  for (let from = fromBlock; from <= latestBlock; from += chunkSize + 1n) {
    const to = from + chunkSize > latestBlock ? latestBlock : from + chunkSize;
    const logs = await biteProvider.getLogs({ address, fromBlock: from, toBlock: to, topics });
    all.push(...logs);
  }
  return all;
}

export async function getOwnedCharacterTokenIdsFromTransfers(owner: string): Promise<bigint[]> {
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

export interface MintCharacterResult {
  txHash: string;
  tokenId: bigint | null;
  identity: IdentityRegistrationResult | null;
}

interface MintCharacterOptions {
  skipIdentityRegistration?: boolean;
}

/** Mint a character NFT (ERC-721) to a player address and return mint + identity details. */
export async function mintCharacterWithIdentity(
  toAddress: string,
  nft: { name: string; description: string; properties: Record<string, unknown> },
  validationTags: string[] = [],
  options: MintCharacterOptions = {}
): Promise<MintCharacterResult> {
  return traceTx("character-mint", "mintCharacter", { to: toAddress, name: nft.name }, "skale", async () => {
    const mintResult = await executeRegisteredChainOperation<CharacterMintProcessorResult>(
      "character-mint",
      `${toAddress.toLowerCase()}:${nft.name.toLowerCase()}`,
      { toAddress, nft } satisfies CharacterMintPayload,
      { priority: BOOTSTRAP_CHAIN_PRIORITY }
    );
    const tokenId = mintResult.tokenId != null ? BigInt(mintResult.tokenId) : null;

    let identity: IdentityRegistrationResult | null = null;
    if (!options.skipIdentityRegistration && identityRegistryContract && tokenId != null) {
      try {
        identity = await registerIdentity(
          tokenId,
          toAddress,
          `ipfs://${mintResult.txHash}`,
          { validationTags }
        );
      } catch (err: any) {
        console.warn(`[identity] Failed to register identity from mint: ${err.message?.slice(0, 80)}`);
      }
    }

    return {
      txHash: identity?.txHash || mintResult.txHash,
      tokenId,
      identity,
    };
  });
}

/** Compatibility wrapper kept while call sites are cut over to structured mint results. */
export async function mintCharacter(
  toAddress: string,
  nft: { name: string; description: string; properties: Record<string, unknown> }
): Promise<string> {
  const result = await mintCharacterWithIdentity(toAddress, nft);
  return result.txHash;
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

export async function findIdentityByCharacterTokenId(
  characterTokenId: bigint,
  ownerAddress?: string
): Promise<{ agentId: bigint; ownerAddress: string | null; agentUri: string | null } | null> {
  if (!identityRegistryContract || !identityRegistryAddress) return null;

  const latestBlock = BigInt(await biteProvider.getBlockNumber());
  const registeredTopic = ethers.id("Registered(uint256,string,address)");
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const recentFromBlock = latestBlock > 5_000n ? latestBlock - 5_000n : 0n;

  const searchLogs = async (
    logs: ethers.Log[],
    agentIdTopicIndex: number
  ): Promise<{ agentId: bigint; ownerAddress: string | null; agentUri: string | null } | null> => {
    const requestedOwner = ownerAddress?.toLowerCase() ?? null;
    for (let index = logs.length - 1; index >= 0; index--) {
      const agentIdTopic = logs[index].topics?.[agentIdTopicIndex];
      if (!agentIdTopic) continue;
      const agentId = BigInt(agentIdTopic);
      try {
        const rawMetadata = await identityRegistryContract.getMetadata(agentId, "characterTokenId");
        if (!rawMetadata || rawMetadata === "0x") continue;
        const [storedCharacterTokenId] = coder.decode(["uint256"], rawMetadata);
        if (BigInt(storedCharacterTokenId) !== characterTokenId) continue;
        const [ownerAddress, agentUri] = await Promise.all([
          identityRegistryContract.ownerOf(agentId).then((value: string) => value).catch(() => null),
          identityRegistryContract.tokenURI(agentId).then((value: string) => value).catch(() => null),
        ]);
        if (requestedOwner && ownerAddress?.toLowerCase() !== requestedOwner) {
          continue;
        }
        return { agentId, ownerAddress, agentUri };
      } catch {
        continue;
      }
    }
    return null;
  };

  const recentLogs = await paginatedGetLogs(
    identityRegistryAddress,
    [registeredTopic],
    latestBlock,
    recentFromBlock
  ).catch(() => []);

  if (ownerAddress) {
    const ownerTopic = ethers.zeroPadValue(ownerAddress.toLowerCase(), 32);
    const transferLogs = await paginatedGetLogs(
      identityRegistryAddress,
      [ERC721_TRANSFER_TOPIC, null, ownerTopic],
      latestBlock,
      recentFromBlock
    ).catch(() => []);
    const transferMatch = await searchLogs(transferLogs, 3);
    if (transferMatch) {
      return transferMatch;
    }
  }

  const recentMatch = await searchLogs(recentLogs, 1);
  if (recentMatch) {
    return recentMatch;
  }

  const fullLogs = await paginatedGetLogs(identityRegistryAddress, [registeredTopic], latestBlock);
  return await searchLogs(fullLogs, 1);
}

export async function resolveIdentityRegistrationTxHash(agentId: bigint): Promise<string | null> {
  if (!identityRegistryAddress) return null;

  const latestBlock = BigInt(await biteProvider.getBlockNumber());
  const agentTopic = ethers.zeroPadValue(ethers.toBeHex(agentId), 32);
  const registeredTopic = ethers.id("Registered(uint256,string,address)");
  const zeroAddressTopic = ethers.zeroPadValue(ethers.ZeroAddress, 32);

  const recentFromBlock = latestBlock > 20_000n ? latestBlock - 20_000n : 0n;
  const firstRecentRegistered = await paginatedGetLogs(
    identityRegistryAddress,
    [registeredTopic, agentTopic],
    latestBlock,
    recentFromBlock
  ).catch(() => []);
  if (firstRecentRegistered[0]?.transactionHash) {
    return firstRecentRegistered[0].transactionHash;
  }

  const fullRegistered = await paginatedGetLogs(
    identityRegistryAddress,
    [registeredTopic, agentTopic],
    latestBlock
  ).catch(() => []);
  if (fullRegistered[0]?.transactionHash) {
    return fullRegistered[0].transactionHash;
  }

  const mintLogs = await paginatedGetLogs(
    identityRegistryAddress,
    [ERC721_TRANSFER_TOPIC, zeroAddressTopic, null, agentTopic],
    latestBlock,
    recentFromBlock
  ).catch(() => []);
  if (mintLogs[0]?.transactionHash) {
    return mintLogs[0].transactionHash;
  }

  const fullMintLogs = await paginatedGetLogs(
    identityRegistryAddress,
    [ERC721_TRANSFER_TOPIC, zeroAddressTopic, null, agentTopic],
    latestBlock
  ).catch(() => []);
  return fullMintLogs[0]?.transactionHash ?? null;
}

export interface RegisteredIdentity {
  agentId: bigint;
  agentUri: string;
  ownerAddress: string;
  blockNumber: number;
  txHash: string;
}

/**
 * Enumerate all ERC-8004 registered agent identities by scanning Registered events.
 * agentURI is decoded directly from event data — no extra tokenURI RPC calls needed.
 */
export async function listAllRegisteredIdentities(): Promise<RegisteredIdentity[]> {
  if (!identityRegistryAddress) return [];

  const latestBlock = BigInt(await biteProvider.getBlockNumber());
  const registeredTopic = ethers.id("Registered(uint256,string,address)");
  const coder = ethers.AbiCoder.defaultAbiCoder();

  const logs = await paginatedGetLogs(identityRegistryAddress, [registeredTopic], latestBlock).catch(() => []);

  const seen = new Set<string>();
  const results: RegisteredIdentity[] = [];

  for (const log of logs) {
    const agentIdTopic = log.topics[1];
    if (!agentIdTopic) continue;
    const agentId = BigInt(agentIdTopic);
    const agentIdStr = agentId.toString();
    // keep only the most recent registration per agentId (logs are ordered oldest→newest)
    if (seen.has(agentIdStr)) continue;
    seen.add(agentIdStr);

    const ownerTopic = log.topics[2];
    const ownerAddress = ownerTopic
      ? ethers.getAddress(`0x${ownerTopic.slice(26)}`)
      : ethers.ZeroAddress;

    let agentUri = "";
    try {
      const [uri] = coder.decode(["string"], log.data);
      agentUri = uri as string;
    } catch { /* leave empty */ }

    results.push({
      agentId,
      agentUri,
      ownerAddress,
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
    });
  }

  return results;
}

// Dedup: track last successfully synced level per tokenId to skip redundant uploads
const lastSyncedLevel = new Map<string, number>();

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
  const tokenKey = entity.characterTokenId.toString();
  if (lastSyncedLevel.get(tokenKey) === entity.level) {
    return "skipped-same-level";
  }
  return executeRegisteredChainOperation<string>(
    "character-metadata-update",
    `${tokenKey}:${entity.level}`,
    {
      characterTokenId: tokenKey,
      name: entity.name,
      raceId: entity.raceId,
      classId: entity.classId,
      level: entity.level,
      xp: entity.xp,
      stats: entity.stats,
    } satisfies CharacterMetadataPayload
  );
}

registerChainOperationProcessor("sfuel-distribute", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { toAddress: string };
  return traceTx("sfuel", "distributeSFuel", { to: payload.toAddress }, "skale", async () => {
    const tx = prepareTransaction({
      to: payload.toAddress,
      value: toWei(SFUEL_DISTRIBUTION_AMOUNT),
      chain: skaleBase,
      client: thirdwebClient,
    });
    const receipt = await queueTransaction(serverAccount, `sfuel-distribute:${payload.toAddress.toLowerCase()}`, async () =>
      sendTransactionWithManagedGas(tx, serverAccount)
    );
    txStats.sfuelDistributions++;
    recordTx("sfuel", receipt.transactionHash);
    return { result: receipt.transactionHash, txHash: receipt.transactionHash };
  });
});

registerChainOperationProcessor("gold-mint", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { toAddress: string; amount: string };
  return traceTx("gold-mint", "mintGold", { to: payload.toAddress, amount: payload.amount }, "skale", async () => {
    const tx = mintERC20({ contract: goldContract, to: payload.toAddress, amount: payload.amount });
    const receipt = await queueTransaction(serverAccount, `gold-mint:${payload.toAddress.toLowerCase()}:${payload.amount}`, async () =>
      sendTransactionWithManagedGas(tx, serverAccount)
    );
    txStats.goldMints++;
    recordTx("gold-mint", receipt.transactionHash);
    goldCache.invalidate(payload.toAddress.toLowerCase());
    return { result: receipt.transactionHash, txHash: receipt.transactionHash };
  });
});

registerChainOperationProcessor("gold-transfer", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { fromAddress: string; toAddress: string; amount: string };
  return traceTx("gold-transfer", "transferGoldFrom", { from: payload.fromAddress, to: payload.toAddress, amount: payload.amount }, "skale", async () => {
    let signer: Account = serverAccount;
    if (payload.fromAddress.toLowerCase() !== serverAccount.address.toLowerCase()) {
      try {
        signer = await getCustodialWallet(payload.fromAddress);
      } catch {
        signer = serverAccount;
      }
    }
    const tx = transferERC20({ contract: goldContract, to: payload.toAddress, amount: payload.amount });
    const receipt = await queueTransaction(
      signer,
      `gold-transfer:${payload.fromAddress.toLowerCase()}:${payload.toAddress.toLowerCase()}:${payload.amount}`,
      async () => sendTransactionWithManagedGas(tx, signer)
    );
    txStats.goldTransfers++;
    recordTx("gold-transfer", receipt.transactionHash);
    goldCache.invalidate(payload.fromAddress.toLowerCase());
    goldCache.invalidate(payload.toAddress.toLowerCase());
    return { result: receipt.transactionHash, txHash: receipt.transactionHash };
  });
});

registerChainOperationProcessor("item-mint", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { toAddress: string; tokenId: string; quantity: string };
  return traceTx("item-mint", "mintItem", payload, "skale", async () => {
    const chainTokenId = await getChainTokenIdForGameTokenId(BigInt(payload.tokenId));
    await ensureItemTokenIdExists(chainTokenId);
    const tx = mintAdditionalSupplyTo({
      contract: itemsContract,
      to: payload.toAddress,
      tokenId: chainTokenId,
      supply: BigInt(payload.quantity),
    });
    const receipt = await queueTransaction(
      serverAccount,
      `item-mint:${payload.toAddress.toLowerCase()}:${payload.tokenId}:${payload.quantity}`,
      async () => sendTransactionWithManagedGas(tx, serverAccount)
    );
    txStats.itemMints++;
    recordTx("item-mint", receipt.transactionHash);
    itemCache.invalidate(payload.toAddress.toLowerCase());
    return { result: receipt.transactionHash, txHash: receipt.transactionHash };
  });
});

registerChainOperationProcessor("item-burn", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { fromAddress: string; tokenId: string; quantity: string };
  return traceTx("item-burn", "burnItem", payload, "skale", async () => {
    let signer: Account = serverAccount;
    try {
      signer = await getCustodialWallet(payload.fromAddress);
    } catch {
      signer = serverAccount;
    }
    if (signer !== serverAccount) {
      try {
        await distributeSFuel(payload.fromAddress);
      } catch {}
    }
    const chainTokenId = await getChainTokenIdForGameTokenId(BigInt(payload.tokenId));
    const tx = burn({
      contract: itemsContract,
      account: signer.address,
      id: chainTokenId,
      value: BigInt(payload.quantity),
    });
    const receipt = await queueTransaction(
      signer,
      `item-burn:${payload.fromAddress.toLowerCase()}:${payload.tokenId}:${payload.quantity}`,
      async () => sendTransactionWithManagedGas(tx, signer)
    );
    txStats.itemBurns++;
    recordTx("item-burn", receipt.transactionHash);
    itemCache.invalidate(payload.fromAddress.toLowerCase());
    return { result: receipt.transactionHash, txHash: receipt.transactionHash };
  });
});

registerChainOperationProcessor("identity-agent-uri", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { agentId: string; endpointUrl: string };
  const receipt = await queueBiteTransaction(`identity-agent-uri:${payload.agentId}`, async () => {
    const tx = await identityRegistryContract!.setAgentURI(BigInt(payload.agentId), payload.endpointUrl);
    return tx.wait();
  });
  console.log(`[identity] Updated A2A endpoint for agent #${payload.agentId} → ${payload.endpointUrl}`);
  return { result: receipt.hash, txHash: receipt.hash };
});

registerChainOperationProcessor("character-mint", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as CharacterMintPayload;
  const result = await processCharacterMintPayload(payload);
  return { result, txHash: result.txHash };
});

registerChainOperationProcessor("identity-register", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as IdentityRegistrationPayload;
  const result = await processIdentityRegistrationPayload(payload, record);
  return { result, txHash: result.txHash };
});

registerChainOperationProcessor("character-metadata-update", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as CharacterMetadataPayload;
  return traceTx(
    "metadata-update",
    "updateCharacterMetadata",
    { tokenId: payload.characterTokenId, name: payload.name, level: payload.level },
    "skale",
    async () => {
      if (!characterWriteContract) {
        throw new Error("Character write contract unavailable");
      }
      const metadata = {
        name: payload.name,
        description: `Level ${payload.level} ${payload.raceId} ${payload.classId}`,
        properties: {
          race: payload.raceId,
          class: payload.classId,
          level: payload.level,
          xp: payload.xp,
          stats: payload.stats,
        },
      };
      const uri = await resolveCharacterMetadataUri(metadata);
      const tx = await queueBiteTransaction(`character-metadata:${payload.characterTokenId}`, async () => {
        const managedFees = await resolveManagedFeeOverrides(skaleProvider);
        return await waitForBiteSubmission(
          characterWriteContract.setTokenURI(BigInt(payload.characterTokenId), uri, {
            ...managedFees,
            nonce: await reserveServerNonce() ?? undefined,
          })
        );
      });
      const txHash = String(tx.hash ?? "");
      if (!txHash) {
        throw new Error(`Metadata update submission returned no tx hash for character ${payload.characterTokenId}`);
      }
      await updateChainOperation(record.operationId, {
        status: "submitted",
        txHash,
        lastError: undefined,
      });

      const receipt = await waitForCharacterMetadataReceiptByHash(txHash);
      txStats.metadataUpdates++;
      recordTx("metadata-update", txHash);
      lastSyncedLevel.set(payload.characterTokenId, payload.level);
      return { result: txHash, txHash: String((receipt as any).hash ?? txHash) };
    }
  );
});
