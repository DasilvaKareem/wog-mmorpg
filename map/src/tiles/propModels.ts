/**
 * Catalog of 3D models the map editor can place as free-form props.
 * Names must match keys in client-xr/src/scene/EnvironmentAssets.ts
 * (ASSET_DEFS or TOWN_ASSET_DEFS).
 */

export interface PropModelDef {
  /** Asset key (matches client-xr ASSET_DEFS/TOWN_ASSET_DEFS). */
  id: string;
  /** Display label. */
  label: string;
  /** Category for grouping in the picker. */
  category: "nature" | "structure" | "decor" | "fountain" | "town" | "mob";
  /** Hex color used for the 2D canvas dot. */
  color: string;
}

export const PROP_MODELS: PropModelDef[] = [
  // Nature
  { id: "oak_tree", label: "Oak Tree", category: "nature", color: "#3a7d2e" },
  { id: "pine_tree", label: "Pine Tree", category: "nature", color: "#1f5a2b" },
  { id: "dead_tree", label: "Dead Tree", category: "nature", color: "#6b5a3a" },
  { id: "tree_stump", label: "Tree Stump", category: "nature", color: "#8a6a3a" },
  { id: "boulder", label: "Boulder", category: "nature", color: "#707078" },
  { id: "rock_cluster", label: "Rock Cluster", category: "nature", color: "#8a8a92" },
  { id: "bush", label: "Bush", category: "nature", color: "#4a8a3a" },
  { id: "flower_patch", label: "Flower Patch", category: "nature", color: "#d07aa8" },

  // Structures
  { id: "stone_wall", label: "Stone Wall", category: "structure", color: "#9a9aa0" },
  { id: "wooden_fence", label: "Wooden Fence", category: "structure", color: "#8a6a3a" },
  { id: "portal_frame", label: "Portal Frame", category: "structure", color: "#b050ff" },

  // Town — decorative (sampled from TOWN_ASSET_DEFS)
  { id: "town_fountain_round", label: "Fountain (round)", category: "fountain", color: "#4ab0e0" },
  { id: "town_fountain_square", label: "Fountain (square)", category: "fountain", color: "#4ab0e0" },
  { id: "town_cart", label: "Cart", category: "town", color: "#a07a4a" },
  { id: "town_cart_high", label: "Cart (tall)", category: "town", color: "#a07a4a" },
  { id: "town_lantern", label: "Lantern", category: "decor", color: "#ffd06a" },
  { id: "town_banner_red", label: "Banner (red)", category: "decor", color: "#c03a3a" },
  { id: "town_banner_green", label: "Banner (green)", category: "decor", color: "#3ac03a" },
  { id: "town_chimney", label: "Chimney", category: "town", color: "#6a6a70" },
  { id: "town_fence", label: "Town Fence", category: "structure", color: "#8a6a3a" },
  { id: "town_fence_gate", label: "Fence Gate", category: "structure", color: "#a07a4a" },
  { id: "town_hedge", label: "Hedge", category: "nature", color: "#3a7a3a" },
  { id: "town_hedge_gate", label: "Hedge Gate", category: "nature", color: "#3a7a3a" },

  // Mobs (rare; useful for set-piece placement)
  { id: "shadow_wolf", label: "Shadow Wolf", category: "mob", color: "#2a2a3a" },
  { id: "forest_troll", label: "Forest Troll", category: "mob", color: "#4a5a3a" },
  { id: "ancient_golem", label: "Ancient Golem", category: "mob", color: "#6a6a5a" },
  { id: "necromancer_boss", label: "Necromancer", category: "mob", color: "#7a2a7a" },
];

const _byId = new Map(PROP_MODELS.map((m) => [m.id, m]));

export function getPropModel(id: string): PropModelDef | undefined {
  return _byId.get(id);
}

export function propColor(id: string): string {
  return _byId.get(id)?.color ?? "#e0e0e0";
}
