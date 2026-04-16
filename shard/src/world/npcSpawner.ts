import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { getOrCreateZone, getEntity, type Entity } from "./zoneRuntime.js";
import type { ProfessionType } from "../professions/professions.js";
import type { CharacterStats } from "../character/classes.js";
import { statScale } from "../character/leveling.js";
import { getZoneOffset } from "./worldLayout.js";

/**
 * Static NPC definitions that auto-spawn when the shard boots.
 * Each NPC is placed in a specific zone at a fixed position.
 */
export interface NpcDef {
  zoneId: string;
  type: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  shopItems?: number[];
  level?: number;
  xpReward?: number;
  teachesProfession?: ProfessionType;
  teachesClass?: string;
}

// ── Humanoid NPC appearance generation ─────────────────────────────────
// NPCs with these types get random layered-sprite appearances so the
// client renders them with the same compositor used for player characters.

const HUMANOID_NPC_TYPES = new Set([
  "merchant", "quest-giver", "lore-npc", "guild-registrar",
  "auctioneer", "arena-master", "trainer", "profession-trainer",
]);

const NPC_SKINS   = ["fair", "light", "medium", "tan", "brown", "dark"];
const NPC_EYES    = ["brown", "blue", "green", "amber", "gray", "violet"];
const NPC_HAIRS   = ["short", "long", "braided", "mohawk", "ponytail", "bald"];

const TRADER_SHOP_ITEMS = [0, 1, 2, 4, 6, 7, 8, 10, 12, 13, 14, 15, 16, 27, 41, 76, 227];
const BLACKSMITH_SHOP_ITEMS = [
  3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115,
  224, 225, 226, 228, 229, 230,
  243, 244, 245, 246, 247, 248, 249,
];

// Female-presenting NPC names (used to assign gender for hair diversity)
const FEMALE_NAMES = new Set([
  "lysandra", "kira", "willow", "mirelle", "hilda", "elara",
  "seraphina", "velindra", "ashara", "ember", "lunara", "yuki",
  "zephyra", "freya", "althea", "mirabel", "selene", "ivy",
  "aurora", "brielle", "cassandra", "dahlia", "elena", "fiona",
  "gwendolyn", "iris", "jade", "kaela", "lilith", "nadia",
  "ophelia", "petra", "rosalind", "sylvia", "thalia", "una",
  "vivienne", "wren", "xena", "yara", "zara",
]);

/** Simple deterministic hash from NPC name → stable random seed */
function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pick<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

/** Infer gender from NPC name for appearance variety */
function inferGender(name: string): "male" | "female" {
  const lower = name.toLowerCase();
  for (const fem of FEMALE_NAMES) {
    if (lower.includes(fem)) return "female";
  }
  return "male";
}

/** Generate a deterministic random appearance for a humanoid NPC */
function randomNpcAppearance(name: string) {
  const h = nameHash(name);
  const gender = inferGender(name);
  return {
    gender,
    skinColor:  pick(NPC_SKINS, h),
    eyeColor:   pick(NPC_EYES, (h >>> 4)),
    hairStyle:  pick(NPC_HAIRS, (h >>> 8)),
  };
}

// ── Mob combat stats ────────────────────────────────────────────────
// Base stats for mobs (L1). Scaled by statScale(level) like player stats.
// Regular mobs are intentionally weaker than same-level players so solo
// progression stays viable; bosses retain a stronger multiplier.
const MOB_BASE_STATS = { str: 55, def: 40, agi: 30, int: 25, faith: 15, luck: 20 };
const REGULAR_MOB_STAT_MULT = 0.82;
const REGULAR_MOB_HP_MULT = 0.55;
const BOSS_STAT_MULT = 1.4;
const BOSS_HP_MULT = 0.75;

function getSpawnMobHp(baseHp: number, isBoss: boolean): number {
  const mult = isBoss ? BOSS_HP_MULT : REGULAR_MOB_HP_MULT;
  return Math.max(1, Math.round(baseHp * mult));
}

export function computeMobStats(level: number, hp: number, isBoss: boolean): CharacterStats {
  const scale = statScale(level);
  const mult = isBoss ? BOSS_STAT_MULT : REGULAR_MOB_STAT_MULT;
  const scaledHp = getSpawnMobHp(hp, isBoss);
  return {
    str:     Math.round(MOB_BASE_STATS.str * scale * mult),
    def:     Math.round(MOB_BASE_STATS.def * scale * mult),
    hp:      scaledHp,
    agi:     Math.round(MOB_BASE_STATS.agi * scale * mult),
    int:     Math.round(MOB_BASE_STATS.int * scale * mult),
    mp:      0,
    faith:   Math.round(MOB_BASE_STATS.faith * scale * mult),
    luck:    Math.round(MOB_BASE_STATS.luck * scale * mult),
    essence: 0,
  };
}

