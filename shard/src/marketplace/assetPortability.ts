import { getItemBalance } from "../blockchain/blockchain.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import {
  getEquippedItemCounts,
  getEquippedInstanceIds,
} from "../items/inventoryState.js";
import { getWalletInstanceByToken } from "../items/itemRng.js";

// ── Restricted Items ────────────────────────────────────────────────

/** Token IDs that cannot be listed or exported (admin-managed). */
const RESTRICTED_TOKEN_IDS = new Set<number>();

export function isItemRestrictedFromMarketplace(tokenId: number): boolean {
  return RESTRICTED_TOKEN_IDS.has(tokenId);
}

export function addMarketplaceRestriction(tokenId: number): void {
  RESTRICTED_TOKEN_IDS.add(tokenId);
}

export function removeMarketplaceRestriction(tokenId: number): void {
  RESTRICTED_TOKEN_IDS.delete(tokenId);
}

// ── Portability Result ──────────────────────────────────────────────

export interface PortabilityResult {
  allowed: boolean;
  reason?: string;
}

// ── Can List Item ───────────────────────────────────────────────────

export async function canListItem(params: {
  wallet: string;
  tokenId: number;
  quantity: number;
  instanceId?: string;
}): Promise<PortabilityResult> {
  const { wallet, tokenId, quantity, instanceId } = params;

  // 1. Exists in catalog?
  const item = getItemByTokenId(BigInt(tokenId));
  if (!item) {
    return { allowed: false, reason: "Item not found in catalog" };
  }

  // 2. Restricted?
  if (isItemRestrictedFromMarketplace(tokenId)) {
    return { allowed: false, reason: "Item is restricted from the marketplace" };
  }

  // 3. Owns enough?
  const balance = await getItemBalance(wallet, BigInt(tokenId));
  if (balance < BigInt(quantity)) {
    return {
      allowed: false,
      reason: `Insufficient balance: have ${balance}, need ${quantity}`,
    };
  }

  // 4. Enough non-equipped?
  const equippedCounts = await getEquippedItemCounts(wallet);
  const equippedQty = equippedCounts.get(tokenId) ?? 0;
  const recyclableQty = Number(balance) - equippedQty;
  if (recyclableQty < quantity) {
    return {
      allowed: false,
      reason: `Cannot list equipped items: ${equippedQty} equipped, only ${recyclableQty} available`,
    };
  }

  // 5. Instance validation (if instanced listing)
  if (instanceId) {
    const equippedIds = await getEquippedInstanceIds(wallet);
    if (equippedIds.has(instanceId)) {
      return {
        allowed: false,
        reason: "Cannot list an equipped item instance",
      };
    }
    const instance = getWalletInstanceByToken(wallet, tokenId, instanceId);
    if (!instance) {
      return {
        allowed: false,
        reason: "Item instance not found or has no durability",
      };
    }
  }

  return { allowed: true };
}

// ── Can Export Item ─────────────────────────────────────────────────

export async function canExportItem(params: {
  wallet: string;
  tokenId: number;
  quantity: number;
  targetChain: string;
  instanceId?: string;
}): Promise<PortabilityResult> {
  // Same portability checks as listing
  const listResult = await canListItem({
    wallet: params.wallet,
    tokenId: params.tokenId,
    quantity: params.quantity,
    instanceId: params.instanceId,
  });
  if (!listResult.allowed) return listResult;

  // Chain-specific validation can be added here
  if (!params.targetChain) {
    return { allowed: false, reason: "Target chain is required for export" };
  }

  return { allowed: true };
}

// ── Can Rent Item ───────────────────────────────────────────────────

/**
 * Check if an item can be rented out.
 * Rental = usage rights only, no burn. Owner must still own the asset.
 */
export async function isRentable(params: {
  wallet: string;
  tokenId: number;
  instanceId?: string;
}): Promise<PortabilityResult> {
  const { wallet, tokenId } = params;

  const item = getItemByTokenId(BigInt(tokenId));
  if (!item) return { allowed: false, reason: "Item not found in catalog" };

  if (isItemRestrictedFromMarketplace(tokenId)) {
    return { allowed: false, reason: "Item is restricted" };
  }

  const balance = await getItemBalance(wallet, BigInt(tokenId));
  if (balance < 1n) {
    return { allowed: false, reason: "You don't own this item" };
  }

  return { allowed: true };
}

// ── Can Bid ─────────────────────────────────────────────────────────

/**
 * Check if a bidder can place a bid on an auction.
 * Basic validation — the auction system handles detailed bid checks.
 */
export function isBiddable(params: {
  bidderWallet: string;
  sellerWallet: string;
}): PortabilityResult {
  if (params.bidderWallet.toLowerCase() === params.sellerWallet.toLowerCase()) {
    return { allowed: false, reason: "Cannot bid on your own auction" };
  }
  return { allowed: true };
}
