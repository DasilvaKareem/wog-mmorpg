/**
 * Dual-chain BridgeOut / BridgeIn event listener.
 *
 * Watches the WoGCharacterBase contract on Coinbase Base AND the WoGBridgeAdapter
 * contract on SKALE Base for cross-chain bridge events. Mirrors the polling +
 * Redis cursor pattern in shard/src/economy/usdcDepositWatcher.ts.
 *
 * Events handled:
 *   - BridgeOut: a user has burned/escrowed on the source chain.
 *                The bridge service signs an EIP-712 claim the user can redeem.
 *   - BridgeIn:  a claim was successfully redeemed on the destination chain.
 *                Mark the bridge op `redeemed` and update character state.
 */
import { createPublicClient, defineChain, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { getRedis } from "../../redis.js";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHARACTER_CONTRACT,
  BASE_MAINNET_RPC_URL,
  BRIDGE_ENABLED,
  BRIDGE_LISTENER_CONFIRMATIONS,
  BRIDGE_LISTENER_MAX_BLOCKS,
  BRIDGE_LISTENER_POLL_MS,
  SKALE_BASE_CHAIN_ID,
  SKALE_BRIDGE_ADAPTER_CONTRACT,
  bridgeContractsConfigured,
} from "./bridgeConfig.js";
import { handleBridgeInObserved, handleBridgeOutObserved } from "./bridgeService.js";

const BRIDGE_OUT_EVENT = parseAbiItem(
  "event BridgeOut(uint256 indexed tokenId, address indexed holder, address indexed destinationRecipient, uint64 destinationChainId, string metadataURI, bytes32 nonce)"
);
const BRIDGE_IN_EVENT = parseAbiItem(
  "event BridgeIn(uint256 indexed tokenId, address indexed recipient, uint64 sourceChainId, bytes32 claimDigest)"
);

// SKALE chains are not pre-defined in viem; construct a minimal Chain object.
const skaleBaseViem = defineChain({
  id: SKALE_BASE_CHAIN_ID,
  name: "SKALE Base",
  nativeCurrency: { decimals: 18, name: "sFUEL", symbol: "sFUEL" },
  rpcUrls: {
    default: {
      http: [process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base"],
    },
  },
});

interface BridgeChainConfig {
  label: string;
  chain: any;
  rpcUrl: string;
  contractAddress: `0x${string}`;
  chainId: number;
}

function getChainConfigs(): BridgeChainConfig[] {
  if (!bridgeContractsConfigured()) return [];
  return [
    {
      label: "base",
      chain: base,
      rpcUrl: BASE_MAINNET_RPC_URL,
      contractAddress: BASE_MAINNET_CHARACTER_CONTRACT as `0x${string}`,
      chainId: BASE_MAINNET_CHAIN_ID,
    },
    {
      label: "skale",
      chain: skaleBaseViem,
      rpcUrl: process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base",
      contractAddress: SKALE_BRIDGE_ADAPTER_CONTRACT as `0x${string}`,
      chainId: SKALE_BASE_CHAIN_ID,
    },
  ];
}

const clients = new Map<string, any>();
function getClient(c: BridgeChainConfig): any {
  let client = clients.get(c.label);
  if (!client) {
    client = createPublicClient({ chain: c.chain, transport: http(c.rpcUrl) });
    clients.set(c.label, client);
  }
  return client;
}

function cursorKey(label: string): string {
  return `bridge:listener:lastBlock:${label}`;
}

async function getCursor(label: string, safeTip: bigint): Promise<bigint> {
  const redis = getRedis();
  if (!redis) return safeTip; // dev fallback: start from head
  const v = await redis.get(cursorKey(label));
  if (!v) return safeTip;
  try {
    return BigInt(v);
  } catch {
    return safeTip;
  }
}

async function setCursor(label: string, block: bigint): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(cursorKey(label), block.toString());
}

let started = false;
const timers: Array<ReturnType<typeof setInterval>> = [];

async function tick(c: BridgeChainConfig): Promise<void> {
  const client = getClient(c);
  let head: bigint;
  try {
    head = await client.getBlockNumber();
  } catch (err: any) {
    console.warn(`[bridgeListener:${c.label}] getBlockNumber failed: ${err.message}`);
    return;
  }

  const safeTip = head - BigInt(BRIDGE_LISTENER_CONFIRMATIONS);
  if (safeTip <= 0n) return;

  const last = await getCursor(c.label, safeTip);
  if (safeTip <= last) return;

  const fromBlock = last + 1n;
  const toBlock =
    fromBlock + BigInt(BRIDGE_LISTENER_MAX_BLOCKS) - 1n < safeTip
      ? fromBlock + BigInt(BRIDGE_LISTENER_MAX_BLOCKS) - 1n
      : safeTip;

  for (const event of [BRIDGE_OUT_EVENT, BRIDGE_IN_EVENT]) {
    let logs;
    try {
      logs = await client.getLogs({
        address: c.contractAddress,
        event,
        fromBlock,
        toBlock,
      });
    } catch (err: any) {
      console.warn(
        `[bridgeListener:${c.label}] getLogs ${fromBlock}-${toBlock} ${event.name} failed: ${err.message}`,
      );
      return;
    }

    for (const log of logs) {
      try {
        if (event.name === "BridgeOut") {
          await handleBridgeOutObserved({
            chainId: c.chainId,
            tokenId: String((log as any).args.tokenId),
            holder: String((log as any).args.holder).toLowerCase(),
            destinationRecipient: String((log as any).args.destinationRecipient).toLowerCase(),
            destinationChainId: Number((log as any).args.destinationChainId),
            metadataURI: String((log as any).args.metadataURI),
            nonce: String((log as any).args.nonce) as `0x${string}`,
            txHash: log.transactionHash ?? "",
            blockNumber: log.blockNumber ? Number(log.blockNumber) : 0,
          });
        } else {
          await handleBridgeInObserved({
            chainId: c.chainId,
            tokenId: String((log as any).args.tokenId),
            recipient: String((log as any).args.recipient).toLowerCase(),
            sourceChainId: Number((log as any).args.sourceChainId),
            claimDigest: String((log as any).args.claimDigest) as `0x${string}`,
            txHash: log.transactionHash ?? "",
          });
        }
      } catch (err: any) {
        console.warn(
          `[bridgeListener:${c.label}] handler ${event.name} failed: ${err.message}`,
        );
      }
    }
  }

  await setCursor(c.label, toBlock);
}

export async function startBridgeEventListener(): Promise<void> {
  if (started) return;
  if (!BRIDGE_ENABLED) {
    console.log("[bridgeListener] BRIDGE_ENABLED=false; listener will not start");
    return;
  }
  if (!bridgeContractsConfigured()) {
    console.warn(
      "[bridgeListener] Bridge contracts not configured (BASE_MAINNET_CHARACTER_CONTRACT / SKALE_BRIDGE_ADAPTER_CONTRACT); listener will not start",
    );
    return;
  }

  started = true;
  const configs = getChainConfigs();
  console.log(`[bridgeListener] starting for ${configs.map((c) => c.label).join(", ")}`);

  for (const c of configs) {
    void tick(c).catch((err) => {
      console.warn(`[bridgeListener:${c.label}] initial tick failed: ${err.message}`);
    });
    const timer = setInterval(() => {
      void tick(c).catch((err) => {
        console.warn(`[bridgeListener:${c.label}] tick failed: ${err.message}`);
      });
    }, BRIDGE_LISTENER_POLL_MS);
    timers.push(timer);
  }
}

export async function stopBridgeEventListener(): Promise<void> {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  started = false;
}
