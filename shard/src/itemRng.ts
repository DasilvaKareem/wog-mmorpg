import type { FastifyInstance } from "fastify";
import type { CharacterStats } from "./classes.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { randomUUID } from "crypto";

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
  craftedAt: number; // timestamp
  recipeId: string;
  displayName: string;
}

// ── In-Memory Registry ─────────────────────────────────────────────────

const instanceRegistry = new Map<string, CraftedItemInstance>();
const walletIndex = new Map<string, string[]>(); // wallet → instanceId[]

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

  // Build display name: "Fine Iron Sword of the Bear"
  const prefix = quality.displayPrefix ? `${quality.displayPrefix} ` : "";
  const suffix = affix ? ` ${affix.name}` : "";
  const displayName = `${prefix}${item.name}${suffix}`;

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
    craftedAt: Date.now(),
    recipeId: params.recipeId,
    displayName,
  };

  // Store in registry
  instanceRegistry.set(instance.instanceId, instance);

  // Index by wallet
  const wallet = params.craftedBy.toLowerCase();
  const existing = walletIndex.get(wallet) ?? [];
  existing.push(instance.instanceId);
  walletIndex.set(wallet, existing);

  return instance;
}

// ── Lookup Functions ───────────────────────────────────────────────────

export function getItemInstance(instanceId: string): CraftedItemInstance | undefined {
  return instanceRegistry.get(instanceId);
}

export function getWalletInstances(wallet: string): CraftedItemInstance[] {
  const ids = walletIndex.get(wallet.toLowerCase()) ?? [];
  const instances: CraftedItemInstance[] = [];
  for (const id of ids) {
    const inst = instanceRegistry.get(id);
    if (inst) instances.push(inst);
  }
  return instances;
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
