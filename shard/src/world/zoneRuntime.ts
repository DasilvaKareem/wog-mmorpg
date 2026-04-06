import type { FastifyInstance } from "fastify";
import { arenaManager } from "../combat/arenaManager.js";
import type { CharacterStats } from "../character/classes.js";
import { getClassById } from "../character/classes.js";
import { getItemByTokenId, type ArmorSlot, type EquipmentSlot } from "../items/itemCatalog.js";
import { mintItem, updateCharacterMetadata, burnItem, findIdentityByCharacterTokenId } from "../blockchain/blockchain.js";
import { xpForLevel, MAX_LEVEL, computeStatsAtLevel } from "../character/leveling.js";
import type { OreType } from "../resources/oreCatalog.js";
import { QUEST_CATALOG, doesKillCountForQuest } from "../social/questSystem.js";
import { type ProfessionType, getLearnedProfessions, restoreProfessions } from "../professions/professions.js";
import type { FlowerType } from "../resources/flowerCatalog.js";
import { CROP_CATALOG, GROWTH_MULTIPLIERS, type CropType } from "../farming/cropCatalog.js";
import { logZoneEvent, getRecentZoneEvents } from "./zoneEvents.js";
import { getLootTable, rollDrops } from "../items/lootTables.js";
import { saveCharacter } from "../character/characterStore.js";
import { getTechniquesByClass, getTechniqueById, type TechniqueDefinition } from "../combat/techniques.js";
import { getEdictCache } from "../combat/edictCache.js";
import { evaluateEdicts } from "../combat/edictEvaluator.js";
import { randomInt, randomUUID } from "crypto";
import { getPlayerPartyId, getPartyMembers, areInSameParty, getPartyLeaderId } from "../social/partySystem.js";
import { getCachedGuildName } from "../economy/guildChain.js";
import {
  clampToZoneBounds,
  ZONE_LEVEL_REQUIREMENTS,
  getRegionAtPosition,
  getWorldLayout,
  getZoneOffset,
} from "./worldLayout.js";
import { getActiveXpMultiplier } from "../professions/potionEffects.js";
import { getAttackMultiplier, getDefenseMultiplier } from "../combat/elementSystem.js";
import { logDiary, narrativeDeath, narrativeKill, narrativeLevelUp, narrativeZoneTransition } from "../social/diary.js";
import { getGameTime, checkPhaseTransition, formatGameTime } from "./worldClock.js";
import { recordGoldSpend } from "../blockchain/goldLedger.js";
import { copperToGold, formatCopperString } from "../blockchain/currency.js";
import { transferFromTreasury } from "../blockchain/wallet.js";
import { deleteItemInstance, upsertItemInstanceFromEquipment } from "../items/itemRng.js";
import { getRedis } from "../redis.js";
import { reputationManager } from "../economy/reputationManager.js";

export interface ZoneState {
  zoneId: string;
  entities: Map<string, Entity>;
  tick: number;
}

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

export type Order =
  | { action: "move"; x: number; y: number }
  | { action: "attack"; targetId: string }
  | { action: "technique"; targetId: string; techniqueId: string; resolving?: boolean };

export interface CastingIntent {
  targetId: string;
  techniqueId: string;
  startedAtTick: number;
  resolveAtTick: number;
}

export interface EquippedItemState {
  tokenId: number;
  name?: string;
  durability: number;
  maxDurability: number;
  broken?: boolean;
  enchantments?: Array<{
    type: string;
    name: string;
    statBonus?: {
      str?: number;
      def?: number;
      agi?: number;
      int?: number;
    };
    specialEffect?: string;
    appliedAt: number;
  }>;
  /** RNG crafting fields — populated when equipping with an instanceId */
  instanceId?: string;
  quality?: string;
  rolledStats?: Partial<CharacterStats>;
  bonusAffix?: {
    name: string;
    statBonuses: Partial<CharacterStats>;
    specialEffect?: string;
  };
}

export interface ActiveEffect {
  id: string;
  techniqueId: string;
  name: string;
  type: "buff" | "debuff" | "dot" | "shield" | "hot";
  casterId: string;
  appliedAtTick: number;
  durationTicks: number;
  remainingTicks: number;
  statModifiers?: Partial<Record<string, number>>; // % modifiers for buffs/debuffs
  dotDamage?: number;
  hotHealPerTick?: number;
  shieldHp?: number;
  shieldMaxHp?: number;
}

export interface Entity {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Soft region label — updated automatically based on world position. */
  region?: string;
  essence?: number;
  maxEssence?: number;
  createdAt: number;
  order?: Order;
  walletAddress?: string;
  /** Token IDs this NPC sells — present only on merchant entities. */
  shopItems?: number[];
  /** Current level (1-60), players + mobs. */
  level?: number;
  /** Cumulative XP (players only). */
  xp?: number;
  /** XP granted on death (mobs only). */
  xpReward?: number;
  /** ERC-721 token ID (players only). */
  characterTokenId?: bigint;
  /** ERC-8004 agent identity ID (players/agents only). */
  agentId?: bigint;
  /** Race identifier for stat recalc on level-up. */
  raceId?: string;
  /** Class identifier for stat recalc on level-up. */
  classId?: string;
  /** Character calling — adventurer, farmer, merchant, craftsman (players only). */
  calling?: "adventurer" | "farmer" | "merchant" | "craftsman";
  /** Character origin — sunforged, veilborn, dawnkeeper, ironvow (players only). */
  origin?: string;
  /** Character gender (players only). */
  gender?: "male" | "female";
  /** Character appearance (players only). */
  skinColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  /** Live computed stats (players + mobs/bosses). */
  stats?: CharacterStats;
  /** Equipped item state by slot (players only). */
  equipment?: Partial<Record<EquipmentSlot, EquippedItemState>>;
  /** Base stats + equipment bonuses. */
  effectiveStats?: CharacterStats;
  /** Ore node fields. */
  oreType?: OreType;
  charges?: number;
  maxCharges?: number;
  depletedAtTick?: number;
  respawnTicks?: number;
  /** Flower node fields. */
  flowerType?: FlowerType;
  /** Nectar node fields. */
  nectarType?: string;
  /** Crop node fields. */
  cropType?: CropType;
  /** Accumulated fractional growth toward respawn (time-of-day scaled). */
  growthProgress?: number;
  /** Profession trainer fields. */
  teachesProfession?: ProfessionType;
  /** Class trainer fields. */
  teachesClass?: string;
  /** Active quests (players only). */
  activeQuests?: Array<{ questId: string; progress: number; startedAt: number }>;
  /** Completed quest IDs (players only) - used for quest chain prerequisites. */
  completedQuests?: string[];
  /** Persistent story/dialogue flags (players only). */
  storyFlags?: string[];
  /** Learned techniques (players only). */
  learnedTechniques?: string[]; // Array of technique IDs
  /** Cumulative kill count (players only). */
  kills?: number;
  /** Active effects (buffs, debuffs, DoTs, shields, HoTs). */
  activeEffects?: ActiveEffect[];
  /** Technique cooldowns: techniqueId → tick when cooldown expires. */
  cooldowns?: Map<string, number>;
  /** Corpse fields. */
  mobName?: string; // Original mob name for loot table lookup
  skinned?: boolean; // Whether corpse has been skinned
  skinnableUntil?: number; // Timestamp when corpse decays
  /** Dungeon gate fields. */
  gateRank?: "E" | "D" | "C" | "B" | "A" | "S";
  isDangerGate?: boolean;
  gateExpiresAt?: number;
  gateOpened?: boolean;
  /** Mob tagging: ID of first-hit player (mobs/bosses only). */
  taggedBy?: string;
  /** Mob tagging: tick when tagger last hit this mob. */
  taggedAtTick?: number;
  /** Out-of-combat regen: tick when this entity last dealt/received damage (players only). */
  lastCombatTick?: number;
  /** Travel command: zone the entity is walking toward (for portal-based transitions). */
  travelTargetZone?: string;
  /** Mob spawn origin — used for leash/de-aggro (mobs/bosses only). */
  spawnX?: number;
  spawnY?: number;
  /** True when mob is leashing back to spawn (de-aggro walk home). */
  leashing?: boolean;
  /** True when a player agent is navigating to an NPC — suppresses auto-combat. */
  gotoMode?: boolean;
  /** Quest IDs awaiting summoner approval (players only). */
  pendingQuestApprovals?: string[];
  /** Entity ID of party leader to follow when idle (rented characters). */
  followLeaderId?: string;
  /** In-flight technique windup state for pre-resolution telegraphing. */
  castingIntent?: CastingIntent;
  /** Most recently committed technique for AI variety. */
  lastTechniqueId?: string;
  lastTechniqueTick?: number;
  /** Arena PvP: battle ID this entity is participating in. */
  pvpBattleId?: string;
  /** Arena PvP: team assignment. */
  pvpTeam?: "red" | "blue";
  /** Arena PvP: saved position to teleport back after match. */
  pvpSavedPosition?: { x: number; y: number; region: string };
}

function toSerializableEntity(entity: Entity): Record<string, unknown> {
  const partyId = entity.type === "player" ? getPlayerPartyId(entity.id) : undefined;
  const guildName = entity.type === "player" && entity.walletAddress
    ? getCachedGuildName(entity.walletAddress)
    : undefined;
  return {
    ...entity,
    ...(partyId && { partyId }),
    ...(guildName && { guildName }),
    ...(entity.characterTokenId != null && {
      characterTokenId: entity.characterTokenId.toString(),
    }),
    ...(entity.agentId != null && {
      agentId: entity.agentId.toString(),
    }),
    ...(entity.cooldowns && {
      cooldowns: Object.fromEntries(entity.cooldowns),
    }),
  };
}

// ── Unified World State ────────────────────────────────────────────────
// Single entity map + single tick counter. All entities live here.
// "Regions" are soft labels derived from world position.

interface WorldState {
  entities: Map<string, Entity>;
  tick: number;
}

const world: WorldState = { entities: new Map(), tick: 0 };

// Track known region IDs for getAllZones compat
const knownRegions = new Set<string>();

/**
 * Region-filtered view of world.entities. Implements the Map interface
 * so existing code that does zone.entities.get/set/delete/values works unchanged.
 * Mutations go through to world.entities with region tagging.
 */
class RegionEntityMap implements Map<string, Entity> {
  constructor(private regionId: string) {}

  get(id: string): Entity | undefined {
    const e = world.entities.get(id);
    return e?.region === this.regionId ? e : undefined;
  }

  set(id: string, entity: Entity): this {
    entity.region = this.regionId;
    world.entities.set(id, entity);
    return this;
  }

  has(id: string): boolean {
    const e = world.entities.get(id);
    return e?.region === this.regionId;
  }

  delete(id: string): boolean {
    const e = world.entities.get(id);
    if (e?.region === this.regionId) {
      return world.entities.delete(id);
    }
    return false;
  }

  get size(): number {
    let count = 0;
    for (const e of world.entities.values()) {
      if (e.region === this.regionId) count++;
    }
    return count;
  }

  clear(): void {
    for (const [id, e] of world.entities) {
      if (e.region === this.regionId) world.entities.delete(id);
    }
  }

  forEach(callbackfn: (value: Entity, key: string, map: Map<string, Entity>) => void, thisArg?: any): void {
    for (const [id, e] of world.entities) {
      if (e.region === this.regionId) callbackfn.call(thisArg, e, id, this);
    }
  }

  *entries(): IterableIterator<[string, Entity]> {
    for (const [id, e] of world.entities) {
      if (e.region === this.regionId) yield [id, e];
    }
  }

  *keys(): IterableIterator<string> {
    for (const [id, e] of world.entities) {
      if (e.region === this.regionId) yield id;
    }
  }

  *values(): IterableIterator<Entity> {
    for (const e of world.entities.values()) {
      if (e.region === this.regionId) yield e;
    }
  }

  [Symbol.iterator](): IterableIterator<[string, Entity]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return "RegionEntityMap";
  }
}

// Cache RegionEntityMap instances to avoid creating new objects each call
const regionMapCache = new Map<string, RegionEntityMap>();

function getRegionMap(regionId: string): RegionEntityMap {
  let map = regionMapCache.get(regionId);
  if (!map) {
    map = new RegionEntityMap(regionId);
    regionMapCache.set(regionId, map);
  }
  return map;
}

/**
 * Compat shim: returns a virtual ZoneState that filters world.entities by region.
 * All 43+ consumer files continue to work unchanged.
 */
export function getOrCreateZone(zoneId: string): ZoneState {
  knownRegions.add(zoneId);
  return {
    zoneId,
    entities: getRegionMap(zoneId),
    get tick() { return world.tick; },
  };
}

/**
 * Compat shim: returns a Map of virtual ZoneStates for all known regions.
 */
export function getAllZones(): Map<string, ZoneState> {
  // Include all regions that have entities + any explicitly created
  for (const e of world.entities.values()) {
    if (e.region) knownRegions.add(e.region);
  }
  const result = new Map<string, ZoneState>();
  for (const regionId of knownRegions) {
    result.set(regionId, getOrCreateZone(regionId));
  }
  return result;
}

export function deleteZone(zoneId: string): boolean {
  // Remove all entities in region + forget the region
  for (const [id, e] of world.entities) {
    if (e.region === zoneId) world.entities.delete(id);
  }
  regionMapCache.delete(zoneId);
  return knownRegions.delete(zoneId);
}

// ── New Unified World API ─────────────────────────────────────────────

/** Get a single entity by ID from the unified world. */
export function getEntity(id: string): Entity | undefined {
  return world.entities.get(id);
}

/** Resolve an entity by its UUID or by its agentId field. */
export function resolveEntity(idOrAgentId: string): Entity | undefined {
  const direct = world.entities.get(idOrAgentId);
  if (direct) return direct;
  for (const e of world.entities.values()) {
    if (e.agentId != null && String(e.agentId) === idOrAgentId) return e;
  }
  return undefined;
}

/** Get all entities in the world. */
export function getAllEntities(): Map<string, Entity> {
  return world.entities;
}

/** Get all entities in a specific region. */
export function getEntitiesInRegion(region: string): Entity[] {
  const result: Entity[] = [];
  for (const e of world.entities.values()) {
    if (e.region === region) result.push(e);
  }
  return result;
}

/** Get entities near a world-space position within a radius. */
export function getEntitiesNear(x: number, z: number, radius: number): Entity[] {
  const r2 = radius * radius;
  const result: Entity[] = [];
  for (const e of world.entities.values()) {
    const dx = e.x - x;
    const dy = e.y - z;
    if (dx * dx + dy * dy <= r2) result.push(e);
  }
  return result;
}

/** Get the unified world tick. */
export function getWorldTick(): number {
  return world.tick;
}

// ── Wallet Spawn Registry ─────────────────────────────────────────────────
// Enforces: one player entity per wallet address across the entire shard.
// Checked at spawn time, updated on zone transitions and entity removal.

interface SpawnedEntry { entityId: string; zoneId: string }
const spawnedWallets = new Map<string, SpawnedEntry>();

/** Check if a wallet already has a live player entity anywhere on the shard. */
export function isWalletSpawned(wallet: string): SpawnedEntry | null {
  return spawnedWallets.get(wallet.toLowerCase()) ?? null;
}

/** Register a wallet as having a live player entity. */
export function registerSpawnedWallet(wallet: string, entityId: string, zoneId: string): void {
  spawnedWallets.set(wallet.toLowerCase(), { entityId, zoneId });
}

/** Update the zone for a wallet's spawned entity (called on zone transition). */
export function updateSpawnedWalletZone(wallet: string, newZoneId: string): void {
  const entry = spawnedWallets.get(wallet.toLowerCase());
  if (entry) entry.zoneId = newZoneId;
}

/** Unregister a wallet when its entity is removed (logout, death-despawn, etc). */
export function unregisterSpawnedWallet(wallet: string): void {
  spawnedWallets.delete(wallet.toLowerCase());
}

/** Get all spawned wallet entries (for debugging/admin). */
export function getSpawnedWallets(): Map<string, SpawnedEntry> {
  return spawnedWallets;
}

