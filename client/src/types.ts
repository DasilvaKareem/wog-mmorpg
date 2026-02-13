export interface Entity {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  createdAt: number;
  shopItems?: number[];
  walletAddress?: string;
  level?: number;
  xp?: number;
  raceId?: string;
  classId?: string;
  essence?: number;
  maxEssence?: number;
  xpReward?: number;
  equipment?: Partial<
    Record<
      "weapon" | "chest" | "legs" | "boots" | "helm" | "shoulders" | "gloves" | "belt",
      { tokenId: number; durability: number; maxDurability: number; broken?: boolean }
    >
  >;
  effectiveStats?: CharacterStats;
}

export interface ZoneResponse {
  zoneId: string;
  tick: number;
  entities: Record<string, Entity>;
}

export interface CharacterStats {
  str: number;
  def: number;
  hp: number;
  agi: number;
  int: number;
  mp: number;
  faith: number;
  luck: number;
}

export interface ClassInfo {
  id: string;
  name: string;
  description: string;
  baseStats: CharacterStats;
}

export interface RaceInfo {
  id: string;
  name: string;
  description: string;
  statModifiers: CharacterStats;
}

export interface CharacterCreateResponse {
  ok: boolean;
  txHash: string;
  character: {
    name: string;
    description: string;
    race: string;
    class: string;
    level: number;
    xp: number;
    stats: CharacterStats;
  };
}

export interface OwnedCharacter {
  tokenId: string;
  name: string;
  description: string;
  properties: {
    race: string;
    class: string;
    level: number;
    xp: number;
    stats: CharacterStats;
  };
}

export interface ZoneListEntry {
  zoneId: string;
  entityCount: number;
  tick: number;
}

export interface TerrainGridData {
  zoneId: string;
  width: number;
  height: number;
  tileSize: number;
  tiles: string[];
}

export interface TerrainGridDataV2 {
  zoneId: string;
  width: number;
  height: number;
  tileSize: number;
  ground: number[];
  overlay: number[];
  biome: string;
}
