import type { FastifyInstance } from "fastify";
import type { CharacterStats } from "../character/classes.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { generateWeaponName, type GeneratedWeaponName } from "./weaponNameGenerator.js";
import { randomUUID } from "crypto";
import { getRedis } from "../redis.js";

// ── Quality Tiers ──────────────────────────────────────────────────────

export type QualityTier = "common" | "uncommon" | "rare" | "epic";

export interface QualityRoll {
  tier: QualityTier;
  statMultiplier: number;
  displayPrefix: string;
  color: string;
}

const QUALITY_TABLE: Array<{
  tier: QualityTier;
  chance: number;
  minMult: number;
  maxMult: number;
  prefix: string;
  color: string;
}> = [
  { tier: "epic", chance: 0.03, minMult: 1.25, maxMult: 1.5, prefix: "Legendary", color: "#a855f7" },
  { tier: "rare", chance: 0.12, minMult: 1.1, maxMult: 1.25, prefix: "Superior", color: "#3b82f6" },
  { tier: "uncommon", chance: 0.25, minMult: 1.0, maxMult: 1.1, prefix: "Fine", color: "#22c55e" },
  { tier: "common", chance: 0.6, minMult: 0.9, maxMult: 1.0, prefix: "", color: "#9ca3af" },
];

export function rollQuality(): QualityRoll {
  const roll = Math.random();
  let cumulative = 0;

  for (const entry of QUALITY_TABLE) {
    cumulative += entry.chance;
    if (roll < cumulative) {
      const statMultiplier = entry.minMult + Math.random() * (entry.maxMult - entry.minMult);
      return {
        tier: entry.tier,
        statMultiplier,
        displayPrefix: entry.prefix,
        color: entry.color,
      };
    }
  }

  // Fallback to common
  const common = QUALITY_TABLE[QUALITY_TABLE.length - 1];
  return {
    tier: "common",
    statMultiplier: common.minMult + Math.random() * (common.maxMult - common.minMult),
    displayPrefix: "",
    color: common.color,
  };
}

// ── Stat Rolling ───────────────────────────────────────────────────────

export function rollStats(
  baseStats: Partial<CharacterStats>,
  quality: QualityRoll
): Partial<CharacterStats> {
  const rolled: Partial<CharacterStats> = {};

  for (const [key, value] of Object.entries(baseStats)) {
    if (value == null || value === 0) continue;
    // ±15% variance, then multiply by quality multiplier
    const variance = 1 + (Math.random() * 0.3 - 0.15); // 0.85 to 1.15
    const finalValue = Math.round(value * variance * quality.statMultiplier);
    (rolled as Record<string, number>)[key] = Math.max(1, finalValue);
  }

  return rolled;
}

// ── Bonus Affixes ──────────────────────────────────────────────────────

export interface BonusAffix {
  id: string;
  name: string;
  statBonuses: Partial<CharacterStats>;
  specialEffect?: string;
  weight: number;
  applicableTo: Array<"weapon" | "armor">;
}

const BONUS_AFFIXES: BonusAffix[] = [
  // Defensive
  { id: "bear", name: "of the Bear", statBonuses: { hp: 8, def: 3 }, weight: 10, applicableTo: ["weapon", "armor"] },
  { id: "turtle", name: "of the Turtle", statBonuses: { def: 6, hp: 4 }, weight: 8, applicableTo: ["armor"] },
  { id: "fortitude", name: "of Fortitude", statBonuses: { hp: 12 }, weight: 7, applicableTo: ["armor"] },
  // Offensive
  { id: "tiger", name: "of the Tiger", statBonuses: { str: 5, agi: 3 }, weight: 10, applicableTo: ["weapon", "armor"] },
  { id: "swiftness", name: "of Swiftness", statBonuses: { agi: 6 }, weight: 8, applicableTo: ["weapon", "armor"] },
  // Magic
  { id: "owl", name: "of the Owl", statBonuses: { int: 5, mp: 4 }, weight: 8, applicableTo: ["weapon", "armor"] },
  { id: "devotion", name: "of Devotion", statBonuses: { faith: 5, hp: 3 }, weight: 6, applicableTo: ["weapon", "armor"] },
  // Special
  { id: "vampiric", name: "Vampiric", statBonuses: {}, specialEffect: "heals 3% damage dealt", weight: 3, applicableTo: ["weapon"] },
  { id: "thundering", name: "Thundering", statBonuses: {}, specialEffect: "10% chain lightning", weight: 3, applicableTo: ["weapon"] },
  { id: "lucky", name: "Lucky", statBonuses: { luck: 5 }, weight: 5, applicableTo: ["weapon", "armor"] },
];

