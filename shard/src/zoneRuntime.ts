import type { FastifyInstance } from "fastify";
import type { CharacterStats } from "./classes.js";
import { getItemByTokenId, type ArmorSlot, type EquipmentSlot } from "./itemCatalog.js";
import { mintGold, mintItem, updateCharacterMetadata } from "./blockchain.js";
import { xpForLevel, MAX_LEVEL, computeStatsAtLevel } from "./leveling.js";
import type { OreType } from "./oreCatalog.js";
import { QUEST_CATALOG, doesKillCountForQuest } from "./questSystem.js";
import { type ProfessionType, getLearnedProfessions } from "./professions.js";
import type { FlowerType } from "./flowerCatalog.js";
import { logZoneEvent } from "./zoneEvents.js";
import { getLootTable, rollDrops, rollCopper } from "./lootTables.js";
import { saveCharacter } from "./characterStore.js";
import { getTechniquesByClass, getTechniqueById, type TechniqueDefinition } from "./techniques.js";
import { ensureEssenceTechniqueInitialized } from "./essenceTechniqueGenerator.js";
import { randomUUID } from "crypto";
import { getPlayerPartyId } from "./partySystem.js";
import { getCachedGuildName } from "./guildChain.js";
import {
  getAdjacentZone,
  clampToZoneBounds,
  ZONE_LEVEL_REQUIREMENTS,
} from "./worldLayout.js";
import { logDiary, narrativeDeath, narrativeKill, narrativeLevelUp, narrativeZoneTransition } from "./diary.js";

export interface ZoneState {
  zoneId: string;
  entities: Map<string, Entity>;
  tick: number;
}

export type Order =
  | { action: "move"; x: number; y: number }
  | { action: "attack"; targetId: string }
  | { action: "technique"; targetId: string; techniqueId: string };

export interface EquippedItemState {
  tokenId: number;
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
  /** Race identifier for stat recalc on level-up. */
  raceId?: string;
  /** Class identifier for stat recalc on level-up. */
  classId?: string;
  /** Character gender (players only). */
  gender?: "male" | "female";
  /** Live computed stats (players only). */
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
  /** Profession trainer fields. */
  teachesProfession?: ProfessionType;
  /** Active quests (players only). */
  activeQuests?: Array<{ questId: string; progress: number; startedAt: number }>;
  /** Completed quest IDs (players only) - used for quest chain prerequisites. */
  completedQuests?: string[];
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
    ...(entity.cooldowns && {
      cooldowns: Object.fromEntries(entity.cooldowns),
    }),
  };
}

// In-memory zone state — this is the living world
const zones = new Map<string, ZoneState>();

export function getOrCreateZone(zoneId: string): ZoneState {
  let zone = zones.get(zoneId);
  if (!zone) {
    zone = { zoneId, entities: new Map(), tick: 0 };
    zones.set(zoneId, zone);
  }
  return zone;
}

export function getAllZones(): Map<string, ZoneState> {
  return zones;
}

export function deleteZone(zoneId: string): boolean {
  return zones.delete(zoneId);
}

// Tick loop — advances the world every interval
let tickInterval: ReturnType<typeof setInterval> | null = null;
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 1000; // 1 tick per second
const MOVE_SPEED = 30; // units per tick
const ATTACK_RANGE = 40; // units
const MIN_DAMAGE = 3;
const FALLBACK_ATTACK = 15;
const ARMOR_SLOTS: ArmorSlot[] = [
  "chest",
  "legs",
  "boots",
  "helm",
  "shoulders",
  "gloves",
  "belt",
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
const OOC_REGEN_PERCENT = 0.03;    // 3% of maxHp per tick while out of combat

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

  const previousMaxHp = entity.maxHp > 0 ? entity.maxHp : effective.hp;
  const ratio = previousMaxHp > 0 ? entity.hp / previousMaxHp : 1;

  entity.maxHp = Math.max(1, effective.hp);
  entity.hp = Math.max(1, Math.min(entity.maxHp, Math.round(entity.maxHp * ratio)));
}

