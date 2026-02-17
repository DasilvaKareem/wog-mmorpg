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
  gender?: "male" | "female";
  essence?: number;
  maxEssence?: number;
  xpReward?: number;
  equipment?: Partial<
    Record<
      "weapon" | "chest" | "legs" | "boots" | "helm" | "shoulders" | "gloves" | "belt" | "ring" | "amulet",
      { tokenId: number; durability: number; maxDurability: number; broken?: boolean; quality?: string; rolledStats?: Partial<CharacterStats>; bonusAffix?: string }
    >
  >;
  effectiveStats?: CharacterStats;
  partyId?: string;
  guildName?: string;
  learnedTechniques?: string[];
  activeEffects?: ActiveEffect[];
  kills?: number;
}

export interface ActiveEffect {
  techniqueId: string;
  type: "buff" | "debuff";
  expiresAt: number;
  statBonus?: Partial<Record<string, number>>;
  statReduction?: Partial<Record<string, number>>;
  dotDamage?: number;
  shield?: number;
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
  elevation: number[];
  biome: string;
}

export interface ChunkPayloadV2 {
  cx: number;
  cz: number;
  zoneId: string;
  ground: number[];
  overlay: number[];
  elevation: number[];
  biome: string;
}

export interface ChunkStreamResponse {
  zoneId: string;
  centerWorld: { x: number; z: number };
  chunkRadius: number;
  chunks: ChunkPayloadV2[];
  outOfBounds: { cx: number; cz: number }[];
}

export interface ChunkInfo {
  chunkSize: number;
  tileSize: number;
  chunkWorldSize: number;
}

export interface ZoneChunkInfo {
  zoneId: string;
  chunkSize: number;
  tileSize: number;
  chunksX: number;
  chunksZ: number;
  width: number;
  height: number;
}
