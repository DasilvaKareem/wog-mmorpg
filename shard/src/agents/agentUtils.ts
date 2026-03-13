/**
 * Shared utilities for the agent system.
 */

import { getGoldBalance, getItemBalance } from "../blockchain/blockchain.js";
import { getAvailableGold } from "../blockchain/goldLedger.js";
import { goldToCopper } from "../blockchain/currency.js";
import { getEquippedItemCounts, getRecyclableQuantity } from "../items/inventoryState.js";
import { getItemRarity, getItemRecycleCopperValue, ITEM_CATALOG } from "../items/itemCatalog.js";
import { getRegionCenter } from "../world/worldLayout.js";
import { getEntity, type Order } from "../world/zoneRuntime.js";
import { type TierCapabilities } from "./agentTiers.js";
import { type BotScript, type TriggerEvent } from "../types/botScriptTypes.js";
import { type AgentStrategy } from "./agentConfigStore.js";

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function formatAgentError(error: unknown): string {
  const fallback = "unknown error";
  if (!error || typeof error !== "object") return fallback;

  const rawMessage = typeof (error as any).message === "string"
    ? (error as any).message.trim()
    : "";
  const stripped = rawMessage.replace(/^API Error:\s*/i, "").trim();
  if (!stripped) return fallback;

  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        if (typeof parsed.distance === "number" && typeof parsed.maxRange === "number") {
          return `${parsed.error} (${parsed.distance}/${parsed.maxRange})`;
        }
        return parsed.error.trim();
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
    }
  } catch {
    // Non-JSON errors fall back to the raw message.
  }

  return stripped;
}

export type ActionStatus = "idle" | "progressed" | "blocked" | "completed";
export type FailureCategory = "transient" | "strategic";

export interface ActionResult {
  status: ActionStatus;
  reason?: string;
  failureKey?: string;
  endpoint?: string;
  targetId?: string;
  targetName?: string;
  category?: FailureCategory;
}

export interface FailureMemoryEntry {
  key: string;
  reason: string;
  count: number;
  consecutive: number;
  firstAt: number;
  lastAt: number;
  scriptType?: string;
  endpoint?: string;
  targetId?: string;
  targetName?: string;
  category?: FailureCategory;
}

export function actionIdle(reason?: string): ActionResult {
  return { status: "idle", reason };
}

export function actionProgressed(reason?: string): ActionResult {
  return { status: "progressed", reason };
}

export function actionCompleted(reason?: string): ActionResult {
  return { status: "completed", reason };
}

export function actionBlocked(
  reason: string,
  options: Omit<ActionResult, "status" | "reason"> = {},
): ActionResult {
  return {
    status: "blocked",
    reason,
    category: options.category ?? classifyFailureReason(reason),
    ...options,
  };
}

export function classifyFailureReason(reason: string | undefined): FailureCategory {
  const text = String(reason ?? "").toLowerCase();
  if (!text) return "transient";
  if (
    text.includes("insufficient gold")
    || text.includes("no talk quest available")
    || text.includes("wrong class")
    || text.includes("already learned")
    || text.includes("must learn")
    || text.includes("missing ingredients")
    || text.includes("can't afford")
    || text.includes("merchant has nothing")
    || text.includes("no merchant")
    || text.includes("no forge")
    || text.includes("no alchemy lab")
    || text.includes("no campfire")
    || text.includes("no enchanting altar")
    || text.includes("no resource nodes")
    || text.includes("no eligible mobs")
  ) {
    return "strategic";
  }
  return "transient";
}

/**
 * Extract the raw character name from an NFT-formatted name.
 * "Zephyr the Mage" → "Zephyr"
 */
export function extractRawCharacterName(name?: string): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.+?)\s+the\s+\w+$/i);
  return match ? match[1] : trimmed;
}

// ── API types ────────────────────────────────────────────────────────────────

export type ApiCaller = (method: string, path: string, body?: unknown) => Promise<any>;

export interface LiquidationInventoryItem {
  tokenId: string;
  name: string;
  balance: string;
  category: string;
  rarity: string;
  equipSlot: string | null;
  armorSlot: string | null;
  statBonuses: Record<string, number>;
  maxDurability: number | null;
  equippedCount: number;
  recyclableQuantity: number;
  recycleCopperValue: number;
}

/**
 * Context object passed from AgentRunner to behavior/survival/trigger functions.
 * Bundles the runner's internal state and helpers so extracted functions can
 * operate without needing access to the runner class directly.
 */
export interface AgentContext {
  readonly userWallet: string;
  readonly walletTag: string; // userWallet.slice(0,8) for logging
  readonly entityId: string;
  readonly custodialWallet: string;
  readonly currentRegion: string;
  readonly currentCaps: TierCapabilities;
  readonly api: ApiCaller;

