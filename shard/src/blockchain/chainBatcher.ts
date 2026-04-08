/**
 * Chain Write Batcher
 *
 * Accumulates item mints and gold transfers in memory, flushing to the
 * blockchain in batches on a timer. This reduces on-chain transactions by
 * orders of magnitude (e.g. 20 loot drops in 30s → 1-3 txs instead of 20).
 *
 * Flush schedule:
 *   - Item mints:    every 30 seconds
 *   - Gold transfers: every 5 minutes
 *   - On player disconnect: immediate flush for that wallet
 *   - On server shutdown:   flush all pending
 *
 * sFUEL circuit breaker:
 *   When server wallet sFUEL drops below a threshold, all chain writes are
 *   paused and queued items/gold are retained in memory until balance recovers.
 */

import { mintItem } from "./blockchain.js";
import { transferFromTreasury } from "./wallet.js";
import { ethers } from "ethers";

// ── Configuration ──────────────────────────────────────────────────────────

const ITEM_FLUSH_INTERVAL_MS = 30_000;   // 30 seconds
const GOLD_FLUSH_INTERVAL_MS = 300_000;  // 5 minutes

const SFUEL_CHECK_INTERVAL_MS = 60_000;  // check balance every 60s
const SFUEL_MIN_BALANCE = 0.01;          // pause chain writes below this

// ── State ──────────────────────────────────────────────────────────────────

/** Per-wallet accumulated item mints: wallet → tokenId → quantity */
const pendingItems = new Map<string, Map<string, bigint>>();

/** Per-wallet accumulated gold (in gold units, not copper): wallet → total */
const pendingGold = new Map<string, number>();

let itemFlushTimer: ReturnType<typeof setInterval> | null = null;
let goldFlushTimer: ReturnType<typeof setInterval> | null = null;
let sfuelCheckTimer: ReturnType<typeof setInterval> | null = null;

let chainWritesPaused = false;
let lastSfuelBalance = -1;

// ── sFUEL Circuit Breaker ──────────────────────────────────────────────────

const skaleRpcUrl =
  process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base";

let serverWalletAddress: string | null = null;

function getServerWalletAddress(): string | null {
  if (serverWalletAddress) return serverWalletAddress;
  const pk = process.env.SERVER_PRIVATE_KEY;
  if (!pk) return null;
  try {
    serverWalletAddress = new ethers.Wallet(pk).address;
    return serverWalletAddress;
  } catch {
    return null;
  }
}

async function checkSfuelBalance(): Promise<void> {
  const addr = getServerWalletAddress();
  if (!addr) return;

  try {
    const provider = new ethers.JsonRpcProvider(skaleRpcUrl);
    const balance = await provider.getBalance(addr);
    const balEth = parseFloat(ethers.formatEther(balance));
    lastSfuelBalance = balEth;

    if (balEth < SFUEL_MIN_BALANCE && !chainWritesPaused) {
      chainWritesPaused = true;
      console.warn(
        `[chainBatcher] sFUEL CIRCUIT BREAKER OPEN — balance ${balEth.toFixed(6)} < ${SFUEL_MIN_BALANCE}. ` +
        `Chain writes paused. Pending: ${pendingItems.size} wallets (items), ${pendingGold.size} wallets (gold).`
      );
    } else if (balEth >= SFUEL_MIN_BALANCE && chainWritesPaused) {
      chainWritesPaused = false;
      console.log(
        `[chainBatcher] sFUEL circuit breaker CLOSED — balance ${balEth.toFixed(6)}. Resuming chain writes.`
      );
      // Trigger immediate flush now that we have gas
      void flushAllItems();
      void flushAllGold();
    }
  } catch (err) {
    // Don't flip the breaker on RPC errors — just log and keep current state
    console.warn(`[chainBatcher] sFUEL balance check failed:`, err instanceof Error ? err.message : err);
  }
}

// ── Queue Methods ──────────────────────────────────────────────────────────

function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

/**
 * Queue an item mint. Accumulated in memory and flushed periodically.
 */
export function queueItemMint(walletAddress: string, tokenId: bigint, quantity: bigint): void {
  const addr = normalizeAddress(walletAddress);
  let walletItems = pendingItems.get(addr);
  if (!walletItems) {
    walletItems = new Map();
    pendingItems.set(addr, walletItems);
  }

  const key = tokenId.toString();
  const current = walletItems.get(key) ?? 0n;
  walletItems.set(key, current + quantity);
}

/**
 * Queue a gold transfer from treasury. Accumulated and flushed periodically.
 * @param goldAmount Gold amount as a number (e.g. 0.05 for 5 copper)
 */
export function queueGoldTransfer(walletAddress: string, goldAmount: number): void {
  if (!Number.isFinite(goldAmount) || goldAmount <= 0) return;
  const addr = normalizeAddress(walletAddress);
  const current = pendingGold.get(addr) ?? 0;
  pendingGold.set(addr, current + goldAmount);
}

// ── Flush Methods ──────────────────────────────────────────────────────────

/**
 * Flush all pending item mints for a single wallet.
 */
async function flushItemsForWallet(walletAddress: string): Promise<void> {
  const items = pendingItems.get(walletAddress);
  if (!items || items.size === 0) {
    pendingItems.delete(walletAddress);
    return;
  }

  // Take snapshot and clear pending
  const snapshot = new Map(items);
  pendingItems.delete(walletAddress);

  for (const [tokenIdStr, quantity] of snapshot) {
    try {
      await mintItem(walletAddress, BigInt(tokenIdStr), quantity);
    } catch (err) {
      console.error(
        `[chainBatcher] item mint failed wallet=${walletAddress} tokenId=${tokenIdStr} qty=${quantity}:`,
        err instanceof Error ? err.message : err
      );
      // Re-queue the failed mint so it's retried on next flush
      let walletItems = pendingItems.get(walletAddress);
      if (!walletItems) {
        walletItems = new Map();
        pendingItems.set(walletAddress, walletItems);
      }
      const existing = walletItems.get(tokenIdStr) ?? 0n;
      walletItems.set(tokenIdStr, existing + quantity);
    }
  }
}

