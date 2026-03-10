/**
 * AgentRunner — per-user AI agent loop.
 * Reads config from Redis each tick and executes the configured focus behavior.
 *
 * Behaviors (combat, gathering, crafting, etc.) live in agentBehaviors.ts.
 * Trigger detection lives in agentTriggers.ts.
 * Survival logic (HP, repair, self-adaptation) lives in agentSurvival.ts.
 */

import {
  getAgentConfig,
  getAgentCustodialWallet,
  getAgentEntityRef,
  setAgentEntityRef,
  patchAgentConfig,
  appendChatMessage,
  getChatHistory,
  type AgentFocus,
  type AgentStrategy,
} from "./agentConfigStore.js";
import { peekInbox, ackInboxMessages } from "./agentInbox.js";
import { exportCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import { authenticateWithWallet, createAuthenticatedAPI } from "../auth/authHelper.js";
import { ZONE_LEVEL_REQUIREMENTS, getZoneConnections, resolveRegionId } from "../world/worldLayout.js";
import { getEntity as getWorldEntity, getEntitiesInRegion, isWalletSpawned, unregisterSpawnedWallet } from "../world/zoneRuntime.js";
import { getRecentZoneEvents, type ZoneEvent } from "../world/zoneEvents.js";
import { runSupervisor } from "./agentSupervisor.js";
import { TIER_CAPABILITIES, type TierCapabilities } from "./agentTiers.js";
import { type BotScript, type TriggerEvent } from "../types/botScriptTypes.js";

// Extracted modules
import { sleep, fetchWalletBalance, issueAgentCommand, type ApiCaller, type AgentContext } from "./agentUtils.js";
import { detectTrigger, type TriggerState } from "./agentTriggers.js";
import { handleLowHp, needsRepair, checkSelfAdaptation } from "./agentSurvival.js";
import * as behaviors from "./agentBehaviors.js";
import { emitAgentChat, getAgentOrigin, maybeReactToChat } from "./agentDialogue.js";

const TICK_MS = 1200;
/** Safety-net: call supervisor if no trigger has fired in about 30s. */
const MAX_STALE_TICKS = Math.ceil(30_000 / TICK_MS);
const MOVE_REISSUE_MS = 4_000;
const MOVE_PROGRESS_EPSILON = 4;
const SUPERVISOR_EVENT_TYPES: ZoneEvent["type"][] = ["combat", "death", "kill", "levelup", "quest", "loot", "technique"];

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
  commands: {
    total: number;
    move: number;
    attack: number;
    travel: number;
    failed: number;
    lastAt: number | null;
  };
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
    case "idle":       return "Rest. Only act if something urgent happens.";
    default:           return "Be autonomous — quest and improve your character.";
  }
}

