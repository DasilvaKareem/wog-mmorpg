import type { FastifyInstance } from "fastify";
import { NPC_DEFS, type NpcDef } from "./npcSpawner.js";
import { createCustodialWallet } from "./custodialWalletRedis.js";
import { mintGold, mintItem, getGoldBalance, getItemBalance } from "./blockchain.js";
import { getAvailableGold, recordGoldSpend } from "./goldLedger.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { getAllZones, type Entity } from "./zoneRuntime.js";
import { logZoneEvent } from "./zoneEvents.js";

// ── Data Structures ──────────────────────────────────────────────

export interface MerchantInventoryEntry {
  tokenId: number;
  quantity: number;
  basePrice: number;
  currentPrice: number;
  targetStock: number;
  totalSold: number;
  totalBought: number;
  lastRestockedAt: number;
}

export interface MerchantState {
  entityId: string;
  npcName: string;
  zoneId: string;
  walletAddress: string;
  shopItems: number[];
  inventory: Map<number, MerchantInventoryEntry>;
  goldBalance: number;
  lastInventorySyncAt: number;
  lastPriceUpdateAt: number;
  lastAnnouncementAt: number;
  lastRestockAt: number;
}

// ── Constants ────────────────────────────────────────────────────

const MERCHANT_TICK_INTERVAL = 10_000;
const INVENTORY_SYNC_INTERVAL = 60_000;
const PRICE_UPDATE_INTERVAL = 30_000;
const RESTOCK_INTERVAL = 120_000;
const ANNOUNCEMENT_COOLDOWN = 300_000;
const INITIAL_GOLD_SEED = 500;
const INITIAL_STOCK_PER_ITEM = 5;
const DEFAULT_TARGET_STOCK = 10;
const BUY_MARKDOWN = 0.5;
const MIN_PRICE_MULTIPLIER = 0.5;
const MAX_PRICE_MULTIPLIER = 2.0;

// ── State ────────────────────────────────────────────────────────

const merchantStates = new Map<string, MerchantState>();

// ── Helpers (consumed by shop.ts) ────────────────────────────────

export function getMerchantState(entityId: string): MerchantState | undefined {
  return merchantStates.get(entityId);
}

export function getMerchantPrice(entityId: string, tokenId: number): number | undefined {
  const state = merchantStates.get(entityId);
  if (!state) return undefined;
  const entry = state.inventory.get(tokenId);
  return entry?.currentPrice;
}

export function getMerchantStock(entityId: string, tokenId: number): number | undefined {
  const state = merchantStates.get(entityId);
  if (!state) return undefined;
  const entry = state.inventory.get(tokenId);
  return entry?.quantity;
}

export function getMerchantBuyPrice(entityId: string, tokenId: number): number | undefined {
  const state = merchantStates.get(entityId);
  if (!state) return undefined;
  const entry = state.inventory.get(tokenId);
  if (!entry) return undefined;
  return Math.floor(Math.min(entry.currentPrice, entry.basePrice) * BUY_MARKDOWN);
}

export function recordMerchantSale(entityId: string, tokenId: number, quantity: number): void {
  const state = merchantStates.get(entityId);
  if (!state) return;
  const entry = state.inventory.get(tokenId);
  if (!entry) return;
  entry.quantity = Math.max(0, entry.quantity - quantity);
  entry.totalSold += quantity;
}

export function recordMerchantPurchase(entityId: string, tokenId: number, quantity: number): void {
  const state = merchantStates.get(entityId);
  if (!state) return;
  const entry = state.inventory.get(tokenId);
  if (!entry) return;
  entry.quantity += quantity;
  entry.totalBought += quantity;
}

// ── Dynamic Pricing ──────────────────────────────────────────────