const AFFIX_CHANCE = 0.2; // 20% chance to roll a bonus affix

export function rollBonusAffix(category: "weapon" | "armor"): BonusAffix | undefined {
  if (Math.random() > AFFIX_CHANCE) return undefined;

  const eligible = BONUS_AFFIXES.filter((a) => a.applicableTo.includes(category));
  if (eligible.length === 0) return undefined;

  const totalWeight = eligible.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const affix of eligible) {
    roll -= affix.weight;
    if (roll <= 0) return affix;
  }

  return eligible[eligible.length - 1];
}

// ── Durability Rolling ─────────────────────────────────────────────────

export function rollDurability(baseMax: number): number {
  // ±20% variance on catalog maxDurability
  const variance = 1 + (Math.random() * 0.4 - 0.2); // 0.80 to 1.20
  return Math.max(1, Math.round(baseMax * variance));
}

// ── Crafted Item Instance ──────────────────────────────────────────────

export interface CraftedItemInstance {
  instanceId: string;
  baseTokenId: number;
  quality: QualityRoll;
  rolledStats: Partial<CharacterStats>;
  bonusAffix?: {
    id: string;
    name: string;
    statBonuses: Partial<CharacterStats>;
    specialEffect?: string;
  };
  rolledMaxDurability: number;
  craftedBy: string; // wallet address
  ownerWallet: string; // current owner wallet or auction:<id> escrow key
  craftedAt: number; // timestamp
  recipeId: string;
  displayName: string;
  currentDurability: number;
  currentMaxDurability: number;
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
  /** Expanded procedural name components (null for non-weapon items) */
  generatedName?: GeneratedWeaponName;
}

// ── In-Memory Registry ─────────────────────────────────────────────────

const instanceRegistry = new Map<string, CraftedItemInstance>();
const walletIndex = new Map<string, string[]>(); // wallet → instanceId[]
const INSTANCE_IDS_KEY = "itemrng:instances";
const INSTANCE_KEY_PREFIX = "itemrng:instance:";
const OWNER_KEY_PREFIX = "itemrng:owner:";

function normalizeOwnerKey(owner: string | undefined): string {
  return (owner ?? "").trim().toLowerCase();
}

function addInstanceToOwnerIndex(owner: string | undefined, instanceId: string): void {
  const key = normalizeOwnerKey(owner);
  if (!key) return;
  const ids = walletIndex.get(key) ?? [];
  if (!ids.includes(instanceId)) ids.push(instanceId);
  walletIndex.set(key, ids);
}

function removeInstanceFromOwnerIndex(owner: string | undefined, instanceId: string): void {
  const key = normalizeOwnerKey(owner);
  if (!key) return;
  const ids = walletIndex.get(key) ?? [];
  const next = ids.filter((id) => id !== instanceId);
  if (next.length > 0) walletIndex.set(key, next);
  else walletIndex.delete(key);
}

function hydrateInstance(raw: CraftedItemInstance): CraftedItemInstance {
  return {
    ...raw,
    craftedBy: normalizeOwnerKey(raw.craftedBy),
    ownerWallet: normalizeOwnerKey(raw.ownerWallet || raw.craftedBy),
  };
}

async function persistInstanceToRedis(instance: CraftedItemInstance, previousOwner?: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const ownerKey = normalizeOwnerKey(instance.ownerWallet);
  const prevKey = normalizeOwnerKey(previousOwner);
  const payload = JSON.stringify(instance);
  const tx = redis.multi();
  tx.sadd(INSTANCE_IDS_KEY, instance.instanceId);
  tx.set(`${INSTANCE_KEY_PREFIX}${instance.instanceId}`, payload);
  if (ownerKey) tx.sadd(`${OWNER_KEY_PREFIX}${ownerKey}`, instance.instanceId);
  if (prevKey && prevKey !== ownerKey) tx.srem(`${OWNER_KEY_PREFIX}${prevKey}`, instance.instanceId);
  await tx.exec();
}