function getAttackPower(entity: Entity): number {
  const stats = entity.effectiveStats ?? getEffectiveStats(entity);
  if (stats) {
    return Math.max(
      5,
      Math.round(
        stats.str * 0.32 +
          stats.agi * 0.1 +
          stats.int * 0.22 +
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

function computeDamage(attacker: Entity, defender: Entity): number {
  const raw = getAttackPower(attacker) - getDefensePower(defender) * 0.35;
  return Math.max(MIN_DAMAGE, Math.round(raw));
}

function applyDurabilityLoss(entity: Entity, slots: EquipmentSlot[]): void {
  if (!entity.equipment) return;

  let changed = false;
  for (const slot of slots) {
    const equipped = entity.equipment[slot];
    if (!equipped || equipped.durability <= 0) continue;

    equipped.durability = Math.max(0, equipped.durability - 1);
    if (equipped.durability === 0) {
      equipped.broken = true;
    }
    changed = true;
  }

  if (changed) {
    recalculateEntityVitals(entity);
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
  // Clear mob tags owned by this player and reset combat state
  const zone = zones.get(zoneId);
  if (zone) clearMobTagsForPlayer(zone, player.id);
  player.lastCombatTick = undefined;

  // Apply death penalty: lose 10% of current XP (min 0)
  let deathXpLoss = 0;
  if (player.xp != null && player.xp > 0) {
    deathXpLoss = Math.floor(player.xp * DEATH_XP_LOSS_PERCENT);
    player.xp = Math.max(0, player.xp - deathXpLoss);
    console.log(`[death] ${player.name} lost ${deathXpLoss} XP (${player.xp} remaining)`);
  }

  // Teleport to graveyard spawn point
  const spawn = GRAVEYARD_SPAWNS[zoneId] ?? { x: 100, y: 100 };
  player.x = spawn.x;
  player.y = spawn.y;

  // Restore HP to full
  player.hp = player.maxHp;

  // Clear any pending orders
  player.order = undefined;

  // Clear all active effects and cooldowns on death
  player.activeEffects = [];
  player.cooldowns = undefined;

  // Recalculate vitals without buff/debuff modifiers
  recalculateEntityVitals(player);
  player.hp = player.maxHp;

  console.log(`[death] ${player.name} respawned at graveyard (${spawn.x}, ${spawn.y})`);

  // Log diary entry for player death
  if (player.walletAddress) {
    const { headline, narrative } = narrativeDeath(player.name, player.raceId, player.classId, zoneId, deathXpLoss);
    logDiary(player.walletAddress, player.name, zoneId, spawn.x, spawn.y, "death", headline, narrative, {
      xpLoss: deathXpLoss,
      respawnX: spawn.x,
      respawnY: spawn.y,
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

  // Auto-loot: mint gold + common drops to killer's wallet
  if (killer?.walletAddress && lootTable) {
    // Roll gold
    const copperAmount = rollCopper(lootTable.copperMin, lootTable.copperMax);
    mintGold(killer.walletAddress, copperAmount.toString()).catch((err) => {
      console.error(`[loot] Failed to mint ${copperAmount} copper to ${killer.walletAddress}:`, err);
    });

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

    if (autoDrops.length > 0 || copperAmount > 0) {
      console.log(
        `[loot] ${killer.name} auto-looted ${copperAmount}c + ${autoDrops.length} items from ${mob.name}`
      );
    }
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
 * Ensure an entity's learnedTechniques list includes everything they qualify
 * for by class + level. Called by the server-side auto-combat AI so that
 * server-controlled entities can actually use their spells.
 * (Real AI agents still learn techniques via POST /techniques/learn at trainers.)
 */
function ensureTechniquesForAutoCombat(entity: Entity): void {
  if (!entity.classId || !entity.level) return;
  const classTechniques = getTechniquesByClass(entity.classId);
  if (!entity.learnedTechniques) entity.learnedTechniques = [];
  const learned = new Set(entity.learnedTechniques);
  for (const tech of classTechniques) {
    if (tech.levelRequired <= entity.level && !learned.has(tech.id)) {
      entity.learnedTechniques.push(tech.id);
      learned.add(tech.id);
    }
  }

  // Auto-learn essence techniques for AI agents with wallets
  if (entity.walletAddress) {
    if (entity.level >= 15) {
      const sig = ensureEssenceTechniqueInitialized(entity.walletAddress, entity.classId, "signature");
      if (!learned.has(sig.id)) {
        entity.learnedTechniques.push(sig.id);
        learned.add(sig.id);
      }
    }
    if (entity.level >= 30) {
      const ult = ensureEssenceTechniqueInitialized(entity.walletAddress, entity.classId, "ultimate");
      if (!learned.has(ult.id)) {
        entity.learnedTechniques.push(ult.id);
        learned.add(ult.id);
      }
    }
  }
}

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
function pickTechnique(
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
    const buff = usable.find(t => t.type === "buff" && t.targetType === "self");
    if (buff) return buff;
  }

  // 2. Self-heal if low HP
  const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
  if (hpRatio < 0.4) {
    const heal = usable.find(t => t.type === "healing");
    if (heal) return heal;
  }

  // 3. Debuff on target if we haven't already debuffed them
  const hasDebuff = target.activeEffects?.some(
    e => (e.type === "debuff" || e.type === "dot") && e.casterId === entity.id,
  );
  if (!hasDebuff) {
    const debuff = usable.find(t => t.type === "debuff");
    if (debuff) return debuff;
  }

  // 4. Attack technique — pick highest damage multiplier
  const attacks = usable
    .filter(t => t.type === "attack")
    .sort((a, b) => (b.effects.damageMultiplier ?? 0) - (a.effects.damageMultiplier ?? 0));
  if (attacks.length > 0) return attacks[0];

  // 5. Nothing good — basic attack
  return null;
}

/**
 * Apply technique effects during the tick loop (mirrors techniqueRoutes.applyTechniqueEffects).
 * Returns { damage } for attack techniques.
 */
function applyTechniqueInCombat(
  caster: Entity,
  target: Entity,
  technique: TechniqueDefinition,
  zone: ZoneState,
): { damage?: number } {
  const { effects, type } = technique;
  const result: { damage?: number } = {};

  // Attack techniques
  if (type === "attack" && effects.damageMultiplier) {
    const stats = caster.effectiveStats ?? getEffectiveStats(caster);
    const isCaster = ["mage", "cleric", "warlock"].includes(caster.classId ?? "");
    const primaryStat = isCaster
      ? (stats?.int ?? caster.stats?.int ?? 10)
      : (stats?.str ?? caster.stats?.str ?? 10);
    const baseDmg = Math.floor(5 + primaryStat * 0.5);
    const damage = Math.floor(baseDmg * effects.damageMultiplier);

    if (effects.maxTargets && effects.maxTargets > 1) {
      // AoE — hit multiple targets
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
        applyDamageWithShield(t, damage);
      }
      result.damage = damage;
    } else {
      applyDamageWithShield(target, damage);
      result.damage = damage;
    }

    // Lifesteal
    if (effects.healAmount && type === "attack") {
      const heal = Math.floor(damage * (effects.healAmount / 100));
      caster.hp = Math.min(caster.maxHp, caster.hp + heal);
    }
  }

  // Healing techniques
  if (type === "healing" && effects.healAmount) {
    if (effects.duration && effects.duration > 0) {
      const totalHeal = Math.floor(target.maxHp * (effects.healAmount / 100));
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
      const healAmount = Math.floor(target.maxHp * (effects.healAmount / 100));
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

/** Add an active effect (same logic as techniqueRoutes, but accessible from zoneRuntime) */
function addActiveEffectInternal(entity: Entity, effect: ActiveEffect): void {
  if (!entity.activeEffects) entity.activeEffects = [];
  // Same technique refreshes (replaces), different techniques stack
  entity.activeEffects = entity.activeEffects.filter(e => e.techniqueId !== effect.techniqueId);
  entity.activeEffects.push(effect);
}

function moveToward(entity: Entity, tx: number, ty: number): boolean {
  const dx = tx - entity.x;
  const dy = ty - entity.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 5) return true; // arrived
  const step = Math.min(MOVE_SPEED, dist);
  entity.x += (dx / dist) * step;
  entity.y += (dy / dist) * step;
  return false;
}

async function worldTick() {
  for (const zone of zones.values()) {
    zone.tick++;

    // Regenerate essence for all player entities
    for (const entity of zone.entities.values()) {
      if (entity.type === "player" && entity.essence != null && entity.maxEssence != null) {
        // Regenerate 2% of max essence per tick (500ms), or 4% per second
        const regenAmount = Math.ceil(entity.maxEssence * 0.02);
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
      if (entity.lastCombatTick != null && zone.tick - entity.lastCombatTick < OOC_REGEN_DELAY_TICKS) continue;
      const healAmount = Math.max(1, Math.ceil(entity.maxHp * OOC_REGEN_PERCENT));
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
              await handleMobDeath(entity, dotKiller, zone);
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
      if (!entity.order) continue;

      if (entity.order.action === "move") {
        const arrived = moveToward(entity, entity.order.x, entity.order.y);
        if (arrived) entity.order = undefined;
      } else if (entity.order.action === "attack") {
        const target = zone.entities.get(entity.order.targetId);
        if (!target) {
          entity.order = undefined;
          continue;
        }
        const dx = target.x - entity.x;
        const dy = target.y - entity.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > ATTACK_RANGE) {
          moveToward(entity, target.x, target.y);
        } else {
          const dealt = computeDamage(entity, target);
          applyDamageWithShield(target, dealt);
          applyDurabilityLoss(entity, ["weapon", ...ARMOR_SLOTS]);
          applyDurabilityLoss(target, ["weapon", ...ARMOR_SLOTS]);

          // Mob tagging + combat tracking
          trySetMobTag(target, entity.id, entity.type, zone.tick);
          entity.lastCombatTick = zone.tick;
          target.lastCombatTick = zone.tick;

          // Log combat event
          logZoneEvent({
            zoneId: zone.zoneId,
            type: "combat",
            tick: zone.tick,
            message: `${entity.name} hits ${target.name} for ${dealt} damage!`,
            entityId: entity.id,
            entityName: entity.name,
            targetId: target.id,
            targetName: target.name,
            data: { damage: dealt, targetHp: target.hp },
          });

          // Basic retaliation: combatants trade hits while in range.
          if (target.hp > 0 && canRetaliate(target)) {
            const retaliation = computeDamage(target, entity);
            applyDamageWithShield(entity, retaliation);
            applyDurabilityLoss(target, ["weapon", ...ARMOR_SLOTS]);
            applyDurabilityLoss(entity, ["weapon", ...ARMOR_SLOTS]);

            // Update combat tracking for retaliation
            entity.lastCombatTick = zone.tick;
            target.lastCombatTick = zone.tick;

            // Log retaliation
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "combat",
              tick: zone.tick,
              message: `${target.name} retaliates for ${retaliation} damage!`,
              entityId: target.id,
              entityName: target.name,
              targetId: entity.id,
              targetName: entity.name,
              data: { damage: retaliation, targetHp: entity.hp },
            });
            if (entity.hp <= 0) {
              // Log death
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

              // Handle death based on entity type
              if (entity.type === "player") {
                handlePlayerDeath(entity, zone.zoneId);
                continue;
              } else {
                // Mobs/bosses: auto-loot + create corpse
                await handleMobDeath(entity, target, zone);
                continue;
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
                  }
                }
              }
            }

            entity.order = undefined;

            // Grant XP on kill to reward recipient (only if target was mob/boss, not player)
            const xpReward = target.xpReward ?? 0;
            if (xpReward > 0 && xpRecipient.level != null) {
              xpRecipient.xp = (xpRecipient.xp ?? 0) + xpReward;

              // Check for level-up(s)
              let leveled = false;
              while (xpRecipient.level < MAX_LEVEL && xpRecipient.xp >= xpForLevel(xpRecipient.level + 1)) {
                xpRecipient.level++;
                leveled = true;
              }

              if (leveled && xpRecipient.raceId && xpRecipient.classId) {
                const newStats = computeStatsAtLevel(xpRecipient.raceId, xpRecipient.classId, xpRecipient.level);
                xpRecipient.stats = newStats;
                recalculateEntityVitals(xpRecipient);

                // Log level-up event
                logZoneEvent({
                  zoneId: zone.zoneId,
                  type: "levelup",
                  tick: zone.tick,
                  message: `*** ${xpRecipient.name} reached level ${xpRecipient.level}! ***`,
                  entityId: xpRecipient.id,
                  entityName: xpRecipient.name,
                  data: { level: xpRecipient.level, xp: xpRecipient.xp },
                });

                // Log level-up diary entry
                if (xpRecipient.walletAddress) {
                  const { headline, narrative } = narrativeLevelUp(xpRecipient.name, xpRecipient.raceId, xpRecipient.classId, zone.zoneId, xpRecipient.level);
                  logDiary(xpRecipient.walletAddress, xpRecipient.name, zone.zoneId, xpRecipient.x, xpRecipient.y, "level_up", headline, narrative, {
                    newLevel: xpRecipient.level,
                    xp: xpRecipient.xp,
                  });
                }

                // Persist character to Redis on level-up
                if (xpRecipient.walletAddress && xpRecipient.name) {
                  saveCharacter(xpRecipient.walletAddress, xpRecipient.name, {
                    level: xpRecipient.level,
                    xp: xpRecipient.xp,
                    zone: zone.zoneId,
                    x: xpRecipient.x,
                    y: xpRecipient.y,
                    kills: xpRecipient.kills,
                  }).catch((err) => console.error(`[persistence] Save failed for ${xpRecipient.id}:`, err));
                }

                // Async on-chain sync (non-blocking, only if NFT character)
                if (xpRecipient.characterTokenId != null) {
                  updateCharacterMetadata(xpRecipient as Required<Pick<Entity, 'characterTokenId' | 'name' | 'raceId' | 'classId' | 'level' | 'xp' | 'stats'>>)
                    .catch((err) => console.error(`NFT update failed for ${xpRecipient.id}:`, err));
                }
              }
            }
          }
        }
      } else if (entity.order.action === "technique") {
        // ── Technique order processing ─────────────────────────────
        const target = zone.entities.get(entity.order.targetId);
        const technique = getTechniqueById(entity.order.techniqueId);
        if (!target || !technique) {
          entity.order = undefined;
          continue;
        }
        const dx = target.x - entity.x;
        const dy = target.y - entity.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > ATTACK_RANGE) {
          moveToward(entity, target.x, target.y);
        } else {
          // Deduct essence
          const currentEssence = entity.essence ?? 0;
          entity.essence = Math.max(0, currentEssence - technique.essenceCost);

          // Set cooldown
          if (!entity.cooldowns) entity.cooldowns = new Map();
          entity.cooldowns.set(technique.id, zone.tick + technique.cooldown);

          // Apply technique effects inline (mirrors techniqueRoutes logic)
          const techResult = applyTechniqueInCombat(entity, target, technique, zone);

          // Mob tagging + combat tracking for attack techniques
          if (technique.type === "attack") {
            trySetMobTag(target, entity.id, entity.type, zone.tick);
            entity.lastCombatTick = zone.tick;
            target.lastCombatTick = zone.tick;
          }

          // Log the technique use
          if (technique.type === "attack") {
            const dmg = techResult.damage ?? 0;
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "combat",
              tick: zone.tick,
              message: `${entity.name} casts ${technique.name} on ${target.name} for ${dmg} damage!`,
              entityId: entity.id,
              entityName: entity.name,
              targetId: target.id,
              targetName: target.name,
              data: { damage: dmg, technique: technique.name, targetHp: target.hp },
            });
          } else if (technique.type === "buff" || technique.type === "healing") {
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "combat",
              tick: zone.tick,
              message: `${entity.name} casts ${technique.name}!`,
              entityId: entity.id,
              entityName: entity.name,
              data: { technique: technique.name },
            });
          } else if (technique.type === "debuff") {
            logZoneEvent({
              zoneId: zone.zoneId,
              type: "combat",
              tick: zone.tick,
              message: `${entity.name} casts ${technique.name} on ${target.name}!`,
              entityId: entity.id,
              entityName: entity.name,
              targetId: target.id,
              targetName: target.name,
              data: { technique: technique.name },
            });
          }

          // Retaliation from target (same as basic attack)
          if (technique.type === "attack" && target.hp > 0 && canRetaliate(target)) {
            const retaliation = computeDamage(target, entity);
            applyDamageWithShield(entity, retaliation);

            // Update combat tracking for retaliation
            entity.lastCombatTick = zone.tick;
            target.lastCombatTick = zone.tick;

            logZoneEvent({
              zoneId: zone.zoneId,
              type: "combat",
              tick: zone.tick,
              message: `${target.name} retaliates for ${retaliation} damage!`,
              entityId: target.id,
              entityName: target.name,
              targetId: entity.id,
              targetName: entity.name,
              data: { damage: retaliation, targetHp: entity.hp },
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

            // Grant XP on kill to reward recipient
            const xpReward = target.xpReward ?? 0;
            if (xpReward > 0 && techXpRecipient.level != null) {
              techXpRecipient.xp = (techXpRecipient.xp ?? 0) + xpReward;
              let leveled = false;
              while (techXpRecipient.level < MAX_LEVEL && techXpRecipient.xp >= xpForLevel(techXpRecipient.level + 1)) {
                techXpRecipient.level++;
                leveled = true;
              }
              if (leveled && techXpRecipient.raceId && techXpRecipient.classId) {
                const newStats = computeStatsAtLevel(techXpRecipient.raceId, techXpRecipient.classId, techXpRecipient.level);
                techXpRecipient.stats = newStats;
                recalculateEntityVitals(techXpRecipient);
                logZoneEvent({
                  zoneId: zone.zoneId,
                  type: "levelup",
                  tick: zone.tick,
                  message: `*** ${techXpRecipient.name} reached level ${techXpRecipient.level}! ***`,
                  entityId: techXpRecipient.id,
                  entityName: techXpRecipient.name,
                  data: { level: techXpRecipient.level, xp: techXpRecipient.xp },
                });

                // Log level-up diary entry (technique path)
                if (techXpRecipient.walletAddress) {
                  const { headline, narrative } = narrativeLevelUp(techXpRecipient.name, techXpRecipient.raceId, techXpRecipient.classId, zone.zoneId, techXpRecipient.level);
                  logDiary(techXpRecipient.walletAddress, techXpRecipient.name, zone.zoneId, techXpRecipient.x, techXpRecipient.y, "level_up", headline, narrative, {
                    newLevel: techXpRecipient.level,
                    xp: techXpRecipient.xp,
                  });
                }

                if (techXpRecipient.characterTokenId != null) {
                  updateCharacterMetadata(techXpRecipient as Required<Pick<Entity, 'characterTokenId' | 'name' | 'raceId' | 'classId' | 'level' | 'xp' | 'stats'>>)
                    .catch((err) => console.error(`NFT update failed for ${techXpRecipient.id}:`, err));
                }
              }
            }
          } else {
            // Technique fired — clear order so AI picks next action
            entity.order = undefined;
          }
        }
      }
    }

    // ── Clamp mobs to zone bounds (mobs don't transition) ──────────
    for (const entity of zone.entities.values()) {
      if (entity.type === "mob" || entity.type === "boss") {
        clampToZoneBounds(entity, zone.zoneId);
      }
    }

    // Smart auto-combat AI: players pick techniques or basic attack
    for (const entity of zone.entities.values()) {
      if (entity.type !== "player") continue;
      if (entity.order) continue;
      if (entity.hp <= 0) continue;

      // Find nearest mob
      let nearestMob: Entity | null = null;
      let nearestDist = Infinity;
      for (const other of zone.entities.values()) {
        if (other.type !== "mob" && other.type !== "boss") continue;
        if (other.hp <= 0) continue;
        const dx = other.x - entity.x;
        const dy = other.y - entity.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestMob = other;
        }
      }

      if (!nearestMob) continue;

      // Auto-grant qualifying techniques for server-controlled auto-combat
      ensureTechniquesForAutoCombat(entity);

      // Try to pick a technique
      const chosenTech = pickTechnique(entity, nearestMob, zone);
      if (chosenTech) {
        const techTarget = chosenTech.targetType === "self" ? entity.id : nearestMob.id;
        entity.order = { action: "technique", targetId: techTarget, techniqueId: chosenTech.id };
      } else {
        // Fall back to basic attack
        entity.order = { action: "attack", targetId: nearestMob.id };
      }
    }

    // Respawn depleted ore nodes
    for (const entity of zone.entities.values()) {
      if (entity.type === "ore-node" && entity.depletedAtTick != null) {
        const ticksSinceDepleted = zone.tick - entity.depletedAtTick;
        if (ticksSinceDepleted >= (entity.respawnTicks ?? 120)) {
          entity.charges = entity.maxCharges;
          entity.depletedAtTick = undefined;
        }
      }
    }

    // Respawn depleted flower nodes
    for (const entity of zone.entities.values()) {
      if (entity.type === "flower-node" && entity.depletedAtTick != null) {
        const ticksSinceDepleted = zone.tick - entity.depletedAtTick;
        if (ticksSinceDepleted >= (entity.respawnTicks ?? 100)) {
          entity.charges = entity.maxCharges;
          entity.depletedAtTick = undefined;
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

  // ── Seamless zone transitions (after all zones tick) ──────────────
  const transfers: Array<{
    entity: Entity;
    sourceZoneId: string;
    dest: { destZoneId: string; destLocalX: number; destLocalZ: number };
  }> = [];

  for (const zone of zones.values()) {
    for (const entity of zone.entities.values()) {
      if (entity.type !== "player") continue;

      const dest = getAdjacentZone(zone.zoneId, entity.x, entity.y);
      if (!dest) continue;

      // Level check — clamp if too low
      const requiredLevel = ZONE_LEVEL_REQUIREMENTS[dest.destZoneId] ?? 1;
      if ((entity.level ?? 1) < requiredLevel) {
        clampToZoneBounds(entity, zone.zoneId);
        entity.order = undefined;
        continue;
      }

      transfers.push({ entity, sourceZoneId: zone.zoneId, dest });
    }
  }

  for (const { entity, sourceZoneId, dest } of transfers) {
    const srcZone = zones.get(sourceZoneId);
    if (!srcZone) continue;

    // Clear mob tags in source zone and reset combat state
    clearMobTagsForPlayer(srcZone, entity.id);
    entity.lastCombatTick = undefined;

    srcZone.entities.delete(entity.id);
    entity.x = dest.destLocalX;
    entity.y = dest.destLocalZ;
    entity.order = undefined;

    const destZone = getOrCreateZone(dest.destZoneId);
    destZone.entities.set(entity.id, entity);

    logZoneEvent({
      zoneId: sourceZoneId,
      type: "system",
      tick: srcZone.tick,
      message: `${entity.name} departed to ${dest.destZoneId}`,
      entityId: entity.id,
      entityName: entity.name,
    });

    logZoneEvent({
      zoneId: dest.destZoneId,
      type: "system",
      tick: destZone.tick,
      message: `${entity.name} arrived from ${sourceZoneId}`,
      entityId: entity.id,
      entityName: entity.name,
    });

    // Log zone transition diary entry
    if (entity.walletAddress) {
      const { headline, narrative } = narrativeZoneTransition(entity.name, entity.raceId, entity.classId, sourceZoneId, dest.destZoneId);
      logDiary(entity.walletAddress, entity.name, dest.destZoneId, entity.x, entity.y, "zone_transition", headline, narrative, {
        fromZone: sourceZoneId,
        toZone: dest.destZoneId,
      });
    }

    console.log(
      `[transition] ${entity.name} moved from ${sourceZoneId} to ${dest.destZoneId} at (${dest.destLocalX}, ${dest.destLocalZ})`
    );
  }
}

/**
 * Save all online players to Redis/memory. Used by periodic auto-save and graceful shutdown.
 */
export async function saveAllOnlinePlayers(): Promise<void> {
  let count = 0;
  for (const zone of zones.values()) {
    for (const entity of zone.entities.values()) {
      if (entity.type !== "player" || !entity.walletAddress || !entity.name) continue;
      try {
        await saveCharacter(entity.walletAddress, entity.name, {
          name: entity.name,
          level: entity.level ?? 1,
          xp: entity.xp ?? 0,
          raceId: entity.raceId ?? "human",
          classId: entity.classId ?? "warrior",
          gender: entity.gender,
          zone: zone.zoneId,
          x: entity.x,
          y: entity.y,
          kills: entity.kills ?? 0,
          completedQuests: entity.completedQuests ?? [],
          learnedTechniques: entity.learnedTechniques ?? [],
          professions: getLearnedProfessions(entity.walletAddress),
        });
        count++;
      } catch (err) {
        console.error(`[auto-save] Failed to save ${entity.name}:`, err);
      }
    }
  }
  if (count > 0) {
    console.log(`[auto-save] Saved ${count} online player(s)`);
  }
}

export function registerZoneRuntime(server: FastifyInstance) {
  // Start the tick loop
  tickInterval = setInterval(worldTick, TICK_MS);

  // Periodic auto-save every 60 seconds
  autoSaveInterval = setInterval(() => {
    saveAllOnlinePlayers().catch((err) =>
      console.error("[auto-save] Periodic save error:", err)
    );
  }, 60_000);

  server.addHook("onClose", async () => {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    if (tickInterval) clearInterval(tickInterval);
    // Flush all characters on graceful shutdown
    await saveAllOnlinePlayers();
    console.log("[shutdown] All online players saved");
  });

  server.get("/zones", async () => {
    const result: Record<string, { entityCount: number; tick: number }> = {};
    for (const [id, zone] of zones) {
      result[id] = { entityCount: zone.entities.size, tick: zone.tick };
    }
    return result;
  });

  server.get<{ Params: { zoneId: string } }>(
    "/zones/:zoneId",
    async (request, reply) => {
      const zone = zones.get(request.params.zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }
      return {
        zoneId: zone.zoneId,
        tick: zone.tick,
        entities: Object.fromEntries(
          Array.from(zone.entities.entries()).map(([id, entity]) => [
            id,
            toSerializableEntity(entity),
          ])
        ),
      };
    }
  );
}