function calculateDynamicPrice(basePrice: number, currentStock: number, targetStock: number): number {
  if (targetStock <= 0) return basePrice;

  const ratio = currentStock / targetStock;
  let multiplier: number;

  if (ratio <= 0) {
    multiplier = MAX_PRICE_MULTIPLIER;
  } else if (ratio < 1) {
    multiplier = 1.0 + (1.0 - ratio);
  } else if (ratio >= 2) {
    multiplier = MIN_PRICE_MULTIPLIER;
  } else {
    // ratio 1..2 → multiplier 1.0..0.5
    multiplier = 1.0 - (ratio - 1.0) * 0.5;
  }

  multiplier = Math.max(MIN_PRICE_MULTIPLIER, Math.min(MAX_PRICE_MULTIPLIER, multiplier));
  return Math.max(1, Math.round(basePrice * multiplier));
}

// ── Boot ─────────────────────────────────────────────────────────

function findEntityByNpcDef(def: NpcDef): Entity | undefined {
  const zone = getAllZones().get(def.zoneId);
  if (!zone) return undefined;
  for (const entity of zone.entities.values()) {
    if (entity.name === def.name && entity.type === "merchant") {
      return entity;
    }
  }
  return undefined;
}

export async function initMerchantWallets(): Promise<void> {
  const merchantDefs = NPC_DEFS.filter((d) => d.type === "merchant" && d.shopItems && d.shopItems.length > 0);

  for (const def of merchantDefs) {
    const entity = findEntityByNpcDef(def);
    if (!entity) {
      console.warn(`[merchant] Entity not found for ${def.name} — skipping`);
      continue;
    }

    try {
      // Create custodial wallet
      const walletInfo = createCustodialWallet();
      entity.walletAddress = walletInfo.address;

      // Mint seed gold
      await mintGold(walletInfo.address, String(INITIAL_GOLD_SEED));

      // Mint initial stock of each item
      const inventory = new Map<number, MerchantInventoryEntry>();
      for (const tokenId of def.shopItems!) {
        const item = getItemByTokenId(BigInt(tokenId));
        if (!item) continue;

        await mintItem(walletInfo.address, BigInt(tokenId), BigInt(INITIAL_STOCK_PER_ITEM));

        inventory.set(tokenId, {
          tokenId,
          quantity: INITIAL_STOCK_PER_ITEM,
          basePrice: item.copperPrice,
          currentPrice: item.copperPrice,
          targetStock: DEFAULT_TARGET_STOCK,
          totalSold: 0,
          totalBought: 0,
          lastRestockedAt: Date.now(),
        });
      }

      const state: MerchantState = {
        entityId: entity.id,
        npcName: def.name,
        zoneId: def.zoneId,
        walletAddress: walletInfo.address,
        shopItems: def.shopItems!,
        inventory,
        goldBalance: INITIAL_GOLD_SEED,
        lastInventorySyncAt: Date.now(),
        lastPriceUpdateAt: Date.now(),
        lastAnnouncementAt: 0,
        lastRestockAt: Date.now(),
      };

      merchantStates.set(entity.id, state);
      console.log(
        `[merchant] Initialized ${def.name} in ${def.zoneId} — wallet ${walletInfo.address}, ${def.shopItems!.length} items stocked`
      );
    } catch (err) {
      console.error(`[merchant] Failed to init ${def.name}:`, err);
    }
  }

  console.log(`[merchant] ${merchantStates.size} merchant agents initialized`);
}

// ── Tick Phases ──────────────────────────────────────────────────

async function syncInventory(state: MerchantState): Promise<void> {
  try {
    // Sync gold
    const rawGold = parseFloat(await getGoldBalance(state.walletAddress));
    state.goldBalance = Number.isFinite(rawGold) ? getAvailableGold(state.walletAddress, rawGold) : 0;

    // Sync item balances
    for (const [tokenId, entry] of state.inventory) {
      const balance = await getItemBalance(state.walletAddress, BigInt(tokenId));
      entry.quantity = Number(balance);
    }

    state.lastInventorySyncAt = Date.now();
  } catch (err) {
    console.error(`[merchant] Inventory sync failed for ${state.npcName}:`, err);
  }
}

