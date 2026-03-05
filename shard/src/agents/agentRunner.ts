/**
 * AgentRunner — per-user AI agent loop
 * Reads config from Redis each tick and executes the configured focus behavior.
 */

import {
  getAgentConfig,
  getAgentCustodialWallet,
  getAgentEntityRef,
  setAgentEntityRef,
  patchAgentConfig,
  appendChatMessage,
  type AgentFocus,
  type AgentStrategy,
} from "./agentConfigStore.js";
import { peekInbox, ackInboxMessages, type InboxMessage } from "./agentInbox.js";
import { exportCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import { authenticateWithWallet, createAuthenticatedAPI } from "../auth/authHelper.js";
import { ZONE_LEVEL_REQUIREMENTS, getZoneConnections, resolveRegionId } from "../world/worldLayout.js";
import { getEntity as getWorldEntity } from "../world/zoneRuntime.js";
import { getRegionCenter } from "../world/worldLayout.js";
import { goldToCopper } from "../blockchain/currency.js";
import { runSupervisor } from "./agentSupervisor.js";
import { TIER_CAPABILITIES, type TierCapabilities } from "./agentTiers.js";
import { type BotScript, type TriggerEvent, type TriggerType } from "../types/botScriptTypes.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";

/** Safety-net: call supervisor if no trigger has fired in this many ticks (~60s). */
const MAX_STALE_TICKS = 120;

const API_URL = process.env.API_URL || "http://localhost:3000";
const TICK_MS = 1200;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type ApiCaller = ReturnType<typeof createAuthenticatedAPI>;

/** Convert config focus → natural-language directive for supervisor context. */
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
    case "idle":       return "Rest. Only act if something urgent happens.";
    default:           return "Be autonomous — quest and improve your character.";
  }
}

/** Convert config focus → initial BotScript when supervisor is unavailable. */
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
    case "idle":       return { type: "idle",    reason: "User focus: idle" };
    default:           return { type: "combat",  maxLevelOffset: levelOffset, reason: "Default" };
  }
}

export class AgentRunner {
  private userWallet: string;
  public running = false;
  private api: ApiCaller | null = null;
  private custodialWallet: string | null = null;
  private entityId: string | null = null;
  private currentRegion: string = "village-square";
  private jwtExpiry = 0;
  private jwt: string | null = null;
  /** Resolves once the first tick succeeds (or rejects if it fails). */
  private firstTickResult: Promise<void> | null = null;
  /** Tracks ticks since last focus change — used for self-adaptation */
  private ticksSinceFocusChange = 0;
  private lastFocus: AgentFocus = "questing";
  /** Tracks ticks spent in the current zone — used for roaming behavior */
  private ticksInCurrentZone = 0;
  /** Tracks consecutive combat fallback ticks */
  private combatFallbackCount = 0;
  /** Live description of what the agent is doing right now */
  public currentActivity = "Idle";
  /** Circular buffer of recent activity strings for supervisor context */
  public recentActivities: string[] = [];
  /** Current bot script being executed. Null = supervisor must decide. */
  private currentScript: BotScript | null = null;
  /** Expose current script for status endpoint */
  public get script(): BotScript | null { return this.currentScript; }
  /** Last trigger event that fired the supervisor */
  public lastTrigger: TriggerEvent | null = null;
  /** Expose current zone for dashboard */
  public get zone(): string { return this.currentRegion; }
  public get region(): string { return this.currentRegion; }
  /** Expose entity ID for dashboard */
  public get entity(): string | null { return this.entityId; }
  /** Expose wallet for dashboard */
  public get wallet(): string { return this.userWallet; }
  /** Expose custodial wallet for dashboard */
  public get custodial(): string | null { return this.custodialWallet; }
  /** Force re-evaluation on next tick (called when user manually changes config) */
  public clearScript(): void {
    this.currentScript = null;
    this.ticksSinceLastDecision = MAX_STALE_TICKS;
  }
  /** Immediately direct the agent to walk to a specific NPC (called from goto-npc route) */
  public setGotoTarget(entityId: string, zoneId: string, name?: string, action?: string, profession?: string): void {
    const reason = action === "learn-profession" && profession
      ? `User: learn ${profession} from ${name ?? entityId}`
      : `User directed agent to ${name ?? entityId}`;
    this.currentScript = { type: "goto", targetEntityId: entityId, targetName: name, reason };
    this.ticksSinceLastDecision = 0;
  }
  /** Ticks since the last supervisor call (for MAX_STALE_TICKS safety net) */
  private ticksSinceLastDecision = 0;
  /** Cached zone state for current tick — cleared each iteration to avoid stale data */
  private cachedZoneState: { entities: Record<string, any>; me: any } | null = null;
  /** Tracks how many ticks the current script has been running without a supervisor call */
  private ticksOnCurrentScript = 0;
  /** Snapshot values used to detect meaningful game-state change events */
  private lastKnownLevel = 0;
  private lastKnownZone = "";
  /** Last processed inbox stream ID — only fetch messages newer than this */
  private lastInboxId = "0-0";

  /** Tier capabilities for the current tick — set once per loop iteration. */
  private currentCaps: TierCapabilities = TIER_CAPABILITIES["free"];

  /** Cooldown: don't attempt technique learning before this timestamp (ms). */
  private nextTechniqueCheckAt = 0;
  /** Techniques that failed to learn this session — skip them permanently. */
  private failedTechniqueIds = new Set<string>();

  constructor(userWallet: string) {
    this.userWallet = userWallet;
  }