// Tick loop — advances the world every interval
let tickInterval: ReturnType<typeof setInterval> | null = null;
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 1000; // 1 tick per second
const PLAYER_PERSIST_INTERVAL_MS = Math.max(1000, Number(process.env.PLAYER_PERSIST_INTERVAL_MS) || 5000);
const MOVE_SPEED = 30; // units per tick
const MELEE_RANGE = 40; // units — fallback for melee / mobs
const MIN_DAMAGE = 3;
const FALLBACK_ATTACK = 15;
const PARTY_TARGET_LOCK_TICKS = 6;
const PARTY_ANCHOR_PULL_RADIUS = 100;

interface PartyTargetLock {
  targetId: string;
  zoneId: string;
  expiresAtTick: number;
}

const partyTargetLocks = new Map<string, PartyTargetLock>();
const LIVE_PLAYER_IDS_KEY = "world:live-players";
const LIVE_PLAYER_KEY_PREFIX = "world:live-player:";

interface PersistedLivePlayer {
  entity: Record<string, unknown>;
  professions: string[];
  savedAt: number;
}

function livePlayerKey(walletAddress: string): string {
  return `${LIVE_PLAYER_KEY_PREFIX}${walletAddress.toLowerCase()}`;
}

function serializeLivePlayerEntity(entity: Entity): Record<string, unknown> {
  return {
    ...entity,
    ...(entity.characterTokenId != null && { characterTokenId: entity.characterTokenId.toString() }),
    ...(entity.agentId != null && { agentId: entity.agentId.toString() }),
    ...(entity.cooldowns instanceof Map && { cooldowns: Object.fromEntries(entity.cooldowns) }),
  };
}

function hydrateLivePlayerEntity(raw: Record<string, unknown>): Entity {
  const entity = { ...raw } as unknown as Entity & { cooldowns?: Record<string, number> | Map<string, number> };
  if (typeof raw.characterTokenId === "string" && /^\d+$/.test(raw.characterTokenId)) {
    entity.characterTokenId = BigInt(raw.characterTokenId);
  }
  if (typeof raw.agentId === "string" && /^\d+$/.test(raw.agentId)) {
    entity.agentId = BigInt(raw.agentId);
  }
  if (raw.cooldowns && !(raw.cooldowns instanceof Map)) {
    entity.cooldowns = new Map(
      Object.entries(raw.cooldowns as Record<string, number>).map(([techniqueId, expiresAt]) => [
        techniqueId,
        Number(expiresAt) || 0,
      ])
    );
  }
  return entity;
}

async function persistLivePlayerEntity(entity: Entity): Promise<void> {
  if (entity.type !== "player" || !entity.walletAddress) return;
  const redis = getRedis();
  if (!redis) return;

  const payload: PersistedLivePlayer = {
    entity: serializeLivePlayerEntity(entity),
    professions: getLearnedProfessions(entity.walletAddress),
    savedAt: Date.now(),
  };

  const tx = redis.multi();
  tx.sadd(LIVE_PLAYER_IDS_KEY, entity.walletAddress.toLowerCase());
  tx.set(livePlayerKey(entity.walletAddress), JSON.stringify(payload));
  await tx.exec();
}

async function removeLivePlayerEntity(walletAddress: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const tx = redis.multi();
  tx.srem(LIVE_PLAYER_IDS_KEY, walletAddress.toLowerCase());
  tx.del(livePlayerKey(walletAddress));
  await tx.exec();
}

export async function restoreLivePlayersFromRedis(): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  const wallets: string[] = await redis.smembers(LIVE_PLAYER_IDS_KEY);
  if (!Array.isArray(wallets) || wallets.length === 0) return 0;

  let restored = 0;
  for (const wallet of wallets) {
    const raw = await redis.get(livePlayerKey(wallet));
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as PersistedLivePlayer;
      const entity = hydrateLivePlayerEntity(parsed.entity);
      if (entity.type !== "player" || !entity.walletAddress) continue;
      if (isWalletSpawned(entity.walletAddress) || world.entities.has(entity.id)) continue;

      if (entity.stats) {
        recalculateEntityVitals(entity);
      } else if (entity.raceId && entity.classId) {
        entity.stats = computeStatsAtLevel(entity.raceId, entity.classId, entity.level ?? 1);
        recalculateEntityVitals(entity);
      }

      // Always clear stale PvP state on restore — matches don't survive restarts
      if (entity.region === "coliseum-arena") {
        const saved = entity.pvpSavedPosition;
        entity.region = saved?.region ?? "village-square";
        if (saved) { entity.x = saved.x; entity.y = saved.y; }
      }
      entity.pvpBattleId = undefined;
      entity.pvpTeam = undefined;
      entity.pvpSavedPosition = undefined;
      const zoneId = entity.region ?? "village-square";
      getOrCreateZone(zoneId).entities.set(entity.id, entity);
      registerSpawnedWallet(entity.walletAddress, entity.id, zoneId);
      if (parsed.professions.length > 0) {
        restoreProfessions(entity.walletAddress, parsed.professions);
      }
      if (entity.agentId != null) {
        reputationManager.ensureInitialized(entity.agentId);
      } else if (entity.characterTokenId != null) {
        // Async identity recovery from chain
        findIdentityByCharacterTokenId(entity.characterTokenId, entity.walletAddress)
          .then(async (found) => {
            if (!found?.agentId) return;
            entity.agentId = found.agentId;
            reputationManager.ensureInitialized(found.agentId);
            if (entity.walletAddress) {
              await saveCharacter(entity.walletAddress, entity.name, {
                agentId: found.agentId.toString(),
                chainRegistrationStatus: "registered",
              });
            }
            console.log(`[live-player] Recovered agentId=${found.agentId} for "${entity.name}" from chain`);
          })
          .catch(() => {});
      }
      restored++;
    } catch (err) {
      console.warn("[live-player] Failed to restore player from Redis:", err);
    }
  }

  if (restored > 0) {
    console.log(`[live-player] Restored ${restored} active player session(s) from Redis`);
  }

  return restored;
}

export function persistLivePlayerEntityEventually(entity: Entity, context: string): void {
  void persistLivePlayerEntity(entity).catch((err) => {
    console.warn(`[live-player] Failed to persist ${entity.name} after ${context}:`, err);
  });
}

export function removeLivePlayerEntityEventually(walletAddress: string, context: string): void {
  void removeLivePlayerEntity(walletAddress).catch((err) => {
    console.warn(`[live-player] Failed to remove ${walletAddress} after ${context}:`, err);
  });
}

/** Return the attack range for an entity based on its class definition. */
function getEntityAttackRange(entity: Entity): number {
  if (entity.classId) {
    const classDef = getClassById(entity.classId);
    if (classDef) return classDef.attackRange;
  }
  return MELEE_RANGE;
}

const RANGED_CLASSES = new Set(["mage", "warlock", "ranger", "cleric"]);

/** Return the animStyle for a basic auto-attack: "projectile" for ranged, "melee" for melee. */
function getBasicAttackAnimStyle(entity: Entity): "melee" | "projectile" {
  return RANGED_CLASSES.has(entity.classId ?? "") ? "projectile" : "melee";
}

function getVisibleIntentCategory(order: Order, technique?: TechniqueDefinition): VisibleIntentCategory {
  if (order.action === "attack") return "attack";

  switch (technique?.type) {
    case "healing":
      return "heal";
    case "buff":
      return "buff";
    case "debuff":
      return "debuff";
    default:
      return "attack";
  }
}

function getVisibleIntentDelivery(order: Order, source: Entity, technique?: TechniqueDefinition): VisibleIntentDelivery {
  if (order.action === "attack") {
    return getBasicAttackAnimStyle(source);
  }

  return technique?.animStyle ?? "instant";
}

function getVisibleIntentSeverity(
  source: Entity,
  category: VisibleIntentCategory,
  delivery: VisibleIntentDelivery,
): VisibleIntentSeverity {
  if (source.type === "boss") return "dangerous";
  if (category === "attack" && (delivery === "area" || delivery === "channel")) return "dangerous";
  if (category === "debuff" && delivery !== "instant") return "dangerous";
  return "normal";
}

function getTechniqueWindupTicks(technique: TechniqueDefinition): number {
  if (technique.animStyle === "projectile" || technique.animStyle === "area" || technique.animStyle === "channel") {
    return 1;
  }
  return 0;
}

function buildVisibleIntents(zone: ZoneState): VisibleIntent[] {
  const intents: VisibleIntent[] = [];

  for (const entity of zone.entities.values()) {
    if (entity.castingIntent) {
      const technique = getTechniqueById(entity.castingIntent.techniqueId);
      const target = getEntity(entity.castingIntent.targetId);
      if (technique && target && target.hp > 0) {
        const castingOrder: Order = {
          action: "technique",
          targetId: target.id,
          techniqueId: technique.id,
        };
        const category = getVisibleIntentCategory(castingOrder, technique);
        const delivery = getVisibleIntentDelivery(castingOrder, entity, technique);
        const severity = getVisibleIntentSeverity(entity, category, delivery);

        intents.push({
          id: `intent:${zone.zoneId}:${entity.id}:casting:${technique.id}`,
          sourceId: entity.id,
          sourceName: entity.name,
          sourceType: entity.type,
          targetId: target.id,
          targetName: target.name,
          targetType: target.type,
          category,
          delivery,
          severity,
          state: "casting",
          techniqueId: technique.id,
          techniqueName: technique.name,
        });
      }
      continue;
    }

    const order = entity.order;
    if (!order || order.action === "move") continue;

    const target = getEntity(order.targetId);
    if (!target || target.hp <= 0) continue;

    const technique = order.action === "technique"
      ? getTechniqueById(order.techniqueId)
      : undefined;
    const category = getVisibleIntentCategory(order, technique);
    const delivery = getVisibleIntentDelivery(order, entity, technique);
    const severity = getVisibleIntentSeverity(entity, category, delivery);

    intents.push({
      id: `intent:${zone.zoneId}:${entity.id}:${order.action}:${order.action === "technique" ? order.techniqueId : target.id}`,
      sourceId: entity.id,
      sourceName: entity.name,
      sourceType: entity.type,
      targetId: target.id,
      targetName: target.name,
      targetType: target.type,
      category,
      delivery,
      severity,
      state: "queued",
      ...(order.action === "technique" && { techniqueId: order.techniqueId }),
      ...(technique?.name && { techniqueName: technique.name }),
    });
  }

  return intents;
}

// ── Stat-based combat mechanics (players only) ────────────────────────
const DODGE_CAP = 0.40;
const DODGE_K = 200;
const DODGE_SCALE = 0.55;

const CRIT_CAP = 0.50;
const CRIT_K = 250;
const CRIT_SCALE = 0.60;
const CRIT_MULTIPLIER = 1.75;

const BLOCK_CAP = 0.50;
const BLOCK_K = 200;
const BLOCK_SCALE = 0.60;
const BLOCK_REDUCTION = 0.50;

const FAITH_HEAL_K = 300;
const FAITH_HEAL_SCALE = 0.60;
const FAITH_HOLY_COEFF = 0.15;
const ARMOR_SLOTS: ArmorSlot[] = [
  "chest",
  "legs",
  "boots",
  "helm",
  "shoulders",
  "gloves",
  "belt",
  "shield",
  "cape",
  "ring",
  "amulet",
];

// Graveyard spawn locations per zone
const GRAVEYARD_SPAWNS: Record<string, { x: number; y: number }> = {
  "village-square": { x: 150, y: 150 },
  "wild-meadow": { x: 50, y: 50 },
  "dark-forest": { x: 50, y: 50 },
  "auroral-plains": { x: 100, y: 500 },
  "emerald-woods": { x: 300, y: 300 },
  "viridian-range": { x: 150, y: 400 },
  "moondancer-glade": { x: 150, y: 200 },
  "felsrock-citadel": { x: 300, y: 350 },
  "lake-lumina": { x: 300, y: 300 },
  "azurshard-chasm": { x: 100, y: 320 },
};

const DEATH_XP_LOSS_PERCENT = 0.1; // Lose 10% of current XP on death
const TAG_TIMEOUT_TICKS = 60;      // 60 ticks = 60s before mob tag expires
const OOC_REGEN_DELAY_TICKS = 10;  // 10 ticks = 10s out of combat before regen starts
const OOC_REGEN_PERCENT = 0.03;    // 3% of maxHp per tick while out of combat (mobs)
// Player HP regen: base 0.5% maxHp/tick OOC + faith * 0.003% per tick
const PLAYER_HP_REGEN_BASE = 0.005;
const PLAYER_HP_REGEN_FAITH_COEFF = 0.003;
// Essence regen: base 2%/tick + int * 0.02% per tick (casters regen ~50% faster)
const ESSENCE_REGEN_BASE = 0.02;
const ESSENCE_REGEN_INT_COEFF = 0.0002;

function emptyStats(): CharacterStats {
  return {
    str: 0,
    def: 0,
    hp: 0,
    agi: 0,
    int: 0,
    mp: 0,
    faith: 0,
    luck: 0,
    essence: 0,
  };
}

function addStats(base: CharacterStats, bonus: Partial<CharacterStats>): CharacterStats {
  return {
    str: base.str + (bonus.str ?? 0),
    def: base.def + (bonus.def ?? 0),
    hp: base.hp + (bonus.hp ?? 0),
    agi: base.agi + (bonus.agi ?? 0),
    int: base.int + (bonus.int ?? 0),
    mp: base.mp + (bonus.mp ?? 0),
    faith: base.faith + (bonus.faith ?? 0),
    luck: base.luck + (bonus.luck ?? 0),
    essence: base.essence + (bonus.essence ?? 0),
  };
}

function getEquipmentBonuses(entity: Entity): CharacterStats {
  const total = emptyStats();
  if (!entity.equipment) return total;

  for (const equipped of Object.values(entity.equipment)) {
    if (!equipped || equipped.broken || equipped.durability <= 0) continue;

    // Use rolled stats if present (RNG crafted item), otherwise fall back to catalog
    const stats = equipped.rolledStats ?? getItemByTokenId(BigInt(equipped.tokenId))?.statBonuses;
    if (stats) {
      total.str += stats.str ?? 0;
      total.def += stats.def ?? 0;
      total.hp += stats.hp ?? 0;
      total.agi += stats.agi ?? 0;
      total.int += stats.int ?? 0;
      total.mp += stats.mp ?? 0;
      total.faith += stats.faith ?? 0;
      total.luck += stats.luck ?? 0;
    }

    // Add bonus affix stats on top
    if (equipped.bonusAffix?.statBonuses) {
      const affix = equipped.bonusAffix.statBonuses;
      total.str += affix.str ?? 0;
      total.def += affix.def ?? 0;
      total.hp += affix.hp ?? 0;
      total.agi += affix.agi ?? 0;
      total.int += affix.int ?? 0;
      total.mp += affix.mp ?? 0;
      total.faith += affix.faith ?? 0;
      total.luck += affix.luck ?? 0;
    }

    if (equipped.enchantments) {
      for (const enchantment of equipped.enchantments) {
        const bonus = enchantment.statBonus;
        if (!bonus) continue;
        total.str += bonus.str ?? 0;
        total.def += bonus.def ?? 0;
        total.agi += bonus.agi ?? 0;
        total.int += bonus.int ?? 0;
      }
    }
  }

  return total;
}

function applyActiveEffectModifiers(base: CharacterStats, effects: ActiveEffect[]): CharacterStats {
  const result = { ...base };
  for (const effect of effects) {
    if ((effect.type !== "buff" && effect.type !== "debuff") || !effect.statModifiers) continue;
    for (const [stat, pct] of Object.entries(effect.statModifiers)) {
      if (pct == null || !(stat in result)) continue;
      const key = stat as keyof CharacterStats;
      if (effect.type === "buff") {
        result[key] = Math.round(result[key] + base[key] * (pct / 100));
      } else {
        result[key] = Math.max(0, Math.round(result[key] - base[key] * (pct / 100)));
      }
    }
  }
  return result;
}

export function getEffectiveStats(entity: Entity): CharacterStats | undefined {
  if (!entity.stats) return undefined;
  const baseWithGear = addStats(entity.stats, getEquipmentBonuses(entity));
  if (entity.activeEffects && entity.activeEffects.length > 0) {
    return applyActiveEffectModifiers(baseWithGear, entity.activeEffects);
  }
  return baseWithGear;
}