/**
 * Flush all pending gold for a single wallet.
 */
async function flushGoldForWallet(walletAddress: string): Promise<void> {
  const amount = pendingGold.get(walletAddress);
  if (!amount || amount <= 0) {
    pendingGold.delete(walletAddress);
    return;
  }

  // Take snapshot and clear pending
  pendingGold.delete(walletAddress);

  try {
    await transferFromTreasury(walletAddress, amount.toString());
    console.log(`[chainBatcher] gold flush wallet=${walletAddress} amount=${amount}`);
  } catch (err) {
    console.error(
      `[chainBatcher] gold transfer failed wallet=${walletAddress} amount=${amount}:`,
      err instanceof Error ? err.message : err
    );
    // Re-queue on failure
    const existing = pendingGold.get(walletAddress) ?? 0;
    pendingGold.set(walletAddress, existing + amount);
  }
}

/**
 * Flush all pending item mints across all wallets.
 */
async function flushAllItems(): Promise<void> {
  if (chainWritesPaused) {
    if (pendingItems.size > 0) {
      console.log(`[chainBatcher] item flush skipped — circuit breaker open (${pendingItems.size} wallets queued)`);
    }
    return;
  }

  const wallets = [...pendingItems.keys()];
  if (wallets.length === 0) return;

  console.log(`[chainBatcher] flushing items for ${wallets.length} wallet(s)`);
  // Process sequentially to avoid nonce collisions on the server wallet
  for (const wallet of wallets) {
    await flushItemsForWallet(wallet);
  }
}

/**
 * Flush all pending gold transfers across all wallets.
 */
async function flushAllGold(): Promise<void> {
  if (chainWritesPaused) {
    if (pendingGold.size > 0) {
      console.log(`[chainBatcher] gold flush skipped — circuit breaker open (${pendingGold.size} wallets queued)`);
    }
    return;
  }

  const wallets = [...pendingGold.keys()];
  if (wallets.length === 0) return;

  console.log(`[chainBatcher] flushing gold for ${wallets.length} wallet(s)`);
  for (const wallet of wallets) {
    await flushGoldForWallet(wallet);
  }
}

/**
 * Flush all pending chain writes for a specific player (on disconnect).
 */
export async function flushPlayer(walletAddress: string): Promise<void> {
  if (chainWritesPaused) return;
  const addr = normalizeAddress(walletAddress);
  await flushItemsForWallet(addr);
  await flushGoldForWallet(addr);
}

/**
 * Flush everything — used on graceful server shutdown.
 */
export async function flushAll(): Promise<void> {
  // Force flush even if circuit breaker is open — we're shutting down
  const savedPaused = chainWritesPaused;
  chainWritesPaused = false;

  console.log(
    `[chainBatcher] shutdown flush: ${pendingItems.size} wallets (items), ${pendingGold.size} wallets (gold)`
  );

  const itemWallets = [...pendingItems.keys()];
  for (const wallet of itemWallets) {
    await flushItemsForWallet(wallet);
  }

  const goldWallets = [...pendingGold.keys()];
  for (const wallet of goldWallets) {
    await flushGoldForWallet(wallet);
  }

  chainWritesPaused = savedPaused;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * Start the batch flush timers. Call once at server startup.
 */
export function startChainBatcher(): void {
  if (itemFlushTimer) return; // already running

  itemFlushTimer = setInterval(() => {
    flushAllItems().catch((err) =>
      console.error("[chainBatcher] item flush error:", err)
    );
  }, ITEM_FLUSH_INTERVAL_MS);

  goldFlushTimer = setInterval(() => {
    flushAllGold().catch((err) =>
      console.error("[chainBatcher] gold flush error:", err)
    );
  }, GOLD_FLUSH_INTERVAL_MS);

  sfuelCheckTimer = setInterval(() => {
    checkSfuelBalance().catch(() => {});
  }, SFUEL_CHECK_INTERVAL_MS);

  // Run initial sFUEL check
  void checkSfuelBalance();

  console.log(
    `[chainBatcher] started — items every ${ITEM_FLUSH_INTERVAL_MS / 1000}s, gold every ${GOLD_FLUSH_INTERVAL_MS / 1000}s, sFUEL check every ${SFUEL_CHECK_INTERVAL_MS / 1000}s`
  );
}

/**
 * Stop timers and flush remaining. Call on server shutdown.
 */
export async function stopChainBatcher(): Promise<void> {
  if (itemFlushTimer) { clearInterval(itemFlushTimer); itemFlushTimer = null; }
  if (goldFlushTimer) { clearInterval(goldFlushTimer); goldFlushTimer = null; }
  if (sfuelCheckTimer) { clearInterval(sfuelCheckTimer); sfuelCheckTimer = null; }

  await flushAll();
  console.log("[chainBatcher] stopped");
}

// ── Stats ──────────────────────────────────────────────────────────────────

export function getChainBatcherStats() {
  let pendingItemCount = 0;
  for (const items of pendingItems.values()) {
    pendingItemCount += items.size;
  }

  return {
    pendingItemWallets: pendingItems.size,
    pendingItemCount,
    pendingGoldWallets: pendingGold.size,
    chainWritesPaused,
    lastSfuelBalance,
  };
}
