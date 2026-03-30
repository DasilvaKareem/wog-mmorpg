import { ethers } from "ethers";
import { biteWallet } from "../blockchain/biteChain.js";
import { queueBiteTransaction } from "../blockchain/biteTxQueue.js";
import {
  executeRegisteredChainOperation,
  registerChainOperationProcessor,
  type ChainOperationRecord,
} from "../blockchain/chainOperationStore.js";

const GUILD_VAULT_CONTRACT_ADDRESS = process.env.GUILD_VAULT_CONTRACT_ADDRESS;

/** WoGGuildVault ABI */
const GUILD_VAULT_ABI = [
  "function depositItem(uint256 guildId, uint256 tokenId, uint256 quantity, address depositor)",
  "function withdrawItem(uint256 guildId, uint256 tokenId, uint256 quantity, address recipient)",
  "function lendItem(uint256 guildId, uint256 tokenId, uint256 quantity, address borrower, uint256 durationDays) returns (uint256)",
  "function returnItem(uint256 loanId, address borrower)",
  "function getVaultItems(uint256 guildId) view returns (tuple(uint256 tokenId, uint256 quantity, uint256 available)[])",
  "function getLentItems(uint256 guildId, address borrower) view returns (tuple(uint256 tokenId, uint256 quantity, address borrower, uint256 lentAt, uint256 dueAt)[])",
  "function getGuildLoans(uint256 guildId) view returns (uint256[], tuple(uint256 tokenId, uint256 quantity, address borrower, uint256 lentAt, uint256 dueAt)[])",
  "event ItemDeposited(uint256 indexed guildId, uint256 tokenId, uint256 quantity, address depositor)",
  "event ItemWithdrawn(uint256 indexed guildId, uint256 tokenId, uint256 quantity, address recipient)",
  "event ItemLent(uint256 indexed guildId, uint256 indexed loanId, address indexed borrower, uint256 tokenId, uint256 quantity, uint256 dueAt)",
  "event ItemReturned(uint256 indexed guildId, uint256 indexed loanId, address indexed borrower, uint256 tokenId, uint256 quantity)",
];

const vaultContract = GUILD_VAULT_CONTRACT_ADDRESS
  ? new ethers.Contract(GUILD_VAULT_CONTRACT_ADDRESS, GUILD_VAULT_ABI, biteWallet)
  : null;

function ensureVaultContract(): ethers.Contract {
  if (!vaultContract) throw new Error("Vault contract not initialized");
  return vaultContract;
}

// -- Types --

export interface VaultItem {
  tokenId: number;
  quantity: number;
  available: number;
}

export interface LentItem {
  tokenId: number;
  quantity: number;
  borrower: string;
  lentAt: number;
  dueAt: number;
}

export interface LoanInfo {
  loanId: number;
  tokenId: number;
  quantity: number;
  borrower: string;
  lentAt: number;
  dueAt: number;
}

// -- Contract interaction helpers --

/**
 * Deposit item into guild vault.
 */
