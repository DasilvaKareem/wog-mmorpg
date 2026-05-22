/**
 * Agent Behaviors — the 10 focus-specific behavior implementations.
 * Each function runs one tick of the behavior and is called from AgentRunner.executeCurrentScript().
 */

import { getAgentConfig, patchAgentConfig, autoPatchAgentConfig, USER_PINNED_FOCUSES, type AgentFocus, type AgentStrategy } from "./agentConfigStore.js";
import { resolveRegionId, getRegionCenter, getZoneConnections, ZONE_LEVEL_REQUIREMENTS } from "../world/worldLayout.js";
import {
  getEntity as getWorldEntity,
  getOrCreateZone,
  getWorldTick,
  pickPartyFocusTarget,
  pickTechnique,
  pickTechniqueTargetIdForAutoCombat,
} from "../world/zoneRuntime.js";
import { getPartyLeaderId, getPartyMembers, getPlayerPartyId } from "../social/partySystem.js";
import { getItemBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import { getTechniqueById } from "../combat/techniques.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";
import { resolveLiveAgentIdForWallet } from "../erc8004/agentResolution.js";
import { pickLine, emitAgentChat } from "./agentDialogue.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { isQuestNpc } from "../social/questSystem.js";
import { ORE_CATALOG, type OreType } from "../resources/oreCatalog.js";
import { FLOWER_CATALOG, type FlowerType } from "../resources/flowerCatalog.js";
import { getAlchemyRecipeById } from "../professions/alchemy.js";
import { getRecipeById as getCraftingRecipeById } from "../professions/crafting.js";
import { ORE_SPAWN_DEFS } from "../resources/oreSpawner.js";
import { FLOWER_SPAWN_DEFS } from "../resources/flowerSpawner.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
import { NPC_DEFS } from "../world/npcSpawner.js";
import { evaluateEdicts } from "../combat/edictEvaluator.js";
import { getEdictCache } from "../combat/edictCache.js";
import { getDefaultGambits } from "../combat/defaultGambits.js";
import {
  actionBlocked,
  actionCompleted,
  actionIdle,
  actionProgressed,
  formatAgentError,
  type ActionResult,
  type AgentContext,
  type LiquidationInventoryItem,
} from "./agentUtils.js";
import { type BotScript } from "../types/botScriptTypes.js";
import {
  QUEST_CRAFT_RECIPE_BOOKS,
  getRecipeMaterials,
  getRecipeOutputName,
  type CraftProfession,
} from "./professionBehaviors/recipeBooks.js";
import {
  planMaterialRecovery,
  routeToProfessionHubForStation,
} from "./professionBehaviors/materialRecovery.js";
import { doSkinning as doSkinningProfession } from "./professionBehaviors/skinning.js";

const PROFESSION_HUB_ZONE = "village-square";
const PICKAXE_TOKENS: Record<number, number> = { 27: 1, 28: 2, 29: 3, 30: 4 };
const SICKLE_TOKENS: Record<number, number> = { 41: 1, 42: 2, 43: 3, 44: 4 };
const HOE_TOKENS: Record<number, number> = { 220: 1, 221: 2, 222: 3, 223: 4 };
const ENCHANTMENT_ELIXIR_TOKENS = new Set([55, 56, 57, 58, 59, 60, 61]);
const AUCTION_LISTING_FEE_COPPER = 50;
const AUCTION_RELIST_COOLDOWN_MS = 10 * 60_000;
const MIN_AUCTION_VALUE_COPPER = 150;
const GOTO_WAYPOINT_CLOSE_DIST = 20;
const GOTO_NPC_CLOSE_DIST = 35;

function normalizeMobName(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ") // Treat dashes and special chars as spaces
    .replace(/\s+/g, " ");
}

function mobNameMatchesQuestTarget(mobName: unknown, questTargetName: unknown): boolean {
  const mob = normalizeMobName(mobName);
  const target = normalizeMobName(questTargetName);

  if (!mob || !target) return false;
  if (mob === target) return true;

  const mobWords = mob.split(" ");
  const targetWords = target.split(" ");

  // Every word in the quest target must exist as a distinct word in the mob name.
  // "Giant Rat" matches quest target "Rat"
  // "Rat" does NOT match quest target "Giant Rat"
  return targetWords.every((word) => mobWords.includes(word));
}

function matchesAnyQuestMob(mobName: unknown, questMobNames: Set<string>): boolean {
  for (const questName of questMobNames) {
    if (mobNameMatchesQuestTarget(mobName, questName)) {
      return true;
    }
  }
  return false;
}

function firstMissingRecipeMaterial(
  recipes: any[],
  invItems: Array<{ tokenId: number; quantity: number }>,
): { recipe: any; missing: { tokenId: number; quantity: number; name: string } } | null {
  const haveQty = new Map<number, number>();
  for (const it of invItems) haveQty.set(Number(it.tokenId), Number(it.quantity ?? 0));

  let firstMissing: { recipe: any; missing: { tokenId: number; quantity: number; name: string } } | null = null;
  for (const recipe of recipes) {
    const missing = getRecipeMaterials(recipe).find((m) => (haveQty.get(m.tokenId) ?? 0) < m.quantity);
    if (!missing) return null;
    firstMissing ??= { recipe, missing };
  }
  return firstMissing;
}

async function recoverMissingMaterial(
  ctx: AgentContext,
  strategy: AgentStrategy,
  profession: CraftProfession,
  materialName: string,
): Promise<ActionResult> {
  const recovery = planMaterialRecovery(profession, materialName);

  switch (recovery.type) {
    case "combat":
      void ctx.logActivity(`Need ${recovery.targetItemName} for ${profession} — hunting for drops`);
      return doCombat(ctx, strategy);
    case "skin":
      void ctx.logActivity(`Need ${recovery.targetItemName ?? materialName} for ${profession} — skinning`);
      return doSkinning(ctx, strategy);
    case "gather":
      void ctx.logActivity(`Need ${recovery.targetItemName} for ${profession} — gathering ${recovery.preference}`);
      return doGathering(ctx, strategy, recovery.preference, recovery.targetItemName);
    case "hub": {
      const reason = `Stuck on ${profession}: missing ${materialName} (${recovery.reason})`;
      void ctx.logActivity(reason);
      ctx.setScript({ type: "idle", reason });
      return actionIdle(reason);
    }
  }
}

/**
 * Global discovery: searches NPC_DEFS (all defined spawns) to find which
 * zone contains a mob matching any of our active quest targets.
 */
function findZoneForQuestMobs(questMobNames: Set<string>): string | null {
  for (const def of NPC_DEFS) {
    if (def.type !== "mob" && def.type !== "boss") continue;
    if (matchesAnyQuestMob(def.name, questMobNames)) {
      return def.zoneId;
    }
  }
  return null;
}

interface AuctionListingPlan {
  tokenId: number;
  itemName: string;
  quantity: number;
  startPrice: number;
  buyoutPrice: number;
  durationMinutes: number;
  estimatedCopperValue: number;
}

function toGoldAmount(copper: number): number {
  return Number(copperToGold(Math.max(0, Math.floor(copper))).toFixed(4));
}

function buildAuctionListingPlan(item: LiquidationInventoryItem): AuctionListingPlan | null {
  const tokenId = Number(item.tokenId);
  const recyclableQuantity = Math.max(0, Number(item.recyclableQuantity ?? 0));
  const recycleCopperValue = Math.max(0, Number(item.recycleCopperValue ?? 0));
  const category = String(item.category ?? "");
  const isEquipment = category === "weapon" || category === "armor" || !!item.equipSlot || !!item.armorSlot;
  const isTradeGood = category === "material" || category === "consumable" || category === "tool";

  if (!Number.isFinite(tokenId) || tokenId <= 0 || recyclableQuantity <= 0) return null;
  if (!isEquipment && !isTradeGood) return null;

  const quantity = isEquipment
    ? 1
    : Math.max(1, Math.min(recyclableQuantity, category === "material" ? 5 : 3));
  const baseCopperValue = Math.max(recycleCopperValue * quantity, isEquipment ? 200 : 80);

  if (baseCopperValue < MIN_AUCTION_VALUE_COPPER) return null;

  const multiplier = isEquipment ? 2.4 : category === "material" ? 2 : 1.7;
  const startCopper = Math.max(MIN_AUCTION_VALUE_COPPER, Math.round(baseCopperValue * multiplier));
  const buyoutCopper = Math.max(startCopper + 75, Math.round(startCopper * 1.35));

  return {
    tokenId,
    itemName: item.name,
    quantity,
    startPrice: toGoldAmount(startCopper),
    buyoutPrice: toGoldAmount(buyoutCopper),
    durationMinutes: isEquipment ? 240 : 120,
    estimatedCopperValue: baseCopperValue,
  };
}

function pickAuctionListingCandidate(items: LiquidationInventoryItem[]): AuctionListingPlan | null {
  return items
    .map(buildAuctionListingPlan)
    .filter((plan): plan is AuctionListingPlan => plan !== null)
    .sort((a, b) => b.estimatedCopperValue - a.estimatedCopperValue)
    [0] ?? null;
}

function logPartyCoordination(
  ctx: AgentContext,
  me: any,
  kind: string,
  message: string,
  data?: Record<string, unknown>,
  cooldownMs = 3_000,
): void {
  ctx.recordPartyCoordination(kind);
  const cooldownKey = `party-log:${kind}:${data?.targetId ?? data?.leaderId ?? ""}`;
  if (ctx.isInteractionOnCooldown(cooldownKey)) return;
  ctx.setInteractionCooldown(cooldownKey, cooldownMs);

  logZoneEvent({
    zoneId: ctx.currentRegion,
    type: "party",
    tick: 0,
    message,
    entityId: me.id,
    entityName: me.name,
    targetId: typeof data?.targetId === "string" ? data.targetId : undefined,
    targetName: typeof data?.targetName === "string" ? data.targetName : undefined,
    data: {
      kind,
      leaderId: data?.leaderId,
      leaderName: data?.leaderName,
      ...data,
    },
  });
}

export function pickPartyCombatTarget(me: any, currentRegion: string): any | null {
  const partyId = getPlayerPartyId(me.id);
  if (!partyId) return null;

  const partyMemberIds = getPartyMembers(me.id);
  if (partyMemberIds.length <= 1) return null;

  const zone = getOrCreateZone(currentRegion);
  return pickPartyFocusTarget(
    me,
    zone,
    Number.POSITIVE_INFINITY,
    partyMemberIds,
    partyId,
    getPartyLeaderId(me.id),
  );
}

function engagePartyCombatTarget(
  ctx: AgentContext,
  me: any,
  entities: Record<string, any>,
  partyTarget: any,
  partyLeaderId?: string,
): ActionResult {
  const leader = partyLeaderId ? (entities[partyLeaderId] ?? getWorldEntity(partyLeaderId)) : null;
  const leaderTargetId = leader?.order?.targetId;
  const kind = leaderTargetId === partyTarget.id ? "assist-leader-target" : "assist-party-tag";
  logPartyCoordination(ctx, me, kind, `${me.name ?? "Party member"} is assisting on ${partyTarget.name ?? "target"}`, {
    targetId: partyTarget.id,
    targetName: partyTarget.name,
    leaderId: partyLeaderId,
    leaderName: leader?.name,
  });
  return engageCombatTarget(ctx, me, partyTarget, entities);
}

function getCombatOrderTarget(me: any): any | null {
  if (!me.order) return null;
  if (me.order.action !== "attack" && me.order.action !== "technique") return null;
  const target = getWorldEntity(me.order.targetId);
  if (!target) return null;
  if (target.id === me.id) return target;
  return target.hp > 0 ? target : null;
}

function tryUpgradeBasicAttackToTechnique(
  ctx: AgentContext,
  me: any,
  activeTarget: any,
  entities: Record<string, any>,
): ActionResult | null {
  if (me.order?.action !== "attack") return null;

  const zone = getOrCreateZone(ctx.currentRegion);
  const liveMe = (getWorldEntity(me.id) as any) ?? me;
  const zoneTarget = zone.entities.get(activeTarget.id) ?? activeTarget;
  const edicts = getEdictCache(ctx.custodialWallet)
    ?? getEdictCache(ctx.userWallet)
    ?? getDefaultGambits(liveMe.classId);
  const edictResult = evaluateEdicts(liveMe, zone, edicts, zoneTarget, pickTechnique);
  if (!edictResult?.techniqueOverride) return null;

  const targetId = pickTechniqueTargetIdForAutoCombat(liveMe, edictResult.targetOverride ?? zoneTarget, edictResult.techniqueOverride, zone);
  const commandTarget = entities[targetId] ?? getWorldEntity(targetId) ?? zoneTarget;
  const issued = ctx.issueCommand({ action: "technique", targetId, techniqueId: edictResult.techniqueOverride.id });
  if (!issued) return null;

  const targetLabel = targetId === liveMe.id ? "self" : (commandTarget.name ?? "target");
  liveMe.lastEdictDecision = {
    edictId: edictResult.edict.id,
    edictName: edictResult.edict.name,
    actionType: edictResult.edict.action.type,
    targetId,
    targetName: targetLabel,
    techniqueId: edictResult.techniqueOverride.id,
    techniqueName: edictResult.techniqueOverride.name,
    tick: getWorldTick(),
  };
  void ctx.logActivity(`[edict: ${edictResult.edict.name}] Using ${edictResult.techniqueOverride.name} on ${targetLabel}`);
  return actionProgressed(`Using ${edictResult.techniqueOverride.name} on ${targetLabel}`);
}

function getCombatStats(entity: any): Record<string, number> {
  return entity?.effectiveStats ?? entity?.stats ?? {};
}

function estimateAttackPower(entity: any): number {
  const stats = getCombatStats(entity);
  const classId = String(entity?.classId ?? "");
  const isCaster = ["mage", "warlock", "cleric"].includes(classId);
  const str = Number(stats.str ?? 0);
  const int = Number(stats.int ?? 0);
  const agi = Number(stats.agi ?? 0);
  const faith = Number(stats.faith ?? 0);
  const primary = isCaster
    ? int * 0.45 + str * 0.08
    : str * 0.32 + int * 0.12;
  return Math.max(5, Math.round(primary + agi * 0.1 + faith * 0.08));
}

function estimateDefensePower(entity: any): number {
  const stats = getCombatStats(entity);
  const def = Number(stats.def ?? 0);
  const agi = Number(stats.agi ?? 0);
  return Math.max(0, Math.round(def * 0.45 + agi * 0.06));
}

function estimateDamage(attacker: any, defender: any): number {
  return Math.max(3, Math.round(estimateAttackPower(attacker) - estimateDefensePower(defender) * 0.5));
}

function estimateTimeToKill(attacker: any, defender: any): number {
  const hp = Math.max(1, Number(defender?.hp ?? defender?.maxHp ?? 1));
  return hp / estimateDamage(attacker, defender);
}

function isBossTarget(target: any): boolean {
  return target?.type === "boss";
}

const WEAK_MOB_LEVEL_GAP = 7;

function isCombatTargetAllowed(
  me: any,
  target: any,
  strategy: AgentStrategy,
  questPriority = false,
  ignoreWeakMobs = false,
): boolean {
  const myLevel = Number(me?.level ?? 1);
  const targetLevel = Number(target?.level ?? 1);
  const hpPct = (Number(me?.hp ?? 0) / Math.max(1, Number(me?.maxHp ?? 1)));
  const targetHpPct = (Number(target?.hp ?? 0) / Math.max(1, Number(target?.maxHp ?? 1)));
  const isBoss = isBossTarget(target);

  // Hard floor — skip mobs many levels below the agent unless they're quest-relevant
  // or we're specifically hunting them. Prevents Lv25 agents from smashing Lv1 rats.
  if (ignoreWeakMobs && !questPriority && !isBoss && myLevel - targetLevel >= WEAK_MOB_LEVEL_GAP) {
    return false;
  }

  if (strategy !== "aggressive" && isBoss) return false;

  const damageToTarget = estimateDamage(me, target);
  const damageToMe = estimateDamage(target, me);
  const targetTtk = Math.max(1, Number(target?.hp ?? target?.maxHp ?? 1)) / damageToTarget;
  const myTtk = Math.max(1, Number(me?.hp ?? me?.maxHp ?? 1)) / damageToMe;
  const ttkRatio = targetTtk / Math.max(0.5, myTtk);

  if (strategy === "defensive") {
    if (targetLevel > myLevel) return false;
    if (hpPct < 0.7) return false;
    if (ttkRatio > 0.65) return false;
    return true;
  }

  if (strategy === "balanced") {
    if (targetLevel > myLevel + 1) return false;
    if (hpPct < 0.55) return false;
    if (ttkRatio > (questPriority ? 0.9 : 0.8)) return false;
    return true;
  }

  // Aggressive still needs a winnable-looking fight, especially on bosses.
  if (isBoss) {
    if (targetLevel > myLevel + 1) return false;
    if (hpPct < 0.8) return false;
    if (targetHpPct > 0.75 && ttkRatio > 1.05) return false;
  } else {
    if (targetLevel > myLevel + 3) return false;
    if (ttkRatio > 1.25) return false;
  }

  return true;
}

function scoreCombatTarget(
  me: any,
  target: any,
  strategy: AgentStrategy,
  questPriority = false,
): number {
  const myLevel = Number(me?.level ?? 1);
  const targetLevel = Number(target?.level ?? 1);
  const distance = Math.hypot(Number(target?.x ?? 0) - Number(me?.x ?? 0), Number(target?.y ?? 0) - Number(me?.y ?? 0));
  const targetHpPct = Number(target?.hp ?? 0) / Math.max(1, Number(target?.maxHp ?? 1));
  const targetTtk = estimateTimeToKill(me, target);
  const myTtk = estimateTimeToKill(target, me);
  const ttkRatio = targetTtk / Math.max(0.5, myTtk);
  const isBoss = isBossTarget(target);

  let score = distance / 50 + targetTtk;

  if (strategy === "aggressive") {
    score += Math.max(0, myLevel - targetLevel) * 1.5;
    score -= Math.max(0, targetLevel - myLevel) * 1.2;
  } else if (strategy === "balanced") {
    score += Math.abs(targetLevel - myLevel) * 2.2;
  } else {
    score += Math.max(0, targetLevel - myLevel) * 4;
    score += Math.max(0, targetLevel - (myLevel - 1)) * 1.5;
  }

  score += ttkRatio * (strategy === "defensive" ? 14 : strategy === "balanced" ? 10 : 6);
  score += targetHpPct * (strategy === "aggressive" ? 2 : 4);

  if (questPriority) score -= 8;
  if (isBoss) score += strategy === "aggressive" ? 8 : 100;

  // Small jitter prevents deterministic corpse-runs on the same exact target.
  score += Math.random() * 1.5;
  return score;
}

function pickCombatTarget(
  me: any,
  candidates: Array<[string, any]>,
  strategy: AgentStrategy,
  options?: { questMobNames?: Set<string>; ignoreWeakMobs?: boolean },
): any | null {
  const questMobNames = options?.questMobNames;
  const ignoreWeakMobs = options?.ignoreWeakMobs ?? false;
  const scored = candidates
    .map((entry) => {
      const [, target] = entry;
      const questPriority = !!questMobNames && matchesAnyQuestMob(target?.name, questMobNames);
      if (!isCombatTargetAllowed(me, target, strategy, questPriority, ignoreWeakMobs)) return null;
      return {
        target,
        questPriority,
        score: scoreCombatTarget(me, target, strategy, questPriority),
      };
    })
    .filter((value): value is { target: any; questPriority: boolean; score: number } => value !== null)
    .sort((a, b) => a.score - b.score);

  if (scored.length === 0) return null;

  const shortlistSize = strategy === "aggressive" ? 3 : 2;
  const shortlist = scored.slice(0, Math.min(shortlistSize, scored.length));
  return shortlist[Math.floor(Math.random() * shortlist.length)]?.target ?? scored[0].target;
}

function engageCombatTarget(ctx: AgentContext, me: any, target: any, entities: Record<string, any>): ActionResult {
  const activeTarget = getCombatOrderTarget(me);
  if (activeTarget) {
    const upgraded = tryUpgradeBasicAttackToTechnique(ctx, me, activeTarget, entities);
    if (upgraded) return upgraded;
    if (me.order?.action === "technique") {
      const technique = getTechniqueById(me.order.techniqueId);
      const label = technique?.name ?? "technique";
      return actionProgressed(`Using ${label} on ${activeTarget.name ?? "target"}`);
    }
    return actionProgressed(`Attacking ${activeTarget.name ?? "target"}`);
  }

  const zone = getOrCreateZone(ctx.currentRegion);
  const zoneTarget = zone.entities.get(target.id) ?? target;
  const edicts = getEdictCache(ctx.custodialWallet)
    ?? getEdictCache(ctx.userWallet)
    ?? getDefaultGambits(me.classId);
  const edictResult = evaluateEdicts(me, zone, edicts, zoneTarget, pickTechnique);
  if (edictResult) {
    const edictTarget = edictResult.targetOverride ?? zoneTarget;
    if (edictResult.techniqueOverride) {
      const targetId = pickTechniqueTargetIdForAutoCombat(me, edictTarget, edictResult.techniqueOverride, zone);
      const commandTarget = entities[targetId] ?? getWorldEntity(targetId) ?? edictTarget;
      const issued = ctx.issueCommand({ action: "technique", targetId, techniqueId: edictResult.techniqueOverride.id });
      if (issued) {
        const targetLabel = targetId === me.id ? "self" : (commandTarget.name ?? "target");
        const liveMe = getWorldEntity(me.id) as any;
        if (liveMe) {
          liveMe.lastEdictDecision = {
            edictId: edictResult.edict.id,
            edictName: edictResult.edict.name,
            actionType: edictResult.edict.action.type,
            targetId,
            targetName: targetLabel,
            techniqueId: edictResult.techniqueOverride.id,
            techniqueName: edictResult.techniqueOverride.name,
            tick: getWorldTick(),
          };
        }
        void ctx.logActivity(`[edict: ${edictResult.edict.name}] Using ${edictResult.techniqueOverride.name} on ${targetLabel}`);
        return actionProgressed(`Using ${edictResult.techniqueOverride.name} on ${targetLabel}`);
      }
    } else if (edictResult.order?.action === "attack" && edictResult.order.targetId) {
      const issued = ctx.issueCommand({ action: "attack", targetId: edictResult.order.targetId });
      if (issued) {
        const liveMe = getWorldEntity(me.id) as any;
        if (liveMe) {
          liveMe.lastEdictDecision = {
            edictId: edictResult.edict.id,
            edictName: edictResult.edict.name,
            actionType: edictResult.edict.action.type,
            targetId: edictResult.order.targetId,
            targetName: edictTarget.name ?? "target",
            tick: getWorldTick(),
          };
        }
        void ctx.logActivity(`[edict: ${edictResult.edict.name}] Attacking ${edictTarget.name ?? "target"}`);
        return actionProgressed(`Attacking ${edictTarget.name ?? "target"}`);
      }
    } else if (edictResult.order?.action === "move" && edictResult.order.x != null && edictResult.order.y != null) {
      const issued = ctx.issueCommand({ action: "move", x: edictResult.order.x, y: edictResult.order.y });
      if (issued) {
        const label = edictResult.edict.action.type === "skip" ? "Holding position" : "Repositioning";
        const liveMe = getWorldEntity(me.id) as any;
        if (liveMe) {
          liveMe.lastEdictDecision = {
            edictId: edictResult.edict.id,
            edictName: edictResult.edict.name,
            actionType: edictResult.edict.action.type,
            tick: getWorldTick(),
          };
        }
        void ctx.logActivity(`[edict: ${edictResult.edict.name}] ${label}`);
        return actionProgressed(label);
      }
    } else if (edictResult.targetOverride) {
      target = edictResult.targetOverride;
    }
  }

  const issued = ctx.issueCommand({ action: "attack", targetId: target.id });
  if (!issued) {
    return actionBlocked(`Could not attack ${target.name ?? "mob"}`, {
      failureKey: `combat:attack:${target.id}`,
      targetId: target.id,
      targetName: target.name ?? "mob",
    });
  }
  void ctx.logActivity(`Attacking ${target.name ?? "mob"}`);
  return actionProgressed(`Attacking ${target.name ?? "mob"}`);
}

type GatherPreference = "ore" | "herb" | "both";
type GatheringToolKind = "pickaxe" | "sickle";

function matchesTool(name: string | undefined, toolKind: GatheringToolKind): boolean {
  const lower = name?.toLowerCase() ?? "";
  return toolKind === "pickaxe" ? lower.includes("pickaxe") : lower.includes("sickle");
}

function toolTierFromTokenId(tokenId: number | undefined, toolKind: GatheringToolKind): number {
  if (!tokenId) return 0;
  return toolKind === "pickaxe"
    ? (PICKAXE_TOKENS[tokenId] ?? 0)
    : (SICKLE_TOKENS[tokenId] ?? 0);
}

function requiredNodeTier(entity: any): number {
  if (entity.type === "ore-node" && entity.oreType) {
    return ORE_CATALOG[entity.oreType as OreType]?.requiredPickaxeTier ?? 1;
  }
  if (entity.type === "flower-node" && entity.flowerType) {
    return FLOWER_CATALOG[entity.flowerType as FlowerType]?.requiredSickleTier ?? 1;
  }
  return 1;
}

function findGatherNode(
  entities: Record<string, any>,
  me: any,
  preference: GatherPreference,
  isBlacklisted: (nodeId: string) => boolean,
  preferredItemName?: string | null,
  requirePreferredItem = false,
): [string, any] | null {
  const matchesPreferredName = (name: string | undefined): boolean => {
    if (!preferredItemName) return false;
    const a = (name ?? "").toLowerCase();
    const b = preferredItemName.toLowerCase();
    return a.includes(b) || b.includes(a);
  };

  const matches = Object.entries(entities)
    .filter(([id, e]) => {
      if (isBlacklisted(id)) return false;
      const alive = !e.depletedAtTick && (e.charges ?? 0) > 0;
      if (preference === "ore") return e.type === "ore-node" && alive;
      if (preference === "herb") return e.type === "flower-node" && alive;
      return (e.type === "ore-node" || e.type === "flower-node") && alive;
    })
    .filter(([, e]) => !requirePreferredItem || matchesPreferredName(e.name))
    .sort(([, a], [, b]) => {
      // Prefer nodes whose name matches an active quest target (e.g., Meadow
      // Lily) so gather quests actually progress instead of grinding random
      // dandelions forever.
      const aMatch = matchesPreferredName(a.name) ? 0 : 1;
      const bMatch = matchesPreferredName(b.name) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const tierDiff = requiredNodeTier(a) - requiredNodeTier(b);
      if (tierDiff !== 0) return tierDiff;
      return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    });
  return matches[0] as [string, any] ?? null;
}

async function routeToProfessionHub(
  ctx: AgentContext,
  reason: string,
  meLevel: number,
): Promise<boolean> {
  if (ctx.currentRegion === PROFESSION_HUB_ZONE) return false;

  // High-level agents should NOT get yanked back to village-square for a tool.
  // Skip the detour — caller falls back to combat in the current zone.
  if (meLevel >= 10) {
    void ctx.logActivity(`Skipping hub detour at Lv${meLevel} — staying in ${ctx.currentRegion}`);
    return false;
  }

  // Low-level agents: enqueue a round-trip (hub → return home) so we don't
  // strand the agent in village-square.
  const home = ctx.homeZone ?? ctx.currentRegion;
  const chain: BotScript[] = [
    { type: "travel", targetZone: PROFESSION_HUB_ZONE, reason },
    { type: "shop", reason: "Buy gathering tool at hub" },
  ];
  if (home && home !== PROFESSION_HUB_ZONE) {
    chain.push({ type: "travel", targetZone: home, reason: `Return to ${home}` });
    chain.push({ type: "quest", reason: `Resume quest in ${home}` });
  }
  await ctx.enqueueActions(chain, true);
  void ctx.logActivity(reason);
  return true;
}

async function ensureGatheringTool(
  ctx: AgentContext,
  entities: Record<string, any>,
  me: any,
  toolKind: GatheringToolKind,
  requiredTier: number,
): Promise<boolean> {
  const equippedWeapon = me.equipment?.weapon;
  const equippedTokenId = Number(equippedWeapon?.tokenId ?? 0);
  const equippedTier = toolTierFromTokenId(equippedTokenId, toolKind);
  const equippedReady = !!equippedWeapon
    && !equippedWeapon.broken
    && (equippedWeapon.durability ?? 0) > 0
    && matchesTool(equippedWeapon.name, toolKind)
    && equippedTier >= requiredTier;
  if (equippedReady) return true;

  const { copper, items } = await ctx.getWalletBalance();
  const inventoryTool = items
    .filter((item: any) => {
      const tokenId = Number(item.tokenId);
      const tier = toolTierFromTokenId(tokenId, toolKind);
      return tier >= requiredTier && matchesTool(item.name, toolKind) && Number(item.balance ?? 0) > 0;
    })
    .sort((a: any, b: any) => Number(b.tokenId) - Number(a.tokenId))[0];

  if (inventoryTool) {
    const equipped = await ctx.equipItem(Number(inventoryTool.tokenId));
    if (equipped) {
      void ctx.logActivity(`Equipped ${inventoryTool.name}`);
    }
    return false;
  }

  const merchants = Object.entries(entities)
    .filter(([, e]) => e.type === "merchant")
    .sort(([, a], [, b]) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));

  for (const [merchantId, merchantEntity] of merchants) {
    const moving = await ctx.moveToEntity(me, merchantEntity);
    if (moving) return false;

    const shopData = await ctx.api("GET", `/shop/npc/${merchantId}`);
    const merchantTool = (shopData?.items ?? [])
      .filter((item: any) => {
        const tokenId = Number(item.tokenId);
        const tier = toolTierFromTokenId(tokenId, toolKind);
        return tier >= requiredTier && matchesTool(item.name, toolKind);
      })
      .sort((a: any, b: any) => {
        const priceDiff = Number(a.currentPrice ?? a.copperPrice ?? 0) - Number(b.currentPrice ?? b.copperPrice ?? 0);
        if (priceDiff !== 0) return priceDiff;
        return Number(a.tokenId) - Number(b.tokenId);
      })[0];

    if (!merchantTool) continue;

    const price = Number(merchantTool.currentPrice ?? merchantTool.copperPrice ?? 0);
    if (copper < price) {
      void ctx.logActivity(`Need ${price} copper for ${merchantTool.name}`);
      return false;
    }

    const bought = await ctx.buyItem(Number(merchantTool.tokenId));
    if (!bought) return false;
    await ctx.equipItem(Number(merchantTool.tokenId));
    void ctx.logActivity(`Bought ${merchantTool.name} for gathering`);
    return false;
  }

  const toolLabel = toolKind === "pickaxe" ? "pickaxe" : "sickle";
  const meLevel = Number(me?.level ?? 1);
  const rerouted = await routeToProfessionHub(
    ctx,
    `Traveling to ${PROFESSION_HUB_ZONE} to buy a tier ${requiredTier} ${toolLabel}`,
    meLevel,
  );
  if (!rerouted) {
    void ctx.logActivity(`No merchant here sells a tier ${requiredTier} ${toolLabel}`);
  }
  return false;
}