async function removeInstanceFromRedis(instance: CraftedItemInstance): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const ownerKey = normalizeOwnerKey(instance.ownerWallet);
  const tx = redis.multi();
  tx.del(`${INSTANCE_KEY_PREFIX}${instance.instanceId}`);
  tx.srem(INSTANCE_IDS_KEY, instance.instanceId);
  if (ownerKey) tx.srem(`${OWNER_KEY_PREFIX}${ownerKey}`, instance.instanceId);
  await tx.exec();
}

function persistInstanceEventually(instance: CraftedItemInstance, previousOwner?: string): void {
  void persistInstanceToRedis(instance, previousOwner).catch((err) => {
    console.warn(`[itemRng] Failed to persist instance ${instance.instanceId}:`, err);
  });
}

function removeInstanceEventually(instance: CraftedItemInstance): void {
  void removeInstanceFromRedis(instance).catch((err) => {
    console.warn(`[itemRng] Failed to remove instance ${instance.instanceId}:`, err);
  });
}

async function restoreInstancesFromRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const ids = await redis.smembers(INSTANCE_IDS_KEY);
    if (!Array.isArray(ids) || ids.length === 0) return;
    const keys = ids.map((id: string) => `${INSTANCE_KEY_PREFIX}${id}`);
    const payloads = await redis.mget(keys);

    for (let i = 0; i < ids.length; i++) {
      const raw = payloads?.[i];
      if (!raw) continue;
      try {
        const parsed = hydrateInstance(JSON.parse(raw) as CraftedItemInstance);
        instanceRegistry.set(parsed.instanceId, parsed);
        addInstanceToOwnerIndex(parsed.ownerWallet, parsed.instanceId);
      } catch (err) {
        console.warn(`[itemRng] Failed to restore instance ${ids[i]}:`, err);
      }
    }
  } catch (err) {
    console.warn("[itemRng] Failed to restore instances from Redis:", err);
  }
}

function qualityRollFromTier(tier?: string): QualityRoll {
  switch (tier) {
    case "epic":
      return { tier: "epic", statMultiplier: 1.35, displayPrefix: "Legendary", color: "#a855f7" };
    case "rare":
      return { tier: "rare", statMultiplier: 1.18, displayPrefix: "Superior", color: "#3b82f6" };
    case "uncommon":
      return { tier: "uncommon", statMultiplier: 1.05, displayPrefix: "Fine", color: "#22c55e" };
    default:
      return { tier: "common", statMultiplier: 1, displayPrefix: "", color: "#9ca3af" };
  }
}

export function rollCraftedItem(params: {
  baseTokenId: bigint;
  recipeId: string;
  craftedBy: string;
}): CraftedItemInstance | null {
  const item = getItemByTokenId(params.baseTokenId);
  if (!item) return null;

  // Only weapons and armor get rolls
  if (item.category !== "weapon" && item.category !== "armor") return null;

  const quality = rollQuality();
  const rolledStats = item.statBonuses
    ? rollStats(item.statBonuses, quality)
    : {};
  const affix = rollBonusAffix(item.category);
  const rolledMaxDurability = item.maxDurability
    ? rollDurability(item.maxDurability)
    : 100;

  // Build display name using the expanded weapon name generator
  // Formula: [Prefix] + [Base Weapon] + [Suffix] + [Affix]
  // e.g. "Voidforged Claymore of Eternal Ruin" or "Rusty Dagger of the Bear"
  const generated = item.category === "weapon"
    ? generateWeaponName(Number(params.baseTokenId), quality.tier)
    : null;

  let displayName: string;
  if (generated) {
    // Procedural name: attach affix after the generated suffix
    const affixPart = affix ? ` ${affix.name}` : "";
    displayName = generated.displayName + affixPart;
  } else {
    // Fallback for armor / non-weapon items: original simple logic
    const prefix = quality.displayPrefix ? `${quality.displayPrefix} ` : "";
    const suffix = affix ? ` ${affix.name}` : "";
    displayName = `${prefix}${item.name}${suffix}`;
  }

  const instance: CraftedItemInstance = {
    instanceId: randomUUID(),
    baseTokenId: Number(params.baseTokenId),
    quality,
    rolledStats,
    bonusAffix: affix
      ? {
          id: affix.id,
          name: affix.name,
          statBonuses: affix.statBonuses,
          specialEffect: affix.specialEffect,
        }
      : undefined,
    rolledMaxDurability,
    craftedBy: params.craftedBy.toLowerCase(),
    ownerWallet: params.craftedBy.toLowerCase(),
    craftedAt: Date.now(),
    recipeId: params.recipeId,
    displayName,
    currentDurability: rolledMaxDurability,
    currentMaxDurability: rolledMaxDurability,
    generatedName: generated ?? undefined,
  };

  // Store in registry
  instanceRegistry.set(instance.instanceId, instance);

  // Index by wallet
  addInstanceToOwnerIndex(instance.ownerWallet, instance.instanceId);
  persistInstanceEventually(instance);

  return instance;
}

