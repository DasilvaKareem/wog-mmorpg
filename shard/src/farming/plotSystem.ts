/**
 * Plot System — land claiming, ownership, and management.
 * Each farmland zone has 8-12 fixed plot positions.
 * Players can claim one plot at a time for gold.
 *
 * Three-layer persistence:
 *   1. In-memory (fast read source)
 *   2. Redis (survives server restarts)
 *   3. On-chain ERC-721 (proof of ownership, fire-and-forget)
 */

import { getRedis } from "../redis.js";
import { claimPlotOnChain, releasePlotOnChain, transferPlotOnChain, updateBuildingOnChain } from "./plotChain.js";
import {
  type ChainOperationRecord,
  createChainOperation,
  getChainOperation,
  listDueChainOperations,
  processTrackedChainOperation,
  registerChainOperationProcessor,
} from "../blockchain/chainOperationStore.js";
import { isPostgresConfigured } from "../db/postgres.js";
import {
  getPersistedOwnedPlotState,
  getPersistedPlotState,
  listPersistedPlotStates,
  listPersistedPlotStatesByZone,
  upsertPlotState,
} from "../db/plotStateStore.js";

// ── Types ────────────────────────────────────────────────────────────

export interface PlotDefinition {
  plotId: string;
  zoneId: string;
  x: number;
  y: number;
  /** Gold cost to claim */
  cost: number;
}

export interface PlotState {
  plotId: string;
  zoneId: string;
  x: number;
  y: number;
  owner: string | null; // wallet address
  ownerName: string | null;
  claimedAt: number | null;
  buildingType: string | null;
  buildingStage: number; // 0 = empty, 1-4 = stages
}

// ── Redis key helpers ────────────────────────────────────────────────

const PLOT_KEY_PREFIX = "plot:";
const OWNER_KEY_PREFIX = "plot:owner:";
const PLOT_OP_CLAIM = "plot-claim";
const PLOT_OP_RELEASE = "plot-release";
const PLOT_OP_TRANSFER = "plot-transfer";
const PLOT_OP_BUILDING = "plot-building";

function plotKey(plotId: string): string { return `${PLOT_KEY_PREFIX}${plotId}`; }
function ownerKey(wallet: string): string { return `${OWNER_KEY_PREFIX}${wallet.toLowerCase()}`; }

// ── Plot definitions per zone ────────────────────────────────────────