// ── Combat ───────────────────────────────────────────────────────────────────

export async function doCombat(
  ctx: AgentContext,
  strategy: AgentStrategy,
  learnNextTechnique?: () => Promise<{ ok: boolean; reason: string }>,
): Promise<ActionResult> {
  try {
    if (ctx.currentCaps.techniquesEnabled && learnNextTechnique) {
      const trainResult = await learnNextTechnique();
      if (trainResult.ok) return actionProgressed(trainResult.reason);
    }

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;
    const partyId = getPlayerPartyId(ctx.entityId);
    const partyLeaderId = getPartyLeaderId(ctx.entityId);

    if (partyId && partyLeaderId && partyLeaderId !== me.id) {
      const leader = entities[partyLeaderId];
      if (leader?.type === "player" && leader.hp > 0) {
        const distToLeader = Math.hypot((leader.x ?? 0) - (me.x ?? 0), (leader.y ?? 0) - (me.y ?? 0));
        if (distToLeader > 60) {
          const moving = await ctx.moveToEntity(me, leader, 30);
          if (moving) {
            logPartyCoordination(ctx, me, "follow-leader", `${me.name ?? "Party member"} is following ${leader.name ?? "leader"}`, {
              leaderId: leader.id,
              leaderName: leader.name,
              distance: Math.round(distToLeader),
            });
            return actionProgressed(`Following party leader ${leader.name ?? "leader"}`);
          }
        }
      }
    }

    // Disengage if HP too low (only if retreat enabled)
    if (ctx.currentCaps.retreatEnabled) {
      const hpPct = (me.hp ?? 0) / Math.max(me.maxHp ?? 1, 1);
      const retreatThreshold: Record<AgentStrategy, number> = {
        aggressive: 0.15,
        balanced: 0.30,
        defensive: 0.50,
      };
      if (hpPct < retreatThreshold[strategy]) {
        ctx.issueCommand({ action: "move", x: 150, y: 150 });
        void ctx.logActivity(`Low HP (${Math.round(hpPct * 100)}%) — disengaging`);
        return actionProgressed(`Disengaging at ${Math.round(hpPct * 100)}% HP`);
      }
    }

    const myLevel = me.level ?? 1;
    const levelCap: Record<AgentStrategy, number> = {
      aggressive: myLevel + 5,
      balanced: myLevel + 2,
      defensive: myLevel,
    };
    const maxMobLevel = levelCap[strategy];

    const livingMobs = Object.entries(entities).filter(
      ([, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0,
    );
    const eligible = livingMobs.filter(
      ([, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && (e.level ?? 1) <= maxMobLevel,
    );
    if (livingMobs.length === 0) {
      return actionBlocked("No eligible mobs in zone", {
        failureKey: `combat:no-targets:${ctx.currentRegion}`,
        targetName: ctx.currentRegion,
        category: "strategic",
      });
    }

    // Early zone-mismatch detection: if every living mob is outside our ±4 level
    // band, the zone fundamentally doesn't match the agent — bail with a
    // strategic failure so the circuit breaker's zone-rescue path can take over
    // immediately instead of spinning on "no safe targets" for 15 ticks.
    const inBand = livingMobs.filter(([, e]: any) => {
      const lvl = Number(e.level ?? 1);
      return Math.abs(lvl - myLevel) <= 4;
    });
    if (inBand.length === 0) {
      const avgMobLevel = livingMobs.reduce((acc, [, e]: any) => acc + Number(e.level ?? 1), 0) / livingMobs.length;
      const direction = avgMobLevel > myLevel ? "too dangerous" : "outleveled";
      return actionBlocked(`Zone ${direction} — Lv${myLevel} vs avg mob Lv${Math.round(avgMobLevel)}`, {
        failureKey: `combat:level-mismatch:${ctx.currentRegion}`,
        targetName: ctx.currentRegion,
        category: "strategic",
      });
    }

    const weakMobFloor = ctx.ignoreWeakMobs;

    const activeTarget = getCombatOrderTarget(me);
    if (activeTarget && isCombatTargetAllowed(me, activeTarget, strategy, false, weakMobFloor)) {
      ctx.commitTarget(activeTarget.id);
      return engageCombatTarget(ctx, me, activeTarget, entities);
    }

    if (activeTarget) {
      const fallback = getRegionCenter(ctx.currentRegion);
      if (fallback) {
        ctx.issueCommand({ action: "move", x: fallback.x, y: fallback.z });
      }
      ctx.clearCommittedTarget();
      void ctx.logActivity(`Disengaging from ${activeTarget.name ?? "target"} — too dangerous for ${strategy} strategy`);
      return actionProgressed(`Disengaging from ${activeTarget.name ?? "target"}`);
    }

    // FF12-gambit rule: non-leader party members always follow the leader's
    // target if the leader has switched. Check BEFORE committed-target stickiness
    // so followers don't stay locked on a stale mob when leader moves on.
    const isNonLeader = !!(partyId && partyLeaderId && partyLeaderId !== me.id);
    if (isNonLeader) {
      const partyTarget = pickPartyCombatTarget(me, ctx.currentRegion);
      if (partyTarget && isCombatTargetAllowed(me, partyTarget, strategy, false, weakMobFloor)) {
        if (ctx.committedTargetId !== partyTarget.id) ctx.commitTarget(partyTarget.id);
        return engagePartyCombatTarget(ctx, me, entities, partyTarget, partyLeaderId);
      }
    }

    // Stick with the previously committed target if it's still alive + allowed.
    // Prevents shortlist jitter from flipping targets every tick.
    const committedId = ctx.committedTargetId;
    if (committedId) {
      const committedMob = entities[committedId];
      if (committedMob && committedMob.hp > 0 && isCombatTargetAllowed(me, committedMob, strategy, false, weakMobFloor)) {
        return engageCombatTarget(ctx, me, committedMob, entities);
      }
      ctx.clearCommittedTarget();
    }

    const partyTarget = pickPartyCombatTarget(me, ctx.currentRegion);
    if (partyTarget && isCombatTargetAllowed(me, partyTarget, strategy, false, weakMobFloor)) {
      ctx.commitTarget(partyTarget.id);
      return engagePartyCombatTarget(ctx, me, entities, partyTarget, partyLeaderId);
    }

    const candidatePool = eligible.length > 0 ? eligible : livingMobs;
    const mob = pickCombatTarget(me, candidatePool, strategy, { ignoreWeakMobs: weakMobFloor });
    if (!mob) {
      return actionBlocked("No safe combat targets for current strategy", {
        failureKey: `combat:no-safe-targets:${ctx.currentRegion}:${strategy}`,
        targetName: ctx.currentRegion,
        category: "strategic",
      });
    }
    ctx.commitTarget(mob.id);
    if (eligible.length === 0) {
      void ctx.logActivity(`No ideal targets nearby — fighting ${mob.name ?? "mob"} anyway`);
    }
    return engageCombatTarget(ctx, me, mob, entities);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] combat tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `combat:error:${ctx.currentRegion}` });
  }
}

function findZoneForOre(itemName: string): string | null {
  const target = itemName.toLowerCase();
  for (const def of ORE_SPAWN_DEFS) {
    const label = ORE_CATALOG[def.oreType]?.label.toLowerCase();
    if (label && (label.includes(target) || target.includes(label))) {
      return def.zoneId;
    }
  }
  return null;
}

function findZoneForFlower(itemName: string): string | null {
  const target = itemName.toLowerCase();
  for (const def of FLOWER_SPAWN_DEFS) {
    const label = FLOWER_CATALOG[def.flowerType]?.label.toLowerCase();
    if (label && (label.includes(target) || target.includes(label))) {
      return def.zoneId;
    }
  }
  return null;
}

function findZoneForNpc(npcName: string): string | null {
  const target = npcName.toLowerCase();
  for (const def of NPC_DEFS) {
    if (def.name.toLowerCase().includes(target)) {
      return def.zoneId;
    }
  }
  return null;
}

// ── Gathering ────────────────────────────────────────────────────────────────

export async function doGathering(
  ctx: AgentContext,
  strategy: AgentStrategy,
  preference: GatherPreference = "both",
  targetItemName?: string,
): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    // Prefer nodes that advance an active gather quest so quest progress
    // actually ticks (e.g., Herbalism 103 wants Meadow Lily — don't harvest
    // dandelions forever when a lily patch is nearby).
    let preferredItemName: string | null = targetItemName ?? null;
    try {
      if (!preferredItemName) {
        const activeRes = await ctx.api("GET", `/quests/active/${ctx.entityId}`);
        const activeQuests: any[] = activeRes?.activeQuests ?? [];
        for (const aq of activeQuests) {
          if (aq?.complete) continue;
          const obj = aq?.quest?.objective;
          if (obj?.type === "gather" && obj.targetItemName) {
            preferredItemName = String(obj.targetItemName);
            break;
          }
        }
      }
    } catch {
      // Quest lookup is best-effort; fall through with no preference.
    }

    const node = findGatherNode(
      entities,
      me,
      preference,
      (id) => ctx.isGatherNodeBlacklisted(id),
      preferredItemName,
      !!preferredItemName,
    );
    if (!node) {
      if (preferredItemName) {
        let targetZone = null;
        if (preference === "ore") {
          targetZone = findZoneForOre(preferredItemName);
        } else if (preference === "herb") {
          targetZone = findZoneForFlower(preferredItemName);
        } else {
          targetZone = findZoneForOre(preferredItemName) || findZoneForFlower(preferredItemName);
        }

        if (targetZone && targetZone !== ctx.currentRegion) {
          void ctx.logActivity(`Resource ${preferredItemName} not in ${ctx.currentRegion} — traveling to ${targetZone} to gather`);
          await autoPatchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone });
          ctx.setScript(null); // Force focus refresh
          return actionProgressed(`Traveling to ${targetZone} to gather ${preferredItemName}`);
        }
        return actionBlocked(`No ${preferredItemName} nodes available in ${ctx.currentRegion}`, {
          failureKey: `gather:missing-target:${ctx.currentRegion}:${preferredItemName.toLowerCase()}`,
          targetName: preferredItemName,
          category: "strategic",
        });
      }
      return fallbackToCombat(ctx, "No resource nodes in this zone", strategy);
    }

    const [nodeId, nodeEntity] = node;

    // Auto-learn required profession before attempting to gather
    if (nodeEntity.type === "ore-node") {
      const learned = await ctx.learnProfession("mining");
      if (!learned) return actionProgressed("Working toward mining access");
    } else {
      const learned = await ctx.learnProfession("herbalism");
      if (!learned) return actionProgressed("Working toward herbalism access");
    }

    const toolKind: GatheringToolKind = nodeEntity.type === "ore-node" ? "pickaxe" : "sickle";
    const toolReady = await ensureGatheringTool(
      ctx,
      entities,
      me,
      toolKind,
      requiredNodeTier(nodeEntity),
    );
    if (!toolReady) return actionProgressed(`Preparing ${toolKind} for gathering`);

    const moving = await ctx.moveToEntity(me, nodeEntity);
    if (moving) return actionProgressed(`Moving to ${nodeEntity.name ?? "resource node"}`);

    if (nodeEntity.type === "ore-node") {
      try {
        await ctx.api("POST", "/mining/gather", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, oreNodeId: nodeId,
        });
        void ctx.logActivity(`Mined ${nodeEntity.name ?? "ore node"}`);
        logZoneEvent({
          zoneId: ctx.currentRegion, type: "profession", tick: 0,
          message: `${me.name} is mining ${nodeEntity.name ?? "ore"}`,
          entityId: ctx.entityId, entityName: me.name,
          data: { profession: "mining", target: nodeEntity.name },
        });
        emitAgentChat({
          entityId: ctx.entityId, entityName: me.name ?? "Agent",
          zoneId: ctx.currentRegion, event: "gathering",
          origin: me.origin, classId: me.classId,
          detail: nodeEntity.name,
        });
        return actionCompleted(`Mined ${nodeEntity.name ?? "ore node"}`);
      } catch (err: any) {
        const reason = formatAgentError(err);
        if (/skill too low/i.test(reason)) {
          ctx.markGatherNodeBlacklisted(nodeId);
          void ctx.logActivity(`Skill too low for ${nodeEntity.name ?? "node"} — looking for easier nodes`);
          return actionBlocked(reason, {
            failureKey: `mining:skill:${ctx.currentRegion}`,
            endpoint: "/mining/gather",
            targetId: nodeId,
            targetName: nodeEntity.name,
            category: "strategic",
          });
        }
        void ctx.logActivity(`Mining failed: ${reason}`);
        return actionBlocked(reason, {
          failureKey: `mining:${nodeId}`,
          endpoint: "/mining/gather",
          targetId: nodeId,
          targetName: nodeEntity.name,
        });
      }
    } else {
      try {
        await ctx.api("POST", "/herbalism/gather", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, flowerNodeId: nodeId,
        });
        void ctx.logActivity(`Gathered ${nodeEntity.name ?? "flower node"}`);
        logZoneEvent({
          zoneId: ctx.currentRegion, type: "profession", tick: 0,
          message: `${me.name} is foraging ${nodeEntity.name ?? "herbs"}`,
          entityId: ctx.entityId, entityName: me.name,
          data: { profession: "herbalism", target: nodeEntity.name },
        });
        emitAgentChat({
          entityId: ctx.entityId, entityName: me.name ?? "Agent",
          zoneId: ctx.currentRegion, event: "gathering",
          origin: me.origin, classId: me.classId,
          detail: nodeEntity.name,
        });
        return actionCompleted(`Gathered ${nodeEntity.name ?? "flower node"}`);
      } catch (err: any) {
        const reason = formatAgentError(err);
        // Skill too low — blacklist this node and try a lower-tier one
        if (/skill too low/i.test(reason)) {
          ctx.markGatherNodeBlacklisted(nodeId);
          void ctx.logActivity(`Skill too low for ${nodeEntity.name ?? "node"} — looking for easier nodes`);
          return actionBlocked(reason, {
            failureKey: `herbalism:skill:${ctx.currentRegion}`,
            endpoint: "/herbalism/gather",
            targetId: nodeId,
            targetName: nodeEntity.name,
            category: "strategic",
          });
        }
        void ctx.logActivity(`Herbalism failed: ${reason}`);
        return actionBlocked(reason, {
          failureKey: `herbalism:${nodeId}`,
          endpoint: "/herbalism/gather",
          targetId: nodeId,
          targetName: nodeEntity.name,
        });
      }
    }
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] gathering tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `gather:error:${ctx.currentRegion}` });
  }
}