export function recalculateEntityVitals(entity: Entity): void {
  const effective = getEffectiveStats(entity);
  entity.effectiveStats = effective;
  if (!effective) return;

  // Don't resurrect dead entities — only recalc if alive
  if (entity.hp <= 0) return;

  const previousMaxHp = entity.maxHp > 0 ? entity.maxHp : effective.hp;
  const ratio = previousMaxHp > 0 ? entity.hp / previousMaxHp : 1;

  entity.maxHp = Math.max(1, effective.hp);
  entity.hp = Math.max(1, Math.min(entity.maxHp, Math.round(entity.maxHp * ratio)));
}

/**
 * Handle level-up side-effects for a single entity: stats recalc, zone event,
 * diary entry, Redis persistence, and on-chain NFT metadata update.
 */
function handleLevelUp(entity: Entity, zone: ZoneState): void {
  if (!entity.raceId || !entity.classId) return;

  const newStats = computeStatsAtLevel(entity.raceId, entity.classId, entity.level!);
  entity.stats = newStats;
  recalculateEntityVitals(entity);

  logZoneEvent({
    zoneId: zone.zoneId,
    type: "levelup",
    tick: zone.tick,
    message: `*** ${entity.name} reached level ${entity.level}! ***`,
    entityId: entity.id,
    entityName: entity.name,
    data: { level: entity.level, xp: entity.xp },
  });

  if (entity.walletAddress) {
    const { headline, narrative } = narrativeLevelUp(entity.name, entity.raceId, entity.classId, zone.zoneId, entity.level!);
    logDiary(entity.walletAddress, entity.name, zone.zoneId, entity.x, entity.y, "level_up", headline, narrative, {
      newLevel: entity.level,
      xp: entity.xp,
    });
  }

  if (entity.walletAddress && entity.name) {
    saveCharacter(entity.walletAddress, entity.name, {
      level: entity.level,
      xp: entity.xp,
      zone: zone.zoneId,
      x: entity.x,
      y: entity.y,
      kills: entity.kills,
    }).catch((err) => console.error(`[persistence] Save failed for ${entity.id}:`, err));
  }

  if (entity.characterTokenId != null) {
    updateCharacterMetadata(entity as Required<Pick<Entity, 'characterTokenId' | 'name' | 'raceId' | 'classId' | 'level' | 'xp' | 'stats'>>)
      .catch((err) => console.error(`NFT update failed for ${entity.id}:`, err));
  }
}

// ── Anti-farm: diminishing XP for repeat kills in same zone ────────────
// Tracks recent kill counts per player per zone. Decays over time.
const recentKillCounts = new Map<string, { count: number; lastKillTick: number }>();
const REPEAT_KILL_WINDOW = 120;   // ticks (2 min) before kill counter resets
const REPEAT_KILL_THRESHOLD = 8;  // kills before penalty kicks in
const REPEAT_KILL_FLOOR = 0.15;   // minimum XP multiplier (15%)
const REPEAT_KILL_DECAY = 0.12;   // XP drops 12% per kill past threshold

function getRepeatKillKey(playerId: string, zoneId: string): string {
  return `${playerId}:${zoneId}`;
}

function trackRepeatKill(playerId: string, zoneId: string, tick: number): number {
  const key = getRepeatKillKey(playerId, zoneId);
  const entry = recentKillCounts.get(key);

  if (!entry || tick - entry.lastKillTick > REPEAT_KILL_WINDOW) {
    recentKillCounts.set(key, { count: 1, lastKillTick: tick });
    return 1.0;
  }

  entry.count++;
  // NOTE: do NOT update lastKillTick here — the window starts on the first
  // kill and expires after REPEAT_KILL_WINDOW ticks regardless of subsequent
  // kills. Otherwise rapid continuous killing never lets the window reset.

  if (entry.count <= REPEAT_KILL_THRESHOLD) return 1.0;

  const overCount = entry.count - REPEAT_KILL_THRESHOLD;
  return Math.max(REPEAT_KILL_FLOOR, 1.0 - overCount * REPEAT_KILL_DECAY);
}

// ── Level-gap XP scaling ──────────────────────────────────────────────
// Mobs 6+ levels below you give reduced XP. 10+ below = zero.
function getLevelGapMultiplier(playerLevel: number, mobLevel: number): number {
  const gap = playerLevel - mobLevel;
  if (gap <= 5) return 1.0;       // on-level or higher mobs: full XP
  if (gap >= 10) return 0.0;      // 10+ levels below: no XP (gray mob)
  // 6-9 levels below: linear falloff (80% → 20%)
  return Math.max(0, 1.0 - (gap - 5) * 0.2);
}

const MOB_GOLD_DISABLE_LEVEL_GAP = 15;

function rollMobCopperReward(mob: Entity): number {
  const level = Math.max(1, mob.level ?? 1);

  if (mob.type === "boss") {
    const minCopper = Math.max(12, Math.floor(level * 3));
    const maxCopper = Math.max(minCopper, Math.floor(level * 4.5));
    return randomInt(minCopper, maxCopper + 1);
  }

  const minCopper = Math.max(1, Math.floor(level * 1.2));
  const maxCopper = Math.max(minCopper, Math.floor(level * 2));
  return randomInt(minCopper, maxCopper + 1);
}

function shouldSuppressMobGold(killer: Entity, mob: Entity): boolean {
  if (killer.type !== "player") return true;
  if (!killer.walletAddress) return true;
  if (killer.level == null || mob.level == null) return false;
  return killer.level - mob.level >= MOB_GOLD_DISABLE_LEVEL_GAP;
}

/**
 * Award XP to the tagger's party (or solo). All same-zone, alive party members
 * share XP with a party-size bonus: 1.0 + (memberCount - 1) * 0.1.
 * Each member's own potion multiplier is applied individually.
 * Level-gap and repeat-kill penalties are applied per member.
 */
function awardPartyXp(zone: ZoneState, xpRecipient: Entity, baseXpReward: number, mobLevel?: number): void {
  if (baseXpReward <= 0 || xpRecipient.level == null) {
    console.warn(`[xp-debug] SKIPPED XP: recipient=${xpRecipient.name} baseXp=${baseXpReward} level=${xpRecipient.level} levelIsNull=${xpRecipient.level == null}`);
    return;
  }

  const partyMemberIds = getPartyMembers(xpRecipient.id);

  // Filter to alive, player-type members in the SAME ZONE as the kill
  const eligibleMembers: Entity[] = [];
  for (const memberId of partyMemberIds) {
    const member = world.entities.get(memberId);
    if (!member) {
      console.warn(`[xp-debug] MEMBER NOT FOUND: memberId=${memberId}`);
      continue;
    }
    if (member.type !== "player" || member.hp <= 0 || member.level == null) {
      console.warn(`[xp-debug] FILTERED OUT: ${member.name} type=${member.type} hp=${member.hp} level=${member.level}`);
      continue;
    }
    // Must be in the same zone as the kill — no free XP from another zone
    if (member.region !== zone.zoneId) {
      console.log(`[xp-debug] WRONG ZONE: ${member.name} in ${member.region} (kill in ${zone.zoneId}) — no XP`);
      continue;
    }
    eligibleMembers.push(member);
  }

  // Fallback: if somehow no eligible members, give to tagger directly
  if (eligibleMembers.length === 0) {
    console.warn(`[xp-debug] NO ELIGIBLE MEMBERS — using fallback to xpRecipient: ${xpRecipient.name} level=${xpRecipient.level}`);
    eligibleMembers.push(xpRecipient);
  }

  const memberCount = eligibleMembers.length;
  const partyBonus = 1.0 + (memberCount - 1) * 0.1;
  const totalXp = Math.floor(baseXpReward * partyBonus);
  const perMemberXp = Math.floor(totalXp / memberCount);

  for (const member of eligibleMembers) {
    // Ensure level and xp are proper numbers (NaN check: typeof NaN === "number")
    if (typeof member.level !== "number" || Number.isNaN(member.level)) member.level = Number(member.level) || 1;
    if (typeof member.xp !== "number" || Number.isNaN(member.xp)) member.xp = Number(member.xp) || 0;

    // Level-gap penalty: mobs way below your level give less XP
    const levelGap = mobLevel != null ? getLevelGapMultiplier(member.level, mobLevel) : 1.0;
    if (levelGap <= 0) {
      console.log(`[xp-debug] GRAY MOB: ${member.name} (L${member.level}) vs mob L${mobLevel} — 0 XP`);
      continue;
    }

    // Repeat-kill penalty: farming same zone too fast
    const repeatMult = trackRepeatKill(member.id, zone.zoneId, zone.tick);

    // Apply all multipliers: potion buff × level gap × repeat penalty
    const xpMult = getActiveXpMultiplier(member.activeEffects);
    const finalXp = Math.round(perMemberXp * xpMult * levelGap * repeatMult);
    if (finalXp <= 0) continue;

    member.xp = member.xp + finalXp;
    const penalties = [];
    if (levelGap < 1) penalties.push(`level-gap:${(levelGap * 100).toFixed(0)}%`);
    if (repeatMult < 1) penalties.push(`repeat:${(repeatMult * 100).toFixed(0)}%`);
    const penaltyStr = penalties.length > 0 ? ` [${penalties.join(", ")}]` : "";
    console.log(`[xp-debug] AWARDED: ${member.name} +${finalXp} XP → total ${member.xp} (L${member.level}, need ${xpForLevel(member.level + 1)} for next)${penaltyStr}`);

    // Check for level-up(s)
    let leveled = false;
    while (member.level < MAX_LEVEL && member.xp >= xpForLevel(member.level + 1)) {
      member.level++;
      leveled = true;
      console.log(`[xp-debug] LEVEL UP! ${member.name} → L${member.level} (xp=${member.xp})`);
    }

    if (leveled) {
      handleLevelUp(member, zone);
    }
  }

  // Log party XP sharing if more than one member
  if (memberCount > 1) {
    const names = eligibleMembers.map(m => m.name).join(", ");
    logZoneEvent({
      zoneId: zone.zoneId,
      type: "combat",
      tick: zone.tick,
      message: `Party XP: ${totalXp} XP (${partyBonus.toFixed(1)}x bonus) split among ${memberCount} members: ${names}`,
      entityId: xpRecipient.id,
      entityName: xpRecipient.name,
      data: { totalXp, perMemberXp, memberCount, partyBonus },
    });
  }
}

function getAttackPower(entity: Entity): number {
  const stats = entity.effectiveStats ?? getEffectiveStats(entity);
  if (stats) {
    // Spellcasters (mage, warlock, cleric) scale primarily off INT;
    // physical classes scale off STR. Both benefit from secondary stats.
    const classId = entity.classId ?? "";
    const isCaster = ["mage", "warlock", "cleric"].includes(classId);
    const primary = isCaster
      ? stats.int * 0.45 + stats.str * 0.08
      : stats.str * 0.32 + stats.int * 0.12;
    return Math.max(
      5,
      Math.round(
        primary +
          stats.agi * 0.1 +
          stats.faith * 0.08
      )
    );
  }
  return Math.max(5, FALLBACK_ATTACK + Math.max(0, (entity.level ?? 1) - 1) * 2);
}

function getDefensePower(entity: Entity): number {
  const stats = entity.effectiveStats ?? getEffectiveStats(entity);
  if (stats) {
    return Math.max(0, Math.round(stats.def * 0.45 + stats.agi * 0.06));
  }
  return Math.max(0, Math.round((entity.level ?? 1) * 2));
}

// ── Stat-based combat formula functions (players only) ─────────────────
function getDodgeChance(entity: Entity): number {
  if (entity.type !== "player") return 0;
  const agi = entity.effectiveStats?.agi ?? entity.stats?.agi ?? 0;
  if (agi <= 0) return 0;
  return Math.min(DODGE_CAP, (agi / (agi + DODGE_K)) * DODGE_SCALE);
}

function getCritChance(entity: Entity): number {
  if (entity.type !== "player") return 0;
  const luck = entity.effectiveStats?.luck ?? entity.stats?.luck ?? 0;
  if (luck <= 0) return 0;
  return Math.min(CRIT_CAP, (luck / (luck + CRIT_K)) * CRIT_SCALE);
}

function getBlockChance(entity: Entity): number {
  if (entity.type !== "player") return 0;
  const def = entity.effectiveStats?.def ?? entity.stats?.def ?? 0;
  if (def <= 0) return 0;
  return Math.min(BLOCK_CAP, (def / (def + BLOCK_K)) * BLOCK_SCALE);
}

function getFaithHealMultiplier(entity: Entity): number {
  const faith = entity.effectiveStats?.faith ?? entity.stats?.faith ?? 0;
  if (faith <= 0) return 1.0;
  return 1 + (faith / (faith + FAITH_HEAL_K)) * FAITH_HEAL_SCALE;
}

function getHolyDamageBonus(entity: Entity): number {
  if (entity.type !== "player") return 0;
  const classId = entity.classId ?? "";
  if (classId !== "paladin" && classId !== "cleric") return 0;
  const faith = entity.effectiveStats?.faith ?? entity.stats?.faith ?? 0;
  return Math.floor(faith * FAITH_HOLY_COEFF);
}

// ── Hit resolution (dodge → crit → block) ──────────────────────────────
interface HitResult {
  finalDamage: number;
  hpLost: number;
  dodged: boolean;
  critical: boolean;
  blocked: boolean;
}

function resolveHit(attacker: Entity, defender: Entity, rawDamage: number): HitResult {
  // 1. Dodge (defender is player)
  if (defender.type === "player" && Math.random() < getDodgeChance(defender)) {
    return { finalDamage: 0, hpLost: 0, dodged: true, critical: false, blocked: false };
  }

  let damage = rawDamage;

  // 2. Critical hit (attacker is player)
  let critical = false;
  if (attacker.type === "player" && Math.random() < getCritChance(attacker)) {
    damage = Math.round(damage * CRIT_MULTIPLIER);
    critical = true;
  }

  // 3. Block (defender is player)
  let blocked = false;
  if (defender.type === "player" && Math.random() < getBlockChance(defender)) {
    damage = Math.round(damage * BLOCK_REDUCTION);
    blocked = true;
  }

  // 4. Clamp to MIN_DAMAGE
  damage = Math.max(MIN_DAMAGE, damage);

  // 5. Apply through shields → HP
  const hpLost = applyDamageWithShield(defender, damage);

  return { finalDamage: damage, hpLost, dodged: false, critical, blocked };
}

function computeDamage(attacker: Entity, defender: Entity, zoneId?: string): number {
  const raw = getAttackPower(attacker) - getDefensePower(defender) * 0.50;
  let damage = Math.max(MIN_DAMAGE, Math.round(raw));

  // Apply elemental modifiers in L25+ zones
  if (zoneId) {
    if (attacker.type === "player" && defender.type !== "player") {
      // Player attacking mob: check attacker resistance → deal less without it
      damage = Math.round(damage * getAttackMultiplier(zoneId, attacker.activeEffects));
    } else if (attacker.type !== "player" && defender.type === "player") {
      // Mob attacking player: check defender resistance → take more without it
      damage = Math.round(damage * getDefenseMultiplier(zoneId, defender.activeEffects));
    }
  }

  return Math.max(MIN_DAMAGE, damage);
}