// ── Lookup Functions ───────────────────────────────────────────────────

export function getItemInstance(instanceId: string): CraftedItemInstance | undefined {
  return instanceRegistry.get(instanceId);
}

export function getWalletInstances(wallet: string): CraftedItemInstance[] {
  const ids = walletIndex.get(normalizeOwnerKey(wallet)) ?? [];
  const instances: CraftedItemInstance[] = [];
  for (const id of ids) {
    const inst = instanceRegistry.get(id);
    if (inst) instances.push(inst);
  }
  return instances;
}

export function getAuctionEscrowInstance(auctionId: number): CraftedItemInstance | undefined {
  const ids = walletIndex.get(`auction:${auctionId}`) ?? [];
  for (const id of ids) {
    const inst = instanceRegistry.get(id);
    if (inst) return inst;
  }
  return undefined;
}

export function getWalletInstanceByToken(
  wallet: string,
  tokenId: number,
  instanceId?: string,
  excludedInstanceIds?: Set<string>,
): CraftedItemInstance | undefined {
  const matches = getWalletInstances(wallet)
    .filter((instance) => instance.baseTokenId === tokenId)
    .filter((instance) => instance.currentDurability > 0)
    .filter((instance) => !excludedInstanceIds?.has(instance.instanceId));
  if (instanceId) return matches.find((instance) => instance.instanceId === instanceId);
  return matches[0];
}

export function isItemInstanceOwnedBy(instance: CraftedItemInstance, wallet: string): boolean {
  return normalizeOwnerKey(instance.ownerWallet || instance.craftedBy) === normalizeOwnerKey(wallet);
}

export async function assignItemInstanceOwner(instanceId: string, ownerWallet: string): Promise<CraftedItemInstance | undefined> {
  const instance = instanceRegistry.get(instanceId);
  if (!instance) return undefined;
  const previousOwner = instance.ownerWallet;
  removeInstanceFromOwnerIndex(previousOwner, instanceId);
  instance.ownerWallet = normalizeOwnerKey(ownerWallet);
  addInstanceToOwnerIndex(instance.ownerWallet, instanceId);
  await persistInstanceToRedis(instance, previousOwner);
  return instance;
}

export async function deleteItemInstance(instanceId: string): Promise<boolean> {
  const instance = instanceRegistry.get(instanceId);
  if (!instance) return false;
  instanceRegistry.delete(instanceId);
  removeInstanceFromOwnerIndex(instance.ownerWallet, instanceId);
  await removeInstanceFromRedis(instance);
  return true;
}

export async function consumeOwnedItemInstances(
  wallet: string,
  tokenId: number,
  quantity: number,
  excludedInstanceIds?: Set<string>,
): Promise<string[]> {
  if (!Number.isFinite(quantity) || quantity <= 0) return [];

  const ownerKey = normalizeOwnerKey(wallet);
  const candidates = getWalletInstances(ownerKey)
    .filter((instance) => instance.baseTokenId === tokenId)
    .filter((instance) => !excludedInstanceIds?.has(instance.instanceId))
    .sort((a, b) => a.craftedAt - b.craftedAt);

  const consumed: string[] = [];
  for (const instance of candidates.slice(0, Math.max(0, Math.floor(quantity)))) {
    const deleted = await deleteItemInstance(instance.instanceId);
    if (deleted) consumed.push(instance.instanceId);
  }
  return consumed;
}