// ── Farming ─────────────────────────────────────────────────────────────────

function findCropNode(
  entities: Record<string, any>,
  me: any,
): [string, any] | null {
  const matches = Object.entries(entities)
    .filter(([, e]) => e.type === "crop-node" && !e.depletedAtTick && (e.charges ?? 0) > 0)
    .sort(([, a], [, b]) => {
      const tierA = a.requiredHoeTier ?? 1;
      const tierB = b.requiredHoeTier ?? 1;
      const tierDiff = tierA - tierB;
      if (tierDiff !== 0) return tierDiff;
      return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    });
  return matches[0] as [string, any] ?? null;
}

export async function doFarming(
  ctx: AgentContext,
  strategy: AgentStrategy,
): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const node = findCropNode(entities, me);
    if (!node) {
      return fallbackToCombat(ctx, "No crop nodes in this zone — travel to a farmland zone", strategy);
    }

    const [nodeId, nodeEntity] = node;

    // Ensure a hoe is equipped — buy one if needed
    const equipped = me.equipment?.weapon;
    const equippedHoeTier = equipped ? (HOE_TOKENS[equipped.tokenId] ?? 0) : 0;
    if (equippedHoeTier === 0) {
      const merchant = Object.entries(entities).find(
        ([, e]) => e.type === "npc" && (e.npcRole === "merchant" || e.npcRole === "shop"),
      );
      if (merchant) {
        const [, merchantEntity] = merchant;
        const moving = await ctx.moveToEntity(me, merchantEntity);
        if (moving) return actionProgressed("Moving to merchant to buy a hoe");
        try {
          await ctx.api("POST", "/shop/buy", {
            walletAddress: ctx.custodialWallet,
            zoneId: ctx.currentRegion,
            entityId: ctx.entityId,
            tokenId: "220",
            quantity: 1,
          });
          await ctx.api("POST", "/equipment/equip", {
            walletAddress: ctx.custodialWallet,
            tokenId: "220",
            entityId: ctx.entityId,
          });
          void ctx.logActivity("Bought and equipped Wooden Hoe");
          return actionProgressed("Equipped a hoe — ready to farm");
        } catch (err: any) {
          return actionBlocked(formatAgentError(err), {
            failureKey: "farm:buy-hoe",
            endpoint: "/shop/buy",
          });
        }
      }
      return actionBlocked("No hoe equipped and no merchant nearby", { failureKey: "farm:no-hoe" });
    }

    // Move to crop node
    const moving = await ctx.moveToEntity(me, nodeEntity);
    if (moving) return actionProgressed(`Moving to ${nodeEntity.name ?? "crop node"}`);

    // Harvest
    try {
      await ctx.api("POST", "/farming/harvest", {
        walletAddress: ctx.custodialWallet,
        zoneId: ctx.currentRegion,
        entityId: ctx.entityId,
        cropNodeId: nodeId,
      });
      void ctx.logActivity(`Harvested ${nodeEntity.name ?? "crop"}`);
      logZoneEvent({
        zoneId: ctx.currentRegion, type: "profession", tick: 0,
        message: `${me.name} is harvesting ${nodeEntity.name ?? "crops"}`,
        entityId: ctx.entityId, entityName: me.name,
        data: { profession: "farming", target: nodeEntity.name },
      });
      emitAgentChat({
        entityId: ctx.entityId, entityName: me.name ?? "Agent",
        zoneId: ctx.currentRegion, event: "gathering",
        origin: me.origin, classId: me.classId,
        detail: nodeEntity.name,
      });
      return actionCompleted(`Harvested ${nodeEntity.name ?? "crop"}`);
    } catch (err: any) {
      const reason = formatAgentError(err);
      void ctx.logActivity(`Farming failed: ${reason}`);
      return actionBlocked(reason, {
        failureKey: `farm:${nodeId}`,
        endpoint: "/farming/harvest",
        targetId: nodeId,
        targetName: nodeEntity.name,
      });
    }
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] farming tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `farm:error:${ctx.currentRegion}` });
  }
}

// ── Alchemy ──────────────────────────────────────────────────────────────────

export async function doAlchemy(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    // Auto-learn alchemy profession before attempting to brew
    const learned = await ctx.learnProfession("alchemy");
    if (!learned) {
      const failure = ctx.getLastLearnFailure("alchemy");
      if (failure?.category === "strategic") {
        // Unrecoverable: insufficient gold, wrong class, etc. Block instead of
        // pretending progress was made so the circuit breaker rotates focus.
        return actionBlocked(`Alchemy learn blocked: ${failure.reason}`, {
          failureKey: "alchemy:learn-blocked",
          endpoint: "/professions/learn",
          category: "strategic",
        });
      }
      return actionProgressed("Working toward alchemy access");
    }

    const lab = ctx.findNearestEntity(entities, me, (e) => e.type === "alchemy-lab");
    if (!lab) {
      const reason = `Stuck on alchemy: no alchemy lab in ${ctx.currentRegion}; not auto-gathering`;
      void ctx.logActivity(reason);
      ctx.setScript({ type: "idle", reason });
      return actionIdle(reason);
    }

    const [labId, labEntity] = lab;

    // Fetch recipes and inventory BEFORE walking to the lab. If no recipe is
    // brewable with current materials, commit to gathering — otherwise the
    // agent thrashes between "walk to lab → brew fails → walk to herb node →
    // walk back to lab" forever without ever gathering a full herb.
    const recipesRes = await ctx.api("GET", "/alchemy/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);
    if (recipes.length === 0) {
      const reason = "Stuck on alchemy: no recipes available; not auto-gathering";
      void ctx.logActivity(reason);
      ctx.setScript({ type: "idle", reason });
      return actionIdle(reason);
    }

    // Fetch current alchemy skill level so we don't pick recipes the server
    // will 400-reject for "Alchemy skill too low for this recipe". Without
    // this filter the agent spams /alchemy/brew every cooldown forever.
    let alchemyLevel = 1;
    try {
      const profRes = await ctx.api("GET", `/professions/${ctx.custodialWallet}`);
      alchemyLevel = Number(profRes?.skills?.alchemy?.level ?? 1) || 1;
    } catch { /* fall back to level 1 */ }

    const invRes = await ctx.api("GET", `/inventory/${ctx.custodialWallet}`);
    const invItems: Array<{ tokenId: number; quantity: number }> = invRes?.items ?? [];
    const haveQty = new Map<number, number>();
    for (const it of invItems) haveQty.set(Number(it.tokenId), Number(it.quantity ?? 0));

    const meetsSkill = (recipe: any): boolean => {
      const req = Number(recipe.requiredSkillLevel ?? 1);
      return alchemyLevel >= req;
    };
    const canBrew = (recipe: any): boolean => {
      const mats: Array<{ tokenId: string | number; quantity: number }> = recipe.materials ?? [];
      if (mats.length === 0) return true;
      for (const m of mats) {
        const need = Number(m.quantity ?? 0);
        const have = haveQty.get(Number(m.tokenId)) ?? 0;
        if (have < need) return false;
      }
      return true;
    };

    const skillFiltered = recipes.filter(meetsSkill);
    if (skillFiltered.length === 0) {
      // The recipe catalog has at least one tier-1 recipe at requiredSkillLevel 1,
      // so reaching here means alchemyLevel resolved to 0 or the catalog is empty.
      const reason = `Stuck on alchemy: skill level ${alchemyLevel} below every recipe; grind tier-1 brews`;
      void ctx.logActivity(reason);
      return actionBlocked(reason, {
        failureKey: `alchemy:skill-too-low:${alchemyLevel}`,
        endpoint: "/alchemy/brew",
        category: "strategic",
      });
    }
    const brewable = skillFiltered.filter(canBrew);
    if (brewable.length === 0) {
      void ctx.logActivity("Missing alchemy ingredients — gathering herbs");
      return doGathering(ctx, strategy, "herb");
    }

    const moving = await ctx.moveToEntity(me, labEntity);
    if (moving) return actionProgressed(`Moving to ${labEntity.name ?? "alchemy lab"}`);

    let lastError: string | null = null;
    for (const recipe of brewable) {
      try {
        await ctx.api("POST", "/alchemy/brew", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, alchemyLabId: labId,
          recipeId: recipe.recipeId ?? recipe.id,
        });
        console.log(`[agent:${ctx.walletTag}] Brewed ${recipe.name ?? recipe.recipeId}`);
        void ctx.logActivity(`Brewed ${recipe.name ?? recipe.recipeId}`);
        logZoneEvent({
          zoneId: ctx.currentRegion, type: "profession", tick: 0,
          message: `${zs.me.name} is brewing ${recipe.name ?? recipe.recipeId}`,
          entityId: ctx.entityId, entityName: zs.me.name,
          data: { profession: "alchemy", target: recipe.name ?? recipe.recipeId },
        });
        emitAgentChat({
          entityId: ctx.entityId, entityName: zs.me.name ?? "Agent",
          zoneId: ctx.currentRegion, event: "brewing",
          origin: zs.me.origin, classId: zs.me.classId,
          detail: recipe.name ?? recipe.recipeId,
        });
        return actionCompleted(`Brewed ${recipe.name ?? recipe.recipeId}`);
      } catch (err: any) {
        lastError = formatAgentError(err);
        console.debug(`[agent:${ctx.walletTag}] brew ${recipe.name ?? recipe.recipeId}: ${lastError.slice(0, 60)}`);
      }
    }

    const reason = `Stuck on alchemy: brew attempts failed${lastError ? ` (${lastError})` : ""}; not auto-gathering`;
    void ctx.logActivity(reason);
    ctx.setScript({ type: "idle", reason });
    return actionIdle(reason);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] alchemy tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `alchemy:error:${ctx.currentRegion}` });
  }
}

// ── Craft-quest executor ────────────────────────────────────────────────────
//
// Drives craft objectives like "Smelt 2 Tin Bars" by (1) looking up which
// recipe produces the target item, (2) gathering any missing materials, and
// (3) walking to the right station (forge / tanning-rack / etc.) to craft.
// Without this, craft quests fell through to `doGathering` and the agent
// would mine ore forever but never actually smelt a bar.

