/**
 * Plot System — land claiming, ownership, and management.
 * Each farmland zone has 8-12 fixed plot positions.
 * Players can claim one plot at a time for gold.
 */

import { randomUUID } from "crypto";

// ── Types ────────────────────────────────────────────────────────────

export interface PlotDefinition {
  plotId: string;
  zoneId: string;
  x: number;
  y: number;
  /** Gold cost range [min, max] — actual cost is min for now */
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

// ── Plot definitions per zone ────────────────────────────────────────

const PLOT_DEFS: PlotDefinition[] = [
  // sunflower-fields — 10 plots
  { plotId: "sf-plot-1", zoneId: "sunflower-fields", x: 100, y: 100, cost: 50 },
  { plotId: "sf-plot-2", zoneId: "sunflower-fields", x: 250, y: 100, cost: 60 },
  { plotId: "sf-plot-3", zoneId: "sunflower-fields", x: 400, y: 100, cost: 70 },
  { plotId: "sf-plot-4", zoneId: "sunflower-fields", x: 550, y: 100, cost: 80 },
  { plotId: "sf-plot-5", zoneId: "sunflower-fields", x: 100, y: 280, cost: 55 },
  { plotId: "sf-plot-6", zoneId: "sunflower-fields", x: 250, y: 280, cost: 65 },
  { plotId: "sf-plot-7", zoneId: "sunflower-fields", x: 400, y: 280, cost: 75 },
  { plotId: "sf-plot-8", zoneId: "sunflower-fields", x: 550, y: 280, cost: 85 },
  { plotId: "sf-plot-9", zoneId: "sunflower-fields", x: 200, y: 450, cost: 90 },
  { plotId: "sf-plot-10", zoneId: "sunflower-fields", x: 450, y: 450, cost: 100 },

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
];

// ── In-memory state ──────────────────────────────────────────────────

const plotStates = new Map<string, PlotState>();
const ownerPlots = new Map<string, string>(); // walletAddress → plotId (one plot per player)

/** Initialize plot states from definitions */
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

export function getPlotById(plotId: string): PlotState | null {
  ensureInitialized();
  return plotStates.get(plotId) ?? null;
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

export function claimPlot(
  plotId: string,
  walletAddress: string,
  ownerName: string
): { ok: boolean; error?: string; plot?: PlotState } {
  ensureInitialized();
  const wallet = walletAddress.toLowerCase();

  // Check if player already owns a plot
  if (ownerPlots.has(wallet)) {
    return { ok: false, error: "You already own a plot. Release it first." };
  }

  const state = plotStates.get(plotId);
  if (!state) return { ok: false, error: "Plot not found." };
  if (state.owner) return { ok: false, error: "This plot is already claimed." };

  state.owner = wallet;
  state.ownerName = ownerName;
  state.claimedAt = Date.now();
  ownerPlots.set(wallet, plotId);

  return { ok: true, plot: state };
}

export function releasePlot(
  walletAddress: string
): { ok: boolean; error?: string; plotId?: string } {
  ensureInitialized();
  const wallet = walletAddress.toLowerCase();
  const plotId = ownerPlots.get(wallet);
  if (!plotId) return { ok: false, error: "You don't own a plot." };

  const state = plotStates.get(plotId);
  if (state) {
    state.owner = null;
    state.ownerName = null;
    state.claimedAt = null;
    state.buildingType = null;
    state.buildingStage = 0;
  }

  ownerPlots.delete(wallet);
  return { ok: true, plotId };
}

export function transferPlot(
  fromWallet: string,
  toWallet: string,
  toName: string
): { ok: boolean; error?: string } {
  ensureInitialized();
  const from = fromWallet.toLowerCase();
  const to = toWallet.toLowerCase();

  if (ownerPlots.has(to)) {
    return { ok: false, error: "Recipient already owns a plot." };
  }

  const plotId = ownerPlots.get(from);
  if (!plotId) return { ok: false, error: "You don't own a plot to transfer." };

  const state = plotStates.get(plotId);
  if (!state) return { ok: false, error: "Plot state not found." };

  state.owner = to;
  state.ownerName = toName;
  ownerPlots.delete(from);
  ownerPlots.set(to, plotId);

  return { ok: true };
}

/** Update building state on a plot (called by building system) */
export function setPlotBuilding(
  plotId: string,
  buildingType: string | null,
  stage: number
): void {
  ensureInitialized();
  const state = plotStates.get(plotId);
  if (!state) return;
  state.buildingType = buildingType;
  state.buildingStage = stage;
}

/** Check if a wallet owns a specific plot */
export function isPlotOwner(plotId: string, walletAddress: string): boolean {
  ensureInitialized();
  const state = plotStates.get(plotId);
  return state?.owner === walletAddress.toLowerCase();
}

/** Get all farmland zone IDs that have plots */
export function getFarmlandZoneIds(): string[] {
  return [...new Set(PLOT_DEFS.map((d) => d.zoneId))];
}