const PLOT_DEFS: PlotDefinition[] = [
  // sunflower-fields — 10 plots (starter zone, cheapest land in the game)
  { plotId: "sf-plot-1", zoneId: "sunflower-fields", x: 100, y: 100, cost: 25 },
  { plotId: "sf-plot-2", zoneId: "sunflower-fields", x: 250, y: 100, cost: 30 },
  { plotId: "sf-plot-3", zoneId: "sunflower-fields", x: 400, y: 100, cost: 35 },
  { plotId: "sf-plot-4", zoneId: "sunflower-fields", x: 550, y: 100, cost: 40 },
  { plotId: "sf-plot-5", zoneId: "sunflower-fields", x: 100, y: 280, cost: 30 },
  { plotId: "sf-plot-6", zoneId: "sunflower-fields", x: 250, y: 280, cost: 35 },
  { plotId: "sf-plot-7", zoneId: "sunflower-fields", x: 400, y: 280, cost: 40 },
  { plotId: "sf-plot-8", zoneId: "sunflower-fields", x: 550, y: 280, cost: 45 },
  { plotId: "sf-plot-9", zoneId: "sunflower-fields", x: 200, y: 450, cost: 45 },
  { plotId: "sf-plot-10", zoneId: "sunflower-fields", x: 450, y: 450, cost: 50 },

  // harvest-hollow — 12 plots
  { plotId: "hh-plot-1", zoneId: "harvest-hollow", x: 80, y: 80, cost: 75 },
  { plotId: "hh-plot-2", zoneId: "harvest-hollow", x: 220, y: 80, cost: 80 },
  { plotId: "hh-plot-3", zoneId: "harvest-hollow", x: 360, y: 80, cost: 85 },
  { plotId: "hh-plot-4", zoneId: "harvest-hollow", x: 500, y: 80, cost: 90 },
  { plotId: "hh-plot-5", zoneId: "harvest-hollow", x: 80, y: 240, cost: 95 },
  { plotId: "hh-plot-6", zoneId: "harvest-hollow", x: 220, y: 240, cost: 100 },
  { plotId: "hh-plot-7", zoneId: "harvest-hollow", x: 360, y: 240, cost: 110 },
  { plotId: "hh-plot-8", zoneId: "harvest-hollow", x: 500, y: 240, cost: 120 },
  { plotId: "hh-plot-9", zoneId: "harvest-hollow", x: 80, y: 400, cost: 130 },
  { plotId: "hh-plot-10", zoneId: "harvest-hollow", x: 220, y: 400, cost: 135 },
  { plotId: "hh-plot-11", zoneId: "harvest-hollow", x: 360, y: 400, cost: 140 },
  { plotId: "hh-plot-12", zoneId: "harvest-hollow", x: 500, y: 400, cost: 150 },

  // willowfen-pastures — 8 plots
  { plotId: "wp-plot-1", zoneId: "willowfen-pastures", x: 120, y: 120, cost: 60 },
  { plotId: "wp-plot-2", zoneId: "willowfen-pastures", x: 320, y: 120, cost: 70 },
  { plotId: "wp-plot-3", zoneId: "willowfen-pastures", x: 520, y: 120, cost: 80 },
  { plotId: "wp-plot-4", zoneId: "willowfen-pastures", x: 120, y: 320, cost: 90 },
  { plotId: "wp-plot-5", zoneId: "willowfen-pastures", x: 320, y: 320, cost: 100 },
  { plotId: "wp-plot-6", zoneId: "willowfen-pastures", x: 520, y: 320, cost: 110 },
  { plotId: "wp-plot-7", zoneId: "willowfen-pastures", x: 220, y: 500, cost: 115 },
  { plotId: "wp-plot-8", zoneId: "willowfen-pastures", x: 420, y: 500, cost: 120 },

  // bramblewood-homestead — 10 plots
  { plotId: "bh-plot-1", zoneId: "bramblewood-homestead", x: 100, y: 150, cost: 100 },
  { plotId: "bh-plot-2", zoneId: "bramblewood-homestead", x: 300, y: 150, cost: 110 },
  { plotId: "bh-plot-3", zoneId: "bramblewood-homestead", x: 500, y: 150, cost: 120 },
  { plotId: "bh-plot-4", zoneId: "bramblewood-homestead", x: 100, y: 350, cost: 130 },
  { plotId: "bh-plot-5", zoneId: "bramblewood-homestead", x: 300, y: 350, cost: 140 },
  { plotId: "bh-plot-6", zoneId: "bramblewood-homestead", x: 500, y: 350, cost: 150 },
  { plotId: "bh-plot-7", zoneId: "bramblewood-homestead", x: 100, y: 520, cost: 160 },
  { plotId: "bh-plot-8", zoneId: "bramblewood-homestead", x: 300, y: 520, cost: 170 },
  { plotId: "bh-plot-9", zoneId: "bramblewood-homestead", x: 500, y: 520, cost: 180 },
  { plotId: "bh-plot-10", zoneId: "bramblewood-homestead", x: 200, y: 250, cost: 200 },

  // goldenreach-grange — 10 plots
  { plotId: "gg-plot-1", zoneId: "goldenreach-grange", x: 100, y: 100, cost: 80 },
  { plotId: "gg-plot-2", zoneId: "goldenreach-grange", x: 280, y: 100, cost: 90 },
  { plotId: "gg-plot-3", zoneId: "goldenreach-grange", x: 460, y: 100, cost: 100 },
  { plotId: "gg-plot-4", zoneId: "goldenreach-grange", x: 100, y: 280, cost: 110 },
  { plotId: "gg-plot-5", zoneId: "goldenreach-grange", x: 280, y: 280, cost: 120 },
  { plotId: "gg-plot-6", zoneId: "goldenreach-grange", x: 460, y: 280, cost: 130 },
  { plotId: "gg-plot-7", zoneId: "goldenreach-grange", x: 100, y: 460, cost: 140 },
  { plotId: "gg-plot-8", zoneId: "goldenreach-grange", x: 280, y: 460, cost: 150 },
  { plotId: "gg-plot-9", zoneId: "goldenreach-grange", x: 460, y: 460, cost: 155 },
  { plotId: "gg-plot-10", zoneId: "goldenreach-grange", x: 280, y: 560, cost: 160 },

  // dewveil-orchard — 8 plots
  { plotId: "do-plot-1", zoneId: "dewveil-orchard", x: 120, y: 120, cost: 120 },
  { plotId: "do-plot-2", zoneId: "dewveil-orchard", x: 320, y: 120, cost: 140 },
  { plotId: "do-plot-3", zoneId: "dewveil-orchard", x: 520, y: 120, cost: 160 },
  { plotId: "do-plot-4", zoneId: "dewveil-orchard", x: 120, y: 320, cost: 180 },
  { plotId: "do-plot-5", zoneId: "dewveil-orchard", x: 320, y: 320, cost: 200 },
  { plotId: "do-plot-6", zoneId: "dewveil-orchard", x: 520, y: 320, cost: 220 },
  { plotId: "do-plot-7", zoneId: "dewveil-orchard", x: 220, y: 500, cost: 240 },
  { plotId: "do-plot-8", zoneId: "dewveil-orchard", x: 420, y: 500, cost: 250 },

  // thornwall-ranch — 10 plots
  { plotId: "tr-plot-1", zoneId: "thornwall-ranch", x: 100, y: 130, cost: 100 },
  { plotId: "tr-plot-2", zoneId: "thornwall-ranch", x: 300, y: 130, cost: 110 },
  { plotId: "tr-plot-3", zoneId: "thornwall-ranch", x: 500, y: 130, cost: 120 },
  { plotId: "tr-plot-4", zoneId: "thornwall-ranch", x: 100, y: 320, cost: 130 },
  { plotId: "tr-plot-5", zoneId: "thornwall-ranch", x: 300, y: 320, cost: 140 },
  { plotId: "tr-plot-6", zoneId: "thornwall-ranch", x: 500, y: 320, cost: 150 },
  { plotId: "tr-plot-7", zoneId: "thornwall-ranch", x: 100, y: 500, cost: 160 },
  { plotId: "tr-plot-8", zoneId: "thornwall-ranch", x: 300, y: 500, cost: 170 },
  { plotId: "tr-plot-9", zoneId: "thornwall-ranch", x: 500, y: 500, cost: 180 },
  { plotId: "tr-plot-10", zoneId: "thornwall-ranch", x: 300, y: 560, cost: 200 },

  // moonpetal-gardens — 8 plots
  { plotId: "mg-plot-1", zoneId: "moonpetal-gardens", x: 150, y: 100, cost: 150 },
  { plotId: "mg-plot-2", zoneId: "moonpetal-gardens", x: 350, y: 100, cost: 170 },
  { plotId: "mg-plot-3", zoneId: "moonpetal-gardens", x: 550, y: 100, cost: 190 },
  { plotId: "mg-plot-4", zoneId: "moonpetal-gardens", x: 150, y: 300, cost: 210 },
  { plotId: "mg-plot-5", zoneId: "moonpetal-gardens", x: 350, y: 300, cost: 230 },
  { plotId: "mg-plot-6", zoneId: "moonpetal-gardens", x: 550, y: 300, cost: 250 },
  { plotId: "mg-plot-7", zoneId: "moonpetal-gardens", x: 250, y: 480, cost: 270 },
  { plotId: "mg-plot-8", zoneId: "moonpetal-gardens", x: 450, y: 480, cost: 300 },

  // ironroot-farmstead — 10 plots
  { plotId: "if-plot-1", zoneId: "ironroot-farmstead", x: 100, y: 100, cost: 200 },
  { plotId: "if-plot-2", zoneId: "ironroot-farmstead", x: 280, y: 100, cost: 220 },
  { plotId: "if-plot-3", zoneId: "ironroot-farmstead", x: 460, y: 100, cost: 240 },
  { plotId: "if-plot-4", zoneId: "ironroot-farmstead", x: 100, y: 280, cost: 260 },
  { plotId: "if-plot-5", zoneId: "ironroot-farmstead", x: 280, y: 280, cost: 280 },
  { plotId: "if-plot-6", zoneId: "ironroot-farmstead", x: 460, y: 280, cost: 300 },
  { plotId: "if-plot-7", zoneId: "ironroot-farmstead", x: 100, y: 460, cost: 320 },
  { plotId: "if-plot-8", zoneId: "ironroot-farmstead", x: 280, y: 460, cost: 350 },
  { plotId: "if-plot-9", zoneId: "ironroot-farmstead", x: 460, y: 460, cost: 380 },
  { plotId: "if-plot-10", zoneId: "ironroot-farmstead", x: 280, y: 560, cost: 400 },

  // crystalbloom-terrace — 8 plots
  { plotId: "ct-plot-1", zoneId: "crystalbloom-terrace", x: 120, y: 120, cost: 250 },
  { plotId: "ct-plot-2", zoneId: "crystalbloom-terrace", x: 320, y: 120, cost: 280 },
  { plotId: "ct-plot-3", zoneId: "crystalbloom-terrace", x: 520, y: 120, cost: 310 },
  { plotId: "ct-plot-4", zoneId: "crystalbloom-terrace", x: 120, y: 320, cost: 350 },
  { plotId: "ct-plot-5", zoneId: "crystalbloom-terrace", x: 320, y: 320, cost: 400 },
  { plotId: "ct-plot-6", zoneId: "crystalbloom-terrace", x: 520, y: 320, cost: 430 },
  { plotId: "ct-plot-7", zoneId: "crystalbloom-terrace", x: 220, y: 500, cost: 470 },
  { plotId: "ct-plot-8", zoneId: "crystalbloom-terrace", x: 420, y: 500, cost: 500 },
  // copperfield-meadow — 10 plots (cheap starter expansion)
  { plotId: "cm-plot-1", zoneId: "copperfield-meadow", x: 100, y: 100, cost: 20 },
  { plotId: "cm-plot-2", zoneId: "copperfield-meadow", x: 280, y: 100, cost: 25 },
  { plotId: "cm-plot-3", zoneId: "copperfield-meadow", x: 460, y: 100, cost: 30 },
  { plotId: "cm-plot-4", zoneId: "copperfield-meadow", x: 100, y: 280, cost: 25 },
  { plotId: "cm-plot-5", zoneId: "copperfield-meadow", x: 280, y: 280, cost: 30 },
  { plotId: "cm-plot-6", zoneId: "copperfield-meadow", x: 460, y: 280, cost: 35 },
  { plotId: "cm-plot-7", zoneId: "copperfield-meadow", x: 100, y: 460, cost: 35 },
  { plotId: "cm-plot-8", zoneId: "copperfield-meadow", x: 280, y: 460, cost: 40 },
  { plotId: "cm-plot-9", zoneId: "copperfield-meadow", x: 460, y: 460, cost: 45 },
  { plotId: "cm-plot-10", zoneId: "copperfield-meadow", x: 280, y: 560, cost: 50 },

  // silkwood-grove — 10 plots (mid-tier)
  { plotId: "sg-plot-1", zoneId: "silkwood-grove", x: 100, y: 120, cost: 80 },
  { plotId: "sg-plot-2", zoneId: "silkwood-grove", x: 300, y: 120, cost: 90 },
  { plotId: "sg-plot-3", zoneId: "silkwood-grove", x: 500, y: 120, cost: 100 },
  { plotId: "sg-plot-4", zoneId: "silkwood-grove", x: 100, y: 300, cost: 110 },
  { plotId: "sg-plot-5", zoneId: "silkwood-grove", x: 300, y: 300, cost: 120 },
  { plotId: "sg-plot-6", zoneId: "silkwood-grove", x: 500, y: 300, cost: 130 },
  { plotId: "sg-plot-7", zoneId: "silkwood-grove", x: 100, y: 480, cost: 140 },
  { plotId: "sg-plot-8", zoneId: "silkwood-grove", x: 300, y: 480, cost: 150 },
  { plotId: "sg-plot-9", zoneId: "silkwood-grove", x: 500, y: 480, cost: 160 },
  { plotId: "sg-plot-10", zoneId: "silkwood-grove", x: 300, y: 560, cost: 175 },

  // emberglow-estate — 8 plots (premium)
  { plotId: "ee-plot-1", zoneId: "emberglow-estate", x: 120, y: 120, cost: 200 },
  { plotId: "ee-plot-2", zoneId: "emberglow-estate", x: 350, y: 120, cost: 230 },
  { plotId: "ee-plot-3", zoneId: "emberglow-estate", x: 520, y: 120, cost: 260 },
  { plotId: "ee-plot-4", zoneId: "emberglow-estate", x: 120, y: 350, cost: 300 },
  { plotId: "ee-plot-5", zoneId: "emberglow-estate", x: 350, y: 350, cost: 350 },
  { plotId: "ee-plot-6", zoneId: "emberglow-estate", x: 520, y: 350, cost: 400 },
  { plotId: "ee-plot-7", zoneId: "emberglow-estate", x: 250, y: 520, cost: 450 },
  { plotId: "ee-plot-8", zoneId: "emberglow-estate", x: 450, y: 520, cost: 500 },

  // starfall-ranch — 6 plots (luxury, most expensive land)
  { plotId: "sr-plot-1", zoneId: "starfall-ranch", x: 150, y: 150, cost: 400 },
  { plotId: "sr-plot-2", zoneId: "starfall-ranch", x: 400, y: 150, cost: 500 },
  { plotId: "sr-plot-3", zoneId: "starfall-ranch", x: 150, y: 350, cost: 600 },
  { plotId: "sr-plot-4", zoneId: "starfall-ranch", x: 400, y: 350, cost: 700 },
  { plotId: "sr-plot-5", zoneId: "starfall-ranch", x: 250, y: 500, cost: 850 },
  { plotId: "sr-plot-6", zoneId: "starfall-ranch", x: 450, y: 500, cost: 1000 },
];

