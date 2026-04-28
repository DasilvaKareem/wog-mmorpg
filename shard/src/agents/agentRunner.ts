/**
 * AgentRunner — per-user AI agent loop.
 * Reads config from Redis each tick and executes the configured focus behavior.
 *
 * Behaviors (combat, gathering, crafting, etc.) live in agentBehaviors.ts.
 * Trigger detection lives in agentTriggers.ts.
 * Survival logic (HP, repair, self-adaptation) lives in agentSurvival.ts.
 */

import { AsyncLocalStorage } from "async_hooks";
import {
  getAgentConfig,
  getAgentCustodialWallet,
  getAgentEntityRef,
  setAgentEntityRef,
  patchAgentConfig,
  getAgentRuntimeState,
  setAgentRuntimeState,
  appendChatMessage,
  getChatHistory,
  appendAgentError,
  askSummonerQuestion,
  getSummonerQuestion,
  clearSummonerQuestion,
  getActiveObjective,
  objectiveToFocus,
  completeObjective,
  updateObjectiveProgress,
  type AgentFocus,
  type AgentStrategy,
  type GatherPreference,
  type AgentObjective,
  type PendingQuestion,
  type AgentRuntimeState,
  type AgentErrorEntry,
  getActionQueue,
  setActionQueue,
  clearActionQueue,
} from "./agentConfigStore.js";
import { peekInbox, ackInboxMessages, sendInboxMessage } from "./agentInbox.js";
import { exportCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import { authenticateWithWallet, createAuthenticatedAPI } from "../auth/authHelper.js";
import { ZONE_LEVEL_REQUIREMENTS, QUEST_ZONES, FARM_ZONES, getZoneConnections, resolveRegionId } from "../world/worldLayout.js";
import { getEntity as getWorldEntity, getEntitiesInRegion, isWalletSpawned, unregisterSpawnedWallet } from "../world/zoneRuntime.js";
import { getPartyLeaderId, getPlayerPartyId } from "../social/partySystem.js";
import { getRecentZoneEvents, type ZoneEvent } from "../world/zoneEvents.js";
import { runSupervisor } from "./agentSupervisor.js";
import { TIER_CAPABILITIES, type TierCapabilities } from "./agentTiers.js";
import { AgentMcpClient } from "./mcpClient.js";
import { type BotScript, type TriggerEvent } from "../types/botScriptTypes.js";
import {
  buildProgressChain,
  buildLevelBandChain,
  buildProfessionLearnChain,
  findBestProgressionZone,
} from "./agentChains.js";

// Extracted modules
import {
  actionBlocked,
  actionCompleted,
  actionIdle,
  actionProgressed,
  sleep,
  fetchLiquidationInventory,
  fetchWalletBalance,
  formatAgentError,
  issueAgentCommand,
  getTrainerZone,
  getClassTrainerZone,
  type ActionResult,
  type ApiCaller,
  type AgentContext,
  type FailureCategory,
  type FailureMemoryEntry,
} from "./agentUtils.js";
import { detectTrigger, type TriggerState } from "./agentTriggers.js";
import { handleLowHp, needsRepair, checkSelfAdaptation } from "./agentSurvival.js";
import * as behaviors from "./agentBehaviors.js";
import { emitAgentChat, getAgentOrigin, maybeReactToChat, pickLine } from "./agentDialogue.js";
import { sendAgentPush } from "./agentPushService.js";
import {
  buildUtilityDecisionContext,
  chooseNextScript,
  formatUtilityDecision,
  formatUtilityQueueAbstain,
  type UtilityDecision,
} from "./agentUtility.js";

const TICK_MS = 1200;
/** Safety-net: call supervisor if no trigger has fired in about 30s. */
const MAX_STALE_TICKS = Math.ceil(30_000 / TICK_MS);
const MOVE_REISSUE_MS = 4_000;
const MOVE_PROGRESS_EPSILON = 4;
const PARTY_LEADER_FOLLOW_DISTANCE = 90;
const PARTY_LEADER_STOP_DISTANCE = 35;
const SUPERVISOR_EVENT_TYPES: ZoneEvent["type"][] = ["combat", "death", "kill", "levelup", "quest", "quest-progress", "loot", "technique"];

function getQuestProgressMilestone(event: ZoneEvent): string | null {
  if (event.type !== "quest-progress") return null;
  const progress = Number(event.data?.progress);
  const required = Number(event.data?.required);
  const title = String(event.data?.questTitle ?? event.message ?? "this quest");

  if (!Number.isFinite(progress) || !Number.isFinite(required) || required <= 0) {
    return null;
  }
  if (required === 1) return title;
  if (progress >= required) return title;
  if (progress === required - 1) return title;
  if (required >= 4 && progress === Math.ceil(required / 2)) return title;
  return null;
}

function getTechniqueDetail(event: ZoneEvent): string {
  return String(event.data?.techniqueName ?? event.message ?? "a new technique");
}

interface TimingMetric {
  count: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
}

interface AgentTelemetrySnapshot {
  loop: TimingMetric;
  walletBalance: TimingMetric;
  supervisor: TimingMetric & { errors: number };
  utility: {
    evaluated: number;
    driven: number;
    shadow: number;
    escalated: number;
    abstainedQueue: number;
    byTrigger: Record<string, number>;
    lastWinner: string | null;
  };
  actionResults: Record<string, number>;
  commands: {
    total: number;
    move: number;
    attack: number;
    travel: number;
    failed: number;
    lastAt: number | null;
  };
  failures: {
    total: number;
    repeated: number;
    recent: FailureMemoryEntry[];
    topEndpoints: Array<{ name: string; count: number }>;
    topTargets: Array<{ name: string; count: number }>;
    topReasons: Array<{ name: string; count: number }>;
  };
  party: Record<string, number>;
  triggers: Record<string, number>;
  lastLoopAt: number | null;
}

/** Convert config focus -> natural-language directive for supervisor context. */
function focusToDirective(focus: AgentFocus, targetZone?: string): string {
  switch (focus) {
    case "questing":   return "Accept and complete quests. Use combat to progress objectives.";
    case "combat":     return "Hunt mobs for XP and gold. Fight the strongest you can handle.";
    case "gathering":  return "Gather ore and herbs. Build up material stockpile.";
    case "crafting":   return "Craft items at the forge. Gather materials first if needed.";
    case "alchemy":    return "Brew potions and elixirs. Gather herbs if ingredients are low.";
    case "cooking":    return "Cook food from ingredients you already own. HP regenerates passively out of combat — only cook if you have ingredients on hand.";
    case "enchanting": return "Enchant your weapon. Brew elixirs first if you have none.";
    case "shopping":   return "Buy and equip the best gear you can afford.";
    case "traveling":  return targetZone ? `Travel to ${targetZone} as quickly as possible.` : "Explore and travel to new zones.";
    case "goto":       return "Walk to the target NPC the user pointed at.";
    case "learning":   return "Find a trainer NPC and learn new techniques/skills.";
    case "leatherworking": return "Craft leather armor at a tanning rack.";
    case "jewelcrafting": return "Craft jewelry — rings and amulets at a jeweler's bench.";
    case "farming":    return "Harvest crops at farmland zones. Equip a hoe and gather produce.";
    case "dungeon":    return "Enter dungeon gates and clear all mobs inside for XP and loot.";
    case "idle":       return "Rest. Only act if something urgent happens.";
    default:           return "Be autonomous — quest and improve your character.";
  }
}

/** Convert config focus -> initial BotScript when supervisor is unavailable. */
function focusToScript(
  focus: AgentFocus,
  strategy: AgentStrategy,
  targetZone?: string,
  gatherNodeType: GatherPreference = "both",
): BotScript {
  const levelOffset = strategy === "aggressive" ? 5 : strategy === "defensive" ? 0 : 2;
  switch (focus) {
    case "questing":   return { type: "quest",   reason: "User focus: questing" };
    case "combat":     return { type: "combat",  maxLevelOffset: levelOffset, reason: "User focus: combat" };
    case "gathering":  return { type: "gather",  nodeType: gatherNodeType, reason: "User focus: gathering" };
    case "crafting":   return { type: "craft",   reason: "User focus: crafting" };
    case "alchemy":    return { type: "brew",    reason: "User focus: alchemy" };
    case "cooking":    return { type: "cook",    reason: "User focus: cooking" };
    case "enchanting": return { type: "enchant", reason: "User focus: enchanting" };
    case "shopping":   return { type: "shop",    reason: "User focus: shopping" };
    case "trading":    return { type: "trade",   reason: "User focus: trading" };
    case "traveling":  return { type: "travel",  targetZone, reason: "User focus: traveling" };
    case "goto":       return { type: "goto",    reason: "User clicked an NPC" };
    case "learning":   return { type: "learn",   reason: "User focus: learn techniques" };
    case "leatherworking": return { type: "leatherwork", reason: "User focus: leatherworking" };
    case "jewelcrafting": return { type: "jewelcraft", reason: "User focus: jewelcrafting" };
    case "farming":    return { type: "farm",    reason: "User focus: farming" };
    case "dungeon":    return { type: "dungeon", reason: "User focus: dungeon" };
    case "idle":       return { type: "idle",    reason: "User focus: idle" };
    default:           return { type: "combat",  maxLevelOffset: levelOffset, reason: "Default" };
  }
}

export class AgentRunner {
  private userWallet: string;
  private readonly walletTag: string;
  public running = false;
  private api: ApiCaller | null = null;
  private custodialWallet: string | null = null;
  private entityId: string | null = null;
  private agentOrigin: string | null = null;
  private currentRegion: string = "village-square";
  private jwtExpiry = 0;
  private jwt: string | null = null;
  private firstTickResult: Promise<void> | null = null;
  private ticksSinceFocusChange = 0;
  private lastFocus: AgentFocus = "questing";
  private ticksInCurrentZone = 0;
  /** Last zone the agent was productively grinding in — updated by
   *  updateHomeZoneIfProductive(). Detour chains travel back here on completion. */
  private homeZone: string | null = null;
  /** Mirror of config.ignoreWeakMobs — refreshed each loop from Redis config. */
  private ignoreWeakMobsFlag = true;
  /** Quests flagged as stuck — key=questId, value=epoch ms when it unsticks (5 min TTL). */
  private stuckQuests = new Map<string, number>();
  /** Gather nodes blacklisted due to "skill too low" — key=nodeId, value=epoch ms when retry allowed (5 min TTL). */
  private gatherNodeBlacklist = new Map<string, number>();
  /** Recent death timestamps per zone — used to detect death loops (mob too strong,
   *  agent keeps respawning and walking back to die again). */
  private recentDeathsByZone = new Map<string, number[]>();
  /** When set, circuit-breaker / auto-progress enqueues are suppressed until
   *  this epoch ms — the user just gave an explicit directive and we don't want
   *  autonomous logic to wipe their queue. */
  private userQueueLockUntil = 0;
  /** Zone → epoch ms of the most recent circuit-breaker rescue attempt.
   *  If a rescue fires for the same zone twice within 30s, the rescue itself
   *  isn't working — escalate to the user instead of flailing again. */
  private lastRescueByZone = new Map<string, number>();

  /** Per-entity tick gate. Serializes the loop's tick body and any externally-
   *  invoked mutating methods (clearScript, enqueueActions, repairGear, etc.)
   *  so chat-driven directives can't race with an in-flight tick. */
  private tickGate: Promise<void> = Promise.resolve();
  /** Per-async-chain marker. When set, withGate detects re-entry from already-
   *  gated code (loop tick → behavior → ctx.method → runner.method) and runs
   *  inline instead of trying to acquire the gate again, which would deadlock. */
  private gateContext = new AsyncLocalStorage<true>();

  /**
   * Serialize `fn` against the loop tick and any other externally-invoked
   * mutating method. Re-entrant: if called from inside a gated context, runs
   * inline. Use this around the loop's tick body and around any public method
   * that mutates runner state.
   */
  private withGate<T>(fn: () => Promise<T>): Promise<T> {
    if (this.gateContext.getStore()) return fn();
    const previous = this.tickGate;
    let release!: () => void;
    this.tickGate = new Promise<void>((resolve) => { release = resolve; });
    return previous.then(() =>
      this.gateContext.run(true, async () => {
        try { return await fn(); } finally { release(); }
      }),
    );
  }

  /** Monotonic tick counter — used by commitTarget to measure commitment TTL in ticks. */
  private tickCounter = 0;
  /** Current target commitment. Cleared when the target dies, leaves the zone, or TTL expires. */
  private committedTarget: { targetId: string; expiresAtTick: number } | null = null;

  private getCommittedTargetId(): string | null {
    if (!this.committedTarget) return null;
    if (this.tickCounter >= this.committedTarget.expiresAtTick) {
      this.committedTarget = null;
      return null;
    }
    return this.committedTarget.targetId;
  }

  private commitTarget(targetId: string, ttlTicks = 8): void {
    const prev = this.committedTarget?.targetId;
    this.committedTarget = { targetId, expiresAtTick: this.tickCounter + ttlTicks };
    if (prev !== targetId) {
      console.log(`[agent:${this.walletTag}] Commit target ${targetId} for ${ttlTicks} ticks`);
    }
  }

  private clearCommittedTarget(): void {
    if (this.committedTarget) {
      console.log(`[agent:${this.walletTag}] Released target commitment (${this.committedTarget.targetId})`);
    }
    this.committedTarget = null;
  }

  private isQuestStuck(questId: string): boolean {
    const until = this.stuckQuests.get(questId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.stuckQuests.delete(questId);
      return false;
    }
    return true;
  }

  private markQuestStuck(questId: string, reason: string): void {
    const until = Date.now() + 5 * 60_000;
    const wasStuck = this.stuckQuests.has(questId);
    this.stuckQuests.set(questId, until);
    if (!wasStuck) {
      console.log(`[agent:${this.walletTag}] Quest ${questId} flagged stuck for 5 min: ${reason}`);
      void this.logActivity(`Quest "${questId}" is stuck — skipping for 5 min (${reason})`);
    }
  }

  private isGatherNodeBlacklisted(nodeId: string): boolean {
    const until = this.gatherNodeBlacklist.get(nodeId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.gatherNodeBlacklist.delete(nodeId);
      return false;
    }
    return true;
  }

  private markGatherNodeBlacklisted(nodeId: string): void {
    this.gatherNodeBlacklist.set(nodeId, Date.now() + 5 * 60_000);
  }
  private combatFallbackCount = 0;
  public currentActivity = "Idle";
  public recentActivities: string[] = [];
  private currentScript: BotScript | null = null;
  public get script(): BotScript | null { return this.currentScript; }
  public lastTrigger: TriggerEvent | null = null;
  public get zone(): string { return this.currentRegion; }
  public get region(): string { return this.currentRegion; }
  public get entity(): string | null { return this.entityId; }
  public get wallet(): string { return this.userWallet; }
  public get custodial(): string | null { return this.custodialWallet; }
  public get mcp(): AgentMcpClient | null { return this.mcpClient; }

  private ticksSinceLastDecision = 0;
  private cachedZoneState: { entities: Record<string, any>; me: any; recentEvents: ZoneEvent[] } | null = null;
  private ticksOnCurrentScript = 0;
  private lastKnownLevel = 0;
  private lastKnownZone = "";
  private nextIdleChatTick = 100 + Math.floor(Math.random() * 150);
  private lastInboxId = "0-0";
  private lastSeenZoneEventSeq = 0;
  private currentCaps: TierCapabilities = TIER_CAPABILITIES["free"];
  private nextTechniqueCheckAt = 0;
  private failedTechniqueIds = new Set<string>();
  private mcpClient: AgentMcpClient | null = null;
  private lastPrivateKey: string | null = null;
  private pendingTrigger: TriggerEvent | null = null;
  private lastActionResult: ActionResult | null = null;
  private moveToStaleCount = 0;
  private moveToLastTarget = "";
  private consecutiveIdles = 0;
  private moveToLastDistance = Number.POSITIVE_INFINITY;
  private moveToLastCommandAt = 0;
  private moveToLastLogAt = 0;
  private interactionCooldowns = new Map<string, number>();
  private pendingQuestionId: string | null = null;
  private failureMemory = new Map<string, FailureMemoryEntry>();
  private telemetry = {
    loop: { count: 0, avgMs: 0, maxMs: 0, lastMs: 0 },
    walletBalance: { count: 0, avgMs: 0, maxMs: 0, lastMs: 0 },
    supervisor: { count: 0, avgMs: 0, maxMs: 0, lastMs: 0, errors: 0 },
    utility: {
      evaluated: 0,
      driven: 0,
      shadow: 0,
      escalated: 0,
      abstainedQueue: 0,
      byTrigger: {} as Record<string, number>,
      lastWinner: null as string | null,
    },
    actionResults: { idle: 0, progressed: 0, blocked: 0, completed: 0 },
    commands: { total: 0, move: 0, attack: 0, technique: 0, travel: 0, failed: 0, lastAt: null as number | null },
    failures: {
      total: 0,
      repeated: 0,
      byEndpoint: {} as Record<string, number>,
      byTarget: {} as Record<string, number>,
      byReason: {} as Record<string, number>,
    },
    party: {} as Record<string, number>,
    triggers: {} as Record<string, number>,
    lastLoopAt: null as number | null,
  };

  constructor(userWallet: string) {
    this.userWallet = userWallet;
    this.walletTag = userWallet.slice(0, 8);
  }

  private async restoreRuntimeSnapshot(): Promise<void> {
    const runtime = await getAgentRuntimeState(this.userWallet);
    if (!runtime) return;

    this.currentScript = runtime.currentScript ?? null;
    this.currentActivity = runtime.currentActivity ?? "Idle";
    this.recentActivities = Array.isArray(runtime.recentActivities) ? runtime.recentActivities.slice(-20) : [];
    this.currentRegion = runtime.currentRegion ?? this.currentRegion;
    this.entityId = runtime.entityId ?? this.entityId;
    this.custodialWallet = runtime.custodialWallet ?? this.custodialWallet;
    this.pendingQuestionId = runtime.pendingQuestionId ?? null;
    this.lastTrigger = runtime.lastTrigger ?? null;
  }

  private async persistRuntimeSnapshot(): Promise<void> {
    const runtime: AgentRuntimeState = {
      currentScript: this.currentScript,
      currentActivity: this.currentActivity,
      recentActivities: this.recentActivities.slice(-20),
      currentRegion: this.currentRegion,
      entityId: this.entityId,
      custodialWallet: this.custodialWallet,
      pendingQuestionId: this.pendingQuestionId,
      lastTrigger: this.lastTrigger,
      updatedAt: Date.now(),
    };
    await setAgentRuntimeState(this.userWallet, runtime);
  }

  private persistRuntimeSnapshotEventually(context: string): void {
    void this.persistRuntimeSnapshot().catch((err) => {
      console.warn(`[agent:${this.walletTag}] Failed to persist runtime after ${context}: ${err.message?.slice(0, 80)}`);
    });
  }

  // ── Public API (called from chat routes / manager) ─────────────────────────

  public clearScript(): Promise<void> {
    return this.withGate(async () => {
      this.currentScript = null;
      // If queue has items (e.g. user-directive enqueue), pop one immediately so
      // the next tick can't race ahead and overwrite currentScript before the
      // queue gets a turn. Otherwise force re-evaluation on next tick.
      if (this.actionQueue.length > 0) {
        this.dequeueNext();
      } else {
        this.ticksSinceLastDecision = MAX_STALE_TICKS;
      }
    });
  }

  public setGotoTarget(
    entityId: string,
    zoneId: string,
    name?: string,
    action?: string,
    profession?: string,
    extras?: { techniqueId?: string; techniqueName?: string; questId?: string },
  ): Promise<void> {
    return this.withGate(async () => {
      const reason = action === "learn-profession" && profession
        ? `User: learn ${profession} from ${name ?? entityId}`
        : `User directed agent to ${name ?? entityId}`;
      this.currentScript = {
        type: "goto",
        targetEntityId: entityId,
        targetName: name,
        gotoZoneId: zoneId,
        gotoAction: action,
        gotoProfession: profession,
        gotoTechniqueId: extras?.techniqueId,
        gotoTechniqueName: extras?.techniqueName,
        gotoQuestId: extras?.questId,
        reason,
      };
      this.ticksSinceLastDecision = 0;
    });
  }

  public setGotoPosition(x: number, y: number, zoneId: string): Promise<void> {
    return this.withGate(async () => {
      this.currentScript = {
        type: "goto",
        gotoX: x,
        gotoY: y,
        gotoZoneId: zoneId,
        reason: `User: move to (${Math.round(x)}, ${Math.round(y)})`,
      };
      this.ticksSinceLastDecision = 0;
    });
  }

  // ── Action Queue ────────────────────────────────────────────────────────────

  private actionQueue: BotScript[] = [];

  /** Push one or more scripts to the back of the queue */
  public enqueueActions(scripts: BotScript[], clearExisting = false): Promise<void> {
    return this.withGate(async () => {
      if (clearExisting) this.actionQueue = [];
      this.actionQueue.push(...scripts);
      if (this.actionQueue.length > 10) this.actionQueue = this.actionQueue.slice(0, 10);
      await setActionQueue(this.userWallet, this.actionQueue);
      // Start executing immediately if idle
      if (!this.currentScript && this.actionQueue.length > 0) {
        this.dequeueNext();
      }
      console.log(`[agent:${this.walletTag}] Queue now has ${this.actionQueue.length} items`);
    });
  }

  /** Like enqueueActions but flags the queue as user-driven for 60s — circuit
   *  breaker and auto-progress will not wipe these scripts during that window. */
  public enqueueUserActions(scripts: BotScript[], clearExisting = true): Promise<void> {
    this.userQueueLockUntil = Date.now() + 60_000;
    return this.enqueueActions(scripts, clearExisting);
  }

  private isUserQueueLocked(): boolean {
    return Date.now() < this.userQueueLockUntil;
  }

  /** Clear all queued actions */
  public clearQueue(): Promise<void> {
    return this.withGate(async () => {
      this.actionQueue = [];
      await clearActionQueue(this.userWallet);
      console.log(`[agent:${this.walletTag}] Queue cleared`);
    });
  }

  /** View current queue */
  public getQueue(): BotScript[] {
    return [...this.actionQueue];
  }

  /** Whether the queue is driving behavior (suppresses autonomous triggers) */
  public get queueActive(): boolean {
    return this.actionQueue.length > 0;
  }

  /** Dequeue the next action and set it as current script */
  private dequeueNext(): void {
    if (this.actionQueue.length === 0) return;
    const next = this.actionQueue.shift()!;
    this.currentScript = next;
    this.ticksOnCurrentScript = 0;
    this.ticksSinceLastDecision = 0;
    void setActionQueue(this.userWallet, this.actionQueue);
    void this.logActivity(`[queue] ${next.type}: ${next.reason ?? "queued action"} (${this.actionQueue.length} remaining)`);
    console.log(`[agent:${this.walletTag}] Dequeued: ${next.type} (${this.actionQueue.length} left)`);
  }

  public getSnapshot() {
    return {
      wallet: this.userWallet,
      zone: this.currentRegion,
      entityId: this.entityId,
      custodialWallet: this.custodialWallet,
      currentActivity: this.currentActivity,
      recentActivities: [...this.recentActivities],
      script: this.currentScript
        ? { type: this.currentScript.type, reason: this.currentScript.reason ?? null }
        : null,
      lastTrigger: this.lastTrigger
        ? { type: this.lastTrigger.type, detail: this.lastTrigger.detail }
        : null,
      lastActionResult: this.lastActionResult ? { ...this.lastActionResult } : null,
      recentFailures: this.getRecentFailures(),
      running: this.running,
      telemetry: this.getTelemetrySnapshot(),
    };
  }

  // ── Public actions (called from chat tool handlers) ────────────────────────

  async learnProfession(professionId: string): Promise<boolean> {
    return this.withGate(() => this._learnProfessionInner(professionId));
  }
  private async _learnProfessionInner(professionId: string): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      const profRes = await this.api("GET", `/professions/${this.custodialWallet}`);
      const learned: string[] = profRes?.professions ?? [];
      if (learned.includes(professionId)) return true;

      const zs = await this.getZoneState();
      if (!zs) return false;

      const trainer = this.findNearestEntity(zs.entities, zs.me,
        (e) => e.type === "profession-trainer" && e.teachesProfession === professionId,
      );
      if (!trainer) {
        const targetHub = getTrainerZone(professionId);
        if (this.currentRegion !== targetHub) {
          // Don't yank high-level agents back to hubs for a profession
          // they might not actually need. Skip gracefully; caller falls back.
          const myLevel = zs.me.level ?? 1;
          if (myLevel >= 10) {
            console.log(`[agent:${this.walletTag}] No ${professionId} trainer here and Lv${myLevel} — skipping hub detour`);
            void this.logActivity(`Skipping ${professionId} — no trainer nearby, continuing grinding`);
            return false;
          }

          // Low-level agents: enqueue a round-trip so they come back to homeZone
          // instead of stranding in the hub.
          const config = await getAgentConfig(this.userWallet);
          const homeZone = config?.homeZone ?? this.currentRegion;
          const chain = buildProfessionLearnChain(professionId, homeZone);
          // Chain builder defaults to PROFESSION_HUB_ZONE, override it here
          if (chain[0].type === "travel") {
            chain[0].targetZone = targetHub;
            chain[0].reason = `Detour: learn ${professionId} in ${targetHub}`;
          }

          await this.enqueueActions(chain, true);
          void this.logActivity(`Detour: learn ${professionId} in ${targetHub} → return to ${homeZone}`);
          console.log(`[agent:${this.walletTag}] Enqueued profession-learn chain for ${professionId}, hub=${targetHub}, home=${homeZone}`);
          return false;
        }
        console.log(`[agent:${this.walletTag}] No ${professionId} trainer in ${this.currentRegion}`);
        return false;
      }

      const moving = await this.moveToEntity(zs.me, trainer[1]);
      if (moving) return false;

      await this.api("POST", "/professions/learn", {
        walletAddress: this.custodialWallet, zoneId: this.currentRegion,
        entityId: this.entityId, trainerId: trainer[0], professionId,
      });
      console.log(`[agent:${this.walletTag}] Learned ${professionId}`);
      void this.logActivity(`Learned profession: ${professionId}`);
      return true;
    } catch (err: any) {
      console.debug(`[agent] learnProfession(${professionId}): ${err.message?.slice(0, 60)}`);
      this.logError("action", `learnProfession(${professionId}): ${err.message?.slice(0, 120) ?? "unknown"}`, { endpoint: "/professions/learn" });
      return false;
    }
  }

  async learnNextTechnique(): Promise<{ ok: boolean; reason: string }> {
    if (!this.api || !this.entityId || !this.custodialWallet) {
      return { ok: false, reason: "agent not fully initialized" };
    }
    if (Date.now() < this.nextTechniqueCheckAt) {
      return { ok: false, reason: "technique learning on cooldown" };
    }

    try {
      const zs = await this.getZoneState();
      if (!zs) return { ok: false, reason: "could not read zone state" };
      const { entities, me } = zs;
      const classId = (me.classId ?? "").toLowerCase();
      if (!classId) return { ok: false, reason: "my character has no class set" };

      const availableRes = await this.api("GET", `/techniques/available/${this.entityId}`);
      const available: Array<{ id: string; name?: string; isLearned?: boolean; copperCost?: number }> = availableRes?.techniques ?? [];

      const nextToLearn = available.find((t) => !t.isLearned && !this.failedTechniqueIds.has(t.id));
      if (!nextToLearn) {
        const allLearned = available.length > 0 && available.every((t) => t.isLearned);
        if (allLearned) return { ok: false, reason: "I've already learned all techniques available at my level" };
        if (available.length === 0) return { ok: false, reason: `no ${classId} techniques exist for my level (L${me.level ?? 1})` };
        return { ok: false, reason: "all remaining techniques have been blacklisted due to previous failures" };
      }

      const cost = nextToLearn.copperCost ?? 0;
      if (cost > 0) {
        const { copper: copperBalance } = await this.getWalletBalance();
        if (copperBalance < cost) {
          this.nextTechniqueCheckAt = Date.now() + 120_000;
          return { ok: false, reason: `I need ${cost} copper to learn ${nextToLearn.name ?? nextToLearn.id} but only have ${copperBalance} copper` };
        }
      }

      const trainer = this.findNearestEntity(entities, me, (e) => {
        if (e.type !== "trainer") return false;
        const teachesClass = (e.teachesClass ?? "").toLowerCase();
        if (teachesClass) return teachesClass === classId;
        return new RegExp(`${classId}\\s+trainer`, "i").test(String(e.name ?? ""));
      });
      if (!trainer) {
        return { ok: false, reason: `no ${classId} trainer found in ${this.currentRegion}` };
      }

      const moving = await this.moveToEntity(me, trainer[1]);
      if (moving) return { ok: true, reason: `heading to ${trainer[1].name ?? "trainer"} to learn ${nextToLearn.name ?? nextToLearn.id}` };

      try {
        await this.api("POST", "/techniques/learn", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentRegion, playerEntityId: this.entityId,
          techniqueId: nextToLearn.id, trainerEntityId: trainer[0],
        });
        console.log(`[agent:${this.walletTag}] Learned technique ${nextToLearn.id}`);
        void this.logActivity(`Learned technique: ${nextToLearn.name ?? nextToLearn.id}`);
        this.nextTechniqueCheckAt = Date.now() + 30_000;
        return { ok: true, reason: `learned ${nextToLearn.name ?? nextToLearn.id}!` };
      } catch (learnErr: any) {
        const msg = String(learnErr.message ?? "").toLowerCase();
        const isDefinitive = msg.includes("wrong class") || msg.includes("already learned")
          || msg.includes("cannot teach") || msg.includes("not a player");
        if (isDefinitive) {
          this.failedTechniqueIds.add(nextToLearn.id);
          this.nextTechniqueCheckAt = Date.now() + 300_000;
        } else {
          this.nextTechniqueCheckAt = Date.now() + 30_000;
        }
        this.logError("action", `learnTechnique(${nextToLearn.id}): ${learnErr.message?.slice(0, 120) ?? "unknown"}`, { endpoint: "/techniques/learn", techniqueId: nextToLearn.id });
        return { ok: false, reason: `failed to learn ${nextToLearn.name ?? nextToLearn.id}: ${learnErr.message?.slice(0, 80) ?? "unknown error"}` };
      }
    } catch (err: any) {
      console.debug(`[agent] learnNextTechnique: ${err.message?.slice(0, 60)}`);
      this.logError("action", `learnNextTechnique: ${err.message?.slice(0, 120) ?? "unknown"}`);
      this.nextTechniqueCheckAt = Date.now() + 30_000;
      return { ok: false, reason: `error: ${err.message?.slice(0, 80) ?? "unknown"}` };
    }
  }

  async buyItem(tokenId: number): Promise<boolean> {
    return this.withGate(() => this._buyItemInner(tokenId));
  }
  private async _buyItemInner(tokenId: number): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      await this.api("POST", "/shop/buy", { buyerAddress: this.custodialWallet, tokenId, quantity: 1 });
      console.log(`[agent:${this.walletTag}] Bought tokenId=${tokenId}`);
      void this.logActivity(`Bought item (token #${tokenId})`);
      return true;
    } catch (err: any) {
      console.debug(`[agent] buyItem(${tokenId}): ${err.message?.slice(0, 60)}`);
      this.logError("action", `buyItem(${tokenId}): ${err.message?.slice(0, 120) ?? "unknown"}`, { endpoint: "/shop/buy" });
      return false;
    }
  }

  async equipItem(tokenId: number, instanceId?: string): Promise<boolean> {
    const result = await this.equipItemWithReason(tokenId, instanceId);
    return result.ok;
  }

  /**
   * Attempts to equip an item, retrying briefly if the balance check fails
   * (chain tx from a just-completed shop purchase may still be propagating).
   * Returns both success and the final error reason for smarter caller logic.
   */
  async equipItemWithReason(tokenId: number, instanceId?: string): Promise<{ ok: boolean; reason?: string }> {
    return this.withGate(() => this._equipItemWithReasonInner(tokenId, instanceId));
  }
  private async _equipItemWithReasonInner(tokenId: number, instanceId?: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.api || !this.entityId || !this.custodialWallet) return { ok: false, reason: "agent context not ready" };

    const maxAttempts = 3;
    let lastReason = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.api("POST", "/equipment/equip", {
          zoneId: this.currentRegion, tokenId,
          entityId: this.entityId, walletAddress: this.custodialWallet,
          ...(instanceId ? { instanceId } : {}),
        });
        console.log(`[agent:${this.walletTag}] Equipped tokenId=${tokenId}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
        void this.logActivity(`Equipped item (token #${tokenId})`);
        return { ok: true };
      } catch (err: any) {
        lastReason = String(err?.message ?? "unknown").slice(0, 200);
        // Only retry the ownership race (buy→equip blockchain lag). Other errors
        // are structural and won't fix themselves.
        const isOwnershipRace = /does not own this item/i.test(lastReason);
        if (!isOwnershipRace || attempt === maxAttempts) {
          console.debug(`[agent] equipItem(${tokenId}) failed: ${lastReason.slice(0, 60)}`);
          this.logError("action", `equipItem(${tokenId}): ${lastReason.slice(0, 120)}`, { endpoint: "/equipment/equip" });
          return { ok: false, reason: lastReason };
        }
        // Wait for the chain tx to propagate before retrying
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    return { ok: false, reason: lastReason };
  }

  async repairGear(): Promise<boolean> {
    return this.withGate(() => this._repairGearInner());
  }
  private async _repairGearInner(): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    const cooldownKey = `repair:${this.currentRegion}`;
    let smithId: string | undefined;
    let smithEntity: any;
    if (this.isInteractionOnCooldown(cooldownKey)) {
      this.lastActionResult = actionBlocked("Repair on cooldown", {
        failureKey: cooldownKey,
        endpoint: "/equipment/repair",
        category: "transient",
      });
      return false;
    }
    try {
      const zs = await this.getZoneState();
      if (!zs) return false;

      // Pre-check wallet gold before calling /equipment/repair so an
      // out-of-gold agent doesn't hit the API once per tick. The catch-block
      // 60s cooldown only kicks in AFTER an API throw — but moveToEntity above
      // can return early ("moving=true") before we ever reach the API call,
      // skipping the throw entirely and never setting the cooldown.
      const { copper } = await this.getWalletBalance();
      if (copper < 1) {
        this.setInteractionCooldown(cooldownKey, 60_000);
        this.lastActionResult = actionBlocked("Insufficient gold", {
          failureKey: cooldownKey,
          endpoint: "/equipment/repair",
          category: "strategic",
        });
        return false;
      }
      const { entities, me } = zs;

      const hasDamaged = Object.values(me.equipment ?? {}).some(
        (eq: any) => eq && eq.maxDurability > 0 && eq.durability < eq.maxDurability,
      );
      if (!hasDamaged) return false;

      const smith = this.findNearestEntity(entities, me,
        (e) => e.type === "merchant" && /blacksmith/i.test(e.name),
      );
      if (!smith) return false;

      [smithId, smithEntity] = smith;
      const moving = await this.moveToEntity(me, smithEntity);
      if (moving) return true;

      const result = await this.api("POST", "/equipment/repair", {
        zoneId: this.currentRegion, npcId: smithId,
        entityId: this.entityId, walletAddress: this.custodialWallet,
      });
      if (result?.ok) {
        this.clearInteractionCooldown(cooldownKey);
        this.clearFailure(cooldownKey);
        const repaired = result.repairs?.map((r: any) => r.name).join(", ") ?? "gear";
        this.lastActionResult = actionCompleted(`Repaired ${repaired}`);
        console.log(`[agent:${this.walletTag}] Repaired ${repaired} (cost: ${result.totalCost}g)`);
        void this.logActivity(`Repaired ${repaired} (${result.totalCost}g)`);
        if (this.entityId) {
          const ent = getWorldEntity(this.entityId);
          if (ent) {
            emitAgentChat({
              entityId: this.entityId, entityName: ent.name,
              zoneId: this.currentRegion, event: "npc_repair",
              origin: this.agentOrigin ?? undefined, classId: ent.classId,
              detail: repaired,
            });
          }
        }
      }
      return true;
    } catch (err: any) {
      const reason = formatAgentError(err);
      const backoffMs = /insufficient gold|no damaged equipped items|must reference a blacksmith/i.test(reason)
        ? 60_000
        : 20_000;
      this.setInteractionCooldown(cooldownKey, backoffMs);
      const failure = this.recordFailure({
        key: cooldownKey,
        reason,
        scriptType: "repair",
        endpoint: "/equipment/repair",
        targetId: smithId,
        targetName: smithEntity?.name,
      });
      this.lastActionResult = actionBlocked(reason, {
        failureKey: cooldownKey,
        endpoint: "/equipment/repair",
        targetId: smithId,
        targetName: smithEntity?.name,
        category: failure.category,
      });
      this.maybeScheduleBlockedTrigger(failure);
      // "Insufficient gold" repeats every cooldown expiry (60s) and would spam
      // stderr — demote to debug. Other reasons (real errors) still warn.
      const isExpected = /insufficient gold|no damaged equipped items|must reference a blacksmith/i.test(reason);
      if (isExpected) {
        console.debug(`[agent:${this.walletTag}] repairGear blocked: ${reason}`);
      } else {
        console.warn(`[agent:${this.walletTag}] repairGear failed: ${reason}`);
      }
      this.logError("action", `repairGear: ${reason}`, { endpoint: "/equipment/repair", targetId: smithId ?? "" });
      void this.logActivity(`Repair delayed: ${reason}`);
      return false;
    }
  }

  async recycleItem(
    tokenId: number,
    quantity = 1,
  ): Promise<{ ok: boolean; error?: string; itemName?: string; totalPayoutCopper?: number }> {
    return this.withGate(() => this._recycleItemInner(tokenId, quantity));
  }
  private async _recycleItemInner(
    tokenId: number,
    quantity = 1,
  ): Promise<{ ok: boolean; error?: string; itemName?: string; totalPayoutCopper?: number }> {
    if (!this.api || !this.custodialWallet || quantity < 1) {
      return { ok: false, error: "agent not fully initialized" };
    }
    try {
      const result = await this.api("POST", "/shop/recycle", {
        sellerAddress: this.custodialWallet,
        tokenId,
        quantity,
      });
      if (!result?.ok) {
        return { ok: false, error: result?.error ?? "recycle failed" };
      }
      console.log(`[agent:${this.walletTag}] Recycled tokenId=${tokenId} x${quantity}`);
      void this.logActivity(`Recycled ${quantity}x ${result.item ?? `token #${tokenId}`} for ${result.totalPayoutCopper ?? 0}c`);
      return {
        ok: true,
        itemName: result.item,
        totalPayoutCopper: result.totalPayoutCopper,
      };
    } catch (err: any) {
      this.logError("action", `recycleItem(${tokenId}): ${err.message?.slice(0, 120) ?? "unknown"}`, { endpoint: "/shop/recycle" });
      return { ok: false, error: err.message?.slice(0, 120) ?? "recycle failed" };
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async logActivity(text: string): Promise<void> {
    this.currentActivity = text;
    this.recentActivities = [...this.recentActivities, text].slice(-8);
    try {
      await appendChatMessage(this.userWallet, { role: "activity", text, ts: Date.now() });
    } catch (err: any) {
      console.debug(`[agent:${this.walletTag}] logActivity: ${err.message?.slice(0, 60)}`);
    }
  }

  private logError(
    category: AgentErrorEntry["category"],
    message: string,
    context?: Record<string, string>,
  ): void {
    const entry: AgentErrorEntry = {
      ts: Date.now(),
      category,
      message,
      scriptType: this.currentScript?.type,
      zoneId: this.currentRegion,
      context,
    };
    appendAgentError(this.userWallet, entry).catch(() => {});
  }

  private async processInbox(): Promise<void> {
    try {
      const messages = await peekInbox(this.userWallet, 5);
      const newMessages = messages.filter((m) => m.id > this.lastInboxId);
      if (newMessages.length === 0) return;

      const idsToAck: string[] = [];
      for (const msg of newMessages) {
        const label = msg.type === "broadcast" ? "BROADCAST" : "MSG";
        void this.logActivity(`[${label}] ${msg.fromName}: ${msg.body.slice(0, 120)}`);
        idsToAck.push(msg.id);
        if (msg.id > this.lastInboxId) this.lastInboxId = msg.id;
      }
      if (idsToAck.length > 0) await ackInboxMessages(this.userWallet, idsToAck);
    } catch (err: any) {
      console.debug(`[agent:${this.walletTag}] Inbox check failed: ${err.message?.slice(0, 60)}`);
    }
  }

  /**
   * Champion asks the summoner a yes/no (or multi-choice) question.
   * Posts the question to the chat log and sends a push notification.
   * Returns the PendingQuestion or null if there's already one pending.
   */
  public async askSummoner(
    text: string,
    choices: string[] = ["Yes", "No"],
    context?: Record<string, unknown>,
  ): Promise<PendingQuestion | null> {
    try {
      // Don't stack questions — only one pending at a time
      const existing = await getSummonerQuestion(this.userWallet);
      if (existing && !existing.reply) return null;

      const question = await askSummonerQuestion(this.userWallet, text, choices, context);
      this.pendingQuestionId = question.questionId;

      // Post to chat as a "question" message so the UI renders buttons
      await appendChatMessage(this.userWallet, {
        role: "question",
        text,
        ts: Date.now(),
        questionId: question.questionId,
        choices,
      });

      // Push notification to the summoner
      const entityName = this.entityId
        ? (getWorldEntity(this.entityId)?.name ?? "Your champion")
        : "Your champion";
      void sendAgentPush(this.userWallet, {
        type: "champion_question",
        agentName: entityName,
        detail: text,
      });

      void this.logActivity(`[QUESTION] ${text} (${choices.join("/")})`);
      return question;
    } catch (err: any) {
      console.debug(`[agent:${this.walletTag}] askSummoner failed: ${err.message?.slice(0, 60)}`);
      this.logError("chat", `askSummoner failed: ${err.message?.slice(0, 120) ?? "unknown"}`);
      return null;
    }
  }

  /**
   * Check if the summoner has replied to a pending question.
   * Returns the reply string if answered, "expired" if timed out, or null if still waiting.
   */
  private async checkQuestionReply(): Promise<{ reply: string; context?: Record<string, unknown> } | "expired" | null> {
    if (!this.pendingQuestionId) return null;
    try {
      const q = await getSummonerQuestion(this.userWallet);
      if (!q || q.questionId !== this.pendingQuestionId) {
        // Question expired or was cleared
        this.pendingQuestionId = null;
        return "expired";
      }
      if (q.reply) {
        // Summoner answered
        this.pendingQuestionId = null;
        await clearSummonerQuestion(this.userWallet);
        void this.logActivity(`[REPLY] Summoner said: ${q.reply}`);
        return { reply: q.reply, context: q.context };
      }
      // Still waiting
      return null;
    } catch {
      this.pendingQuestionId = null;
      return "expired";
    }
  }

  private updateTimingMetric(metric: TimingMetric, durationMs: number): void {
    metric.count += 1;
    metric.lastMs = durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
    metric.avgMs += (durationMs - metric.avgMs) / metric.count;
  }

  private getRecentFailures(limit = 6): FailureMemoryEntry[] {
    return [...this.failureMemory.values()]
      .filter((entry) => entry.consecutive > 0)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }

  private topCountEntries(source: Record<string, number>, limit = 5): Array<{ name: string; count: number }> {
    return Object.entries(source)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  private getTelemetrySnapshot(): AgentTelemetrySnapshot {
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      loop: {
        count: this.telemetry.loop.count,
        avgMs: round(this.telemetry.loop.avgMs),
        maxMs: round(this.telemetry.loop.maxMs),
        lastMs: round(this.telemetry.loop.lastMs),
      },
      walletBalance: {
        count: this.telemetry.walletBalance.count,
        avgMs: round(this.telemetry.walletBalance.avgMs),
        maxMs: round(this.telemetry.walletBalance.maxMs),
        lastMs: round(this.telemetry.walletBalance.lastMs),
      },
      supervisor: {
        count: this.telemetry.supervisor.count,
        avgMs: round(this.telemetry.supervisor.avgMs),
        maxMs: round(this.telemetry.supervisor.maxMs),
        lastMs: round(this.telemetry.supervisor.lastMs),
        errors: this.telemetry.supervisor.errors,
      },
      utility: {
        evaluated: this.telemetry.utility.evaluated,
        driven: this.telemetry.utility.driven,
        shadow: this.telemetry.utility.shadow,
        escalated: this.telemetry.utility.escalated,
        abstainedQueue: this.telemetry.utility.abstainedQueue,
        byTrigger: { ...this.telemetry.utility.byTrigger },
        lastWinner: this.telemetry.utility.lastWinner,
      },
      actionResults: { ...this.telemetry.actionResults },
      commands: { ...this.telemetry.commands },
      failures: {
        total: this.telemetry.failures.total,
        repeated: this.telemetry.failures.repeated,
        recent: this.getRecentFailures(),
        topEndpoints: this.topCountEntries(this.telemetry.failures.byEndpoint),
        topTargets: this.topCountEntries(this.telemetry.failures.byTarget),
        topReasons: this.topCountEntries(this.telemetry.failures.byReason),
      },
      party: { ...this.telemetry.party },
      triggers: { ...this.telemetry.triggers },
      lastLoopAt: this.telemetry.lastLoopAt,
    };
  }

  private recordPartyCoordination(kind: string): void {
    this.telemetry.party[kind] = (this.telemetry.party[kind] ?? 0) + 1;
  }

  private recordUtilityDecision(
    triggerType: string,
    decision: UtilityDecision,
    driven: boolean,
  ): void {
    this.telemetry.utility.evaluated += 1;
    this.telemetry.utility.byTrigger[triggerType] = (this.telemetry.utility.byTrigger[triggerType] ?? 0) + 1;
    this.telemetry.utility.lastWinner = decision.winner.type;
    if (driven) {
      this.telemetry.utility.driven += 1;
    } else {
      this.telemetry.utility.shadow += 1;
    }
    if (decision.shouldEscalateToSupervisor) {
      this.telemetry.utility.escalated += 1;
    }
  }

  private recordUtilityQueueAbstain(triggerType: string): void {
    this.telemetry.utility.abstainedQueue += 1;
    this.telemetry.utility.byTrigger[triggerType] = (this.telemetry.utility.byTrigger[triggerType] ?? 0) + 1;
  }

  private async getZoneState(): Promise<{ entities: Record<string, any>; me: any; recentEvents: ZoneEvent[] } | null> {
    if (this.cachedZoneState) return this.cachedZoneState;
    if (!this.entityId) return null;
    const entities = Object.fromEntries(
      getEntitiesInRegion(this.currentRegion).map((entity) => [entity.id, entity]),
    );
    const me = entities[this.entityId];
    if (!me) return null;
    this.cachedZoneState = {
      entities,
      me,
      recentEvents: getRecentZoneEvents(
        this.currentRegion,
        Date.now() - 5_000,
        SUPERVISOR_EVENT_TYPES,
      ),
    };
    return this.cachedZoneState;
  }

  private findNearestEntity(entities: Record<string, any>, me: any, typePredicate: (e: any) => boolean): [string, any] | null {
    const matches = Object.entries(entities)
      .filter(([id, e]) => id !== this.entityId && typePredicate(e))
      .sort(([, a], [, b]) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    return matches[0] as [string, any] ?? null;
  }

  private setEntityGotoMode(on: boolean): void {
    if (!this.entityId) return;
    const entity = getWorldEntity(this.entityId);
    if (entity) entity.gotoMode = on;
  }

  private isInteractionOnCooldown(key: string): boolean {
    const until = this.interactionCooldowns.get(key);
    if (!until) return false;
    if (until <= Date.now()) {
      this.interactionCooldowns.delete(key);
      return false;
    }
    return true;
  }

  private setInteractionCooldown(key: string, ms: number): void {
    if (ms <= 0) {
      this.interactionCooldowns.delete(key);
      return;
    }
    this.interactionCooldowns.set(key, Date.now() + ms);
  }

  private clearInteractionCooldown(key: string): void {
    this.interactionCooldowns.delete(key);
  }

  private clearFailure(key: string | undefined): void {
    if (!key) return;
    const existing = this.failureMemory.get(key);
    if (!existing) return;
    this.failureMemory.set(key, {
      ...existing,
      consecutive: 0,
      lastAt: Date.now(),
    });
  }

  private recordFailure(args: {
    key: string;
    reason: string;
    scriptType?: string;
    endpoint?: string;
    targetId?: string;
    targetName?: string;
    category?: FailureCategory;
  }): FailureMemoryEntry {
    const now = Date.now();
    const existing = this.failureMemory.get(args.key);
    const next: FailureMemoryEntry = {
      key: args.key,
      reason: args.reason,
      count: (existing?.count ?? 0) + 1,
      consecutive: (existing?.consecutive ?? 0) + 1,
      firstAt: existing?.firstAt ?? now,
      lastAt: now,
      scriptType: args.scriptType ?? existing?.scriptType,
      endpoint: args.endpoint ?? existing?.endpoint,
      targetId: args.targetId ?? existing?.targetId,
      targetName: args.targetName ?? existing?.targetName,
      category: args.category ?? existing?.category,
    };
    this.failureMemory.set(args.key, next);
    this.telemetry.failures.total += 1;
    if (next.consecutive > 1) this.telemetry.failures.repeated += 1;
    if (next.endpoint) {
      this.telemetry.failures.byEndpoint[next.endpoint] = (this.telemetry.failures.byEndpoint[next.endpoint] ?? 0) + 1;
    }
    const target = next.targetName ?? next.targetId;
    if (target) {
      this.telemetry.failures.byTarget[target] = (this.telemetry.failures.byTarget[target] ?? 0) + 1;
    }
    this.telemetry.failures.byReason[next.reason] = (this.telemetry.failures.byReason[next.reason] ?? 0) + 1;
    return next;
  }

  /**
   * Circuit breaker: pick an alternative focus when the current script is stuck.
   * Cycles through fallback activities, skipping the one the agent is already doing.
   */
  private pickCircuitBreakerFocus(stuckScriptType: string): AgentFocus | null {
    // Map script types to their parent focus so we can skip the current one
    const scriptToFocus: Record<string, AgentFocus> = {
      quest: "questing", combat: "combat", gather: "gathering",
      craft: "crafting", brew: "alchemy", cook: "cooking",
      enchant: "enchanting", shop: "shopping", farm: "farming",
      leatherwork: "leatherworking", jewelcraft: "jewelcrafting",
      learn: "learning",
    };
    const currentFocus = scriptToFocus[stuckScriptType] ?? this.lastFocus;

    // Ordered fallback rotation — diverse enough to unstick most situations
    const fallbacks: AgentFocus[] = [
      "gathering", "crafting", "farming", "questing", "cooking",
      "alchemy", "shopping", "combat",
    ];
    return fallbacks.find((f) => f !== currentFocus) ?? null;
  }

  /**
   * When the circuit breaker fires, try the smartest unstick path first:
   * travel to a different zone whose level/content matches the agent. Only fall
   * back to focus rotation (gather→craft→cook) if no better zone is available.
   *
   * Returns true if a rescue plan was enqueued / applied.
   */
  private async tryZoneRescueOrFocusRotation(
    currentType: string,
    failure: FailureMemoryEntry,
  ): Promise<boolean> {
    // User just gave a directive (queue is locked) — do NOT clobber it with a
    // rescue chain. The user's queued travel/quest takes priority.
    if (this.isUserQueueLocked()) {
      console.log(`[agent:${this.walletTag}] Circuit breaker suppressed — user directive active`);
      return false;
    }

    // One-shot escalation: if we already attempted a rescue for this zone in
    // the last 30s and we're stuck again, the rescue isn't working. Stop
    // flailing — go idle and ping the user to choose a direction.
    const zone = this.currentRegion;
    const lastRescue = this.lastRescueByZone.get(zone);
    if (lastRescue && Date.now() - lastRescue < 30_000) {
      const entity = this.entityId ? getWorldEntity(this.entityId) : null;
      const level = entity?.level ?? 1;
      const msg = `Stuck in ${zone} — Lv${level} agent, ${currentType} keeps blocking on "${failure.reason}". Tell me where to go next.`;
      console.warn(`[agent:${this.walletTag}] Rescue escalation: ${msg}`);
      void this.logActivity(`[STUCK] ${msg}`);
      void sendAgentPush(this.userWallet, {
        type: "agent_stuck",
        agentName: entity?.name ?? "Agent",
        detail: `Stuck in ${zone}: ${failure.reason}`,
      });
      void patchAgentConfig(this.userWallet, { focus: "idle", targetZone: undefined });
      this.currentScript = { type: "idle", reason: `Escalation: stuck in ${zone}` };
      this.ticksOnCurrentScript = 0;
      this.lastRescueByZone.delete(zone);
      return true;
    }

    const entity = this.entityId ? getWorldEntity(this.entityId) : null;
    const level = entity?.level ?? 1;
    const allowed = this.currentCaps.allowedZones;

    // Path 1: Zone mismatch — build a level-band chain to a better zone.
    const isZoneIssue =
      failure.key.startsWith("quest-combat:no-targets")
      || failure.key.startsWith("quest-combat:no-safe-targets")
      || failure.key.startsWith("combat:no-targets")
      || failure.key.startsWith("combat:no-safe-targets")
      || failure.key.startsWith("combat:level-mismatch");

    if (isZoneIssue) {
      const chain = buildLevelBandChain(level, this.currentRegion, allowed);
      if (chain) {
        const rescueZone = chain[0].targetZone ?? "unknown";
        console.log(`[agent:${this.walletTag}] Circuit breaker: ${currentType} stuck ${failure.consecutive}x → zone rescue ${rescueZone}`);
        void this.logActivity(`[ZONE RESCUE] ${this.currentRegion} has no targets for Lv${level} — heading to ${rescueZone}`);
        this.logError("action", `Zone rescue: ${currentType} → ${rescueZone} after ${failure.consecutive} blocks`, {
          fromScript: currentType,
          toZone: rescueZone,
          reason: failure.reason,
        });
        this.lastRescueByZone.set(zone, Date.now());
        await this.enqueueActions(chain, true);
        return true;
      }
    }

    // Path 2: Focus rotation — try a different activity in the same zone.
    const fallback = this.pickCircuitBreakerFocus(currentType);
    if (fallback) {
      console.log(`[agent:${this.walletTag}] Circuit breaker: ${currentType} blocked ${failure.consecutive}x → switching to ${fallback}`);
      void this.logActivity(`[CIRCUIT BREAKER] ${currentType} stuck ${failure.consecutive}x — switching to ${fallback}`);
      this.logError("action", `Circuit breaker fired: ${currentType} → ${fallback} after ${failure.consecutive} blocks`, {
        fromScript: currentType,
        toFocus: fallback,
        reason: failure.reason,
      });
      this.lastRescueByZone.set(zone, Date.now());
      void patchAgentConfig(this.userWallet, { focus: fallback });
      return true;
    }

    return false;
  }

  private maybeScheduleBlockedTrigger(failure: FailureMemoryEntry): void {
    const threshold = failure.category === "strategic" ? 2 : 3;
    if (failure.consecutive < threshold) return;
    this.pendingTrigger = {
      type: "blocked",
      detail: `${failure.scriptType ?? "action"} blocked at ${failure.targetName ?? failure.targetId ?? failure.endpoint ?? failure.key}: ${failure.reason} (x${failure.consecutive})`,
    };
  }

  private async handleActionResult(script: BotScript | null, result: ActionResult): Promise<void> {
    this.lastActionResult = result;
    this.telemetry.actionResults[result.status] = (this.telemetry.actionResults[result.status] ?? 0) + 1;

    if (result.status === "blocked") {
      const failure = this.recordFailure({
        key: result.failureKey ?? `${script?.type ?? "action"}:${result.endpoint ?? result.targetId ?? result.reason ?? "unknown"}`,
        reason: result.reason ?? "unknown failure",
        scriptType: script?.type,
        endpoint: result.endpoint,
        targetId: result.targetId,
        targetName: result.targetName,
        category: result.category,
      });
      this.maybeScheduleBlockedTrigger(failure);

      // Log every blocked action to the error log for debugging
      this.logError("action", `${script?.type ?? "action"} blocked: ${result.reason ?? "unknown"}`, {
        ...(result.endpoint ? { endpoint: result.endpoint } : {}),
        ...(result.targetId ? { targetId: result.targetId } : {}),
        ...(result.targetName ? { targetName: result.targetName } : {}),
        consecutive: String(failure.consecutive),
      });

      // Surface repeated failures to the user so they know what's going wrong
      if (failure.consecutive === 3) {
        const what = script?.type ?? "action";
        const why = result.reason ?? "unknown error";
        void this.logActivity(`[BLOCKED] ${what} failed 3x: ${why}`);
      } else if (failure.consecutive === 10) {
        const what = script?.type ?? "action";
        const why = result.reason ?? "unknown error";
        void this.logActivity(`[STUCK] ${what} blocked 10x in a row: ${why} — may need a different approach`);
      }

      // ── Circuit breaker: escape loops ──
      // Strategic failures (no_targets, no_safe_targets, underleveled etc.) fire
      // FAST — 5 consecutive blocks means the zone/script combination is broken
      // and retrying won't help. Transient failures (API errors, timing) get the
      // higher threshold since they often self-heal.
      const isStrategic = failure.category === "strategic";
      const breakerThreshold = isStrategic ? 5 : 15;
      if (failure.consecutive >= breakerThreshold) {
        const currentType = script?.type ?? "unknown";
        const handled = await this.tryZoneRescueOrFocusRotation(currentType, failure);
        if (handled) {
          this.currentScript = null;
          this.ticksSinceLastDecision = MAX_STALE_TICKS;
          this.clearFailure(failure.key);
        }
      }
      return;
    }

    if (result.failureKey) {
      this.clearFailure(result.failureKey);
      return;
    }

    if (!script?.type) return;
    for (const entry of this.failureMemory.values()) {
      if (entry.scriptType === script.type) {
        this.clearFailure(entry.key);
      }
    }
  }

  private issueCommand(
    command:
      | { action: "move"; x: number; y: number }
      | { action: "attack"; targetId: string }
      | { action: "technique"; targetId: string; techniqueId: string }
      | { action: "travel"; targetZone: string },
  ): boolean {
    if (!this.entityId) return false;
    const ok = issueAgentCommand(this.entityId, command);
    this.telemetry.commands.total += 1;
    this.telemetry.commands[command.action] += 1;
    this.telemetry.commands.lastAt = Date.now();
    if (!ok) this.telemetry.commands.failed += 1;
    return ok;
  }

  private getZoneEventSeq(eventId: string): number {
    const match = eventId.match(/^evt_(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  private detectZoneEventTrigger(recentEvents: ZoneEvent[]): TriggerEvent | null {
    const relevant = recentEvents
      .filter((event) => this.getZoneEventSeq(event.id) > this.lastSeenZoneEventSeq)
      .filter((event) => event.entityId === this.entityId || event.targetId === this.entityId)
      .filter((event) => ["death", "kill", "levelup", "quest", "quest-progress", "loot", "technique"].includes(event.type))
      .sort((a, b) => this.getZoneEventSeq(a.id) - this.getZoneEventSeq(b.id));

    if (relevant.length === 0) return null;

    const latest = relevant[relevant.length - 1];
    this.lastSeenZoneEventSeq = this.getZoneEventSeq(latest.id);

    // Emit dialogue for kill events (fires before trigger return)
    if (this.entityId) {
      const entity = getWorldEntity(this.entityId);
      if (entity) {
        const dCtx = {
          entityId: this.entityId,
          entityName: entity.name,
          zoneId: this.currentRegion,
          origin: this.agentOrigin ?? undefined,
          classId: entity.classId ?? undefined,
        };
        if (latest.type === "technique" && latest.entityId === this.entityId) {
          emitAgentChat({ ...dCtx, event: "technique_learn", detail: getTechniqueDetail(latest) });
          void sendAgentPush(this.userWallet, { type: "technique_learned", agentName: entity.name, detail: getTechniqueDetail(latest) });
        } else if (latest.type === "quest") {
          emitAgentChat({ ...dCtx, event: "quest_complete", detail: latest.message });
          void sendAgentPush(this.userWallet, { type: "quest_complete", agentName: entity.name, detail: latest.message });
          // Notify summoner in inbox
          if (this.custodialWallet) {
            const questLine = pickLine(this.agentOrigin ?? undefined, entity.classId ?? undefined, "summon_quest_complete")
              ?? `Just finished "${latest.message ?? "a quest"}"! What should I do next?`;
            const questBody = questLine.replace(/\{detail\}/g, latest.message ?? "a quest");
            void sendInboxMessage({
              from: this.custodialWallet,
              fromName: entity.name,
              to: this.userWallet,
              type: "direct",
              body: questBody,
            });
          }

          // After completing a farm "talk to Helga" quest, suggest buying land
          const FARM_LAND_QUESTS = [
            "farm_mining_claim", "farm_herb_green_acres", "farm_skin_homesteader",
            "farm_smith_real_estate", "farm_alch_apothecary", "farm_cook_kitchen_dreams",
            "farm_leather_ranch", "farm_jewel_gem_estate",
          ];
          const completedIds = entity.completedQuests ?? [];
          const justCompletedFarmQuest = FARM_LAND_QUESTS.some((qid) => completedIds.includes(qid));
          if (justCompletedFarmQuest && this.custodialWallet) {
            // Check if they already own a plot (async in a fire-and-forget)
            import("../farming/plotSystem.js").then(async ({ getOwnedPlotAsync }) => {
              const owned = await getOwnedPlotAsync(this.custodialWallet!) ?? await getOwnedPlotAsync(this.userWallet);
              if (!owned) {
                void this.askSummoner(
                  `I talked to Plot Registrar Helga and there's a small plot in Sunflower Fields for just 25 gold. Should I claim it for us? We can start building a homestead there.`,
                  ["Yes, claim it!", "Not yet"],
                  { action: "claim_plot", zoneId: "sunflower-fields" },
                );
              }
            }).catch(() => {});
          }
        } else if (latest.type === "quest-progress" && latest.entityId === this.entityId) {
          const milestone = getQuestProgressMilestone(latest);
          if (milestone) {
            emitAgentChat({ ...dCtx, event: "quest_progress", detail: milestone });
          }
        }

        // Check if we barely survived (low HP after a fight)
        if (latest.type === "kill" && entity.hp > 0 && entity.hp < entity.maxHp * 0.25) {
          emitAgentChat({ ...dCtx, event: "low_hp_survive" });
        }
      }
    }

    if (latest.type === "levelup") {
      const entity = this.entityId ? getWorldEntity(this.entityId) : null;
      void sendAgentPush(this.userWallet, { type: "level_up", agentName: entity?.name ?? "Agent", detail: latest.message });
      // Notify summoner in inbox
      if (this.custodialWallet) {
        const lvl = String(entity?.level ?? "?");
        const lvlLine = pickLine(this.agentOrigin ?? undefined, entity?.classId ?? undefined, "summon_level_up")
          ?? `Just hit level ${lvl}! Should I keep going here or move to a new zone?`;
        const lvlBody = lvlLine.replace(/\{detail\}/g, lvl);
        void sendInboxMessage({
          from: this.custodialWallet,
          fromName: entity?.name ?? "Agent",
          to: this.userWallet,
          type: "direct",
          body: lvlBody,
        });
      }
      return { type: "level_up", detail: latest.message };
    }
    if (latest.type === "death") {
      const entity = this.entityId ? getWorldEntity(this.entityId) : null;
      void sendAgentPush(this.userWallet, { type: "death", agentName: entity?.name ?? "Agent", detail: this.currentRegion });

      // Death-loop guard: if the agent has died 3+ times in this zone within
      // the last 5 minutes, the mob is too strong — force idle and clear
      // travel/quest focus so the agent stops walking back to its grave.
      const zone = this.currentRegion;
      const now = Date.now();
      const window = 5 * 60_000;
      const deaths = (this.recentDeathsByZone.get(zone) ?? []).filter((t) => now - t < window);
      deaths.push(now);
      this.recentDeathsByZone.set(zone, deaths);
      if (deaths.length >= 3) {
        console.warn(`[agent:${this.walletTag}] Death loop in ${zone} (${deaths.length} deaths in 5min) — going idle`);
        void this.logActivity(`Died ${deaths.length}x in ${zone} — pausing. Tell me where to go next.`);
        void patchAgentConfig(this.userWallet, { focus: "idle", targetZone: undefined });
        this.currentScript = { type: "idle", reason: `Death loop in ${zone}` };
        this.ticksOnCurrentScript = 0;
        // Drop the threshold for the next deadly cycle — once unstuck the user
        // will choose where to go.
        this.recentDeathsByZone.delete(zone);
        return null;
      }

      return { type: "stuck", detail: `Recent death: ${latest.message}` };
    }
    if (latest.type === "quest-progress") {
      return null;
    }
    return { type: "script_done", detail: latest.message };
  }

  private async moveToEntity(me: any, target: any, closeEnoughDist = 35): Promise<boolean> {
    if (!this.entityId) return false;
    const dist = Math.hypot(target.x - me.x, target.y - me.y);
    const targetKey = `${Math.round(target.x)},${Math.round(target.y)}`;
    const now = Date.now();
    const targetChanged = targetKey !== this.moveToLastTarget;

    if (targetChanged) {
      this.moveToStaleCount = 0;
      this.moveToLastTarget = targetKey;
      this.moveToLastDistance = Number.POSITIVE_INFINITY;
    }

    const madeProgress = dist < this.moveToLastDistance - MOVE_PROGRESS_EPSILON;
    if (madeProgress) {
      this.moveToStaleCount = 0;
    } else if (!targetChanged) {
      this.moveToStaleCount++;
    }
    this.moveToLastDistance = dist;

    if (dist <= closeEnoughDist) {
      this.moveToStaleCount = 0;
      this.moveToLastDistance = Number.POSITIVE_INFINITY;
      this.moveToLastTarget = "";
      return false;
    }

    // Give up after 12 stale ticks — likely blocked by entity collision.
    // Widen the "close enough" radius so we can interact from further away.
    if (this.moveToStaleCount >= 12) {
      console.log(`[agent:${this.walletTag}] moveToEntity stalled 12x to ${target.name ?? "target"} (${Math.round(dist)} away) — treating as arrived`);
      this.moveToStaleCount = 0;
      this.moveToLastDistance = Number.POSITIVE_INFINITY;
      this.moveToLastTarget = "";
      return false; // Treat as "close enough" so the caller can attempt interaction
    }

    const entity = getWorldEntity(this.entityId);
    const currentOrder = entity?.order;
    const alreadyMovingToTarget = currentOrder?.action === "move"
      && Math.abs((currentOrder.x ?? 0) - target.x) < 1
      && Math.abs((currentOrder.y ?? 0) - target.y) < 1;
    const stalled = this.moveToStaleCount >= 4;

    const shouldIssueMove = targetChanged
      || !alreadyMovingToTarget
      || stalled
      || now - this.moveToLastCommandAt >= MOVE_REISSUE_MS;

    if (shouldIssueMove) {
      if (targetChanged || now - this.moveToLastLogAt >= 5_000 || stalled) {
        void this.logActivity(`Walking to ${target.name ?? "target"} (${Math.round(dist)} away)`);
        this.moveToLastLogAt = now;
      }
      this.issueCommand({ action: "move", x: target.x, y: target.y });
      this.moveToLastCommandAt = now;
    }

    return true;
  }

  async getWalletBalance(): Promise<{ copper: number; items: any[] }> {
    if (!this.custodialWallet) return { copper: 0, items: [] };
    const startedAt = performance.now();
    const balance = await fetchWalletBalance(this.custodialWallet);
    this.updateTimingMetric(this.telemetry.walletBalance, performance.now() - startedAt);
    return balance;
  }

  async getLiquidationInventory(): Promise<{ copper: number; items: any[] }> {
    if (!this.custodialWallet) return { copper: 0, items: [] };
    const startedAt = performance.now();
    const balance = await fetchLiquidationInventory(this.custodialWallet);
    this.updateTimingMetric(this.telemetry.walletBalance, performance.now() - startedAt);
    return balance;
  }

  private findNextZoneForLevel(level: number): string | null {
    const allowed = this.currentCaps.allowedZones;
    const zonesByLevel = Object.entries(ZONE_LEVEL_REQUIREMENTS)
      .filter(([zone]) => allowed === "all" || allowed.includes(zone))
      .filter(([zone]) => QUEST_ZONES.has(zone)) // Only route to zones with quest content
      .sort(([, a], [, b]) => a - b);
    let bestZone: string | null = null;
    for (const [zone, req] of zonesByLevel) {
      if (level >= req) bestZone = zone;
    }
    return bestZone;
  }

  private findNextZoneOnPath(
    currentNeighbors: Array<{ zone: string }>,
    targetZone: string,
  ): string | null {
    const directNeighbors = currentNeighbors.map((n) => n.zone).filter((z) => z && z !== this.currentRegion);
    if (directNeighbors.length === 0) return null;
    if (directNeighbors.includes(targetZone)) return targetZone;

    type Node = { zone: string; firstHop: string };
    const queue: Node[] = directNeighbors.map((zone) => ({ zone, firstHop: zone }));
    const visited = new Set<string>([this.currentRegion, ...directNeighbors]);

    while (queue.length > 0) {
      const { zone, firstHop } = queue.shift()!;
      for (const neighbor of getZoneConnections(zone)) {
        if (visited.has(neighbor)) continue;
        if (neighbor === targetZone) return firstHop;
        visited.add(neighbor);
        queue.push({ zone: neighbor, firstHop });
      }
    }
    return null;
  }

  /** Build the AgentContext object passed to extracted behavior/survival functions. */
  // ── Objective helpers ──────────────────────────────────────────────────────

  /** Check if an objective's completion condition is met. */
  private checkObjectiveCompletion(obj: AgentObjective, entity: any): boolean {
    switch (obj.type) {
      case "reach_level":
        return (entity.level ?? 1) >= (obj.params.level as number ?? 99);
      case "travel_to":
        return this.currentRegion === (obj.params.zoneId as string);
      case "earn_gold": {
        // Progress is tracked via getObjectiveProgress
        return (obj.progress ?? 0) >= (obj.target ?? Infinity);
      }
      case "complete_quest":
        return (entity.completedQuests ?? []).includes(obj.params.questId as string);
      case "learn_profession": {
        const learned = entity.learnedProfessions ?? [];
        return learned.includes(obj.params.professionId as string);
      }
      case "learn_technique": {
        const techniques = entity.learnedTechniques ?? [];
        return techniques.includes(obj.params.techniqueId as string);
      }
      case "gather": {
        // Complete when progress >= target quantity
        return (obj.progress ?? 0) >= (obj.target ?? 1);
      }
      case "craft":
        return (obj.progress ?? 0) >= (obj.target ?? 1);
      case "buy_item":
        return obj.progress != null && obj.progress >= (obj.target ?? 1);
      case "custom":
        // Custom objectives are only completed manually or by the supervisor
        return false;
      default:
        return false;
    }
  }

  /** Get current progress number for an objective (null if not trackable). */
  private getObjectiveProgress(obj: AgentObjective, entity: any): number | null {
    switch (obj.type) {
      case "reach_level":
        return entity.level ?? 1;
      case "travel_to":
        return this.currentRegion === (obj.params.zoneId as string) ? 1 : 0;
      case "earn_gold":
        // Gold is tracked externally; return null to avoid overwriting
        return null;
      case "complete_quest": {
        const active = (entity.activeQuests ?? []).find((q: any) => q.questId === obj.params.questId);
        if (active) return active.progress ?? 0;
        if ((entity.completedQuests ?? []).includes(obj.params.questId)) return obj.target ?? 1;
        return 0;
      }
      default:
        return null;
    }
  }

  private buildContext(): AgentContext | null {
    if (!this.api || !this.entityId || !this.custodialWallet) return null;
    const self = this;
    return {
      userWallet: this.userWallet,
      walletTag: this.walletTag,
      entityId: this.entityId,
      custodialWallet: this.custodialWallet,
      currentRegion: this.currentRegion,
      currentCaps: this.currentCaps,
      api: this.api,
      getZoneState: () => self.getZoneState(),
      findNearestEntity: (e, m, p) => self.findNearestEntity(e, m, p),
      moveToEntity: (m, t, d?) => self.moveToEntity(m, t, d),
      issueCommand: (command) => self.issueCommand(command),
      isInteractionOnCooldown: (key) => self.isInteractionOnCooldown(key),
      setInteractionCooldown: (key, ms) => self.setInteractionCooldown(key, ms),
      clearInteractionCooldown: (key) => self.clearInteractionCooldown(key),
      recordPartyCoordination: (kind) => self.recordPartyCoordination(kind),
      logActivity: (text) => { void self.logActivity(text); },
      setEntityGotoMode: (on) => self.setEntityGotoMode(on),
      getWalletBalance: () => self.getWalletBalance(),
      getLiquidationInventory: () => self.getLiquidationInventory(),
      setScript: (s) => { self.currentScript = s; self.ticksOnCurrentScript = 0; },
      get currentScript() { return self.currentScript; },
      enqueueActions: (scripts, clearExisting) => self.enqueueActions(scripts, clearExisting ?? false),
      get homeZone() { return self.homeZone; },
      get ignoreWeakMobs() { return self.ignoreWeakMobsFlag; },
      isQuestStuck: (id) => self.isQuestStuck(id),
      markQuestStuck: (id, reason) => self.markQuestStuck(id, reason),
      isGatherNodeBlacklisted: (id) => self.isGatherNodeBlacklisted(id),
      markGatherNodeBlacklisted: (id) => self.markGatherNodeBlacklisted(id),
      get committedTargetId() { return self.getCommittedTargetId(); },
      commitTarget: (id, ttlTicks) => self.commitTarget(id, ttlTicks),
      clearCommittedTarget: () => self.clearCommittedTarget(),
      buyItem: (id) => self.buyItem(id),
      equipItem: (id, instanceId) => self.equipItem(id, instanceId),
      equipItemWithReason: (id, instanceId) => self.equipItemWithReason(id, instanceId),
      learnProfession: (id) => self.learnProfession(id),
      recycleItem: (id, quantity) => self.recycleItem(id, quantity),
      askSummoner: async (text, choices, context) => {
        const q = await self.askSummoner(text, choices, context);
        return q !== null;
      },
    };
  }

  // ── Script execution ───────────────────────────────────────────────────────

  private async executeCurrentScript(entity: any, entities: Record<string, any>, strategy: AgentStrategy): Promise<ActionResult> {
    const script = this.currentScript;
    if (!script) return actionIdle("No active script");

    const ctx = this.buildContext();
    if (!ctx) return actionBlocked("Agent context unavailable", { failureKey: "context:missing" });

    switch (script.type) {
      case "combat":  return behaviors.doCombat(ctx, strategy, () => this.learnNextTechnique());
      case "gather":  return behaviors.doGathering(ctx, strategy, script.nodeType ?? "both");
      case "travel":  return behaviors.doTravel(ctx, strategy);
      case "goto":    return behaviors.doGotoNpc(ctx, (n, t) => this.findNextZoneOnPath(n, t));
      case "shop":    return behaviors.doShopping(ctx, strategy);
      case "trade":   return behaviors.doTrading(ctx, strategy);
      case "craft":   return behaviors.doCrafting(ctx, strategy);
      case "brew":    return behaviors.doAlchemy(ctx, strategy);
      case "cook":    return behaviors.doCooking(ctx, strategy);
      case "quest":   return behaviors.doQuesting(ctx, strategy, (l) => this.findNextZoneForLevel(l));
      case "learn": {
        const learnCooldownKey = "learn-technique";
        if (this.isInteractionOnCooldown(learnCooldownKey)) {
          return actionBlocked("technique learning on cooldown", {
            failureKey: learnCooldownKey, endpoint: "/techniques/learn", category: "transient",
          });
        }
        const result = await this.learnNextTechnique();
        if (result.ok) {
          this.clearFailure(learnCooldownKey);
          return actionProgressed(result.reason);
        }
        // Back off 30s on any failure to prevent spam
        this.setInteractionCooldown(learnCooldownKey, 30_000);
        const failure = this.recordFailure({
          key: learnCooldownKey, reason: result.reason,
          scriptType: "learn", endpoint: "/techniques/learn", category: "transient",
        });
        // After 5 consecutive failures, abandon the learn script and let the
        // supervisor pick a new focus (combat, quest, etc.)
        if (failure.consecutive >= 5) {
          this.currentScript = null;
          console.warn(`[agent:${this.walletTag}] learn-technique abandoned after ${failure.consecutive} failures — clearing script`);
          void this.logActivity?.(`Giving up on learning techniques after ${failure.consecutive} failures`);
          return actionBlocked(result.reason, {
            failureKey: learnCooldownKey, endpoint: "/techniques/learn", category: "strategic",
          });
        }
        return actionBlocked(result.reason, {
          failureKey: learnCooldownKey, endpoint: "/techniques/learn", category: "transient",
        });
      }
      case "enchant":      return behaviors.doEnchanting(ctx, strategy);
      case "leatherwork":  return behaviors.doLeatherworking(ctx, strategy);
      case "jewelcraft":   return behaviors.doJewelcrafting(ctx, strategy);
      case "farm":         return behaviors.doFarming(ctx, strategy);
      case "dungeon": return behaviors.doDungeon(ctx, strategy, { gateEntityId: script.gateEntityId, gateRank: script.gateRank });
      case "idle": {
        // Auto-defend: if a mob is actively attacking us, fight back.
        // Only applies in idle mode — other scripts are explicit user/agent
        // intent and shouldn't get hijacked by a passing aggressive mob.
        const attacker = Object.values(entities).find(
          (e: any) =>
            (e.type === "mob" || e.type === "boss")
            && e.hp > 0
            && e.order?.action === "attack"
            && e.order?.targetId === this.entityId,
        ) as any;
        if (attacker) {
          this.commitTarget(attacker.id);
          this.issueCommand({ action: "attack", targetId: attacker.id });
          return actionProgressed(`Defending against ${attacker.name ?? "attacker"}`);
        }
        return actionIdle("Idle");
      }
    }
  }

  // ── Decision engine ────────────────────────────────────────────────────────

  private async decideAndAct(
    entity: any,
    entities: Record<string, any>,
    config: {
      focus: AgentFocus;
      strategy: AgentStrategy;
      gatherNodeType?: GatherPreference;
      targetZone?: string;
      gotoTarget?: { entityId: string; zoneId: string };
      gotoPosition?: { x: number; y: number; zoneId: string };
      resumeFocusAfterGoto?: AgentFocus;
      objectives?: AgentObjective[];
      standingOrders?: string;
      autoProgress?: boolean;
      ignoreWeakMobs?: boolean;
      homeZone?: string;
    },
    strategy: AgentStrategy,
  ): Promise<void> {
    const objectives = config.objectives ?? [];
    const activeObj = getActiveObjective(objectives);

    const triggerState: TriggerState = {
      currentScript: this.currentScript,
      ticksSinceLastDecision: this.ticksSinceLastDecision,
      ticksOnCurrentScript: this.ticksOnCurrentScript,
      lastKnownLevel: this.lastKnownLevel,
      lastKnownZone: this.lastKnownZone,
      currentRegion: this.currentRegion,
      maxStaleTicks: MAX_STALE_TICKS,
    };

    // ── Action queue: dequeue next if idle ──
    if (!this.currentScript && this.actionQueue.length > 0) {
      this.recordUtilityQueueAbstain("queue_dequeue");
      console.log(
        `[agent:${this.walletTag}] Utility abstain :: ${formatUtilityQueueAbstain(this.actionQueue.length, this.currentScript)}`
      );
      this.dequeueNext();
      return; // let the new script execute on the next tick
    }

    // Increment counters before detection (detectTrigger is now pure)
    this.ticksSinceLastDecision++;
    this.ticksOnCurrentScript++;

    const pendingTrigger = this.pendingTrigger;
    this.pendingTrigger = null;
    let trigger = pendingTrigger
      ?? this.detectZoneEventTrigger(this.cachedZoneState?.recentEvents ?? [])
      ?? detectTrigger(entity, entities, triggerState);

    // When the queue is active, suppress triggers that would override user's plan.
    // Only "blocked" triggers (repeated failures) can interrupt a queued action.
    if (trigger && this.actionQueue.length > 0) {
      if (trigger.type === "zone_arrived" || trigger.type === "periodic" || trigger.type === "no_script") {
        this.recordUtilityQueueAbstain(trigger.type);
        console.log(
          `[agent:${this.walletTag}] Utility abstain [${trigger.type}] :: ${formatUtilityQueueAbstain(this.actionQueue.length, this.currentScript)}`
        );
        console.log(`[agent:${this.walletTag}] Suppressed ${trigger.type} trigger — queue active (${this.actionQueue.length} items)`);
        trigger = null;
      }
    }

    if (trigger) {
      this.telemetry.triggers[trigger.type] = (this.telemetry.triggers[trigger.type] ?? 0) + 1;
      this.ticksSinceLastDecision = 0;
      this.lastKnownLevel = entity.level ?? 1;
      this.lastKnownZone = this.currentRegion;
      this.lastTrigger = trigger;
      console.log(`[agent:${this.walletTag}] Trigger [${trigger.type}]: ${trigger.detail}`);

      // Include the user's actual latest chat message + active objective + standing
      // orders so the supervisor honors durable user directives, not just recent chat.
      let userDirective = focusToDirective(config.focus, config.targetZone);
      if (activeObj) {
        const pct = activeObj.target ? ` (${activeObj.progress ?? 0}/${activeObj.target})` : "";
        userDirective = `OBJECTIVE: ${activeObj.label}${pct} — ${userDirective}`;
      }
      if (config.standingOrders && config.standingOrders.trim().length > 0) {
        // Standing orders are PERSISTENT — always surfaced, not timeboxed.
        userDirective = `STANDING ORDERS: ${config.standingOrders.trim()} — ${userDirective}`;
      }
      try {
        const recentChat = await getChatHistory(this.userWallet, 5);
        const lastUserMsg = [...recentChat].reverse().find((m) => m.role === "user");
        if (lastUserMsg && Date.now() - lastUserMsg.ts < 120_000) {
          userDirective = `User said: "${lastUserMsg.text}" — ${userDirective}`;
        }
      } catch { /* non-fatal */ }

      if (trigger.type === "no_script") {
        if (config.focus === "goto" && !config.gotoTarget && !config.gotoPosition) {
          const fallbackFocus =
            config.resumeFocusAfterGoto && config.resumeFocusAfterGoto !== "goto"
              ? config.resumeFocusAfterGoto
              : "questing";
          await patchAgentConfig(this.userWallet, {
            focus: fallbackFocus,
            resumeFocusAfterGoto: undefined,
            gotoTarget: undefined,
            gotoPosition: undefined,
          });
          this.currentScript = focusToScript(fallbackFocus, strategy, config.targetZone, config.gatherNodeType);
          this.ticksOnCurrentScript = 0;
          void this.logActivity(`[goto] Target missing; resuming ${fallbackFocus}`);
          return;
        }
        if (this.currentCaps.supervisorEnabled) {
          const { copper: walletGoldCopper } = await this.getWalletBalance();
          const liquidation = await this.getLiquidationInventory();
          const utilityDecision = chooseNextScript(buildUtilityDecisionContext({
            trigger,
            entity,
            entities,
            currentRegion: this.currentRegion,
            currentScript: this.currentScript,
            currentScriptProgressing: false,
            queueActive: this.actionQueue.length > 0,
            queuedActionCount: this.actionQueue.length,
            userFocus: config.focus,
            strategy,
            copper: walletGoldCopper,
            inventoryItems: liquidation.items,
            recentFailures: this.getRecentFailures(),
            allowedZones: this.currentCaps.allowedZones,
            ignoreWeakMobs: this.ignoreWeakMobsFlag,
          }));
          const utilityCanDrive = !utilityDecision.shouldEscalateToSupervisor;
          this.recordUtilityDecision(trigger.type, utilityDecision, utilityCanDrive);
          console.log(
            `[agent:${this.walletTag}] Utility ${utilityCanDrive ? "drive" : "shadow"} [${trigger.type}] ` +
            `winner=${utilityDecision.winner.type} score=${utilityDecision.winner.score.toFixed(2)} ` +
            `escalate=${utilityDecision.shouldEscalateToSupervisor} :: ` +
            `${formatUtilityDecision(utilityDecision)}`,
          );
          if (utilityCanDrive) {
            this.currentScript = utilityDecision.winner.script;
            this.ticksOnCurrentScript = 0;
            void this.logActivity(`[utility] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
            return;
          }
        }
        this.currentScript = focusToScript(config.focus, strategy, config.targetZone, config.gatherNodeType);
        this.ticksOnCurrentScript = 0;
        void this.logActivity(`[AI] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
      } else if (trigger.type === "level_up") {
        const lvl = entity.level ?? 1;
        const autoProgressEnabled = config.autoProgress !== false;

        // Auto-progress: enqueue a travel→quest chain to the best zone we now
        // qualify for. Queued chains suppress autonomous triggers so the agent
        // actually completes the zone advance without getting yanked back.
        // Previous code had a `+2` upper bound that blocked most level-ups.
        if (autoProgressEnabled && !activeObj && !this.isUserQueueLocked()) {
          const allowed = this.currentCaps.allowedZones;
          const chain = buildProgressChain(lvl, this.currentRegion, allowed);
          if (chain) {
            console.log(`[agent:${this.walletTag}] Level ${lvl} → enqueueing progress chain to ${chain[0].targetZone}`);
            void this.logActivity(`Level ${lvl}! Auto-progressing → ${chain[0].targetZone}`);
            await this.enqueueActions(chain, true);
            this.ticksOnCurrentScript = 0;
          } else {
            this.currentScript = focusToScript(config.focus, strategy, config.targetZone, config.gatherNodeType);
            this.ticksOnCurrentScript = 0;
            void this.logActivity(`Level ${lvl}! Continuing ${config.focus}`);
          }
        } else {
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone, config.gatherNodeType);
          this.ticksOnCurrentScript = 0;
          void this.logActivity(`Level ${lvl}! Continuing ${config.focus}`);
        }
      } else if (trigger.type === "no_targets") {
        if (config.focus === "combat") {
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone, config.gatherNodeType);
          this.ticksOnCurrentScript = 0;
          void this.logActivity("No mobs visible right now — holding combat focus");
          return;
        }
        // Only wander to a new zone if there's no active objective
        if (!activeObj) {
          const lvl = entity.level ?? 1;
          const allowed = this.currentCaps.allowedZones;
          const accessibleNeighbors = getZoneConnections(this.currentRegion)
            .filter((z) => lvl >= (ZONE_LEVEL_REQUIREMENTS[z] ?? 1))
            .filter((z) => allowed === "all" || allowed.includes(z))
            .filter((z) => QUEST_ZONES.has(z)); // Only wander to zones with quest content
          if (accessibleNeighbors.length > 0) {
            const pick = accessibleNeighbors[Math.floor(Math.random() * accessibleNeighbors.length)];
            console.log(`[agent:${this.walletTag}] No targets in ${this.currentRegion}, moving to ${pick}`);
            void this.logActivity(`Zone cleared — exploring ${pick}`);
            await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: pick });
            this.currentScript = { type: "travel", targetZone: pick, reason: "Zone cleared" };
            this.ticksOnCurrentScript = 0;
          } else {
            this.currentScript = focusToScript(config.focus, strategy, config.targetZone, config.gatherNodeType);
            this.ticksOnCurrentScript = 0;
          }
        } else {
          // Has objective — stay on task, just re-issue current focus script
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone, config.gatherNodeType);
          this.ticksOnCurrentScript = 0;
        }
      } else if (!this.currentCaps.supervisorEnabled) {
        this.currentScript = focusToScript(config.focus, strategy, config.targetZone, config.gatherNodeType);
        this.ticksOnCurrentScript = 0;
        void this.logActivity(`[script] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
      } else {
        const supervisorStartedAt = performance.now();
        try {
          const { copper: walletGoldCopper } = await this.getWalletBalance();
          const liquidation = await this.getLiquidationInventory();
          const utilityContext = buildUtilityDecisionContext({
            trigger,
            entity,
            entities,
            currentRegion: this.currentRegion,
            currentScript: this.currentScript,
            currentScriptProgressing: this.lastActionResult?.status === "progressed" || this.lastActionResult?.status === "completed",
            queueActive: this.actionQueue.length > 0,
            queuedActionCount: this.actionQueue.length,
            userFocus: config.focus,
            strategy,
            copper: walletGoldCopper,
            inventoryItems: liquidation.items,
            recentFailures: this.getRecentFailures(),
            allowedZones: this.currentCaps.allowedZones,
            ignoreWeakMobs: this.ignoreWeakMobsFlag,
          });
          const utilityDecision = chooseNextScript(utilityContext);
          const utilityEligibleTrigger =
            trigger.type === "periodic" ||
            trigger.type === "zone_arrived" ||
            trigger.type === "script_done";
          const utilityCanDrive = utilityEligibleTrigger && !utilityDecision.shouldEscalateToSupervisor;
          this.recordUtilityDecision(trigger.type, utilityDecision, utilityCanDrive);
          console.log(
            `[agent:${this.walletTag}] Utility ${utilityCanDrive ? "drive" : "shadow"} [${trigger.type}] ` +
            `winner=${utilityDecision.winner.type} score=${utilityDecision.winner.score.toFixed(2)} ` +
            `escalate=${utilityDecision.shouldEscalateToSupervisor} :: ` +
            `${formatUtilityDecision(utilityDecision)}`,
          );
          if (utilityCanDrive) {
            this.currentScript = utilityDecision.winner.script;
            this.ticksOnCurrentScript = 0;
            void this.logActivity(`[utility] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
            return;
          }
          const newScript = await runSupervisor(trigger, {
            entity, entities,
            entityId: this.entityId!,
            currentRegion: this.currentRegion,
            custodialWallet: this.custodialWallet!,
            currentScript: this.currentScript,
            recentActivities: this.recentActivities,
            recentZoneEvents: this.cachedZoneState?.recentEvents ?? [],
            recentFailures: this.getRecentFailures(),
            userDirective,
            configFocus: config.focus,
            apiCall: this.api!,
            walletGoldCopper,
            mcpClient: this.mcpClient?.isConnected() ? this.mcpClient : undefined,
          });
          this.updateTimingMetric(this.telemetry.supervisor, performance.now() - supervisorStartedAt);
          this.currentScript = newScript;
          this.ticksOnCurrentScript = 0;
          void this.logActivity(`[AI] ${newScript.type}: ${newScript.reason ?? ""}`);
        } catch (err: any) {
          this.updateTimingMetric(this.telemetry.supervisor, performance.now() - supervisorStartedAt);
          this.telemetry.supervisor.errors += 1;
          console.warn(`[agent:${this.walletTag}] Supervisor failed: ${err.message?.slice(0, 60)}`);
          this.logError("supervisor", `Supervisor failed: ${err.message?.slice(0, 200) ?? "unknown"}`);
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone, config.gatherNodeType);
          this.ticksOnCurrentScript = 0;
        }
      }
    }

    // ── Dialogue: emit chat on significant triggers ──
    if (trigger && this.entityId && entity.name) {
      const dCtx = {
        entityId: this.entityId,
        entityName: entity.name,
        zoneId: this.currentRegion,
        origin: this.agentOrigin ?? undefined,
        classId: entity.classId ?? undefined,
      };
      if (trigger.type === "level_up") {
        emitAgentChat({ ...dCtx, event: "level_up", detail: `${entity.level}` });
      } else if (trigger.type === "zone_arrived") {
        emitAgentChat({ ...dCtx, event: "zone_enter", detail: this.currentRegion });
        void sendAgentPush(this.userWallet, { type: "zone_arrived", agentName: entity.name, detail: this.currentRegion });
      } else if (trigger.type === "stuck" && trigger.detail?.includes("death")) {
        emitAgentChat({ ...dCtx, event: "death" });
      }
    }

    const executedScript = this.currentScript;
    const actionResult = await this.executeCurrentScript(entity, entities, strategy);
    await this.handleActionResult(executedScript, actionResult);

    // Track homeZone: when the agent is productively questing/combating in a zone
    // (script progressed without a failure), remember that zone so detour chains
    // (shop/learn/etc.) can return there instead of stranding in village-square.
    if (
      actionResult.status === "progressed"
      && executedScript
      && (executedScript.type === "combat" || executedScript.type === "quest" || executedScript.type === "dungeon")
      && !FARM_ZONES.has(this.currentRegion)
      && this.currentRegion !== "village-square"
    ) {
      if (this.homeZone !== this.currentRegion) {
        this.homeZone = this.currentRegion;
        void patchAgentConfig(this.userWallet, { homeZone: this.currentRegion });
        console.log(`[agent:${this.walletTag}] homeZone → ${this.currentRegion}`);
      }
    }

    // Idle recovery: if the script produced no useful work, force a re-evaluation
    // so the agent doesn't sit doing nothing until the stale timer fires.
    if (actionResult.status === "idle" && this.currentScript?.type !== "idle") {
      this.consecutiveIdles = (this.consecutiveIdles ?? 0) + 1;
      if (this.consecutiveIdles >= 3) {
        console.log(`[agent:${this.walletTag}] ${this.consecutiveIdles} idle ticks — forcing re-evaluation`);
        this.currentScript = null;
        this.ticksSinceLastDecision = MAX_STALE_TICKS;
        this.consecutiveIdles = 0;
      }
    } else {
      this.consecutiveIdles = 0;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(waitForFirstTick = false): Promise<void> {
    this.running = true;
    await this.restoreRuntimeSnapshot();
    this.actionQueue = await getActionQueue(this.userWallet);
    if (this.actionQueue.length > 0) {
      console.log(`[agent:${this.walletTag}] Restored ${this.actionQueue.length} queued actions`);
    }
    console.log(`[agent:${this.walletTag}] Loop starting`);

    let resolveFirst: () => void;
    let rejectFirst: (err: Error) => void;
    this.firstTickResult = new Promise<void>((res, rej) => {
      resolveFirst = res;
      rejectFirst = rej;
    });

    if (!waitForFirstTick) {
      this.firstTickResult.catch((err) => {
        console.warn(`[agent:${this.walletTag}] First tick failed (non-blocking): ${err.message}`);
      });
    }

    void this.loop(resolveFirst!, rejectFirst!);

    if (waitForFirstTick) {
      await this.firstTickResult;
    }
  }

  stop(): void {
    this.running = false;
    this.persistRuntimeSnapshotEventually("stop");
    if (this.mcpClient) {
      this.mcpClient.disconnect().catch(() => {});
      this.mcpClient = null;
    }
    console.log(`[agent:${this.walletTag}] Loop stopped`);
  }

  private async ensureAuth(): Promise<boolean> {
    if (this.jwt && Date.now() < this.jwtExpiry - 3_600_000) return true;

    const custodial = await getAgentCustodialWallet(this.userWallet);
    if (!custodial) return false;
    this.custodialWallet = custodial;

    try {
      const privateKey = await exportCustodialWallet(custodial);
      this.lastPrivateKey = privateKey;
      this.jwt = await authenticateWithWallet(privateKey);
      this.api = createAuthenticatedAPI(this.jwt);
      this.jwtExpiry = Date.now() + 23 * 3_600_000;
      console.log(`[agent:${this.walletTag}] Authenticated`);

      // Connect to MCP server (non-blocking — agent runs fine without it)
      if (!this.mcpClient) this.mcpClient = new AgentMcpClient(this.walletTag);
      this.mcpClient.ensureConnected(privateKey).catch((err) => {
        console.warn(`[agent:${this.walletTag}] MCP connect failed (non-fatal): ${err.message?.slice(0, 60)}`);
        this.logError("mcp", `MCP connect failed: ${err.message?.slice(0, 200) ?? "unknown"}`);
      });

      return true;
    } catch (err: any) {
      console.warn(`[agent:${this.walletTag}] Auth failed: ${err.message?.slice(0, 60)}`);
      this.logError("other", `Auth failed: ${err.message?.slice(0, 200) ?? "unknown"}`);
      return false;
    }
  }

  private async ensureEntity(): Promise<boolean> {
    const ref = await getAgentEntityRef(this.userWallet);
    if (!ref || !this.api) return false;

    this.entityId = ref.entityId;
    this.currentRegion = ref.zoneId;

    const worldEntity = getWorldEntity(this.entityId);
    if (worldEntity) {
      const newRegion = worldEntity.region ?? this.currentRegion;
      if (newRegion !== this.currentRegion) {
        console.log(`[agent:${this.walletTag}] Region changed: ${this.currentRegion} -> ${newRegion}`);
        void this.logActivity(`Region transition: ${this.currentRegion} -> ${newRegion}`);
      }
      this.currentRegion = newRegion;
      await setAgentEntityRef(this.userWallet, {
        entityId: this.entityId,
        zoneId: newRegion,
        characterName: ref.characterName,
        agentId: ref.agentId,
        characterTokenId: ref.characterTokenId,
      });
      return true;
    }

    try {
      const state = await this.api("GET", `/zones/${this.currentRegion}`);
      if (state?.entities?.[this.entityId]) return true;
    } catch (err: any) {
      console.debug(`[agent:${this.walletTag}] zone check: ${err.message?.slice(0, 60)}`);
      this.logError("other", `Zone check failed: ${err.message?.slice(0, 120) ?? "unknown"}`);
    }

    // Entity is gone — clean up stale wallet registry so respawn can work
    if (this.custodialWallet) {
      const staleEntry = isWalletSpawned(this.custodialWallet);
      if (staleEntry) {
        console.log(`[agent:${this.walletTag}] Entity missing but wallet still registered — cleaning up stale entry`);
        unregisterSpawnedWallet(this.custodialWallet);
      }

      // Try to respawn via the spawn API
      try {
        const charName = ref.characterName || "Agent";
        const spawnResult = await this.api("POST", `/spawn`, {
          walletAddress: this.custodialWallet,
          zoneId: this.currentRegion || "village-square",
          type: "player",
          name: charName,
          ...(ref.agentId && { agentId: ref.agentId }),
          ...(ref.characterTokenId && { characterTokenId: ref.characterTokenId }),
        });
        if (spawnResult?.spawned?.id) {
          const newEntityId: string = spawnResult.spawned.id;
          this.entityId = newEntityId;
          const spawnZone: string = spawnResult.zone || this.currentRegion || "village-square";
          this.currentRegion = spawnZone;
          await setAgentEntityRef(this.userWallet, {
            entityId: newEntityId,
            zoneId: spawnZone,
            characterName: ref.characterName,
            agentId: ref.agentId,
            characterTokenId: ref.characterTokenId,
          });
          console.log(`[agent:${this.walletTag}] Respawned entity ${this.entityId} in ${spawnZone}`);
          return true;
        }
      } catch (err: any) {
        console.warn(`[agent:${this.walletTag}] Respawn failed: ${err.message?.slice(0, 80)}`);
        this.logError("other", `Respawn failed: ${err.message?.slice(0, 200) ?? "unknown"}`, { endpoint: "/spawn" });
      }
    }

    return false;
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  private async loop(
    onFirstTick: () => void,
    onFirstTickFail: (err: Error) => void,
  ): Promise<void> {
    let firstTickDone = false;

    while (this.running) {
      const loopStartedAt = performance.now();
      this.tickCounter++;
      try {
        this.cachedZoneState = null;

        // Auto-release target commitment if the mob has died or left the zone.
        // Commitment TTL expiry is handled lazily by getCommittedTargetId().
        if (this.committedTarget) {
          const committed = getWorldEntity(this.committedTarget.targetId);
          if (!committed || committed.hp <= 0) {
            this.clearCommittedTarget();
          }
        }

        const config = await getAgentConfig(this.userWallet);
        if (!config?.enabled) {
          this.persistRuntimeSnapshotEventually("disabled");
          if (!firstTickDone) onFirstTickFail(new Error("Agent config disabled"));
          this.running = false;
          break;
        }

        this.currentCaps = TIER_CAPABILITIES[config.tier ?? "free"];
        // Refresh flags that behaviors reference via ctx each tick.
        this.ignoreWeakMobsFlag = config.ignoreWeakMobs !== false;
        if (config.homeZone) this.homeZone = config.homeZone;

        // Session timeout
        if (this.currentCaps.sessionLimitMs != null && config.sessionStartedAt) {
          if (Date.now() - config.sessionStartedAt >= this.currentCaps.sessionLimitMs) {
            const hours = Math.round(this.currentCaps.sessionLimitMs / 3600_000);
            console.log(`[agent:${this.walletTag}] Session limit reached (${hours}h) — stopping`);
            void this.logActivity(`Session limit reached (${hours}h) — upgrade tier for longer sessions`);
            const sessionEntity = this.entityId ? getWorldEntity(this.entityId) : null;
            void sendAgentPush(this.userWallet, { type: "session_ended", agentName: sessionEntity?.name ?? "Agent", detail: `Session limit reached (${hours}h)` });
            await patchAgentConfig(this.userWallet, { enabled: false });
            this.persistRuntimeSnapshotEventually("session-limit");
            this.running = false;
            break;
          }
        }

        const authed = await this.ensureAuth();
        if (!authed) {
          if (!firstTickDone) { onFirstTickFail(new Error("Agent auth failed")); this.running = false; break; }
          await sleep(TICK_MS * 3);
          continue;
        }

        const hasEntity = await this.ensureEntity();
        if (!hasEntity) {
          if (!firstTickDone) { onFirstTickFail(new Error("Agent entity not found")); this.running = false; break; }
          await sleep(TICK_MS * 2);
          continue;
        }

        const zs = await this.getZoneState();
        if (!zs) {
          if (!firstTickDone) { onFirstTickFail(new Error("Could not read entity state")); this.running = false; break; }
          await sleep(TICK_MS);
          continue;
        }
        const entity = zs.me;

        if (!firstTickDone) {
          firstTickDone = true;
          console.log(`[agent:${this.walletTag}] First tick OK — entity ${this.entityId} in ${this.currentRegion}`);
          onFirstTick();
          this.persistRuntimeSnapshotEventually("first-tick");

          // Load origin for dialogue system
          if (this.custodialWallet && entity.name) {
            this.agentOrigin = await getAgentOrigin(this.custodialWallet, entity.name) ?? null;
          }
        }

        const strategy: AgentStrategy = config.strategy ?? "balanced";
        const focus: AgentFocus = config.focus;

        // Track focus changes
        if (focus !== this.lastFocus) {
          this.lastFocus = focus;
          this.ticksSinceFocusChange = 0;
          this.combatFallbackCount = 0;
          this.currentScript = null;
          this.ticksSinceLastDecision = MAX_STALE_TICKS;
          console.log(`[agent:${this.walletTag}] Focus changed -> ${focus} (${strategy})`);
          void this.logActivity(`Focus changed -> ${focus}`);
        }
        this.ticksSinceFocusChange++;

        // Suppress auto-combat for non-combat focuses (but allow in dungeons)
        const suppressCombat = focus !== "combat" && focus !== "questing" && !this.currentRegion.startsWith("dungeon-");
        this.setEntityGotoMode(suppressCombat);

        // Track zone-stay duration
        if (this.currentRegion !== this.lastKnownZone && this.lastKnownZone !== "") {
          this.ticksInCurrentZone = 0;

          // Detect dungeon exit — agent was teleported back to overworld
          if (this.lastKnownZone.startsWith("dungeon-") && !this.currentRegion.startsWith("dungeon-")) {
            console.log(`[agent:${this.walletTag}] Exited dungeon → ${this.currentRegion}`);
            void this.logActivity(`Returned from dungeon to ${this.currentRegion}`);
            this.currentScript = null;
            this.ticksSinceLastDecision = MAX_STALE_TICKS; // Force supervisor re-evaluation
          }
        }
        this.ticksInCurrentZone++;

        // Inbox check every 5 ticks
        if (this.ticksSinceFocusChange % 5 === 0) {
          await this.processInbox();
        }

        // Check for summoner reply to pending question
        if (this.pendingQuestionId) {
          const qReply = await this.checkQuestionReply();
          if (qReply === null) {
            // Still waiting — skip heavy decision-making, just idle
            await sleep(TICK_MS);
            continue;
          }
          if (qReply !== "expired" && qReply.context) {
            // Process the reply based on context
            const action = qReply.context.action as string | undefined;
            if (action === "buy" && qReply.reply.toLowerCase() === "yes") {
              void this.logActivity(`Summoner approved purchase — proceeding`);
            } else if (action === "buy" && qReply.reply.toLowerCase() === "no") {
              void this.logActivity(`Summoner declined purchase — skipping`);
              this.currentScript = null; // Clear shopping script
            } else if (action === "claim_plot" && qReply.reply.toLowerCase().includes("yes")) {
              // Summoner approved land purchase — travel to sunflower-fields and claim cheapest plot
              void this.logActivity(`Summoner approved land purchase — heading to claim a plot`);
              const targetZone = (qReply.context?.zoneId as string) ?? "sunflower-fields";
              if (this.currentRegion !== targetZone) {
                this.currentScript = { type: "travel", targetZone, reason: "Claiming a plot" };
                this.issueCommand({ action: "travel", targetZone });
              } else {
                // Already in the zone — claim the cheapest available plot
                try {
                  const { getPlotsInZoneAsync, getPlotDef, claimPlot } = await import("../farming/plotSystem.js");
                  const plots = await getPlotsInZoneAsync(targetZone);
                  const available = plots
                    .filter((p) => !p.owner)
                    .map((p) => ({ state: p, def: getPlotDef(p.plotId) }))
                    .filter((p) => p.def)
                    .sort((a, b) => (a.def!.cost - b.def!.cost));
                  if (available.length > 0) {
                    const cheapest = available[0];
                    const walletToUse = this.custodialWallet ?? this.userWallet;
                    const charName = entity.name ?? "Champion";
                    const result = await claimPlot(cheapest.state.plotId, walletToUse, charName);
                    if (result.ok) {
                      void this.logActivity(`Claimed plot ${cheapest.state.plotId} in ${targetZone} for ${cheapest.def!.cost}g!`);
                      await appendChatMessage(this.userWallet, {
                        role: "agent",
                        text: `I claimed a plot in ${targetZone.replace(/-/g, " ")}! Plot ${cheapest.state.plotId} is ours for ${cheapest.def!.cost} gold. We can start building a cottage there.`,
                        ts: Date.now(),
                      });
                    } else {
                      void this.logActivity(`Failed to claim plot: ${result.error}`);
                    }
                  }
                } catch (err: any) {
                  this.logError("action", `Plot claim failed: ${err.message?.slice(0, 120) ?? "unknown"}`);
                  void this.logActivity(`Plot claim failed: ${err.message?.slice(0, 60)}`);
                }
              }
            } else if (action === "claim_plot" && !qReply.reply.toLowerCase().includes("yes")) {
              void this.logActivity(`Summoner declined land purchase — will ask again later`);
            } else if (action === "travel" && qReply.reply.toLowerCase() === "yes") {
              void this.logActivity(`Summoner approved travel — proceeding`);
            } else if (action === "travel" && qReply.reply.toLowerCase() === "no") {
              void this.logActivity(`Summoner declined travel — staying`);
              await patchAgentConfig(this.userWallet, { focus: "combat", targetZone: undefined });
              this.currentScript = null;
            }
          }
          // Fall through to normal tick after processing reply
        }

        // Chat reactions: check for other agents' chat and maybe respond
        if (this.entityId && this.ticksSinceFocusChange % 3 === 0) {
          const chatEvents = getRecentZoneEvents(this.currentRegion, Date.now() - 10_000, ["chat", "levelup", "death", "quest", "kill", "loot", "technique"]);
          if (chatEvents.length > 0) {
            maybeReactToChat(
              {
                entityId: this.entityId,
                entityName: entity.name,
                zoneId: this.currentRegion,
                origin: this.agentOrigin ?? undefined,
                classId: entity.classId ?? undefined,
              },
              chatEvents,
            );
          }
        }

        // Idle dialogue: random 2-5 minute intervals when not actively fighting
        if (this.entityId && this.ticksSinceFocusChange >= this.nextIdleChatTick) {
          const notFighting = !entity.order || entity.order.type !== "attack";
          if (notFighting) {
            emitAgentChat({
              entityId: this.entityId,
              entityName: entity.name,
              zoneId: this.currentRegion,
              origin: this.agentOrigin ?? undefined,
              classId: entity.classId ?? undefined,
              event: "idle",
              detail: this.currentRegion,
            });
          }
          // Schedule next idle chat in 2-5 minutes (100-250 ticks at 1.2s each)
          this.nextIdleChatTick = this.ticksSinceFocusChange + 100 + Math.floor(Math.random() * 150);
        }

        // Greet nearby players periodically (every ~60 ticks = ~72s)
        if (this.entityId && this.ticksSinceFocusChange % 60 === 30 && zs) {
          const nearbyPlayers = Object.values(zs.entities).filter(
            (e: any) => e.type === "player" && e.id !== this.entityId && e.hp > 0,
          );
          if (nearbyPlayers.length > 0) {
            const pick = nearbyPlayers[Math.floor(Math.random() * nearbyPlayers.length)] as any;
            emitAgentChat({
              entityId: this.entityId,
              entityName: entity.name,
              zoneId: this.currentRegion,
              origin: this.agentOrigin ?? undefined,
              classId: entity.classId ?? undefined,
              event: "greet_player",
              speakerName: pick.name,
            });
          }
        }

        // Zone commentary (every ~120 ticks = ~2.5 min, random chance)
        if (this.entityId && this.ticksSinceFocusChange % 120 === 60 && Math.random() < 0.4) {
          emitAgentChat({
            entityId: this.entityId,
            entityName: entity.name,
            zoneId: this.currentRegion,
            origin: this.agentOrigin ?? undefined,
            classId: entity.classId ?? undefined,
            event: "zone_comment",
            detail: this.currentRegion,
          });
        }

        // Spot boss mobs and call them out
        if (this.entityId && this.ticksSinceFocusChange % 20 === 10 && zs) {
          const bosses = Object.values(zs.entities).filter(
            (e: any) => e.type === "boss" && e.hp > 0,
          );
          if (bosses.length > 0) {
            const boss = bosses[0] as any;
            emitAgentChat({
              entityId: this.entityId,
              entityName: entity.name,
              zoneId: this.currentRegion,
              origin: this.agentOrigin ?? undefined,
              classId: entity.classId ?? undefined,
              event: "spot_boss",
              detail: boss.name,
            });
          }
        }

        // Dungeon gate auto-detection — check every 10 ticks when in combat/questing
        if (
          this.ticksSinceFocusChange % 10 === 0
          && !this.currentRegion.startsWith("dungeon-")
          && (focus === "combat" || focus === "questing")
          && this.currentScript?.type !== "dungeon"
        ) {
          const zoneState = this.cachedZoneState ?? await this.getZoneState();
          if (zoneState) {
            const gates = Object.entries(zoneState.entities).filter(
              ([, e]) => e.type === "dungeon-gate" && !e.gateOpened && (!e.gateExpiresAt || e.gateExpiresAt > Date.now()),
            );
            const myLevel = entity.level ?? 1;
            const RANK_LEVELS: Record<string, number> = { E: 3, D: 7, C: 12, B: 18, A: 28, S: 40 };
            const eligible = gates.filter(([, g]) => myLevel >= (RANK_LEVELS[g.gateRank] ?? 999));
            if (eligible.length > 0) {
              const [gateId, gate] = eligible[0] as [string, any];
              console.log(`[agent:${this.walletTag}] Detected dungeon gate Rank ${gate.gateRank} — switching to dungeon mode`);
              void this.logActivity(`Dungeon gate appeared! Rank ${gate.gateRank}${gate.isDangerGate ? " DANGER" : ""} — heading in`);
              this.currentScript = { type: "dungeon", gateEntityId: gateId, gateRank: gate.gateRank, reason: `Gate surge: Rank ${gate.gateRank}` };
              this.ticksSinceLastDecision = 0;
            }
          }
        }

        // Survival: low HP handling
        const ctx = this.buildContext();
        if (ctx) {
          const usedPotion = await handleLowHp(ctx, entity, strategy);
          if (usedPotion) { await sleep(TICK_MS); continue; }
        }

        // Compute active objective early so trigger handlers + self-adaptation can see it
        const objectives = config.objectives ?? [];
        const activeObj = getActiveObjective(objectives);

        // Self-adaptation (skip inside dungeons — stay focused on clearing)
        const allowAutoAdapt = this.currentCaps.selfAdaptationEnabled
          && !this.currentRegion.startsWith("dungeon-")
          && (focus === "questing" || focus === "combat" || focus === "cooking" || focus === "shopping" || focus === "gathering" || focus === "crafting" || focus === "farming");
        if (allowAutoAdapt && this.ticksSinceFocusChange % 10 === 0 && this.ticksSinceFocusChange > 0 && ctx) {
          const adapted = await checkSelfAdaptation(ctx, entity, strategy, {
            currentFocus: focus,
            ticksSinceFocusChange: this.ticksSinceFocusChange,
            ticksInCurrentZone: this.ticksInCurrentZone,
            findNextZoneForLevel: (l) => this.findNextZoneForLevel(l),
            hasActiveObjective: !!activeObj,
          });
          if (adapted) { this.currentScript = null; await sleep(TICK_MS); continue; }
        }

        // Auto-repair
        if (needsRepair(entity)) {
          const repairing = await this.repairGear();
          if (repairing) { await sleep(TICK_MS); continue; }
        }

        // Skip zone management while inside a dungeon instance
        const inDungeon = this.currentRegion.startsWith("dungeon-");

        // ── Party follow: non-leaders follow the leader's zone ──────────
        // Skip if agent has a user-set objective (objective takes priority over party)
        const hasObjective = (config.objectives ?? []).some((o) => o.status === "active" || o.status === "pending");
        if (!inDungeon && !hasObjective && this.entityId) {
          const partyId = getPlayerPartyId(this.entityId);
          if (partyId) {
            const leaderId = getPartyLeaderId(this.entityId);
            if (leaderId && leaderId !== this.entityId) {
              const leaderEntity = getWorldEntity(leaderId) as any;
              const leaderZone = leaderEntity?.region as string | undefined;
              if (leaderZone && leaderZone !== this.currentRegion && !leaderZone.startsWith("dungeon-")) {
                const myLevel = entity.level ?? 1;
                const zoneReq = ZONE_LEVEL_REQUIREMENTS[leaderZone] ?? 1;
                if (myLevel >= zoneReq) {
                  if (config.targetZone !== leaderZone || focus !== "traveling") {
                    console.log(`[agent:${this.walletTag}] Following party leader to ${leaderZone}`);
                    void this.logActivity(`Following party leader to ${leaderZone.replace(/-/g, " ")}`);
                    await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: leaderZone });
                    this.currentScript = { type: "travel", targetZone: leaderZone, reason: "Following party leader" };
                    this.ticksOnCurrentScript = 0;
                    await sleep(TICK_MS);
                    continue;
                  }
                }
              }

              const shouldShadowLeader = focus === "combat" || focus === "questing" || this.currentScript?.type === "dungeon";
              if (shouldShadowLeader && leaderZone === this.currentRegion) {
                const distToLeader = Math.hypot(
                  Number(leaderEntity?.x ?? 0) - Number(entity.x ?? 0),
                  Number(leaderEntity?.y ?? 0) - Number(entity.y ?? 0),
                );
                if (distToLeader > PARTY_LEADER_FOLLOW_DISTANCE) {
                  const moving = await this.moveToEntity(entity, leaderEntity, PARTY_LEADER_STOP_DISTANCE);
                  if (moving) {
                    await sleep(TICK_MS);
                    continue;
                  }
                }
              }

            }
          }
        }

        if (!inDungeon) {
          // Normalize target zone
          const normalizedTargetZone = resolveRegionId(config.targetZone);
          if (config.targetZone && !normalizedTargetZone) {
            await patchAgentConfig(this.userWallet, { targetZone: undefined });
            this.currentScript = null;
          }
          if (normalizedTargetZone && normalizedTargetZone !== config.targetZone) {
            await patchAgentConfig(this.userWallet, { targetZone: normalizedTargetZone });
          }
          if (normalizedTargetZone && normalizedTargetZone !== this.currentRegion && focus !== "traveling") {
            await patchAgentConfig(this.userWallet, { focus: "traveling" });
            this.currentScript = null;
          }

          // Zone restriction enforcement
          if (this.currentCaps.allowedZones !== "all") {
            const allowed = this.currentCaps.allowedZones;
            if (!allowed.includes(this.currentRegion)) {
              const fallbackZone = allowed[0] ?? "village-square";
              console.log(`[agent:${this.walletTag}] Zone ${this.currentRegion} not allowed — forcing travel to ${fallbackZone}`);
              void this.logActivity(`Zone restricted — returning to ${fallbackZone}`);
              await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: fallbackZone });
              this.currentScript = null;
            }
            if (normalizedTargetZone && !allowed.includes(normalizedTargetZone)) {
              console.log(`[agent:${this.walletTag}] Target zone ${normalizedTargetZone} not allowed — clearing`);
              await patchAgentConfig(this.userWallet, { targetZone: undefined });
              this.currentScript = null;
            }
          }
        }

        // ── Objective system: check/advance the active objective ──
        if (activeObj) {
          const objCompleted = this.checkObjectiveCompletion(activeObj, entity);
          if (objCompleted) {
            await completeObjective(this.userWallet, activeObj.id);
            void this.logActivity(`Objective complete: ${activeObj.label}`);
            console.log(`[agent:${this.walletTag}] Objective completed: ${activeObj.label}`);

            // Find next objective and switch focus
            const updatedConfig = await getAgentConfig(this.userWallet);
            const nextObj = getActiveObjective(updatedConfig?.objectives ?? []);
            if (nextObj) {
              const derived = objectiveToFocus(nextObj);
              nextObj.status = "active";
              await patchAgentConfig(this.userWallet, {
                focus: derived.focus,
                targetZone: derived.targetZone,
                strategy: derived.strategy ?? config.strategy,
                objectives: updatedConfig?.objectives,
              });
              this.currentScript = null;
              this.ticksSinceLastDecision = MAX_STALE_TICKS;
              void this.logActivity(`Next objective: ${nextObj.label}`);
              console.log(`[agent:${this.walletTag}] Next objective: ${nextObj.label}`);
            } else {
              // All objectives done — fall back to questing
              await patchAgentConfig(this.userWallet, { focus: "questing" });
              this.currentScript = null;
              this.ticksSinceLastDecision = MAX_STALE_TICKS;
              void this.logActivity("All objectives complete! Returning to questing.");
            }
            await sleep(TICK_MS);
            continue;
          } else {
            // If the active objective's implied focus differs from current, switch
            if (activeObj.status === "pending") {
              activeObj.status = "active";
              const derived = objectiveToFocus(activeObj);
              if (derived.focus !== config.focus || (derived.targetZone && derived.targetZone !== config.targetZone)) {
                await patchAgentConfig(this.userWallet, {
                  focus: derived.focus,
                  targetZone: derived.targetZone,
                  strategy: derived.strategy ?? config.strategy,
                  objectives,
                });
                this.currentScript = null;
                this.ticksSinceLastDecision = MAX_STALE_TICKS;
                void this.logActivity(`Working on objective: ${activeObj.label}`);
                await sleep(TICK_MS);
                continue;
              }
            }
            // Update progress tracking
            const progress = this.getObjectiveProgress(activeObj, entity);
            if (progress != null && progress !== activeObj.progress) {
              await updateObjectiveProgress(this.userWallet, activeObj.id, progress);
            }
          }
        }

        await this.withGate(() => this.decideAndAct(entity, zs.entities, config, strategy));
      } catch (err: any) {
        console.warn(`[agent:${this.walletTag}] Loop error: ${err.message?.slice(0, 80)}`);
        this.logError("loop", `Loop error: ${err.message?.slice(0, 200) ?? "unknown"}`, { stack: err.stack?.slice(0, 300) ?? "" });
        if (!firstTickDone) {
          onFirstTickFail(err instanceof Error ? err : new Error(String(err.message ?? err)));
          this.running = false;
          return;
        }
      } finally {
        this.telemetry.lastLoopAt = Date.now();
        this.updateTimingMetric(this.telemetry.loop, performance.now() - loopStartedAt);
        this.persistRuntimeSnapshotEventually("loop");
      }

      await sleep(TICK_MS);
    }

    console.log(`[agent:${this.walletTag}] Loop exited`);
  }
}
