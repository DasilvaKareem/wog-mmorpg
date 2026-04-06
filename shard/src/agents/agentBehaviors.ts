/**
 * Agent Behaviors — the 10 focus-specific behavior implementations.
 * Each function runs one tick of the behavior and is called from AgentRunner.executeCurrentScript().
 */

import { getAgentConfig, patchAgentConfig, type AgentStrategy } from "./agentConfigStore.js";
import { resolveRegionId, getRegionCenter, getZoneConnections, ZONE_LEVEL_REQUIREMENTS } from "../world/worldLayout.js";
import { getEntity as getWorldEntity, getOrCreateZone } from "../world/zoneRuntime.js";
import { getPartyLeaderId, getPartyMembers, getPlayerPartyId } from "../social/partySystem.js";
import { getItemBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import { getTechniqueById, type TechniqueDefinition } from "../combat/techniques.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";
import { resolveLiveAgentIdForWallet } from "../erc8004/agentResolution.js";
import { sendInboxMessage } from "./agentInbox.js";
import { pickLine, emitAgentChat } from "./agentDialogue.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { isQuestNpc } from "../social/questSystem.js";
import { ORE_CATALOG, type OreType } from "../resources/oreCatalog.js";
import { FLOWER_CATALOG, type FlowerType } from "../resources/flowerCatalog.js";
import { getItemByTokenId } from "../items/itemCatalog.js";
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

const PROFESSION_HUB_ZONE = "village-square";
const PICKAXE_TOKENS: Record<number, number> = { 27: 1, 28: 2, 29: 3, 30: 4 };
const SICKLE_TOKENS: Record<number, number> = { 41: 1, 42: 2, 43: 3, 44: 4 };
const HOE_TOKENS: Record<number, number> = { 220: 1, 221: 2, 222: 3, 223: 4 };
const ENCHANTMENT_ELIXIR_TOKENS = new Set([55, 56, 57, 58, 59, 60, 61]);
const AUCTION_LISTING_FEE_COPPER = 50;
const AUCTION_RELIST_COOLDOWN_MS = 10 * 60_000;
const MIN_AUCTION_VALUE_COPPER = 150;

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

function getTechniqueCooldownExpiry(entity: any, techniqueId: string): number | undefined {
  const cooldowns = entity.cooldowns;
  if (!cooldowns) return undefined;
  if (cooldowns instanceof Map) return cooldowns.get(techniqueId);
  if (typeof cooldowns === "object") {
    const raw = (cooldowns as Record<string, unknown>)[techniqueId];
    return typeof raw === "number" ? raw : undefined;
  }
  return undefined;
}

function getPartySupportMembers(entity: any, entities: Record<string, any>): any[] {
  return getPartyMembers(entity.id)
    .map((memberId) => entities[memberId] ?? getWorldEntity(memberId))
    .filter((member): member is any => !!member && member.type === "player" && member.hp > 0);
}

function hasBuffFromCaster(entity: any, target: any): boolean {
  return !!target?.activeEffects?.some((effect: any) => effect.type === "buff" && effect.casterId === entity.id);
}

function getLeaderFirstBuffTarget(entity: any, entities: Record<string, any>): any | null {
  const members = getPartySupportMembers(entity, entities);
  if (members.length <= 1) return null;

  const leaderId = getPartyLeaderId(entity.id);
  const leader = leaderId ? members.find((member) => member.id === leaderId) : undefined;
  if (leader && leader.id !== entity.id && !hasBuffFromCaster(entity, leader)) return leader;

  return members.find((member) => member.id !== entity.id && !hasBuffFromCaster(entity, member)) ?? null;
}

function getLowestHpAlly(entity: any, entities: Record<string, any>): any | null {
  const members = getPartySupportMembers(entity, entities).filter((member) => member.id !== entity.id);
  if (members.length === 0) return null;

  const lowest = members.sort((a, b) => (a.hp / Math.max(1, a.maxHp)) - (b.hp / Math.max(1, b.maxHp)))[0];
  if (!lowest) return null;
  return (lowest.hp / Math.max(1, lowest.maxHp)) < 0.9 ? lowest : null;
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

function pickCombatTechnique(entity: any, target: any, zoneTick: number, entities: Record<string, any>): TechniqueDefinition | null {
  const learned = entity.learnedTechniques ?? [];
  if (learned.length === 0) return null;

  const currentEssence = entity.essence ?? 0;
  const usable: TechniqueDefinition[] = [];
  for (const techniqueId of learned) {
    const technique = getTechniqueById(techniqueId);
    if (!technique) continue;
    if (technique.essenceCost > currentEssence) continue;
    const cooldownExpiry = getTechniqueCooldownExpiry(entity, technique.id);
    if (cooldownExpiry != null && zoneTick < cooldownExpiry) continue;
    usable.push(technique);
  }
  if (usable.length === 0) return null;

  const hasBuff = entity.activeEffects?.some((effect: any) => effect.type === "buff" && effect.casterId === entity.id);
  if (!hasBuff) {
    const buff = usable.find((technique) => technique.type === "buff" && (technique.targetType === "self" || technique.targetType === "party"));
    if (buff) return buff;
  }

  const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
  if (hpRatio < 0.4) {
    const heal = usable.find((technique) => technique.type === "healing");
    if (heal) return heal;
  }

  const lowestHpAlly = getLowestHpAlly(entity, entities);
  if (lowestHpAlly) {
    const partyHeal = usable.find((technique) => technique.type === "healing" && technique.targetType === "party");
    if (partyHeal) return partyHeal;

    const allyHeal = usable.find((technique) => technique.type === "healing" && technique.targetType === "ally");
    if (allyHeal) return allyHeal;
  }

  const leaderBuffTarget = getLeaderFirstBuffTarget(entity, entities);
  if (leaderBuffTarget) {
    const allyBuff = usable.find((technique) => technique.type === "buff" && technique.targetType === "ally");
    if (allyBuff) return allyBuff;
  }

  const hasDebuff = target.activeEffects?.some(
    (effect: any) => (effect.type === "debuff" || effect.type === "dot") && effect.casterId === entity.id,
  );
  if (!hasDebuff) {
    const debuff = usable.find((technique) => technique.type === "debuff");
    if (debuff) return debuff;
  }

  const attacks = usable
    .filter((technique) => technique.type === "attack")
    .sort((a, b) => (b.effects.damageMultiplier ?? 0) - (a.effects.damageMultiplier ?? 0));
  if (attacks.length > 0) return attacks[0];

  return null;
}

function getTechniqueTargetId(entity: any, target: any, technique: TechniqueDefinition, entities: Record<string, any>): string {
  if (technique.targetType === "self" || technique.targetType === "party") return entity.id;
  if (technique.targetType === "ally") {
    const lowHpAlly = getLowestHpAlly(entity, entities);
    if (technique.type === "healing" && lowHpAlly) return lowHpAlly.id;

    const leaderBuffTarget = getLeaderFirstBuffTarget(entity, entities);
    if (leaderBuffTarget) return leaderBuffTarget.id;

    return entity.id;
  }
  if (technique.type === "buff" || technique.type === "healing") return entity.id;
  return target.id;
}

function pickPartyCombatTarget(me: any, entities: Record<string, any>): any | null {
  const partyId = getPlayerPartyId(me.id);
  if (!partyId) return null;

  const partyMemberIds = getPartyMembers(me.id);
  if (partyMemberIds.length <= 1) return null;

  const leaderId = getPartyLeaderId(me.id);
  if (leaderId && leaderId !== me.id) {
    const leader = entities[leaderId];
    const order = leader?.order;
    if (leader?.type === "player" && leader.hp > 0 && order && (order.action === "attack" || order.action === "technique")) {
      const target = entities[order.targetId];
      if (target && target.hp > 0 && (target.type === "mob" || target.type === "boss")) {
        return target;
      }
    }
  }

  const sameParty = new Set(partyMemberIds);
  return Object.values(entities)
    .filter((entity: any) => (entity.type === "mob" || entity.type === "boss") && entity.hp > 0 && sameParty.has(entity.taggedBy))
    .sort((a: any, b: any) => {
      const distA = Math.hypot((a.x ?? 0) - (me.x ?? 0), (a.y ?? 0) - (me.y ?? 0));
      const distB = Math.hypot((b.x ?? 0) - (me.x ?? 0), (b.y ?? 0) - (me.y ?? 0));
      return distA - distB;
    })[0] ?? null;
}

function getCombatOrderTarget(me: any): any | null {
  if (!me.order) return null;
  if (me.order.action !== "attack" && me.order.action !== "technique") return null;
  const target = getWorldEntity(me.order.targetId);
  if (!target) return null;
  if (target.id === me.id) return target;
  return target.hp > 0 ? target : null;
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

function isCombatTargetAllowed(
  me: any,
  target: any,
  strategy: AgentStrategy,
  questPriority = false,
): boolean {
  const myLevel = Number(me?.level ?? 1);
  const targetLevel = Number(target?.level ?? 1);
  const hpPct = (Number(me?.hp ?? 0) / Math.max(1, Number(me?.maxHp ?? 1)));
  const targetHpPct = (Number(target?.hp ?? 0) / Math.max(1, Number(target?.maxHp ?? 1)));
  const isBoss = isBossTarget(target);

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
  options?: { questMobNames?: Set<string> },
): any | null {
  const questMobNames = options?.questMobNames;
  const scored = candidates
    .map((entry) => {
      const [, target] = entry;
      const questPriority = !!questMobNames?.has(String(target?.name ?? "").toLowerCase());
      if (!isCombatTargetAllowed(me, target, strategy, questPriority)) return null;
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
    if (me.order?.action === "technique") {
      const technique = getTechniqueById(me.order.techniqueId);
      const label = technique?.name ?? "technique";
      return actionProgressed(`Using ${label} on ${activeTarget.name ?? "target"}`);
    }
    return actionProgressed(`Attacking ${activeTarget.name ?? "target"}`);
  }

  const zoneTick = getOrCreateZone(ctx.currentRegion).tick;
  const technique = pickCombatTechnique(me, target, zoneTick, entities);
  if (technique) {
    const targetId = getTechniqueTargetId(me, target, technique, entities);
    const commandTarget = entities[targetId] ?? getWorldEntity(targetId) ?? target;
    const issued = ctx.issueCommand({ action: "technique", targetId, techniqueId: technique.id });
    if (!issued) {
      return actionBlocked(`Could not use ${technique.name}`, {
        failureKey: `combat:technique:${technique.id}`,
        targetId,
        targetName: target.name ?? "target",
      });
    }
    if (technique.targetType === "party") {
      logPartyCoordination(ctx, me, "party-technique", `${me.name ?? "Party member"} uses ${technique.name} for the party`, {
        techniqueId: technique.id,
        techniqueName: technique.name,
      });
    } else if (technique.targetType === "ally" && targetId !== me.id) {
      const allyTarget = commandTarget;
      const leaderId = getPartyLeaderId(me.id);
      const isLeaderTarget = targetId === leaderId;
      const kind = technique.type === "healing"
        ? (isLeaderTarget ? "heal-leader" : "heal-ally")
        : (isLeaderTarget ? "buff-leader" : "buff-ally");
      logPartyCoordination(
        ctx,
        me,
        kind,
        `${me.name ?? "Party member"} uses ${technique.name} on ${allyTarget?.name ?? "an ally"}`,
        {
          targetId,
          targetName: allyTarget?.name,
          techniqueId: technique.id,
          techniqueName: technique.name,
          leaderId,
        },
      );
    }
    const targetLabel = targetId === me.id ? "self" : (commandTarget.name ?? "target");
    void ctx.logActivity(`Using ${technique.name} on ${targetLabel}`);
    return actionProgressed(`Using ${technique.name} on ${targetLabel}`);
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

/**
 * Nodes blacklisted due to "skill too low" — prevents agents from
 * hammering the same node hundreds of times. Entries expire after 5 minutes
 * so the agent retries once its skill may have improved.
 */
const gatherSkillBlacklist = new Set<string>();
setInterval(() => gatherSkillBlacklist.clear(), 5 * 60_000);

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
): [string, any] | null {
  const matches = Object.entries(entities)
    .filter(([id, e]) => {
      if (gatherSkillBlacklist.has(id)) return false;
      const alive = !e.depletedAtTick && (e.charges ?? 0) > 0;
      if (preference === "ore") return e.type === "ore-node" && alive;
      if (preference === "herb") return e.type === "flower-node" && alive;
      return (e.type === "ore-node" || e.type === "flower-node") && alive;
    })
    .sort(([, a], [, b]) => {
      const tierDiff = requiredNodeTier(a) - requiredNodeTier(b);
      if (tierDiff !== 0) return tierDiff;
      return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    });
  return matches[0] as [string, any] ?? null;
}

async function routeToProfessionHub(ctx: AgentContext, reason: string): Promise<boolean> {
  if (ctx.currentRegion === PROFESSION_HUB_ZONE) return false;
  void ctx.logActivity(reason);
  ctx.setScript({ type: "travel", targetZone: PROFESSION_HUB_ZONE, reason });
  return ctx.issueCommand({ action: "travel", targetZone: PROFESSION_HUB_ZONE });
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
  const rerouted = await routeToProfessionHub(
    ctx,
    `Traveling to ${PROFESSION_HUB_ZONE} to buy a tier ${requiredTier} ${toolLabel}`,
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

    const eligible = Object.entries(entities).filter(
      ([, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && (e.level ?? 1) <= maxMobLevel,
    );
    if (eligible.length === 0) {
      return actionBlocked("No eligible mobs in zone", {
        failureKey: `combat:no-targets:${ctx.currentRegion}`,
        targetName: ctx.currentRegion,
      });
    }

    const activeTarget = getCombatOrderTarget(me);
    if (activeTarget && isCombatTargetAllowed(me, activeTarget, strategy)) {
      return engageCombatTarget(ctx, me, activeTarget, entities);
    }

    if (activeTarget) {
      const fallback = getRegionCenter(ctx.currentRegion);
      if (fallback) {
        ctx.issueCommand({ action: "move", x: fallback.x, y: fallback.z });
      }
      void ctx.logActivity(`Disengaging from ${activeTarget.name ?? "target"} — too dangerous for ${strategy} strategy`);
      return actionProgressed(`Disengaging from ${activeTarget.name ?? "target"}`);
    }

    const partyTarget = pickPartyCombatTarget(me, entities);
    if (partyTarget && isCombatTargetAllowed(me, partyTarget, strategy)) {
      const leader = partyLeaderId ? entities[partyLeaderId] : null;
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

    const mob = pickCombatTarget(me, eligible, strategy);
    if (!mob) {
      return actionBlocked("No safe combat targets for current strategy", {
        failureKey: `combat:no-safe-targets:${ctx.currentRegion}:${strategy}`,
        targetName: ctx.currentRegion,
        category: "strategic",
      });
    }
    return engageCombatTarget(ctx, me, mob, entities);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] combat tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `combat:error:${ctx.currentRegion}` });
  }
}

// ── Gathering ────────────────────────────────────────────────────────────────

export async function doGathering(
  ctx: AgentContext,
  strategy: AgentStrategy,
  preference: GatherPreference = "both",
): Promise<ActionResult> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const node = findGatherNode(entities, me, preference);
    if (!node) {
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
          gatherSkillBlacklist.add(nodeId);
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
          gatherSkillBlacklist.add(nodeId);
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
      return actionProgressed("Working toward alchemy access");
    }

    const lab = ctx.findNearestEntity(entities, me, (e) => e.type === "alchemy-lab");
    if (!lab) {
      void ctx.logActivity("No alchemy lab here — gathering herbs instead");
      return doGathering(ctx, strategy, "herb");
    }

    const [labId, labEntity] = lab;
    const moving = await ctx.moveToEntity(me, labEntity);
    if (moving) return actionProgressed(`Moving to ${labEntity.name ?? "alchemy lab"}`);

    const recipesRes = await ctx.api("GET", "/alchemy/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);
    if (recipes.length === 0) {
      void ctx.logActivity("No alchemy recipes available — gathering materials");
      return doGathering(ctx, strategy, "herb");
    }

    let lastError: string | null = null;
    for (const recipe of recipes) {
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

    void ctx.logActivity("Missing ingredients for all potions — gathering herbs");
    const gatherResult = await doGathering(ctx, strategy, "herb");
    return lastError ? actionBlocked(lastError, {
      failureKey: `alchemy:brew:${ctx.currentRegion}`,
      endpoint: "/alchemy/brew",
    }) : gatherResult;
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] alchemy tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `alchemy:error:${ctx.currentRegion}` });
  }
}

// ── Cooking ──────────────────────────────────────────────────────────────────

export async function doCooking(ctx: AgentContext, strategy: AgentStrategy): Promise<ActionResult> {
  try {
    // Auto-learn cooking profession
    const learned = await ctx.learnProfession("cooking");
    if (!learned) {
      void ctx.logActivity("Can't cook — no cooking trainer nearby");
      return doGathering(ctx, strategy);
    }

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { entities, me } = zs;

    const campfire = ctx.findNearestEntity(entities, me, (e) => e.type === "campfire");
    if (!campfire) {
      void ctx.logActivity("No campfire here — gathering ingredients instead");
      return doGathering(ctx, strategy);
    }

    const [campfireId, campfireEntity] = campfire;
    const moving = await ctx.moveToEntity(me, campfireEntity);
    if (moving) return actionProgressed(`Moving to ${campfireEntity.name ?? "campfire"}`);

    const recipesRes = await ctx.api("GET", "/cooking/recipes");
    const recipes = recipesRes?.recipes ?? [];
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

    void ctx.logActivity("Can't cook anything — missing ingredients, going to gather");
    const gatherResult = await doGathering(ctx, strategy);
    return lastError ? actionBlocked(lastError, {
      failureKey: `cooking:cook:${ctx.currentRegion}`,
      endpoint: "/cooking/cook",
    }) : gatherResult;
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

    if (me.equipment?.weapon) {
      if (me.equipment.weapon.enchantments && me.equipment.weapon.enchantments.length > 0) {
        void ctx.logActivity("Weapon already enchanted — crafting more gear");
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
        equipmentSlot: "weapon",
      });
      void ctx.logActivity(`Enchanted weapon with ${elixir.name}`);
      logZoneEvent({
        zoneId: ctx.currentRegion, type: "profession", tick: 0,
        message: `${me.name} is enchanting a weapon with ${elixir.name}`,
        entityId: ctx.entityId, entityName: me.name,
        data: { profession: "enchanting", target: elixir.name },
      });
      return actionCompleted(`Enchanted weapon with ${elixir.name}`);
    } else {
      void ctx.logActivity("No weapon to enchant — forging one first");
      return doCrafting(ctx, strategy);
    }
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

    void ctx.logActivity("Missing materials for all recipes — gathering ore");
    const gatherResult = await doGathering(ctx, strategy, "ore");
    return lastError ? actionBlocked(lastError, {
      failureKey: `crafting:forge:${ctx.currentRegion}`,
      endpoint: "/crafting/forge",
    }) : gatherResult;
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
      return fallbackToCombat(ctx, "No tanning rack in this zone", strategy);
    }

    const [rackId, rackEntity] = rack;
    const moving = await ctx.moveToEntity(me, rackEntity);
    if (moving) return actionProgressed(`Moving to ${rackEntity.name ?? "tanning rack"}`);

    const recipesRes = await ctx.api("GET", "/leatherworking/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);

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

    void ctx.logActivity("Missing materials for leatherworking — skinning");
    const gatherResult = await doGathering(ctx, strategy);
    return lastError ? actionBlocked(lastError, {
      failureKey: `leatherworking:craft:${ctx.currentRegion}`,
      endpoint: "/leatherworking/craft",
    }) : gatherResult;
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
      return fallbackToCombat(ctx, "No jeweler's bench in this zone", strategy);
    }

    const [stationId, benchEntity] = bench;
    const moving = await ctx.moveToEntity(me, benchEntity);
    if (moving) return actionProgressed(`Moving to ${benchEntity.name ?? "jeweler's bench"}`);

    const recipesRes = await ctx.api("GET", "/jewelcrafting/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);

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

    void ctx.logActivity("Missing materials for jewelcrafting — gathering ore");
    const gatherResult = await doGathering(ctx, strategy, "ore");
    return lastError ? actionBlocked(lastError, {
      failureKey: `jewelcrafting:craft:${ctx.currentRegion}`,
      endpoint: "/jewelcrafting/craft",
    }) : gatherResult;
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

    const merchant = ctx.findNearestEntity(entities, me, (e) => e.type === "merchant");
    if (!merchant) {
      return fallbackToCombat(ctx, "No merchants in this zone", strategy);
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

    for (const slot of emptySlots) {
      const matching = items.filter((item: any) => {
        if (slot === "weapon") return item.equipSlot === "weapon" || item.category === "weapon";
        return item.armorSlot === slot || item.equipSlot === slot;
      }).sort((a: any, b: any) => (a.copperPrice ?? a.buyPrice ?? 9999) - (b.copperPrice ?? b.buyPrice ?? 9999));

      if (matching.length === 0) continue;
      const cheapest = matching[0];
      const priceCopper = cheapest.currentPrice ?? cheapest.copperPrice ?? cheapest.buyPrice ?? 0;
      if (priceCopper > copperBalance) continue;

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

      const tokenId = Number(cheapest.tokenId);
      const bought = await ctx.buyItem(tokenId);
      if (!bought) continue;

      await ctx.equipItem(tokenId);
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
    const rawTargetZone = config?.targetZone;
    const targetZone = resolveRegionId(rawTargetZone);

    if (rawTargetZone && !targetZone) {
      console.log(`[agent:${ctx.walletTag}] Invalid travel target zone: ${rawTargetZone}`);
      void ctx.logActivity(`Unknown destination "${rawTargetZone}" — clearing travel target`);
      await patchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
      return actionCompleted(`Cleared invalid destination ${rawTargetZone}`);
    }

    if (!targetZone || targetZone === ctx.currentRegion) {
      console.log(`[agent:${ctx.walletTag}] Arrived at ${ctx.currentRegion}, switching to questing`);
      void ctx.logActivity(`Arrived at ${ctx.currentRegion}, resuming questing`);
      await patchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
      return actionCompleted(`Arrived at ${ctx.currentRegion}`);
    }

    const center = getRegionCenter(targetZone);
    if (!center) {
      console.log(`[agent:${ctx.walletTag}] Unknown region: ${targetZone}`);
      await patchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
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

    // ── Position-based goto (click-to-move) ─────────────────────────────
    const pos = config?.gotoPosition;
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
      if (dist <= 35) {
        // Arrived — clear position, idle
        void ctx.logActivity(`Arrived at waypoint (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
        ctx.setEntityGotoMode(false);
        await patchAgentConfig(ctx.userWallet, { gotoPosition: undefined });
        ctx.setScript(null);
        return actionCompleted("Arrived at waypoint");
      }

      // Still walking — issue/reissue move command
      const moving = await ctx.moveToEntity(me, { x: pos.x, y: pos.y, name: "waypoint" } as any);
      if (moving) {
        void ctx.logActivity(`Walking to waypoint (${Math.round(dist)} away)`);
        return actionProgressed("Walking to waypoint");
      }

      // moveToEntity returned false = close enough
      void ctx.logActivity(`Arrived at waypoint`);
      ctx.setEntityGotoMode(false);
      await patchAgentConfig(ctx.userWallet, { gotoPosition: undefined });
      ctx.setScript(null);
      return actionCompleted("Arrived at waypoint");
    }

    // ── Entity-based goto (NPC click) ───────────────────────────────────
    const target = config?.gotoTarget;
    if (!target) {
      ctx.setEntityGotoMode(false);
      await patchAgentConfig(ctx.userWallet, { gotoTarget: undefined });
      ctx.setScript(null);
      return actionCompleted("Goto target cleared");
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

    if (!targetEntity) {
      void ctx.logActivity(`Could not find ${targetName ?? targetEntityId} in ${ctx.currentRegion}`);
      ctx.setEntityGotoMode(false);
      await patchAgentConfig(ctx.userWallet, { gotoTarget: undefined });
      ctx.setScript(null);
      return actionBlocked(`Could not find ${targetName ?? targetEntityId} in ${ctx.currentRegion}`, {
        failureKey: `goto:missing:${targetEntityId}`,
        targetId: targetEntityId,
        targetName,
        category: "strategic",
      });
    }

    const moving = await ctx.moveToEntity(me, targetEntity);
    if (moving) {
      void ctx.logActivity(`Walking to ${targetName ?? "NPC"}`);
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
    ctx.setEntityGotoMode(false);
    // Clear the goto target but preserve the previous focus instead of blindly resetting to questing.
    // The runner will pick the next script based on whatever focus the user had set.
    await patchAgentConfig(ctx.userWallet, { gotoTarget: undefined });
    ctx.setScript(null);
    return actionCompleted(`Arrived at ${targetName ?? targetEntityId}`);
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
    const activeQuests: any[] = activeRes?.activeQuests ?? [];

    for (const aq of activeQuests) {
      if (aq.complete && aq.quest?.npcId) {
        const npcName = String(aq.quest?.npcId ?? "").toLowerCase();
        const npcEntry = Object.entries(entities).find(([, e]: [string, any]) => {
          if (!e) return false;
          return String(e.name ?? "").toLowerCase() === npcName;
        });
        if (npcEntry) {
          const [npcEntityId, npcEntity] = npcEntry;
          const cooldownKey = `quest-complete:${aq.questId}:${npcEntityId}`;
          if (ctx.isInteractionOnCooldown(cooldownKey)) continue;
          const moving = await ctx.moveToEntity(me, npcEntity);
          if (moving) {
            void ctx.logActivity(`Walking to ${aq.quest?.npcId} to turn in "${aq.quest?.title}"`);
            return actionProgressed(`Walking to ${aq.quest?.npcId}`);
          }
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
        const targetNpcName = String(tq.quest?.objective?.targetNpcName ?? tq.quest?.npcId ?? "").toLowerCase();
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

    // 3. Request quest approval from summoner (don't auto-accept)
    const currentActive = activeQuests.filter((aq: any) => !aq.complete).length;
    const pendingApprovals: string[] = me.pendingQuestApprovals ?? [];
    if (currentActive + pendingApprovals.length < 3) {
      try {
        const availRes = await ctx.api("GET", `/quests/zone/${ctx.currentRegion}/${ctx.entityId}`);
        const available: any[] = availRes?.quests ?? [];
        // Filter out quests already pending approval
        const pendingSet = new Set(pendingApprovals);
        const requestable = available.filter((q: any) => !pendingSet.has(q.questId));
        if (requestable.length > 0) {
          const q = requestable[0];
          // Mark as pending on the entity so we don't spam the summoner
          if (!me.pendingQuestApprovals) me.pendingQuestApprovals = [];
          me.pendingQuestApprovals.push(q.questId);
          // Ask summoner for approval via inbox
          const agentName = me.name ?? "Agent";
          const origin = me.origin ?? undefined;
          const classId = me.classId ?? undefined;
          const askLine = pickLine(origin, classId, "summon_quest_accept")
            ?? `I found a quest: "${q.title}". May I take it, summoner?`;
          const askBody = askLine.replace(/\{detail\}/g, q.title ?? "a quest");
          void sendInboxMessage({
            from: ctx.custodialWallet,
            fromName: agentName,
            to: ctx.userWallet,
            type: "quest-approval",
            body: askBody,
            data: {
              questId: q.questId,
              questTitle: q.title,
              npcName: q.npcName,
              rewards: q.rewards,
              objective: q.objective,
            },
          });
          void ctx.logActivity(`Requesting approval for quest: "${q.title}"`);
          // Emit in-world chat about picking up the quest
          emitAgentChat({
            entityId: ctx.entityId, entityName: me.name ?? "Agent",
            zoneId: ctx.currentRegion, event: "quest_accept",
            origin, classId, detail: q.title,
          });
          return actionProgressed(`Awaiting summoner approval for ${q.title}`);
        } else if (currentActive === 0 && requestable.length === 0 && pendingApprovals.length === 0) {
          const myLevel = me.level ?? 1;
          const nextZone = findNextZoneForLevel(myLevel);
          if (nextZone && nextZone !== ctx.currentRegion) {
            console.log(`[agent:${ctx.walletTag}] No quests left in ${ctx.currentRegion}, traveling to ${nextZone}`);
            void ctx.logActivity(`No quests remaining — traveling to ${nextZone}`);
            await patchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone: nextZone });
            ctx.setScript(null);
            return actionProgressed(`Traveling to ${nextZone} for new quests`);
          }
        }
      } catch (err: any) {
        console.debug(`[agent:${ctx.walletTag}] quest approval request: ${err.message?.slice(0, 60)}`);
      }
    }

    // 4. Progress kill/gather quests
    const killQuests = activeQuests.filter(
      (aq: any) => !aq.complete && aq.quest?.objective?.type === "kill",
    );
    const hasGatherQuest = activeQuests.some(
      (aq: any) => !aq.complete && (aq.quest?.objective?.type === "gather" || aq.quest?.objective?.type === "craft"),
    );

    if (killQuests.length > 0) {
      // Prefer quest-specific mobs over random combat
      const questMobNames = new Set(
        killQuests.map((aq: any) => (aq.quest?.objective?.targetMobName ?? "").toLowerCase()).filter(Boolean),
      );
      const combatResult = await doQuestCombat(ctx, strategy, questMobNames);

      // If combat is blocked, do something productive instead of spinning
      if (combatResult.status === "blocked") {
        // Try gather/craft quests first
        if (hasGatherQuest) {
          void ctx.logActivity("Quest combat blocked — gathering for quest instead");
          return doGathering(ctx, strategy);
        }
        // Otherwise do any productive non-combat activity
        return questBlockedFallback(ctx, strategy, combatResult.reason ?? "no safe targets", findNextZoneForLevel, me);
      }
      return combatResult;
    } else if (hasGatherQuest) {
      void ctx.logActivity("Gathering resources for quest");
      return doGathering(ctx, strategy);
    } else {
      const pendingCount = (me.pendingQuestApprovals ?? []).length;
      const activeCount = activeQuests.filter((aq: any) => !aq.complete).length;
      const detail = `active=${activeCount} pending=${pendingCount} total=${activeQuests.length}`;
      console.warn(`[agent:${ctx.walletTag}] Quest fallback to combat: no kill/gather objectives (${detail})`);
      void ctx.logActivity(`No quest objectives — grinding mobs while waiting (${detail})`);
      return fallbackToCombat(ctx, `No quest objectives (${detail})`, strategy);
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

    const mob = pickCombatTarget(me, eligible, strategy, { questMobNames });
    if (!mob) {
      return actionBlocked("Quest targets are too dangerous for current strategy", {
        failureKey: `quest-combat:no-safe-targets:${ctx.currentRegion}:${strategy}`,
        targetName: ctx.currentRegion,
        category: "strategic",
      });
    }
    const isQuestTarget = questMobNames.has((mob.name ?? "").toLowerCase());
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
      await patchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone: betterZone });
      ctx.setScript(null);
      return actionProgressed(`Traveling to ${betterZone} — current zone too dangerous`);
    }
  }

  // Option 2: Try gathering — always productive, earns profession XP
  void ctx.logActivity(`Quest combat blocked (${reason}) — gathering while waiting`);
  const gatherResult = await doGathering(ctx, strategy);
  if (gatherResult.status !== "blocked") return gatherResult;

  // Option 3: Try crafting with existing materials
  void ctx.logActivity("Gathering blocked too — trying to craft");
  return actionProgressed(`Quest combat paused: ${reason} — looking for other work`);
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

    if (!targetGate) {
      // Scan zone for available gates, pick the best one we can handle
      const gates = Object.entries(entities).filter(
        ([, e]) => e.type === "dungeon-gate" && !e.gateOpened && (!e.gateExpiresAt || e.gateExpiresAt > Date.now()),
      );

      if (gates.length === 0) {
        return fallbackToCombat(ctx, "No dungeon gates available", strategy);
      }

      const myLevel = me.level ?? 1;

      // Pick the highest-rank gate we qualify for
      const eligible = gates.filter(([, g]) => {
        const rank = g.gateRank as string;
        return myLevel >= (RANK_LEVEL_REQS[rank] ?? 999);
      }).sort(([, a], [, b]) => {
        // Prefer higher rank
        const rankOrder = "EDCBAS";
        return rankOrder.indexOf(b.gateRank) - rankOrder.indexOf(a.gateRank);
      });

      if (eligible.length === 0) {
        return fallbackToCombat(ctx, "No gates match my level", strategy);
      }

      [targetGateId, targetGate] = eligible[0] as [string, any];
    }

    const rank = targetGate.gateRank as string;
    const keyTokenId = RANK_TO_KEY_TOKEN[rank];

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
              ctx.setScript({ type: "dungeon", gateEntityId: targetGateId!, gateRank: rank, reason: `Moving to enchanting altar to forge ${rank}-Key` });
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
              ctx.setScript({ type: "dungeon", gateEntityId: targetGateId!, gateRank: rank, reason: `${rank}-Key forged — heading to gate` });
              return actionProgressed(`Forged ${rank}-Key — heading to dungeon gate`);
            } catch (err: any) {
              const reason = formatAgentError(err);
              void ctx.logActivity(`Key forging failed: ${reason}`);
              return actionBlocked(reason, { failureKey: `dungeon:forge-key:${rank}` });
            }
          } else {
            // No reagent — brew the gate essence at the alchemy lab
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
              ctx.setScript({ type: "dungeon", gateEntityId: targetGateId!, gateRank: rank, reason: `Moving to alchemy lab to brew gate essence` });
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
              ctx.setScript({ type: "dungeon", gateEntityId: targetGateId!, gateRank: rank, reason: `Gate essence brewed — forge key next` });
              return actionProgressed(`Brewed gate essence — will forge ${rank}-Key next`);
            } catch (err: any) {
              const reason = formatAgentError(err);
              void ctx.logActivity(`Gate essence brewing failed: ${reason} — gathering materials`);
              // Missing materials — go gather
              return doGathering(ctx, strategy, "both");
            }
          }
        }
      } catch {
        // If blockchain check fails, try anyway
      }
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
        ctx.setScript({ type: "dungeon", gateEntityId: targetGateId!, gateRank: rank, reason: `Approaching Rank ${rank} gate` });
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
