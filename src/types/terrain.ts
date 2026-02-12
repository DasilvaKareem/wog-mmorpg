export type TerrainType = "grass" | "dirt" | "forest" | "water" | "rock" | "mud" | "stone";

export interface TerrainProperties {
  walkable: boolean;
  movementCost: number;
  label: string;
}

export const TERRAIN_CATALOG: Record<TerrainType, TerrainProperties> = {
  grass:  { walkable: true,  movementCost: 1.0, label: "Grassland" },
  dirt:   { walkable: true,  movementCost: 0.8, label: "Dirt Road" },
  forest: { walkable: true,  movementCost: 1.5, label: "Dense Forest" },
  water:  { walkable: false, movementCost: 0,   label: "Water" },
  rock:   { walkable: false, movementCost: 0,   label: "Rock" },
  mud:    { walkable: true,  movementCost: 2.0, label: "Mud" },
  stone:  { walkable: true,  movementCost: 0.7, label: "Stone Paving" },
};

export const TILE_SIZE = 10;

export interface TerrainGridData {
  zoneId: string;
  width: number;
  height: number;
  tileSize: number;
  tiles: TerrainType[];
}

export interface TileInfo {
  tx: number;
  tz: number;
  terrain: TerrainType;
  walkable: boolean;
  movementCost: number;
  label: string;
}