// ── In-memory state ──────────────────────────────────────────────────

const plotStates = new Map<string, PlotState>();
const ownerPlots = new Map<string, string>(); // walletAddress → plotId (one plot per player)

/** Initialize plot states from definitions (defaults — no ownership) */
function ensureInitialized(): void {
  if (plotStates.size > 0) return;
  for (const def of PLOT_DEFS) {
    plotStates.set(def.plotId, {
      plotId: def.plotId,
      zoneId: def.zoneId,
      x: def.x,
      y: def.y,
      owner: null,
      ownerName: null,
      claimedAt: null,
      buildingType: null,
      buildingStage: 0,
    });
  }
}

function applyPlotState(state: PlotState): void {
  plotStates.set(state.plotId, { ...state });
  for (const [wallet, ownedPlotId] of ownerPlots.entries()) {
    if (ownedPlotId === state.plotId) ownerPlots.delete(wallet);
  }
  if (state.owner) {
    ownerPlots.set(state.owner.toLowerCase(), state.plotId);
  }
}

function mergeWithDefinition(state: PlotState): PlotState {
  const def = getPlotDef(state.plotId);
  if (!def) return state;
  return {
    ...state,
    zoneId: def.zoneId,
    x: def.x,
    y: def.y,
  };
}

async function hydratePlotById(plotId: string): Promise<PlotState | null> {
  ensureInitialized();
  const cached = plotStates.get(plotId);
  const persisted = await getPersistedPlotState(plotId);
  if (!persisted) return cached ?? null;
  const next = mergeWithDefinition(persisted);
  applyPlotState(next);
  return next;
}