export function upsertItemInstanceFromEquipment(params: {
  instanceId?: string;
  walletAddress: string;
  tokenId: number;
  durability: number;
  maxDurability: number;
  name?: string;
  quality?: string;
  rolledStats?: Partial<CharacterStats>;
  bonusAffix?: {
    name: string;
    statBonuses: Partial<CharacterStats>;
    specialEffect?: string;
  };
  enchantments?: CraftedItemInstance["enchantments"];
}): CraftedItemInstance {
  const existing = params.instanceId ? instanceRegistry.get(params.instanceId) : undefined;
  if (existing) {
    const previousOwner = existing.ownerWallet;
    existing.currentDurability = params.durability;
    existing.currentMaxDurability = params.maxDurability;
    existing.rolledMaxDurability = params.maxDurability;
    existing.ownerWallet = params.walletAddress.toLowerCase();
    existing.enchantments = params.enchantments ? [...params.enchantments] : undefined;
    if (params.rolledStats) existing.rolledStats = { ...params.rolledStats };
    if (params.bonusAffix) {
      existing.bonusAffix = {
        id: existing.bonusAffix?.id ?? params.bonusAffix.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: params.bonusAffix.name,
        statBonuses: params.bonusAffix.statBonuses,
        specialEffect: params.bonusAffix.specialEffect,
      };
    }
    if (params.name && !existing.displayName) existing.displayName = params.name;
    if (previousOwner !== existing.ownerWallet) {
      removeInstanceFromOwnerIndex(previousOwner, existing.instanceId);
      addInstanceToOwnerIndex(existing.ownerWallet, existing.instanceId);
    }
    persistInstanceEventually(existing, previousOwner);
    return existing;
  }

  const instance: CraftedItemInstance = {
    instanceId: randomUUID(),
    baseTokenId: params.tokenId,
    quality: qualityRollFromTier(params.quality),
    rolledStats: params.rolledStats ?? {},
    bonusAffix: params.bonusAffix
      ? {
          id: params.bonusAffix.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: params.bonusAffix.name,
          statBonuses: params.bonusAffix.statBonuses,
          specialEffect: params.bonusAffix.specialEffect,
        }
      : undefined,
    rolledMaxDurability: params.maxDurability,
    craftedBy: params.walletAddress.toLowerCase(),
    ownerWallet: params.walletAddress.toLowerCase(),
    craftedAt: Date.now(),
    recipeId: "runtime-instance",
    displayName: params.name ?? getItemByTokenId(BigInt(params.tokenId))?.name ?? "Unknown Item",
    currentDurability: params.durability,
    currentMaxDurability: params.maxDurability,
    enchantments: params.enchantments ? [...params.enchantments] : undefined,
  };

  instanceRegistry.set(instance.instanceId, instance);
  addInstanceToOwnerIndex(instance.ownerWallet, instance.instanceId);
  persistInstanceEventually(instance);
  return instance;
}

// ── API Routes ─────────────────────────────────────────────────────────

export function registerItemRngRoutes(server: FastifyInstance) {
  // GET /inventory/instances/:walletAddress — list all crafted instances
  server.get<{ Params: { walletAddress: string } }>(
    "/inventory/instances/:walletAddress",
    async (request, reply) => {
      const { walletAddress } = request.params;
      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        reply.code(400);
        return { error: "Invalid wallet address" };
      }

      const instances = getWalletInstances(walletAddress);
      return {
        walletAddress: walletAddress.toLowerCase(),
        count: instances.length,
        instances,
      };
    }
  );

  // GET /inventory/instance/:instanceId — get specific instance details
  server.get<{ Params: { instanceId: string } }>(
    "/inventory/instance/:instanceId",
    async (request, reply) => {
      const instance = getItemInstance(request.params.instanceId);
      if (!instance) {
        reply.code(404);
        return { error: "Item instance not found" };
      }
      return instance;
    }
  );
}

await restoreInstancesFromRedis();
