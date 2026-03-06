/**
 * Shared utilities for the agent system.
 */

import { getGoldBalance, getItemBalance } from "../blockchain/blockchain.js";
import { getAvailableGold } from "../blockchain/goldLedger.js";
import { goldToCopper } from "../blockchain/currency.js";
import { ITEM_CATALOG } from "../items/itemCatalog.js";
import { getRegionCenter } from "../world/worldLayout.js";
import { getEntity, type Order } from "../world/zoneRuntime.js";
import { type TierCapabilities } from "./agentTiers.js";
import { type BotScript, type TriggerEvent } from "../types/botScriptTypes.js";
import { type AgentStrategy } from "./agentConfigStore.js";

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
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
  logActivity(text: string): void;
  setEntityGotoMode(on: boolean): void;
  getWalletBalance(): Promise<{ copper: number; items: any[] }>;

  // Allow behaviors to modify script state
  setScript(script: BotScript | null): void;
  readonly currentScript: BotScript | null;

  // Public actions (also called from chat routes)
  buyItem(tokenId: number): Promise<boolean>;
  equipItem(tokenId: number): Promise<boolean>;
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
