/**
 * Building System — progressive construction on claimed plots.
 * 4 building types × 4 stages each. Each stage requires specific materials.
 */

import { getPlotById, isPlotOwner, setPlotBuilding, type PlotState } from "./plotSystem.js";

// ── Types ────────────────────────────────────────────────────────────

export interface MaterialRequirement {
  tokenId: bigint;
  name: string;
  quantity: number;
}

export interface BuildingStage {
  stage: number;
  name: string;
  materials: MaterialRequirement[];
  copperCost: number;
}

export interface BuildingBlueprint {
  type: string;
  name: string;
  description: string;
  stages: BuildingStage[];
}

// ── Token IDs for building materials ─────────────────────────────────

const TK = {
  LUMBER: 190n,
  STONE_BLOCKS: 191n,
  IRON_NAILS: 192n,
  THATCH_BUNDLE: 193n,
  CLAY_BRICKS: 194n,
  GLASS_PANES: 195n,
  TIMBER_FRAME: 196n,
  MORTAR: 197n,
  ROOF_TILES: 198n,
  CARPENTERS_HAMMER: 199n,
};

// ── Blueprints ───────────────────────────────────────────────────────

export const BUILDING_BLUEPRINTS: BuildingBlueprint[] = [
  {
    type: "cottage",
    name: "Cottage",
    description: "A small, cozy dwelling. Perfect for a farmer starting out.",
    stages: [
      {
        stage: 1,
        name: "Foundation",
        materials: [
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 10 },
          { tokenId: TK.STONE_BLOCKS, name: "Stone Blocks", quantity: 5 },
        ],
        copperCost: 100,
      },
      {
        stage: 2,
        name: "Walls",
        materials: [
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 15 },
          { tokenId: TK.STONE_BLOCKS, name: "Stone Blocks", quantity: 8 },
          { tokenId: TK.IRON_NAILS, name: "Iron Nails", quantity: 10 },
        ],
        copperCost: 200,
      },
      {
        stage: 3,
        name: "Roof",
        materials: [
          { tokenId: TK.THATCH_BUNDLE, name: "Thatch Bundle", quantity: 10 },
          { tokenId: TK.TIMBER_FRAME, name: "Timber Frame", quantity: 5 },
        ],
        copperCost: 150,
      },
      {
        stage: 4,
        name: "Furnished",
        materials: [
          { tokenId: TK.GLASS_PANES, name: "Glass Panes", quantity: 5 },
          { tokenId: TK.ROOF_TILES, name: "Roof Tiles", quantity: 3 },
        ],
        copperCost: 300,
      },
    ],
  },
  {
    type: "farmhouse",
    name: "Farmhouse",
    description: "A sturdy farmhouse with a barn and storage. Room for livestock.",
    stages: [
      {
        stage: 1,
        name: "Foundation",
        materials: [
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 15 },
          { tokenId: TK.STONE_BLOCKS, name: "Stone Blocks", quantity: 10 },
          { tokenId: TK.MORTAR, name: "Mortar", quantity: 5 },
        ],
        copperCost: 200,
      },
      {
        stage: 2,
        name: "Walls",
        materials: [
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 20 },
          { tokenId: TK.CLAY_BRICKS, name: "Clay Bricks", quantity: 12 },
          { tokenId: TK.IRON_NAILS, name: "Iron Nails", quantity: 15 },
        ],
        copperCost: 350,
      },
      {
        stage: 3,
        name: "Roof",
        materials: [
          { tokenId: TK.TIMBER_FRAME, name: "Timber Frame", quantity: 8 },
          { tokenId: TK.ROOF_TILES, name: "Roof Tiles", quantity: 10 },
        ],
        copperCost: 300,
      },
      {
        stage: 4,
        name: "Furnished",
        materials: [
          { tokenId: TK.GLASS_PANES, name: "Glass Panes", quantity: 8 },
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 10 },
          { tokenId: TK.IRON_NAILS, name: "Iron Nails", quantity: 5 },
        ],
        copperCost: 500,
      },
    ],
  },
  {
    type: "manor",
    name: "Manor",
    description: "A grand manor house with multiple rooms. A mark of wealth and status.",
    stages: [
      {
        stage: 1,
        name: "Foundation",
        materials: [
          { tokenId: TK.STONE_BLOCKS, name: "Stone Blocks", quantity: 20 },
          { tokenId: TK.MORTAR, name: "Mortar", quantity: 10 },
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 10 },
        ],
        copperCost: 400,
      },
      {
        stage: 2,
        name: "Walls",
        materials: [
          { tokenId: TK.CLAY_BRICKS, name: "Clay Bricks", quantity: 25 },
          { tokenId: TK.STONE_BLOCKS, name: "Stone Blocks", quantity: 15 },
          { tokenId: TK.IRON_NAILS, name: "Iron Nails", quantity: 20 },
          { tokenId: TK.MORTAR, name: "Mortar", quantity: 8 },
        ],
        copperCost: 600,
      },
      {
        stage: 3,
        name: "Roof",
        materials: [
          { tokenId: TK.TIMBER_FRAME, name: "Timber Frame", quantity: 12 },
          { tokenId: TK.ROOF_TILES, name: "Roof Tiles", quantity: 20 },
          { tokenId: TK.IRON_NAILS, name: "Iron Nails", quantity: 10 },
        ],
        copperCost: 500,
      },
      {
        stage: 4,
        name: "Furnished",
        materials: [
          { tokenId: TK.GLASS_PANES, name: "Glass Panes", quantity: 15 },
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 15 },
          { tokenId: TK.CLAY_BRICKS, name: "Clay Bricks", quantity: 5 },
        ],
        copperCost: 800,
      },
    ],
  },
  {
    type: "estate",
    name: "Estate",
    description: "A sprawling estate with gardens, towers, and a private forge. The pinnacle of homesteading.",
    stages: [
      {
        stage: 1,
        name: "Foundation",
        materials: [
          { tokenId: TK.STONE_BLOCKS, name: "Stone Blocks", quantity: 30 },
          { tokenId: TK.MORTAR, name: "Mortar", quantity: 15 },
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 15 },
        ],
        copperCost: 600,
      },
      {
        stage: 2,
        name: "Walls",
        materials: [
          { tokenId: TK.CLAY_BRICKS, name: "Clay Bricks", quantity: 35 },
          { tokenId: TK.STONE_BLOCKS, name: "Stone Blocks", quantity: 20 },
          { tokenId: TK.IRON_NAILS, name: "Iron Nails", quantity: 30 },
          { tokenId: TK.MORTAR, name: "Mortar", quantity: 12 },
        ],
        copperCost: 900,
      },
      {
        stage: 3,
        name: "Roof",
        materials: [
          { tokenId: TK.TIMBER_FRAME, name: "Timber Frame", quantity: 15 },
          { tokenId: TK.ROOF_TILES, name: "Roof Tiles", quantity: 30 },
          { tokenId: TK.IRON_NAILS, name: "Iron Nails", quantity: 15 },
        ],
        copperCost: 700,
      },
      {
        stage: 4,
        name: "Furnished",
        materials: [
          { tokenId: TK.GLASS_PANES, name: "Glass Panes", quantity: 20 },
          { tokenId: TK.LUMBER, name: "Lumber", quantity: 20 },
          { tokenId: TK.CLAY_BRICKS, name: "Clay Bricks", quantity: 10 },
          { tokenId: TK.CARPENTERS_HAMMER, name: "Carpenter's Hammer", quantity: 1 },
        ],
        copperCost: 1200,
      },
    ],
  },
];