  // Helpers delegated from the runner
  getZoneState(): Promise<{ entities: Record<string, any>; me: any; recentEvents: any[] } | null>;
  findNearestEntity(
    entities: Record<string, any>,
    me: any,
    pred: (e: any) => boolean,
  ): [string, any] | null;
  moveToEntity(me: any, target: any, dist?: number): Promise<boolean>;
  issueCommand(
    command:
      | { action: "move"; x: number; y: number }
      | { action: "attack"; targetId: string }
      | { action: "travel"; targetZone: string },
  ): boolean;
  isInteractionOnCooldown(key: string): boolean;
  setInteractionCooldown(key: string, ms: number): void;
  clearInteractionCooldown(key: string): void;
  logActivity(text: string): void;
  setEntityGotoMode(on: boolean): void;
  getWalletBalance(): Promise<{ copper: number; items: any[] }>;
  getLiquidationInventory(): Promise<{ copper: number; items: LiquidationInventoryItem[] }>;

  // Allow behaviors to modify script state
  setScript(script: BotScript | null): void;
  readonly currentScript: BotScript | null;

  // Public actions (also called from chat routes)
  buyItem(tokenId: number): Promise<boolean>;
  equipItem(tokenId: number, instanceId?: string): Promise<boolean>;
  learnProfession(professionId: string): Promise<boolean>;
  recycleItem(tokenId: number, quantity?: number): Promise<{ ok: boolean; error?: string; itemName?: string; totalPayoutCopper?: number }>;

  /** Ask the summoner a yes/no (or multi-choice) question. Returns true if question was posted. */
  askSummoner(text: string, choices?: string[], context?: Record<string, unknown>): Promise<boolean>;
}

/**
 * Read wallet balance directly from the blockchain helpers.
 * Avoids bouncing through the local Fastify route from inside the shard.
 */
export async function fetchWalletBalance(
  custodialWallet: string,
): Promise<{ copper: number; items: any[] }> {
  try {
    const onChainGold = parseFloat(await getGoldBalance(custodialWallet));
    const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
    const availableGold = getAvailableGold(custodialWallet, safeOnChainGold);
    const balanceResults = await Promise.all(
      ITEM_CATALOG.map((item) => getItemBalance(custodialWallet, item.tokenId)),
    );

    const items = [];
    for (let i = 0; i < ITEM_CATALOG.length; i++) {
      const balance = balanceResults[i];
      if (balance <= 0n) continue;
      const item = ITEM_CATALOG[i];
      items.push({
        tokenId: item.tokenId.toString(),
        name: item.name,
        balance: balance.toString(),
        category: item.category,
        equipSlot: item.equipSlot ?? null,
        armorSlot: item.armorSlot ?? null,
        statBonuses: item.statBonuses ?? {},
        maxDurability: item.maxDurability ?? null,
      });
    }

    return {
      copper: goldToCopper(availableGold),
      items,
    };
  } catch {
    return { copper: 0, items: [] };
  }
}

export async function fetchLiquidationInventory(
  custodialWallet: string,
): Promise<{ copper: number; items: LiquidationInventoryItem[] }> {
  try {
    const onChainGold = parseFloat(await getGoldBalance(custodialWallet));
    const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
    const availableGold = getAvailableGold(custodialWallet, safeOnChainGold);
    const equippedCounts = await getEquippedItemCounts(custodialWallet);
    const balanceResults = await Promise.all(
      ITEM_CATALOG.map((item) => getItemBalance(custodialWallet, item.tokenId)),
    );

    const items: LiquidationInventoryItem[] = [];
    for (let i = 0; i < ITEM_CATALOG.length; i++) {
      const balance = balanceResults[i];
      if (balance <= 0n) continue;
      const item = ITEM_CATALOG[i];
      const owned = Number(balance);
      const equippedCount = equippedCounts.get(Number(item.tokenId)) ?? 0;
      items.push({
        tokenId: item.tokenId.toString(),
        name: item.name,
        balance: balance.toString(),
        category: item.category,
        rarity: getItemRarity(item.copperPrice),
        equipSlot: item.equipSlot ?? null,
        armorSlot: item.armorSlot ?? null,
        statBonuses: item.statBonuses ?? {},
        maxDurability: item.maxDurability ?? null,
        equippedCount,
        recyclableQuantity: getRecyclableQuantity(owned, equippedCount),
        recycleCopperValue: getItemRecycleCopperValue(item),
      });
    }

    return {
      copper: goldToCopper(availableGold),
      items,
    };
  } catch {
    return { copper: 0, items: [] };
  }
}

/**
 * Submit an agent command directly into the world state.
 * This mirrors the `/command` route without local HTTP overhead.
 */
export function issueAgentCommand(
  entityId: string,
  command:
    | { action: "move"; x: number; y: number }
    | { action: "attack"; targetId: string }
    | { action: "travel"; targetZone: string },
): boolean {
  const entity = getEntity(entityId);
  if (!entity) return false;

  let order: Order;
  if (command.action === "move") {
    order = { action: "move", x: command.x, y: command.y };
  } else if (command.action === "attack") {
    if (!getEntity(command.targetId)) return false;
    order = { action: "attack", targetId: command.targetId };
  } else {
    const center = getRegionCenter(command.targetZone);
    if (!center) return false;
    order = { action: "move", x: center.x, y: center.z };
    entity.travelTargetZone = command.targetZone;
  }

  entity.order = order;
  return true;
}