function updatePrices(state: MerchantState): void {
  for (const entry of state.inventory.values()) {
    entry.currentPrice = calculateDynamicPrice(entry.basePrice, entry.quantity, entry.targetStock);
  }
  state.lastPriceUpdateAt = Date.now();
}

async function restockItems(state: MerchantState): Promise<void> {
  const now = Date.now();
  for (const entry of state.inventory.values()) {
    // Restock if below 30% of target
    if (entry.quantity < entry.targetStock * 0.3) {
      const restockQty = Math.min(5, entry.targetStock - entry.quantity);
      if (restockQty <= 0) continue;

      try {
        await mintItem(state.walletAddress, BigInt(entry.tokenId), BigInt(restockQty));
        entry.quantity += restockQty;
        entry.lastRestockedAt = now;

        const item = getItemByTokenId(BigInt(entry.tokenId));
        console.log(
          `[merchant] ${state.npcName} restocked ${restockQty}x ${item?.name ?? `#${entry.tokenId}`} (now ${entry.quantity})`
        );
      } catch (err) {
        console.error(`[merchant] Restock failed for ${state.npcName} item #${entry.tokenId}:`, err);
      }
    }
  }
  state.lastRestockAt = now;
}

function announceDeals(state: MerchantState): void {
  // Find a noteworthy deal to announce
  let bestDeal: { name: string; discount: number; price: number } | null = null;

  for (const entry of state.inventory.values()) {
    if (entry.currentPrice < entry.basePrice) {
      const discount = Math.round((1 - entry.currentPrice / entry.basePrice) * 100);
      if (!bestDeal || discount > bestDeal.discount) {
        const item = getItemByTokenId(BigInt(entry.tokenId));
        if (item) {
          bestDeal = { name: item.name, discount, price: entry.currentPrice };
        }
      }
    }
  }

  // Find any out-of-stock items
  let outOfStock = 0;
  for (const entry of state.inventory.values()) {
    if (entry.quantity <= 0) outOfStock++;
  }

  let message: string;
  if (bestDeal && bestDeal.discount >= 10) {
    message = `${bestDeal.name} on sale — ${bestDeal.discount}% off! Only ${bestDeal.price} gold.`;
  } else if (outOfStock > 0) {
    message = `Some items are sold out! Restocking soon...`;
  } else {
    message = `Come browse my wares — fresh stock available!`;
  }

  logZoneEvent({
    zoneId: state.zoneId,
    type: "trade",
    tick: 0,
    entityName: state.npcName,
    message,
  });

  state.lastAnnouncementAt = Date.now();
}

// ── Tick Loop ────────────────────────────────────────────────────

export function registerMerchantAgentTick(server: FastifyInstance): void {
  setInterval(async () => {
    const now = Date.now();

    for (const state of merchantStates.values()) {
      try {
        // Phase 1: Inventory sync (every 60s)
        if (now - state.lastInventorySyncAt >= INVENTORY_SYNC_INTERVAL) {
          await syncInventory(state);
        }

        // Phase 2: Price update (every 30s)
        if (now - state.lastPriceUpdateAt >= PRICE_UPDATE_INTERVAL) {
          updatePrices(state);
        }

        // Phase 3: Restock (every 120s)
        if (now - state.lastRestockAt >= RESTOCK_INTERVAL) {
          await restockItems(state);
        }

        // Phase 4: Announce (every 300s)
        if (now - state.lastAnnouncementAt >= ANNOUNCEMENT_COOLDOWN) {
          announceDeals(state);
        }
      } catch (err) {
        server.log.error(err, `[merchant] Tick error for ${state.npcName}`);
      }
    }
  }, MERCHANT_TICK_INTERVAL);

  server.log.info(`[merchant] Agent tick registered (${MERCHANT_TICK_INTERVAL / 1000}s interval)`);
}