async function hydrateOwnedPlotByWallet(walletAddress: string): Promise<PlotState | null> {
  ensureInitialized();
  const normalized = walletAddress.toLowerCase();
  const cachedId = ownerPlots.get(normalized);
  if (cachedId) {
    const cached = plotStates.get(cachedId);
    if (cached?.owner === normalized) return cached;
  }
  const persisted = await getPersistedOwnedPlotState(normalized);
  if (!persisted) return null;
  const next = mergeWithDefinition(persisted);
  applyPlotState(next);
  return next;
}

// ── Persistence ──────────────────────────────────────────────────────

async function persistPlotState(state: PlotState): Promise<void> {
  if (isPostgresConfigured()) {
    await upsertPlotState(state);
  }
  const redis = getRedis();
  if (!redis) return;
  const fields: Record<string, string> = {
    owner: state.owner ?? "",
    ownerName: state.ownerName ?? "",
    claimedAt: String(state.claimedAt ?? 0),
    buildingType: state.buildingType ?? "",
    buildingStage: String(state.buildingStage),
    zoneId: state.zoneId,
  };
  await redis.hset(plotKey(state.plotId), fields).catch((err: any) =>
    console.warn(`[plots] Redis write failed for ${state.plotId}: ${err.message?.slice(0, 60)}`)
  );
  if (state.owner) {
    await redis.set(ownerKey(state.owner), state.plotId).catch(() => {});
  }
}