function applyDurabilityLoss(entity: Entity, slots: EquipmentSlot[]): void {
  if (!entity.equipment) return;

  let changed = false;
  const owner = entity.walletAddress;
  for (const slot of slots) {
    const equipped = entity.equipment[slot];
    if (!equipped || equipped.durability <= 0) continue;

    equipped.durability = Math.max(0, equipped.durability - 1);
    if (equipped.durability === 0) {
      equipped.broken = true;
      // Auto-unequip broken items so they don't show as equipped
      const brokenName = equipped.name ?? `tokenId ${equipped.tokenId}`;
      delete entity.equipment[slot];
      changed = true;
      console.log(`[durability] ${entity.name}'s ${brokenName} (${slot}) broke and was unequipped`);
      logZoneEvent({
        zoneId: entity.region ?? "unknown",
        type: "system",
        tick: 0,
        message: `${entity.name}'s ${brokenName} broke!`,
        entityId: entity.id,
        entityName: entity.name,
      });
    }
    if (
      owner &&
      (equipped.instanceId || equipped.enchantments?.length || equipped.quality || equipped.rolledStats || equipped.bonusAffix)
    ) {
      const persisted = upsertItemInstanceFromEquipment({
        instanceId: equipped.instanceId,
        walletAddress: owner,
        tokenId: equipped.tokenId,
        name: equipped.name,
        quality: equipped.quality,
        rolledStats: equipped.rolledStats,
        bonusAffix: equipped.bonusAffix,
        durability: equipped.durability,
        maxDurability: equipped.maxDurability,
        enchantments: equipped.enchantments,
      });
      equipped.instanceId = persisted.instanceId;
    }
    changed = true;
  }

  if (changed) {
    recalculateEntityVitals(entity);
    if (owner) {
      saveCharacter(owner, entity.name, { equipment: entity.equipment }).catch(() => {});
    }
  }
}

function applyDamageWithShield(entity: Entity, rawDamage: number): number {
  let remaining = rawDamage;
  if (entity.activeEffects) {
    for (const effect of entity.activeEffects) {
      if (effect.type === "shield" && effect.shieldHp != null && effect.shieldHp > 0) {
        const absorbed = Math.min(effect.shieldHp, remaining);
        effect.shieldHp -= absorbed;
        remaining -= absorbed;
        if (remaining <= 0) break;
      }
    }
  }
  entity.hp -= remaining;
  return remaining;
}

function canRetaliate(entity: Entity): boolean {
  return entity.type === "player" || entity.type === "mob" || entity.type === "boss";
}

/**
 * Tag a mob on first hit. Refresh tick on subsequent hits from tagger.
 */
function trySetMobTag(mob: Entity, attackerId: string, attackerType: string, tick: number): void {
  if (mob.type !== "mob" && mob.type !== "boss") return;
  if (attackerType !== "player") return;

  if (!mob.taggedBy) {
    mob.taggedBy = attackerId;
    mob.taggedAtTick = tick;
  } else if (mob.taggedBy === attackerId) {
    mob.taggedAtTick = tick;
  }
}

/**
 * Clear all mob tags owned by a specific player in a zone.
 * Called on death, logout, and zone transition.
 */
export function clearMobTagsForPlayer(zone: ZoneState, playerId: string): void {
  for (const entity of zone.entities.values()) {
    if ((entity.type === "mob" || entity.type === "boss") && entity.taggedBy === playerId) {
      entity.taggedBy = undefined;
      entity.taggedAtTick = undefined;
    }
  }
}

/**
 * Handle player death: respawn at graveyard, apply XP penalty, restore HP.
 */
function handlePlayerDeath(player: Entity, zoneId: string): void {
  // Keep mob tags alive so the player can return for revenge kills with XP credit.
  // Tags will expire naturally via TAG_TIMEOUT_TICKS (60s) if the player doesn't return.
  const zone = getOrCreateZone(zoneId);
  player.lastCombatTick = undefined;

  // Apply death penalty: lose 10% of XP *within* the current level (progress toward next)
  // This prevents the death spiral where total-XP penalties outweigh kill rewards.
  let deathXpLoss = 0;
  if (player.xp != null && player.xp > 0 && player.level != null) {
    const levelFloor = xpForLevel(player.level);
    const xpWithinLevel = Math.max(0, player.xp - levelFloor);
    deathXpLoss = Math.floor(xpWithinLevel * DEATH_XP_LOSS_PERCENT);
    player.xp = Math.max(levelFloor, player.xp - deathXpLoss);
    console.log(`[death] ${player.name} lost ${deathXpLoss} XP (${player.xp} remaining, floor=${levelFloor})`);
  }

  // Persist XP after death penalty to Redis
  if (player.walletAddress && player.name) {
    saveCharacter(player.walletAddress, player.name, {
      level: player.level ?? 1,
      xp: player.xp ?? 0,
      kills: player.kills ?? 0,
    }).catch((err) => console.error(`[death] Save failed for ${player.name}:`, err));
  }

  // Gold tax on death: level * 10 copper (e.g. L42 = 420 copper = 0.042 GOLD)
  if (player.walletAddress) {
    const goldTax = copperToGold((player.level ?? 1) * 10);
    recordGoldSpend(player.walletAddress, goldTax);
    console.log(`[death] ${player.name} taxed ${(player.level ?? 1) * 10} copper (L${player.level ?? 1})`);
  }

  // Permanently burn items at 0 durability
  const burnedSlots: string[] = [];
  if (player.walletAddress && player.equipment) {
    for (const slot of Object.keys(player.equipment) as EquipmentSlot[]) {
      const equipped = player.equipment[slot];
      if (equipped && (equipped.durability <= 0 || equipped.broken)) {
        burnedSlots.push(slot);
        const { tokenId, instanceId } = equipped;
        delete player.equipment[slot];
        burnItem(player.walletAddress, BigInt(tokenId), 1n)
          .then(async () => {
            if (instanceId) {
              await deleteItemInstance(instanceId);
            }
          })
          .catch((err) => console.error(`[death] burn failed for ${player.name} slot=${slot} tokenId=${tokenId}:`, err));
      }
    }
    if (burnedSlots.length > 0) {
      console.log(`[death] ${player.name} lost ${burnedSlots.join(", ")} permanently (0 durability)`);
      logZoneEvent({
        zoneId,
        type: "system",
        message: `${player.name}'s ${burnedSlots.join(", ")} shattered beyond repair and was destroyed.`,
        tick: Date.now(),
      });
    }
  }

  // Teleport to graveyard spawn point (world-space)
  const localSpawn = GRAVEYARD_SPAWNS[zoneId] ?? { x: 100, y: 100 };
  const graveyardOffset = getZoneOffset(zoneId) ?? { x: 0, z: 0 };
  player.x = localSpawn.x + graveyardOffset.x;
  player.y = localSpawn.y + graveyardOffset.z;

  // Restore HP to full
  player.hp = player.maxHp;

  // Clear any pending orders and travel state
  player.order = undefined;
  player.travelTargetZone = undefined;

  // Clear all active effects and cooldowns on death
  player.activeEffects = [];
  player.cooldowns = undefined;

  // Recalculate vitals without buff/debuff modifiers
  recalculateEntityVitals(player);
  player.hp = player.maxHp;

  console.log(`[death] ${player.name} respawned at graveyard (${player.x}, ${player.y})`);

  // Log diary entry for player death
  if (player.walletAddress) {
    const { headline, narrative } = narrativeDeath(player.name, player.raceId, player.classId, zoneId, deathXpLoss);
    logDiary(player.walletAddress, player.name, zoneId, player.x, player.y, "death", headline, narrative, {
      xpLoss: deathXpLoss,
      respawnX: player.x,
      respawnY: player.y,
    });
  }

  // Sync death + XP loss to NFT (async, non-blocking)
  if (player.characterTokenId != null && player.raceId && player.classId && player.level != null) {
    updateCharacterMetadata(player as Required<Pick<Entity, 'characterTokenId' | 'name' | 'raceId' | 'classId' | 'level' | 'xp' | 'stats'>>)
      .catch((err) => console.error(`[death] NFT update failed for ${player.name}:`, err));
  }
}

/**
 * Handle mob death: auto-loot drops, create corpse for skinning
 */
async function handleMobDeath(
  mob: Entity,
  killer: Entity | undefined,
  zone: ZoneState
): Promise<void> {
  const lootTable = getLootTable(mob.name);
  const copperReward = rollMobCopperReward(mob);

  // Auto-loot: mint recyclable item drops to killer's wallet
  if (!killer) {
    console.warn(`[loot] ${mob.name} died with no killer — loot skipped`);
  } else if (!killer.walletAddress) {
    console.warn(`[loot] ${mob.name} killed by ${killer.name} (${killer.type}) — no walletAddress, loot skipped`);
  } else if (!lootTable) {
    console.warn(`[loot] ${mob.name} killed by ${killer.name} — no loot table entry, loot skipped`);
  }
  if (killer?.walletAddress && lootTable) {
    // Roll auto-drops
    const autoDrops = rollDrops(lootTable.autoDrops);
    for (const drop of autoDrops) {
      mintItem(killer.walletAddress, drop.tokenId, BigInt(drop.quantity)).catch((err) => {
        console.error(
          `[loot] Failed to mint tokenId ${drop.tokenId} to ${killer.walletAddress}:`,
          err
        );
      });
    }

    if (autoDrops.length > 0) {
      console.log(
        `[loot] ${killer.name} (${killer.walletAddress}) auto-looted ${autoDrops.length} recyclable item drops from ${mob.name}`
      );
    }
  }

  if (!killer) {
    console.warn(`[loot] ${mob.name} died with no killer — gold skipped`);
  } else if (shouldSuppressMobGold(killer, mob)) {
    if (killer.type === "player" && killer.level != null && mob.level != null) {
      const levelGap = killer.level - mob.level;
      if (levelGap >= MOB_GOLD_DISABLE_LEVEL_GAP) {
        console.log(
          `[loot] ${killer.name} (L${killer.level}) killed ${mob.name} (L${mob.level}) — gold suppressed by ${levelGap}-level gap`
        );
      }
    }
  } else if (copperReward > 0 && killer.walletAddress) {
    const goldReward = copperToGold(copperReward);
    void transferFromTreasury(killer.walletAddress, goldReward.toString())
      .then((txHash) => {
        const rewardLabel = formatCopperString(copperReward);
        console.log(
          `[loot] ${killer.name} received ${rewardLabel} from ${mob.name} tx=${txHash}`
        );
        logZoneEvent({
          zoneId: zone.zoneId,
          type: "loot",
          tick: zone.tick,
          message: `${killer.name} looted ${rewardLabel} from ${mob.name}.`,
          entityId: killer.id,
          entityName: killer.name,
          targetId: mob.id,
          targetName: mob.name,
          data: {
            copperReward,
            goldReward,
            mobLevel: mob.level ?? null,
            playerLevel: killer.level ?? null,
            txHash,
          },
        });
      })
      .catch((err) => {
        console.error(
          `[loot] Failed to transfer ${copperReward} copper from treasury to ${killer.walletAddress}:`,
          err
        );
      });
  }

  // Create corpse entity for skinning (if mob has skinning drops)
  if (lootTable && lootTable.skinningDrops.length > 0) {
    const corpse: Entity = {
      id: randomUUID(),
      type: "corpse",
      name: `${mob.name} Corpse`,
      x: mob.x,
      y: mob.y,
      hp: 0,
      maxHp: 0,
      createdAt: Date.now(),
      mobName: mob.name,
      skinned: false,
      skinnableUntil: Date.now() + 60000, // 60 seconds to skin
    };

    zone.entities.set(corpse.id, corpse);
    console.log(`[corpse] ${mob.name} corpse created at (${mob.x}, ${mob.y}) - skinnable for 60s`);
  }

  // Delete the original mob entity
  zone.entities.delete(mob.id);
}

// ── Smart Combat AI Helpers ────────────────────────────────────────────

/**
 * Pick the best technique for a player to use in combat.
 * Priority order:
 *   1. Self-buff if not already active (e.g. Frost Armor, Shield Wall)
 *   2. Self-heal if HP < 40%
 *   3. Debuff on target if not already debuffed by us
 *   4. Attack technique (highest damage multiplier first)
 *   5. null → fall back to basic attack
 *
 * Only picks techniques that are: learned, off cooldown, affordable (essence).
 */
export function pickTechnique(
  entity: Entity,
  target: Entity,
  zone: ZoneState,
): TechniqueDefinition | null {
  const learned = entity.learnedTechniques ?? [];
  if (learned.length === 0) return null;

  const currentEssence = entity.essence ?? 0;
  const tick = zone.tick;

  // Filter to usable techniques (learned, off cooldown, enough essence)
  const usable: TechniqueDefinition[] = [];
  for (const techId of learned) {
    const tech = getTechniqueById(techId);
    if (!tech) continue;
    if (tech.essenceCost > currentEssence) continue;
    if (entity.cooldowns) {
      const cdExpires = entity.cooldowns.get(techId);
      if (cdExpires != null && tick < cdExpires) continue;
    }
    usable.push(tech);
  }

  if (usable.length === 0) return null;

  // 1. Self-buff if we don't have one active
  const hasBuff = entity.activeEffects?.some(e => e.type === "buff" && e.casterId === entity.id);
  if (!hasBuff) {
    const buff = usable.find(t => t.type === "buff" && (t.targetType === "self" || t.targetType === "party"));
    if (buff) return buff;
  }

  // 2. Self-heal if low HP
  const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
  if (hpRatio < 0.4) {
    const heal = usable.find(t => t.type === "healing");
    if (heal) return heal;
  }

  const allyHealTarget = getLowestHpPartyAlly(entity, zone);
  if (allyHealTarget) {
    const partyHeal = usable.find(t => t.type === "healing" && t.targetType === "party");
    if (partyHeal) return partyHeal;

    const allyHeal = usable.find(t => t.type === "healing" && t.targetType === "ally");
    if (allyHeal) return allyHeal;
  }

  const allyBuffTarget = getLeaderFirstBuffTarget(entity, zone);
  if (allyBuffTarget) {
    const allyBuff = usable.find(t => t.type === "buff" && t.targetType === "ally");
    if (allyBuff) return allyBuff;
  }

  // 3. Debuff on target if we haven't already debuffed them
  const hasDebuff = target.activeEffects?.some(
    e => (e.type === "debuff" || e.type === "dot") && e.casterId === entity.id,
  );
  if (!hasDebuff) {
    const debuff = usable.find(t => t.type === "debuff");
    if (debuff) return debuff;
  }

  // 4. Attack technique — score for variety and situation, not just raw multiplier
  const attacks = usable.filter(t => t.type === "attack");
  if (attacks.length > 0) {
    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const nearbyTargets = countNearbyTechniqueTargets(target, zone, entity.id, 70);
    const attackRange = getEntityAttackRange(entity);
    let best: TechniqueDefinition | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const attack of attacks) {
      const score = scoreAttackTechnique(entity, attack, {
        tick,
        distance,
        attackRange,
        nearbyTargets,
      });
      if (score > bestScore) {
        best = attack;
        bestScore = score;
      }
    }

    if (best) return best;
  }

  // 5. Nothing good — basic attack
  return null;
}

function countNearbyTechniqueTargets(
  primaryTarget: Entity,
  zone: ZoneState,
  sourceEntityId: string,
  radius: number,
): number {
  let count = 0;
  for (const other of zone.entities.values()) {
    if (other.id === sourceEntityId) continue;
    if (other.type !== "mob" && other.type !== "boss") continue;
    if (other.hp <= 0 || other.leashing) continue;
    const dx = other.x - primaryTarget.x;
    const dy = other.y - primaryTarget.y;
    if (Math.sqrt(dx * dx + dy * dy) <= radius) {
      count += 1;
    }
  }
  return count;
}

function scoreAttackTechnique(
  entity: Entity,
  technique: TechniqueDefinition,
  context: {
    tick: number;
    distance: number;
    attackRange: number;
    nearbyTargets: number;
  },
): number {
  let score = technique.effects.damageMultiplier ?? 1;

  const isRepeat = entity.lastTechniqueId === technique.id
    && entity.lastTechniqueTick != null
    && context.tick - entity.lastTechniqueTick < 18;
  if (isRepeat) {
    score -= 0.45;
  }

  if (technique.targetType === "area" || (technique.effects.maxTargets ?? 1) > 1) {
    score += Math.min(0.45, Math.max(0, context.nearbyTargets - 1) * 0.18);
  }

  if (technique.animStyle === "projectile" && context.distance > context.attackRange) {
    score += 0.22;
  }

  if ((technique.effects.lunge ?? 0) > 0 && context.distance > context.attackRange * 0.7) {
    score += 0.2;
  }

  if (entity.classId === "monk") {
    if (technique.id === "monk_flying_kick" && context.distance > context.attackRange * 0.65) {
      score += 0.28;
    }
    if (technique.id === "monk_whirlwind_kick" && context.nearbyTargets >= 2) {
      score += 0.35;
    }
    if (technique.id === "monk_chi_burst" && context.distance > context.attackRange) {
      score += 0.18;
    }
  }

  if (entity.lastTechniqueId && entity.lastTechniqueId !== technique.id) {
    score += 0.05;
  }

  return score;
}