async function doQuestSupportObjective(
  ctx: AgentContext,
  strategy: AgentStrategy,
  activeQuests: any[],
): Promise<ActionResult | null> {
  const craftQuest = activeQuests.find(
    (aq: any) => !aq.complete && aq.quest?.objective?.type === "craft" && aq.quest?.objective?.targetItemName,
  );
  if (craftQuest) {
    const target = String(craftQuest.quest.objective.targetItemName);
    void ctx.logActivity(`Crafting ${target} for quest`);
    return doCraftQuest(ctx, strategy, target);
  }

  const gatherQuest = activeQuests.find(
    (aq: any) => !aq.complete && aq.quest?.objective?.type === "gather" && aq.quest?.objective?.targetItemName,
  );
  if (gatherQuest) {
    const target = String(gatherQuest.quest.objective.targetItemName);
    if (/^corpse$/i.test(target)) {
      void ctx.logActivity("Skinning corpses for quest");
      const skinResult = await doSkinning(ctx, strategy);
      if (skinResult.status === "blocked" && /no skinnable corpses/i.test(skinResult.reason ?? "")) {
        return doCombat(ctx, strategy);
      }
      return skinResult;
    }
    const preference: GatherPreference = findZoneForOre(target) && !findZoneForFlower(target)
      ? "ore"
      : findZoneForFlower(target) && !findZoneForOre(target)
        ? "herb"
        : "both";
    void ctx.logActivity(`Gathering ${target} for quest`);
    return doGathering(ctx, strategy, preference, target);
  }

  return null;
}

async function doCraftQuest(
  ctx: AgentContext,
  strategy: AgentStrategy,
  targetItemName: string,
): Promise<ActionResult> {
  try {
    const targetLC = targetItemName.toLowerCase();

    // Enchanting quests (e.g. "Enchanted", "Enchantment") are handled by the
    // enchanting system, not a recipe book. Redirect immediately.
    if (targetLC.includes("enchant")) {
      void ctx.logActivity(`Enchanting for quest: ${targetItemName}`);
      return doEnchanting(ctx, strategy);
    }

    let match: {
      recipe: any;
      allRecipes: any[];
      profession: CraftProfession;
      craftEndpoint: string;
      stationType: string;
      stationField: string;
    } | null = null;

    for (const book of QUEST_CRAFT_RECIPE_BOOKS) {
      const recipesRes = await ctx.api("GET", book.recipesEndpoint);
      const recipes: any[] = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);
      const recipe = recipes.find((r) => {
        const name = getRecipeOutputName(r).toLowerCase();
        if (!name) return false;
        return name === targetLC || name.includes(targetLC) || targetLC.includes(name);
      });
      if (recipe) {
        match = {
          recipe,
          allRecipes: recipes,
          profession: book.profession,
          craftEndpoint: book.craftEndpoint,
          stationType: book.stationType,
          stationField: book.stationField,
        };
        break;
      }
    }

    if (!match) {
      const reason = `No known recipe produces "${targetItemName}"`;
      void ctx.logActivity(`${reason} — idling`);
      ctx.setScript({ type: "idle", reason });
      return actionBlocked(reason, { failureKey: `craft:no-recipe:${targetLC}` });
    }

    const { recipe, allRecipes, profession, craftEndpoint, stationType, stationField } = match;
    const learned = await ctx.learnProfession(profession as any);
    if (!learned) {
      return actionBlocked(`Could not learn ${profession}`, {
        failureKey: `craft:learn:${profession}:${ctx.currentRegion}`,
      });
    }

    const invRes = await ctx.api("GET", `/inventory/${ctx.custodialWallet}`);
    const invItems: Array<{ tokenId: number; quantity: number }> = invRes?.items ?? [];
    const haveQty = new Map<number, number>();
    for (const it of invItems) haveQty.set(Number(it.tokenId), Number(it.quantity ?? 0));

    const hasMaterials = (r: any): boolean =>
      getRecipeMaterials(r).every((m) => (haveQty.get(m.tokenId) ?? 0) >= m.quantity);

    // Skill-grind ladder: lower-tier recipes in the same profession that we
    // can fall back to if the target needs more skill than we have. Sorted
    // descending by required skill so we pick the highest XP-yielding craft
    // we can actually afford. Excludes the target itself.
    const targetSkill = Number(recipe.requiredSkillLevel ?? 1);
    const grindLadder = allRecipes
      .filter((r) => r !== recipe)
      .filter((r) => Number(r.requiredSkillLevel ?? 1) < targetSkill)
      .filter(hasMaterials)
      .sort(
        (a, b) => Number(b.requiredSkillLevel ?? 1) - Number(a.requiredSkillLevel ?? 1),
      );

    if (!hasMaterials(recipe)) {
      const missing = getRecipeMaterials(recipe).find((m) => (haveQty.get(m.tokenId) ?? 0) < m.quantity)!;
      void ctx.logActivity(`Need ${missing.quantity}x ${missing.name} for ${targetItemName}`);
      return recoverMissingMaterial(ctx, strategy, profession, missing.name);
    }

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const station = ctx.findNearestEntity(entities, me, (e: any) => e.type === stationType);
    if (!station) {
      return routeToProfessionHubForStation(ctx, stationType, strategy);
    }

    const [stationId, stationEntity] = station;
    const moving = await ctx.moveToEntity(me, stationEntity);
    if (moving) return actionProgressed(`Moving to ${stationEntity.name ?? stationType}`);

    const tryCraft = async (r: any): Promise<{ ok: true; label: string } | { ok: false; reason: string }> => {
      try {
        const result = await ctx.api("POST", craftEndpoint, {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, [stationField]: stationId, recipeId: r.recipeId,
        });
        const label = result?.crafted?.displayName
          ?? result?.brewed?.name
          ?? result?.crafted?.name
          ?? getRecipeOutputName(r)
          ?? r.recipeId;
        return { ok: true, label };
      } catch (err: any) {
        return { ok: false, reason: formatAgentError(err) };
      }
    };

    const announce = (label: string, isGrind: boolean) => {
      void ctx.logActivity(isGrind ? `Crafted ${label} (grinding ${profession} skill for ${targetItemName})` : `Crafted ${label}`);
      logZoneEvent({
        zoneId: ctx.currentRegion, type: "profession", tick: 0,
        message: `${me.name} crafted ${label}`,
        entityId: ctx.entityId, entityName: me.name,
        data: { profession, target: label },
      });
      emitAgentChat({
        entityId: ctx.entityId, entityName: me.name ?? "Agent",
        zoneId: ctx.currentRegion, event: "crafting",
        origin: me.origin, classId: me.classId,
        detail: label,
      });
    };

    const targetAttempt = await tryCraft(recipe);
    if (targetAttempt.ok) {
      announce(targetAttempt.label, false);
      return actionCompleted(`Crafted ${targetAttempt.label}`);
    }

    // Skill-too-low → grind a lower-tier recipe to earn XP, then retry the
    // target on a future tick. Without this, e.g. cooking_103 (Hearty Stew,
    // skill 15) is impossible for a freshly-trained level-1 cook.
    if (/skill too low/i.test(targetAttempt.reason) && grindLadder.length > 0) {
      for (const fallback of grindLadder) {
        const grindAttempt = await tryCraft(fallback);
        if (grindAttempt.ok) {
          announce(grindAttempt.label, true);
          return actionProgressed(`Grinding ${profession} via ${grindAttempt.label} toward ${targetItemName}`);
        }
        if (!/skill too low/i.test(grindAttempt.reason)) {
          // A non-skill error (cooldown, materials race, station range) — bail
          // and let the outer loop retry next tick instead of trying every rung.
          console.debug(`[agent:${ctx.walletTag}] grind ${fallback.recipeId}: ${grindAttempt.reason.slice(0, 60)}`);
          return actionBlocked(grindAttempt.reason, {
            failureKey: `craft:grind:${fallback.recipeId}:${ctx.currentRegion}`,
            endpoint: craftEndpoint,
          });
        }
      }
    }

    console.debug(`[agent:${ctx.walletTag}] craft ${recipe.recipeId}: ${targetAttempt.reason.slice(0, 60)}`);
    return actionBlocked(targetAttempt.reason, {
      failureKey: `craft:${recipe.recipeId}:${ctx.currentRegion}`,
      endpoint: craftEndpoint,
    });
  } catch (err: any) {
    const reason = formatAgentError(err);
    return actionBlocked(reason, { failureKey: `craft:error:${ctx.currentRegion}` });
  }
}

export async function doSkinning(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  const result = await doSkinningProfession(ctx);
  if (result.status === "blocked" && /no skinnable corpses/i.test(result.reason ?? "")) {
    void ctx.logActivity("No corpses to skin — making some");
    return doCombat(ctx, strategy);
  }
  return result;
}

// ── Cooking ──────────────────────────────────────────────────────────────────

export async function doCooking(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    // Auto-learn cooking profession. If learnProfession returns false it has
    // already queued a trainer-detour chain — setting focus=idle here would
    // pin the script and block the queue from draining. Return progressed
    // so the queue gets to run on the next tick.
    const learned = await ctx.learnProfession("cooking");
    if (!learned) return actionProgressed("Working toward cooking access");

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const campfire = ctx.findNearestEntity(entities, me, (e) => e.type === "campfire");
    if (!campfire) {
      return routeToProfessionHubForStation(ctx, "campfire", strategy);
    }

    const [campfireId, campfireEntity] = campfire;
    const moving = await ctx.moveToEntity(me, campfireEntity);
    if (moving) return actionProgressed(`Moving to ${campfireEntity.name ?? "campfire"}`);

    const recipesRes = await ctx.api("GET", "/cooking/recipes");
    const recipes = recipesRes?.recipes ?? [];
    const invRes = await ctx.api("GET", `/inventory/${ctx.custodialWallet}`);
    const missingPlan = firstMissingRecipeMaterial(recipes, invRes?.items ?? []);
    if (missingPlan) {
      void ctx.logActivity(`Stuck on cooking: need ${missingPlan.missing.name}`);
      return recoverMissingMaterial(ctx, strategy, "cooking", missingPlan.missing.name);
    }

    let lastError: string | null = null;
    for (const recipe of recipes) {
      try {
        await ctx.api("POST", "/cooking/cook", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, campfireId,
          recipeId: recipe.recipeId ?? recipe.id,
        });
        console.log(`[agent:${ctx.walletTag}] Cooked ${recipe.name ?? recipe.recipeId}`);
        void ctx.logActivity(`Cooked ${recipe.name ?? recipe.recipeId}`);
        logZoneEvent({
          zoneId: ctx.currentRegion, type: "profession", tick: 0,
          message: `${zs.me.name} is cooking ${recipe.name ?? recipe.recipeId}`,
          entityId: ctx.entityId, entityName: zs.me.name,
          data: { profession: "cooking", target: recipe.name ?? recipe.recipeId },
        });
        emitAgentChat({
          entityId: ctx.entityId, entityName: zs.me.name ?? "Agent",
          zoneId: ctx.currentRegion, event: "cooking",
          origin: zs.me.origin, classId: zs.me.classId,
          detail: recipe.name ?? recipe.recipeId,
        });
        return actionCompleted(`Cooked ${recipe.name ?? recipe.recipeId}`);
      } catch (err: any) {
        lastError = formatAgentError(err);
        console.debug(`[agent:${ctx.walletTag}] cook ${recipe.name ?? recipe.recipeId}: ${lastError.slice(0, 60)}`);
      }
    }

    const stuckReason = "Stuck on cooking: no cookable recipes; not auto-gathering";
    void ctx.logActivity(stuckReason);
    ctx.setScript({ type: "idle", reason: stuckReason });
    return lastError ? actionBlocked(lastError, {
      failureKey: `cooking:cook:${ctx.currentRegion}`,
      endpoint: "/cooking/cook",
    }) : actionIdle(stuckReason);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] cooking tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `cooking:error:${ctx.currentRegion}` });
  }
}

// ── Enchanting ───────────────────────────────────────────────────────────────

export async function doEnchanting(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const altar = ctx.findNearestEntity(entities, me, (e) => e.type === "enchanting-altar");
    if (!altar) {
      return fallbackToCombat(ctx, "No enchanting altar in this zone", strategy);
    }

    const [altarId, altarEntity] = altar;
    const moving = await ctx.moveToEntity(me, altarEntity);
    if (moving) return actionProgressed(`Moving to ${altarEntity.name ?? "enchanting altar"}`);

    const ENCHANT_SLOTS = ["weapon", "chest", "helm", "legs", "shoulders", "boots", "gloves", "belt"] as const;
    const targetSlot = ENCHANT_SLOTS.find((slot) => {
      const item = (me.equipment as any)?.[slot];
      return item && (!item.enchantments || item.enchantments.length === 0);
    });

    if (!targetSlot) {
      void ctx.logActivity("All equipped items are already enchanted — crafting more gear");
      return doCrafting(ctx, strategy);
    }

    const { items } = await ctx.getWalletBalance();
    const elixir = items.find((i: any) =>
      ENCHANTMENT_ELIXIR_TOKENS.has(Number(i.tokenId))
      && Number(i.balance) > 0,
    );
    if (!elixir) {
      void ctx.logActivity("No enchantment elixirs — brewing some first");
      return doAlchemy(ctx, strategy);
    }

    await ctx.api("POST", "/enchanting/apply", {
      walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
      entityId: ctx.entityId, altarId,
      enchantmentElixirTokenId: Number(elixir.tokenId),
      equipmentSlot: targetSlot,
    });
    void ctx.logActivity(`Enchanted ${targetSlot} with ${elixir.name}`);
    logZoneEvent({
      zoneId: ctx.currentRegion, type: "profession", tick: 0,
      message: `${me.name} enchanted ${targetSlot} with ${elixir.name}`,
      entityId: ctx.entityId, entityName: me.name,
      data: { profession: "enchanting", target: elixir.name },
    });
    return actionCompleted(`Enchanted ${targetSlot} with ${elixir.name}`);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] enchanting tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `enchanting:error:${ctx.currentRegion}` });
  }
}

// ── Crafting ─────────────────────────────────────────────────────────────────

export async function doCrafting(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const learned = await ctx.learnProfession("blacksmithing");
    if (!learned) return actionProgressed("Working toward blacksmithing access");

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const forge = ctx.findNearestEntity(entities, me, (e) => e.type === "forge");
    if (!forge) {
      return fallbackToCombat(ctx, "No forge in this zone", strategy);
    }

    const [forgeId, forgeEntity] = forge;
    const moving = await ctx.moveToEntity(me, forgeEntity);
    if (moving) return actionProgressed(`Moving to ${forgeEntity.name ?? "forge"}`);

    const recipesRes = await ctx.api("GET", "/crafting/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);

    // Pre-check: find a recipe whose missing materials we can auto-gather.
    // Without this, doCrafting would loop forge attempts → all 500 → idle.
    let recipeToGatherFor: { recipeId: string; missing: { tokenId: bigint; quantity: number; have: bigint } } | null = null;
    for (const recipe of recipes) {
      const recipeId = recipe.recipeId ?? recipe.id;
      const fullRecipe = getCraftingRecipeById(recipeId);
      if (!fullRecipe) continue;
      let firstMissing: { tokenId: bigint; quantity: number; have: bigint } | null = null;
      for (const mat of fullRecipe.requiredMaterials) {
        let have = 0n;
        try { have = await getItemBalance(ctx.custodialWallet, mat.tokenId); } catch {}
        if (have < BigInt(mat.quantity)) {
          firstMissing = { tokenId: mat.tokenId, quantity: mat.quantity, have };
          break;
        }
      }
      if (!firstMissing) { recipeToGatherFor = null; break; } // we have all materials for this recipe — proceed to forge attempt below
      if (!recipeToGatherFor) recipeToGatherFor = { recipeId, missing: firstMissing };
    }

    if (recipeToGatherFor) {
      const { tokenId, quantity, have } = recipeToGatherFor.missing;
      const itemDef = getItemByTokenId(tokenId);
      const itemName = itemDef?.name ?? `tokenId ${tokenId}`;
      const isOre = Object.values(ORE_CATALOG).some((o) => o.tokenId === tokenId);
      const isFlower = Object.values(FLOWER_CATALOG).some((f) => f.tokenId === tokenId);
      if (isOre || isFlower) {
        const gatherPreference: GatherPreference = isOre ? "ore" : "herb";
        void ctx.logActivity(`Need ${quantity}× ${itemName} for ${recipeToGatherFor.recipeId} — gathering (have ${have})`);
        ctx.setScript({ type: "gather", nodeType: gatherPreference, reason: `Gathering ${itemName} for crafting` });
        return doGathering(ctx, strategy, gatherPreference, itemName);
      }
    }

    let lastError: string | null = null;
    for (const recipe of recipes) {
      try {
        const result = await ctx.api("POST", "/crafting/forge", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, forgeId,
          recipeId: recipe.recipeId ?? recipe.id,
        });
        const craftedTokenId = Number(result?.crafted?.tokenId ?? 0);
        const craftedInstanceId = typeof result?.crafted?.instanceId === "string"
          ? result.crafted.instanceId
          : undefined;
        const craftedItem = craftedTokenId ? getItemByTokenId(BigInt(craftedTokenId)) : undefined;
        const craftedName = result?.crafted?.displayName ?? recipe.name ?? recipe.recipeId;
        console.log(`[agent:${ctx.walletTag}] Crafted ${craftedName}`);
        void ctx.logActivity(`Crafted ${craftedName}`);
        logZoneEvent({
          zoneId: ctx.currentRegion, type: "profession", tick: 0,
          message: `${me.name} is smithing ${craftedName}`,
          entityId: ctx.entityId, entityName: me.name,
          data: { profession: "crafting", target: craftedName },
        });
        emitAgentChat({
          entityId: ctx.entityId, entityName: me.name ?? "Agent",
          zoneId: ctx.currentRegion, event: "crafting",
          origin: me.origin, classId: me.classId,
          detail: craftedName,
        });

        if (craftedItem?.equipSlot && (!me.equipment?.[craftedItem.equipSlot] || craftedItem.equipSlot === "weapon")) {
          const equipped = await ctx.equipItem(craftedTokenId, craftedInstanceId);
          if (equipped) {
            void ctx.logActivity(`Equipped ${craftedName}`);
          }
        }
        return actionCompleted(`Crafted ${craftedName}`);
      } catch (err: any) {
        lastError = formatAgentError(err);
        console.debug(`[agent:${ctx.walletTag}] craft ${recipe.name ?? recipe.recipeId}: ${lastError.slice(0, 60)}`);
      }
    }

    const stuckReason = "Stuck on crafting: missing materials for all forge recipes; not auto-gathering";
    void ctx.logActivity(stuckReason);
    ctx.setScript({ type: "idle", reason: stuckReason });
    return lastError ? actionBlocked(lastError, {
      failureKey: `crafting:forge:${ctx.currentRegion}`,
      endpoint: "/crafting/forge",
    }) : actionIdle(stuckReason);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] crafting tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `crafting:error:${ctx.currentRegion}` });
  }
}

