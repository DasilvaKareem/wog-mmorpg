export interface Entity {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level?: number;
  xp?: number;
  raceId?: string;
  classId?: string;
  gender?: "male" | "female";
  skinColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  walletAddress?: string;
  equipment?: Partial<
    Record<
      string,
      { tokenId: number; name?: string; quality?: string; durability?: number; maxDurability?: number; broken?: boolean }
    >
  >;
  partyId?: string;
  guildName?: string;
  zoneId?: string;
  essence?: number;
  maxEssence?: number;
  activeEffects?: ActiveEffect[];
  // Resource nodes
  oreType?: string;
  flowerType?: string;
  cropType?: string;
  charges?: number;
  maxCharges?: number;
}

export interface GameTime {
  hour: number;
  minute: number;
  day: number;
  phase: "dawn" | "day" | "dusk" | "night";
  progress: number;
}

export interface ActiveEffect {
  id: string;
  name: string;
  type: "buff" | "debuff" | "dot" | "hot" | "shield";
  remainingTicks: number;
  shieldHp?: number;
  maxShieldHp?: number;
}

export interface ZoneEvent {
  id: string;
  type: string;
  tick: number;
  message: string;
  entityId?: string;
  targetId?: string;
  data?: Record<string, unknown>;
}

export interface ZoneResponse {
  zoneId: string;
  tick: number;
  gameTime?: GameTime;
  entities: Record<string, Entity>;
  recentEvents?: ZoneEvent[];
}

/** V2 terrain — full zone in one response */
export interface TerrainData {
  zoneId: string;
  width: number;   // 64
  height: number;   // 64
  tileSize: number; // 10
  biome: string;
  ground: number[];    // width*height
  overlay: number[];   // width*height
  elevation: number[]; // width*height
}

export interface WorldLayoutZone {
  id: string;
  offset: { x: number; z: number };
  size: { width: number; height: number };
  levelReq: number;
}

export interface WorldLayout {
  tileSize: number;
  totalSize: { width: number; height: number };
  zones: Record<string, WorldLayoutZone>;
}

export interface ActivePlayer {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  classId?: string;
  raceId?: string;
  walletAddress?: string | null;
  zoneId: string;
  x: number;
  y: number;
}

export interface ActivePlayersResponse {
  tick: number;
  count: number;
  players: ActivePlayer[];
}

/** Anything that can answer elevation queries in world 3D coords */
export interface ElevationProvider {
  getElevationAt(x: number, z: number): number;
}