function isAliveAutoCombatTarget(entity: Entity | undefined): entity is Entity {
  return !!entity
    && (entity.type === "mob" || entity.type === "boss")
    && entity.hp > 0
    && !entity.leashing;
}

function getSameZonePartyMembers(
  entity: Entity,
  zone: ZoneState,
  partyMemberIds: string[] = getPartyMembers(entity.id),
): Entity[] {
  return partyMemberIds
    .map((memberId) => zone.entities.get(memberId))
    .filter((member): member is Entity => !!member && member.type === "player" && member.hp > 0 && member.region === zone.zoneId);
}

function hasBuffFromCaster(caster: Entity, target: Entity): boolean {
  return !!target.activeEffects?.some((effect) => effect.type === "buff" && effect.casterId === caster.id);
}

function getLeaderFirstBuffTarget(
  entity: Entity,
  zone: ZoneState,
  partyMemberIds: string[] = getPartyMembers(entity.id),
  partyLeaderIdOverride?: string,
): Entity | null {
  const members = getSameZonePartyMembers(entity, zone, partyMemberIds);
  if (members.length <= 1) return null;

  const leaderId = partyLeaderIdOverride ?? getPartyLeaderId(entity.id);
  const leader = leaderId ? members.find((member) => member.id === leaderId) : undefined;
  if (leader && leader.id !== entity.id && !hasBuffFromCaster(entity, leader)) {
    return leader;
  }

  return members.find((member) => member.id !== entity.id && !hasBuffFromCaster(entity, member)) ?? null;
}

function getLowestHpPartyAlly(
  entity: Entity,
  zone: ZoneState,
  partyMemberIds: string[] = getPartyMembers(entity.id),
): Entity | null {
  const members = getSameZonePartyMembers(entity, zone, partyMemberIds).filter((member) => member.id !== entity.id);
  if (members.length === 0) return null;

  const lowest = members
    .sort((a, b) => (a.hp / Math.max(1, a.maxHp)) - (b.hp / Math.max(1, b.maxHp)))[0];

  if (!lowest) return null;
  return (lowest.hp / Math.max(1, lowest.maxHp)) < 0.9 ? lowest : null;
}

export function pickTechniqueTargetIdForAutoCombat(
  entity: Entity,
  primaryTarget: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState,
  partyMemberIds: string[] = getPartyMembers(entity.id),
  partyLeaderIdOverride?: string,
): string {
  if (technique.targetType === "self" || technique.targetType === "party") return entity.id;

  if (technique.targetType === "ally") {
    if (technique.type === "healing") {
      const lowestHpAlly = getLowestHpPartyAlly(entity, zone, partyMemberIds);
      if (lowestHpAlly) return lowestHpAlly.id;
    }

    if (technique.type === "buff") {
      const leaderFirstTarget = getLeaderFirstBuffTarget(entity, zone, partyMemberIds, partyLeaderIdOverride);
      if (leaderFirstTarget) return leaderFirstTarget.id;
    }

    return entity.id;
  }

  return primaryTarget.id;
}

function getPartyTargetLockKey(playerId: string, partyIdOverride?: string): string | undefined {
  return partyIdOverride ?? getPlayerPartyId(playerId);
}

export function rememberPartyAutoCombatTarget(
  playerId: string,
  zoneId: string,
  targetId: string,
  tick: number,
  partyIdOverride?: string,
): void {
  const partyId = getPartyTargetLockKey(playerId, partyIdOverride);
  if (!partyId) return;
  partyTargetLocks.set(partyId, {
    targetId,
    zoneId,
    expiresAtTick: tick + PARTY_TARGET_LOCK_TICKS,
  });
}

export function clearPartyAutoCombatTargetLock(partyId: string): void {
  partyTargetLocks.delete(partyId);
}

function getDistanceBetween(a: Entity, b: Entity): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getPartyCombatAnchor(
  entity: Entity,
  zone: ZoneState,
  partyLeaderIdOverride?: string,
): Entity | null {
  const leaderId = partyLeaderIdOverride ?? getPartyLeaderId(entity.id);
  if (!leaderId) return null;

  const leader = zone.entities.get(leaderId);
  if (!leader || leader.type !== "player" || leader.hp <= 0) return null;

  return leader;
}

function isTargetWithinPartyAnchorRange(
  entity: Entity,
  target: Entity,
  zone: ZoneState,
  partyLeaderIdOverride?: string,
): boolean {
  const anchor = getPartyCombatAnchor(entity, zone, partyLeaderIdOverride);
  if (!anchor) return true;
  return getDistanceBetween(anchor, target) <= PARTY_ANCHOR_PULL_RADIUS;
}

function getLockedPartyTarget(
  entity: Entity,
  zone: ZoneState,
  autoCombatRange: number,
  partyIdOverride?: string,
  partyLeaderIdOverride?: string,
): Entity | null {
  const partyId = getPartyTargetLockKey(entity.id, partyIdOverride);
  if (!partyId) return null;

  const lock = partyTargetLocks.get(partyId);
  if (!lock) return null;
  if (lock.expiresAtTick < zone.tick) {
    partyTargetLocks.delete(partyId);
    return null;
  }
  if (lock.zoneId !== zone.zoneId) return null;

  const target = zone.entities.get(lock.targetId) ?? getEntity(lock.targetId);
  if (!isAliveAutoCombatTarget(target) || target.region !== zone.zoneId) {
    partyTargetLocks.delete(partyId);
    return null;
  }

  if (getDistanceBetween(entity, target) > autoCombatRange) return null;
  if (!isTargetWithinPartyAnchorRange(entity, target, zone, partyLeaderIdOverride)) return null;
  return target;
}

function getPartyFocusTarget(
  entity: Entity,
  zone: ZoneState,
  autoCombatRange: number,
  partyMemberIds: string[] = getPartyMembers(entity.id),
  partyLeaderIdOverride?: string,
): Entity | null {
  if (partyMemberIds.length <= 1) return null;

  const leaderId = partyLeaderIdOverride ?? getPartyLeaderId(entity.id);
  if (leaderId && leaderId !== entity.id) {
    const leader = zone.entities.get(leaderId);
    const order = leader?.order;
    if (leader && leader.type === "player" && leader.hp > 0 && order && (order.action === "attack" || order.action === "technique")) {
      const target = zone.entities.get(order.targetId);
      if (isAliveAutoCombatTarget(target)) {
        const distance = getDistanceBetween(entity, target);
        if (distance <= autoCombatRange && isTargetWithinPartyAnchorRange(entity, target, zone, partyLeaderIdOverride)) {
          return target;
        }
      }
    }
  }

  const sameZonePartyMembers = new Set(partyMemberIds);
  let taggedTarget: Entity | null = null;
  let taggedDistance = Number.POSITIVE_INFINITY;

  for (const candidate of zone.entities.values()) {
    if (!isAliveAutoCombatTarget(candidate)) continue;
    if (!candidate.taggedBy || !sameZonePartyMembers.has(candidate.taggedBy)) continue;

    const distance = getDistanceBetween(entity, candidate);
    if (distance > autoCombatRange) continue;
    if (!isTargetWithinPartyAnchorRange(entity, candidate, zone, partyLeaderIdOverride)) continue;

    if (!taggedTarget || distance < taggedDistance) {
      taggedTarget = candidate;
      taggedDistance = distance;
    }
  }

  return taggedTarget;
}

function isTrivialAutoCombatTarget(entity: Entity, target: Entity): boolean {
  if (entity.type !== "player") return false;
  if (target.type !== "mob" && target.type !== "boss") return false;
  if (entity.level == null || target.level == null) return false;
  return getLevelGapMultiplier(entity.level, target.level) <= 0;
}

export function pickAutoCombatTarget(
  entity: Entity,
  zone: ZoneState,
  autoCombatRange: number,
  partyMemberIds: string[] = getPartyMembers(entity.id),
  partyIdOverride?: string,
  partyLeaderIdOverride?: string,
): Entity | null {
  const lockedTarget = getLockedPartyTarget(entity, zone, autoCombatRange, partyIdOverride, partyLeaderIdOverride);
  if (lockedTarget) return lockedTarget;

  const partyFocusTarget = getPartyFocusTarget(entity, zone, autoCombatRange, partyMemberIds, partyLeaderIdOverride);
  if (partyFocusTarget) return partyFocusTarget;

  const shouldRespectPartyAnchor = partyMemberIds.length > 1;
  let nearestMob: Entity | null = null;
  let nearestDist = autoCombatRange;
  for (const other of zone.entities.values()) {
    if (!isAliveAutoCombatTarget(other)) continue;
    if (shouldRespectPartyAnchor && !isTargetWithinPartyAnchorRange(entity, other, zone, partyLeaderIdOverride)) continue;
    if (isTrivialAutoCombatTarget(entity, other)) continue;
    const dist = getDistanceBetween(entity, other);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestMob = other;
    }
  }

  return nearestMob;
}

/**
 * Apply technique effects during the tick loop (mirrors techniqueRoutes.applyTechniqueEffects).
 * Returns { damage } for attack techniques.
 */
interface TechniqueHitResult {
  damage?: number;
  dodged?: boolean;
  critical?: boolean;
  blocked?: boolean;
}

function applyTechniqueInCombat(
  caster: Entity,
  target: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState,
): TechniqueHitResult {
  const { effects, type } = technique;
  const result: TechniqueHitResult = {};

  // Attack techniques
  if (type === "attack" && effects.damageMultiplier) {
    const stats = caster.effectiveStats ?? getEffectiveStats(caster);
    const isCaster = ["mage", "cleric", "warlock"].includes(caster.classId ?? "");
    const primaryStat = isCaster
      ? (stats?.int ?? caster.stats?.int ?? 10)
      : (stats?.str ?? caster.stats?.str ?? 10);
    const baseDmg = Math.floor(5 + primaryStat * 0.5);
    let damage = Math.floor(baseDmg * effects.damageMultiplier);

    // Holy damage bonus for paladin/cleric
    damage += getHolyDamageBonus(caster);

    if (effects.maxTargets && effects.maxTargets > 1) {
      // AoE — hit multiple targets (each rolls dodge/crit/block independently)
      const nearby: Entity[] = [];
      for (const e of zone.entities.values()) {
        if (e.type !== "mob" && e.type !== "boss") continue;
        if (e.hp <= 0 || e.id === caster.id) continue;
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        if (Math.sqrt(dx * dx + dy * dy) <= (effects.areaRadius ?? 50)) {
          nearby.push(e);
          if (nearby.length >= effects.maxTargets) break;
        }
      }
      for (const t of nearby) {
        resolveHit(caster, t, damage);
      }
      result.damage = damage;
    } else {
      const hit = resolveHit(caster, target, damage);
      result.damage = hit.finalDamage;
      result.dodged = hit.dodged;
      result.critical = hit.critical;
      result.blocked = hit.blocked;
    }

    // Lifesteal (amplified by faith for paladin/cleric)
    if (effects.healAmount && !result.dodged) {
      const healBase = Math.floor((result.damage ?? 0) * (effects.healAmount / 100));
      const heal = Math.floor(healBase * getFaithHealMultiplier(caster));
      caster.hp = Math.min(caster.maxHp, caster.hp + heal);
    }
  }

  // Healing techniques (amplified by faith)
  if (type === "healing" && effects.healAmount) {
    const faithMult = getFaithHealMultiplier(caster);
    if (effects.duration && effects.duration > 0) {
      const totalHeal = Math.floor(target.maxHp * (effects.healAmount / 100) * faithMult);
      const healPerTick = Math.max(1, Math.floor(totalHeal / effects.duration));
      addActiveEffectInternal(target, {
        id: randomUUID(),
        techniqueId: technique.id,
        name: technique.name,
        type: "hot",
        casterId: caster.id,
        appliedAtTick: zone.tick,
        durationTicks: effects.duration,
        remainingTicks: effects.duration,
        hotHealPerTick: healPerTick,
      });
    } else {
      const healAmount = Math.floor(target.maxHp * (effects.healAmount / 100) * faithMult);
      const actualHeal = Math.min(healAmount, target.maxHp - target.hp);
      target.hp = Math.min(target.maxHp, target.hp + actualHeal);
    }
  }

  // Buffs
  if (type === "buff" && effects.duration) {
    addActiveEffectInternal(target, {
      id: randomUUID(),
      techniqueId: technique.id,
      name: technique.name,
      type: effects.shield ? "shield" : "buff",
      casterId: caster.id,
      appliedAtTick: zone.tick,
      durationTicks: effects.duration,
      remainingTicks: effects.duration,
      statModifiers: effects.statBonus,
      shieldHp: effects.shield ? Math.floor(target.maxHp * (effects.shield / 100)) : undefined,
      shieldMaxHp: effects.shield ? Math.floor(target.maxHp * (effects.shield / 100)) : undefined,
    });
    if (effects.statBonus) recalculateEntityVitals(target);
  }

  // Debuffs
  if (type === "debuff" && effects.duration) {
    addActiveEffectInternal(target, {
      id: randomUUID(),
      techniqueId: technique.id,
      name: technique.name,
      type: effects.dotDamage ? "dot" : "debuff",
      casterId: caster.id,
      appliedAtTick: zone.tick,
      durationTicks: effects.duration,
      remainingTicks: effects.duration,
      statModifiers: effects.statReduction,
      dotDamage: effects.dotDamage,
    });
    if (effects.statReduction) recalculateEntityVitals(target);
  }

  return result;
}

function applyPartyTechniqueInCombat(
  caster: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState,
): { affectedIds: string[] } {
  const affectedIds: string[] = [];
  const memberIds = getPartyMembers(caster.id);

  for (const memberId of memberIds) {
    const member = getEntity(memberId);
    if (!member || member.type !== "player" || member.hp <= 0) continue;
    if (member.region !== zone.zoneId) continue;

    applyTechniqueInCombat(caster, member, technique, zone);
    affectedIds.push(member.id);
  }

  if (affectedIds.length === 0) {
    applyTechniqueInCombat(caster, caster, technique, zone);
    affectedIds.push(caster.id);
  }

  return { affectedIds };
}

/** Add an active effect (same logic as techniqueRoutes, but accessible from zoneRuntime) */
function addActiveEffectInternal(entity: Entity, effect: ActiveEffect): void {
  if (!entity.activeEffects) entity.activeEffects = [];
  // Same technique refreshes (replaces), different techniques stack
  entity.activeEffects = entity.activeEffects.filter(e => e.techniqueId !== effect.techniqueId);
  entity.activeEffects.push(effect);
}

const ENTITY_COLLISION_RADIUS = 14; // units — entities can't overlap within this radius

/** Entity types that can be displaced by collisions. NPCs/stations are immovable. */
const MOVABLE_TYPES = new Set(["player", "mob", "boss"]);

function moveToward(
  entity: Entity, tx: number, ty: number,
  zoneEntities?: Map<string, Entity>,
): boolean {
  const dx = tx - entity.x;
  const dy = ty - entity.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 5) return true; // arrived
  const step = Math.min(MOVE_SPEED, dist);
  let nx = entity.x + (dx / dist) * step;
  let ny = entity.y + (dy / dist) * step;

  // Entity-to-entity collision: push out of overlapping living entities
  if (zoneEntities) {
    for (const other of zoneEntities.values()) {
      if (other.id === entity.id) continue;
      if ((other.hp ?? 0) <= 0) continue; // ignore corpses/dead
      if (other.type === "flower-node" || other.type === "ore-node" ||
          other.type === "nectar-node" || other.type === "crop-node" || other.type === "corpse") continue;
      const ox = nx - other.x;
      const oy = ny - other.y;
      const oDist = Math.sqrt(ox * ox + oy * oy);
      if (oDist < ENTITY_COLLISION_RADIUS && oDist > 0.01) {
        // Push entity out along the overlap direction
        const push = ENTITY_COLLISION_RADIUS - oDist;
        nx += (ox / oDist) * push;
        ny += (oy / oDist) * push;
      }
    }
  }

  entity.x = nx;
  entity.y = ny;
  return false;
}