// ── Leatherworking ───────────────────────────────────────────────────────────

export async function doLeatherworking(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const learned = await ctx.learnProfession("leatherworking");
    if (!learned) return actionProgressed("Working toward leatherworking access");

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const rack = ctx.findNearestEntity(entities, me, (e) => e.type === "tanning-rack");
    if (!rack) {
      return routeToProfessionHubForStation(ctx, "tanning-rack", strategy);
    }

    const [rackId, rackEntity] = rack;
    const moving = await ctx.moveToEntity(me, rackEntity);
    if (moving) return actionProgressed(`Moving to ${rackEntity.name ?? "tanning rack"}`);

    const recipesRes = await ctx.api("GET", "/leatherworking/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);
    const invRes = await ctx.api("GET", `/inventory/${ctx.custodialWallet}`);
    const missingPlan = firstMissingRecipeMaterial(recipes, invRes?.items ?? []);
    if (missingPlan) {
      void ctx.logActivity(`Stuck on leatherworking: need ${missingPlan.missing.name}`);
      return recoverMissingMaterial(ctx, strategy, "leatherworking", missingPlan.missing.name);
    }

    let lastError: string | null = null;
    for (const recipe of recipes) {
      try {
        const result = await ctx.api("POST", "/leatherworking/craft", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, stationId: rackId,
          recipeId: recipe.recipeId ?? recipe.id,
        });
        const craftedTokenId = Number(result?.crafted?.tokenId ?? 0);
        const craftedInstanceId = typeof result?.crafted?.instanceId === "string"
          ? result.crafted.instanceId
          : undefined;
        const craftedItem = craftedTokenId ? getItemByTokenId(BigInt(craftedTokenId)) : undefined;
        const craftedName = result?.crafted?.displayName ?? recipe.name ?? recipe.recipeId;
        console.log(`[agent:${ctx.walletTag}] Leatherworked ${craftedName}`);
        void ctx.logActivity(`Crafted ${craftedName} (leatherworking)`);
        logZoneEvent({
          zoneId: ctx.currentRegion, type: "profession", tick: 0,
          message: `${me.name} is leatherworking ${craftedName}`,
          entityId: ctx.entityId, entityName: me.name,
          data: { profession: "leatherworking", target: craftedName },
        });
        emitAgentChat({
          entityId: ctx.entityId, entityName: me.name ?? "Agent",
          zoneId: ctx.currentRegion, event: "crafting",
          origin: me.origin, classId: me.classId,
          detail: craftedName,
        });

        if (craftedItem?.equipSlot && (!me.equipment?.[craftedItem.equipSlot] || craftedItem.equipSlot === "weapon")) {
          const equipped = await ctx.equipItem(craftedTokenId, craftedInstanceId);
          if (equipped) {
            void ctx.logActivity(`Equipped ${craftedName}`);
          }
        }
        return actionCompleted(`Leatherworked ${craftedName}`);
      } catch (err: any) {
        lastError = formatAgentError(err);
        console.debug(`[agent:${ctx.walletTag}] leatherwork ${recipe.name ?? recipe.recipeId}: ${lastError.slice(0, 60)}`);
      }
    }

    const stuckReason = "Stuck on leatherworking: missing materials for all recipes; not auto-skinning";
    void ctx.logActivity(stuckReason);
    ctx.setScript({ type: "idle", reason: stuckReason });
    return lastError ? actionBlocked(lastError, {
      failureKey: `leatherworking:craft:${ctx.currentRegion}`,
      endpoint: "/leatherworking/craft",
    }) : actionIdle(stuckReason);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] leatherworking tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `leatherworking:error:${ctx.currentRegion}` });
  }
}

// ── Jewelcrafting ────────────────────────────────────────────────────────────

export async function doJewelcrafting(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const learned = await ctx.learnProfession("jewelcrafting");
    if (!learned) return actionProgressed("Working toward jewelcrafting access");

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const bench = ctx.findNearestEntity(entities, me, (e) => e.type === "jewelers-bench");
    if (!bench) {
      return routeToProfessionHubForStation(ctx, "jewelers-bench", strategy);
    }

    const [stationId, benchEntity] = bench;
    const moving = await ctx.moveToEntity(me, benchEntity);
    if (moving) return actionProgressed(`Moving to ${benchEntity.name ?? "jeweler's bench"}`);

    const recipesRes = await ctx.api("GET", "/jewelcrafting/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);
    const invRes = await ctx.api("GET", `/inventory/${ctx.custodialWallet}`);
    const missingPlan = firstMissingRecipeMaterial(recipes, invRes?.items ?? []);
    if (missingPlan) {
      void ctx.logActivity(`Stuck on jewelcrafting: need ${missingPlan.missing.name}`);
      return recoverMissingMaterial(ctx, strategy, "jewelcrafting", missingPlan.missing.name);
    }

    let lastError: string | null = null;
    for (const recipe of recipes) {
      try {
        const result = await ctx.api("POST", "/jewelcrafting/craft", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, stationId,
          recipeId: recipe.recipeId ?? recipe.id,
        });
        const craftedTokenId = Number(result?.crafted?.tokenId ?? 0);
        const craftedInstanceId = typeof result?.crafted?.instanceId === "string"
          ? result.crafted.instanceId
          : undefined;
        const craftedItem = craftedTokenId ? getItemByTokenId(BigInt(craftedTokenId)) : undefined;
        const craftedName = result?.crafted?.displayName ?? recipe.name ?? recipe.recipeId;
        console.log(`[agent:${ctx.walletTag}] Jewelcrafted ${craftedName}`);
        void ctx.logActivity(`Jewelcrafted ${craftedName}`);
        logZoneEvent({
          zoneId: ctx.currentRegion, type: "profession", tick: 0,
          message: `${me.name} is jewelcrafting ${craftedName}`,
          entityId: ctx.entityId, entityName: me.name,
          data: { profession: "jewelcrafting", target: craftedName },
        });
        emitAgentChat({
          entityId: ctx.entityId, entityName: me.name ?? "Agent",
          zoneId: ctx.currentRegion, event: "crafting",
          origin: me.origin, classId: me.classId,
          detail: craftedName,
        });

        if (craftedItem?.equipSlot && (!me.equipment?.[craftedItem.equipSlot])) {
          const equipped = await ctx.equipItem(craftedTokenId, craftedInstanceId);
          if (equipped) {
            void ctx.logActivity(`Equipped ${craftedName}`);
          }
        }
        return actionCompleted(`Jewelcrafted ${craftedName}`);
      } catch (err: any) {
        lastError = formatAgentError(err);
        console.debug(`[agent:${ctx.walletTag}] jewelcraft ${recipe.name ?? recipe.recipeId}: ${lastError.slice(0, 60)}`);
      }
    }

    const stuckReason = "Stuck on jewelcrafting: missing materials for all recipes; not auto-gathering";
    void ctx.logActivity(stuckReason);
    ctx.setScript({ type: "idle", reason: stuckReason });
    return lastError ? actionBlocked(lastError, {
      failureKey: `jewelcrafting:craft:${ctx.currentRegion}`,
      endpoint: "/jewelcrafting/craft",
    }) : actionIdle(stuckReason);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] jewelcrafting tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `jewelcrafting:error:${ctx.currentRegion}` });
  }
}

// ── Shopping ─────────────────────────────────────────────────────────────────

export async function doShopping(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    // Skip merchants that recently failed us (couldn't equip anything from their stock)
    const merchant = ctx.findNearestEntity(entities, me, (e) => {
      if (e.type !== "merchant") return false;
      if (ctx.isInteractionOnCooldown(`shop:merchant:${e.id}`)) return false;
      return true;
    });
    if (!merchant) {
      return fallbackToCombat(ctx, "No usable merchants in this zone", strategy);
    }

    const [merchantId, merchantEntity] = merchant;
    const moving = await ctx.moveToEntity(me, merchantEntity);
    if (moving) return actionProgressed(`Moving to ${merchantEntity.name ?? "merchant"}`);

    const shopData = await ctx.api("GET", `/shop/npc/${merchantId}`);
    const items: any[] = shopData?.items ?? [];
    if (items.length === 0) {
      return fallbackToCombat(ctx, "Merchant has nothing to sell", strategy);
    }

    const equipment = me.equipment ?? {};
    const emptySlots: string[] = [];
    for (const slot of ["weapon", "chest", "legs", "boots", "helm", "shoulders", "gloves", "belt"]) {
      if (!equipment[slot]) emptySlots.push(slot);
    }

    if (emptySlots.length === 0) {
      void ctx.logActivity("Fully geared up — back to fighting");
      return doCombat(ctx, strategy);
    }

    const { copper: copperBalance } = await ctx.getWalletBalance();

    const meLevel = Number((me as any).level ?? 1);
    const meClassId = String((me as any).classId ?? "").toLowerCase();

    for (const slot of emptySlots) {
      const matching = items.filter((item: any) => {
        // Must be equippable in this slot
        const slotMatch = slot === "weapon"
          ? (item.equipSlot === "weapon" || item.category === "weapon")
          : (item.armorSlot === slot || item.equipSlot === slot);
        if (!slotMatch) return false;
        // Category must be one the equip endpoint accepts
        if (item.category !== "armor" && item.category !== "weapon" && item.category !== "tool") return false;
        // Must have durability metadata (required by /equipment/equip)
        if (!item.maxDurability || Number(item.maxDurability) <= 0) return false;
        // Respect any catalog-level restrictions (future-proof — shop endpoint may expose these)
        if (Array.isArray(item.allowedClasses) && meClassId && !item.allowedClasses.map((c: string) => c.toLowerCase()).includes(meClassId)) return false;
        if (typeof item.minLevel === "number" && meLevel < item.minLevel) return false;
        return true;
      }).sort((a: any, b: any) => (a.copperPrice ?? a.buyPrice ?? 9999) - (b.copperPrice ?? b.buyPrice ?? 9999));

      if (matching.length === 0) continue;

      // Pick first non-cooldowned item (don't re-try items that previously failed to equip)
      let cheapest: any = null;
      let tokenId = 0;
      for (const candidate of matching) {
        const cid = Number(candidate.tokenId);
        if (ctx.isInteractionOnCooldown(`equip:fail:${cid}`)) continue;
        cheapest = candidate;
        tokenId = cid;
        break;
      }
      if (!cheapest) continue;

      const priceCopper = cheapest.currentPrice ?? cheapest.copperPrice ?? cheapest.buyPrice ?? 0;
      if (priceCopper > copperBalance) continue;

      const equipFailKey = `equip:fail:${tokenId}`;

      // Ask summoner before expensive purchases (> 50% of balance)
      if (priceCopper > copperBalance * 0.5) {
        const goldPrice = Math.round(priceCopper / 100);
        const goldBalance = Math.round(copperBalance / 100);
        const asked = await ctx.askSummoner(
          `Buy ${cheapest.name ?? `item #${cheapest.tokenId}`} (${slot}) for ${goldPrice}g? I have ${goldBalance}g.`,
          ["Yes", "No"],
          { action: "buy", tokenId: cheapest.tokenId, slot, price: priceCopper },
        );
        if (asked) return actionProgressed("Waiting for summoner approval on purchase");
      }

      const bought = await ctx.buyItem(tokenId);
      if (!bought) continue;

      const equipResult = await ctx.equipItemWithReason(tokenId);
      if (!equipResult.ok) {
        const reason = equipResult.reason ?? "unknown";
        // Ownership race after all 3 retries = chain tx is truly lagging.
        // Short merchant cooldown so we don't hammer, but don't blacklist the item
        // since we DID buy it and it'll show up eventually.
        const isOwnershipRace = /does not own this item/i.test(reason);
        if (isOwnershipRace) {
          ctx.setInteractionCooldown(`shop:merchant:${merchantId}`, 60_000);
          void ctx.logActivity(`Bought ${cheapest.name ?? `token #${tokenId}`} — chain tx still propagating, will try to equip next visit`);
          return actionProgressed(`Bought ${cheapest.name ?? `token #${tokenId}`}, equip pending chain confirmation`);
        }
        // Real equip failure (wrong class, missing metadata, instance mismatch):
        // blacklist the item for 15min AND the merchant for 3min.
        ctx.setInteractionCooldown(equipFailKey, 15 * 60_000);
        ctx.setInteractionCooldown(`shop:merchant:${merchantId}`, 3 * 60_000);
        void ctx.logActivity(`Bought ${cheapest.name ?? `token #${tokenId}`} but equip rejected: ${reason.slice(0, 80)} — avoiding ${merchantEntity.name ?? "merchant"} for 3m`);
        return actionBlocked(
          `Equip rejected: ${reason.slice(0, 80)}`,
          { failureKey: equipFailKey, endpoint: "/equipment/equip", category: "strategic" },
        );
      }

      console.log(`[agent:${ctx.walletTag}] Shopping: bought+equipped ${cheapest.name ?? tokenId} for slot=${slot}`);
      void ctx.logActivity(`Bought & equipped ${cheapest.name ?? `token #${tokenId}`} (${slot})`);
      emitAgentChat({
        entityId: ctx.entityId, entityName: zs.me.name ?? "Agent",
        zoneId: ctx.currentRegion, event: "npc_shop",
        origin: zs.me.origin, classId: zs.me.classId,
        detail: cheapest.name ?? `token #${tokenId}`,
      });
      return actionCompleted(`Bought ${cheapest.name ?? `token #${tokenId}`}`); // one purchase per tick
    }

    // Nothing this merchant sells fits — cooldown them so we don't walk back next tick
    ctx.setInteractionCooldown(`shop:merchant:${merchantId}`, 3 * 60_000);
    void ctx.logActivity(`${merchantEntity.name ?? "Merchant"} has nothing useful — skipping for 3m`);
    return fallbackToCombat(ctx, "Can't afford any upgrades right now", strategy);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] shopping tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `shopping:error:${ctx.currentRegion}` });
  }
}

// ── Trading / Recycling ─────────────────────────────────────────────────────

export async function doTrading(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const inventory = await ctx.getLiquidationInventory();

    if (ctx.currentCaps.marketTradingEnabled && inventory.copper >= AUCTION_LISTING_FEE_COPPER) {
      const listing = pickAuctionListingCandidate(inventory.items);
      if (listing) {
        const cooldownKey = `auction:list:${ctx.currentRegion}:${listing.tokenId}`;
        if (!ctx.isInteractionOnCooldown(cooldownKey)) {
          try {
            const zs = await ctx.getZoneState();
            if (zs) {
              const { entities, me } = zs;
              const auctioneer = ctx.findNearestEntity(entities, me, (e) => e.type === "auctioneer");
              if (auctioneer) {
                const activeListingsRes = await ctx.api("GET", `/marketplace/my-listings/${ctx.custodialWallet}`);
                const activeListings = Array.isArray(activeListingsRes?.listings) ? activeListingsRes.listings : [];
                const alreadyListed = activeListings.some((entry: any) =>
                  entry?.status === "active"
                  && String(entry?.zoneId ?? "") === ctx.currentRegion
                  && Number(entry?.tokenId ?? -1) === listing.tokenId
                );

                if (alreadyListed) {
                  ctx.setInteractionCooldown(cooldownKey, AUCTION_RELIST_COOLDOWN_MS);
                } else {
                  const [, auctioneerEntity] = auctioneer;
                  const moving = await ctx.moveToEntity(me, auctioneerEntity);
                  if (moving) return actionProgressed(`Moving to ${auctioneerEntity.name ?? "auctioneer"}`);

                  try {
                    await ctx.api("POST", `/auctionhouse/${ctx.currentRegion}/create`, {
                      sellerAddress: ctx.custodialWallet,
                      tokenId: listing.tokenId,
                      quantity: listing.quantity,
                      startPrice: listing.startPrice,
                      durationMinutes: listing.durationMinutes,
                      buyoutPrice: listing.buyoutPrice,
                    });
                    ctx.setInteractionCooldown(cooldownKey, AUCTION_RELIST_COOLDOWN_MS);
                    void ctx.logActivity(
                      `Listed ${listing.quantity}x ${listing.itemName} on the auction house`
                    );
                    emitAgentChat({
                      entityId: ctx.entityId,
                      entityName: me.name ?? "Agent",
                      zoneId: ctx.currentRegion,
                      event: "npc_shop",
                      origin: me.origin,
                      classId: me.classId,
                      detail: `Listed ${listing.quantity}x ${listing.itemName} for auction`,
                    });
                    return actionCompleted(`Listed ${listing.quantity}x ${listing.itemName} on the auction house`);
                  } catch (err: any) {
                    const reason = formatAgentError(err);
                    console.debug(`[agent:${ctx.walletTag}] auction listing skipped: ${reason.slice(0, 80)}`);
                    if (
                      reason.includes("Insufficient gold for listing fee")
                      || reason.includes("Insufficient item balance")
                    ) {
                      ctx.setInteractionCooldown(cooldownKey, AUCTION_RELIST_COOLDOWN_MS);
                    }
                  }
                }
              }
            }
          } catch (err: any) {
            const reason = formatAgentError(err);
            console.debug(`[agent:${ctx.walletTag}] auction lookup skipped: ${reason.slice(0, 80)}`);
          }
        }
      }
    }

    const candidates = inventory.items
      .filter((item: any) => item.recyclableQuantity > 0)
      .filter((item: any) => (
        item.category === "material" ||
        item.category === "consumable" ||
        (item.category === "tool" && item.recyclableQuantity > 1)
      ))
      .sort((a: any, b: any) => {
        const totalA = Number(a.recycleCopperValue ?? 0) * Number(a.recyclableQuantity ?? 0);
        const totalB = Number(b.recycleCopperValue ?? 0) * Number(b.recyclableQuantity ?? 0);
        return totalB - totalA;
      });

    const best = candidates[0];
    if (best) {
      const quantity = Number(best.recyclableQuantity);
      const result = await ctx.recycleItem(Number(best.tokenId), quantity);
      if (result.ok) {
        void ctx.logActivity(`Traded ${quantity}x ${best.name} for ${result.totalPayoutCopper ?? 0}c`);
        return actionCompleted(`Traded ${quantity}x ${best.name}`);
      }
      void ctx.logActivity(`Recycle failed for ${best.name}: ${result.error ?? "unknown error"}`);
    }

    const zs = await ctx.getZoneState();
    if (zs) {
      const { me } = zs;
      const emptySlots = ["weapon", "chest", "legs", "boots", "helm", "shoulders", "gloves", "belt"]
        .filter((slot) => !me.equipment?.[slot]);
      if (emptySlots.length > 0 && inventory.copper >= 10) {
        return doShopping(ctx, strategy);
      }
    }

    return fallbackToCombat(ctx, "No goods worth trading right now", strategy);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] trading tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `trading:error:${ctx.currentRegion}` });
  }
}