// ── NPC definitions (loaded from JSON) ──────────────────────────────────
// NPCs live in world/content/npcs/<zoneId>.json and are loaded at boot.
// The editor (worldofgeneva.com/map) can PUT updated JSONs via shard routes;
// reloadNpcsForZone() then despawns + respawns that zone's NPCs live.

function resolveNpcDir(): string {
  const prodPath = path.join(process.cwd(), "world", "content", "npcs");
  if (fs.existsSync(prodPath)) return prodPath;
  const devPath = path.join(process.cwd(), "..", "world", "content", "npcs");
  if (fs.existsSync(devPath)) return devPath;
  // Create dev path so PUT writes have somewhere to go
  fs.mkdirSync(devPath, { recursive: true });
  return devPath;
}

export interface NpcsFile {
  zoneId: string;
  npcs: Omit<NpcDef, "zoneId">[];
}

export function loadNpcsForZone(zoneId: string): NpcDef[] {
  const file = path.join(resolveNpcDir(), `${zoneId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as NpcsFile;
    if (!Array.isArray(data.npcs)) return [];
    return data.npcs.map((n) => ({ zoneId, ...n }));
  } catch (err) {
    console.warn(`[npcSpawner] Failed to load ${file}:`, err);
    return [];
  }
}

export function saveNpcsForZone(zoneId: string, npcs: Omit<NpcDef, "zoneId">[]): void {
  const dir = resolveNpcDir();
  const file = path.join(dir, `${zoneId}.json`);
  const data: NpcsFile = { zoneId, npcs };
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function loadAllNpcDefs(): NpcDef[] {
  const dir = resolveNpcDir();
  if (!fs.existsSync(dir)) return [];
  const defs: NpcDef[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const zoneId = entry.replace(/\.json$/, "");
    defs.push(...loadNpcsForZone(zoneId));
  }
  return defs;
}

/**
 * Mutable so reloadNpcsForZone can update entries in place and preserve
 * the binding for other modules (merchantAgent etc.) that import it.
 */
export const NPC_DEFS: NpcDef[] = loadAllNpcDefs();
console.log(`[npcSpawner] Loaded ${NPC_DEFS.length} NPC defs from disk`);

// Track spawned NPCs for respawning
const spawnedNpcIds = new Map<NpcDef, string>();

// Respawn delay tracking: NpcDef → timestamp when death was first detected
const pendingRespawns = new Map<NpcDef, number>();
const MOB_RESPAWN_DELAY_MS = 20_000; // 20 seconds
const MOB_RESPAWN_SCATTER_RADIUS = 40; // random offset from original spawn on respawn

// Track spawned NPCs by name for quest system
const npcIdsByName = new Map<string, string>();

export function getNpcIdByName(name: string): string | undefined {
  return npcIdsByName.get(name);
}

/**
 * Spawn all predefined NPCs into their zones.
 * Call once at shard startup, after registerZoneRuntime.
 */
export function spawnNpcs(): void {
  for (const def of NPC_DEFS) {
    spawnSingleNpc(def);
  }
}

function spawnSingleNpc(def: NpcDef, scatter = false): void {
  const zone = getOrCreateZone(def.zoneId);

  // Offset local coords to world-space
  const offset = getZoneOffset(def.zoneId) ?? { x: 0, z: 0 };
  let worldX = def.x + offset.x;
  let worldY = def.y + offset.z;

  const isCombatant = def.type === "mob" || def.type === "boss";
  const spawnHp = isCombatant ? getSpawnMobHp(def.hp, def.type === "boss") : def.hp;

  // On respawn, scatter mob to a random nearby position
  if (scatter && isCombatant) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * MOB_RESPAWN_SCATTER_RADIUS;
    worldX += Math.cos(angle) * dist;
    worldY += Math.sin(angle) * dist;
  }

  // Assign layered-sprite appearance to humanoid NPCs
  const appearance = HUMANOID_NPC_TYPES.has(def.type)
    ? randomNpcAppearance(def.name)
    : undefined;

  const entity: Entity = {
    id: randomUUID(),
    type: def.type,
    name: def.name,
    x: worldX,
    y: worldY,
    hp: spawnHp,
    maxHp: spawnHp,
    region: def.zoneId,
    createdAt: Date.now(),
    shopItems: def.shopItems,
    ...(def.level != null && { level: def.level }),
    ...(def.xpReward != null && { xpReward: def.xpReward }),
    ...(def.teachesProfession != null && { teachesProfession: def.teachesProfession }),
    ...(def.teachesClass != null && { teachesClass: def.teachesClass }),
    // Store spawn origin for leash/de-aggro (world-space)
    ...(isCombatant && { spawnX: worldX, spawnY: worldY }),
    // Give mobs/bosses real combat stats so they use the stat-based damage formula
    ...(isCombatant && def.level != null && {
      stats: computeMobStats(def.level, def.hp, def.type === "boss"),
    }),
    // Layered-sprite appearance for humanoid NPCs
    ...(appearance && {
      gender: appearance.gender,
      skinColor: appearance.skinColor,
      eyeColor: appearance.eyeColor,
      hairStyle: appearance.hairStyle,
    }),
  };

  // Pre-compute effective stats for mobs so combat uses them immediately
  if (isCombatant && entity.stats) {
    entity.effectiveStats = { ...entity.stats };
  }

  zone.entities.set(entity.id, entity);
  spawnedNpcIds.set(def, entity.id);
  npcIdsByName.set(def.name, entity.id);

  const professionInfo = def.teachesProfession ? ` (teaches ${def.teachesProfession})` : "";
  const classInfo = def.teachesClass ? ` (teaches ${def.teachesClass})` : "";
  console.log(
    `[npc] Spawned ${def.type} "${def.name}" in ${def.zoneId} at world(${worldX}, ${worldY})${professionInfo}${classInfo}`
  );
}

/**
 * Check for dead mobs and respawn them after a cooldown delay.
 * Call this periodically (e.g., every 5 seconds).
 */
export function tickMobRespawner(): void {
  const now = Date.now();

  // Snapshot entries to avoid mutation-during-iteration
  const entries = [...spawnedNpcIds.entries()];

  for (const [def, entityId] of entries) {
    // Only respawn mobs (skip merchants, NPCs, etc.)
    if (def.type !== "mob" && def.type !== "boss") continue;

    const entity = getEntity(entityId);

    if (entity) {
      // Mob is alive — clear any pending respawn timer
      if (pendingRespawns.has(def)) {
        pendingRespawns.delete(def);
      }
      continue;
    }

    // Mob is dead/missing — start or check respawn timer
    if (!pendingRespawns.has(def)) {
      pendingRespawns.set(def, now);
      console.log(`[respawn] ${def.name} in ${def.zoneId} died — respawn in ${MOB_RESPAWN_DELAY_MS / 1000}s`);
      continue;
    }

    const deathTime = pendingRespawns.get(def)!;
    if (now - deathTime >= MOB_RESPAWN_DELAY_MS) {
      console.log(`[respawn] Respawning ${def.name} in ${def.zoneId} (after ${((now - deathTime) / 1000).toFixed(1)}s)`);
      spawnSingleNpc(def, true);
      pendingRespawns.delete(def);
    }
  }
}

/**
 * Hot-reload NPCs for a single zone from disk. Called after the editor
 * PUTs an updated npcs/<zoneId>.json — despawns existing NPC entities in
 * that zone, updates NPC_DEFS in place, and respawns the fresh defs.
 * Returns the new NPC count for the zone.
 */
export function reloadNpcsForZone(zoneId: string): number {
  const zone = getOrCreateZone(zoneId);

  // Despawn existing NPC entities belonging to this zone and clean tracking maps
  const removedEntityIds = new Set<string>();
  for (const [def, entityId] of [...spawnedNpcIds.entries()]) {
    if (def.zoneId !== zoneId) continue;
    zone.entities.delete(entityId);
    removedEntityIds.add(entityId);
    spawnedNpcIds.delete(def);
    pendingRespawns.delete(def);
  }
  for (const [name, id] of [...npcIdsByName.entries()]) {
    if (removedEntityIds.has(id)) npcIdsByName.delete(name);
  }

  // Replace this zone's slice of NPC_DEFS in place (preserves import binding)
  const otherDefs = NPC_DEFS.filter((d) => d.zoneId !== zoneId);
  const freshDefs = loadNpcsForZone(zoneId);
  NPC_DEFS.length = 0;
  for (const d of otherDefs) NPC_DEFS.push(d);
  for (const d of freshDefs) NPC_DEFS.push(d);

  // Spawn the freshly loaded defs (new defs only — other zones are untouched)
  for (const def of freshDefs) {
    spawnSingleNpc(def);
  }

  console.log(`[npcSpawner] Hot-reloaded ${freshDefs.length} NPCs for zone ${zoneId}`);
  return freshDefs.length;
}