export async function depositItemOnChain(
  guildId: number,
  tokenId: number,
  quantity: number,
  depositor: string
): Promise<string> {
  return executeRegisteredChainOperation("guild-vault-deposit", `${guildId}:${depositor.toLowerCase()}:${tokenId}:${quantity}`, { guildId, tokenId, quantity, depositor });
}
registerChainOperationProcessor("guild-vault-deposit", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { guildId: number; tokenId: number; quantity: number; depositor: string };
  const receipt = await queueBiteTransaction(`guild-vault-deposit:${payload.guildId}:${payload.depositor}:${payload.tokenId}`, async () => {
    const tx = await ensureVaultContract().depositItem(payload.guildId, payload.tokenId, payload.quantity, payload.depositor);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

/**
 * Withdraw item from guild vault.
 */
export async function withdrawItemOnChain(
  guildId: number,
  tokenId: number,
  quantity: number,
  recipient: string
): Promise<string> {
  return executeRegisteredChainOperation("guild-vault-withdraw", `${guildId}:${recipient.toLowerCase()}:${tokenId}:${quantity}`, { guildId, tokenId, quantity, recipient });
}
registerChainOperationProcessor("guild-vault-withdraw", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { guildId: number; tokenId: number; quantity: number; recipient: string };
  const receipt = await queueBiteTransaction(`guild-vault-withdraw:${payload.guildId}:${payload.recipient}:${payload.tokenId}`, async () => {
    const tx = await ensureVaultContract().withdrawItem(payload.guildId, payload.tokenId, payload.quantity, payload.recipient);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

/**
 * Lend item to guild member.
 */
export async function lendItemOnChain(
  guildId: number,
  tokenId: number,
  quantity: number,
  borrower: string,
  durationDays: number
): Promise<{ loanId: number; txHash: string }> {
  return executeRegisteredChainOperation("guild-vault-lend", `${guildId}:${borrower.toLowerCase()}:${tokenId}:${quantity}:${durationDays}`, { guildId, tokenId, quantity, borrower, durationDays });
}
registerChainOperationProcessor("guild-vault-lend", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { guildId: number; tokenId: number; quantity: number; borrower: string; durationDays: number };
  const contract = ensureVaultContract();
  const receipt = await queueBiteTransaction(`guild-vault-lend:${payload.guildId}:${payload.borrower}:${payload.tokenId}`, async () => {
    const tx = await contract.lendItem(payload.guildId, payload.tokenId, payload.quantity, payload.borrower, payload.durationDays);
    return tx.wait();
  });
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "ItemLent") {
        return { result: { loanId: Number(parsed.args.loanId), txHash: receipt.hash }, txHash: receipt.hash };
      }
    } catch {}
  }
  throw new Error("ItemLent event not found in receipt");
});

/**
 * Return borrowed item to vault.
 */
export async function returnItemOnChain(
  loanId: number,
  borrower: string
): Promise<string> {
  return executeRegisteredChainOperation("guild-vault-return", `${loanId}:${borrower.toLowerCase()}`, { loanId, borrower });
}
registerChainOperationProcessor("guild-vault-return", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as { loanId: number; borrower: string };
  const receipt = await queueBiteTransaction(`guild-vault-return:${payload.loanId}:${payload.borrower}`, async () => {
    const tx = await ensureVaultContract().returnItem(payload.loanId, payload.borrower);
    return tx.wait();
  });
  return { result: receipt.hash, txHash: receipt.hash };
});

/**
 * Get all items in guild vault.
 */
export async function getVaultItemsFromChain(guildId: number): Promise<VaultItem[]> {
  if (!vaultContract) throw new Error("Vault contract not initialized");

  const items = await vaultContract.getVaultItems(guildId);

  return items.map((item: any) => ({
    tokenId: Number(item.tokenId),
    quantity: Number(item.quantity),
    available: Number(item.available),
  }));
}

/**
 * Get all items lent to a specific member.
 */
export async function getLentItemsFromChain(
  guildId: number,
  borrower: string
): Promise<LentItem[]> {
  if (!vaultContract) throw new Error("Vault contract not initialized");

  const items = await vaultContract.getLentItems(guildId, borrower);

  return items.map((item: any) => ({
    tokenId: Number(item.tokenId),
    quantity: Number(item.quantity),
    borrower: item.borrower,
    lentAt: Number(item.lentAt),
    dueAt: Number(item.dueAt),
  }));
}

/**
 * Get all active loans for a guild.
 */
export async function getGuildLoansFromChain(guildId: number): Promise<LoanInfo[]> {
  if (!vaultContract) throw new Error("Vault contract not initialized");

  const [loanIds, loanData] = await vaultContract.getGuildLoans(guildId);

  return loanIds.map((loanId: bigint, index: number) => {
    const loan = loanData[index];
    return {
      loanId: Number(loanId),
      tokenId: Number(loan.tokenId),
      quantity: Number(loan.quantity),
      borrower: loan.borrower,
      lentAt: Number(loan.lentAt),
      dueAt: Number(loan.dueAt),
    };
  });
}