  /** Dashboard snapshot — lightweight summary of this agent's state. */
  public getSnapshot(): {
    wallet: string;
    zone: string;
    entityId: string | null;
    custodialWallet: string | null;
    currentActivity: string;
    recentActivities: string[];
    script: { type: string; reason: string | null } | null;
    lastTrigger: { type: string; detail: string } | null;
    running: boolean;
  } {
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
    };
  }

  /** Log an activity message to the agent's chat history (visible to spectators). */
  private async logActivity(text: string): Promise<void> {
    this.currentActivity = text;
    this.recentActivities = [...this.recentActivities, text].slice(-8);
    try {
      await appendChatMessage(this.userWallet, { role: "activity", text, ts: Date.now() });
    } catch (err: any) {
      console.debug(`[agent:${this.userWallet.slice(0, 8)}] logActivity: ${err.message?.slice(0, 60)}`);
    }
  }

  /**
   * Check inbox for new agent-to-agent messages and log them as activities.
   * Automatically acknowledges processed messages so they don't repeat.
   */
  private async processInbox(): Promise<void> {
    try {
      const messages = await peekInbox(this.userWallet, 5);
      // Filter to only messages newer than our last-seen ID
      const newMessages = messages.filter((m) => m.id > this.lastInboxId);
      if (newMessages.length === 0) return;

      const idsToAck: string[] = [];
      for (const msg of newMessages) {
        const label = msg.type === "broadcast" ? "BROADCAST" : "MSG";
        void this.logActivity(`[${label}] ${msg.fromName}: ${msg.body.slice(0, 120)}`);
        idsToAck.push(msg.id);
        if (msg.id > this.lastInboxId) this.lastInboxId = msg.id;
      }

      // Ack so messages don't pile up
      if (idsToAck.length > 0) {
        await ackInboxMessages(this.userWallet, idsToAck);
      }
    } catch (err: any) {
      // Non-fatal — inbox is best-effort
      console.debug(`[agent:${this.userWallet.slice(0, 8)}] Inbox check failed: ${err.message?.slice(0, 60)}`);
    }
  }

  /**
   * Start the agent loop.
   * If `waitForFirstTick` is true (default for deploys), waits until the agent
   * completes one successful tick before resolving — or throws if it fails.
   */
  async start(waitForFirstTick = false): Promise<void> {
    this.running = true;
    console.log(`[agent:${this.userWallet.slice(0, 8)}] Loop starting`);

    let resolveFirst: () => void;
    let rejectFirst: (err: Error) => void;
    this.firstTickResult = new Promise<void>((res, rej) => {
      resolveFirst = res;
      rejectFirst = rej;
    });

    // If not waiting, swallow first-tick rejections so they don't become
    // unhandled promise rejections (boot restores are best-effort).
    if (!waitForFirstTick) {
      this.firstTickResult.catch((err) => {
        console.warn(`[agent:${this.userWallet.slice(0, 8)}] First tick failed (non-blocking): ${err.message}`);
      });
    }

    void this.loop(resolveFirst!, rejectFirst!);

    if (waitForFirstTick) {
      await this.firstTickResult;
    }
  }

  stop(): void {
    this.running = false;
    console.log(`[agent:${this.userWallet.slice(0, 8)}] Loop stopped`);
  }

  private async ensureAuth(): Promise<boolean> {
    // Refresh JWT 1h before expiry
    if (this.jwt && Date.now() < this.jwtExpiry - 3_600_000) return true;

    const custodial = await getAgentCustodialWallet(this.userWallet);
    if (!custodial) return false;
    this.custodialWallet = custodial;

    try {
      const privateKey = await exportCustodialWallet(custodial);
      this.jwt = await authenticateWithWallet(privateKey);
      this.api = createAuthenticatedAPI(this.jwt);
      // JWT expires in 24h — store expiry
      this.jwtExpiry = Date.now() + 23 * 3_600_000;
      console.log(`[agent:${this.userWallet.slice(0, 8)}] Authenticated`);
      return true;
    } catch (err: any) {
      console.warn(`[agent:${this.userWallet.slice(0, 8)}] Auth failed: ${err.message?.slice(0, 60)}`);
      return false;
    }
  }

  private async ensureEntity(): Promise<boolean> {
    const ref = await getAgentEntityRef(this.userWallet);
    if (!ref || !this.api) return false;

    this.entityId = ref.entityId;
    this.currentRegion = ref.zoneId;

    // In unified world, look up entity directly from memory
    const worldEntity = getWorldEntity(this.entityId);
    if (worldEntity) {
      const newRegion = worldEntity.region ?? this.currentRegion;
      if (newRegion !== this.currentRegion) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Region changed: ${this.currentRegion} → ${newRegion}`);
        void this.logActivity(`Region transition: ${this.currentRegion} → ${newRegion}`);
      }
      this.currentRegion = newRegion;
      await setAgentEntityRef(this.userWallet, { entityId: this.entityId, zoneId: newRegion });
      return true;
    }

    // Fallback: try API check (entity may have been respawned with new ID)
    try {
      const state = await this.api("GET", `/zones/${this.currentRegion}`);
      if (state?.entities?.[this.entityId]) return true;
    } catch (err: any) {
      console.debug(`[agent:${this.userWallet.slice(0, 8)}] zone check: ${err.message?.slice(0, 60)}`);
    }

    return false;
  }

  private async getEntityState(): Promise<any | null> {
    if (!this.entityId) return null;
    // Direct memory lookup in unified world
    const entity = getWorldEntity(this.entityId);
    if (entity) {
      if (entity.region && entity.region !== this.currentRegion) {
        this.currentRegion = entity.region;
      }
      return entity;
    }
    // Fallback to API
    if (!this.api) return null;
    try {
      const state = await this.api("GET", `/zones/${this.currentRegion}`);
      return state?.entities?.[this.entityId] ?? null;
    } catch (err: any) {
      console.debug(`[agent:${this.userWallet.slice(0, 8)}] getEntityState: ${err.message?.slice(0, 60)}`);
      return null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async getZoneState(): Promise<{ entities: Record<string, any>; me: any } | null> {
    if (this.cachedZoneState) return this.cachedZoneState;
    if (!this.api || !this.entityId) return null;
    const state = await this.api("GET", `/zones/${this.currentRegion}`);
    const entities = state?.entities ?? {};
    const me = entities[this.entityId];
    if (!me) return null;
    this.cachedZoneState = { entities, me };
    return this.cachedZoneState;
  }

  private findNearestEntity(entities: Record<string, any>, me: any, typePredicate: (e: any) => boolean): [string, any] | null {
    const matches = Object.entries(entities)
      .filter(([id, e]) => id !== this.entityId && typePredicate(e))
      .sort(([, a], [, b]) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    return matches[0] as [string, any] ?? null;
  }

  /** Set/clear gotoMode flag on the entity to suppress auto-combat while navigating */
  private setEntityGotoMode(on: boolean): void {
    if (!this.entityId) return;
    const entity = getWorldEntity(this.entityId);
    if (entity) entity.gotoMode = on;
  }

  /** Tracks consecutive move-to-entity ticks for stale walk detection */
  private moveToStaleCount = 0;
  private moveToLastTarget = "";

  private async moveToEntity(me: any, target: any, closeEnoughDist = 35): Promise<boolean> {
    if (!this.api || !this.entityId) return false;
    const dist = Math.hypot(target.x - me.x, target.y - me.y);
    const targetKey = `${Math.round(target.x)},${Math.round(target.y)}`;

    // Track stale walks — if we've been walking to the same target for 5+ ticks, give up
    if (targetKey === this.moveToLastTarget) {
      this.moveToStaleCount++;
    } else {
      this.moveToStaleCount = 0;
      this.moveToLastTarget = targetKey;
    }
    if (this.moveToStaleCount >= 5) {
      console.log(`[agent:${this.userWallet.slice(0, 8)}] Stale walk detected (${this.moveToStaleCount} ticks), forcing arrival`);
      this.moveToStaleCount = 0;
      return false; // force "close enough" to unblock the action
    }

    if (dist > closeEnoughDist) {
      void this.logActivity(`Walking to ${target.name ?? "target"} (${Math.round(dist)} away)`);
      await this.api("POST", "/command", {
        zoneId: this.currentRegion, entityId: this.entityId, action: "move",
        x: target.x, y: target.y,
      });
      return true; // still moving
    }
    this.moveToStaleCount = 0;
    return false; // close enough
  }

  /**
   * Learn a profession from a trainer NPC if not already known.
   * Returns true if learning happened (or already known).
   */
  async learnProfession(professionId: string): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      // Check if already learned
      const profRes = await this.api("GET", `/professions/${this.custodialWallet}`);
      const learned: string[] = profRes?.professions ?? [];
      if (learned.includes(professionId)) return true;

      // Find the trainer for this profession
      const zs = await this.getZoneState();
      if (!zs) return false;

      const trainer = this.findNearestEntity(zs.entities, zs.me,
        (e) => e.type === "profession-trainer" && e.teachesProfession === professionId
      );
      if (!trainer) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] No ${professionId} trainer in ${this.currentRegion}`);
        return false;
      }

      // Move to trainer if needed
      const moving = await this.moveToEntity(zs.me, trainer[1]);
      if (moving) return false; // still walking

      // Learn
      await this.api("POST", "/professions/learn", {
        walletAddress: this.custodialWallet,
        zoneId: this.currentRegion,
        entityId: this.entityId,
        trainerId: trainer[0],
        professionId,
      });
      console.log(`[agent:${this.userWallet.slice(0, 8)}] Learned ${professionId}`);
      void this.logActivity(`Learned profession: ${professionId}`);
      return true;
    } catch (err: any) {
      console.debug(`[agent] learnProfession(${professionId}): ${err.message?.slice(0, 60)}`);
      return false;
    }
  }

  /**
   * Learn one available class technique from the matching class trainer.
   * Returns true when the agent is busy training (moving or learning).
   */
  /**
   * Learn one available class technique from the matching class trainer.
   * Returns { ok, reason } — reason explains why it failed when ok=false.
   */
  async learnNextTechnique(): Promise<{ ok: boolean; reason: string }> {
    if (!this.api || !this.entityId || !this.custodialWallet) {
      return { ok: false, reason: "agent not fully initialized" };
    }

    // Rate-limit: don't spam the trainer every tick
    if (Date.now() < this.nextTechniqueCheckAt) {
      return { ok: false, reason: "on cooldown, try again shortly" };
    }

    try {
      const zs = await this.getZoneState();
      if (!zs) return { ok: false, reason: "could not read zone state" };
      const { entities, me } = zs;
      const classId = (me.classId ?? "").toLowerCase();
      if (!classId) {
        console.warn(`[agent] learnNextTechnique: entity ${this.entityId} has no classId`);
        return { ok: false, reason: "my character has no class set — something went wrong during creation" };
      }

      const availableRes = await this.api("GET", `/techniques/available/${this.entityId}`);
      const available: Array<{ id: string; name?: string; isLearned?: boolean; copperCost?: number }> = availableRes?.techniques ?? [];

      // Skip already-learned and permanently-failed techniques
      const nextToLearn = available.find((t) => !t.isLearned && !this.failedTechniqueIds.has(t.id));
      if (!nextToLearn) {
        const allLearned = available.length > 0 && available.every((t) => t.isLearned);
        if (allLearned) return { ok: false, reason: "I've already learned all techniques available at my level" };
        if (available.length === 0) return { ok: false, reason: `no ${classId} techniques exist for my level (L${me.level ?? 1})` };
        return { ok: false, reason: "all remaining techniques have been blacklisted due to previous failures" };
      }

      // Affordability check — don't walk to trainer if we can't pay
      const cost = nextToLearn.copperCost ?? 0;
      if (cost > 0) {
        let copperBalance = 0;
        try {
          const inv = await this.api("GET", `/wallet/${this.custodialWallet}/balance`);
          const walletCopper = Number(inv?.copper ?? NaN);
          const walletGold = Number(inv?.gold ?? 0);
          copperBalance = Number.isFinite(walletCopper) ? walletCopper : goldToCopper(walletGold);
        } catch { /* treat as 0 if balance fetch fails */ }

        if (copperBalance < cost) {
          // Can't afford — back off for 2 minutes before checking again
          this.nextTechniqueCheckAt = Date.now() + 120_000;
          console.debug(`[agent] learnNextTechnique: can't afford ${cost}c (have ${copperBalance}c) — cooling down 2m`);
          return { ok: false, reason: `I need ${cost} copper to learn ${nextToLearn.name ?? nextToLearn.id} but only have ${copperBalance} copper — need to earn more gold first` };
        }
      }

      const trainer = this.findNearestEntity(
        entities,
        me,
        (e) => {
          if (e.type !== "trainer") return false;
          const teachesClass = (e.teachesClass ?? "").toLowerCase();
          if (teachesClass) return teachesClass === classId;
          return new RegExp(`${classId}\\s+trainer`, "i").test(String(e.name ?? ""));
        },
      );
      if (!trainer) {
        return { ok: false, reason: `no ${classId} trainer found in ${this.currentRegion} — I may need to travel to a zone with one` };
      }

      const moving = await this.moveToEntity(me, trainer[1]);
      if (moving) return { ok: true, reason: `heading to ${trainer[1].name ?? "trainer"} to learn ${nextToLearn.name ?? nextToLearn.id}` };

      try {
        await this.api("POST", "/techniques/learn", {
          zoneId: this.currentRegion,
          playerEntityId: this.entityId,
          techniqueId: nextToLearn.id,
          trainerEntityId: trainer[0],
        });
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Learned technique ${nextToLearn.id}`);
        void this.logActivity(`Learned technique: ${nextToLearn.name ?? nextToLearn.id}`);
        // Wait 30s before trying to learn the next one — let the agent actually fight
        this.nextTechniqueCheckAt = Date.now() + 30_000;
        return { ok: true, reason: `learned ${nextToLearn.name ?? nextToLearn.id}!` };
      } catch (learnErr: any) {
        const msg = String(learnErr.message ?? "").toLowerCase();
        // Only permanently blacklist on definitive failures (wrong class, already learned)
        const isDefinitive = msg.includes("wrong class") || msg.includes("already learned")
          || msg.includes("cannot teach") || msg.includes("not a player");
        if (isDefinitive) {
          this.failedTechniqueIds.add(nextToLearn.id);
          this.nextTechniqueCheckAt = Date.now() + 300_000; // 5-min cooldown
        } else {
          // Transient failure (too far, not enough gold, etc.) — retry after 30s
          this.nextTechniqueCheckAt = Date.now() + 30_000;
        }
        console.debug(`[agent] learnNextTechnique: failed (${learnErr.message?.slice(0, 60)}) — ${isDefinitive ? "skipping" : "will retry"}`);
        return { ok: false, reason: `failed to learn ${nextToLearn.name ?? nextToLearn.id}: ${learnErr.message?.slice(0, 80) ?? "unknown error"}` };
      }
    } catch (err: any) {
      console.debug(`[agent] learnNextTechnique: ${err.message?.slice(0, 60)}`);
      return { ok: false, reason: `error: ${err.message?.slice(0, 80) ?? "unknown"}` };
    }
  }

  // ── Public actions (called from chat routes) ────────────────────────────

  /**
   * Buy an item from the nearest merchant by tokenId.
   * Returns true if the purchase succeeded.
   */
  async buyItem(tokenId: number): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      await this.api("POST", "/shop/buy", {
        buyerAddress: this.custodialWallet,
        tokenId,
        quantity: 1,
      });
      console.log(`[agent:${this.userWallet.slice(0, 8)}] Bought tokenId=${tokenId}`);
      void this.logActivity(`Bought item (token #${tokenId})`);
      return true;
    } catch (err: any) {
      console.debug(`[agent] buyItem(${tokenId}): ${err.message?.slice(0, 60)}`);
      return false;
    }
  }

  /**
   * Equip an item the agent owns by tokenId.
   * Returns true if equipping succeeded.
   */
  async equipItem(tokenId: number): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      await this.api("POST", "/equipment/equip", {
        zoneId: this.currentRegion,
        tokenId,
        entityId: this.entityId,
        walletAddress: this.custodialWallet,
      });
      console.log(`[agent:${this.userWallet.slice(0, 8)}] Equipped tokenId=${tokenId}`);
      void this.logActivity(`Equipped item (token #${tokenId})`);
      return true;
    } catch (err: any) {
      console.debug(`[agent] equipItem(${tokenId}): ${err.message?.slice(0, 60)}`);
      return false;
    }
  }

  /**
   * Repair all damaged gear at the nearest blacksmith.
   * Returns true if a repair happened.
   */
  async repairGear(): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      const zs = await this.getZoneState();
      if (!zs) return false;
      const { entities, me } = zs;

      // Check if any gear is damaged
      const equipment = me.equipment ?? {};
      const hasDamaged = Object.values(equipment).some(
        (eq: any) => eq && eq.maxDurability > 0 && eq.durability < eq.maxDurability
      );
      if (!hasDamaged) return false;

      // Find nearest blacksmith (merchant with "blacksmith" in name)
      const smith = this.findNearestEntity(entities, me,
        (e) => e.type === "merchant" && /blacksmith/i.test(e.name)
      );
      if (!smith) {
        console.debug(`[agent:${this.userWallet.slice(0, 8)}] No blacksmith in ${this.currentRegion}`);
        return false;
      }

      const [smithId, smithEntity] = smith;

      // Move to blacksmith if not in range
      const moving = await this.moveToEntity(me, smithEntity);
      if (moving) return true; // still walking — count as "handled"

      // Repair all slots
      const result = await this.api("POST", "/equipment/repair", {
        zoneId: this.currentRegion,
        npcId: smithId,
        entityId: this.entityId,
        walletAddress: this.custodialWallet,
      });
      if (result?.ok) {
        const repaired = result.repairs?.map((r: any) => r.name).join(", ") ?? "gear";
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Repaired ${repaired} (cost: ${result.totalCost}g)`);
        void this.logActivity(`Repaired ${repaired} (${result.totalCost}g)`);
      }
      return true;
    } catch (err: any) {
      console.debug(`[agent] repairGear: ${err.message?.slice(0, 60)}`);
      return false;
    }
  }

  /**
   * Check if gear is badly damaged and needs repair before continuing.
   * Returns true if agent is busy repairing (caller should skip focus action).
   */
  private async handleRepair(entity: any): Promise<boolean> {
    const equipment = entity.equipment ?? {};
    for (const eq of Object.values(equipment)) {
      const e = eq as any;
      if (!e || e.maxDurability <= 0) continue;
      // Repair if any slot is broken or below 20% durability
      if (e.broken || e.durability / e.maxDurability < 0.2) {
        return await this.repairGear();
      }
    }
    return false;
  }

  // ── Explained fallback ────────────────────────────────────────────────────

  /**
   * Fall back to combat with a visible explanation so users know WHY
   * the agent switched away from their requested focus.
   */
  private async fallbackToCombat(reason: string, strategy: AgentStrategy): Promise<void> {
    void this.logActivity(`⚠ ${reason} — fighting to earn XP/gold`);
    // Switch the active script to combat so the agent stays in combat mode for multiple ticks,
    // rather than returning to the failing script next tick.
    this.currentScript = { type: "combat", maxLevelOffset: 1, reason: `Farming gold: ${reason}` };
    this.ticksOnCurrentScript = 0;
    await this.doCombat(strategy);
  }

  // ── Focus behaviours ──────────────────────────────────────────────────────

  private async doQuesting(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // 1. Check for completed quests and turn them in (walk to NPC first)
      const activeRes = await this.api("GET", `/quests/active/${this.entityId}`);
      const activeQuests: any[] = activeRes?.activeQuests ?? [];

      for (const aq of activeQuests) {
        if (aq.complete && aq.quest?.npcId) {
          // Find the quest-giver NPC to turn in
          const npcName = String(aq.quest?.npcId ?? "").toLowerCase();
          const npcEntry = Object.entries(entities).find(([, e]: [string, any]) => {
            if (!e || e.type !== "quest-giver") return false;
            return String(e.name ?? "").toLowerCase() === npcName;
          });
          if (npcEntry) {
            const [npcEntityId, npcEntity] = npcEntry;
            // Walk to the NPC first
            const moving = await this.moveToEntity(me, npcEntity);
            if (moving) {
              void this.logActivity(`Walking to ${aq.quest?.npcId} to turn in "${aq.quest?.title}"`);
              return; // still walking — continue next tick
            }
            try {
              const completeRes = await this.api("POST", "/quests/complete", {
                zoneId: this.currentRegion,
                playerId: this.entityId,
                questId: aq.questId,
                npcId: npcEntityId,
              });
              if (completeRes?.completed) {
                void this.logActivity(`Quest complete: "${aq.quest?.title}" +${completeRes.rewards?.xp ?? 0}XP +${completeRes.rewards?.copper ?? 0}c`);
                reputationManager.submitFeedback(this.userWallet, ReputationCategory.Agent, Math.max(1, Math.floor((completeRes.rewards?.xp ?? 50) / 50)), `Agent completed quest: ${aq.quest?.title ?? "unknown"}`);
                return; // one action per tick
              }
            } catch (err: any) {
              console.debug(`[agent:${this.userWallet.slice(0, 8)}] quest complete: ${err.message?.slice(0, 60)}`);
            }
          }
        }
      }

      // 2. Handle talk quests — walk to the specific NPC for talk objectives
      const talkQuests = activeQuests.filter(
        (aq: any) => !aq.complete && aq.quest?.objective?.type === "talk"
      );
      if (talkQuests.length > 0) {
        for (const tq of talkQuests) {
          const targetNpcName = String(tq.quest?.objective?.targetNpcName ?? tq.quest?.npcId ?? "").toLowerCase();
          const npcEntry = Object.entries(entities).find(([, e]: [string, any]) => {
            if (!e || e.type !== "quest-giver") return false;
            return String(e.name ?? "").toLowerCase() === targetNpcName;
          });
          if (npcEntry) {
            const [npcEntityId, npcEntity] = npcEntry;
            const moving = await this.moveToEntity(me, npcEntity);
            if (moving) {
              void this.logActivity(`Walking to ${targetNpcName} for talk quest`);
              return;
            }
            try {
              await this.api("POST", "/quests/talk", {
                zoneId: this.currentRegion,
                playerId: this.entityId,
                npcEntityId,
              });
              void this.logActivity(`Talked to ${targetNpcName} for "${tq.quest?.title}"`);
              return;
            } catch (err: any) {
              console.debug(`[agent:${this.userWallet.slice(0, 8)}] quest talk: ${err.message?.slice(0, 60)}`);
            }
          }
        }
        // Fallback: try all quest-givers for talk quests
        for (const [entityId, e] of Object.entries(entities)) {
          if ((e as any).type === "quest-giver") {
            try {
              await this.api("POST", "/quests/talk", {
                zoneId: this.currentRegion,
                playerId: this.entityId,
                npcEntityId: entityId,
              });
            } catch (err: any) {
              console.debug(`[agent:${this.userWallet.slice(0, 8)}] quest talk fallback: ${err.message?.slice(0, 60)}`);
            }
          }
        }
      }

      // 3. Accept new quests if we don't have many active
      const currentActive = activeQuests.filter((aq: any) => !aq.complete).length;
      if (currentActive < 3) {
        try {
          const availRes = await this.api("GET", `/quests/zone/${this.currentRegion}/${this.entityId}`);
          const available: any[] = availRes?.quests ?? [];
          if (available.length > 0) {
            const q = available[0];
            const acceptRes = await this.api("POST", "/quests/accept", {
              zoneId: this.currentRegion,
              playerId: this.entityId,
              questId: q.questId,
            });
            if (acceptRes?.accepted) {
              void this.logActivity(`Accepted quest: "${q.title}" from ${q.npcName}`);
            }
          } else if (currentActive === 0) {
            // No available quests and no active quests — this zone is exhausted
            // Check if we should travel to the next zone
            const myLevel = me.level ?? 1;
            const nextZone = this.findNextZoneForLevel(myLevel);
            if (nextZone && nextZone !== this.currentRegion) {
              console.log(`[agent:${this.userWallet.slice(0, 8)}] No quests left in ${this.currentRegion}, traveling to ${nextZone}`);
              void this.logActivity(`No quests remaining — traveling to ${nextZone}`);
              await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: nextZone });
              this.currentScript = null;
              return;
            }
          }
        } catch (err: any) {
          console.debug(`[agent:${this.userWallet.slice(0, 8)}] quest accept: ${err.message?.slice(0, 60)}`);
        }
      }

      // 4. Progress kill/gather quests by fighting mobs or gathering
      const hasKillQuest = activeQuests.some(
        (aq: any) => !aq.complete && aq.quest?.objective?.type === "kill"
      );
      const hasGatherQuest = activeQuests.some(
        (aq: any) => !aq.complete && (aq.quest?.objective?.type === "gather" || aq.quest?.objective?.type === "craft")
      );

      if (hasKillQuest) {
        void this.logActivity("Hunting mobs for kill quest");
        await this.doCombat(strategy);
      } else if (hasGatherQuest) {
        void this.logActivity("Gathering resources for quest");
        await this.doGathering(strategy);
      } else {
        await this.fallbackToCombat("No quest objectives to work on", strategy);
      }
    } catch (err: any) {
      console.debug(`[agent] questing tick: ${err.message?.slice(0, 60)}`);
      await this.fallbackToCombat("Quest system error", strategy);
    }
  }

  private async doCombat(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      if (this.currentCaps.techniquesEnabled) {
        const trainResult = await this.learnNextTechnique();
        if (trainResult.ok) return;
      }

      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // Don't engage if HP is too low — disengage and let regen kick in
      // (only if retreat is enabled for this tier)
      if (this.currentCaps.retreatEnabled) {
        const hpPct = (me.hp ?? 0) / Math.max(me.maxHp ?? 1, 1);
        const retreatThreshold: Record<AgentStrategy, number> = {
          aggressive: 0.15,
          balanced:   0.30,
          defensive:  0.50,
        };
        if (hpPct < retreatThreshold[strategy]) {
          await this.api("POST", "/command", {
            zoneId: this.currentRegion,
            entityId: this.entityId,
            action: "move",
            x: 150,
            y: 150,
          });
          void this.logActivity(`Low HP (${Math.round(hpPct * 100)}%) — disengaging`);
          return;
        }
      }

      const myLevel = me.level ?? 1;
      const levelCap: Record<AgentStrategy, number> = {
        aggressive: myLevel + 5,
        balanced:   myLevel + 2,
        defensive:  myLevel,
      };
      const maxMobLevel = levelCap[strategy];

      const eligible = Object.entries(entities)
        .filter(([, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && (e.level ?? 1) <= maxMobLevel);

      if (eligible.length === 0) return;

      const sorted = eligible.sort(([, a]: any, [, b]: any) => {
        if (strategy === "aggressive") {
          const levelDiff = (b.level ?? 1) - (a.level ?? 1);
          if (levelDiff !== 0) return levelDiff;
        }
        return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
      });

      const [mobId, mob] = sorted[0] as [string, any];
      const moving = await this.moveToEntity(me, mob);
      if (moving) return;

      await this.api("POST", "/command", {
        zoneId: this.currentRegion,
        entityId: this.entityId,
        action: "attack",
        targetId: mobId,
      });
      void this.logActivity(`Attacking ${mob.name ?? "mob"} (Lv${mob.level ?? "?"})`);
    } catch (err: any) {
      console.debug(`[agent] combat tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doGathering(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId || !this.custodialWallet) return;
    try {
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      const node = this.findNearestEntity(entities, me,
        (e) => e.type === "ore-node" || e.type === "flower-node"
      );
      if (!node) { await this.fallbackToCombat("No resource nodes in this zone", strategy); return; }

      const [nodeId, nodeEntity] = node;
      const moving = await this.moveToEntity(me, nodeEntity);
      if (moving) return;

      if (nodeEntity.type === "ore-node") {
        await this.api("POST", "/mining/gather", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentRegion,
          entityId: this.entityId,
          oreNodeId: nodeId,
        });
        void this.logActivity(`Gathered ore from ${nodeEntity.name ?? "ore node"}`);
      } else {
        await this.api("POST", "/herbalism/gather", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentRegion,
          entityId: this.entityId,
          flowerNodeId: nodeId,
        });
        void this.logActivity(`Gathered herb from ${nodeEntity.name ?? "flower node"}`);
      }
    } catch (err: any) {
      console.debug(`[agent] gathering tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doAlchemy(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId || !this.custodialWallet) return;
    try {
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // Step 3: Find alchemy lab
      const lab = this.findNearestEntity(entities, me,
        (e) => e.type === "alchemy-lab"
      );
      if (!lab) { void this.logActivity("⚠ No alchemy lab here — gathering herbs instead"); await this.doGathering(strategy); return; }

      const [labId, labEntity] = lab;
      const moving = await this.moveToEntity(me, labEntity);
      if (moving) return;

      // Step 4: Get recipes and try to brew
      const recipesRes = await this.api("GET", "/alchemy/recipes");
      const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);
      if (recipes.length === 0) { void this.logActivity("⚠ No alchemy recipes available — gathering materials"); await this.doGathering(strategy); return; }

      // Try recipes from simplest (tier 1) first
      for (const recipe of recipes) {
        try {
          await this.api("POST", "/alchemy/brew", {
            walletAddress: this.custodialWallet,
            zoneId: this.currentRegion,
            entityId: this.entityId,
            alchemyLabId: labId,
            recipeId: recipe.recipeId ?? recipe.id,
          });
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Brewed ${recipe.name ?? recipe.recipeId}`);
          void this.logActivity(`Brewed ${recipe.name ?? recipe.recipeId}`);
          return;
        } catch (err: any) {
          console.debug(`[agent:${this.userWallet.slice(0, 8)}] brew ${recipe.name ?? recipe.recipeId}: ${err.message?.slice(0, 60)}`);
        }
      }

      // No recipes craftable — go gather herbs for materials
      void this.logActivity("⚠ Missing ingredients for all potions — gathering herbs");
      await this.doGathering(strategy);
    } catch (err: any) {
      console.debug(`[agent] alchemy tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doCooking(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId || !this.custodialWallet) return;
    try {
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // Find campfire
      const campfire = this.findNearestEntity(entities, me,
        (e) => e.type === "campfire"
      );
      if (!campfire) { void this.logActivity("⚠ No campfire here — gathering ingredients instead"); await this.doGathering(strategy); return; }

      const [campfireId, campfireEntity] = campfire;
      const moving = await this.moveToEntity(me, campfireEntity);
      if (moving) return;

      // Get recipes and try to cook
      const recipesRes = await this.api("GET", "/cooking/recipes");
      const recipes = recipesRes?.recipes ?? [];
      for (const recipe of recipes) {
        try {
          await this.api("POST", "/cooking/cook", {
            walletAddress: this.custodialWallet,
            zoneId: this.currentRegion,
            entityId: this.entityId,
            campfireId,
            recipeId: recipe.recipeId ?? recipe.id,
          });
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Cooked ${recipe.name ?? recipe.recipeId}`);
          void this.logActivity(`Cooked ${recipe.name ?? recipe.recipeId}`);
          return;
        } catch (err: any) {
          console.debug(`[agent:${this.userWallet.slice(0, 8)}] cook ${recipe.name ?? recipe.recipeId}: ${err.message?.slice(0, 60)}`);
        }
      }

      // No recipes possible — go gather
      void this.logActivity("⚠ Can't cook anything — missing ingredients, going to gather");
      await this.doGathering(strategy);
    } catch (err: any) {
      console.debug(`[agent] cooking tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doEnchanting(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId || !this.custodialWallet) return;
    try {
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      const altar = this.findNearestEntity(entities, me,
        (e) => e.type === "enchanting-altar"
      );
      if (!altar) { await this.fallbackToCombat("No enchanting altar in this zone", strategy); return; }

      const [altarId, altarEntity] = altar;
      const moving = await this.moveToEntity(me, altarEntity);
      if (moving) return;

      if (me.equipment?.weapon) {
        // Find an enchantment elixir from inventory
        const inv = await this.api("GET", `/wallet/${this.custodialWallet}/balance`);
        const elixir = (inv?.items ?? []).find((i: any) =>
          i.category === "enchantment-elixir" && Number(i.balance) > 0
        );
        if (!elixir) { void this.logActivity("⚠ No enchantment elixirs — brewing some first"); await this.doAlchemy(strategy); return; }

        await this.api("POST", "/enchanting/apply", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentRegion,
          entityId: this.entityId,
          altarId,
          enchantmentElixirTokenId: Number(elixir.tokenId),
          equipmentSlot: "weapon",
        });
      } else {
        void this.logActivity("⚠ No weapon to enchant — gathering materials instead");
        await this.doGathering(strategy);
      }
    } catch (err: any) {
      console.debug(`[agent] enchanting tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doCrafting(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId || !this.custodialWallet) return;
    try {
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      const forge = this.findNearestEntity(entities, me,
        (e) => e.type === "forge"
      );
      if (!forge) { await this.fallbackToCombat("No forge in this zone", strategy); return; }

      const [forgeId, forgeEntity] = forge;
      const moving = await this.moveToEntity(me, forgeEntity);
      if (moving) return;

      const recipesRes = await this.api("GET", "/crafting/recipes");
      const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);

      // Try recipes
      for (const recipe of recipes) {
        try {
          await this.api("POST", "/crafting/forge", {
            walletAddress: this.custodialWallet,
            zoneId: this.currentRegion,
            entityId: this.entityId,
            forgeId,
            recipeId: recipe.recipeId ?? recipe.id,
          });
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Crafted ${recipe.name ?? recipe.recipeId}`);
          void this.logActivity(`Crafted ${recipe.name ?? recipe.recipeId}`);
          return;
        } catch (err: any) {
          console.debug(`[agent:${this.userWallet.slice(0, 8)}] craft ${recipe.name ?? recipe.recipeId}: ${err.message?.slice(0, 60)}`);
        }
      }

      // No recipes possible — go gather materials
      void this.logActivity("⚠ Missing materials for all recipes — gathering ore");
      await this.doGathering(strategy);
    } catch (err: any) {
      console.debug(`[agent] crafting tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doShopping(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId || !this.custodialWallet) return;
    try {
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // Find nearest merchant
      const merchant = this.findNearestEntity(entities, me,
        (e) => e.type === "merchant"
      );
      if (!merchant) { await this.fallbackToCombat("No merchants in this zone", strategy); return; }

      const [merchantId, merchantEntity] = merchant;

      // Move to merchant if not in range
      const moving = await this.moveToEntity(me, merchantEntity);
      if (moving) return;

      // Fetch merchant catalog
      const shopData = await this.api("GET", `/shop/npc/${merchantId}`);
      const items: any[] = shopData?.items ?? [];
      if (items.length === 0) { await this.fallbackToCombat("Merchant has nothing to sell", strategy); return; }

      // Check current equipment — identify empty slots
      const equipment = me.equipment ?? {};
      const emptySlots: string[] = [];
      for (const slot of ["weapon", "chest", "legs", "boots", "helm", "shoulders", "gloves", "belt"]) {
        if (!equipment[slot]) emptySlots.push(slot);
      }

      if (emptySlots.length === 0) {
        void this.logActivity("✓ Fully geared up — back to fighting");
        await this.doCombat(strategy);
        return;
      }

      // Check gold balance
      let inv: any = null;
      try {
        inv = await this.api("GET", `/wallet/${this.custodialWallet}/balance`);
      } catch (err: any) {
        console.debug(`[agent:${this.userWallet.slice(0, 8)}] shop balance: ${err.message?.slice(0, 60)}`);
      }
      const walletCopper = Number(inv?.copper ?? NaN);
      const walletGold = Number(inv?.gold ?? 0);
      const copperBalance = Number.isFinite(walletCopper)
        ? walletCopper
        : goldToCopper(walletGold);

      // For each empty slot, find cheapest matching item and buy+equip
      for (const slot of emptySlots) {
        // Match items by equipSlot or armorSlot
        const matching = items.filter((item: any) => {
          if (slot === "weapon") return item.equipSlot === "weapon" || item.category === "weapon";
          return item.armorSlot === slot || item.equipSlot === slot;
        }).sort((a: any, b: any) => (a.copperPrice ?? a.buyPrice ?? 9999) - (b.copperPrice ?? b.buyPrice ?? 9999));

        if (matching.length === 0) continue;

        const cheapest = matching[0];
        const priceCopper = cheapest.currentPrice ?? cheapest.copperPrice ?? cheapest.buyPrice ?? 0;
        if (priceCopper > copperBalance) continue;

        // Buy
        const tokenId = Number(cheapest.tokenId);
        const bought = await this.buyItem(tokenId);
        if (!bought) continue;

        // Equip
        await this.equipItem(tokenId);
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Shopping: bought+equipped ${cheapest.name ?? tokenId} for slot=${slot}`);
        void this.logActivity(`Bought & equipped ${cheapest.name ?? `token #${tokenId}`} (${slot})`);
        return; // one purchase per tick to stay responsive
      }

      // Nothing left to buy or can't afford — fall back to combat
      await this.fallbackToCombat("Can't afford any upgrades right now", strategy);
    } catch (err: any) {
      console.debug(`[agent] shopping tick: ${err.message?.slice(0, 60)}`);
    }
  }

  /**
   * Travel to config.targetZone using the /command travel action.
   * The server handles edge-walking vs portal routing internally.
   * Falls back to combat if no targetZone is set or already in the target zone.
   */
  private async doTravel(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const config = await getAgentConfig(this.userWallet);
      const rawTargetZone = config?.targetZone;
      const targetZone = resolveRegionId(rawTargetZone);

      if (rawTargetZone && !targetZone) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Invalid travel target zone: ${rawTargetZone}`);
        void this.logActivity(`Unknown destination "${rawTargetZone}" — clearing travel target`);
        await patchAgentConfig(this.userWallet, { focus: "questing", targetZone: undefined });
        return;
      }

      if (!targetZone || targetZone === this.currentRegion) {
        // Already arrived or no target — switch back to questing
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Arrived at ${this.currentRegion}, switching to questing`);
        void this.logActivity(`Arrived at ${this.currentRegion}, resuming questing`);
        await patchAgentConfig(this.userWallet, { focus: "questing", targetZone: undefined });
        return;
      }

      // In unified world, just move directly toward target region center
      const center = getRegionCenter(targetZone);
      if (!center) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Unknown region: ${targetZone}`);
        await patchAgentConfig(this.userWallet, { focus: "questing", targetZone: undefined });
        return;
      }

      // Issue travel command — walks directly in world-space
      await this.api("POST", "/command", {
        zoneId: this.currentRegion,
        entityId: this.entityId,
        action: "travel",
        targetZone,
      });
      console.log(`[agent:${this.userWallet.slice(0, 8)}] Traveling from ${this.currentRegion} → ${targetZone}`);
      void this.logActivity(`Traveling ${this.currentRegion} → ${targetZone}`);
    } catch (err: any) {
      console.debug(`[agent] travel tick: ${err.message?.slice(0, 80)}`);
    }
  }

  /**
   * Walk to a specific NPC entity that the user clicked on.
   * If the NPC is in a different zone, travel there first.
   * Once arrived, clears the goto target and resumes questing.
   */
  private async doGotoNpc(): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      // Suppress auto-combat while navigating to an NPC
      this.setEntityGotoMode(true);

      const config = await getAgentConfig(this.userWallet);
      const target = config?.gotoTarget;
      if (!target) {
        this.setEntityGotoMode(false);
        await patchAgentConfig(this.userWallet, { focus: "questing" });
        this.currentScript = null;
        return;
      }

      const { entityId: targetEntityId, zoneId: targetZoneId, name: targetName } = target;

      // Wrong zone — travel there first
      if (targetZoneId !== this.currentRegion) {
        const neighborsRes = await this.api("GET", `/neighbors/${this.currentRegion}`);
        const neighbors: Array<{ zone: string; levelReq: number }> = neighborsRes?.neighbors ?? [];
        const nextZone = neighbors.find((n) => n.zone === targetZoneId)
          ? targetZoneId
          : this.findNextZoneOnPath(neighbors, targetZoneId);
        if (nextZone) {
          await this.api("POST", "/command", {
            zoneId: this.currentRegion, entityId: this.entityId, action: "travel", targetZone: nextZone,
          });
          void this.logActivity(`Heading to ${targetZoneId} to find ${targetName ?? targetEntityId}`);
        }
        return;
      }

      // In the right zone — find the entity by ID then by name fallback
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      let targetEntity: any = entities[targetEntityId];
      if (!targetEntity && targetName) {
        const found = Object.entries(entities).find(([, e]: [string, any]) =>
          String(e.name ?? "").toLowerCase() === targetName.toLowerCase()
        );
        if (found) targetEntity = found[1];
      }

      if (!targetEntity) {
        void this.logActivity(`Could not find ${targetName ?? targetEntityId} in ${this.currentRegion}`);
        this.setEntityGotoMode(false);
        await patchAgentConfig(this.userWallet, { focus: "questing", gotoTarget: undefined });
        this.currentScript = null;
        return;
      }

      const moving = await this.moveToEntity(me, targetEntity);
      if (moving) {
        void this.logActivity(`Walking to ${targetName ?? "NPC"}`);
        return; // gotoMode stays true — auto-combat suppressed while walking
      }

      // Arrived — execute any on-arrival action
      const arrivalAction = target.action;
      const profession = target.profession;

      if (arrivalAction === "learn-profession" && profession && this.custodialWallet) {
        try {
          await this.api("POST", "/professions/learn", {
            walletAddress: this.custodialWallet,
            zoneId: this.currentRegion,
            entityId: this.entityId,
            trainerId: targetEntityId,
            professionId: profession,
          });
          void this.logActivity(`Learned profession: ${profession}`);
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Learned profession ${profession} (user-initiated)`);
        } catch (learnErr: any) {
          void this.logActivity(`⚠ Could not learn ${profession}: ${learnErr.message?.slice(0, 60)}`);
        }
      } else if (arrivalAction === "learn-technique" && target.techniqueId) {
        try {
          await this.api("POST", "/techniques/learn", {
            zoneId: this.currentRegion,
            playerEntityId: this.entityId,
            techniqueId: target.techniqueId,
            trainerEntityId: targetEntityId,
          });
          void this.logActivity(`Learned technique: ${target.techniqueName ?? target.techniqueId}`);
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Learned technique ${target.techniqueId} (user-initiated)`);
        } catch (learnErr: any) {
          void this.logActivity(`⚠ Could not learn technique: ${learnErr.message?.slice(0, 60)}`);
        }
      } else {
        void this.logActivity(`Arrived at ${targetName ?? "NPC"}`);
      }

      console.log(`[agent:${this.userWallet.slice(0, 8)}] Arrived at goto target: ${targetName ?? targetEntityId}`);
      this.setEntityGotoMode(false); // Re-enable auto-combat now that goto is complete
      await patchAgentConfig(this.userWallet, { focus: "questing", gotoTarget: undefined });
      this.currentScript = null;
    } catch (err: any) {
      this.setEntityGotoMode(false); // Always re-enable on error
      console.debug(`[agent] doGotoNpc: ${err.message?.slice(0, 60)}`);
    }
  }

  /**
   * Simple BFS to find the next hop from current neighbors toward a target zone.
   * Uses the zone connection graph via /neighbors endpoints.
   */
  private findNextZoneOnPath(
    currentNeighbors: Array<{ zone: string }>,
    targetZone: string,
  ): string | null {
    const directNeighbors = currentNeighbors
      .map((n) => n.zone)
      .filter((z) => z && z !== this.currentRegion);
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

  /**
   * Find the highest-level zone the agent qualifies for.
   */
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

  private async handleLowHp(entity: any, strategy: AgentStrategy): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    if (!this.currentCaps.retreatEnabled) return false;

    const hpPct = entity.hp / (entity.maxHp || 1);

    const threshold: Record<AgentStrategy, number> = {
      aggressive: 0.15,
      balanced:   0.25,
      defensive:  0.40,
    };

    if (hpPct > threshold[strategy]) return false;

    // Check inventory for consumables
    let inv: any = null;
    try {
      inv = await this.api("GET", `/wallet/${this.custodialWallet}/balance`);
    } catch (err: any) {
      console.debug(`[agent:${this.userWallet.slice(0, 8)}] survival balance: ${err.message?.slice(0, 60)}`);
    }
    const ownedItems: any[] = inv?.items ?? [];

    // Try food first (cooking/consume)
    const food = ownedItems.find((i: any) => i.category === "food" && Number(i.balance) > 0);
    if (food) {
      try {
        await this.api("POST", "/cooking/consume", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentRegion,
          entityId: this.entityId,
          foodTokenId: Number(food.tokenId),
        });
        console.log(`[agent:${this.userWallet.slice(0, 8)}] [${strategy}] Ate ${food.name} at ${Math.round(hpPct * 100)}% HP`);
        void this.logActivity(`Ate ${food.name} (${Math.round(hpPct * 100)}% HP)`);
        return true;
      } catch (err: any) {
        console.debug(`[agent:${this.userWallet.slice(0, 8)}] eat food: ${err.message?.slice(0, 60)}`);
      }
    }

    // Try potion (alchemy/consume)
    const potion = ownedItems.find((i: any) =>
      (i.category === "potion" || i.category === "consumable") && Number(i.balance) > 0
    );
    if (potion) {
      try {
        await this.api("POST", "/alchemy/consume", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentRegion,
          entityId: this.entityId,
          tokenId: Number(potion.tokenId),
        });
        console.log(`[agent:${this.userWallet.slice(0, 8)}] [${strategy}] Used ${potion.name} at ${Math.round(hpPct * 100)}% HP`);
        void this.logActivity(`Used ${potion.name} (${Math.round(hpPct * 100)}% HP)`);
        return true;
      } catch (err: any) {
        console.debug(`[agent:${this.userWallet.slice(0, 8)}] use potion: ${err.message?.slice(0, 60)}`);
      }
    }

    // Flee threshold
    const fleeThreshold: Record<AgentStrategy, number> = {
      aggressive: 0.05,
      balanced:   0.15,
      defensive:  0.30,
    };

    if (hpPct < fleeThreshold[strategy]) {
      await this.api("POST", "/command", {
        zoneId: this.currentRegion,
        entityId: this.entityId,
        action: "move",
        x: 150,
        y: 150,
      });
      console.log(`[agent:${this.userWallet.slice(0, 8)}] [${strategy}] Fleeing at ${Math.round(hpPct * 100)}% HP`);
      void this.logActivity(`Fleeing! (${Math.round(hpPct * 100)}% HP)`);
      return true;
    }
    return false;
  }

  // ── Self-adaptation ────────────────────────────────────────────────────────

  /**
   * Periodically check the agent's situation and auto-adjust behavior.
   * Returns true if an adaptation action was taken this tick.
   */
  private async checkSelfAdaptation(entity: any, strategy: AgentStrategy): Promise<boolean> {
    if (!this.api || !this.custodialWallet) return false;
    try {
      const hpPct = entity.hp / (entity.maxHp || 1);

      // Check inventory
      let inv: any = null;
      try { inv = await this.api("GET", `/wallet/${this.custodialWallet}/balance`); } catch (err: any) {
        console.debug(`[agent:${this.userWallet.slice(0, 8)}] adapt balance: ${err.message?.slice(0, 60)}`);
      }
      const items: any[] = inv?.items ?? [];
      const walletCopper = Number(inv?.copper ?? NaN);
      const walletGold = Number(inv?.gold ?? 0);
      const copper = Number.isFinite(walletCopper)
        ? walletCopper
        : goldToCopper(walletGold);
      const hasFood = items.some((i: any) => i.category === "food" && Number(i.balance) > 0);
      const hasPotions = items.some((i: any) => (i.category === "potion" || i.category === "consumable") && Number(i.balance) > 0);
      const equipment = entity.equipment ?? {};
      const hasWeapon = Boolean(equipment.weapon);

      const currentFocusEarly = (await getAgentConfig(this.userWallet))?.focus;

      // Crafting escape hatch: if stuck in gathering/crafting for 60+ ticks (~72s), return to questing
      if ((currentFocusEarly === "gathering" || currentFocusEarly === "crafting") && this.ticksSinceFocusChange > 60) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: stuck in ${currentFocusEarly} for ${this.ticksSinceFocusChange} ticks, returning to questing`);
        void this.logActivity(`Done ${currentFocusEarly} — back to questing`);
        await patchAgentConfig(this.userWallet, { focus: "questing" });
        return true;
      }

      // Priority 0: Early-game bootstrap — keep killing mobs until 100 copper
      if (copper < 100) {
        if (currentFocusEarly !== "combat" && currentFocusEarly !== "shopping") {
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: only ${copper}c, need 100c — staying in combat`);
          void this.logActivity(`Only ${copper}c — killing mobs for starter gold`);
          await patchAgentConfig(this.userWallet, { focus: "combat" });
          return true;
        }
      }

      // Priority 1: No weapon + enough copper for starter gear → go shopping
      if (!hasWeapon && copper >= 10) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: no weapon, going shopping`);
        void this.logActivity("No weapon equipped — heading to shop");
        await patchAgentConfig(this.userWallet, { focus: "shopping" });
        return true;
      }

      // Priority 1b: Has weapon but missing armor pieces → go shopping for gear
      const armorSlots = ["chest", "legs", "boots", "helm", "shoulders", "gloves", "belt"];
      const emptyArmorSlots = armorSlots.filter((s) => !equipment[s]);
      if (emptyArmorSlots.length >= 2 && copper >= 40) {
        if (currentFocusEarly !== "shopping") {
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: ${emptyArmorSlots.length} empty armor slots (${emptyArmorSlots.join(", ")}), going shopping`);
          void this.logActivity(`Missing ${emptyArmorSlots.length} armor pieces — heading to shop`);
          await patchAgentConfig(this.userWallet, { focus: "shopping" });
          return true;
        }
      }

      // Priority 2: Critically low HP with no consumables → try shopping for food first,
      // only cook if we have ingredients. HP passively regenerates out of combat (~0.5-1.5%/tick),
      // so only trigger this at very low HP where regen alone isn't enough.
      if (!hasFood && !hasPotions && hpPct < 0.3) {
        // Check if we have any cooking ingredients before switching to cooking
        const hasCookingIngredients = items.some((i: any) =>
          (i.category === "material" || i.category === "ingredient" || i.category === "meat" || i.category === "herb") && Number(i.balance) > 0
        );
        if (hasCookingIngredients) {
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: has ingredients, going to cook`);
          void this.logActivity("Has ingredients — cooking food");
          await patchAgentConfig(this.userWallet, { focus: "cooking" });
          return true;
        }
        // No ingredients + low HP → go shopping for food or potions if we have gold
        if (copper >= 10) {
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: no consumables, shopping for food`);
          void this.logActivity("No consumables — shopping for food");
          await patchAgentConfig(this.userWallet, { focus: "shopping" });
          return true;
        }
        // No ingredients, no gold — just keep questing/fighting to earn gold
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: no consumables or gold, staying on task`);
        return false;
      }

      // Priority 2b: Periodically switch to gathering → crafting cycle for XP + gear
      // Trigger: agent has been questing/fighting for 100+ ticks AND has 200+ copper
      // This gives agents a natural "go craft some gear" cadence
      if (this.ticksSinceFocusChange > 100
        && copper >= 200
        && (currentFocusEarly === "questing" || currentFocusEarly === "combat")) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: crafting cycle — ${this.ticksSinceFocusChange} ticks in ${currentFocusEarly}, ${copper}c available`);
        void this.logActivity("Switching to gathering & crafting for gear upgrades");
        await patchAgentConfig(this.userWallet, { focus: "gathering" });
        return true;
      }

      // Priority 3: Outleveled current zone → travel to next zone
      const myLevel = entity.level ?? 1;
      const currentZoneLevelReq = ZONE_LEVEL_REQUIREMENTS[this.currentRegion] ?? 1;
      // If agent is 2+ levels above the zone's requirement, find the next zone
      if (myLevel >= currentZoneLevelReq + 2) {
        const nextZone = this.findNextZoneForLevel(myLevel);
        if (nextZone && nextZone !== this.currentRegion) {
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: level ${myLevel} outleveled ${this.currentRegion} (req ${currentZoneLevelReq}), traveling to ${nextZone}`);
          void this.logActivity(`Outleveled ${this.currentRegion} (Lv${myLevel}) — traveling to ${nextZone}`);
          await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: nextZone });
          return true;
        }
      }

      // Priority 4: Roaming — been in the same zone too long, explore an adjacent zone
      // ~4 minutes in one zone → pick a random accessible neighbor to keep things lively
      if (this.ticksInCurrentZone >= 200
        && (currentFocusEarly === "questing" || currentFocusEarly === "combat")) {
        const neighbors = getZoneConnections(this.currentRegion)
          .filter((z) => {
            const req = ZONE_LEVEL_REQUIREMENTS[z] ?? 1;
            return myLevel >= req && z !== this.currentRegion;
          });
        if (neighbors.length > 0) {
          const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: roaming after ${this.ticksInCurrentZone} ticks in ${this.currentRegion} → ${pick}`);
          void this.logActivity(`Exploring new territory — heading to ${pick}`);
          await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: pick });
          return true;
        }
      }

      return false;
    } catch (err: any) {
      console.debug(`[agent:${this.userWallet.slice(0, 8)}] self-adapt: ${err.message?.slice(0, 60)}`);
      return false;
    }
  }

  // ── Bot script execution ─────────────────────────────────────────────────

  /**
   * Execute the current BotScript for one tick.
   * The bot handles all the mechanical execution; the supervisor decides *which* script runs.
   */
  private async executeCurrentScript(entity: any, entities: Record<string, any>, strategy: AgentStrategy): Promise<void> {
    const script = this.currentScript;
    if (!script) return;

    switch (script.type) {
      case "combat":  await this.doCombat(strategy); break;
      case "gather":  await this.doGathering(strategy); break;
      case "travel":  await this.doTravel(strategy); break;
      case "goto":    await this.doGotoNpc(); break;
      case "shop":    await this.doShopping(strategy); break;
      case "craft":   await this.doCrafting(strategy); break;
      case "brew":    await this.doAlchemy(strategy); break;
      case "cook":    await this.doCooking(strategy); break;
      case "quest":   await this.doQuesting(strategy); break;
      case "idle":    break;
    }
  }

  /**
   * Detect whether a significant game-state event has occurred that should
   * trigger the AI supervisor to re-evaluate the bot's script.
   * Returns an event on trigger, or null to keep executing the current script.
   */
  private detectTrigger(entity: any, entities: Record<string, any>): TriggerEvent | null {
    // No script → supervisor must assign one
    if (!this.currentScript) {
      return { type: "no_script", detail: "Agent needs an initial script" };
    }

    this.ticksSinceLastDecision++;
    this.ticksOnCurrentScript++;

    // Script stuck too long — let supervisor re-evaluate any behavior (~60s)
    if (this.ticksOnCurrentScript >= 120) {
      return { type: "stuck", detail: `Script "${this.currentScript.type}" running for ${this.ticksOnCurrentScript} ticks with no progress` };
    }

    // Universal: level up
    const level = entity.level ?? 1;
    if (level > this.lastKnownLevel && this.lastKnownLevel > 0) {
      return { type: "level_up", detail: `Reached level ${level} — re-evaluating strategy` };
    }

    // Universal: arrived in a new zone
    if (this.currentRegion !== this.lastKnownZone && this.lastKnownZone !== "") {
      return { type: "zone_arrived", detail: `Arrived in ${this.currentRegion}` };
    }

    // Script-specific triggers
    switch (this.currentScript.type) {
      case "combat": {
        const offset = this.currentScript.maxLevelOffset ?? 2;
        const hasTargets = Object.values(entities).some(
          (e: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && (e.level ?? 1) <= level + offset
        );
        if (!hasTargets) {
          return { type: "no_targets", detail: "No eligible mobs in zone — zone may be cleared" };
        }
        break;
      }

      case "gather": {
        const nt = this.currentScript.nodeType ?? "both";
        const hasNodes = Object.values(entities).some((e: any) =>
          (nt !== "herb" && e.type === "ore-node") ||
          (nt !== "ore"  && e.type === "flower-node")
        );
        if (!hasNodes) {
          return { type: "no_targets", detail: "No resource nodes in zone" };
        }
        break;
      }

      case "travel": {
        if (this.currentScript.targetZone && this.currentScript.targetZone === this.currentRegion) {
          return { type: "script_done", detail: `Arrived at destination: ${this.currentRegion}` };
        }
        break;
      }

      case "shop": {
        const eq = entity.equipment ?? {};
        const emptySlots = ["weapon", "chest", "legs", "boots", "helm"].filter((s) => !eq[s]);
        if (emptySlots.length === 0) {
          return { type: "script_done", detail: "Fully equipped — shopping complete" };
        }
        break;
      }

      case "quest": {
        // If no mobs left and questing involves kill quests, trigger re-evaluation
        const hasEligibleMobs = Object.values(entities).some(
          (e: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && (e.level ?? 1) <= level + 3
        );
        if (!hasEligibleMobs) {
          return { type: "no_targets", detail: "No mobs for quest progression — zone may be exhausted" };
        }
        break;
      }
    }

    // Safety-net: supervisor hasn't been called in too long
    if (this.ticksSinceLastDecision >= MAX_STALE_TICKS) {
      return { type: "periodic", detail: "Periodic strategic review" };
    }

    return null;
  }

  /**
   * Core method: detects triggers → calls supervisor on events → executes current script.
   */
  private async decideAndAct(
    entity: any,
    entities: Record<string, any>,
    config: { focus: AgentFocus; strategy: AgentStrategy; targetZone?: string },
    strategy: AgentStrategy,
  ): Promise<void> {
    const trigger = this.detectTrigger(entity, entities);

    if (trigger) {
      const prevLevel = this.lastKnownLevel;
      this.ticksSinceLastDecision = 0;
      this.lastKnownLevel = entity.level ?? 1;
      this.lastKnownZone = this.currentRegion;

      this.lastTrigger = trigger;
      console.log(`[agent:${this.userWallet.slice(0, 8)}] Trigger [${trigger.type}]: ${trigger.detail}`);

      // Derive user's natural-language directive from focus
      const userDirective = focusToDirective(config.focus, config.targetZone);

      // Hard-respect focus when the runner has no script yet (startup/focus change).
      if (trigger.type === "no_script") {
        // Goto focus always takes priority — never override with early-game combat
        if (config.focus === "goto") {
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
          this.ticksOnCurrentScript = 0;
          void this.logActivity(`[AI] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
        } else {
        // Early-game bootstrap: kill Giant Rats until 100 copper before doing anything else
        let earlyGameCopper = 0;
        try {
          const inv = await this.api!("GET", `/wallet/${this.custodialWallet}/balance`);
          const wc = Number(inv?.copper ?? NaN);
          const wg = Number(inv?.gold ?? 0);
          earlyGameCopper = Number.isFinite(wc) ? wc : goldToCopper(wg);
        } catch { /* non-fatal */ }

        if (earlyGameCopper < 100) {
          this.currentScript = { type: "combat", maxLevelOffset: 2, reason: "Early game — killing rats to earn starter gold" };
          this.ticksOnCurrentScript = 0;
          void this.logActivity("[AI] combat: Killing rats to earn starter gold (need 100c)");
        } else {
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
          this.ticksOnCurrentScript = 0;
          void this.logActivity(`[AI] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
        }
        }
      } else if (trigger.type === "level_up") {
        // On level-up, check if a new zone just became accessible
        const lvl = entity.level ?? 1;
        const bestZone = this.findNextZoneForLevel(lvl);
        if (bestZone && bestZone !== this.currentRegion
          && lvl >= (ZONE_LEVEL_REQUIREMENTS[bestZone] ?? 1)
          && lvl < (ZONE_LEVEL_REQUIREMENTS[bestZone] ?? 1) + 2) {
          // Just unlocked this zone — go explore it
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Level ${lvl} unlocked ${bestZone}, heading there`);
          void this.logActivity(`Level ${lvl}! New zone unlocked — heading to ${bestZone}`);
          await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: bestZone });
          this.currentScript = { type: "travel", targetZone: bestZone, reason: `Level ${lvl} unlocked ${bestZone}` };
          this.ticksOnCurrentScript = 0;
        } else {
          // Normal level-up — re-derive script from focus
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
          this.ticksOnCurrentScript = 0;
          void this.logActivity(`Level ${lvl}! Continuing ${config.focus}`);
        }
      } else if (trigger.type === "no_targets") {
        // No mobs/nodes in current zone — travel to an accessible neighbor
        const lvl = entity.level ?? 1;
        const allowed = this.currentCaps.allowedZones;
        const accessibleNeighbors = getZoneConnections(this.currentRegion)
          .filter((z) => lvl >= (ZONE_LEVEL_REQUIREMENTS[z] ?? 1))
          .filter((z) => allowed === "all" || allowed.includes(z));
        if (accessibleNeighbors.length > 0) {
          const pick = accessibleNeighbors[Math.floor(Math.random() * accessibleNeighbors.length)];
          console.log(`[agent:${this.userWallet.slice(0, 8)}] No targets in ${this.currentRegion}, moving to ${pick}`);
          void this.logActivity(`Zone cleared — exploring ${pick}`);
          await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: pick });
          this.currentScript = { type: "travel", targetZone: pick, reason: "Zone cleared" };
          this.ticksOnCurrentScript = 0;
        } else {
          // No accessible neighbors — fall back to waiting
          this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
          this.ticksOnCurrentScript = 0;
        }
      } else if (!this.currentCaps.supervisorEnabled) {
        // Free tier: no LLM supervisor — always use scripted fallback
        this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
        this.ticksOnCurrentScript = 0;
        void this.logActivity(`[script] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
      } else {
      try {
        // Fetch real on-chain gold balance — entity.gold is always 0 (not a zone field)
        let walletGoldCopper = 0;
        try {
          const inv = await this.api!("GET", `/wallet/${this.custodialWallet}/balance`);
          const wc = Number(inv?.copper ?? NaN);
          const wg = Number(inv?.gold ?? 0);
          walletGoldCopper = Number.isFinite(wc) ? wc : goldToCopper(wg);
        } catch { /* non-fatal */ }

        const newScript = await runSupervisor(trigger, {
          entity,
          entities,
          entityId: this.entityId!,
          currentRegion: this.currentRegion,
          custodialWallet: this.custodialWallet!,
          currentScript: this.currentScript,
          recentActivities: this.recentActivities,
          userDirective,
          apiCall: this.api!,
          walletGoldCopper,
        });
        this.currentScript = newScript;
        this.ticksOnCurrentScript = 0;
        void this.logActivity(`[AI] ${newScript.type}: ${newScript.reason ?? ""}`);
      } catch (err: any) {
        console.warn(`[agent:${this.userWallet.slice(0, 8)}] Supervisor failed: ${err.message?.slice(0, 60)}`);
        // Fallback: derive a script from the current focus so the bot doesn't stop
        this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
        this.ticksOnCurrentScript = 0;
      }
      }
    }

    await this.executeCurrentScript(entity, entities, strategy);
  }

  // ── Placeholder for old LLM decision engine methods (replaced by supervisor) ──


  // ── Main loop ─────────────────────────────────────────────────────────────

  private async loop(
    onFirstTick: () => void,
    onFirstTickFail: (err: Error) => void,
  ): Promise<void> {
    let firstTickDone = false;

    while (this.running) {
      try {
        // Clear per-tick cache so every iteration gets fresh zone state
        this.cachedZoneState = null;

        // Read config fresh each tick
        const config = await getAgentConfig(this.userWallet);
        if (!config?.enabled) {
          if (!firstTickDone) onFirstTickFail(new Error("Agent config disabled"));
          this.running = false;
          break;
        }

        // Resolve tier capabilities for this tick
        this.currentCaps = TIER_CAPABILITIES[config.tier ?? "free"];

        // Session timeout enforcement
        if (this.currentCaps.sessionLimitMs != null && config.sessionStartedAt) {
          if (Date.now() - config.sessionStartedAt >= this.currentCaps.sessionLimitMs) {
            const hours = Math.round(this.currentCaps.sessionLimitMs / 3600_000);
            console.log(`[agent:${this.userWallet.slice(0, 8)}] Session limit reached (${hours}h for ${config.tier ?? "free"} tier) — stopping`);
            void this.logActivity(`Session limit reached (${hours}h) — upgrade tier for longer sessions`);
            await patchAgentConfig(this.userWallet, { enabled: false });
            this.running = false;
            break;
          }
        }

        // Ensure we're authenticated
        const authed = await this.ensureAuth();
        if (!authed) {
          if (!firstTickDone) {
            onFirstTickFail(new Error("Agent auth failed — custodial wallet missing or invalid"));
            this.running = false;
            break;
          }
          await sleep(TICK_MS * 3);
          continue;
        }

        // Ensure entity exists
        const hasEntity = await this.ensureEntity();
        if (!hasEntity) {
          if (!firstTickDone) {
            onFirstTickFail(new Error("Agent entity not found in any zone — spawn may have failed"));
            this.running = false;
            break;
          }
          await sleep(TICK_MS * 2);
          continue;
        }

        // Get zone state (entity + all entities needed by the decision engine)
        const zs = await this.getZoneState();
        if (!zs) {
          if (!firstTickDone) {
            onFirstTickFail(new Error("Could not read entity state from zone"));
            this.running = false;
            break;
          }
          await sleep(TICK_MS);
          continue;
        }
        const entity = zs.me;

        // ── First tick verified — agent is alive and well ──
        if (!firstTickDone) {
          firstTickDone = true;
          console.log(`[agent:${this.userWallet.slice(0, 8)}] First tick OK — entity ${this.entityId} in ${this.currentRegion}`);
          onFirstTick();
        }

        const strategy: AgentStrategy = config.strategy ?? "balanced";
        const focus: AgentFocus = config.focus;

        // Track focus changes — null-out current script so supervisor gets a "user_directive" trigger
        if (focus !== this.lastFocus) {
          this.lastFocus = focus;
          this.ticksSinceFocusChange = 0;
          this.combatFallbackCount = 0;
          this.currentScript = null;
          this.ticksSinceLastDecision = MAX_STALE_TICKS; // ensure trigger fires this tick
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Focus changed → ${focus} (${strategy})`);
          void this.logActivity(`Focus changed → ${focus}`);
        }
        this.ticksSinceFocusChange++;

        // Suppress server-side auto-combat when agent is doing non-combat work
        // (shopping, crafting, gathering, goto, etc.) so mobs don't hijack the entity
        const suppressCombat = focus !== "combat" && focus !== "questing";
        this.setEntityGotoMode(suppressCombat);

        // Track zone-stay duration (reset on zone change)
        if (this.currentRegion !== this.lastKnownZone && this.lastKnownZone !== "") {
          this.ticksInCurrentZone = 0;
        }
        this.ticksInCurrentZone++;

        // ── Inbox check: every 5 ticks (~6s), peek for new agent-to-agent messages ──
        if (this.ticksSinceFocusChange % 5 === 0) {
          await this.processInbox();
        }

        // Handle low HP first (strategy affects thresholds)
        const usedPotion = await this.handleLowHp(entity, strategy);
        if (usedPotion) { await sleep(TICK_MS); continue; }

        // ── Self-adaptation: periodically check if we should auto-adjust ──
        // Every 10 ticks (~12s), check situational needs.
        // Allow adaptation from questing/combat (normal flow) AND from cooking/shopping
        // (escape hatch — generic stuck detection in detectTrigger handles prolonged stalls).
        const allowAutoAdapt = this.currentCaps.selfAdaptationEnabled
          && (focus === "questing" || focus === "combat" || focus === "cooking" || focus === "shopping" || focus === "gathering" || focus === "crafting");
        if (allowAutoAdapt && this.ticksSinceFocusChange % 10 === 0 && this.ticksSinceFocusChange > 0) {
          const adapted = await this.checkSelfAdaptation(entity, strategy);
          if (adapted) { this.currentScript = null; await sleep(TICK_MS); continue; }
        }

        // Auto-repair if gear is badly damaged
        const repairing = await this.handleRepair(entity);
        if (repairing) { await sleep(TICK_MS); continue; }

        // If targetZone is set, push focus to traveling so supervisor picks it up.
        // Normalize or clear malformed zone labels from chat/tool output.
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
          this.currentScript = null; // supervisor will assign travel script
        }

        // Zone restriction enforcement — if agent is in a disallowed zone, force travel back
        if (this.currentCaps.allowedZones !== "all") {
          const allowed = this.currentCaps.allowedZones;
          if (!allowed.includes(this.currentRegion)) {
            const fallbackZone = allowed[0] ?? "village-square";
            console.log(`[agent:${this.userWallet.slice(0, 8)}] Zone ${this.currentRegion} not allowed for ${config.tier ?? "free"} tier — forcing travel to ${fallbackZone}`);
            void this.logActivity(`Zone restricted — returning to ${fallbackZone}`);
            await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: fallbackZone });
            this.currentScript = null;
          }
          // Clear disallowed target zones
          if (normalizedTargetZone && !allowed.includes(normalizedTargetZone)) {
            console.log(`[agent:${this.userWallet.slice(0, 8)}] Target zone ${normalizedTargetZone} not allowed for ${config.tier ?? "free"} tier — clearing`);
            await patchAgentConfig(this.userWallet, { targetZone: undefined });
            this.currentScript = null;
          }
        }

        // Event-driven bot: execute current script, trigger supervisor on significant events
        await this.decideAndAct(entity, zs.entities, config, strategy);
      } catch (err: any) {
        console.warn(`[agent:${this.userWallet.slice(0, 8)}] Loop error: ${err.message?.slice(0, 80)}`);
        if (!firstTickDone) {
          onFirstTickFail(err instanceof Error ? err : new Error(String(err.message ?? err)));
          this.running = false;
          return;
        }
      }

      await sleep(TICK_MS);
    }

    console.log(`[agent:${this.userWallet.slice(0, 8)}] Loop exited`);
  }
}
