import { ethers } from "ethers";

const TX_FEE_CACHE_MS = Number(process.env.TX_FEE_CACHE_MS || 5_000);
const TX_MAX_FEE_MULTIPLIER_BPS = Number(process.env.TX_MAX_FEE_MULTIPLIER_BPS || 12_000); // 1.2x

interface ManagedFeeOverrides {
  gasPrice: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  txType: 0 | 2;
}

export interface Eip1559FeeOverrides {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
}

interface CacheEntry {
  value: ManagedFeeOverrides;
  expiresAt: number;
}

const providerFeeCache = new WeakMap<ethers.JsonRpcProvider, CacheEntry>();
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const LEGACY_CHAIN_IDS = new Set([
  324705682,  // SKALE testnet chain
  1187947933, // SKALE Base mainnet chain
]);

function shouldForceLegacyGas(): boolean {
  if (TRUE_VALUES.has((process.env.TX_FORCE_LEGACY_GAS ?? "").trim().toLowerCase())) {
    return true;
  }
  const chainId = Number(process.env.SKALE_BASE_CHAIN_ID || 1187947933);
  return Number.isFinite(chainId) && LEGACY_CHAIN_IDS.has(chainId);
}

function multiplyBps(value: bigint, bps: number): bigint {
  if (!Number.isFinite(bps) || bps <= 0) return value;
  return (value * BigInt(Math.trunc(bps))) / 10_000n;
}

function normalizePositive(value: bigint | null | undefined): bigint | null {
  if (value == null) return null;
  return value > 0n ? value : null;
}

async function readFallbackGasPrice(provider: ethers.JsonRpcProvider): Promise<bigint> {
  const hexGasPrice = await provider.send("eth_gasPrice", []);
  const gasPrice = BigInt(hexGasPrice);
  if (gasPrice <= 0n) {
    throw new Error(`Invalid eth_gasPrice response: ${String(hexGasPrice)}`);
  }
  return gasPrice;
}

export async function resolveManagedFeeOverrides(
  provider: ethers.JsonRpcProvider,
  options?: { forceRefresh?: boolean }
): Promise<ManagedFeeOverrides> {
  const now = Date.now();
  const cached = providerFeeCache.get(provider);
  if (!options?.forceRefresh && cached && cached.expiresAt > now) {
    return cached.value;
  }

  let feeData: ethers.FeeData | null = null;
  try {
    feeData = await provider.getFeeData();
  } catch {
    feeData = null;
  }

  const chainGasPrice =
    normalizePositive(feeData?.gasPrice) ??
    normalizePositive(feeData?.maxFeePerGas) ??
    await readFallbackGasPrice(provider);

  const bufferedMaxFeePerGas = (() => {
    const candidate = multiplyBps(chainGasPrice, TX_MAX_FEE_MULTIPLIER_BPS);
    return candidate >= chainGasPrice ? candidate : chainGasPrice;
  })();

  const priorityFromRpc = normalizePositive(feeData?.maxPriorityFeePerGas);
  const maxPriorityFeePerGas = priorityFromRpc
    ? (priorityFromRpc <= bufferedMaxFeePerGas ? priorityFromRpc : bufferedMaxFeePerGas)
    : undefined;

  const resolved: ManagedFeeOverrides = {
    gasPrice: chainGasPrice,
    maxFeePerGas: bufferedMaxFeePerGas,
    ...(maxPriorityFeePerGas ? { maxPriorityFeePerGas } : {}),
    txType: shouldForceLegacyGas() ? 0 : 2,
  };

  providerFeeCache.set(provider, {
    value: resolved,
    expiresAt: now + TX_FEE_CACHE_MS,
  });

  return resolved;
}

export function toEip1559FeeOverrides(fees: ManagedFeeOverrides): Eip1559FeeOverrides {
  const { gasPrice: _gasPrice, ...eip1559Fees } = fees;
  return eip1559Fees;
}

export function clearManagedFeeCache(provider?: ethers.JsonRpcProvider): void {
  if (provider) {
    providerFeeCache.delete(provider);
  }
}

/**
 * Build a JsonRpcProvider that always returns bounded EIP-1559 fee data
 * derived from current gasPrice, avoiding default maxFee inflation.
 */
export function createManagedFeeProvider(rpcUrl: string): ethers.JsonRpcProvider {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const originalGetFeeData = provider.getFeeData.bind(provider);

  provider.getFeeData = async (): Promise<ethers.FeeData> => {
    let feeData: ethers.FeeData | null = null;
    try {
      feeData = await originalGetFeeData();
    } catch {
      feeData = null;
    }

    const gasPrice =
      normalizePositive(feeData?.gasPrice) ??
      normalizePositive(feeData?.maxFeePerGas) ??
      await readFallbackGasPrice(provider);

    const bufferedMaxFeePerGas = (() => {
      const candidate = multiplyBps(gasPrice, TX_MAX_FEE_MULTIPLIER_BPS);
      return candidate >= gasPrice ? candidate : gasPrice;
    })();

    const priority = normalizePositive(feeData?.maxPriorityFeePerGas);
    const maxPriorityFeePerGas = priority
      ? (priority <= bufferedMaxFeePerGas ? priority : bufferedMaxFeePerGas)
      : null;

    if (shouldForceLegacyGas()) {
      // Legacy fee markets do not accept EIP-1559 fields.
      return new ethers.FeeData(gasPrice, null, null);
    }

    return new ethers.FeeData(gasPrice, bufferedMaxFeePerGas, maxPriorityFeePerGas);
  };

  return provider;
}

export function toManagedTxFeeFields(
  managedFees: ManagedFeeOverrides
): {
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
} {
  if (managedFees.txType === 0) {
    return {
      gasPrice: managedFees.gasPrice,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    };
  }
  return {
    gasPrice: undefined,
    maxFeePerGas: managedFees.maxFeePerGas,
    maxPriorityFeePerGas: managedFees.maxPriorityFeePerGas,
  };
}