// ── Travel ───────────────────────────────────────────────────────────────────

export async function doTravel(ctx: AgentContext, _strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const config = await getAgentConfig(ctx.userWallet);
    // Prefer the script's own targetZone (set by queue_actions / circuit breaker
    // chain) over config.targetZone — chat-driven `queue_actions` doesn't patch
    // config, and reading from config alone made doTravel fall straight into
    // the "arrived" branch and switch back to questing on the first tick.
    const scriptTargetZone = ctx.currentScript?.targetZone;
    const rawTargetZone = scriptTargetZone ?? config?.targetZone;
    const targetZone = resolveRegionId(rawTargetZone);

    if (rawTargetZone && !targetZone) {
      console.log(`[agent:${ctx.walletTag}] Invalid travel target zone: ${rawTargetZone}`);
      void ctx.logActivity(`Unknown destination "${rawTargetZone}" — clearing travel target`);
      await autoPatchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
      ctx.setScript(null);
      return actionCompleted(`Cleared invalid destination ${rawTargetZone}`);
    }

    if (!targetZone || targetZone === ctx.currentRegion) {
      console.log(`[agent:${ctx.walletTag}] Arrived at ${ctx.currentRegion}, switching to questing`);
      void ctx.logActivity(`Arrived at ${ctx.currentRegion}, resuming questing`);
      await autoPatchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
      ctx.setScript(null);
      return actionCompleted(`Arrived at ${ctx.currentRegion}`);
    }

    const center = getRegionCenter(targetZone);
    if (!center) {
      console.log(`[agent:${ctx.walletTag}] Unknown region: ${targetZone}`);
      await autoPatchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
      return actionBlocked(`Unknown region: ${targetZone}`, {
        failureKey: `travel:unknown:${targetZone}`,
        targetName: targetZone,
      });
    }

    const entity = getWorldEntity(ctx.entityId);
    if (!entity) {
      return actionBlocked(`Travel failed: entity not found`, {
        failureKey: `travel:entity:${ctx.entityId}`,
      });
    }
    entity.order = { action: "move", x: center.x, y: center.z };
    entity.travelTargetZone = targetZone;
    entity.gotoMode = true;
    console.log(`[agent:${ctx.walletTag}] Traveling ${ctx.currentRegion} → ${targetZone} (${center.x},${center.z})`);
    void ctx.logActivity(`Traveling ${ctx.currentRegion} → ${targetZone}`);
    return actionProgressed(`Traveling to ${targetZone}`);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.log(`[agent:${ctx.walletTag}] travel tick ERROR: ${reason.slice(0, 120)}`);
    return actionBlocked(reason, { failureKey: `travel:error:${ctx.currentRegion}` });
  }
}

// ── Goto NPC ─────────────────────────────────────────────────────────────────

