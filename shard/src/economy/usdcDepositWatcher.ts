/**
 * USDC Deposit Watcher (multi-chain)
 *
 * Polls Base mainnet and Arc testnet for USDC Transfer events whose `to` is a
 * registered agent custodial wallet, and credits the nanopay compute budget
 * via creditOnChainDeposit().
 *
 * Design:
 *   - One eth_getLogs per chain per poll (filtered server-side on USDC
 *     contract + topic[to]). Cost is flat regardless of agent count.
 *   - Redis SET `agent:wallets:all` tracks the watched addresses; updated when
 *     wallets are created (writeWallet in agentConfigStore.ts) and via on-boot backfill.
 *   - Last scanned block kept in Redis PER CHAIN so restarts don't double-credit
 *     or drop events, and so new chains start at head without replaying history.
 *   - Per-(chain, txHash, logIndex) dedupe via SET NX ensures idempotency under retries.
 */
import { createPublicClient, defineChain, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { getRedis } from "../redis.js";
import { creditOnChainDeposit } from "./sessionBudget.js";

const USDC_DECIMALS = 6;
const POLL_INTERVAL_MS = 15_000;
const MAX_BLOCKS_PER_POLL = 1_000n;
const CONFIRMATION_BLOCKS = 1n;
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

interface ChainConfig {
  id: string;
  label: string;
  chain: any;
  rpcUrl: string;
  usdcAddress: `0x${string}`;
}

const CHAINS: ChainConfig[] = [
  {
    id: "base",
    label: "Base mainnet",
    chain: base,
    rpcUrl: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    id: "arc-testnet",
    label: "Arc testnet",
    chain: arcTestnet,
    rpcUrl: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network",
    // Arc testnet USDC (ERC-20 interface at 6 decimals — native gas token uses 18,
    // but Transfer events here use the standard 6-decimal value).
    usdcAddress: "0x3600000000000000000000000000000000000000",
  },
];

const WALLETS_SET_KEY  = "agent:wallets:all";
const PROCESSED_PREFIX = "agent:nanopay:watcher:processed";

/** Per-chain last-scanned-block key. Base keeps the legacy unsuffixed name so
 *  the upgrade doesn't replay history on the original chain. */
function lastBlockKey(chainId: string): string {
  return chainId === "base"
    ? "agent:nanopay:watcher:lastBlock"
    : `agent:nanopay:watcher:lastBlock:${chainId}`;
}

let started = false;
const timers: Array<ReturnType<typeof setInterval>> = [];
// Loosely typed because two viem versions are present in the dep tree (one transitive),
// and the strict PublicClient type conflicts between them.
const clients = new Map<string, any>();

function getClient(c: ChainConfig): any {
  let cached = clients.get(c.id);
  if (cached) return cached;
  cached = createPublicClient({ chain: c.chain, transport: http(c.rpcUrl) });
  clients.set(c.id, cached);
  return cached;
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

async function getLastScannedBlock(chainId: string, currentBlock: bigint): Promise<bigint> {
  const redis = getRedis();
  if (!redis) return currentBlock;
  const key = lastBlockKey(chainId);
  try {
    const raw = await redis.get(key);
    if (raw) return BigInt(raw);
    // First run: start from current block so we don't backfill historical chain.
    await redis.set(key, currentBlock.toString());
    return currentBlock;
  } catch {
    return currentBlock;
  }
}

async function setLastScannedBlock(chainId: string, block: bigint): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try { await redis.set(lastBlockKey(chainId), block.toString()); } catch { /* non-fatal */ }
}

async function creditDeposit(
  chainId: string,
  to: string,
  rawValue: bigint,
  txHash: string,
  logIndex: number,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  // Chain-scoped dedupe — tx hashes can theoretically collide across chains.
  const dedupeKey = `${PROCESSED_PREFIX}:${chainId}:${txHash}:${logIndex}`;
  // SET NX with 30-day TTL: first hit wins, retries no-op.
  const ok = await redis.set(dedupeKey, "1", "EX", 30 * 86_400, "NX");
  if (ok !== "OK") return;

  const usdcAmount = Number(rawValue) / 10 ** USDC_DECIMALS;
  if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) return;

  await creditOnChainDeposit(to, usdcAmount);
  console.log(`[usdcWatcher:${chainId}] +$${usdcAmount.toFixed(6)} USDC → ${to} (tx ${txHash})`);
}

async function tick(c: ChainConfig): Promise<void> {
  const watched = await loadWatchedSet();
  const client = getClient(c);

  let head: bigint;
  try { head = await client.getBlockNumber(); }
  catch (err: any) { console.warn(`[usdcWatcher:${c.id}] getBlockNumber failed:`, err.message); return; }

  const safeTip = head - CONFIRMATION_BLOCKS;
  if (safeTip <= 0n) return;

  // No wallets yet: advance the cursor so we don't replay chain history when wallets get added.
  if (watched.size === 0) { await setLastScannedBlock(c.id, safeTip); return; }

  const last = await getLastScannedBlock(c.id, safeTip);
  if (safeTip <= last) return;

  const fromBlock = last + 1n;
  const toBlock   = fromBlock + MAX_BLOCKS_PER_POLL - 1n < safeTip
    ? fromBlock + MAX_BLOCKS_PER_POLL - 1n
    : safeTip;

  const addresses = Array.from(watched) as `0x${string}`[];

  let logs;
  try {
    logs = await client.getLogs({
      address: c.usdcAddress,
      event:   TRANSFER_EVENT,
      args:    { to: addresses },
      fromBlock,
      toBlock,
    });
  } catch (err: any) {
    console.warn(`[usdcWatcher:${c.id}] getLogs ${fromBlock}-${toBlock} failed:`, err.message);
    return;
  }

  for (const log of logs) {
    const to       = (log.args.to ?? "").toLowerCase();
    const value    = log.args.value ?? 0n;
    const txHash   = log.transactionHash ?? "";
    const logIndex = log.logIndex ?? 0;
    if (!to || !watched.has(to) || !txHash) continue;
    try { await creditDeposit(c.id, to, value, txHash, logIndex); }
    catch (err: any) { console.warn(`[usdcWatcher:${c.id}] credit failed:`, err.message); }
  }

  await setLastScannedBlock(c.id, toBlock);
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

  for (const c of CHAINS) {
    console.log(`[usdcWatcher:${c.id}] Polling ${c.label} USDC (${c.usdcAddress}) every ${POLL_INTERVAL_MS}ms`);
    void tick(c).catch((err: any) => console.warn(`[usdcWatcher:${c.id}] initial tick failed:`, err.message));
    const t = setInterval(() => {
      void tick(c).catch((err: any) => console.warn(`[usdcWatcher:${c.id}] tick failed:`, err.message));
    }, POLL_INTERVAL_MS);
    timers.push(t);
  }
}

export function stopUsdcDepositWatcher(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  started = false;
}
