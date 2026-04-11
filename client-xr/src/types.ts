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
      {
        tokenId: number;
        name?: string;
        xrVisualId?: string | null;
        quality?: string;
        durability?: number;
        maxDurability?: number;
        broken?: boolean;
      }
    >
  >;
  partyId?: string;
  guildName?: string;
  zoneId?: string;
  essence?: number;
  maxEssence?: number;
  order?: EntityOrder;
  activeEffects?: ActiveEffect[];
  runEnergy?: number;
  maxRunEnergy?: number;
  runModeEnabled?: boolean;
  isRunning?: boolean;
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
  visibleIntents?: VisibleIntent[];
  recentEvents?: ZoneEvent[];
}

export type EntityOrder =
  | { action: "move"; x: number; y: number }
  | { action: "attack"; targetId: string }
  | { action: "technique"; targetId: string; techniqueId: string; resolving?: boolean };

export type VisibleIntentCategory = "attack" | "heal" | "buff" | "debuff";
export type VisibleIntentDelivery = "melee" | "projectile" | "area" | "channel" | "instant";
export type VisibleIntentSeverity = "normal" | "dangerous";
export type VisibleIntentState = "queued" | "casting";

export interface VisibleIntent {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  targetId: string;
  targetName: string;
  targetType: string;
  category: VisibleIntentCategory;
  delivery: VisibleIntentDelivery;
  severity: VisibleIntentSeverity;
  state: VisibleIntentState;
  techniqueId?: string;
  techniqueName?: string;
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

// ── Character select types ─────────────────────────────────────────

export interface CharacterListEntry {
  tokenId: string;
  characterTokenId?: string | null;
  agentId?: string | null;
  chainRegistrationStatus?: string | null;
  bootstrapStatus?: string | null;
  name: string;
  description: string;
  properties: {
    race?: string;
    class?: string;
    level?: number;
    xp?: number;
    stats?: Record<string, number>;
  };
}

export interface CharacterListResponse {
  walletAddress: string;
  liveEntity: {
    level: number;
    xp: number;
    hp: number;
    maxHp: number;
    zoneId: string;
    name: string;
    agentId: string | null;
    characterTokenId: string | null;
  } | null;
  deployedCharacterName: string | null;
  characters: CharacterListEntry[];
}

export interface ClassDef {
  id: string;
  name: string;
  description: string;
  baseStats: Record<string, number>;
}

export interface RaceDef {
  id: string;
  name: string;
  description: string;
  statModifiers: Record<string, number>;
}

// ── Quest types ────────────────────────────────────────────────────

export interface QuestObjective {
  type: "kill" | "talk" | "gather" | "craft";
  targetMobName?: string;
  targetNpcName?: string;
  targetItemName?: string;
  count: number;
}

export interface QuestRewards {
  copper: number;
  xp: number;
  items?: { tokenId: number; quantity: number }[];
}

export interface ActiveQuest {
  questId: string;
  title: string;
  description: string;
  objective: QuestObjective;
  progress: number;
  required: number;
  complete: boolean;
  rewards: QuestRewards;
  npcEntityId?: string | null;
}

export interface CompletedQuest {
  questId: string;
  title: string;
  description: string;
  rewards: QuestRewards;
}

export interface QuestLogResponse {
  entityId: string;
  playerName: string;
  classId: string;
  zoneId: string;
  storyFlags: string[];
  activeQuests: ActiveQuest[];
  completedQuests: CompletedQuest[];
}

export interface AvailableQuest {
  questId: string;
  title: string;
  description: string;
  npcEntityId: string;
  npcName: string;
  objective: QuestObjective;
  rewards: QuestRewards;
}

export interface ZoneQuestsResponse {
  quests: AvailableQuest[];
}

// ── NPC interaction types ─────────────────────────────────────────

export interface NpcDialogueMessage {
  role: "player" | "npc";
  content: string;
}

export interface NpcDialogueResponse {
  reply: string;
  response?: string;
  npcName?: string;
  emotion?: string;
}

export interface TechniqueInfo {
  id: string;
  name: string;
  description?: string;
  className: string;
  type: string;
  rank?: number;
  levelRequired: number;
  essenceCost: number;
  cooldown: number;
  copperCost: number;
  isLearned: boolean;
}

// ── Crafting / Profession types ───────────────────────────────────

export interface CraftingRecipe {
  recipeId: string;
  name?: string;
  output: { tokenId: string; name: string; quantity: number };
  materials: { tokenId: string; name: string; quantity: number }[];
  copperCost: number;
  requiredProfession?: string;
  requiredSkillLevel: number;
  craftingTime?: number;
  brewingTime?: number;
  cookingTime?: number;
  outputTokenId?: string;
  outputQuantity?: number;
  requiredMaterials?: { tokenId: string; quantity: number; itemName: string }[];
  hpRestoration?: number;
}

export interface GuildSummary {
  guildId: string;
  name: string;
  treasury: number;
  level: number;
  status: string;
  memberCount: number;
}

export interface AuctionListing {
  auctionId: string;
  itemName: string;
  quantity: number;
  startPrice: number;
  highBid: number;
  highBidder?: string;
  timeRemaining: number;
  buyoutPrice?: number;
}

export interface ProfessionEntry {
  professionId: string;
  name: string;
  description: string;
  cost: number;
}

export interface EnchantmentEntry {
  tokenId: string;
  elixirName: string;
  enchantmentName: string;
  description: string;
  statBonus: Record<string, number>;
  specialEffect?: string;
}

export interface ArenaInfo {
  npcId: string;
  formats: string[];
  queueStatus: Record<string, number>;
  activeBattles: number;
}

export interface PvpLeaderboardEntry {
  agentId: string;
  name?: string;
  elo: number;
  wins: number;
  losses: number;
}

export interface ShopItem {
  tokenId: number;
  name: string;
  description: string;
  copperPrice: number;
  currentPrice: number;
  stock: number | null;
  buyPrice: number | null;
  category: string;
  equipSlot: string | null;
  statBonuses: Record<string, number>;
}

export interface ShopResponse {
  npcId: string;
  npcName: string;
  items: ShopItem[];
}