async function worldTick() {
  world.tick++;

  // Broadcast day/night phase transitions to all zones
  const newPhase = checkPhaseTransition(world.tick);
  if (newPhase) {
    const gt = getGameTime(world.tick);
    const phaseMessages: Record<string, string> = {
      dawn: `The sun rises over the horizon. Day ${gt.day} begins.`,
      day: "Bright sunlight fills the land.",
      dusk: "The sun sets, casting long shadows across the world.",
      night: "Darkness falls. The night creatures stir.",
    };
    for (const zone of getAllZones().values()) {
      logZoneEvent({
        zoneId: zone.zoneId,
        tick: world.tick,
        type: "system",
        message: phaseMessages[newPhase],
        data: { phase: newPhase, gameTime: gt },
      });
    }
  }

  for (const zone of getAllZones().values()) {

    // Regenerate essence for all player entities (INT-scaled)
    for (const entity of zone.entities.values()) {
      if (entity.type === "player" && entity.essence != null && entity.maxEssence != null) {
        const intStat = entity.effectiveStats?.int ?? entity.stats?.int ?? 0;
        const regenRate = ESSENCE_REGEN_BASE + intStat * ESSENCE_REGEN_INT_COEFF;
        const regenAmount = Math.ceil(entity.maxEssence * regenRate);
        entity.essence = Math.min(entity.maxEssence, entity.essence + regenAmount);
      }
    }

    // Tag timeout: release mob tags after TAG_TIMEOUT_TICKS of inactivity
    for (const entity of zone.entities.values()) {
      if ((entity.type === "mob" || entity.type === "boss") && entity.taggedBy && entity.taggedAtTick != null) {
        if (zone.tick - entity.taggedAtTick >= TAG_TIMEOUT_TICKS) {
          entity.taggedBy = undefined;
          entity.taggedAtTick = undefined;
        }
      }
    }

    // Out-of-combat HP regeneration for mobs/bosses (heal back up if players disengage)
    for (const entity of zone.entities.values()) {
      if (entity.type !== "mob" && entity.type !== "boss") continue;
      if (entity.hp <= 0 || entity.hp >= entity.maxHp) continue;
      // Must have been in combat at least once AND be out of combat long enough
      if (entity.lastCombatTick == null || zone.tick - entity.lastCombatTick < OOC_REGEN_DELAY_TICKS) continue;
      const healAmount = Math.max(1, Math.ceil(entity.maxHp * OOC_REGEN_PERCENT));
      entity.hp = Math.min(entity.maxHp, entity.hp + healAmount);
    }

    // Out-of-combat HP regeneration for players (FAITH-scaled)
    for (const entity of zone.entities.values()) {
      if (entity.type !== "player") continue;
      if (entity.hp <= 0 || entity.hp >= entity.maxHp) continue;
      // Must have been in combat at least once AND be out of combat long enough
      if (entity.lastCombatTick == null || zone.tick - entity.lastCombatTick < OOC_REGEN_DELAY_TICKS) continue;
      const faithStat = entity.effectiveStats?.faith ?? entity.stats?.faith ?? 0;
      const regenRate = PLAYER_HP_REGEN_BASE + faithStat * PLAYER_HP_REGEN_FAITH_COEFF;
      const healAmount = Math.max(1, Math.ceil(entity.maxHp * regenRate));
      entity.hp = Math.min(entity.maxHp, entity.hp + healAmount);
    }

    // Process active effects (DoTs, HoTs, expiration)
    for (const entity of zone.entities.values()) {
      if (!entity.activeEffects || entity.activeEffects.length === 0) continue;

      let needsRecalc = false;
      const expiredIds: string[] = [];

      for (const effect of entity.activeEffects) {
        effect.remainingTicks--;

        // DoT damage
        if (effect.type === "dot" && effect.dotDamage != null && effect.dotDamage > 0) {
          entity.hp -= effect.dotDamage;

          // Mob tagging + combat tracking from DoT caster
          trySetMobTag(entity, effect.casterId, "player", zone.tick);
          entity.lastCombatTick = zone.tick;

          if (entity.hp <= 0) {
            // Resolve tagger for DoT kill
            const dotTagger = entity.taggedBy ? zone.entities.get(entity.taggedBy) : undefined;
            const dotCaster = zone.entities.get(effect.casterId);
            const dotKiller = (dotTagger && dotTagger.type === "player") ? dotTagger
              : (dotCaster && dotCaster.type === "player") ? dotCaster : undefined;

            logZoneEvent({
              zoneId: zone.zoneId,
              type: "death",
              tick: zone.tick,
              message: `${entity.name} has been slain by ${effect.name}!`,
              entityId: entity.id,
              entityName: entity.name,
            });
            if (entity.type === "player") {
              handlePlayerDeath(entity, zone.zoneId);
            } else {
              // Award kill credit + XP for DoT kills
              if (dotKiller && dotKiller.type === "player") {
                dotKiller.kills = (dotKiller.kills ?? 0) + 1;
                logZoneEvent({
                  zoneId: zone.zoneId,
                  type: "kill",
                  tick: zone.tick,
                  message: `${dotKiller.name} has slain ${entity.name}!`,
                  entityId: dotKiller.id,
                  entityName: dotKiller.name,
                  targetId: entity.id,
                  targetName: entity.name,
                  data: { xpReward: entity.xpReward ?? 0 },
                });
                if (dotKiller.activeQuests) {
                  for (const activeQuest of dotKiller.activeQuests) {
                    const questDef = QUEST_CATALOG.find((q) => q.id === activeQuest.questId);
                    if (questDef && doesKillCountForQuest(questDef, entity.type, entity.name)) {
                      activeQuest.progress++;
                    }
                  }
                }
              }
              await handleMobDeath(entity, dotKiller, zone);
              // Grant XP for DoT kill
              if (dotKiller) {
                awardPartyXp(zone, dotKiller, entity.xpReward ?? 0, entity.level);
              }
            }
            break; // Entity is dead, stop processing effects
          }
        }

        // HoT healing
        if (effect.type === "hot" && effect.hotHealPerTick != null && effect.hotHealPerTick > 0) {
          entity.hp = Math.min(entity.maxHp, entity.hp + effect.hotHealPerTick);
        }

        // Remove depleted shields
        if (effect.type === "shield" && effect.shieldHp != null && effect.shieldHp <= 0) {
          expiredIds.push(effect.id);
        }

        // Remove expired effects
        if (effect.remainingTicks <= 0) {
          expiredIds.push(effect.id);
          if (effect.type === "buff" || effect.type === "debuff") {
            needsRecalc = true;
          }
        }
      }

      // Skip cleanup if entity was killed by DoT and deleted
      if (entity.hp <= 0) continue;

      if (expiredIds.length > 0) {
        entity.activeEffects = entity.activeEffects.filter(e => !expiredIds.includes(e.id));
      }

      if (needsRecalc) {
        recalculateEntityVitals(entity);
      }
    }

    for (const entity of zone.entities.values()) {
      if (!entity.castingIntent) continue;

      const target = getEntity(entity.castingIntent.targetId);
      const technique = getTechniqueById(entity.castingIntent.techniqueId);
      if (!target || target.hp <= 0 || !technique) {
        entity.castingIntent = undefined;
        continue;
      }

      if (zone.tick >= entity.castingIntent.resolveAtTick) {
        entity.order = {
          action: "technique",
          targetId: entity.castingIntent.targetId,
          techniqueId: entity.castingIntent.techniqueId,
          resolving: true,
        };
        entity.castingIntent = undefined;
      }
    }

    for (const entity of zone.entities.values()) {
      if (!entity.order) continue;
      if (entity.castingIntent) continue;

      if (entity.order.action === "move") {
        const arrived = moveToward(entity, entity.order.x, entity.order.y, zone.entities);
        if (arrived) entity.order = undefined;
      } else if (entity.order.action === "attack") {
        const target = getEntity(entity.order.targetId);
        if (!target) {
          entity.order = undefined;
          continue;
        }
        // Prevent party friendly fire
        if (entity.type === "player" && target.type === "player"
            && areInSameParty(entity.id, target.id)) {
          entity.order = undefined;
          continue;
        }
        // Can't attack leashing (evading) mobs
        if (target.leashing) {
          entity.order = undefined;
          continue;
        }
        const dx = target.x - entity.x;
        const dy = target.y - entity.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > getEntityAttackRange(entity)) {
          moveToward(entity, target.x, target.y, world.entities);
        } else {
          if (entity.type === "player" && isAliveAutoCombatTarget(target)) {
            rememberPartyAutoCombatTarget(entity.id, zone.zoneId, target.id, zone.tick);
          }
          const rawDmg = computeDamage(entity, target, zone.zoneId);
          const hit = resolveHit(entity, target, rawDmg);

          // Mob tagging + combat tracking (even on dodge — still counts as engagement)
          trySetMobTag(target, entity.id, entity.type, zone.tick);
          entity.lastCombatTick = zone.tick;
          target.lastCombatTick = zone.tick;

          const atkAnim = getBasicAttackAnimStyle(entity);

          if (hit.dodged) {
            // Dodge: no damage, no durability loss, no retaliation, no death
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "combat",
              tick: zone.tick,
              message: `${target.name} dodges ${entity.name}'s attack!`,
              entityId: entity.id,
              entityName: entity.name,
              targetId: target.id,
              targetName: target.name,
              data: { damage: 0, dodged: true, targetHp: target.hp, animStyle: atkAnim, casterX: entity.x, casterZ: entity.y, targetX: target.x, targetZ: target.y },
            });
          } else {
            // Hit landed — apply durability
            applyDurabilityLoss(entity, ["weapon", ...ARMOR_SLOTS]);
            applyDurabilityLoss(target, ["weapon", ...ARMOR_SLOTS]);

            const hitTag = hit.critical ? "CRITICAL! " : "";
            const blockTag = hit.blocked ? " (blocked)" : "";
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "combat",
              tick: zone.tick,
              message: `${hitTag}${entity.name} hits ${target.name} for ${hit.finalDamage} damage!${blockTag}`,
              entityId: entity.id,
              entityName: entity.name,
              targetId: target.id,
              targetName: target.name,
              data: { damage: hit.finalDamage, critical: hit.critical, blocked: hit.blocked, targetHp: target.hp, animStyle: atkAnim, casterX: entity.x, casterZ: entity.y, targetX: target.x, targetZ: target.y },
            });

            // Basic retaliation: combatants trade hits while in range.
            if (target.hp > 0 && canRetaliate(target)) {
              const retRaw = computeDamage(target, entity, zone.zoneId);
              const retHit = resolveHit(target, entity, retRaw);

              entity.lastCombatTick = zone.tick;
              target.lastCombatTick = zone.tick;

              const retAnim = getBasicAttackAnimStyle(target);

              if (retHit.dodged) {
                logZoneEvent({
                  zoneId: zone.zoneId,
                  type: "combat",
                  tick: zone.tick,
                  message: `${entity.name} dodges ${target.name}'s retaliation!`,
                  entityId: target.id,
                  entityName: target.name,
                  targetId: entity.id,
                  targetName: entity.name,
                  data: { damage: 0, dodged: true, targetHp: entity.hp, animStyle: retAnim, casterX: target.x, casterZ: target.y, targetX: entity.x, targetZ: entity.y },
                });
              } else {
                applyDurabilityLoss(target, ["weapon", ...ARMOR_SLOTS]);
                applyDurabilityLoss(entity, ["weapon", ...ARMOR_SLOTS]);

                const retTag = retHit.critical ? "CRITICAL! " : "";
                const retBlockTag = retHit.blocked ? " (blocked)" : "";
                logZoneEvent({
                  zoneId: zone.zoneId,
                  type: "combat",
                  tick: zone.tick,
                  message: `${retTag}${target.name} retaliates for ${retHit.finalDamage} damage!${retBlockTag}`,
                  entityId: target.id,
                  entityName: target.name,
                  targetId: entity.id,
                  targetName: entity.name,
                  data: { damage: retHit.finalDamage, critical: retHit.critical, blocked: retHit.blocked, targetHp: entity.hp, animStyle: retAnim, casterX: target.x, casterZ: target.y, targetX: entity.x, targetZ: entity.y },
                });

                if (entity.hp <= 0) {
                  logZoneEvent({
                    zoneId: zone.zoneId,
                    type: "death",
                    tick: zone.tick,
                    message: `${entity.name} has been slain by ${target.name}!`,
                    entityId: entity.id,
                    entityName: entity.name,
                    targetId: target.id,
                    targetName: target.name,
                  });

                  if (entity.type === "player") {
                    handlePlayerDeath(entity, zone.zoneId);
                    continue;
                  } else {
                    const retaliator = (entity.taggedBy && zone.entities.get(entity.taggedBy)?.type === "player")
                      ? zone.entities.get(entity.taggedBy)!
                      : (target.type === "player" ? target : undefined);
                    if (retaliator && retaliator.type === "player") {
                      retaliator.kills = (retaliator.kills ?? 0) + 1;
                      logZoneEvent({
                        zoneId: zone.zoneId,
                        type: "kill",
                        tick: zone.tick,
                        message: `${retaliator.name} has slain ${entity.name}!`,
                        entityId: retaliator.id,
                        entityName: retaliator.name,
                        targetId: entity.id,
                        targetName: entity.name,
                        data: { xpReward: entity.xpReward ?? 0 },
                      });
                      if (retaliator.walletAddress) {
                        const { headline, narrative } = narrativeKill(retaliator.name, retaliator.raceId, retaliator.classId, zone.zoneId, entity.name, entity.xpReward ?? 0);
                        logDiary(retaliator.walletAddress, retaliator.name, zone.zoneId, retaliator.x, retaliator.y, "kill", headline, narrative, {
                          targetName: entity.name,
                          targetType: entity.type,
                          xpReward: entity.xpReward ?? 0,
                        });
                      }
                      if (retaliator.activeQuests) {
                        for (const activeQuest of retaliator.activeQuests) {
                          const questDef = QUEST_CATALOG.find((q) => q.id === activeQuest.questId);
                          if (questDef && doesKillCountForQuest(questDef, entity.type, entity.name)) {
                            activeQuest.progress++;
                          }
                        }
                      }
                    }

                    await handleMobDeath(entity, retaliator ?? target, zone);

                    if (retaliator) {
                      awardPartyXp(zone, retaliator, entity.xpReward ?? 0, entity.level);
                    }
                    continue;
                  }
                }
              }
            }
          }

          if (target.hp <= 0) {
            // Resolve tagger: the player who first tagged the mob gets all rewards
            const tagger = (target.taggedBy && target.taggedBy !== entity.id)
              ? zone.entities.get(target.taggedBy) : undefined;
            const xpRecipient = (tagger && tagger.type === "player") ? tagger : entity;

            // Log kill
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "kill",
              tick: zone.tick,
              message: `${xpRecipient.name} has slain ${target.name}!`,
              entityId: xpRecipient.id,
              entityName: xpRecipient.name,
              targetId: target.id,
              targetName: target.name,
              data: { xpReward: target.xpReward ?? 0 },
            });

            // Increment kill count for the reward recipient
            if (xpRecipient.type === "player") {
              xpRecipient.kills = (xpRecipient.kills ?? 0) + 1;

              // Log kill diary entry
              if (xpRecipient.walletAddress) {
                const { headline, narrative } = narrativeKill(xpRecipient.name, xpRecipient.raceId, xpRecipient.classId, zone.zoneId, target.name, target.xpReward ?? 0);
                logDiary(xpRecipient.walletAddress, xpRecipient.name, zone.zoneId, xpRecipient.x, xpRecipient.y, "kill", headline, narrative, {
                  targetName: target.name,
                  targetType: target.type,
                  xpReward: target.xpReward ?? 0,
                });
              }
            }

            // Handle target death based on type
            if (target.type === "player") {
              handlePlayerDeath(target, zone.zoneId);
            } else {
              // Mobs/bosses: auto-loot to tagger + create corpse
              await handleMobDeath(target, xpRecipient, zone);

              // Track quest progress for kills (reward recipient only)
              if (xpRecipient.type === "player" && xpRecipient.activeQuests) {
                for (const activeQuest of xpRecipient.activeQuests) {
                  const questDef = QUEST_CATALOG.find((q) => q.id === activeQuest.questId);
                  if (questDef && doesKillCountForQuest(questDef, target.type, target.name)) {
                    activeQuest.progress++;
                    console.log(
                      `[quest] ${xpRecipient.name} progress: ${questDef.title} (${activeQuest.progress}/${questDef.objective.count})`
                    );
                    // Emit quest progress event so agents can track without polling
                    logZoneEvent({
                      zoneId: zone.zoneId,
                      type: "quest-progress",
                      tick: zone.tick,
                      message: `${xpRecipient.name}: ${questDef.title} (${activeQuest.progress}/${questDef.objective.count})`,
                      entityId: xpRecipient.id,
                      entityName: xpRecipient.name,
                      data: {
                        questId: activeQuest.questId,
                        questTitle: questDef.title,
                        progress: activeQuest.progress,
                        required: questDef.objective.count,
                        complete: activeQuest.progress >= questDef.objective.count,
                      },
                    });
                  }
                }
              }
            }

            entity.order = undefined;

            // Grant XP on kill — shared with party members in same zone
            awardPartyXp(zone, xpRecipient, target.xpReward ?? 0, target.level);
          }
        }
      } else if (entity.order.action === "technique") {
        // ── Technique order processing ─────────────────────────────
        const target = getEntity(entity.order.targetId);
        const technique = getTechniqueById(entity.order.techniqueId);
        if (!target || !technique) {
          entity.order = undefined;
          continue;
        }
        // Prevent party friendly fire for attack techniques
        if (technique.type === "attack" && entity.type === "player" && target.type === "player"
            && areInSameParty(entity.id, target.id)) {
          entity.order = undefined;
          continue;
        }
        // Can't use techniques on leashing (evading) mobs
        if (technique.type === "attack" && target.leashing) {
          entity.order = undefined;
          continue;
        }
        const dx = target.x - entity.x;
        const dy = target.y - entity.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Projectile/area techniques can be cast at range even by melee classes
        const baseRange = getEntityAttackRange(entity);
        const techRange = (technique.animStyle === "projectile" || technique.animStyle === "area")
          ? Math.max(baseRange, 100)
          : baseRange;
        if (dist > techRange) {
          moveToward(entity, target.x, target.y, world.entities);
        } else {
          if (entity.type === "player" && isAliveAutoCombatTarget(target)) {
            rememberPartyAutoCombatTarget(entity.id, zone.zoneId, target.id, zone.tick);
          }
          const windupTicks = getTechniqueWindupTicks(technique);
          if (windupTicks > 0 && !entity.order.resolving) {
            const currentEssence = entity.essence ?? 0;
            entity.essence = Math.max(0, currentEssence - technique.essenceCost);
            if (!entity.cooldowns) entity.cooldowns = new Map();
            entity.cooldowns.set(technique.id, zone.tick + technique.cooldown);
            entity.lastTechniqueId = technique.id;
            entity.lastTechniqueTick = zone.tick;
            entity.castingIntent = {
              targetId: target.id,
              techniqueId: technique.id,
              startedAtTick: zone.tick,
              resolveAtTick: zone.tick + windupTicks,
            };
            entity.order = undefined;
            continue;
          }

          if (!entity.order.resolving) {
            // Deduct essence
            const currentEssence = entity.essence ?? 0;
            entity.essence = Math.max(0, currentEssence - technique.essenceCost);

            // Set cooldown
            if (!entity.cooldowns) entity.cooldowns = new Map();
            entity.cooldowns.set(technique.id, zone.tick + technique.cooldown);
            entity.lastTechniqueId = technique.id;
            entity.lastTechniqueTick = zone.tick;
          }

          const isPartyTechnique = technique.targetType === "party";
          const partyResult = isPartyTechnique
            ? applyPartyTechniqueInCombat(entity, technique, zone)
            : undefined;
          const techResult: TechniqueHitResult = isPartyTechnique
            ? {}
            : applyTechniqueInCombat(entity, target, technique, zone);

          // Mob tagging + combat tracking for attack techniques
          if (technique.type === "attack") {
            trySetMobTag(target, entity.id, entity.type, zone.tick);
            entity.lastCombatTick = zone.tick;
            target.lastCombatTick = zone.tick;
          }

          // Log the technique use
          if (isPartyTechnique) {
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "ability",
              tick: zone.tick,
              message: `${entity.name} uses ${technique.name} on the party!`,
              entityId: entity.id,
              entityName: entity.name,
              data: {
                techniqueId: technique.id,
                techniqueName: technique.name,
                techniqueType: technique.type,
                animStyle: technique.animStyle,
                affectedIds: partyResult?.affectedIds ?? [entity.id],
                casterX: entity.x,
                casterZ: entity.y,
                targetX: entity.x,
                targetZ: entity.y,
              },
            });
          } else if (technique.type === "attack") {
            if (techResult.dodged) {
              logZoneEvent({
                zoneId: zone.zoneId,
                type: "ability",
                tick: zone.tick,
                message: `${target.name} dodges ${entity.name}'s ${technique.name}!`,
                entityId: entity.id,
                entityName: entity.name,
                targetId: target.id,
                targetName: target.name,
                data: {
                  techniqueId: technique.id,
                  techniqueName: technique.name,
                  techniqueType: technique.type,
                  animStyle: technique.animStyle,
                  damage: 0,
                  dodged: true,
                  targetHp: target.hp,
                  casterX: entity.x,
                  casterZ: entity.y,
                  targetX: target.x,
                  targetZ: target.y,
                },
              });
            } else {
              const dmg = techResult.damage ?? 0;
              const critTag = techResult.critical ? "CRITICAL! " : "";
              const blockTag = techResult.blocked ? " (blocked)" : "";
              logZoneEvent({
                zoneId: zone.zoneId,
                type: "ability",
                tick: zone.tick,
                message: `${critTag}${entity.name} casts ${technique.name} on ${target.name} for ${dmg} damage!${blockTag}`,
                entityId: entity.id,
                entityName: entity.name,
                targetId: target.id,
                targetName: target.name,
                data: {
                  techniqueId: technique.id,
                  techniqueName: technique.name,
                  techniqueType: technique.type,
                  animStyle: technique.animStyle,
                  damage: dmg,
                  critical: techResult.critical,
                  blocked: techResult.blocked,
                  targetHp: target.hp,
                  casterX: entity.x,
                  casterZ: entity.y,
                  targetX: target.x,
                  targetZ: target.y,
                },
              });
            }
          } else if (technique.type === "buff" || technique.type === "healing") {
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "ability",
              tick: zone.tick,
              message: `${entity.name} casts ${technique.name}!`,
              entityId: entity.id,
              entityName: entity.name,
              data: {
                techniqueId: technique.id,
                techniqueName: technique.name,
                techniqueType: technique.type,
                animStyle: technique.animStyle,
                casterX: entity.x,
                casterZ: entity.y,
                targetX: entity.x,
                targetZ: entity.y,
              },
            });
          } else if (technique.type === "debuff") {
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "ability",
              tick: zone.tick,
              message: `${entity.name} casts ${technique.name} on ${target.name}!`,
              entityId: entity.id,
              entityName: entity.name,
              targetId: target.id,
              targetName: target.name,
              data: {
                techniqueId: technique.id,
                techniqueName: technique.name,
                techniqueType: technique.type,
                animStyle: technique.animStyle,
                casterX: entity.x,
                casterZ: entity.y,
                targetX: target.x,
                targetZ: target.y,
              },
            });
          }

          // Retaliation from target (same as basic attack, with resolveHit)
          if (technique.type === "attack" && !techResult.dodged && target.hp > 0 && canRetaliate(target)) {
            const retRaw = computeDamage(target, entity, zone.zoneId);
            const retHit = resolveHit(target, entity, retRaw);

            entity.lastCombatTick = zone.tick;
            target.lastCombatTick = zone.tick;

            if (retHit.dodged) {
              logZoneEvent({
                zoneId: zone.zoneId,
                type: "combat",
                tick: zone.tick,
                message: `${entity.name} dodges ${target.name}'s retaliation!`,
                entityId: target.id,
                entityName: target.name,
                targetId: entity.id,
                targetName: entity.name,
                data: { damage: 0, dodged: true, targetHp: entity.hp },
              });
            } else {
              const retTag = retHit.critical ? "CRITICAL! " : "";
              const retBlockTag = retHit.blocked ? " (blocked)" : "";
              logZoneEvent({
                zoneId: zone.zoneId,
                type: "combat",
                tick: zone.tick,
                message: `${retTag}${target.name} retaliates for ${retHit.finalDamage} damage!${retBlockTag}`,
                entityId: target.id,
                entityName: target.name,
                targetId: entity.id,
                targetName: entity.name,
                data: { damage: retHit.finalDamage, critical: retHit.critical, blocked: retHit.blocked, targetHp: entity.hp },
              });
              if (entity.hp <= 0) {
                logZoneEvent({
                  zoneId: zone.zoneId,
                  type: "death",
                  tick: zone.tick,
                  message: `${entity.name} has been slain by ${target.name}!`,
                  entityId: entity.id,
                  entityName: entity.name,
                  targetId: target.id,
                  targetName: target.name,
                });
                if (entity.type === "player") {
                  handlePlayerDeath(entity, zone.zoneId);
                  continue;
                } else {
                  await handleMobDeath(entity, target, zone);
                  continue;
                }
              }
            }
          }

          // Handle target death from technique damage
          if (target.hp <= 0) {
            // Resolve tagger: the player who first tagged the mob gets all rewards
            const techTagger = (target.taggedBy && target.taggedBy !== entity.id)
              ? zone.entities.get(target.taggedBy) : undefined;
            const techXpRecipient = (techTagger && techTagger.type === "player") ? techTagger : entity;

            logZoneEvent({
              zoneId: zone.zoneId,
              type: "kill",
              tick: zone.tick,
              message: `${techXpRecipient.name} has slain ${target.name}!`,
              entityId: techXpRecipient.id,
              entityName: techXpRecipient.name,
              targetId: target.id,
              targetName: target.name,
              data: { xpReward: target.xpReward ?? 0 },
            });

            if (techXpRecipient.type === "player") {
              techXpRecipient.kills = (techXpRecipient.kills ?? 0) + 1;

              // Log kill diary entry (technique path)
              if (techXpRecipient.walletAddress) {
                const { headline, narrative } = narrativeKill(techXpRecipient.name, techXpRecipient.raceId, techXpRecipient.classId, zone.zoneId, target.name, target.xpReward ?? 0);
                logDiary(techXpRecipient.walletAddress, techXpRecipient.name, zone.zoneId, techXpRecipient.x, techXpRecipient.y, "kill", headline, narrative, {
                  targetName: target.name,
                  targetType: target.type,
                  xpReward: target.xpReward ?? 0,
                });
              }
            }

            if (target.type === "player") {
              handlePlayerDeath(target, zone.zoneId);
            } else {
              await handleMobDeath(target, techXpRecipient, zone);
              if (techXpRecipient.type === "player" && techXpRecipient.activeQuests) {
                for (const activeQuest of techXpRecipient.activeQuests) {
                  const questDef = QUEST_CATALOG.find((q) => q.id === activeQuest.questId);
                  if (questDef && doesKillCountForQuest(questDef, target.type, target.name)) {
                    activeQuest.progress++;
                  }
                }
              }
            }

            entity.order = undefined;

            // Grant XP on kill — shared with party members in same zone
            awardPartyXp(zone, techXpRecipient, target.xpReward ?? 0, target.level);
          } else {
            // Technique fired — clear order so AI picks next action
            entity.order = undefined;
          }
        }
      }
    }

    // ── Entity separation pass: push overlapping entities apart ─────
    // Runs every tick so even stationary entities don't stack.
    const livingEntities: Entity[] = [];
    for (const e of zone.entities.values()) {
      if ((e.hp ?? 0) <= 0) continue;
      if (e.type === "flower-node" || e.type === "ore-node" ||
          e.type === "nectar-node" || e.type === "crop-node" || e.type === "corpse") continue;
      livingEntities.push(e);
    }
    // Run 3 passes for better convergence when many entities cluster
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < livingEntities.length; i++) {
        const a = livingEntities[i];
        for (let j = i + 1; j < livingEntities.length; j++) {
          const b = livingEntities[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const aMovable = MOVABLE_TYPES.has(a.type);
          const bMovable = MOVABLE_TYPES.has(b.type);
          if (!aMovable && !bMovable) continue; // both immovable, skip

          if (dist < ENTITY_COLLISION_RADIUS && dist > 0.01) {
            const overlap = ENTITY_COLLISION_RADIUS - dist;
            const nx = (dx / dist) * overlap;
            const ny = (dy / dist) * overlap;
            if (aMovable && bMovable) {
              // Both movable — split push equally
              a.x += nx * 0.5;
              a.y += ny * 0.5;
              b.x -= nx * 0.5;
              b.y -= ny * 0.5;
            } else if (aMovable) {
              // Only a moves — full push to a
              a.x += nx;
              a.y += ny;
            } else {
              // Only b moves — full push to b
              b.x -= nx;
              b.y -= ny;
            }
          } else if (dist <= 0.01) {
            // Exactly overlapping — nudge movable entity away
            if (aMovable) {
              a.x += ENTITY_COLLISION_RADIUS * 0.5;
              a.y += (i % 2 === 0 ? 1 : -1) * ENTITY_COLLISION_RADIUS * 0.3;
            }
            if (bMovable) {
              b.x -= ENTITY_COLLISION_RADIUS * 0.5;
              b.y += (i % 2 === 0 ? -1 : 1) * ENTITY_COLLISION_RADIUS * 0.3;
            }
          }
        }
      }
    }

    // ── Mob leash / de-aggro: mobs too far from spawn walk home ────
    // If a mob is pulled beyond its leash range, it de-aggros, drops
    // combat, and walks back to spawn. While leashing it regens HP
    // each tick and ignores players entirely.
    const MOB_LEASH_RANGE = 150;
    const BOSS_LEASH_RANGE = 200;
    const LEASH_REGEN_PCT = 0.05; // 5% maxHp per tick while walking home
    for (const entity of zone.entities.values()) {
      if (entity.type !== "mob" && entity.type !== "boss") continue;
      if (entity.hp <= 0) continue;
      if (entity.spawnX == null || entity.spawnY == null) continue;

      const dxSpawn = entity.x - entity.spawnX;
      const dySpawn = entity.y - entity.spawnY;
      const distFromSpawn = Math.sqrt(dxSpawn * dxSpawn + dySpawn * dySpawn);
      const leashRange = entity.type === "boss" ? BOSS_LEASH_RANGE : MOB_LEASH_RANGE;

      if (entity.leashing) {
        // Walking home — regen HP each tick
        entity.hp = Math.min(entity.maxHp, entity.hp + Math.ceil(entity.maxHp * LEASH_REGEN_PCT));
        // Clear any active effects picked up during combat
        if (entity.activeEffects?.length) entity.activeEffects = [];

        if (distFromSpawn < 5) {
          // Arrived home — fully reset
          entity.leashing = false;
          entity.hp = entity.maxHp;
          entity.x = entity.spawnX;
          entity.y = entity.spawnY;
          entity.order = undefined;
        } else {
          // Keep walking home
          entity.order = { action: "move", x: entity.spawnX, y: entity.spawnY };
        }
        continue;
      }

      // Check if mob has been pulled too far from spawn
      if (distFromSpawn > leashRange) {
        entity.leashing = true;
        entity.order = { action: "move", x: entity.spawnX, y: entity.spawnY };
        entity.taggedBy = undefined;
        entity.taggedAtTick = undefined;
        continue;
      }
    }

    // ── Mob roaming: idle mobs wander near their spawn point ─────────
    const MOB_ROAM_RADIUS = 50;
    const BOSS_ROAM_RADIUS = 30;
    const ROAM_CHANCE_PER_TICK = 0.03; // ~3% per tick (500ms) → wander roughly every ~17s
    for (const entity of zone.entities.values()) {
      if (entity.type !== "mob" && entity.type !== "boss") continue;
      if (entity.order) continue;
      if (entity.castingIntent) continue;
      if (entity.hp <= 0) continue;
      if (entity.leashing) continue;
      if (entity.spawnX == null || entity.spawnY == null) continue;
      if (Math.random() > ROAM_CHANCE_PER_TICK) continue;

      const roamRadius = entity.type === "boss" ? BOSS_ROAM_RADIUS : MOB_ROAM_RADIUS;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * roamRadius;
      const targetX = entity.spawnX + Math.cos(angle) * dist;
      const targetY = entity.spawnY + Math.sin(angle) * dist;
      entity.order = { action: "move", x: targetX, y: targetY };
    }

    // ── Mob aggro AI: mobs attack nearby players ─────────────────────
    // Mobs proactively seek and attack players within aggro range.
    // Bosses have larger aggro range. Mobs prefer their tagged target.
    const MOB_AGGRO_RANGE = 60;
    const BOSS_AGGRO_RANGE = 100;
    for (const entity of zone.entities.values()) {
      if (entity.type !== "mob" && entity.type !== "boss") continue;
      if (entity.order) continue;
      if (entity.castingIntent) continue;
      if (entity.hp <= 0) continue;
      if (entity.leashing) continue; // Don't re-aggro while walking home

      const aggroRange = entity.type === "boss" ? BOSS_AGGRO_RANGE : MOB_AGGRO_RANGE;

      // Prefer the player who tagged us (most recent attacker)
      let target: Entity | null = null;
      if (entity.taggedBy) {
        const tagged = zone.entities.get(entity.taggedBy);
        if (tagged && tagged.type === "player" && tagged.hp > 0) {
          const dx = tagged.x - entity.x;
          const dy = tagged.y - entity.y;
          if (Math.sqrt(dx * dx + dy * dy) < aggroRange * 1.5) {
            target = tagged;
          }
        }
      }

      // Otherwise find nearest player in aggro range
      if (!target) {
        let nearestDist = aggroRange;
        for (const other of zone.entities.values()) {
          if (other.type !== "player") continue;
          if (other.hp <= 0) continue;
          const dx = other.x - entity.x;
          const dy = other.y - entity.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist) {
            nearestDist = dist;
            target = other;
          }
        }
      }

      if (!target) continue;
      entity.order = { action: "attack", targetId: target.id };
    }

    // ── Party/rental follow-leader AI ────────────────────────────────
    // Idle party followers stay near the leader. Rentals can also opt in
    // explicitly via followLeaderId. Runs BEFORE auto-combat so: far from
    // leader → follow order → auto-combat skips; near leader + mob nearby →
    // no follow → auto-combat engages.
    const FOLLOW_DISTANCE = 60;
    const FOLLOW_STOP_DISTANCE = 30;
    for (const entity of zone.entities.values()) {
      if (entity.type !== "player") continue;
      if (entity.order) continue;
      if (entity.castingIntent) continue;
      if (entity.hp <= 0) continue;
      if (entity.travelTargetZone) continue;
      if (entity.gotoMode) continue;

      const leaderId = entity.followLeaderId ?? getPartyLeaderId(entity.id);
      if (!leaderId || leaderId === entity.id) continue;

      const partyId = getPlayerPartyId(entity.id);
      if (!entity.followLeaderId && !partyId) continue;

      const leader = getEntity(leaderId);
      if (!leader) continue;
      if (leader.type !== "player" || leader.hp <= 0) continue;

      // Zone follow: leader moved to a different region
      if (leader.region && leader.region !== entity.region) {
        entity.travelTargetZone = leader.region;
        // Move toward zone edge to trigger transition
        entity.order = { action: "move", x: leader.x, y: leader.y };
        continue;
      }

      // Position follow: stay close to leader within same zone
      const dx = leader.x - entity.x;
      const dy = leader.y - entity.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > FOLLOW_DISTANCE) {
        // Move toward leader but stop at FOLLOW_STOP_DISTANCE
        const ratio = (dist - FOLLOW_STOP_DISTANCE) / dist;
        entity.order = {
          action: "move",
          x: entity.x + dx * ratio,
          y: entity.y + dy * ratio,
        };
      }
    }

    // ── Player auto-combat AI: players pick techniques or basic attack ──
    // Only engages mobs within AUTO_COMBAT_RANGE so agents can walk to
    // portals, merchants, etc. without being hijacked.
    const BASE_AUTO_COMBAT_RANGE = 80;
    for (const entity of zone.entities.values()) {
      if (entity.type !== "player") continue;
      if (entity.order) continue;
      if (entity.castingIntent) continue;
      if (entity.hp <= 0) continue;
      // Skip players that are traveling to another zone
      if (entity.travelTargetZone) continue;
      // Skip players in goto mode (navigating to NPC — don't interrupt with combat)
      if (entity.gotoMode) continue;

      // Ranged classes scan further — auto-engage at their attack range + buffer
      const classRange = getEntityAttackRange(entity);
      const autoCombatRange = Math.max(BASE_AUTO_COMBAT_RANGE, classRange + 20);
      const nearestMob = pickAutoCombatTarget(entity, zone, autoCombatRange);

      // ── Edict evaluation (gambit system) ──────────────────────────
      // If the player has edicts configured, evaluate them first.
      // First match wins; if no match, fall through to default AI.
      const edicts = entity.walletAddress ? getEdictCache(entity.walletAddress) : undefined;
      if (edicts && edicts.length > 0) {
        const edictResult = evaluateEdicts(entity, zone, edicts, nearestMob ?? null);
        if (edictResult) {
          if (edictResult.order) {
            entity.order = edictResult.order as unknown as typeof entity.order;
            continue;
          }
          const eTarget = edictResult.targetOverride ?? nearestMob;
          if (!eTarget) continue;
          if (edictResult.techniqueOverride) {
            const techTarget = pickTechniqueTargetIdForAutoCombat(entity, eTarget, edictResult.techniqueOverride, zone);
            entity.order = { action: "technique", targetId: techTarget, techniqueId: edictResult.techniqueOverride.id };
          } else {
            entity.order = { action: "attack", targetId: eTarget.id };
          }
          continue;
        }
        // No edict matched — fall through to default AI below
      }

      if (!nearestMob) continue;

      // Pick the best technique from what the player has learned at trainers
      const chosenTech = pickTechnique(entity, nearestMob, zone);
      if (chosenTech) {
        const techTarget = pickTechniqueTargetIdForAutoCombat(entity, nearestMob, chosenTech, zone);
        entity.order = { action: "technique", targetId: techTarget, techniqueId: chosenTech.id };
      } else {
        // Fall back to basic attack
        entity.order = { action: "attack", targetId: nearestMob.id };
      }
    }

    // Respawn depleted resource nodes (ore, flower, nectar) — scatter to nearby position
    const NODE_SCATTER_RADIUS = 40;
    const NODE_TYPES: Record<string, number> = { "ore-node": 120, "flower-node": 100, "nectar-node": 150 };
    for (const entity of zone.entities.values()) {
      const defaultTicks = NODE_TYPES[entity.type];
      if (defaultTicks == null || entity.depletedAtTick == null) continue;
      const ticksSinceDepleted = zone.tick - entity.depletedAtTick;
      if (ticksSinceDepleted < (entity.respawnTicks ?? defaultTicks)) continue;

      entity.charges = entity.maxCharges;
      entity.depletedAtTick = undefined;

      // Scatter to a random position near original spawn
      if (entity.spawnX != null && entity.spawnY != null) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * NODE_SCATTER_RADIUS;
        entity.x = entity.spawnX + Math.cos(angle) * dist;
        entity.y = entity.spawnY + Math.sin(angle) * dist;
      }
    }

    // Respawn depleted crop nodes — growth speed varies by time of day
    const currentPhase = getGameTime(zone.tick).phase;
    for (const entity of zone.entities.values()) {
      if (entity.type === "crop-node" && entity.depletedAtTick != null) {
        const cropProps = entity.cropType ? CROP_CATALOG[entity.cropType as CropType] : null;
        const pref = cropProps?.preferredPhase ?? "any";
        const growthMult = GROWTH_MULTIPLIERS[pref][currentPhase];
        // Accumulate fractional growth progress instead of raw tick delta
        entity.growthProgress = (entity.growthProgress ?? 0) + growthMult;
        const required = entity.respawnTicks ?? 120;
        if (entity.growthProgress >= required) {
          entity.charges = entity.maxCharges;
          entity.depletedAtTick = undefined;
          entity.growthProgress = 0;
        }
      }
    }

    // Cleanup expired corpses
    const now = Date.now();
    const corpsesToRemove: string[] = [];
    for (const entity of zone.entities.values()) {
      if (entity.type === "corpse" && entity.skinnableUntil && now > entity.skinnableUntil) {
        corpsesToRemove.push(entity.id);
      }
    }
    for (const corpseId of corpsesToRemove) {
      zone.entities.delete(corpseId);
    }
  }

  // ── Automatic region recalculation (replaces zone transitions) ──────
  // Any movable combatant can cross zone boundaries now, so keep region
  // membership in sync with world-space position for both players and mobs.
  for (const entity of world.entities.values()) {
    if (!MOVABLE_TYPES.has(entity.type)) continue;

    const newRegion = getRegionAtPosition(entity.x, entity.y);

    // If an entity drifts into void space (outside all zone bounds), clamp it
    // back inside its current zone so zone-local combat/entity queries stay valid.
    if (!newRegion && entity.region) {
      clampToZoneBounds(entity, entity.region);
      continue;
    }
    if (!newRegion || newRegion === entity.region) continue;

    const oldRegion = entity.region ?? "unknown";
    entity.region = newRegion;

    if (entity.type === "player") {
      // Keep spawn registry in sync
      if (entity.walletAddress) updateSpawnedWalletZone(entity.walletAddress, newRegion);

      // Clear travel target if we arrived at our destination region
      if (entity.travelTargetZone === newRegion) {
        entity.travelTargetZone = undefined;
      }

      logZoneEvent({
        zoneId: oldRegion,
        type: "system",
        tick: world.tick,
        message: `${entity.name} departed to ${newRegion}`,
        entityId: entity.id,
        entityName: entity.name,
      });

      logZoneEvent({
        zoneId: newRegion,
        type: "system",
        tick: world.tick,
        message: `${entity.name} arrived from ${oldRegion}`,
        entityId: entity.id,
        entityName: entity.name,
      });

      if (entity.walletAddress) {
        const { headline, narrative } = narrativeZoneTransition(entity.name, entity.raceId, entity.classId, oldRegion, newRegion);
        logDiary(entity.walletAddress, entity.name, newRegion, entity.x, entity.y, "zone_transition", headline, narrative, {
          fromZone: oldRegion,
          toZone: newRegion,
        });
      }

      console.log(`[region] ${entity.name} crossed from ${oldRegion} to ${newRegion} at (${Math.round(entity.x)}, ${Math.round(entity.y)})`);
    }
  }

  // Tick arena matches (win conditions, hazards, timers)
  arenaManager.tickArenaMatches();
}

