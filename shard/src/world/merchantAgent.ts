import type { FastifyInstance } from "fastify";
import { NPC_DEFS, type NpcDef } from "./npcSpawner.js";
import { createCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import { enqueueGoldMint, getGoldBalance, getItemBalance } from "../blockchain/blockchain.js";
import { queueItemMint } from "../blockchain/chainBatcher.js";
import { getAvailableGoldAsync } from "../blockchain/goldLedger.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { getEntitiesInRegion, type Entity } from "./zoneRuntime.js";
import { logZoneEvent } from "./zoneEvents.js";
import { getRedis } from "../redis.js";
import { getMerchantStateProjection, listMerchantStates, upsertMerchantState } from "../db/merchantStateStore.js";
import { isPostgresConfigured } from "../db/postgres.js";

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

const MERCHANT_TICK_INTERVAL = Math.max(
  5_000,
  Number.parseInt(process.env.MERCHANT_TICK_INTERVAL_MS ?? "10000", 10) || 10_000
);
const INVENTORY_SYNC_INTERVAL = Math.max(
  30_000,
  Number.parseInt(process.env.MERCHANT_INVENTORY_SYNC_INTERVAL_MS ?? "180000", 10) || 180_000
);
const PRICE_UPDATE_INTERVAL = Math.max(
  10_000,
  Number.parseInt(process.env.MERCHANT_PRICE_UPDATE_INTERVAL_MS ?? "30000", 10) || 30_000
);
const RESTOCK_INTERVAL = Math.max(
  30_000,
  Number.parseInt(process.env.MERCHANT_RESTOCK_INTERVAL_MS ?? "120000", 10) || 120_000
);
const ANNOUNCEMENT_COOLDOWN = 300_000;
const INITIAL_GOLD_SEED = 500;
const INITIAL_STOCK_PER_ITEM = 5;
const DEFAULT_TARGET_STOCK = 10;
const BUY_MARKDOWN = 0.5;
const MIN_PRICE_MULTIPLIER = 0.5;
const MAX_PRICE_MULTIPLIER = 2.0;

// ── State ────────────────────────────────────────────────────────

const merchantStates = new Map<string, MerchantState>();
const merchantEntityAliases = new Map<string, string>();
const MERCHANT_STATE_KEY_PREFIX = "merchant:state:";
const MERCHANT_STATE_IDS_KEY = "merchant:states";

interface PersistedMerchantState {
  entityId: string;
  npcName: string;
  zoneId: string;
  walletAddress: string;
  shopItems: number[];
  inventory: MerchantInventoryEntry[];
  goldBalance: number;
  lastInventorySyncAt: number;
  lastPriceUpdateAt: number;
  lastAnnouncementAt: number;
  lastRestockAt: number;
}

// ── Helpers (consumed by shop.ts) ────────────────────────────────

export function getMerchantCount(): number {
  return merchantStates.size;
}

export function resolveMerchantEntityId(entityId: string): string {
  return merchantEntityAliases.get(entityId) ?? entityId;
}

export function getMerchantState(entityId: string): MerchantState | undefined {
  const resolvedId = resolveMerchantEntityId(entityId);
  return merchantStates.get(resolvedId);
}

export function getMerchantPrice(entityId: string, tokenId: number): number | undefined {
  const state = getMerchantState(entityId);
  if (!state) return undefined;
  const entry = state.inventory.get(tokenId);
  return entry?.currentPrice;
}

export function getMerchantStock(entityId: string, tokenId: number): number | undefined {
  const state = getMerchantState(entityId);
  if (!state) return undefined;
  const entry = state.inventory.get(tokenId);
  return entry?.quantity;
}

export function getMerchantBuyPrice(entityId: string, tokenId: number): number | undefined {
  const state = getMerchantState(entityId);
  if (!state) return undefined;
  const entry = state.inventory.get(tokenId);
  if (!entry) return undefined;
  return Math.floor(Math.min(entry.currentPrice, entry.basePrice) * BUY_MARKDOWN);
}

function serializeMerchantState(state: MerchantState): PersistedMerchantState {
  return {
    entityId: state.entityId,
    npcName: state.npcName,
    zoneId: state.zoneId,
    walletAddress: state.walletAddress,
    shopItems: [...state.shopItems],
    inventory: Array.from(state.inventory.values()).map((entry) => ({ ...entry })),
    goldBalance: state.goldBalance,
    lastInventorySyncAt: state.lastInventorySyncAt,
    lastPriceUpdateAt: state.lastPriceUpdateAt,
    lastAnnouncementAt: state.lastAnnouncementAt,
    lastRestockAt: state.lastRestockAt,
  };
}

function merchantStableId(zoneId: string, npcName: string): string {
  const safeName = npcName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${zoneId.toLowerCase()}:${safeName}`;
}

function merchantStateKey(stableId: string): string {
  return `${MERCHANT_STATE_KEY_PREFIX}${stableId}`;
}

function hydrateMerchantState(state: PersistedMerchantState): MerchantState {
  return {
    ...state,
    inventory: new Map(state.inventory.map((entry) => [entry.tokenId, entry])),
  };
}

async function persistMerchantState(state: MerchantState): Promise<void> {
  const stableId = merchantStableId(state.zoneId, state.npcName);
  const serialized = serializeMerchantState(state);
  if (isPostgresConfigured()) {
    await upsertMerchantState(stableId, state.zoneId, state.npcName, state.walletAddress, serialized);
  }
  const redis = getRedis();
  if (!redis) return;

  const key = merchantStateKey(stableId);
  const payload = JSON.stringify(serialized);
  const tx = redis.multi();
  tx.sadd(MERCHANT_STATE_IDS_KEY, stableId);
  tx.set(key, payload);
  await tx.exec();
}

function persistMerchantStateEventually(state: MerchantState, context: string): void {
  void persistMerchantState(state).catch((err) => {
    console.warn(`[merchant] Failed to persist ${state.npcName} after ${context}:`, err);
  });
}

export async function restoreMerchantStatesFromRedis(): Promise<number> {
  if (isPostgresConfigured()) {
    const rows = await listMerchantStates();
    if (rows.length > 0) {
      let restored = 0;
      for (const row of rows) {
        try {
          const persistedState = hydrateMerchantState(row.payload as PersistedMerchantState);
          const entity = getEntitiesInRegion(persistedState.zoneId).find(
            (candidate) =>
              candidate.type === "merchant" &&
              (candidate.id === persistedState.entityId || candidate.name === persistedState.npcName)
          );
          if (!entity || entity.type !== "merchant") continue;
          const previousEntityId = persistedState.entityId;
          const state: MerchantState = { ...persistedState, entityId: entity.id };
          entity.walletAddress = state.walletAddress;
          merchantStates.set(entity.id, state);
          merchantEntityAliases.set(previousEntityId, entity.id);
          merchantEntityAliases.set(entity.id, entity.id);
          restored++;
        } catch (err) {
          console.warn(`[merchant] Failed to restore Postgres merchant state for ${row.merchantId}:`, err);
        }
      }
      if (restored > 0) {
        console.log(`[merchant] Restored ${restored} merchant state(s) from Postgres`);
        return restored;
      }
    }
  }

  const redis = getRedis();
  if (!redis) return 0;

  const ids: string[] = await redis.smembers(MERCHANT_STATE_IDS_KEY);
  if (!Array.isArray(ids) || ids.length === 0) return 0;

  let restored = 0;
  const seenStableIds = new Set<string>();
  for (const id of ids) {
    const raw = await redis.get(merchantStateKey(id));
    if (!raw) continue;

    try {
      const persistedState = hydrateMerchantState(JSON.parse(raw) as PersistedMerchantState);
      const stableId = merchantStableId(persistedState.zoneId, persistedState.npcName);
      if (seenStableIds.has(stableId)) continue;
      seenStableIds.add(stableId);

      const entity = getEntitiesInRegion(persistedState.zoneId).find(
        (candidate) =>
          candidate.type === "merchant"
          && (candidate.id === persistedState.entityId || candidate.name === persistedState.npcName)
      );
      if (!entity || entity.type !== "merchant") continue;

      const previousEntityId = persistedState.entityId;
      const state: MerchantState = {
        ...persistedState,
        entityId: entity.id,
      };
      entity.walletAddress = state.walletAddress;
      merchantStates.set(entity.id, state);
      merchantEntityAliases.set(previousEntityId, entity.id);
      merchantEntityAliases.set(entity.id, entity.id);
      if (previousEntityId !== entity.id) {
        await persistMerchantState(state);
      }
      restored++;
    } catch (err) {
      console.warn(`[merchant] Failed to restore state for ${id}:`, err);
    }
  }

  if (restored > 0) {
    console.log(`[merchant] Restored ${restored} merchant state(s) from Redis`);
  }

  return restored;
}

export async function recordMerchantSale(entityId: string, tokenId: number, quantity: number): Promise<void> {
  const state = getMerchantState(entityId);
  if (!state) return;
  const entry = state.inventory.get(tokenId);
  if (!entry) return;
  entry.quantity = Math.max(0, entry.quantity - quantity);
  entry.totalSold += quantity;
  await persistMerchantState(state);
}

export async function recordMerchantPurchase(entityId: string, tokenId: number, quantity: number): Promise<void> {
  const state = getMerchantState(entityId);
  if (!state) return;
  const entry = state.inventory.get(tokenId);
  if (!entry) return;
  entry.quantity += quantity;
  entry.totalBought += quantity;
  await persistMerchantState(state);
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
  for (const entity of getEntitiesInRegion(def.zoneId)) {
    if (entity.name === def.name && entity.type === "merchant") {
      return entity;
    }
  }
  return undefined;
}

export async function initMerchantWallets(): Promise<void> {
  const merchantDefs = NPC_DEFS.filter((d) => d.type === "merchant" && d.shopItems && d.shopItems.length > 0);
  const failedDefs: typeof merchantDefs = [];
  const redis = getRedis();

  for (const def of merchantDefs) {
    const entity = findEntityByNpcDef(def);
    if (!entity) {
      console.warn(`[merchant] Entity not found for ${def.name} — skipping`);
      continue;
    }

    try {
      const stableId = merchantStableId(def.zoneId, def.name);
      const restoredState = getMerchantState(entity.id) ?? merchantStates.get(entity.id);
      if (restoredState) {
        merchantEntityAliases.set(entity.id, restoredState.entityId);
        continue;
      }

      const persistedProjection = await getMerchantStateProjection(stableId).catch(() => null);
      if (persistedProjection) {
        const persistedState = hydrateMerchantState(persistedProjection as PersistedMerchantState);
        entity.walletAddress = persistedState.walletAddress;
        const state: MerchantState = { ...persistedState, entityId: entity.id };
        merchantStates.set(entity.id, state);
        merchantEntityAliases.set(entity.id, entity.id);
        continue;
      }

      const existingRaw = redis ? await redis.get(merchantStateKey(stableId)) : null;
      if (existingRaw) {
        continue;
      }

      if (merchantStates.has(entity.id)) {
        continue;
      }

      // Create custodial wallet
      const walletInfo = await createCustodialWallet();
      entity.walletAddress = walletInfo.address;

      // Mint seed gold
      await enqueueGoldMint(walletInfo.address, String(INITIAL_GOLD_SEED));

      // Mint initial stock of each item
      const inventory = new Map<number, MerchantInventoryEntry>();
      for (const tokenId of def.shopItems!) {
        const item = getItemByTokenId(BigInt(tokenId));
        if (!item) continue;

        await queueItemMint(walletInfo.address, BigInt(tokenId), BigInt(INITIAL_STOCK_PER_ITEM));

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
      merchantEntityAliases.set(entity.id, entity.id);
      await persistMerchantState(state);
      console.log(
        `[merchant] Initialized ${def.name} in ${def.zoneId} — wallet ${walletInfo.address}, ${def.shopItems!.length} items stocked`
      );
    } catch (err: any) {
      const msg = String(err?.message ?? "").slice(0, 150);
      console.warn(`[merchant] Failed to init ${def.name} - ${def.zoneId}: ${msg}`);
      failedDefs.push(def);
    }
  }

  console.log(`[merchant] ${merchantStates.size} merchant agents initialized`);

  // Retry failed merchants in the background (RPC may recover)
  if (failedDefs.length > 0) {
    console.log(`[merchant] ${failedDefs.length} merchant(s) failed — scheduling retry in 30s`);
    setTimeout(() => void retryFailedMerchants(failedDefs), 30_000);
  }
}

const MAX_MERCHANT_RETRIES = 3;

async function retryFailedMerchants(defs: NpcDef[], attempt = 1): Promise<void> {
  const stillFailed: NpcDef[] = [];
  for (const def of defs) {
    const entity = findEntityByNpcDef(def);
    if (!entity || merchantStates.has(entity.id)) continue; // already initialized or gone

    try {
      const walletInfo = await createCustodialWallet();
      entity.walletAddress = walletInfo.address;
      await enqueueGoldMint(walletInfo.address, String(INITIAL_GOLD_SEED));

      const inventory = new Map<number, MerchantInventoryEntry>();
      for (const tokenId of def.shopItems!) {
        const item = getItemByTokenId(BigInt(tokenId));
        if (!item) continue;
        await queueItemMint(walletInfo.address, BigInt(tokenId), BigInt(INITIAL_STOCK_PER_ITEM));
        inventory.set(tokenId, {
          tokenId, quantity: INITIAL_STOCK_PER_ITEM, basePrice: item.copperPrice,
          currentPrice: item.copperPrice, targetStock: DEFAULT_TARGET_STOCK,
          totalSold: 0, totalBought: 0, lastRestockedAt: Date.now(),
        });
      }

      merchantStates.set(entity.id, {
        entityId: entity.id, npcName: def.name, zoneId: def.zoneId,
        walletAddress: walletInfo.address, shopItems: def.shopItems!,
        inventory, goldBalance: INITIAL_GOLD_SEED, lastInventorySyncAt: Date.now(),
        lastPriceUpdateAt: Date.now(), lastAnnouncementAt: 0, lastRestockAt: Date.now(),
      });
      persistMerchantStateEventually(merchantStates.get(entity.id)!, "retry-init");
      console.log(`[merchant] Retry OK: ${def.name} initialized on attempt ${attempt}`);
    } catch {
      stillFailed.push(def);
    }
  }

  if (stillFailed.length > 0 && attempt < MAX_MERCHANT_RETRIES) {
    const delay = 30_000 * 2 ** (attempt - 1); // 30s, 60s, 120s
    console.log(`[merchant] ${stillFailed.length} merchant(s) still failing — retry ${attempt + 1} in ${delay / 1000}s`);
    setTimeout(() => void retryFailedMerchants(stillFailed, attempt + 1), delay);
  } else if (stillFailed.length > 0) {
    console.error(`[merchant] ${stillFailed.length} merchant(s) failed after ${MAX_MERCHANT_RETRIES} retries: ${stillFailed.map((d) => d.name).join(", ")}`);
  }
}

// ── Tick Phases ──────────────────────────────────────────────────

async function syncInventory(state: MerchantState): Promise<void> {
  try {
    // Sync gold
    const rawGold = parseFloat(await getGoldBalance(state.walletAddress));
    state.goldBalance = Number.isFinite(rawGold) ? await getAvailableGoldAsync(state.walletAddress, rawGold) : 0;

    // Sync item balances
    for (const [tokenId, entry] of state.inventory) {
      const balance = await getItemBalance(state.walletAddress, BigInt(tokenId));
      entry.quantity = Number(balance);
    }

    state.lastInventorySyncAt = Date.now();
    await persistMerchantState(state);
  } catch (err) {
    console.error(`[merchant] Inventory sync failed for ${state.npcName}:`, err);
  }
}

function updatePrices(state: MerchantState): void {
  for (const entry of state.inventory.values()) {
    entry.currentPrice = calculateDynamicPrice(entry.basePrice, entry.quantity, entry.targetStock);
  }
  state.lastPriceUpdateAt = Date.now();
  persistMerchantStateEventually(state, "price-update");
}

async function restockItems(state: MerchantState): Promise<void> {
  const now = Date.now();
  for (const entry of state.inventory.values()) {
    // Restock if below 30% of target
    if (entry.quantity < entry.targetStock * 0.3) {
      const restockQty = Math.min(5, entry.targetStock - entry.quantity);
      if (restockQty <= 0) continue;

      try {
        await queueItemMint(state.walletAddress, BigInt(entry.tokenId), BigInt(restockQty));
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
  await persistMerchantState(state);
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
  persistMerchantStateEventually(state, "announcement");
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