async function clearPlotOwnerCache(plotId: string, wallet: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(ownerKey(wallet)).catch(() => {});
  const state = plotStates.get(plotId);
  if (state) {
    await redis.hset(plotKey(plotId), {
      owner: "",
      ownerName: "",
      claimedAt: "0",
      buildingType: state.buildingType ?? "",
      buildingStage: String(state.buildingStage),
      zoneId: state.zoneId,
    }).catch(() => {});
    return;
  }
  await redis.del(plotKey(plotId)).catch(() => {});
}

async function enqueuePlotOperation(type: string, subject: string, payload: unknown): Promise<void> {
  const record = await createChainOperation(type, subject, payload);
  void processPlotOperation(record.operationId).catch((err) => {
    console.warn(`[plots] Failed to dispatch ${type} for ${subject}: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
  });
}

/**
 * Restore all plot ownership from Redis on boot.
 * Call once during server startup before routes are registered.
 */
export async function initializePlotsFromRedis(): Promise<void> {
  ensureInitialized();
  if (isPostgresConfigured()) {
    const persistedStates = await listPersistedPlotStates();
    if (persistedStates.length > 0) {
      ownerPlots.clear();
      for (const state of persistedStates) {
        const existing = plotStates.get(state.plotId);
        if (!existing) continue;
        applyPlotState({ ...existing, ...state });
      }
      console.log(`[plots] Restored ${persistedStates.filter((state) => state.owner).length} owned plots from Postgres (${PLOT_DEFS.length} total)`);
      return;
    }
  }

  const redis = getRedis();
  if (!redis) {
    console.log("[plots] No Redis — using in-memory default plot state");
    return;
  }

  let restored = 0;
  for (const def of PLOT_DEFS) {
    try {
      const data = await redis.hgetall(plotKey(def.plotId));
      if (data?.owner && data.owner !== "") {
        const state = plotStates.get(def.plotId);
        if (state) {
          state.owner = data.owner;
          state.ownerName = data.ownerName || null;
          state.claimedAt = Number(data.claimedAt) || null;
          state.buildingType = data.buildingType || null;
          state.buildingStage = Number(data.buildingStage) || 0;
          ownerPlots.set(data.owner, def.plotId);
          if (isPostgresConfigured()) {
            await upsertPlotState(state);
          }
          restored++;
        }
      }
    } catch (err: any) {
      console.warn(`[plots] Redis read failed for ${def.plotId}: ${err.message?.slice(0, 60)}`);
    }
  }

  console.log(`[plots] Restored ${restored} owned plots from Redis (${PLOT_DEFS.length} total)`);
}

// ── Public API ───────────────────────────────────────────────────────

export function getAllPlotDefs(): PlotDefinition[] {
  return PLOT_DEFS;
}

export function getPlotsInZone(zoneId: string): PlotState[] {
  ensureInitialized();
  const results: PlotState[] = [];
  for (const state of plotStates.values()) {
    if (state.zoneId === zoneId) results.push(state);
  }
  return results;
}

export async function getPlotsInZoneAsync(zoneId: string): Promise<PlotState[]> {
  ensureInitialized();
  if (isPostgresConfigured()) {
    const persistedStates = await listPersistedPlotStatesByZone(zoneId);
    if (persistedStates.length > 0) {
      for (const state of persistedStates) {
        applyPlotState(mergeWithDefinition(state));
      }
    }
  }
  return getPlotsInZone(zoneId);
}

export function getPlotById(plotId: string): PlotState | null {
  ensureInitialized();
  return plotStates.get(plotId) ?? null;
}

export async function getPlotByIdAsync(plotId: string): Promise<PlotState | null> {
  return await hydratePlotById(plotId);
}

export function getPlotDef(plotId: string): PlotDefinition | null {
  return PLOT_DEFS.find((d) => d.plotId === plotId) ?? null;
}

export function getOwnedPlot(walletAddress: string): PlotState | null {
  ensureInitialized();
  const plotId = ownerPlots.get(walletAddress.toLowerCase());
  if (!plotId) return null;
  return plotStates.get(plotId) ?? null;
}

export async function getOwnedPlotAsync(walletAddress: string): Promise<PlotState | null> {
  return await hydrateOwnedPlotByWallet(walletAddress);
}

export function claimPlot(
  plotId: string,
  walletAddress: string,
  ownerName: string
): Promise<{ ok: boolean; error?: string; plot?: PlotState }> {
  const wallet = walletAddress.toLowerCase();
  return (async () => {
  if (await getOwnedPlotAsync(wallet)) {
    return Promise.resolve({ ok: false, error: "You already own a plot. Release it first." });
  }

  const state = await getPlotByIdAsync(plotId);
  if (!state) return Promise.resolve({ ok: false, error: "Plot not found." });
  if (state.owner) return Promise.resolve({ ok: false, error: "This plot is already claimed." });

  const nextState: PlotState = {
    ...state,
    owner: wallet,
    ownerName,
    claimedAt: Date.now(),
  };

  return persistPlotState(nextState).then(() => {
    ownerPlots.set(wallet, plotId);
    applyPlotState(nextState);
    void enqueuePlotOperation(PLOT_OP_CLAIM, plotId, {
      plotId,
      zoneId: nextState.zoneId,
      x: nextState.x,
      y: nextState.y,
      ownerAddress: wallet,
    });
    return { ok: true, plot: nextState };
  }).catch((err: any) => ({
    ok: false,
    error: err?.message ?? "Failed to persist plot claim.",
  }));
  })();
}

export function releasePlot(
  walletAddress: string
): Promise<{ ok: boolean; error?: string; plotId?: string }> {
  const wallet = walletAddress.toLowerCase();
  return (async () => {
  const owned = await getOwnedPlotAsync(wallet);
  if (!owned) return Promise.resolve({ ok: false, error: "You don't own a plot." });
  const plotId = owned.plotId;
  const state = owned;

  const nextState: PlotState = {
    ...state,
    owner: null,
    ownerName: null,
    claimedAt: null,
    buildingType: null,
    buildingStage: 0,
  };

  return persistPlotState(nextState).then(async () => {
    ownerPlots.delete(wallet);
    applyPlotState(nextState);
    await clearPlotOwnerCache(plotId, wallet);
    void enqueuePlotOperation(PLOT_OP_RELEASE, plotId, { ownerAddress: wallet, plotId });
    return { ok: true, plotId };
  }).catch((err: any) => ({
    ok: false,
    error: err?.message ?? "Failed to release plot.",
  }));
  })();
}

export function transferPlot(
  fromWallet: string,
  toWallet: string,
  toName: string
): Promise<{ ok: boolean; error?: string }> {
  const from = fromWallet.toLowerCase();
  const to = toWallet.toLowerCase();
  return (async () => {
  if (await getOwnedPlotAsync(to)) {
    return Promise.resolve({ ok: false, error: "Recipient already owns a plot." });
  }

  const state = await getOwnedPlotAsync(from);
  if (!state) return Promise.resolve({ ok: false, error: "You don't own a plot to transfer." });
  const plotId = state.plotId;

  const nextState: PlotState = {
    ...state,
    owner: to,
    ownerName: toName,
  };

  return persistPlotState(nextState).then(async () => {
    ownerPlots.delete(from);
    ownerPlots.set(to, plotId);
    applyPlotState(nextState);
    await clearPlotOwnerCache(plotId, from);
    void enqueuePlotOperation(PLOT_OP_TRANSFER, plotId, {
      plotId,
      fromAddress: from,
      toAddress: to,
    });
    return { ok: true };
  }).catch((err: any) => ({
    ok: false,
    error: err?.message ?? "Failed to transfer plot.",
  }));
  })();
}

/** Update building state on a plot (called by building system) */
export function setPlotBuilding(
  plotId: string,
  buildingType: string | null,
  stage: number
): Promise<void> {
  return (async () => {
    const state = await getPlotByIdAsync(plotId);
    if (!state) return;
    const nextState: PlotState = {
      ...state,
      buildingType,
      buildingStage: stage,
    };
    await persistPlotState(nextState);
    applyPlotState(nextState);
    void enqueuePlotOperation(PLOT_OP_BUILDING, plotId, {
      plotId,
      buildingType: buildingType ?? "",
      stage,
    });
  })();
}

/** Check if a wallet owns a specific plot */
export function isPlotOwner(plotId: string, walletAddress: string): boolean {
  ensureInitialized();
  const state = plotStates.get(plotId);
  return state?.owner === walletAddress.toLowerCase();
}

export async function isPlotOwnerAsync(plotId: string, walletAddress: string): Promise<boolean> {
  const state = await getPlotByIdAsync(plotId);
  return state?.owner === walletAddress.toLowerCase();
}

/** Get all farmland zone IDs that have plots */
export function getFarmlandZoneIds(): string[] {
  return [...new Set(PLOT_DEFS.map((d) => d.zoneId))];
}

export async function processPlotOperation(operationId: string): Promise<void> {
  const record = await getChainOperation(operationId);
  if (!record) return;
  await processTrackedChainOperation(operationId);
}

export async function processPendingPlotOperations(
  logger: { error: (err: unknown, msg?: string) => void } = console,
): Promise<void> {
  for (const type of [PLOT_OP_CLAIM, PLOT_OP_RELEASE, PLOT_OP_TRANSFER, PLOT_OP_BUILDING]) {
    const ops = await listDueChainOperations(type);
    for (const op of ops) {
      try {
        await processPlotOperation(op.operationId);
      } catch (err) {
        logger.error(err, `[plots] worker failed for ${op.operationId}`);
      }
    }
  }
}

export function startPlotOperationWorker(logger: { error: (err: unknown, msg?: string) => void }): void {
  const tick = async () => {
    await processPendingPlotOperations(logger);
  };

  void tick().catch((err) => logger.error(err, "[plots] initial worker tick failed"));
  setInterval(() => {
    tick().catch((err) => logger.error(err, "[plots] worker tick failed"));
  }, 5_000);
}

async function runPlotProcessor(record: ChainOperationRecord): Promise<{ result: true }> {
  const payload = JSON.parse(record.payload) as Record<string, string | number>;
  let success = false;
  if (record.type === PLOT_OP_CLAIM) {
    success = await claimPlotOnChain(
      String(payload.plotId),
      String(payload.zoneId),
      Number(payload.x),
      Number(payload.y),
      String(payload.ownerAddress),
    );
  } else if (record.type === PLOT_OP_RELEASE) {
    success = await releasePlotOnChain(String(payload.ownerAddress));
  } else if (record.type === PLOT_OP_TRANSFER) {
    success = await transferPlotOnChain(String(payload.fromAddress), String(payload.toAddress));
  } else if (record.type === PLOT_OP_BUILDING) {
    success = await updateBuildingOnChain(String(payload.plotId), String(payload.buildingType ?? ""), Number(payload.stage ?? 0));
  }
  if (!success) {
    throw new Error(`Chain operation ${record.type} did not complete`);
  }
  return { result: true };
}

registerChainOperationProcessor(PLOT_OP_CLAIM, runPlotProcessor as any);
registerChainOperationProcessor(PLOT_OP_RELEASE, runPlotProcessor as any);
registerChainOperationProcessor(PLOT_OP_TRANSFER, runPlotProcessor as any);
registerChainOperationProcessor(PLOT_OP_BUILDING, runPlotProcessor as any);