/**
 * Save all online players to Redis/memory. Used by periodic auto-save and graceful shutdown.
 */
export async function saveAllOnlinePlayers(): Promise<void> {
  let count = 0;
  for (const entity of world.entities.values()) {
    if (entity.type !== "player" || !entity.walletAddress || !entity.name) continue;
    try {
      await saveCharacter(entity.walletAddress, entity.name, {
        name: entity.name,
        level: entity.level ?? 1,
        xp: entity.xp ?? 0,
        ...(entity.characterTokenId != null && { characterTokenId: entity.characterTokenId.toString() }),
        ...(entity.agentId != null && { agentId: entity.agentId.toString() }),
        raceId: entity.raceId ?? "human",
        classId: entity.classId ?? "warrior",
        calling: entity.calling,
        gender: entity.gender,
        skinColor: entity.skinColor,
        hairStyle: entity.hairStyle,
        eyeColor: entity.eyeColor,
        origin: entity.origin,
        zone: entity.region ?? "village-square",
        x: entity.x,
        y: entity.y,
        kills: entity.kills ?? 0,
        activeQuests: entity.activeQuests ?? [],
        completedQuests: entity.completedQuests ?? [],
        storyFlags: entity.storyFlags ?? [],
        learnedTechniques: entity.learnedTechniques ?? [],
        professions: getLearnedProfessions(entity.walletAddress),
        pendingQuestApprovals: entity.pendingQuestApprovals ?? [],
        equipment: entity.equipment ?? undefined,
      });
      await persistLivePlayerEntity(entity);
      count++;
    } catch (err) {
      console.error(`[auto-save] Failed to save ${entity.name}:`, err);
    }
  }
  if (count > 0) {
    console.log(`[auto-save] Saved ${count} online player(s)`);
  }
}