// ── Public API ───────────────────────────────────────────────────────

export function getBlueprint(buildingType: string): BuildingBlueprint | null {
  return BUILDING_BLUEPRINTS.find((b) => b.type === buildingType) ?? null;
}

export function getAllBlueprints(): BuildingBlueprint[] {
  return BUILDING_BLUEPRINTS;
}

/**
 * Start building on a plot. Sets stage to 0 with a building type chosen.
 * The actual first construction (stage 0→1) still requires materials.
 */
export function startBuilding(
  plotId: string,
  walletAddress: string,
  buildingType: string
): { ok: boolean; error?: string; plot?: PlotState } {
  const plot = getPlotById(plotId);
  if (!plot) return { ok: false, error: "Plot not found." };
  if (!isPlotOwner(plotId, walletAddress)) {
    return { ok: false, error: "You don't own this plot." };
  }
  if (plot.buildingType) {
    return { ok: false, error: "A building already exists on this plot. Demolish first." };
  }

  const bp = getBlueprint(buildingType);
  if (!bp) return { ok: false, error: `Unknown building type: ${buildingType}` };

  setPlotBuilding(plotId, buildingType, 0);
  return { ok: true, plot: getPlotById(plotId)! };
}

/**
 * Get what's needed for the next construction stage.
 */
