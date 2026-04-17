/**
 * Loads and caches optimized environment GLB models for use by TerrainRenderer.
 * Models are loaded once and cloned per placement via InstancedMesh or clone().
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { getGradientMap } from "./ToonPipeline.js";

const MODEL_BASE = new URL(
  "models/environment/optimized/",
  new URL(import.meta.env.BASE_URL, window.location.href),
).href;

const TOWN_BASE = new URL(
  "models/town/",
  new URL(import.meta.env.BASE_URL, window.location.href),
).href;

/** All environment asset names and their default scale in the world */
const ASSET_DEFS: Record<string, { file: string; scale: number; yOffset: number }> = {
  // Trees — old primitives were ~3.5 units tall, models are ~1 unit, so scale ~6x
  oak_tree:     { file: "oak_tree.glb",     scale: 6.0, yOffset: 0 },
  pine_tree:    { file: "pine_tree.glb",    scale: 7.0, yOffset: 0 },
  dead_tree:    { file: "dead_tree.glb",    scale: 5.0, yOffset: 0 },
  tree_stump:   { file: "tree_stump.glb",   scale: 1.2, yOffset: 0 },
  // Rocks
  boulder:      { file: "boulder.glb",      scale: 2.5, yOffset: 0 },
  rock_cluster: { file: "rock_cluster.glb", scale: 1.5, yOffset: 0 },
  // Vegetation
  bush:         { file: "bush.glb",         scale: 1.4, yOffset: 0 },
  // Structures
  stone_wall:   { file: "stone_wall.glb",   scale: 2.5, yOffset: 0 },
  wooden_fence: { file: "wooden_fence.glb", scale: 2.0, yOffset: 0 },
  portal_frame: { file: "portal_frame.glb", scale: 3.5, yOffset: 0 },
  // Resources
  rare_ore:     { file: "rare_ore.glb",     scale: 1.5, yOffset: 0 },
  flower_patch: { file: "flower_patch.glb", scale: 1.2, yOffset: 0 },
  // Mobs
  shadow_wolf:      { file: "shadow_wolf.glb",      scale: 2.0, yOffset: 0 },
  dark_cultist:     { file: "dark_cultist.glb",      scale: 2.2, yOffset: 0 },
  undead_knight:    { file: "undead_knight.glb",     scale: 2.4, yOffset: 0 },
  forest_troll:     { file: "forest_troll.glb",      scale: 2.8, yOffset: 0 },
  ancient_golem:    { file: "ancient_golem.glb",     scale: 3.0, yOffset: 0 },
  necromancer_boss: { file: "necromancer_boss.glb",  scale: 3.5, yOffset: 0 },
};