export async function doGotoNpc(
  ctx: AgentContext,
  findNextZoneOnPath: (neighbors: Array<{ zone: string }>, targetZone: string) => string | null,
): Promise<ActionResult> {
  try {
    ctx.setEntityGotoMode(true);

    const config = await getAgentConfig(ctx.userWallet);
    const scriptGoto = ctx.currentScript?.type === "goto" ? ctx.currentScript : null;
    const resolveFocusAfterGoto = (): AgentFocus => {
      if (config?.resumeFocusAfterGoto && config.resumeFocusAfterGoto !== "goto") {
        return config.resumeFocusAfterGoto;
      }
      return "questing";
    };
    const clearGotoStateAndResume = async (
      reason: string,
      options?: { keepFocusIfNotGoto?: boolean; completed?: boolean; targetName?: string; targetId?: string },
    ): Promise<ActionResult> => {
      const shouldSwitchFocus =
        !options?.keepFocusIfNotGoto || !config || config.focus === "goto";
      const focusPatch = shouldSwitchFocus ? { focus: resolveFocusAfterGoto() } : {};
      await patchAgentConfig(ctx.userWallet, {
        gotoTarget: undefined,
        gotoPosition: undefined,
        resumeFocusAfterGoto: undefined,
        ...focusPatch,
      });
      ctx.setEntityGotoMode(false);
      ctx.setScript(null);
      return options?.completed
        ? actionCompleted(reason)
        : actionBlocked(reason, {
            failureKey: `goto:missing:${options?.targetId ?? "unknown"}`,
            targetId: options?.targetId,
            targetName: options?.targetName,
            category: "strategic",
          });
    };

    // ── Position-based goto (click-to-move) ─────────────────────────────
    const pos = config?.gotoPosition
      ?? (
        scriptGoto?.gotoX != null
          && scriptGoto?.gotoY != null
          && scriptGoto?.gotoZoneId
          ? { x: scriptGoto.gotoX, y: scriptGoto.gotoY, zoneId: scriptGoto.gotoZoneId }
          : undefined
      );
    if (pos) {
      // Wrong zone — travel there first
      if (pos.zoneId !== ctx.currentRegion) {
        const neighbors = getZoneConnections(ctx.currentRegion).map((zone) => ({
          zone,
          levelReq: ZONE_LEVEL_REQUIREMENTS[zone] ?? 1,
        }));
        const nextZone = neighbors.find((n) => n.zone === pos.zoneId)
          ? pos.zoneId
          : findNextZoneOnPath(neighbors, pos.zoneId);
        if (nextZone) {
          ctx.issueCommand({ action: "travel", targetZone: nextZone });
          void ctx.logActivity(`Heading to ${pos.zoneId} for waypoint`);
          return actionProgressed(`Traveling toward waypoint in ${pos.zoneId}`);
        }
        return actionBlocked(`No route to ${pos.zoneId}`, {
          failureKey: `goto:route:${pos.zoneId}`,
        });
      }

      // In the right zone — walk toward position
      const zs = await ctx.getZoneState();
      if (!zs) return actionIdle("Zone state unavailable");
      const { me } = zs;

      const dist = Math.hypot(pos.x - me.x, pos.y - me.y);
      if (dist <= GOTO_WAYPOINT_CLOSE_DIST) {
        // Arrived — clear position, idle
        void ctx.logActivity(`Arrived at waypoint (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
        return clearGotoStateAndResume("Arrived at waypoint", { completed: true, keepFocusIfNotGoto: true });
      }

      // Still walking — issue/reissue move command
      const moving = await ctx.moveToEntity(me, { x: pos.x, y: pos.y, name: "waypoint" } as any, GOTO_WAYPOINT_CLOSE_DIST);
      if (moving) {
        return actionProgressed("Walking to waypoint");
      }

      // moveToEntity returned false = close enough
      void ctx.logActivity(`Arrived at waypoint`);
      return clearGotoStateAndResume("Arrived at waypoint", { completed: true, keepFocusIfNotGoto: true });
    }

    // ── Entity-based goto (NPC click) ───────────────────────────────────
    const target = config?.gotoTarget
      ?? (
        scriptGoto?.targetEntityId && scriptGoto?.gotoZoneId
          ? {
              entityId: scriptGoto.targetEntityId,
              zoneId: scriptGoto.gotoZoneId,
              name: scriptGoto.targetName,
              action: scriptGoto.gotoAction,
              profession: scriptGoto.gotoProfession,
              techniqueId: scriptGoto.gotoTechniqueId,
              techniqueName: scriptGoto.gotoTechniqueName,
              questId: scriptGoto.gotoQuestId,
            }
          : undefined
      );
    if (!target) {
      return clearGotoStateAndResume("Goto target cleared", { completed: true, keepFocusIfNotGoto: true });
    }

    const { entityId: targetEntityId, zoneId: targetZoneId, name: targetName } = target;

    // Wrong zone — travel there first
    if (targetZoneId !== ctx.currentRegion) {
      const neighbors = getZoneConnections(ctx.currentRegion).map((zone) => ({
        zone,
        levelReq: ZONE_LEVEL_REQUIREMENTS[zone] ?? 1,
      }));
      const nextZone = neighbors.find((n) => n.zone === targetZoneId)
        ? targetZoneId
        : findNextZoneOnPath(neighbors, targetZoneId);
      if (nextZone) {
        ctx.issueCommand({ action: "travel", targetZone: nextZone });
        void ctx.logActivity(`Heading to ${targetZoneId} to find ${targetName ?? targetEntityId}`);
        return actionProgressed(`Traveling toward ${targetName ?? targetEntityId}`);
      }
      return actionBlocked(`No route to ${targetZoneId}`, {
        failureKey: `goto:route:${targetZoneId}`,
        targetName: targetName ?? targetEntityId,
      });
    }

    // In the right zone — find the entity
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    let targetEntity: any = entities[targetEntityId];
    if (!targetEntity && targetName) {
      const found = Object.entries(entities).find(
        ([, e]: [string, any]) => String(e.name ?? "").toLowerCase() === targetName.toLowerCase(),
      );
      if (found) targetEntity = found[1];
    }

    if (!targetEntity && targetName) {
      // Global discovery: NPC not here, find where they are
      const targetZone = findZoneForNpc(targetName);
      if (targetZone && targetZone !== ctx.currentRegion) {
        void ctx.logActivity(`Target NPC ${targetName} not in ${ctx.currentRegion} — traveling to ${targetZone}`);
        // Keep focus on "goto" but inject a travel script chain
        const chain: BotScript[] = [
          { type: "travel", targetZone, reason: `Travel to find ${targetName}` },
          { type: "goto", targetName, reason: `Find ${targetName} in ${targetZone}` }
        ];
        await ctx.enqueueActions(chain, true);
        return actionProgressed(`Traveling to ${targetZone} to find ${targetName}`);
      }
    }

    if (!targetEntity) {
      void ctx.logActivity(`Could not find ${targetName ?? targetEntityId} in ${ctx.currentRegion}`);
      return clearGotoStateAndResume(`Could not find ${targetName ?? targetEntityId} in ${ctx.currentRegion}`, {
        targetId: targetEntityId,
        targetName,
      });
    }

    const moving = await ctx.moveToEntity(me, targetEntity, GOTO_NPC_CLOSE_DIST);
    if (moving) {
      return actionProgressed(`Walking to ${targetName ?? "NPC"}`);
    }

    // Arrived — execute on-arrival action
    const arrivalAction = target.action;
    const profession = target.profession;

    if (arrivalAction === "learn-profession" && profession && ctx.custodialWallet) {
      try {
        await ctx.api("POST", "/professions/learn", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, trainerId: targetEntityId, professionId: profession,
        });
        void ctx.logActivity(`Learned profession: ${profession}`);
        console.log(`[agent:${ctx.walletTag}] Learned profession ${profession} (user-initiated)`);
      } catch (learnErr: any) {
        const reason = formatAgentError(learnErr);
        void ctx.logActivity(`Could not learn ${profession}: ${reason}`);
        ctx.setEntityGotoMode(false);
        return actionBlocked(reason, {
          failureKey: `goto:learn-profession:${profession}:${targetEntityId}`,
          endpoint: "/professions/learn",
          targetId: targetEntityId,
          targetName,
        });
      }
    } else if (arrivalAction === "learn-technique" && (target as any).techniqueId) {
      try {
        await ctx.api("POST", "/techniques/learn", {
          walletAddress: ctx.custodialWallet,
          zoneId: ctx.currentRegion, playerEntityId: ctx.entityId,
          techniqueId: (target as any).techniqueId, trainerEntityId: targetEntityId,
        });
        void ctx.logActivity(`Learned technique: ${(target as any).techniqueName ?? (target as any).techniqueId}`);
        console.log(`[agent:${ctx.walletTag}] Learned technique ${(target as any).techniqueId} (user-initiated)`);
      } catch (learnErr: any) {
        const reason = formatAgentError(learnErr);
        void ctx.logActivity(`Could not learn technique: ${reason}`);
        ctx.setEntityGotoMode(false);
        return actionBlocked(reason, {
          failureKey: `goto:learn-technique:${(target as any).techniqueId}:${targetEntityId}`,
          endpoint: "/techniques/learn",
          targetId: targetEntityId,
          targetName,
        });
      }
    } else if (arrivalAction === "accept-quest" && (target as any).questId && ctx.custodialWallet) {
      try {
        await ctx.api("POST", "/quests/accept", {
          zoneId: ctx.currentRegion,
          entityId: ctx.entityId,
          questId: (target as any).questId,
        });
        void ctx.logActivity(`Accepted quest: ${(target as any).questId}`);
        console.log(`[agent:${ctx.walletTag}] Accepted quest ${(target as any).questId} (user-initiated)`);
      } catch (questErr: any) {
        const reason = formatAgentError(questErr);
        void ctx.logActivity(`Could not accept quest: ${reason}`);
        ctx.setEntityGotoMode(false);
        return actionBlocked(reason, {
          failureKey: `goto:accept-quest:${(target as any).questId}:${targetEntityId}`,
          endpoint: "/quests/accept",
          targetId: targetEntityId,
          targetName,
        });
      }
    } else if (arrivalAction === "talk-quest" && ctx.custodialWallet) {
      try {
        await ctx.api("POST", "/quests/talk", {
          zoneId: ctx.currentRegion,
          entityId: ctx.entityId,
          npcEntityId: targetEntityId,
        });
        void ctx.logActivity(`Talked to ${targetName ?? "NPC"} for quest`);
        console.log(`[agent:${ctx.walletTag}] Talk quest at ${targetName ?? targetEntityId} (user-initiated)`);
      } catch (questErr: any) {
        const reason = formatAgentError(questErr);
        void ctx.logActivity(`Could not talk for quest: ${reason}`);
        ctx.setEntityGotoMode(false);
        return actionBlocked(reason, {
          failureKey: `goto:talk-quest:${targetEntityId}`,
          endpoint: "/quests/talk",
          targetId: targetEntityId,
          targetName,
        });
      }
    } else if (arrivalAction === "complete-quest" && (target as any).questId && ctx.custodialWallet) {
      try {
        await ctx.api("POST", "/quests/complete", {
          zoneId: ctx.currentRegion,
          playerId: ctx.entityId,
          questId: (target as any).questId,
          npcId: targetEntityId,
        });
        void ctx.logActivity(`Turned in quest: ${(target as any).questId}`);
        console.log(`[agent:${ctx.walletTag}] Completed quest ${(target as any).questId} (user-initiated)`);
      } catch (questErr: any) {
        const reason = formatAgentError(questErr);
        void ctx.logActivity(`Could not turn in quest: ${reason}`);
        ctx.setEntityGotoMode(false);
        return actionBlocked(reason, {
          failureKey: `goto:complete-quest:${(target as any).questId}:${targetEntityId}`,
          endpoint: "/quests/complete",
          targetId: targetEntityId,
          targetName,
        });
      }
    } else {
      void ctx.logActivity(`Arrived at ${targetName ?? "NPC"}`);
    }

    console.log(`[agent:${ctx.walletTag}] Arrived at goto target: ${targetName ?? targetEntityId}`);
    return clearGotoStateAndResume(`Arrived at ${targetName ?? targetEntityId}`, {
      completed: true,
      keepFocusIfNotGoto: true,
    });
  } catch (err: any) {
    ctx.setEntityGotoMode(false);
    const reason = formatAgentError(err);
    console.debug(`[agent] doGotoNpc: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `goto:error:${ctx.currentRegion}` });
  }
}

// ── Questing ─────────────────────────────────────────────────────────────────

export async function doQuesting(
  ctx: AgentContext,
  strategy: AgentStrategy,
  findNextZoneForLevel: (level: number) => string | null,
): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    // 1. Check for completed quests and turn them in
    const activeRes = await ctx.api("GET", `/quests/active/${ctx.entityId}`);
    const rawActiveQuests: any[] = activeRes?.activeQuests ?? [];

    // Apply the user's quest focus filter, if any. When focusedQuestId is set,
    // the agent narrows its quest pool down to that one quest so it stops
    // bouncing between active quests. Clears the focus automatically if the
    // quest has already left the active list (turned in or abandoned).
    let activeQuests: any[] = rawActiveQuests;
    const questConfig = await getAgentConfig(ctx.userWallet);
    const focusedQuestId = questConfig?.focusedQuestId;
    if (focusedQuestId) {
      const focused = rawActiveQuests.find((aq: any) =>
        (aq.questId ?? aq.quest?.id) === focusedQuestId,
      );
      if (focused) {
        activeQuests = [focused];
      } else {
        // Focused quest is gone — clear so we don't filter to an empty list forever.
        void ctx.logActivity(`Focused quest ${focusedQuestId} no longer active — clearing focus`);
        await patchAgentConfig(ctx.userWallet, { focusedQuestId: undefined });
      }
    }

    for (const aq of activeQuests) {
      if (aq.complete && aq.quest?.npcId) {
        const npcName = String(aq.quest?.npcId ?? "").toLowerCase();
        const npcEntry = Object.entries(entities).find(([, e]: [string, any]) => {
          if (!e) return false;
          return String(e.name ?? "").toLowerCase() === npcName;
        });

        if (!npcEntry) {
          // Global discovery: Turn-in NPC not here, find where they are
          const targetZone = findZoneForNpc(npcName);
          if (targetZone && targetZone !== ctx.currentRegion) {
            void ctx.logActivity(`Quest NPC ${aq.quest?.npcId} not in ${ctx.currentRegion} — traveling to ${targetZone} to turn in`);
            await autoPatchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone });
            ctx.setScript(null); // Force focus refresh
            return actionProgressed(`Traveling to ${targetZone} to turn in "${aq.quest?.title}"`);
          }
        }

        if (npcEntry) {
          const [npcEntityId, npcEntity] = npcEntry;
          const cooldownKey = `quest-complete:${aq.questId}:${npcEntityId}`;          if (ctx.isInteractionOnCooldown(cooldownKey)) continue;
          const moving = await ctx.moveToEntity(me, npcEntity);
          if (moving) {
            void ctx.logActivity(`Walking to ${aq.quest?.npcId} to turn in "${aq.quest?.title}"`);
            return actionProgressed(`Walking to ${aq.quest?.npcId}`);
          }
          // Greet the NPC visibly BEFORE the API call so observers can see
          // who the agent is turning the quest in to.
          emitAgentChat({
            entityId: ctx.entityId, entityName: me.name ?? "Agent",
            zoneId: ctx.currentRegion, event: "quest_complete",
            origin: me.origin ?? undefined, classId: me.classId ?? undefined,
            speakerName: String(npcEntity.name ?? aq.quest?.npcId ?? "Quest Giver"),
            detail: aq.quest?.title ?? "your quest",
            force: true,
          });
          try {
            const completeRes = await ctx.api("POST", "/quests/complete", {
              zoneId: ctx.currentRegion, playerId: ctx.entityId,
              questId: aq.questId, npcId: npcEntityId,
            });
            if (completeRes?.completed) {
              void ctx.logActivity(`Quest complete: "${aq.quest?.title}" +${completeRes.rewards?.xp ?? 0}XP +${completeRes.rewards?.copper ?? 0}c`);
              const agentId = me.agentId != null ? me.agentId.toString() : resolveLiveAgentIdForWallet(ctx.userWallet);
              if (agentId) {
                reputationManager.submitFeedback(
                  agentId, ReputationCategory.Agent,
                  Math.max(1, Math.floor((completeRes.rewards?.xp ?? 50) / 50)),
                  `Agent completed quest: ${aq.quest?.title ?? "unknown"}`,
                );
              }
              ctx.clearInteractionCooldown(cooldownKey);
              return actionCompleted(`Completed quest ${aq.quest?.title ?? aq.questId}`);
            }
          } catch (err: any) {
            const reason = formatAgentError(err);
            ctx.setInteractionCooldown(cooldownKey, 20_000);
            void ctx.logActivity(`Could not turn in "${aq.quest?.title}": ${reason}`);
            console.warn(`[agent:${ctx.walletTag}] quest complete failed: ${reason}`);
            return actionBlocked(reason, {
              failureKey: cooldownKey,
              endpoint: "/quests/complete",
              targetId: npcEntityId,
              targetName: aq.quest?.npcId,
            });
          }
        }
      }
    }

    // 2. Handle talk quests
    const talkQuests = activeQuests.filter(
      (aq: any) => !aq.complete && aq.quest?.objective?.type === "talk",
    );
    if (talkQuests.length > 0) {
      for (const tq of talkQuests) {
        const targetNpcDisplay = tq.quest?.objective?.targetNpcName ?? tq.quest?.npcId ?? "";
        const targetNpcName = String(targetNpcDisplay).toLowerCase();
        const npcEntry = Object.entries(entities).find(([, e]: [string, any]) => {
          if (!e) return false;
          return String(e.name ?? "").toLowerCase() === targetNpcName;
        });
        if (npcEntry) {
          const [npcEntityId, npcEntity] = npcEntry;
          const cooldownKey = `quest-talk:${tq.questId}:${npcEntityId}`;
          if (ctx.isInteractionOnCooldown(cooldownKey)) continue;
          const moving = await ctx.moveToEntity(me, npcEntity);
          if (moving) {
            void ctx.logActivity(`Walking to ${targetNpcName} for talk quest`);
            return actionProgressed(`Walking to ${targetNpcName} for talk quest`);
          }
          // Greet the NPC visibly BEFORE the API call so observers can see who
          // the agent is talking to. Talk quests reuse the quest_complete event
          // since /quests/talk auto-completes the objective.
          emitAgentChat({
            entityId: ctx.entityId, entityName: me.name ?? "Agent",
            zoneId: ctx.currentRegion, event: "quest_complete",
            origin: me.origin ?? undefined, classId: me.classId ?? undefined,
            speakerName: npcEntity.name ?? targetNpcDisplay,
            detail: tq.quest?.title ?? "your quest",
            force: true,
          });
          try {
            await ctx.api("POST", "/quests/talk", {
              zoneId: ctx.currentRegion, playerId: ctx.entityId, npcEntityId,
            });
            ctx.clearInteractionCooldown(cooldownKey);
            void ctx.logActivity(`Talked to ${targetNpcName} for "${tq.quest?.title}"`);
            return actionCompleted(`Talked to ${targetNpcName}`);
          } catch (err: any) {
            const reason = formatAgentError(err);
            const backoffMs = /no talk quest available/i.test(reason) ? 60_000 : 20_000;
            ctx.setInteractionCooldown(cooldownKey, backoffMs);
            void ctx.logActivity(`Could not talk to ${tq.quest?.objective?.targetNpcName ?? "NPC"}: ${reason}`);
            console.warn(`[agent:${ctx.walletTag}] quest talk failed: ${reason}`);
            return actionBlocked(reason, {
              failureKey: cooldownKey,
              endpoint: "/quests/talk",
              targetId: npcEntityId,
              targetName: tq.quest?.objective?.targetNpcName ?? tq.quest?.npcId,
            });
          }
        }

        // Global discovery: target NPC isn't in this zone — travel to where they live.
        // Without this, profession intro quests (skinning_101 → Huntsman Greaves,
        // cooking_101 → Chef Gastron) silently stall forever once the agent
        // wanders out of village-square.
        if (targetNpcDisplay) {
          const targetZone = findZoneForNpc(String(targetNpcDisplay));
          if (targetZone && targetZone !== ctx.currentRegion) {
            const cooldownKey = `quest-talk-travel:${tq.questId}:${targetZone}`;
            if (!ctx.isInteractionOnCooldown(cooldownKey)) {
              ctx.setInteractionCooldown(cooldownKey, 5_000);
              void ctx.logActivity(`Talk-quest NPC ${targetNpcDisplay} not in ${ctx.currentRegion} — traveling to ${targetZone} for "${tq.quest?.title}"`);
              await autoPatchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone });
              ctx.setScript(null);
              return actionProgressed(`Traveling to ${targetZone} for talk quest "${tq.quest?.title}"`);
            }
            // Surface a blocked failure so the circuit breaker can fire if we
            // can't actually get there (e.g. level gate, missing path).
            return actionBlocked(`talk-quest target ${targetNpcDisplay} unreachable from ${ctx.currentRegion}`, {
              failureKey: `quest-talk-stuck:${tq.questId}`,
              endpoint: "/quests/talk",
              targetName: String(targetNpcDisplay),
              category: "strategic",
            });
          }
        }
      }
      // Fallback: try all NPCs that have quests in the catalog
      for (const [entityId, e] of Object.entries(entities)) {
        if (isQuestNpc(e as any)) {
          try {
            await ctx.api("POST", "/quests/talk", {
              zoneId: ctx.currentRegion, playerId: ctx.entityId, npcEntityId: entityId,
            });
          } catch (err: any) {
            console.debug(`[agent:${ctx.walletTag}] quest talk fallback: ${err.message?.slice(0, 60)}`);
          }
        }
      }
    }

    // 3. Auto-accept available quests (up to 3 active)
    const currentActive = activeQuests.filter((aq: any) => !aq.complete).length;
    if (currentActive < 3) {
      try {
        const availRes = await ctx.api("GET", `/quests/zone/${ctx.currentRegion}/${ctx.entityId}`);
        const available: any[] = availRes?.quests ?? [];
        if (available.length > 0) {
          const q = available[0];
          // Find the quest-giver NPC to accept from
          const npcName = String(q.npcId ?? q.npcName ?? "").toLowerCase();
          const npcEntry = Object.entries(entities).find(([, e]: [string, any]) => {
            if (!e) return false;
            return String(e.name ?? "").toLowerCase() === npcName;
          });
          if (npcEntry) {
            const [npcEntityId, npcEntity] = npcEntry;
            const cooldownKey = `quest-accept:${q.questId}:${npcEntityId}`;
            if (!ctx.isInteractionOnCooldown(cooldownKey)) {
              const moving = await ctx.moveToEntity(me, npcEntity);
              if (moving) {
                void ctx.logActivity(`Walking to ${npcName} to accept "${q.title}"`);
                return actionProgressed(`Walking to ${npcName}`);
              }
              const npcDisplayName = String(npcEntity.name ?? q.npcName ?? q.npcId ?? "Quest Giver");
              // Greet the NPC visibly BEFORE the API call so observers can
              // see who the agent is talking to and what quest they're
              // accepting. Forced (bypasses silence/cooldown) because this
              // is a key UX moment.
              emitAgentChat({
                entityId: ctx.entityId, entityName: me.name ?? "Agent",
                zoneId: ctx.currentRegion, event: "quest_accept",
                origin: me.origin ?? undefined, classId: me.classId ?? undefined,
                speakerName: npcDisplayName,
                detail: q.title,
                force: true,
              });
              try {
                await ctx.api("POST", "/quests/accept", {
                  zoneId: ctx.currentRegion, playerId: ctx.entityId,
                  questId: q.questId, npcId: npcEntityId,
                });
                void ctx.logActivity(`Accepted quest: "${q.title}"`);
                return actionCompleted(`Accepted quest: ${q.title}`);
              } catch (err: any) {
                const reason = formatAgentError(err);
                ctx.setInteractionCooldown(cooldownKey, 20_000);
                console.debug(`[agent:${ctx.walletTag}] quest accept failed: ${reason}`);
              }
            }
          }
        } else if (currentActive === 0) {
          const myLevel = me.level ?? 1;
          // If the user pinned focus (idle / user), don't override it. Just
          // idle the script and leave their saved focus alone — otherwise the
          // cascade (questing → no quests → focus:=traveling) clobbers it.
          const qCfg = await getAgentConfig(ctx.userWallet);
          if (qCfg && USER_PINNED_FOCUSES.has(qCfg.focus)) {
            void ctx.logActivity(`No quests remaining — staying put (user focus)`);
            ctx.setScript({ type: "idle", reason: `User focus: ${qCfg.focus}` });
            return actionIdle(`Focus is ${qCfg.focus} — not auto-traveling`);
          }
          const nextZone = findNextZoneForLevel(myLevel);
          if (nextZone && nextZone !== ctx.currentRegion) {
            console.log(`[agent:${ctx.walletTag}] No quests left in ${ctx.currentRegion}, traveling to ${nextZone}`);
            void ctx.logActivity(`No quests remaining — traveling to ${nextZone}`);
            await autoPatchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone: nextZone });
            ctx.setScript(null);
            return actionProgressed(`Traveling to ${nextZone} for new quests`);
          }
          // No quest zone available for this level — go idle so we don't
          // loop into combat fallback → level-mismatch → zone rescue.
          void ctx.logActivity(`No quests available for Lv${myLevel} — idling`);
          ctx.setScript({ type: "idle", reason: `No quests available for Lv${myLevel}` });
          return actionIdle(`No quests available for Lv${myLevel}`);
        }
      } catch (err: any) {
        console.debug(`[agent:${ctx.walletTag}] quest accept: ${err.message?.slice(0, 60)}`);
      }
    }

    // 3b. Progress clear_dungeon quests by routing into doDungeon.
    // Only this path lets a questing agent enter a dungeon — gate surges no longer auto-hijack.
    const dungeonQuests = activeQuests.filter(
      (aq: any) => !aq.complete && aq.quest?.objective?.type === "clear_dungeon",
    );
    if (dungeonQuests.length > 0) {
      const targetRank = dungeonQuests[0]?.quest?.objective?.targetRank as
        | "E" | "D" | "C" | "B" | "A" | "S" | undefined;
      void ctx.logActivity(
        `Active clear_dungeon quest${targetRank ? ` (rank ${targetRank})` : ""} — routing to dungeon`,
      );
      return doDungeon(ctx, strategy, { gateRank: targetRank });
    }

    // 4. Progress kill/gather quests
    const killQuests = activeQuests.filter(
      (aq: any) => !aq.complete && aq.quest?.objective?.type === "kill",
    );
    const hasGatherQuest = activeQuests.some(
      (aq: any) => !aq.complete && (aq.quest?.objective?.type === "gather" || aq.quest?.objective?.type === "craft"),
    );

    if (killQuests.length > 0) {
      // Filter out quests flagged as stuck (target mob unreachable / blocked recently).
      // Stuck flags expire after 5 min so the agent will retry later.
      const liveKillQuests = killQuests.filter((aq: any) => !ctx.isQuestStuck(aq.questId ?? aq.quest?.id ?? ""));

      if (liveKillQuests.length === 0) {
        // Every kill quest is flagged stuck — don't pretend to do quest combat.
        if (hasGatherQuest) {
          const supportResult = await doQuestSupportObjective(ctx, strategy, activeQuests);
          if (supportResult) {
            void ctx.logActivity("All kill quests stuck — working another quest objective");
            return supportResult;
          }
        }
        void ctx.logActivity("All kill quests stuck — grinding mobs for XP");
        return fallbackToCombat(ctx, "All kill quests flagged stuck", strategy);
      }

      // Prefer quest-specific mobs over random combat
      const questMobNames = new Set(
        liveKillQuests.map((aq: any) => String(aq.quest?.objective?.targetMobName ?? "")).filter(Boolean),
      );

      // Pre-flight: are any of the quest target mobs actually in this zone?
      // If not, fall through to gather/grind — no point firing doQuestCombat
      // just to block on "no valid targets".
      const zsCheck = await ctx.getZoneState();
      const entitiesCheck = zsCheck?.entities ?? {};
      const questMobPresent = Object.values(entitiesCheck).some((e: any) =>
        (e.type === "mob" || e.type === "boss")
        && e.hp > 0
        && matchesAnyQuestMob(e.name, questMobNames),
      );

      if (!questMobPresent) {
        // Global discovery: if target isn't here, where IS it?
        const targetZone = findZoneForQuestMobs(questMobNames);
        if (targetZone && targetZone !== ctx.currentRegion) {
          void ctx.logActivity(`Quest mob not in ${ctx.currentRegion} — traveling to ${targetZone} to hunt`);
          await autoPatchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone });
          ctx.setScript(null); // Force focus refresh
          return actionProgressed(`Traveling to ${targetZone} for quest targets`);
        }

        if (hasGatherQuest) {
          const supportResult = await doQuestSupportObjective(ctx, strategy, activeQuests);
          if (supportResult) {
            void ctx.logActivity(`Quest mob not in ${ctx.currentRegion} — working another quest objective`);
            return supportResult;
          }
        }
        // If quest mobs belong here (confirmed by global discovery), they're just
        // temporarily dead and waiting to respawn (20s cooldown). Fight other mobs
        // instead of triggering the circuit breaker with a blocked fallback.
        if (targetZone === ctx.currentRegion) {
          void ctx.logActivity(`Quest mobs respawning in ${ctx.currentRegion} — grinding other mobs while waiting`);
          return fallbackToCombat(ctx, "Quest mobs respawning", strategy);
        }
        // Missing from current zone means "wrong zone" or "cleared", not "stuck".
        // Reroute via the fallback path so the circuit breaker can find the right zone.
        return questBlockedFallback(ctx, strategy, "quest target not in zone", findNextZoneForLevel, me);
      }

      const combatResult = await doQuestCombat(ctx, strategy, questMobNames);

      // If combat is blocked, do something productive instead of spinning
      if (combatResult.status === "blocked") {
        const reason = combatResult.reason ?? "quest-combat blocked";
        // Only mark as stuck if the target is truly too dangerous for our current strategy.
        if (reason.toLowerCase().includes("dangerous")) {
          for (const aq of liveKillQuests) {
            const id = aq.questId ?? aq.quest?.id;
            if (id) ctx.markQuestStuck(id, reason);
          }
        }
        if (hasGatherQuest) {
          const supportResult = await doQuestSupportObjective(ctx, strategy, activeQuests);
          if (supportResult) {
            void ctx.logActivity("Quest combat blocked — working another quest objective");
            return supportResult;
          }
        }
        return questBlockedFallback(ctx, strategy, reason, findNextZoneForLevel, me);
      }
      return combatResult;
    } else if (hasGatherQuest) {
      const supportResult = await doQuestSupportObjective(ctx, strategy, activeQuests);
      if (supportResult) return supportResult;
      const detail = `active=${activeQuests.filter((aq: any) => !aq.complete).length} total=${activeQuests.length}`;
      void ctx.logActivity(`No actionable gather/craft quest objectives — idling (${detail})`);
      ctx.setScript({ type: "idle", reason: `No actionable gather/craft quest objectives (${detail})` });
      return actionIdle(`No actionable gather/craft quest objectives (${detail})`);
    } else {
      const activeCount = activeQuests.filter((aq: any) => !aq.complete).length;
      const detail = `active=${activeCount} total=${activeQuests.length}`;
      console.debug(`[agent:${ctx.walletTag}] No kill/gather objectives — idling (${detail})`);
      void ctx.logActivity(`No quest objectives — idling (${detail})`);
      ctx.setScript({ type: "idle", reason: `No quest objectives (${detail})` });
      return actionIdle(`No quest objectives (${detail})`);
    }
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.error(`[agent:${ctx.walletTag}] Quest system error: ${reason}`);
    void ctx.logActivity(`Quest error: ${reason} — grinding mobs as fallback`);
    return fallbackToCombat(ctx, `Quest system error: ${reason}`, strategy);
  }
}

// ── Quest-aware combat ──────────────────────────────────────────────────────

/** Like doCombat but prioritizes mobs whose names match active kill quests. */
async function doQuestCombat(
  ctx: AgentContext,
  strategy: AgentStrategy,
  questMobNames: Set<string>,
): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const myLevel = me.level ?? 1;
    const maxMobLevel = myLevel + (strategy === "aggressive" ? 5 : strategy === "defensive" ? 0 : 2);

    const eligible = Object.entries(entities).filter(
      ([, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && (e.level ?? 1) <= maxMobLevel,
    );
    if (eligible.length === 0) {
      return actionBlocked("No mobs available for quest progression", {
        failureKey: `quest-combat:no-targets:${ctx.currentRegion}`,
        targetName: ctx.currentRegion,
      });
    }

    const weakMobFloor = ctx.ignoreWeakMobs;
    const partyLeaderId = getPartyLeaderId(ctx.entityId);
    const partyId = getPlayerPartyId(ctx.entityId);

    // FF12-gambit rule: non-leader party members follow the leader's target
    // before honoring their own commit.
    if (partyId && partyLeaderId && partyLeaderId !== me.id) {
      const leaderTarget = pickPartyCombatTarget(me, ctx.currentRegion);
      const leaderTargetIsQuest = leaderTarget ? matchesAnyQuestMob(leaderTarget.name, questMobNames) : false;
      if (leaderTarget && isCombatTargetAllowed(me, leaderTarget, strategy, leaderTargetIsQuest, weakMobFloor)) {
        if (ctx.committedTargetId !== leaderTarget.id) ctx.commitTarget(leaderTarget.id);
        return engagePartyCombatTarget(ctx, me, entities, leaderTarget, partyLeaderId);
      }
    }

    // Honor target commitment — if we locked onto a quest mob already, keep
    // hunting it instead of re-picking every tick.
    const committedId = ctx.committedTargetId;
    if (committedId) {
      const committedMob = entities[committedId];
      if (
        committedMob
        && committedMob.hp > 0
        && (committedMob.type === "mob" || committedMob.type === "boss")
      ) {
        const committedIsQuest = matchesAnyQuestMob(committedMob.name, questMobNames);
        if (isCombatTargetAllowed(me, committedMob, strategy, committedIsQuest, weakMobFloor)) {
          return engageCombatTarget(ctx, me, committedMob, entities);
        }
      }
      ctx.clearCommittedTarget();
    }

    const partyTarget = pickPartyCombatTarget(me, ctx.currentRegion);
    const partyTargetIsQuestMob = partyTarget ? matchesAnyQuestMob(partyTarget.name, questMobNames) : false;
    if (partyTarget && isCombatTargetAllowed(me, partyTarget, strategy, partyTargetIsQuestMob, weakMobFloor)) {
      ctx.commitTarget(partyTarget.id);
      return engagePartyCombatTarget(ctx, me, entities, partyTarget, partyLeaderId);
    }

    const mob = pickCombatTarget(me, eligible, strategy, { questMobNames, ignoreWeakMobs: weakMobFloor });
    if (!mob) {
      return actionBlocked("Quest targets are too dangerous for current strategy", {
        failureKey: `quest-combat:no-safe-targets:${ctx.currentRegion}:${strategy}`,
        targetName: ctx.currentRegion,
        category: "strategic",
      });
    }
    ctx.commitTarget(mob.id);
    const isQuestTarget = matchesAnyQuestMob(mob.name, questMobNames);
    const result = engageCombatTarget(ctx, me, mob, entities);
    if (result.status === "progressed") {
      void ctx.logActivity(isQuestTarget
        ? `Hunting ${mob.name} for quest (Lv${mob.level ?? "?"})`
        : `Fighting ${mob.name ?? "mob"} (Lv${mob.level ?? "?"})`);
    }
    return result;
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] quest combat tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `quest-combat:error:${ctx.currentRegion}` });
  }
}