export function getNextStageRequirements(
  plotId: string
): { ok: boolean; error?: string; stage?: BuildingStage; currentStage?: number } {
  const plot = getPlotById(plotId);
  if (!plot) return { ok: false, error: "Plot not found." };
  if (!plot.buildingType) return { ok: false, error: "No building started on this plot." };

  const bp = getBlueprint(plot.buildingType);
  if (!bp) return { ok: false, error: "Unknown building type." };

  const nextStageIdx = plot.buildingStage; // stages are 1-indexed but array is 0-indexed
  if (nextStageIdx >= bp.stages.length) {
    return { ok: false, error: "Building is already fully constructed.", currentStage: plot.buildingStage };
  }

  return { ok: true, stage: bp.stages[nextStageIdx], currentStage: plot.buildingStage };
}

/**
 * Advance building to next stage. Caller must have already verified and burned materials.
 */
export function advanceBuildingStage(
  plotId: string,
  walletAddress: string
): { ok: boolean; error?: string; newStage?: number; complete?: boolean } {
  const plot = getPlotById(plotId);
  if (!plot) return { ok: false, error: "Plot not found." };
  if (!isPlotOwner(plotId, walletAddress)) {
    return { ok: false, error: "You don't own this plot." };
  }
  if (!plot.buildingType) return { ok: false, error: "No building started." };

  const bp = getBlueprint(plot.buildingType);
  if (!bp) return { ok: false, error: "Unknown building type." };

  const nextStage = plot.buildingStage + 1;
  if (nextStage > bp.stages.length) {
    return { ok: false, error: "Building is already complete." };
  }

  setPlotBuilding(plotId, plot.buildingType, nextStage);
  return { ok: true, newStage: nextStage, complete: nextStage >= bp.stages.length };
}

/**
 * Demolish a building on a plot (resets to empty).
 * No material refund.
 */
export function demolishBuilding(
  plotId: string,
  walletAddress: string
): { ok: boolean; error?: string } {
  const plot = getPlotById(plotId);
  if (!plot) return { ok: false, error: "Plot not found." };
  if (!isPlotOwner(plotId, walletAddress)) {
    return { ok: false, error: "You don't own this plot." };
  }
  if (!plot.buildingType) return { ok: false, error: "No building to demolish." };

  setPlotBuilding(plotId, null, 0);
  return { ok: true };
}

export function getBuildingStatus(plotId: string): {
  plotId: string;
  buildingType: string | null;
  buildingName: string | null;
  stage: number;
  maxStages: number;
  stageName: string | null;
  complete: boolean;
} | null {
  const plot = getPlotById(plotId);
  if (!plot) return null;

  const bp = plot.buildingType ? getBlueprint(plot.buildingType) : null;
  const maxStages = bp ? bp.stages.length : 0;
  const stageName = bp && plot.buildingStage > 0 && plot.buildingStage <= maxStages
    ? bp.stages[plot.buildingStage - 1].name
    : null;

  return {
    plotId,
    buildingType: plot.buildingType,
    buildingName: bp?.name ?? null,
    stage: plot.buildingStage,
    maxStages,
    stageName,
    complete: plot.buildingStage >= maxStages && maxStages > 0,
  };
}
