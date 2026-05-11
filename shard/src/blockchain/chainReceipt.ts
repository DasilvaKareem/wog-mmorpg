import { ethers } from "ethers";

const receiptProvider = new ethers.JsonRpcProvider(
  process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base"
);

export interface ChainReceiptStatus {
  txHash: string;
  found: boolean;
  success?: boolean;
  blockNumber?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
  feeWei?: string;
  valueWei?: string;
  fromAddress?: string;
}

export async function getChainReceiptStatus(txHash: string): Promise<ChainReceiptStatus> {
  if (!txHash) {
    return { txHash, found: false };
  }
  try {
    const [receipt, tx] = await Promise.all([
      receiptProvider.getTransactionReceipt(txHash),
      receiptProvider.getTransaction(txHash).catch(() => null),
    ]);
    if (!receipt) {
      return { txHash, found: false };
    }
    const gasUsed = receipt.gasUsed ?? null;
    const effectiveGasPrice = receipt.gasPrice ?? null;
    const feeWei =
      gasUsed != null && effectiveGasPrice != null
        ? (gasUsed * effectiveGasPrice)
        : null;
    return {
      txHash,
      found: true,
      success: receipt.status === 1,
      blockNumber: Number(receipt.blockNumber ?? 0) || undefined,
      gasUsed: gasUsed?.toString() ?? undefined,
      effectiveGasPrice: effectiveGasPrice?.toString() ?? undefined,
      feeWei: feeWei?.toString() ?? undefined,
      valueWei: tx?.value?.toString() ?? undefined,
      fromAddress: tx?.from ?? undefined,
    };
  } catch {
    return { txHash, found: false };
  }
}
