/**
 * USDC Deposit Watcher
 *
 * Polls Base mainnet for USDC Transfer events whose `to` is a registered agent
 * wallet, and credits the nanopay compute budget via creditOnChainDeposit().
 *
 * Design:
 *   - One eth_getLogs per poll (filtered server-side on USDC contract + topic[to]).
 *     Cost is flat regardless of agent count.
 *   - Redis SET `agent:wallets:all` tracks the watched addresses; updated when
 *     wallets are created (writeWallet in agentConfigStore.ts) and via on-boot backfill.
 *   - Last scanned block kept in Redis so restarts don't double-credit or drop events.
 *   - Per-(txHash, logIndex) dedupe via SET NX ensures idempotency under retries.
 */
import { createPublicClient, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { getRedis } from "../redis.js";
import { creditOnChainDeposit } from "./sessionBudget.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_DECIMALS = 6;
const POLL_INTERVAL_MS = 15_000;
const MAX_BLOCKS_PER_POLL = 1_000n;
const CONFIRMATION_BLOCKS = 1n;
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

const WALLETS_SET_KEY  = "agent:wallets:all";
const LAST_BLOCK_KEY   = "agent:nanopay:watcher:lastBlock";
const PROCESSED_PREFIX = "agent:nanopay:watcher:processed";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
// Loosely typed because two viem versions are present in the dep tree (one transitive),
// and the strict PublicClient type conflicts between them.
let client: any = null;

function getClient(): any {
  if (client) return client;
  const rpcUrl = process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org";
  client = createPublicClient({ chain: base, transport: http(rpcUrl) });
  return client;
}

/** Register an agent wallet so deposits to it credit the compute budget. */
export async function registerWatchedAgentWallet(address: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return;
  try {
    await redis.sadd(WALLETS_SET_KEY, address.toLowerCase());
  } catch (err: any) {
    console.warn("[usdcWatcher] registerWatchedAgentWallet failed:", err.message);
  }
}

/** One-shot backfill: read agent:wallet:* keys and seed the watched set. */
export async function backfillWatchedAgentWallets(): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  let cursor = "0";
  let added = 0;
  try {
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", "agent:wallet:*", "COUNT", 200);
      cursor = next;
      for (const key of keys) {
        try {
          const addr = await redis.get(key);
          if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) {
            await redis.sadd(WALLETS_SET_KEY, addr.toLowerCase());
            added++;
          }
        } catch { /* skip */ }
      }
    } while (cursor !== "0");
  } catch (err: any) {
    console.warn("[usdcWatcher] backfill failed:", err.message);
  }
  return added;
}

async function loadWatchedSet(): Promise<Set<string>> {
  const redis = getRedis();
  if (!redis) return new Set();
  try {
    const all: string[] = await redis.smembers(WALLETS_SET_KEY);
    return new Set(all.map((a) => a.toLowerCase()));
  } catch {
    return new Set();
  }
}

async function getLastScannedBlock(currentBlock: bigint): Promise<bigint> {
  const redis = getRedis();
  if (!redis) return currentBlock;
  try {
    const raw = await redis.get(LAST_BLOCK_KEY);
    if (raw) return BigInt(raw);
    // First run: start from current block so we don't backfill historical chain.
    await redis.set(LAST_BLOCK_KEY, currentBlock.toString());
    return currentBlock;
  } catch {
    return currentBlock;
  }
}

async function setLastScannedBlock(block: bigint): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try { await redis.set(LAST_BLOCK_KEY, block.toString()); } catch { /* non-fatal */ }
}

async function creditDeposit(
  to: string,
  rawValue: bigint,
  txHash: string,
  logIndex: number,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const dedupeKey = `${PROCESSED_PREFIX}:${txHash}:${logIndex}`;
  // SET NX with 30-day TTL: first hit wins, retries no-op.
  const ok = await redis.set(dedupeKey, "1", "EX", 30 * 86_400, "NX");
  if (ok !== "OK") return;

  const usdcAmount = Number(rawValue) / 10 ** USDC_DECIMALS;
  if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) return;

  await creditOnChainDeposit(to, usdcAmount);
  console.log(`[usdcWatcher] +$${usdcAmount.toFixed(6)} USDC → ${to} (tx ${txHash})`);
}

async function tick(): Promise<void> {
  const watched = await loadWatchedSet();
  const c = getClient();

  let head: bigint;
  try { head = await c.getBlockNumber(); }
  catch (err: any) { console.warn("[usdcWatcher] getBlockNumber failed:", err.message); return; }

  const safeTip = head - CONFIRMATION_BLOCKS;
  if (safeTip <= 0n) return;

  // No wallets yet: advance the cursor so we don't replay chain history when wallets get added.
  if (watched.size === 0) { await setLastScannedBlock(safeTip); return; }

  const last = await getLastScannedBlock(safeTip);
  if (safeTip <= last) return;

  const fromBlock = last + 1n;
  const toBlock   = fromBlock + MAX_BLOCKS_PER_POLL - 1n < safeTip
    ? fromBlock + MAX_BLOCKS_PER_POLL - 1n
    : safeTip;

  const addresses = Array.from(watched) as `0x${string}`[];

  let logs;
  try {
    logs = await c.getLogs({
      address: USDC_BASE,
      event:   TRANSFER_EVENT,
      args:    { to: addresses },
      fromBlock,
      toBlock,
    });
  } catch (err: any) {
    console.warn(`[usdcWatcher] getLogs ${fromBlock}-${toBlock} failed:`, err.message);
    return;
  }

  for (const log of logs) {
    const to       = (log.args.to ?? "").toLowerCase();
    const value    = log.args.value ?? 0n;
    const txHash   = log.transactionHash ?? "";
    const logIndex = log.logIndex ?? 0;
    if (!to || !watched.has(to) || !txHash) continue;
    try { await creditDeposit(to, value, txHash, logIndex); }
    catch (err: any) { console.warn("[usdcWatcher] credit failed:", err.message); }
  }

  await setLastScannedBlock(toBlock);
}

export async function startUsdcDepositWatcher(): Promise<void> {
  if (started) return;
  if (!getRedis()) {
    console.warn("[usdcWatcher] Redis unavailable — watcher disabled");
    return;
  }
  if ((process.env.USDC_WATCHER_DISABLED ?? "").toLowerCase() === "true") {
    console.log("[usdcWatcher] Disabled via USDC_WATCHER_DISABLED");
    return;
  }
  started = true;

  const added = await backfillWatchedAgentWallets();
  console.log(`[usdcWatcher] Backfilled ${added} agent wallets into watched set`);
  console.log(`[usdcWatcher] Polling Base mainnet USDC every ${POLL_INTERVAL_MS}ms`);

  void tick().catch((err: any) => console.warn("[usdcWatcher] initial tick failed:", err.message));
  timer = setInterval(() => {
    void tick().catch((err: any) => console.warn("[usdcWatcher] tick failed:", err.message));
  }, POLL_INTERVAL_MS);
}

export function stopUsdcDepositWatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