/** Kenney Fantasy Town Kit 2.0 — 167 modular building pieces (CC0) */
const TOWN_ASSET_DEFS: Record<string, { file: string; scale: number; yOffset: number }> = {
  // Balconies & banners
  town_balcony_wall_fence: { file: "balcony-wall-fence.glb", scale: 3.0, yOffset: 0 },
  town_balcony_wall: { file: "balcony-wall.glb", scale: 3.0, yOffset: 0 },
  town_banner_green: { file: "banner-green.glb", scale: 3.0, yOffset: 0 },
  town_banner_red: { file: "banner-red.glb", scale: 3.0, yOffset: 0 },
  town_blade: { file: "blade.glb", scale: 3.0, yOffset: 0 },
  // Carts & chimneys
  town_cart_high: { file: "cart-high.glb", scale: 3.0, yOffset: 0 },
  town_cart: { file: "cart.glb", scale: 3.0, yOffset: 0 },
  town_chimney_base: { file: "chimney-base.glb", scale: 3.0, yOffset: 0 },
  town_chimney_top: { file: "chimney-top.glb", scale: 3.0, yOffset: 0 },
  town_chimney: { file: "chimney.glb", scale: 3.0, yOffset: 0 },
  // Fences
  town_fence_broken: { file: "fence-broken.glb", scale: 3.0, yOffset: 0 },
  town_fence_curved: { file: "fence-curved.glb", scale: 3.0, yOffset: 0 },
  town_fence_gate: { file: "fence-gate.glb", scale: 3.0, yOffset: 0 },
  town_fence: { file: "fence.glb", scale: 3.0, yOffset: 0 },
  // Fountains
  town_fountain_center: { file: "fountain-center.glb", scale: 3.0, yOffset: 0 },
  town_fountain_corner_inner_square: { file: "fountain-corner-inner-square.glb", scale: 3.0, yOffset: 0 },
  town_fountain_corner_inner: { file: "fountain-corner-inner.glb", scale: 3.0, yOffset: 0 },
  town_fountain_corner: { file: "fountain-corner.glb", scale: 3.0, yOffset: 0 },
  town_fountain_curved: { file: "fountain-curved.glb", scale: 3.0, yOffset: 0 },
  town_fountain_edge: { file: "fountain-edge.glb", scale: 3.0, yOffset: 0 },
  town_fountain_round_detail: { file: "fountain-round-detail.glb", scale: 3.0, yOffset: 0 },
  town_fountain_round: { file: "fountain-round.glb", scale: 3.0, yOffset: 0 },
  town_fountain_square_detail: { file: "fountain-square-detail.glb", scale: 3.0, yOffset: 0 },
  town_fountain_square: { file: "fountain-square.glb", scale: 3.0, yOffset: 0 },
  // Hedges
  town_hedge_curved: { file: "hedge-curved.glb", scale: 3.0, yOffset: 0 },
  town_hedge_gate: { file: "hedge-gate.glb", scale: 3.0, yOffset: 0 },
  town_hedge_large_curved: { file: "hedge-large-curved.glb", scale: 3.0, yOffset: 0 },
  town_hedge_large_gate: { file: "hedge-large-gate.glb", scale: 3.0, yOffset: 0 },
  town_hedge_large: { file: "hedge-large.glb", scale: 3.0, yOffset: 0 },
  town_hedge: { file: "hedge.glb", scale: 3.0, yOffset: 0 },
  // Decorative
  town_lantern: { file: "lantern.glb", scale: 3.0, yOffset: 0 },
  town_overhang: { file: "overhang.glb", scale: 3.0, yOffset: 0 },
  town_pillar_stone: { file: "pillar-stone.glb", scale: 3.0, yOffset: 0 },
  town_pillar_wood: { file: "pillar-wood.glb", scale: 3.0, yOffset: 0 },
  town_planks_half: { file: "planks-half.glb", scale: 3.0, yOffset: 0 },
  town_planks_opening: { file: "planks-opening.glb", scale: 3.0, yOffset: 0 },
  town_planks: { file: "planks.glb", scale: 3.0, yOffset: 0 },
  town_poles_horizontal: { file: "poles-horizontal.glb", scale: 3.0, yOffset: 0 },
  town_poles: { file: "poles.glb", scale: 3.0, yOffset: 0 },
  // Roads
  town_road_bend: { file: "road-bend.glb", scale: 3.0, yOffset: 0 },
  town_road_corner_inner: { file: "road-corner-inner.glb", scale: 3.0, yOffset: 0 },
  town_road_corner: { file: "road-corner.glb", scale: 3.0, yOffset: 0 },
  town_road_curb_end: { file: "road-curb-end.glb", scale: 3.0, yOffset: 0 },
  town_road_curb: { file: "road-curb.glb", scale: 3.0, yOffset: 0 },
  town_road_edge_slope: { file: "road-edge-slope.glb", scale: 3.0, yOffset: 0 },
  town_road_edge: { file: "road-edge.glb", scale: 3.0, yOffset: 0 },
  town_road_slope: { file: "road-slope.glb", scale: 3.0, yOffset: 0 },
  town_road: { file: "road.glb", scale: 3.0, yOffset: 0 },
  // Rocks
  town_rock_large: { file: "rock-large.glb", scale: 3.0, yOffset: 0 },
  town_rock_small: { file: "rock-small.glb", scale: 3.0, yOffset: 0 },
  town_rock_wide: { file: "rock-wide.glb", scale: 3.0, yOffset: 0 },
  // Roofs — standard
  town_roof_corner_inner: { file: "roof-corner-inner.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_corner_round: { file: "roof-corner-round.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_corner: { file: "roof-corner.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_flat: { file: "roof-flat.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_gable_detail: { file: "roof-gable-detail.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_gable_end: { file: "roof-gable-end.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_gable_top: { file: "roof-gable-top.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_gable: { file: "roof-gable.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_left: { file: "roof-left.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_point: { file: "roof-point.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_right: { file: "roof-right.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_window: { file: "roof-window.glb", scale: 3.0, yOffset: 1.0 },
  town_roof: { file: "roof.glb", scale: 3.0, yOffset: 1.0 },
  // Roofs — high
  town_roof_high_corner_round: { file: "roof-high-corner-round.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_corner: { file: "roof-high-corner.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_cornerinner: { file: "roof-high-cornerinner.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_flat: { file: "roof-high-flat.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_gable_detail: { file: "roof-high-gable-detail.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_gable_end: { file: "roof-high-gable-end.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_gable_top: { file: "roof-high-gable-top.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_gable: { file: "roof-high-gable.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_left: { file: "roof-high-left.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_point: { file: "roof-high-point.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_right: { file: "roof-high-right.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high_window: { file: "roof-high-window.glb", scale: 3.0, yOffset: 1.0 },
  town_roof_high: { file: "roof-high.glb", scale: 3.0, yOffset: 1.0 },
  // Stairs
  town_stairs_full_corner_inner: { file: "stairs-full-corner-inner.glb", scale: 3.0, yOffset: 0 },
  town_stairs_full_corner_outer: { file: "stairs-full-corner-outer.glb", scale: 3.0, yOffset: 0 },
  town_stairs_full: { file: "stairs-full.glb", scale: 3.0, yOffset: 0 },
  town_stairs_stone_corner: { file: "stairs-stone-corner.glb", scale: 3.0, yOffset: 0 },
  town_stairs_stone_handrail: { file: "stairs-stone-handrail.glb", scale: 3.0, yOffset: 0 },
  town_stairs_stone_round: { file: "stairs-stone-round.glb", scale: 3.0, yOffset: 0 },
  town_stairs_stone: { file: "stairs-stone.glb", scale: 3.0, yOffset: 0 },
  town_stairs_wide_stone_handrail: { file: "stairs-wide-stone-handrail.glb", scale: 3.0, yOffset: 0 },
  town_stairs_wide_stone: { file: "stairs-wide-stone.glb", scale: 3.0, yOffset: 0 },
  town_stairs_wide_wood_handrail: { file: "stairs-wide-wood-handrail.glb", scale: 3.0, yOffset: 0 },
  town_stairs_wide_wood: { file: "stairs-wide-wood.glb", scale: 3.0, yOffset: 0 },
  town_stairs_wood_handrail: { file: "stairs-wood-handrail.glb", scale: 3.0, yOffset: 0 },
  town_stairs_wood: { file: "stairs-wood.glb", scale: 3.0, yOffset: 0 },
  // Market stalls
  town_stall_bench: { file: "stall-bench.glb", scale: 3.0, yOffset: 0 },
  town_stall_green: { file: "stall-green.glb", scale: 3.0, yOffset: 0 },
  town_stall_red: { file: "stall-red.glb", scale: 3.0, yOffset: 0 },
  town_stall_stool: { file: "stall-stool.glb", scale: 3.0, yOffset: 0 },
  town_stall: { file: "stall.glb", scale: 3.0, yOffset: 0 },
  // Trees
  town_tree_crooked: { file: "tree-crooked.glb", scale: 3.0, yOffset: 0 },
  town_tree_high_crooked: { file: "tree-high-crooked.glb", scale: 3.0, yOffset: 0 },
  town_tree_high_round: { file: "tree-high-round.glb", scale: 3.0, yOffset: 0 },
  town_tree_high: { file: "tree-high.glb", scale: 3.0, yOffset: 0 },
  town_tree: { file: "tree.glb", scale: 3.0, yOffset: 0 },
  // Stone walls
  town_wall_arch_top_detail: { file: "wall-arch-top-detail.glb", scale: 3.0, yOffset: 0 },
  town_wall_arch_top: { file: "wall-arch-top.glb", scale: 3.0, yOffset: 0 },
  town_wall_arch: { file: "wall-arch.glb", scale: 3.0, yOffset: 0 },
  town_wall_block_half: { file: "wall-block-half.glb", scale: 3.0, yOffset: 0 },
  town_wall_block: { file: "wall-block.glb", scale: 3.0, yOffset: 0 },
  town_wall_broken: { file: "wall-broken.glb", scale: 3.0, yOffset: 0 },
  town_wall_corner_detail: { file: "wall-corner-detail.glb", scale: 3.0, yOffset: 0 },
  town_wall_corner_diagonal_half: { file: "wall-corner-diagonal-half.glb", scale: 3.0, yOffset: 0 },
  town_wall_corner_diagonal: { file: "wall-corner-diagonal.glb", scale: 3.0, yOffset: 0 },
  town_wall_corner_edge: { file: "wall-corner-edge.glb", scale: 3.0, yOffset: 0 },
  town_wall_corner: { file: "wall-corner.glb", scale: 3.0, yOffset: 0 },
  town_wall_curved: { file: "wall-curved.glb", scale: 3.0, yOffset: 0 },
  town_wall_detail_cross: { file: "wall-detail-cross.glb", scale: 3.0, yOffset: 0 },
  town_wall_detail_diagonal: { file: "wall-detail-diagonal.glb", scale: 3.0, yOffset: 0 },
  town_wall_detail_horizontal: { file: "wall-detail-horizontal.glb", scale: 3.0, yOffset: 0 },
  town_wall_diagonal: { file: "wall-diagonal.glb", scale: 3.0, yOffset: 0 },
  town_wall_door: { file: "wall-door.glb", scale: 3.0, yOffset: 0 },
  town_wall_doorway_base: { file: "wall-doorway-base.glb", scale: 3.0, yOffset: 0 },
  town_wall_doorway_round: { file: "wall-doorway-round.glb", scale: 3.0, yOffset: 0 },
  town_wall_doorway_square_wide_curved: { file: "wall-doorway-square-wide-curved.glb", scale: 3.0, yOffset: 0 },
  town_wall_doorway_square_wide: { file: "wall-doorway-square-wide.glb", scale: 3.0, yOffset: 0 },
  town_wall_doorway_square: { file: "wall-doorway-square.glb", scale: 3.0, yOffset: 0 },
  town_wall_half: { file: "wall-half.glb", scale: 3.0, yOffset: 0 },
  town_wall_rounded: { file: "wall-rounded.glb", scale: 3.0, yOffset: 0 },
  town_wall_side: { file: "wall-side.glb", scale: 3.0, yOffset: 0 },
  town_wall_slope: { file: "wall-slope.glb", scale: 3.0, yOffset: 0 },
  town_wall_window_glass: { file: "wall-window-glass.glb", scale: 3.0, yOffset: 0 },
  town_wall_window_round: { file: "wall-window-round.glb", scale: 3.0, yOffset: 0 },
  town_wall_window_shutters: { file: "wall-window-shutters.glb", scale: 3.0, yOffset: 0 },
  town_wall_window_small: { file: "wall-window-small.glb", scale: 3.0, yOffset: 0 },
  town_wall_window_stone: { file: "wall-window-stone.glb", scale: 3.0, yOffset: 0 },
  town_wall: { file: "wall.glb", scale: 3.0, yOffset: 0 },
  // Wood walls
  town_wall_wood_arch_top_detail: { file: "wall-wood-arch-top-detail.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_arch_top: { file: "wall-wood-arch-top.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_arch: { file: "wall-wood-arch.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_block_half: { file: "wall-wood-block-half.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_block: { file: "wall-wood-block.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_broken: { file: "wall-wood-broken.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_corner_diagonal_half: { file: "wall-wood-corner-diagonal-half.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_corner_diagonal: { file: "wall-wood-corner-diagonal.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_corner_edge: { file: "wall-wood-corner-edge.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_corner: { file: "wall-wood-corner.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_curved: { file: "wall-wood-curved.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_detail_cross: { file: "wall-wood-detail-cross.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_detail_diagonal: { file: "wall-wood-detail-diagonal.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_detail_horizontal: { file: "wall-wood-detail-horizontal.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_diagonal: { file: "wall-wood-diagonal.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_door: { file: "wall-wood-door.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_doorway_base: { file: "wall-wood-doorway-base.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_doorway_round: { file: "wall-wood-doorway-round.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_doorway_square_wide_curved: { file: "wall-wood-doorway-square-wide-curved.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_doorway_square_wide: { file: "wall-wood-doorway-square-wide.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_doorway_square: { file: "wall-wood-doorway-square.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_half: { file: "wall-wood-half.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_rounded: { file: "wall-wood-rounded.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_side: { file: "wall-wood-side.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_slope: { file: "wall-wood-slope.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_window_glass: { file: "wall-wood-window-glass.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_window_round: { file: "wall-wood-window-round.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_window_shutters: { file: "wall-wood-window-shutters.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_window_small: { file: "wall-wood-window-small.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood_window_stone: { file: "wall-wood-window-stone.glb", scale: 3.0, yOffset: 0 },
  town_wall_wood: { file: "wall-wood.glb", scale: 3.0, yOffset: 0 },
  // Structures
  town_watermill_wide: { file: "watermill-wide.glb", scale: 3.0, yOffset: 0 },
  town_watermill: { file: "watermill.glb", scale: 3.0, yOffset: 0 },
  town_wheel: { file: "wheel.glb", scale: 3.0, yOffset: 0 },
  town_windmill: { file: "windmill.glb", scale: 3.0, yOffset: 0 },
};

/** Map from overlay tile index → asset name (town assets used when loaded, env fallback) */
const TILE_TO_ASSET: Record<number, string> = {
  // Trees: 40-44 = light canopy (oak/round), 45-49 = dark canopy (pine/crooked)
  40: "town_tree", 41: "town_tree_high_round", 42: "town_tree", 43: "town_tree_high_round", 44: "town_tree",
  45: "town_tree_high", 46: "town_tree_high_crooked", 47: "town_tree_high", 48: "town_tree_crooked", 49: "town_tree_high",
  // Rocks: 50 = small, 51 = large
  50: "town_rock_small", 51: "town_rock_large",
  // Bushes → hedges
  52: "town_hedge", 53: "town_hedge_large",
  // Fences
  58: "town_fence", 59: "town_fence_gate",
  // Portals (keep procedural — no town equivalent)
  56: "portal_frame", 57: "portal_frame",
  // Walls — wood tones (24, 26, 28) and stone tones (25, 27)
  24: "town_wall_wood", 25: "town_wall", 26: "town_wall_wood_detail_horizontal",
  27: "town_wall_corner", 28: "town_wall_wood_door",
  // Roofs — red (30, 32) and blue (31, 33)
  30: "town_roof", 31: "town_roof_high", 32: "town_roof_gable", 33: "town_roof_high_gable",
  // Town decorations
  60: "town_stall", 61: "town_stall_green", 62: "town_stall_red",
  63: "town_fountain_round", 64: "town_lantern", 65: "town_cart",
  66: "town_banner_green", 67: "town_banner_red",
};

/** Fallback: original env assets for tiles, used when town assets aren't loaded */
const TILE_TO_ASSET_FALLBACK: Record<number, string> = {
  40: "oak_tree", 41: "oak_tree", 42: "oak_tree", 43: "oak_tree", 44: "oak_tree",
  45: "pine_tree", 46: "pine_tree", 47: "pine_tree", 48: "pine_tree", 49: "pine_tree",
  50: "rock_cluster", 51: "boulder",
  52: "bush", 53: "bush",
  58: "wooden_fence", 59: "wooden_fence",
  56: "portal_frame", 57: "portal_frame",
  24: "stone_wall", 25: "stone_wall", 26: "stone_wall", 27: "stone_wall", 28: "stone_wall",
  30: "stone_wall", 31: "stone_wall", 32: "stone_wall", 33: "stone_wall",
};

/** Map from mob name substring → asset name */
const MOB_NAME_TO_ASSET: [string, string][] = [
  ["wolf", "shadow_wolf"],
  ["cultist", "dark_cultist"],
  ["undead", "undead_knight"],
  ["skeleton", "undead_knight"],
  ["troll", "forest_troll"],
  ["golem", "ancient_golem"],
  ["necromancer", "necromancer_boss"],
];

export { TILE_TO_ASSET, MOB_NAME_TO_ASSET, TOWN_ASSET_DEFS };

export class EnvironmentAssets {
  private cache = new Map<string, THREE.Object3D>();
  /** Stores the Y offset needed to place each model's bottom on the ground */
  private groundOffsets = new Map<string, number>();
  private loading = new Map<string, Promise<THREE.Object3D>>();
  private loader: GLTFLoader;
  private ready = false;

  constructor() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(dracoLoader);
  }

  /** Preload all environment assets. Call once at startup. */
  async preload(): Promise<void> {
    console.log(`[EnvAssets] Preloading ${Object.keys(ASSET_DEFS).length} models from ${MODEL_BASE}`);
    const promises = Object.entries(ASSET_DEFS).map(([name, def]) =>
      this.loadAsset(name, def.file).catch((err) => {
        console.warn(`[EnvAssets] Failed to load ${name}: ${err}`);
      }),
    );
    await Promise.allSettled(promises);
    this.ready = true;
    console.log(`[EnvAssets] Loaded ${this.cache.size}/${Object.keys(ASSET_DEFS).length} assets`);
  }

  /** Check if assets have been loaded */
  isReady(): boolean {
    return this.ready;
  }

  /** Number of cached models (for debugging) */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get a clone of a named asset, positioned and scaled for the world.
   * Works for both environment and town assets.
   * Returns null if the asset hasn't loaded yet.
   */
  place(assetName: string, x: number, y: number, z: number, extraScale = 1): THREE.Object3D | null {
    const template = this.cache.get(assetName);
    if (!template) return null;

    const def = ASSET_DEFS[assetName] ?? TOWN_ASSET_DEFS[assetName];
    if (!def) return null;

    // Deep clone: create a wrapper group and clone each child mesh individually
    const wrapper = new THREE.Group();
    wrapper.name = `env_${assetName}`;
    template.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const m = new THREE.Mesh(child.geometry, child.material);
        m.position.copy(child.position);
        m.rotation.copy(child.rotation);
        m.scale.copy(child.scale);
        m.castShadow = true;
        m.receiveShadow = true;
        wrapper.add(m);
      }
    });

    const s = def.scale * extraScale;
    wrapper.scale.set(s, s, s);
    // Lift model so its bottom sits on the ground, then apply per-asset yOffset
    // (e.g. roofs stack on top of walls).
    const groundLift = (this.groundOffsets.get(assetName) ?? 0) * s;
    const extraLift = def.yOffset * s;
    wrapper.position.set(x, y + groundLift + extraLift, z);
    // Random rotation for natural clutter (trees, bushes, rocks). Skip structural
    // pieces that must stay grid-aligned to interlock with neighbors.
    const structural =
      assetName.includes("wall") ||
      assetName.includes("fence") ||
      assetName.includes("roof") ||
      assetName.includes("road") ||
      assetName.includes("stairs") ||
      assetName.includes("hedge") ||
      assetName.includes("planks") ||
      assetName.includes("pillar");
    if (!structural) {
      wrapper.rotation.y = Math.random() * Math.PI * 2;
    }
    return wrapper;
  }

  /**
   * Get the asset name for an overlay tile index.
   * Uses town assets when loaded, falls back to original env assets.
   * Returns undefined if the tile doesn't map to a GLB asset.
   */
  getAssetForTile(tileIdx: number): string | undefined {
    const townAsset = TILE_TO_ASSET[tileIdx];
    if (townAsset && this.cache.has(townAsset)) return townAsset;
    // Fall back to original env assets if town not loaded
    return TILE_TO_ASSET_FALLBACK[tileIdx];
  }

  /* ───── Town assets (Kenney Fantasy Town Kit) ───── */

  private townReady = false;

  /** Preload all town building pieces. Call when entering a town zone. */
  async preloadTown(): Promise<void> {
    if (this.townReady) return;
    const keys = Object.keys(TOWN_ASSET_DEFS);
    console.log(`[EnvAssets] Preloading ${keys.length} town models from ${TOWN_BASE}`);
    const promises = keys.map((name) =>
      this.loadAsset(name, TOWN_ASSET_DEFS[name].file, TOWN_BASE).catch((err) => {
        console.warn(`[EnvAssets] Failed to load town/${name}: ${err}`);
      }),
    );
    await Promise.allSettled(promises);
    this.townReady = true;
    console.log(`[EnvAssets] Town loaded — cache now ${this.cache.size} total assets`);
  }

  /** Check if town assets are loaded */
  isTownReady(): boolean {
    return this.townReady;
  }

  /** Place a town asset by name. Same interface as place(). */
  placeTown(assetName: string, x: number, y: number, z: number, rotY = 0, extraScale = 1): THREE.Object3D | null {
    const template = this.cache.get(assetName);
    if (!template) return null;

    const def = TOWN_ASSET_DEFS[assetName];
    if (!def) return null;

    const wrapper = new THREE.Group();
    wrapper.name = `town_${assetName}`;
    template.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const m = new THREE.Mesh(child.geometry, child.material);
        m.position.copy(child.position);
        m.rotation.copy(child.rotation);
        m.scale.copy(child.scale);
        wrapper.add(m);
      }
    });

    const s = def.scale * extraScale;
    wrapper.scale.set(s, s, s);
    const groundLift = (this.groundOffsets.get(assetName) ?? 0) * s;
    const extraLift = def.yOffset * s;
    wrapper.position.set(x, y + groundLift + extraLift, z);
    wrapper.rotation.y = rotY;
    return wrapper;
  }

  /** Get all available town asset names */
  getTownAssetNames(): string[] {
    return Object.keys(TOWN_ASSET_DEFS);
  }

  /** Match a mob entity name to a GLB asset. Returns undefined if no match. */
  getAssetForMob(entityName: string): string | undefined {
    const lower = entityName.toLowerCase();
    for (const [keyword, asset] of MOB_NAME_TO_ASSET) {
      if (lower.includes(keyword)) return asset;
    }
    return undefined;
  }

  private async loadAsset(name: string, file: string, base = MODEL_BASE): Promise<THREE.Object3D> {
    // Dedup concurrent loads
    const existing = this.loading.get(name);
    if (existing) return existing;

    const url = base + file;
    const promise = new Promise<THREE.Object3D>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.name = `env_${name}`;
          // Compute bounding box to find the bottom of the model
          const box = new THREE.Box3().setFromObject(root);
          const bottomY = box.min.y; // negative = model extends below origin
          this.groundOffsets.set(name, -bottomY); // lift by this amount
          // Convert GLB materials to MeshToonMaterial for cel-shading
          const gradMap = getGradientMap();
          let meshCount = 0;
          root.traverse((c) => {
            if (c instanceof THREE.Mesh) {
              meshCount++;
              const mats = Array.isArray(c.material) ? c.material : [c.material];
              const toonMats = mats.map((mat: THREE.Material) => {
                const std = mat as THREE.MeshStandardMaterial;
                return new THREE.MeshToonMaterial({
                  color: std.color ?? 0xffffff,
                  map: std.map ?? undefined,
                  gradientMap: gradMap,
                  transparent: std.transparent,
                  opacity: std.opacity,
                  side: std.side,
                });
              });
              c.material = toonMats.length === 1 ? toonMats[0] : toonMats;
            }
          });
          console.log(`[EnvAssets] ${name}: ${meshCount} meshes (toon), bottomY=${bottomY.toFixed(3)}`);
          this.cache.set(name, root);
          this.loading.delete(name);
          resolve(root);
        },
        undefined,
        (err) => {
          console.error(`[EnvAssets] Load error for ${url}:`, err);
          this.loading.delete(name);
          reject(err);
        },
      );
    });

    this.loading.set(name, promise);
    return promise;
  }
}
