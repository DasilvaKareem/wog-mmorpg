import { ethers } from "ethers";

const receiptProvider = new ethers.JsonRpcProvider(
  process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base"
);

export interface ChainReceiptStatus {
  txHash: string;
  found: boolean;
  success?: boolean;
  blockNumber?: number;
}

export async function getChainReceiptStatus(txHash: string): Promise<ChainReceiptStatus> {
  if (!txHash) {
    return { txHash, found: false };
  }
  try {
    const receipt = await receiptProvider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { txHash, found: false };
    }
    return {
      txHash,
      found: true,
      success: receipt.status === 1,
      blockNumber: Number(receipt.blockNumber ?? 0) || undefined,
    };
  } catch {
    return { txHash, found: false };
  }
}
