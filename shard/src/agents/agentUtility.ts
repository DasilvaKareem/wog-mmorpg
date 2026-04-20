import { getAvailableQuestsForPlayer, isQuestNpc } from "../social/questSystem.js";
import { findBestProgressionZone, findBestZoneForLevelBand } from "./agentChains.js";
import { ZONE_LEVEL_REQUIREMENTS } from "../world/worldLayout.js";
import type { AgentFocus, AgentStrategy } from "./agentConfigStore.js";
import type { FailureMemoryEntry, LiquidationInventoryItem } from "./agentUtils.js";
import type { BotScript, BotScriptType, TriggerEvent } from "../types/botScriptTypes.js";

const STRATEGIC_SCRIPTS = ["combat", "quest", "shop", "trade", "travel", "learn", "dungeon"] as const;
type StrategicScriptType = (typeof STRATEGIC_SCRIPTS)[number];

const EARLY_GAME_COPPER = 100;
const CHEAPEST_WEAPON_COPPER = 10;
const WEAK_MOB_LEVEL_GAP = 7;
const RANK_LEVELS: Record<string, number> = { E: 3, D: 7, C: 12, B: 18, A: 28, S: 40 };

export interface UtilityDecisionContext {
  trigger: TriggerEvent;
  currentScript: BotScript | null;
  currentScriptProgressing: boolean;
  queueActive: boolean;
  queuedActionCount: number;
  userFocus: AgentFocus;
  strategy: AgentStrategy;
  currentRegion: string;
  level: number;
  hpPct: number;
  weaponEquipped: boolean;
  emptyGearSlots: number;
  copper: number;
  recyclableCopper: number;
  safeMobCount: number;
  livingMobCount: number;
  merchantNearby: boolean;
  trainerNearby: boolean;
  activeQuestCount: number;
  progressableQuestCount: number;
  availableQuestCount: number;
  questNpcCount: number;
  dungeonGateEligible: boolean;
  dungeonGateId?: string;
  dungeonGateRank?: string;
  zoneTooEasy: boolean;
  zoneTooHard: boolean;
  suggestedTravelZone: string | null;
  recentFailures: Partial<Record<StrategicScriptType, number>>;
}

export interface BuildUtilityDecisionContextParams {
  trigger: TriggerEvent;
  entity: any;
  entities: Record<string, any>;
  currentRegion: string;
  currentScript: BotScript | null;
  currentScriptProgressing: boolean;
  queueActive: boolean;
  queuedActionCount: number;
  userFocus: AgentFocus;
  strategy: AgentStrategy;
  copper: number;
  inventoryItems: LiquidationInventoryItem[];
  recentFailures: FailureMemoryEntry[];
  allowedZones?: string[] | "all";
  ignoreWeakMobs?: boolean;
}

export interface ScriptScore {
  type: StrategicScriptType;
  script: BotScript;
  score: number;
  reasons: string[];
}