export function registerZoneRuntime(server: FastifyInstance) {
  const configuredZoneIds = Object.keys(getWorldLayout().zones);
  for (const zoneId of configuredZoneIds) {
    getOrCreateZone(zoneId);
  }

  // Start the tick loop
  tickInterval = setInterval(worldTick, TICK_MS);

  // Periodic online-player checkpointing.
  autoSaveInterval = setInterval(() => {
    saveAllOnlinePlayers().catch((err) =>
      console.error("[auto-save] Periodic save error:", err)
    );
  }, PLAYER_PERSIST_INTERVAL_MS);

  server.addHook("onClose", async () => {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    if (tickInterval) clearInterval(tickInterval);
    // Flush all characters on graceful shutdown
    await saveAllOnlinePlayers();
    console.log("[shutdown] All online players saved");
  });

  console.log(`[auto-save] Online player checkpoints every ${PLAYER_PERSIST_INTERVAL_MS}ms`);

  server.get("/zones", async () => {
    const result: Record<string, { entityCount: number; tick: number }> = {};
    for (const id of configuredZoneIds) {
      const zone = getOrCreateZone(id);
      result[id] = { entityCount: zone.entities.size, tick: zone.tick };
    }
    return result;
  });

  server.get("/players/active", async () => {
    const players = Array.from(getAllEntities().entries())
      .filter(([, entity]) => entity.type === "player")
      .map(([id, entity]) => ({
        id,
        name: entity.name,
        level: entity.level ?? 1,
        hp: entity.hp,
        maxHp: entity.maxHp,
        classId: entity.classId,
        raceId: entity.raceId,
        walletAddress: entity.walletAddress ?? null,
        zoneId: entity.region ?? "unknown",
        x: entity.x,
        y: entity.y,
      }))
      .sort((a, b) => {
        const levelDiff = (b.level ?? 0) - (a.level ?? 0);
        if (levelDiff !== 0) return levelDiff;
        return a.name.localeCompare(b.name);
      });

    return {
      tick: world.tick,
      count: players.length,
      players,
    };
  });

  server.get<{ Params: { zoneId: string } }>(
    "/zones/:zoneId",
    async (request, reply) => {
      const zoneId = request.params.zoneId;
      if (!configuredZoneIds.includes(zoneId)) {
        reply.code(404);
        return { error: "Zone not found" };
      }
      const zone = getOrCreateZone(zoneId);
      const recentEvents = getRecentZoneEvents(zone.zoneId, Date.now() - 8000, ["ability", "combat", "death", "levelup", "technique", "chat", "quest", "quest-progress", "shop", "trade", "loot", "system"]);
      return {
        zoneId: zone.zoneId,
        tick: zone.tick,
        gameTime: getGameTime(zone.tick),
        entities: Object.fromEntries(
          Array.from(zone.entities.entries()).map(([id, entity]) => [
            id,
            toSerializableEntity(entity),
          ])
        ),
        visibleIntents: buildVisibleIntents(zone),
        recentEvents,
      };
    }
  );

  // Global game time endpoint
  server.get("/time", async () => {
    const gt = getGameTime(world.tick);
    return { tick: world.tick, gameTime: gt, formatted: formatGameTime(gt) };
  });
}