/** Convert config focus -> initial BotScript when supervisor is unavailable. */
function focusToScript(focus: AgentFocus, strategy: AgentStrategy, targetZone?: string): BotScript {
  const levelOffset = strategy === "aggressive" ? 5 : strategy === "defensive" ? 0 : 2;
  switch (focus) {
    case "questing":   return { type: "quest",   reason: "User focus: questing" };
    case "combat":     return { type: "combat",  maxLevelOffset: levelOffset, reason: "User focus: combat" };
    case "gathering":  return { type: "gather",  nodeType: "both", reason: "User focus: gathering" };
    case "crafting":   return { type: "craft",   reason: "User focus: crafting" };
    case "alchemy":    return { type: "brew",    reason: "User focus: alchemy" };
    case "cooking":    return { type: "cook",    reason: "User focus: cooking" };
    case "enchanting": return { type: "combat",  maxLevelOffset: levelOffset, reason: "Enchanting — need to farm XP first" };
    case "shopping":
    case "trading":    return { type: "shop",    reason: "User focus: shopping" };
    case "traveling":  return { type: "travel",  targetZone, reason: "User focus: traveling" };
    case "goto":       return { type: "goto",    reason: "User clicked an NPC" };
    case "learning":   return { type: "learn",   reason: "User focus: learn techniques" };
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
  private moveToStaleCount = 0;
  private moveToLastTarget = "";
  private moveToLastDistance = Number.POSITIVE_INFINITY;
  private moveToLastCommandAt = 0;
  private moveToLastLogAt = 0;
  private telemetry = {
    loop: { count: 0, avgMs: 0, maxMs: 0, lastMs: 0 },
    walletBalance: { count: 0, avgMs: 0, maxMs: 0, lastMs: 0 },
    supervisor: { count: 0, avgMs: 0, maxMs: 0, lastMs: 0, errors: 0 },
    commands: { total: 0, move: 0, attack: 0, travel: 0, failed: 0, lastAt: null as number | null },
    triggers: {} as Record<string, number>,
    lastLoopAt: null as number | null,
  };

  constructor(userWallet: string) {
    this.userWallet = userWallet;
    this.walletTag = userWallet.slice(0, 8);
  }

  // ── Public API (called from chat routes / manager) ─────────────────────────

  public clearScript(): void {
    this.currentScript = null;
    this.ticksSinceLastDecision = MAX_STALE_TICKS;
  }

  public setGotoTarget(entityId: string, zoneId: string, name?: string, action?: string, profession?: string): void {
    const reason = action === "learn-profession" && profession
      ? `User: learn ${profession} from ${name ?? entityId}`
      : `User directed agent to ${name ?? entityId}`;
    this.currentScript = { type: "goto", targetEntityId: entityId, targetName: name, reason };
    this.ticksSinceLastDecision = 0;
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
      running: this.running,
      telemetry: this.getTelemetrySnapshot(),
    };
  }

  // ── Public actions (called from chat tool handlers) ────────────────────────

  async learnProfession(professionId: string): Promise<boolean> {
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
      return false;
    }
  }

  async learnNextTechnique(): Promise<{ ok: boolean; reason: string }> {
    if (!this.api || !this.entityId || !this.custodialWallet) {
      return { ok: false, reason: "agent not fully initialized" };
    }
    if (Date.now() < this.nextTechniqueCheckAt) {
      return { ok: false, reason: "on cooldown, try again shortly" };
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
        return { ok: false, reason: `failed to learn ${nextToLearn.name ?? nextToLearn.id}: ${learnErr.message?.slice(0, 80) ?? "unknown error"}` };
      }
    } catch (err: any) {
      console.debug(`[agent] learnNextTechnique: ${err.message?.slice(0, 60)}`);
      return { ok: false, reason: `error: ${err.message?.slice(0, 80) ?? "unknown"}` };
    }
  }

  async buyItem(tokenId: number): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      await this.api("POST", "/shop/buy", { buyerAddress: this.custodialWallet, tokenId, quantity: 1 });
      console.log(`[agent:${this.walletTag}] Bought tokenId=${tokenId}`);
      void this.logActivity(`Bought item (token #${tokenId})`);
      return true;
    } catch (err: any) {
      console.debug(`[agent] buyItem(${tokenId}): ${err.message?.slice(0, 60)}`);
      return false;
    }
  }

  async equipItem(tokenId: number): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      await this.api("POST", "/equipment/equip", {
        zoneId: this.currentRegion, tokenId,
        entityId: this.entityId, walletAddress: this.custodialWallet,
      });
      console.log(`[agent:${this.walletTag}] Equipped tokenId=${tokenId}`);
      void this.logActivity(`Equipped item (token #${tokenId})`);
      return true;
    } catch (err: any) {
      console.debug(`[agent] equipItem(${tokenId}): ${err.message?.slice(0, 60)}`);
      return false;
    }
  }

  async repairGear(): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      const zs = await this.getZoneState();
      if (!zs) return false;
      const { entities, me } = zs;

      const hasDamaged = Object.values(me.equipment ?? {}).some(
        (eq: any) => eq && eq.maxDurability > 0 && eq.durability < eq.maxDurability,
      );
      if (!hasDamaged) return false;

      const smith = this.findNearestEntity(entities, me,
        (e) => e.type === "merchant" && /blacksmith/i.test(e.name),
      );
      if (!smith) return false;

      const [smithId, smithEntity] = smith;
      const moving = await this.moveToEntity(me, smithEntity);
      if (moving) return true;

      const result = await this.api("POST", "/equipment/repair", {
        zoneId: this.currentRegion, npcId: smithId,
        entityId: this.entityId, walletAddress: this.custodialWallet,
      });
      if (result?.ok) {
        const repaired = result.repairs?.map((r: any) => r.name).join(", ") ?? "gear";
        console.log(`[agent:${this.walletTag}] Repaired ${repaired} (cost: ${result.totalCost}g)`);
        void this.logActivity(`Repaired ${repaired} (${result.totalCost}g)`);
      }
      return true;
    } catch (err: any) {
      console.debug(`[agent] repairGear: ${err.message?.slice(0, 60)}`);
      return false;
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

  private updateTimingMetric(metric: TimingMetric, durationMs: number): void {
    metric.count += 1;
    metric.lastMs = durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
    metric.avgMs += (durationMs - metric.avgMs) / metric.count;
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
      commands: { ...this.telemetry.commands },
      triggers: { ...this.telemetry.triggers },
      lastLoopAt: this.telemetry.lastLoopAt,
    };
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

  private issueCommand(
    command:
      | { action: "move"; x: number; y: number }
      | { action: "attack"; targetId: string }
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
      .filter((event) => ["death", "kill", "levelup", "quest", "loot"].includes(event.type))
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
        if (latest.type === "kill" && latest.entityId === this.entityId) {
          emitAgentChat({ ...dCtx, event: "kill", detail: latest.targetName });
        } else if (latest.type === "quest") {
          emitAgentChat({ ...dCtx, event: "quest_complete", detail: latest.message });
        }

        // Check if we barely survived (low HP after a fight)
        if (latest.type === "kill" && entity.hp > 0 && entity.hp < entity.maxHp * 0.25) {
          emitAgentChat({ ...dCtx, event: "low_hp_survive" });
        }
      }
    }

    if (latest.type === "levelup") {
      return { type: "level_up", detail: latest.message };
    }
    if (latest.type === "death") {
      return { type: "stuck", detail: `Recent death: ${latest.message}` };
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

  private findNextZoneForLevel(level: number): string | null {
    const allowed = this.currentCaps.allowedZones;
    const zonesByLevel = Object.entries(ZONE_LEVEL_REQUIREMENTS)
      .filter(([zone]) => allowed === "all" || allowed.includes(zone))
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
      logActivity: (text) => { void self.logActivity(text); },
      setEntityGotoMode: (on) => self.setEntityGotoMode(on),
      getWalletBalance: () => self.getWalletBalance(),
      setScript: (s) => { self.currentScript = s; self.ticksOnCurrentScript = 0; },
      get currentScript() { return self.currentScript; },
      buyItem: (id) => self.buyItem(id),
      equipItem: (id) => self.equipItem(id),
      learnProfession: (id) => self.learnProfession(id),
    };
  }

  // ── Script execution ───────────────────────────────────────────────────────

  private async executeCurrentScript(entity: any, entities: Record<string, any>, strategy: AgentStrategy): Promise<void> {
    const script = this.currentScript;
    if (!script) return;

    const ctx = this.buildContext();
    if (!ctx) return;

    switch (script.type) {
      case "combat":  await behaviors.doCombat(ctx, strategy, () => this.learnNextTechnique()); break;
      case "gather":  await behaviors.doGathering(ctx, strategy); break;
      case "travel":  await behaviors.doTravel(ctx, strategy); break;
      case "goto":    await behaviors.doGotoNpc(ctx, (n, t) => this.findNextZoneOnPath(n, t)); break;
      case "shop":    await behaviors.doShopping(ctx, strategy); break;
      case "craft":   await behaviors.doCrafting(ctx, strategy); break;
      case "brew":    await behaviors.doAlchemy(ctx, strategy); break;
      case "cook":    await behaviors.doCooking(ctx, strategy); break;
      case "quest":   await behaviors.doQuesting(ctx, strategy, (l) => this.findNextZoneForLevel(l)); break;
      case "learn":   await this.learnNextTechnique(); break;
      case "idle":    break;
    }
  }

  // ── Decision engine ────────────────────────────────────────────────────────

  private async decideAndAct(
    entity: any,
    entities: Record<string, any>,
    config: { focus: AgentFocus; strategy: AgentStrategy; targetZone?: string },
    strategy: AgentStrategy,
  ): Promise<void> {
    const triggerState: TriggerState = {
      currentScript: this.currentScript,
      ticksSinceLastDecision: this.ticksSinceLastDecision,
      ticksOnCurrentScript: this.ticksOnCurrentScript,
      lastKnownLevel: this.lastKnownLevel,
      lastKnownZone: this.lastKnownZone,
      currentRegion: this.currentRegion,
      maxStaleTicks: MAX_STALE_TICKS,
    };

    // Increment counters before detection (detectTrigger is now pure)
    this.ticksSinceLastDecision++;
    this.ticksOnCurrentScript++;

    const trigger = this.detectZoneEventTrigger(this.cachedZoneState?.recentEvents ?? [])
      ?? detectTrigger(entity, entities, triggerState);

    if (trigger) {
      this.telemetry.triggers[trigger.type] = (this.telemetry.triggers[trigger.type] ?? 0) + 1;
      this.ticksSinceLastDecision = 0;
      this.lastKnownLevel = entity.level ?? 1;
      this.lastKnownZone = this.currentRegion;
      this.lastTrigger = trigger;
      console.log(`[agent:${this.walletTag}] Trigger [${trigger.type}]: ${trigger.detail}`);

      // Include the user's actual latest chat message so the supervisor/script honors directives
      let userDirective = focusToDirective(config.focus, config.targetZone);
      try {
        const recentChat = await getChatHistory(this.userWallet, 5);
        const lastUserMsg = [...recentChat].reverse().find((m) => m.role === "user");
        if (lastUserMsg && Date.now() - lastUserMsg.ts < 120_000) {
          userDirective = `User said: "${lastUserMsg.text}" — ${userDirective}`;
        }
      } catch { /* non-fatal */ }

      if (trigger.type === "no_script") {
        // Always respect the user's configured focus — never override with hardcoded behavior
        this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
        this.ticksOnCurrentScript = 0;
        void this.logActivity(`[AI] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
      } else if (trigger.type === "level_up") {
        const lvl = entity.level ?? 1;
        const bestZone = this.findNextZoneForLevel(lvl);
        if (bestZone && bestZone !== this.currentRegion
          && lvl >= (ZONE_LEVEL_REQUIREMENTS[bestZone] ?? 1)
          && lvl < (ZONE_LEVEL_REQUIREMENTS[bestZone] ?? 1) + 2) {
          console.log(`[agent:${this.walletTag}] Level ${lvl} unlocked ${bestZone}, heading there`);
          void this.logActivity(`Level ${lvl}! New zone unlocked — heading to ${bestZone}`);
          await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: bestZone });
          this.currentScript = { type: "travel", targetZone: bestZone, reason: `Level ${lvl} unlocked ${bestZone}` };
          this.ticksOnCurrentScript = 0;
        } else {
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
          this.ticksOnCurrentScript = 0;
          void this.logActivity(`Level ${lvl}! Continuing ${config.focus}`);
        }
      } else if (trigger.type === "no_targets") {
        const lvl = entity.level ?? 1;
        const allowed = this.currentCaps.allowedZones;
        const accessibleNeighbors = getZoneConnections(this.currentRegion)
          .filter((z) => lvl >= (ZONE_LEVEL_REQUIREMENTS[z] ?? 1))
          .filter((z) => allowed === "all" || allowed.includes(z));
        if (accessibleNeighbors.length > 0) {
          const pick = accessibleNeighbors[Math.floor(Math.random() * accessibleNeighbors.length)];
          console.log(`[agent:${this.walletTag}] No targets in ${this.currentRegion}, moving to ${pick}`);
          void this.logActivity(`Zone cleared — exploring ${pick}`);
          await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: pick });
          this.currentScript = { type: "travel", targetZone: pick, reason: "Zone cleared" };
          this.ticksOnCurrentScript = 0;
        } else {
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
          this.ticksOnCurrentScript = 0;
        }
      } else if (!this.currentCaps.supervisorEnabled) {
        this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
        this.ticksOnCurrentScript = 0;
        void this.logActivity(`[script] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
      } else {
        const supervisorStartedAt = performance.now();
        try {
          const { copper: walletGoldCopper } = await this.getWalletBalance();
          const newScript = await runSupervisor(trigger, {
            entity, entities,
            entityId: this.entityId!,
            currentRegion: this.currentRegion,
            custodialWallet: this.custodialWallet!,
            currentScript: this.currentScript,
            recentActivities: this.recentActivities,
            recentZoneEvents: this.cachedZoneState?.recentEvents ?? [],
            userDirective,
            apiCall: this.api!,
            walletGoldCopper,
          });
          this.updateTimingMetric(this.telemetry.supervisor, performance.now() - supervisorStartedAt);
          this.currentScript = newScript;
          this.ticksOnCurrentScript = 0;
          void this.logActivity(`[AI] ${newScript.type}: ${newScript.reason ?? ""}`);
        } catch (err: any) {
          this.updateTimingMetric(this.telemetry.supervisor, performance.now() - supervisorStartedAt);
          this.telemetry.supervisor.errors += 1;
          console.warn(`[agent:${this.walletTag}] Supervisor failed: ${err.message?.slice(0, 60)}`);
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
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
      } else if (trigger.type === "stuck" && trigger.detail?.includes("death")) {
        emitAgentChat({ ...dCtx, event: "death" });
      }
    }

    await this.executeCurrentScript(entity, entities, strategy);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(waitForFirstTick = false): Promise<void> {
    this.running = true;
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
    console.log(`[agent:${this.walletTag}] Loop stopped`);
  }

  private async ensureAuth(): Promise<boolean> {
    if (this.jwt && Date.now() < this.jwtExpiry - 3_600_000) return true;

    const custodial = await getAgentCustodialWallet(this.userWallet);
    if (!custodial) return false;
    this.custodialWallet = custodial;

    try {
      const privateKey = await exportCustodialWallet(custodial);
      this.jwt = await authenticateWithWallet(privateKey);
      this.api = createAuthenticatedAPI(this.jwt);
      this.jwtExpiry = Date.now() + 23 * 3_600_000;
      console.log(`[agent:${this.walletTag}] Authenticated`);
      return true;
    } catch (err: any) {
      console.warn(`[agent:${this.walletTag}] Auth failed: ${err.message?.slice(0, 60)}`);
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
      await setAgentEntityRef(this.userWallet, { entityId: this.entityId, zoneId: newRegion, characterName: ref.characterName });
      return true;
    }

    try {
      const state = await this.api("GET", `/zones/${this.currentRegion}`);
      if (state?.entities?.[this.entityId]) return true;
    } catch (err: any) {
      console.debug(`[agent:${this.walletTag}] zone check: ${err.message?.slice(0, 60)}`);
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
        });
        if (spawnResult?.spawned?.id) {
          const newEntityId: string = spawnResult.spawned.id;
          this.entityId = newEntityId;
          const spawnZone: string = spawnResult.zone || this.currentRegion || "village-square";
          this.currentRegion = spawnZone;
          await setAgentEntityRef(this.userWallet, { entityId: newEntityId, zoneId: spawnZone, characterName: ref.characterName });
          console.log(`[agent:${this.walletTag}] Respawned entity ${this.entityId} in ${spawnZone}`);
          return true;
        }
      } catch (err: any) {
        console.warn(`[agent:${this.walletTag}] Respawn failed: ${err.message?.slice(0, 80)}`);
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
      try {
        this.cachedZoneState = null;

        const config = await getAgentConfig(this.userWallet);
        if (!config?.enabled) {
          if (!firstTickDone) onFirstTickFail(new Error("Agent config disabled"));
          this.running = false;
          break;
        }

        this.currentCaps = TIER_CAPABILITIES[config.tier ?? "free"];

        // Session timeout
        if (this.currentCaps.sessionLimitMs != null && config.sessionStartedAt) {
          if (Date.now() - config.sessionStartedAt >= this.currentCaps.sessionLimitMs) {
            const hours = Math.round(this.currentCaps.sessionLimitMs / 3600_000);
            console.log(`[agent:${this.walletTag}] Session limit reached (${hours}h) — stopping`);
            void this.logActivity(`Session limit reached (${hours}h) — upgrade tier for longer sessions`);
            await patchAgentConfig(this.userWallet, { enabled: false });
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

        // Suppress auto-combat for non-combat focuses
        const suppressCombat = focus !== "combat" && focus !== "questing";
        this.setEntityGotoMode(suppressCombat);

        // Track zone-stay duration
        if (this.currentRegion !== this.lastKnownZone && this.lastKnownZone !== "") {
          this.ticksInCurrentZone = 0;
        }
        this.ticksInCurrentZone++;

        // Inbox check every 5 ticks
        if (this.ticksSinceFocusChange % 5 === 0) {
          await this.processInbox();
        }

        // Chat reactions: check for other agents' chat and maybe respond
        if (this.entityId && this.ticksSinceFocusChange % 3 === 0) {
          const chatEvents = getRecentZoneEvents(this.currentRegion, Date.now() - 10_000, ["chat", "levelup", "death", "quest", "kill"]);
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

        // Survival: low HP handling
        const ctx = this.buildContext();
        if (ctx) {
          const usedPotion = await handleLowHp(ctx, entity, strategy);
          if (usedPotion) { await sleep(TICK_MS); continue; }
        }

        // Self-adaptation
        const allowAutoAdapt = this.currentCaps.selfAdaptationEnabled
          && (focus === "questing" || focus === "combat" || focus === "cooking" || focus === "shopping" || focus === "gathering" || focus === "crafting");
        if (allowAutoAdapt && this.ticksSinceFocusChange % 10 === 0 && this.ticksSinceFocusChange > 0 && ctx) {
          const adapted = await checkSelfAdaptation(ctx, entity, strategy, {
            currentFocus: focus,
            ticksSinceFocusChange: this.ticksSinceFocusChange,
            ticksInCurrentZone: this.ticksInCurrentZone,
            findNextZoneForLevel: (l) => this.findNextZoneForLevel(l),
          });
          if (adapted) { this.currentScript = null; await sleep(TICK_MS); continue; }
        }

        // Auto-repair
        if (needsRepair(entity)) {
          const repairing = await this.repairGear();
          if (repairing) { await sleep(TICK_MS); continue; }
        }

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

        await this.decideAndAct(entity, zs.entities, config, strategy);
      } catch (err: any) {
        console.warn(`[agent:${this.walletTag}] Loop error: ${err.message?.slice(0, 80)}`);
        if (!firstTickDone) {
          onFirstTickFail(err instanceof Error ? err : new Error(String(err.message ?? err)));
          this.running = false;
          return;
        }
      } finally {
        this.telemetry.lastLoopAt = Date.now();
        this.updateTimingMetric(this.telemetry.loop, performance.now() - loopStartedAt);
      }

      await sleep(TICK_MS);
    }

    console.log(`[agent:${this.walletTag}] Loop exited`);
  }
}