// ── Quest blocked fallback ──────────────────────────────────────────────────

/**
 * When quest combat is blocked (no safe targets), pick a productive fallback
 * instead of spinning on the same blocked action forever.
 */
async function questBlockedFallback(
  ctx: AgentContext,
  strategy: AgentStrategy,
  reason: string,
  findNextZoneForLevel: (level: number) => string | null,
  me: any,
): Promise<ActionResult> {
  const myLevel = me.level ?? 1;

  // Option 1: Zone is too hard — travel to an appropriate zone
  const zoneReq = ZONE_LEVEL_REQUIREMENTS[ctx.currentRegion] ?? 1;
  if (myLevel < zoneReq) {
    const betterZone = findNextZoneForLevel(myLevel);
    if (betterZone && betterZone !== ctx.currentRegion) {
      console.log(`[agent:${ctx.walletTag}] Quest combat blocked, underleveled (Lv${myLevel} in L${zoneReq} zone) — traveling to ${betterZone}`);
      void ctx.logActivity(`Too dangerous here (Lv${myLevel} in L${zoneReq} zone) — heading to ${betterZone}`);
      await autoPatchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone: betterZone });
      ctx.setScript(null);
      return actionProgressed(`Traveling to ${betterZone} — current zone too dangerous`);
    }
  }

  const stuckReason = `Stuck on quest combat: ${reason}; not auto-gathering`;
  void ctx.logActivity(stuckReason);
  ctx.setScript({ type: "idle", reason: stuckReason });
  return actionIdle(stuckReason);
}

// ── Shared helper ────────────────────────────────────────────────────────────

async function fallbackToCombat(
  ctx: AgentContext,
  reason: string,
  strategy: AgentStrategy,
): Promise<ActionResult> {
  void ctx.logActivity(`${reason} — fighting to earn XP/gold`);
  // Do combat for this tick only — do NOT overwrite the script so we
  // return to the original focus (e.g. questing) on the next tick.
  const result = await doCombat(ctx, strategy);
  return result.status === "idle" ? actionProgressed(reason) : result;
}

// ── Dungeon ──────────────────────────────────────────────────────────────────

/** Rank → key token ID mapping */
const RANK_TO_KEY_TOKEN: Record<string, bigint> = {
  E: 134n, D: 135n, C: 136n, B: 137n, A: 138n, S: 139n,
};
/** Rank → gate essence (reagent) token ID mapping */
const RANK_TO_REAGENT_TOKEN: Record<string, bigint> = {
  E: 128n, D: 129n, C: 130n, B: 131n, A: 132n, S: 133n,
};
/** Rank → alchemy recipe ID for brewing the gate essence */
const RANK_TO_ESSENCE_RECIPE: Record<string, string> = {
  E: "crude-gate-essence", D: "lesser-gate-essence", C: "gate-essence",
  B: "greater-gate-essence", A: "superior-gate-essence", S: "supreme-gate-essence",
};
const RANK_LEVEL_REQS: Record<string, number> = {
  E: 3, D: 7, C: 12, B: 18, A: 28, S: 40,
};
const GATE_PROXIMITY = 50;

/**
 * Dungeon behavior — handles the full dungeon lifecycle:
 * 1. If inside a dungeon zone → fight mobs (auto-exit handled by dungeonGateTick)
 * 2. If in overworld with a target gate → walk to gate and open it
 * 3. If in overworld with no target → scan for gates, pick best one
 */
export async function doDungeon(
  ctx: AgentContext,
  strategy: AgentStrategy,
  script: { gateEntityId?: string; gateRank?: string },
): Promise<ActionResult> {
  try {
    // ── Phase 1: Already inside a dungeon — just fight ──────────────────
    if (ctx.currentRegion.startsWith("dungeon-")) {
      return doDungeonCombat(ctx, strategy);
    }

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    // ── Phase 2: Find or validate a target gate ─────────────────────────
    let targetGate: any = null;
    let targetGateId: string | null = script.gateEntityId ?? null;

    if (targetGateId) {
      targetGate = entities[targetGateId];
      // Gate might have expired or been opened
      if (!targetGate || targetGate.type !== "dungeon-gate" || targetGate.gateOpened) {
        void ctx.logActivity("Target gate is gone — scanning for new gates");
        targetGateId = null;
        targetGate = null;
      }
    }

    const myLevel = me.level ?? 1;

    if (!targetGate) {
      // Scan zone for available gates, pick the best one we can handle
      const gates = Object.entries(entities).filter(
        ([, e]) => e.type === "dungeon-gate" && !e.gateOpened && (!e.gateExpiresAt || e.gateExpiresAt > Date.now()),
      );

      // If a specific rank was requested (e.g. from a clear_dungeon quest), prefer it.
      const requestedRank = script.gateRank;
      const rankMatches = requestedRank
        ? gates.filter(([, g]) => g.gateRank === requestedRank)
        : [];
      const candidatePool = rankMatches.length > 0 ? rankMatches : gates;

      // Pick the highest-rank gate we qualify for
      const eligible = candidatePool.filter(([, g]) => {
        const rank = g.gateRank as string;
        return myLevel >= (RANK_LEVEL_REQS[rank] ?? 999);
      }).sort(([, a], [, b]) => {
        const rankOrder = "EDCBAS";
        return rankOrder.indexOf(b.gateRank) - rankOrder.indexOf(a.gateRank);
      });

      if (eligible.length > 0) {
        [targetGateId, targetGate] = eligible[0] as [string, any];
      }
      // else: no gate visible — fall through to key-prep mode below.
    }

    // Determine rank: from current gate, requested rank, or highest tier we qualify for.
    // This lets us pre-brew + pre-forge keys while waiting for the next gate surge.
    const rankOrderArr: string[] = ["E", "D", "C", "B", "A", "S"];
    let rank: string | null = (targetGate?.gateRank as string | undefined)
      ?? script.gateRank
      ?? null;
    if (!rank) {
      // Pick highest rank we qualify for
      for (let i = rankOrderArr.length - 1; i >= 0; i--) {
        if (myLevel >= (RANK_LEVEL_REQS[rankOrderArr[i]] ?? 999)) {
          rank = rankOrderArr[i];
          break;
        }
      }
    }
    if (!rank) {
      return fallbackToCombat(ctx, `Level ${myLevel} too low for any dungeon rank`, strategy);
    }
    const keyTokenId = RANK_TO_KEY_TOKEN[rank];

    // If no gate present AND we already hold a key for this rank, wait by combat-grinding
    // for the next gate surge instead of forging another redundant key.
    if (!targetGate) {
      try {
        const keyBalance = await getItemBalance(ctx.custodialWallet, keyTokenId);
        if (keyBalance >= 1n) {
          return fallbackToCombat(ctx, `Have ${rank}-Key — waiting for next gate surge`, strategy);
        }
      } catch {
        // If balance check fails, proceed to prep — extra key won't hurt.
      }
    }

    // ── Phase 3: Check key — brew essence / forge key if missing ──────
    if (keyTokenId) {
      try {
        const keyBalance = await getItemBalance(ctx.custodialWallet, keyTokenId);
        if (keyBalance < 1n) {
          const reagentTokenId = RANK_TO_REAGENT_TOKEN[rank];
          const essenceRecipeId = RANK_TO_ESSENCE_RECIPE[rank];

          // Check if we already have the gate essence reagent
          let hasReagent = false;
          if (reagentTokenId) {
            try {
              const reagentBalance = await getItemBalance(ctx.custodialWallet, reagentTokenId);
              hasReagent = reagentBalance >= 1n;
            } catch {
              // If balance check fails, try brewing first
            }
          }

          if (hasReagent) {
            // We have the reagent — forge the key at the enchanting altar
            const altar = ctx.findNearestEntity(entities, me, (e) => e.type === "enchanting-altar");
            if (!altar) {
              void ctx.logActivity(`Have gate essence but no enchanting altar — fighting while waiting`);
              return fallbackToCombat(ctx, `No enchanting altar to forge ${rank}-Key`, strategy);
            }
            const [altarId, altarEntity] = altar;
            const moving = await ctx.moveToEntity(me, altarEntity);
            if (moving) {
              ctx.setScript({ type: "dungeon", gateEntityId: targetGateId ?? undefined, gateRank: rank, reason: `Moving to enchanting altar to forge ${rank}-Key` });
              return actionProgressed(`Moving to ${altarEntity.name ?? "enchanting altar"} to forge ${rank}-Key`);
            }

            try {
              await ctx.api("POST", "/dungeon/forge-key", {
                walletAddress: ctx.custodialWallet,
                zoneId: ctx.currentRegion,
                entityId: ctx.entityId,
                altarId,
                reagentTokenId: Number(reagentTokenId),
              });
              void ctx.logActivity(`Forged ${rank}-Key at ${altarEntity.name ?? "enchanting altar"}`);
              logZoneEvent({
                zoneId: ctx.currentRegion, type: "profession", tick: 0,
                message: `${me.name} forged a ${rank}-Key at the enchanting altar`,
                entityId: ctx.entityId, entityName: me.name,
                data: { profession: "enchanting", target: `${rank}-Key` },
              });
              // Key forged — continue to Phase 4 (party + gate opening) on next tick
              ctx.setScript({ type: "dungeon", gateEntityId: targetGateId ?? undefined, gateRank: rank, reason: `${rank}-Key forged — heading to gate` });
              return actionProgressed(`Forged ${rank}-Key — heading to dungeon gate`);
            } catch (err: any) {
              const reason = formatAgentError(err);
              void ctx.logActivity(`Key forging failed: ${reason}`);
              return actionBlocked(reason, { failureKey: `dungeon:forge-key:${rank}` });
            }
          } else {
            // No reagent — first ensure we have all brewing materials, then brew.
            // Without this check the agent would call /alchemy/brew with empty inventory,
            // get a 500, and re-detect the gate next cycle → infinite loop.
            const recipe = essenceRecipeId ? getAlchemyRecipeById(essenceRecipeId) : undefined;
            if (recipe) {
              for (const mat of recipe.requiredMaterials) {
                let have = 0n;
                try {
                  have = await getItemBalance(ctx.custodialWallet, mat.tokenId);
                } catch {
                  // treat as zero
                }
                if (have < BigInt(mat.quantity)) {
                  const itemDef = getItemByTokenId(mat.tokenId);
                  const itemName = itemDef?.name ?? `tokenId ${mat.tokenId}`;
                  // Classify ore vs herb so doGathering knows which pref to use
                  const isOre = Object.values(ORE_CATALOG).some((o) => o.tokenId === mat.tokenId);
                  const gatherPreference: GatherPreference = isOre ? "ore" : "herb";
                  void ctx.logActivity(
                    `Need ${mat.quantity}× ${itemName} for ${rank} essence — gathering (have ${have})`,
                  );
                  // Keep the dungeon script alive so we resume after gathering.
                  ctx.setScript({
                    type: "dungeon",
                    gateEntityId: targetGateId!,
                    gateRank: rank,
                    reason: `Gathering ${itemName} for ${rank} essence`,
                  });
                  return doGathering(ctx, strategy, gatherPreference, itemName);
                }
              }
            }

            const learned = await ctx.learnProfession("alchemy");
            if (!learned) {
              return actionProgressed("Need alchemy to brew gate essence — learning");
            }

            const lab = ctx.findNearestEntity(entities, me, (e) => e.type === "alchemy-lab");
            if (!lab) {
              void ctx.logActivity(`Need gate essence but no alchemy lab — fighting while waiting`);
              return fallbackToCombat(ctx, `No alchemy lab to brew ${rank} gate essence`, strategy);
            }
            const [labId, labEntity] = lab;
            const moving = await ctx.moveToEntity(me, labEntity);
            if (moving) {
              ctx.setScript({ type: "dungeon", gateEntityId: targetGateId ?? undefined, gateRank: rank, reason: `Moving to alchemy lab to brew gate essence` });
              return actionProgressed(`Moving to ${labEntity.name ?? "alchemy lab"} to brew gate essence`);
            }

            try {
              await ctx.api("POST", "/alchemy/brew", {
                walletAddress: ctx.custodialWallet,
                zoneId: ctx.currentRegion,
                entityId: ctx.entityId,
                alchemyLabId: labId,
                recipeId: essenceRecipeId,
              });
              void ctx.logActivity(`Brewed gate essence for ${rank}-Key`);
              logZoneEvent({
                zoneId: ctx.currentRegion, type: "profession", tick: 0,
                message: `${me.name} brewed a gate essence for ${rank}-Key`,
                entityId: ctx.entityId, entityName: me.name,
                data: { profession: "alchemy", target: essenceRecipeId },
              });
              // Essence brewed — next tick will forge the key
              ctx.setScript({ type: "dungeon", gateEntityId: targetGateId ?? undefined, gateRank: rank, reason: `Gate essence brewed — forge key next` });
              return actionProgressed(`Brewed gate essence — will forge ${rank}-Key next`);
            } catch (err: any) {
              const reason = formatAgentError(err);
              const blockedReason = `Gate essence brew failed: ${reason}`;
              void ctx.logActivity(blockedReason);
              // Don't pin to idle — return blocked so the agent can pick a different action next tick.
              return actionBlocked(blockedReason, {
                failureKey: `dungeon:essence:${rank}`,
                category: "strategic",
              });
            }
          }
        }
      } catch {
        // If blockchain check fails, try anyway
      }
    }

    // If we made it here without a visible gate, prep is done — wait for a surge.
    // (Reaching here without a gate means key prep was a no-op, e.g. balance check error.)
    if (!targetGate) {
      return fallbackToCombat(ctx, `Key prep done — waiting for next ${rank} gate surge`, strategy);
    }

    // ── Phase 4: Ensure party ───────────────────────────────────────────
    const partyId = getPlayerPartyId(ctx.entityId);
    if (!partyId) {
      try {
        await ctx.api("POST", "/party/create", {
          zoneId: ctx.currentRegion,
          leaderId: ctx.entityId,
        });
        void ctx.logActivity("Created solo party for dungeon entry");
      } catch (err: any) {
        // Already in party or other error — proceed anyway
        if (!err.message?.includes("Already in a party")) {
          return actionBlocked(`Party creation failed: ${err.message?.slice(0, 60)}`, {
            failureKey: "dungeon:party",
          });
        }
      }
    }

    // ── Phase 5: Walk to gate ───────────────────────────────────────────
    const dist = Math.hypot(me.x - targetGate.x, me.y - targetGate.y);
    if (dist > GATE_PROXIMITY) {
      const moving = await ctx.moveToEntity(me, targetGate, GATE_PROXIMITY - 10);
      if (moving) {
        ctx.setScript({ type: "dungeon", gateEntityId: targetGateId ?? undefined, gateRank: rank, reason: `Approaching Rank ${rank} gate` });
        return actionProgressed(`Moving to Rank ${rank} dungeon gate (${Math.round(dist)} away)`);
      }
    }

    // ── Phase 6: Open gate ──────────────────────────────────────────────
    void ctx.logActivity(`Opening Rank ${rank}${targetGate.isDangerGate ? " DANGER" : ""} dungeon gate...`);

    try {
      const result = await ctx.api("POST", "/dungeon/open", {
        walletAddress: ctx.custodialWallet,
        zoneId: ctx.currentRegion,
        entityId: ctx.entityId,
        gateEntityId: targetGateId,
      });

      const dungeonZoneId = result?.dungeonZoneId;
      const totalMobs = result?.totalMobs ?? "?";
      void ctx.logActivity(`Entered Rank ${rank} dungeon! ${totalMobs} enemies inside.`);

      // Script stays as "dungeon" — next tick we'll be in the dungeon zone and fight
      ctx.setScript({ type: "dungeon", reason: `Inside Rank ${rank} dungeon — clear all mobs` });
      return actionProgressed(`Entered dungeon ${dungeonZoneId}`);
    } catch (err: any) {
      const msg = err.message?.slice(0, 80) ?? "unknown error";
      void ctx.logActivity(`Gate opening failed: ${msg}`);
      return actionBlocked(`Dungeon open failed: ${msg}`, {
        failureKey: `dungeon:open:${rank}`,
        targetName: `${rank}-gate`,
      });
    }
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] dungeon tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `dungeon:error:${ctx.currentRegion}` });
  }
}

/** Fight mobs inside a dungeon zone. Same as regular combat but no level filtering. */
async function doDungeonCombat(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Dungeon zone state unavailable");
    const { entities, me } = zs;

    // Check if dungeon is cleared (no mobs left)
    const mobs = Object.entries(entities).filter(
      ([, e]) => e.type === "mob" && (e.hp ?? 0) > 0,
    );

    if (mobs.length === 0) {
      void ctx.logActivity("Dungeon cleared! Waiting for teleport...");
      return actionCompleted("Dungeon cleared — all mobs defeated");
    }

    // Find closest mob
    const sorted = mobs.sort(([, a], [, b]) => {
      return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    });
    const [, mob] = sorted[0] as [string, any];
    const result = engageCombatTarget(ctx, me, mob, entities);
    if (result.status === "progressed") {
      void ctx.logActivity(`Dungeon: fighting ${mob.name ?? "mob"} (${mobs.length} remain)`);
    }
    return result;
  } catch (err: any) {
    const reason = formatAgentError(err);
    return actionBlocked(reason, { failureKey: "dungeon:combat" });
  }
}