export interface UtilityDecision {
  context: UtilityDecisionContext;
  winner: ScriptScore;
  scores: ScriptScore[];
  shouldEscalateToSupervisor: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hpCurve(hpPct: number): number {
  return clamp01((hpPct - 0.25) / 0.75);
}

function affordWeaponCurve(copper: number): number {
  return clamp01(copper / 15);
}

function affordGearCurve(copper: number): number {
  return clamp01(copper / 100);
}

function failurePenalty(fails: number): number {
  return Math.min(0.6, fails * 0.12);
}

function focusFit(userFocus: AgentFocus, scriptType: StrategicScriptType): number {
  switch (scriptType) {
    case "combat":
      return userFocus === "combat" ? 1 : userFocus === "questing" ? 0.8 : 0.35;
    case "quest":
      return userFocus === "questing" ? 1 : userFocus === "combat" ? 0.55 : 0.3;
    case "shop":
      return userFocus === "shopping" ? 1 : 0.35;
    case "trade":
      return userFocus === "trading" ? 1 : 0.35;
    case "travel":
      return userFocus === "traveling" ? 1 : 0.25;
    case "learn":
      return userFocus === "learning" ? 1 : 0.3;
    case "dungeon":
      return userFocus === "dungeon" ? 1 : userFocus === "combat" || userFocus === "questing" ? 0.5 : 0.2;
    default:
      return 0.25;
  }
}

function isSafeCombatTarget(
  level: number,
  hpPct: number,
  target: any,
  strategy: AgentStrategy,
  ignoreWeakMobs: boolean,
): boolean {
  const targetLevel = Number(target?.level ?? 1);
  const isBoss = target?.type === "boss";

  if (ignoreWeakMobs && !isBoss && level - targetLevel >= WEAK_MOB_LEVEL_GAP) {
    return false;
  }
  if (strategy !== "aggressive" && isBoss) {
    return false;
  }
  if (strategy === "defensive") {
    return hpPct >= 0.7 && targetLevel <= level;
  }
  if (strategy === "balanced") {
    return hpPct >= 0.55 && targetLevel <= level + 1;
  }
  return hpPct >= 0.45 && targetLevel <= level + 3;
}

function buildFailureMap(recentFailures: FailureMemoryEntry[]): Partial<Record<StrategicScriptType, number>> {
  const next: Partial<Record<StrategicScriptType, number>> = {};
  for (const entry of recentFailures) {
    const type = entry.scriptType as StrategicScriptType | undefined;
    if (!type || !STRATEGIC_SCRIPTS.includes(type)) continue;
    next[type] = Math.max(next[type] ?? 0, entry.consecutive ?? 0);
  }
  return next;
}

function buildScript(type: StrategicScriptType, ctx: UtilityDecisionContext, reasons: string[]): BotScript {
  const reason = `Utility: ${reasons.slice(0, 2).join("; ") || "best strategic fit right now"}`;
  switch (type) {
    case "travel":
      return {
        type,
        targetZone: ctx.suggestedTravelZone ?? undefined,
        reason,
      };
    case "dungeon":
      return {
        type,
        gateEntityId: ctx.dungeonGateId,
        gateRank: ctx.dungeonGateRank,
        reason,
      };
    default:
      return { type, reason };
  }
}

function scoreCandidate(ctx: UtilityDecisionContext, type: StrategicScriptType): ScriptScore {
  const reasons: string[] = [];
  const sameScript = ctx.currentScript?.type === type;
  const inertiaBonus = sameScript && ctx.currentScriptProgressing ? 1.15 : 1;
  const failPenalty = failurePenalty(ctx.recentFailures[type] ?? 0);

  let viability = 1;
  let opportunity = 0;
  let safety = 0.6;
  let economyValue = 0.3;
  let progressionValue = 0.4;
  const directiveFit = focusFit(ctx.userFocus, type);

  switch (type) {
    case "combat": {
      viability = ctx.safeMobCount > 0 ? 1 : 0;
      opportunity = clamp01(ctx.safeMobCount / 4);
      safety = hpCurve(ctx.hpPct) * (ctx.zoneTooHard ? 0.3 : 1);
      economyValue = ctx.copper < EARLY_GAME_COPPER ? 0.9 : 0.4;
      progressionValue = ctx.zoneTooEasy ? 0.2 : ctx.zoneTooHard ? 0.1 : 0.8;
      if (ctx.safeMobCount > 0) reasons.push(`${ctx.safeMobCount} safe mobs nearby`);
      if (ctx.copper < EARLY_GAME_COPPER) reasons.push("early-game gold still needed");
      if (!ctx.weaponEquipped && ctx.copper >= CHEAPEST_WEAPON_COPPER) {
        viability *= 0.35;
        reasons.push("weapon is affordable, so shopping is stronger");
      }
      break;
    }
    case "quest": {
      viability = ctx.activeQuestCount > 0 || ctx.availableQuestCount > 0 ? 1 : 0;
      if (ctx.copper < EARLY_GAME_COPPER) viability *= 0.15;
      opportunity = ctx.progressableQuestCount > 0
        ? 1
        : ctx.availableQuestCount > 0
          ? 0.65
          : 0;
      safety = hpCurve(ctx.hpPct) * (ctx.safeMobCount > 0 || ctx.questNpcCount > 0 ? 1 : 0.35);
      economyValue = ctx.copper < EARLY_GAME_COPPER ? 0.15 : 0.5;
      progressionValue = ctx.activeQuestCount > 0 ? 1 : ctx.availableQuestCount > 0 ? 0.75 : 0.2;
      if (ctx.activeQuestCount > 0) reasons.push(`${ctx.activeQuestCount} active quests`);
      if (ctx.availableQuestCount > 0) reasons.push(`${ctx.availableQuestCount} quests available here`);
      if (ctx.copper < EARLY_GAME_COPPER) reasons.push("early-game rules still favor combat");
      break;
    }
    case "shop": {
      viability = !ctx.weaponEquipped || ctx.emptyGearSlots > 0 ? 1 : 0;
      opportunity = !ctx.weaponEquipped ? 1 : clamp01(ctx.emptyGearSlots / 5);
      safety = ctx.merchantNearby ? 1 : 0.55;
      economyValue = !ctx.weaponEquipped ? affordWeaponCurve(ctx.copper) : affordGearCurve(ctx.copper);
      progressionValue = !ctx.weaponEquipped ? 1 : 0.55;
      if (!ctx.weaponEquipped) reasons.push("weapon slot is empty");
      if (ctx.emptyGearSlots > 0) reasons.push(`${ctx.emptyGearSlots} gear slots still empty`);
      if (ctx.merchantNearby) reasons.push("merchant is nearby");
      break;
    }
    case "trade": {
      viability = ctx.recyclableCopper > 0 ? 1 : 0;
      opportunity = clamp01(ctx.recyclableCopper / 200);
      safety = ctx.merchantNearby ? 1 : 0.5;
      economyValue = ctx.copper < EARLY_GAME_COPPER ? 1 : 0.45;
      progressionValue = !ctx.weaponEquipped && ctx.copper + ctx.recyclableCopper >= CHEAPEST_WEAPON_COPPER ? 1 : 0.5;
      if (ctx.recyclableCopper > 0) reasons.push(`${ctx.recyclableCopper}c recyclable value on hand`);
      if (!ctx.weaponEquipped && ctx.copper + ctx.recyclableCopper >= CHEAPEST_WEAPON_COPPER) {
        reasons.push("recycling would unlock a weapon purchase");
      }
      break;
    }
    case "travel": {
      viability = ctx.suggestedTravelZone && ctx.suggestedTravelZone !== ctx.currentRegion ? 1 : 0.35;
      opportunity = ctx.zoneTooEasy || ctx.zoneTooHard
        ? 1
        : ctx.safeMobCount === 0 && ctx.progressableQuestCount === 0
          ? 0.7
          : 0.2;
      safety = ctx.zoneTooHard ? 1 : 0.65;
      economyValue = 0.25;
      progressionValue = ctx.zoneTooEasy ? 0.8 : ctx.zoneTooHard ? 0.95 : 0.45;
      if (ctx.zoneTooHard) reasons.push("current zone looks too dangerous");
      if (ctx.zoneTooEasy) reasons.push("current zone looks outleveled");
      if (ctx.suggestedTravelZone && ctx.suggestedTravelZone !== ctx.currentRegion) {
        reasons.push(`better zone match: ${ctx.suggestedTravelZone}`);
      }
      break;
    }
    case "learn": {
      viability = ctx.trainerNearby ? 1 : 0.45;
      opportunity = ctx.trainerNearby ? 0.9 : 0.25;
      safety = ctx.trainerNearby ? 1 : 0.65;
      economyValue = clamp01(ctx.copper / 120);
      progressionValue = ctx.level >= 3 ? 0.75 : 0.25;
      if (ctx.trainerNearby) reasons.push("trainer is nearby");
      if (ctx.copper >= 30) reasons.push("enough copper to afford technique training");
      break;
    }
    case "dungeon": {
      viability = ctx.dungeonGateEligible ? 1 : 0;
      opportunity = ctx.dungeonGateEligible ? 1 : 0;
      safety = ctx.hpPct > 0.8 ? 1 : 0.35;
      economyValue = 0.6;
      progressionValue = 0.95;
      if (ctx.dungeonGateEligible) reasons.push(`eligible Rank ${ctx.dungeonGateRank ?? "?"} gate is up`);
      if (ctx.hpPct <= 0.8) reasons.push("HP is a bit low for a dungeon push");
      break;
    }
  }

  if (sameScript && ctx.currentScriptProgressing) {
    reasons.push("current script is still making progress");
  }
  if ((ctx.recentFailures[type] ?? 0) > 0) {
    reasons.push(`${ctx.recentFailures[type]} recent ${type} failures`);
  }

  const weighted = (
    0.3 * directiveFit +
    0.25 * opportunity +
    0.2 * safety +
    0.15 * economyValue +
    0.1 * progressionValue
  );
  const score = Math.max(0, Number((viability * inertiaBonus * weighted - failPenalty).toFixed(3)));

  return {
    type,
    script: buildScript(type, ctx, reasons),
    score,
    reasons,
  };
}

export function buildUtilityDecisionContext(
  params: BuildUtilityDecisionContextParams,
): UtilityDecisionContext {
  const level = Number(params.entity?.level ?? 1);
  const hpPct = Number(params.entity?.hp ?? 0) / Math.max(1, Number(params.entity?.maxHp ?? 1));
  const equipment = params.entity?.equipment ?? {};
  const weaponEquipped = !!equipment.weapon;
  const emptyGearSlots = ["weapon", "chest", "legs", "boots", "helm"].filter((slot) => !equipment[slot]).length;
  const ignoreWeakMobs = params.ignoreWeakMobs ?? true;

  const livingMobs = Object.values(params.entities).filter(
    (other: any) => (other.type === "mob" || other.type === "boss") && other.hp > 0,
  );
  const safeMobCount = livingMobs.filter((other: any) =>
    isSafeCombatTarget(level, hpPct, other, params.strategy, ignoreWeakMobs)
  ).length;

  let merchantNearby = false;
  let trainerNearby = false;
  let questNpcCount = 0;
  let availableQuestCount = 0;

  const completedQuestIds: string[] = params.entity?.completedQuests ?? [];
  const activeQuestIds: string[] = (params.entity?.activeQuests ?? []).map((quest: any) => String(quest.questId));
  const storyFlags: string[] = params.entity?.storyFlags ?? [];

  for (const other of Object.values(params.entities)) {
    if (!other || other.id === params.entity?.id) continue;
    if (other.type === "merchant") merchantNearby = true;
    if (other.type === "trainer" || other.type === "profession-trainer") trainerNearby = true;
    if (isQuestNpc(other)) {
      const available = getAvailableQuestsForPlayer(String(other.name ?? ""), completedQuestIds, activeQuestIds, storyFlags);
      if (available.length > 0) {
        questNpcCount += 1;
        availableQuestCount += available.length;
      }
    }
  }

  const activeQuestCount = activeQuestIds.length;
  const progressableQuestCount = activeQuestCount > 0 && (safeMobCount > 0 || questNpcCount > 0)
    ? activeQuestCount
    : 0;

  const recyclableCopper = params.inventoryItems.reduce((sum, item) => {
    const qty = Math.max(0, Number(item.recyclableQuantity ?? 0));
    const value = Math.max(0, Number(item.recycleCopperValue ?? 0));
    return sum + qty * value;
  }, 0);

  const zoneRequirement = ZONE_LEVEL_REQUIREMENTS[params.currentRegion] ?? 1;
  const zoneTooHard = (livingMobs.length > 0 && safeMobCount === 0) || zoneRequirement > level + 1;
  const zoneTooEasy = level - zoneRequirement >= 6 && safeMobCount > 0;
  const suggestedTravelZone = zoneTooHard
    ? findBestZoneForLevelBand(level, params.allowedZones ?? "all", params.currentRegion)
    : findBestProgressionZone(level, params.allowedZones ?? "all", params.currentRegion);

  const eligibleDungeonGate = Object.entries(params.entities)
    .filter(([, other]: [string, any]) => other.type === "dungeon-gate" && !other.gateOpened && (!other.gateExpiresAt || other.gateExpiresAt > Date.now()))
    .find(([, other]: [string, any]) => level >= (RANK_LEVELS[String(other.gateRank ?? "")] ?? Number.POSITIVE_INFINITY));

  return {
    trigger: params.trigger,
    currentScript: params.currentScript,
    currentScriptProgressing: params.currentScriptProgressing,
    queueActive: params.queueActive,
    queuedActionCount: params.queuedActionCount,
    userFocus: params.userFocus,
    strategy: params.strategy,
    currentRegion: params.currentRegion,
    level,
    hpPct,
    weaponEquipped,
    emptyGearSlots,
    copper: params.copper,
    recyclableCopper,
    safeMobCount,
    livingMobCount: livingMobs.length,
    merchantNearby,
    trainerNearby,
    activeQuestCount,
    progressableQuestCount,
    availableQuestCount,
    questNpcCount,
    dungeonGateEligible: !!eligibleDungeonGate,
    dungeonGateId: eligibleDungeonGate?.[0],
    dungeonGateRank: eligibleDungeonGate?.[1]?.gateRank,
    zoneTooEasy,
    zoneTooHard,
    suggestedTravelZone,
    recentFailures: buildFailureMap(params.recentFailures),
  };
}

export function chooseNextScript(ctx: UtilityDecisionContext): UtilityDecision {
  const scores = STRATEGIC_SCRIPTS
    .map((type) => scoreCandidate(ctx, type))
    .sort((left, right) => right.score - left.score);
  const winner = scores[0] ?? scoreCandidate(ctx, "combat");
  const runnerUp = scores[1];
  const scoreGap = winner.score - (runnerUp?.score ?? 0);
  const shouldEscalateToSupervisor = winner.score < 0.45
    || scoreGap < 0.08
    || ctx.trigger.type === "blocked";

  return {
    context: ctx,
    winner,
    scores,
    shouldEscalateToSupervisor,
  };
}

export function formatUtilityDecision(decision: UtilityDecision, limit = 3): string {
  return decision.scores
    .slice(0, limit)
    .map((entry) => {
      const why = entry.reasons.slice(0, 2).join(", ");
      return `${entry.type}=${entry.score.toFixed(2)}${why ? ` (${why})` : ""}`;
    })
    .join(" | ");
}

export function formatUtilityQueueAbstain(queueCount: number, currentScript: BotScript | null): string {
  const current = currentScript?.type ?? "none";
  return `queue owns control (${queueCount} queued, current=${current})`;
}
