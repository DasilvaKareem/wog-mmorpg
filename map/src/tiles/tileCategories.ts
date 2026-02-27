import { TILE, type TileName } from "./tileTypes";

export interface TileCategory {
  label: string;
  tiles: { name: TileName; idx: number }[];
}

export const TILE_CATEGORIES: TileCategory[] = [
  {
    label: "Ground",
    tiles: [
      { name: "GRASS_PLAIN", idx: TILE.GRASS_PLAIN },
      { name: "GRASS_DARK", idx: TILE.GRASS_DARK },
      { name: "GRASS_LIGHT", idx: TILE.GRASS_LIGHT },
      { name: "GRASS_FLOWERS_RED", idx: TILE.GRASS_FLOWERS_RED },
      { name: "GRASS_FLOWERS_YELLOW", idx: TILE.GRASS_FLOWERS_YELLOW },
      { name: "GRASS_FLOWERS_BLUE", idx: TILE.GRASS_FLOWERS_BLUE },
    ],
  },
  {
    label: "Paths",
    tiles: [
      { name: "DIRT_PLAIN", idx: TILE.DIRT_PLAIN },
      { name: "DIRT_H", idx: TILE.DIRT_H },
      { name: "DIRT_V", idx: TILE.DIRT_V },
      { name: "DIRT_CROSS", idx: TILE.DIRT_CROSS },
      { name: "DIRT_CORNER_NE", idx: TILE.DIRT_CORNER_NE },
      { name: "DIRT_CORNER_NW", idx: TILE.DIRT_CORNER_NW },
      { name: "DIRT_CORNER_SE", idx: TILE.DIRT_CORNER_SE },
      { name: "DIRT_CORNER_SW", idx: TILE.DIRT_CORNER_SW },
      { name: "STONE_FLOOR", idx: TILE.STONE_FLOOR },
      { name: "STONE_DARK", idx: TILE.STONE_DARK },
    ],
  },
  {
    label: "Water",
    tiles: [
      { name: "WATER_STILL", idx: TILE.WATER_STILL },
      { name: "WATER_ANIM1", idx: TILE.WATER_ANIM1 },
      { name: "WATER_ANIM2", idx: TILE.WATER_ANIM2 },
      { name: "WATER_EDGE_N", idx: TILE.WATER_EDGE_N },
      { name: "WATER_EDGE_S", idx: TILE.WATER_EDGE_S },
      { name: "WATER_EDGE_E", idx: TILE.WATER_EDGE_E },
      { name: "WATER_EDGE_W", idx: TILE.WATER_EDGE_W },
      { name: "WATER_CORNER", idx: TILE.WATER_CORNER },
    ],
  },
  {
    label: "Structures",
    tiles: [
      { name: "WALL_WOOD_H", idx: TILE.WALL_WOOD_H },
      { name: "WALL_WOOD_V", idx: TILE.WALL_WOOD_V },
      { name: "WALL_STONE_H", idx: TILE.WALL_STONE_H },
      { name: "WALL_STONE_V", idx: TILE.WALL_STONE_V },
      { name: "DOOR", idx: TILE.DOOR },
      { name: "WINDOW", idx: TILE.WINDOW },
      { name: "ROOF_RED", idx: TILE.ROOF_RED },
      { name: "ROOF_BLUE", idx: TILE.ROOF_BLUE },
      { name: "ROOF_RED_TOP", idx: TILE.ROOF_RED_TOP },
      { name: "ROOF_BLUE_TOP", idx: TILE.ROOF_BLUE_TOP },
      { name: "INTERIOR_FLOOR", idx: TILE.INTERIOR_FLOOR },
      { name: "COUNTER", idx: TILE.COUNTER },
      { name: "CHIMNEY", idx: TILE.CHIMNEY },
      { name: "SIGN_POST", idx: TILE.SIGN_POST },
      { name: "CRATE", idx: TILE.CRATE },
      { name: "BARREL", idx: TILE.BARREL },
    ],
  },
  {
    label: "Nature",
    tiles: [
      { name: "TREE_TRUNK", idx: TILE.TREE_TRUNK },
      { name: "TREE_CANOPY_TL", idx: TILE.TREE_CANOPY_TL },
      { name: "TREE_CANOPY_TR", idx: TILE.TREE_CANOPY_TR },
      { name: "TREE_CANOPY_BL", idx: TILE.TREE_CANOPY_BL },
      { name: "TREE_CANOPY_BR", idx: TILE.TREE_CANOPY_BR },
      { name: "DARK_TREE_TRUNK", idx: TILE.DARK_TREE_TRUNK },
      { name: "DARK_CANOPY_TL", idx: TILE.DARK_CANOPY_TL },
      { name: "DARK_CANOPY_TR", idx: TILE.DARK_CANOPY_TR },
      { name: "DARK_CANOPY_BL", idx: TILE.DARK_CANOPY_BL },
      { name: "DARK_CANOPY_BR", idx: TILE.DARK_CANOPY_BR },
      { name: "ROCK_SMALL", idx: TILE.ROCK_SMALL },
      { name: "ROCK_LARGE", idx: TILE.ROCK_LARGE },
      { name: "BUSH", idx: TILE.BUSH },
      { name: "TALL_GRASS", idx: TILE.TALL_GRASS },
      { name: "STUMP", idx: TILE.STUMP },
      { name: "LOG", idx: TILE.LOG },
    ],
  },
  {
    label: "Special",
    tiles: [
      { name: "PORTAL_BASE", idx: TILE.PORTAL_BASE },
      { name: "PORTAL_GLOW", idx: TILE.PORTAL_GLOW },
      { name: "FENCE_H", idx: TILE.FENCE_H },
      { name: "FENCE_V", idx: TILE.FENCE_V },
      { name: "FENCE_CORNER", idx: TILE.FENCE_CORNER },
      { name: "BRIDGE_H", idx: TILE.BRIDGE_H },
      { name: "BRIDGE_V", idx: TILE.BRIDGE_V },
      { name: "EMPTY", idx: TILE.EMPTY },
    ],
  },
];
