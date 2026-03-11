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
  calling?: "adventurer" | "farmer" | "merchant" | "craftsman";
  gender?: "male" | "female";
  skinColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  essence?: number;
  maxEssence?: number;
  xpReward?: number;
  equipment?: Partial<
    Record<
      "weapon" | "chest" | "legs" | "boots" | "helm" | "shoulders" | "gloves" | "belt" | "ring" | "amulet",
      { tokenId: number; name?: string; durability: number; maxDurability: number; broken?: boolean; quality?: string; rolledStats?: Partial<CharacterStats>; bonusAffix?: string }
    >
  >;
  effectiveStats?: CharacterStats;
  partyId?: string;
  guildName?: string;
  learnedTechniques?: string[];
  activeEffects?: ActiveEffect[];
  kills?: number;
  zoneId?: string;
  teachesProfession?: string;
  teachesClass?: string;
  activeQuests?: Array<{ questId: string; progress: number; startedAt: number }>;
  completedQuests?: string[];
}

export interface ActiveEffect {
  id: string;
  techniqueId: string;
  name: string;
  type: "buff" | "debuff" | "dot" | "shield" | "hot";
  remainingTicks: number;
  statModifiers?: Partial<Record<string, number>>;
  dotDamage?: number;
  hotHealPerTick?: number;
  shieldHp?: number;
  shieldMaxHp?: number;
}

export interface ZoneEvent {
  id: string;
  zoneId: string;
  type: string;
  timestamp: number;
  tick: number;
  message: string;
  entityId?: string;
  entityName?: string;
  targetId?: string;
  targetName?: string;
  data?: Record<string, unknown>;
}

export interface ZoneResponse {
  zoneId: string;
  tick: number;
  entities: Record<string, Entity>;
  recentEvents?: ZoneEvent[];
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
    equipment?: Record<string, { tokenId: number; durability: number; maxDurability: number; broken?: boolean }>;
    activeQuests?: Array<{ questId: string; progress: string }>;
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
