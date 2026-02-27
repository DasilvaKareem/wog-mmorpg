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
import { exportCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import { authenticateWithWallet, createAuthenticatedAPI } from "../auth/authHelper.js";
import { ZONE_LEVEL_REQUIREMENTS, getZoneConnections, resolveZoneId } from "../world/worldLayout.js";
import { goldToCopper } from "../blockchain/currency.js";
import { runSupervisor } from "./agentSupervisor.js";
import { type BotScript, type TriggerEvent, type TriggerType } from "../types/botScriptTypes.js";

/** Safety-net: call supervisor if no trigger has fired in this many ticks (~18s). */
const MAX_STALE_TICKS = 15;

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
    case "cooking":    return "Cook food for HP recovery. Gather ingredients if needed.";
    case "enchanting": return "Enchant your weapon. Brew elixirs first if you have none.";
    case "shopping":   return "Buy and equip the best gear you can afford.";
    case "traveling":  return targetZone ? `Travel to ${targetZone} as quickly as possible.` : "Explore and travel to new zones.";
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
  private currentZone: string = "village-square";
  private jwtExpiry = 0;
  private jwt: string | null = null;
  /** Resolves once the first tick succeeds (or rejects if it fails). */
  private firstTickResult: Promise<void> | null = null;
  /** Tracks ticks since last focus change — used for self-adaptation */
  private ticksSinceFocusChange = 0;
  private lastFocus: AgentFocus = "questing";
  /** Tracks consecutive combat fallback ticks */
  private combatFallbackCount = 0;
  /** Live description of what the agent is doing right now */
  public currentActivity = "Idle";
  /** Circular buffer of recent activity strings for supervisor context */
  private recentActivities: string[] = [];
  /** Current bot script being executed. Null = supervisor must decide. */
  private currentScript: BotScript | null = null;
  /** Expose current script for status endpoint */
  public get script(): BotScript | null { return this.currentScript; }
  /** Force re-evaluation on next tick (called when user manually changes config) */
  public clearScript(): void {
    this.currentScript = null;
    this.ticksSinceLastDecision = MAX_STALE_TICKS;
  }
  /** Ticks since the last supervisor call (for MAX_STALE_TICKS safety net) */
  private ticksSinceLastDecision = 0;
  /** Snapshot values used to detect meaningful game-state change events */
  private lastKnownLevel = 0;
  private lastKnownZone = "";

  constructor(userWallet: string) {
    this.userWallet = userWallet;
  }

  /** Log an activity message to the agent's chat history (visible to spectators). */
  private async logActivity(text: string): Promise<void> {
    this.currentActivity = text;
    this.recentActivities = [...this.recentActivities, text].slice(-8);
    try {
      await appendChatMessage(this.userWallet, { role: "activity", text, ts: Date.now() });
    } catch {}
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
    this.currentZone = ref.zoneId;

    // Check entity still in expected zone
    try {
      const state = await this.api("GET", `/zones/${this.currentZone}`);
      if (state?.entities?.[this.entityId]) return true;
    } catch {}

    // Entity not in expected zone — scan all zones (handles server-side transitions)
    try {
      const zones = await this.api("GET", "/state");
      for (const [zid, zdata] of Object.entries(zones.zones ?? {})) {
        const ents = (zdata as any).entities ?? {};
        if (ents[this.entityId]) {
          if (zid !== this.currentZone) {
            console.log(`[agent:${this.userWallet.slice(0, 8)}] Zone changed: ${this.currentZone} → ${zid} (server-side transition)`);
            void this.logActivity(`Zone transition: ${this.currentZone} → ${zid}`);
          }
          this.currentZone = zid;
          await setAgentEntityRef(this.userWallet, { entityId: this.entityId, zoneId: zid });
          return true;
        }
      }
    } catch {}

    return false;
  }

  private async getEntityState(): Promise<any | null> {
    if (!this.api || !this.entityId) return null;
    try {
      const state = await this.api("GET", `/zones/${this.currentZone}`);
      return state?.entities?.[this.entityId] ?? null;
    } catch {
      return null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async getZoneState(): Promise<{ entities: Record<string, any>; me: any } | null> {
    if (!this.api || !this.entityId) return null;
    const state = await this.api("GET", `/zones/${this.currentZone}`);
    const entities = state?.entities ?? {};
    const me = entities[this.entityId];
    if (!me) return null;
    return { entities, me };
  }

  private findNearestEntity(entities: Record<string, any>, me: any, typePredicate: (e: any) => boolean): [string, any] | null {
    const matches = Object.entries(entities)
      .filter(([id, e]) => id !== this.entityId && typePredicate(e))
      .sort(([, a], [, b]) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    return matches[0] as [string, any] ?? null;
  }

  private async moveToEntity(me: any, target: any): Promise<boolean> {
    if (!this.api || !this.entityId) return false;
    const dist = Math.hypot(target.x - me.x, target.y - me.y);
    if (dist > 80) {
      await this.api("POST", "/command", {
        zoneId: this.currentZone, entityId: this.entityId, action: "move",
        x: target.x, y: target.y,
      });
      return true; // still moving
    }
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
        console.log(`[agent:${this.userWallet.slice(0, 8)}] No ${professionId} trainer in ${this.currentZone}`);
        return false;
      }

      // Move to trainer if needed
      const moving = await this.moveToEntity(zs.me, trainer[1]);
      if (moving) return false; // still walking

      // Learn
      await this.api("POST", "/professions/learn", {
        walletAddress: this.custodialWallet,
        zoneId: this.currentZone,
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
  private async learnNextTechnique(): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
    try {
      const zs = await this.getZoneState();
      if (!zs) return false;
      const { entities, me } = zs;
      const classId = (me.classId ?? "").toLowerCase();
      if (!classId) return false;

      const availableRes = await this.api("GET", `/techniques/available/${this.currentZone}/${this.entityId}`);
      const available: Array<{ id: string; name?: string; isLearned?: boolean }> = availableRes?.techniques ?? [];
      const nextToLearn = available.find((t) => !t.isLearned);
      if (!nextToLearn) return false;

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
      if (!trainer) return false;

      const moving = await this.moveToEntity(me, trainer[1]);
      if (moving) return true;

      await this.api("POST", "/techniques/learn", {
        zoneId: this.currentZone,
        playerEntityId: this.entityId,
        techniqueId: nextToLearn.id,
        trainerEntityId: trainer[0],
      });
      console.log(`[agent:${this.userWallet.slice(0, 8)}] Learned technique ${nextToLearn.id}`);
      void this.logActivity(`Learned technique: ${nextToLearn.name ?? nextToLearn.id}`);
      return true;
    } catch (err: any) {
      console.debug(`[agent] learnNextTechnique: ${err.message?.slice(0, 60)}`);
      return false;
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
        zoneId: this.currentZone,
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
        console.debug(`[agent:${this.userWallet.slice(0, 8)}] No blacksmith in ${this.currentZone}`);
        return false;
      }

      const [smithId, smithEntity] = smith;

      // Move to blacksmith if not in range
      const moving = await this.moveToEntity(me, smithEntity);
      if (moving) return true; // still walking — count as "handled"

      // Repair all slots
      const result = await this.api("POST", "/equipment/repair", {
        zoneId: this.currentZone,
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

  // ── Focus behaviours ──────────────────────────────────────────────────────

  private async doQuesting(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // 1. Check for completed quests and turn them in (walk to NPC first)
      const activeRes = await this.api("GET", `/quests/active/${this.currentZone}/${this.entityId}`);
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
                zoneId: this.currentZone,
                playerId: this.entityId,
                questId: aq.questId,
                npcId: npcEntityId,
              });
              if (completeRes?.completed) {
                void this.logActivity(`Quest complete: "${aq.quest?.title}" +${completeRes.rewards?.xp ?? 0}XP +${completeRes.rewards?.copper ?? 0}c`);
                return; // one action per tick
              }
            } catch {}
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
                zoneId: this.currentZone,
                playerId: this.entityId,
                npcEntityId,
              });
              void this.logActivity(`Talked to ${targetNpcName} for "${tq.quest?.title}"`);
              return;
            } catch {}
          }
        }
        // Fallback: try all quest-givers for talk quests
        for (const [entityId, e] of Object.entries(entities)) {
          if ((e as any).type === "quest-giver") {
            try {
              await this.api("POST", "/quests/talk", {
                zoneId: this.currentZone,
                playerId: this.entityId,
                npcEntityId: entityId,
              });
            } catch {}
          }
        }
      }

      // 3. Accept new quests if we don't have many active
      const currentActive = activeQuests.filter((aq: any) => !aq.complete).length;
      if (currentActive < 3) {
        try {
          const availRes = await this.api("GET", `/quests/zone/${this.currentZone}/${this.entityId}`);
          const available: any[] = availRes?.quests ?? [];
          if (available.length > 0) {
            const q = available[0];
            const acceptRes = await this.api("POST", "/quests/accept", {
              zoneId: this.currentZone,
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
            if (nextZone && nextZone !== this.currentZone) {
              console.log(`[agent:${this.userWallet.slice(0, 8)}] No quests left in ${this.currentZone}, traveling to ${nextZone}`);
              void this.logActivity(`No quests remaining — traveling to ${nextZone}`);
              await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: nextZone });
              this.currentScript = null;
              return;
            }
          }
        } catch {}
      }

      // 4. Progress kill/gather quests by fighting mobs or gathering
      const hasKillQuest = activeQuests.some(
        (aq: any) => !aq.complete && aq.quest?.objective?.type === "kill"
      );
      const hasGatherQuest = activeQuests.some(
        (aq: any) => !aq.complete && (aq.quest?.objective?.type === "gather" || aq.quest?.objective?.type === "craft")
      );

      if (hasKillQuest) {
        await this.doCombat(strategy);
      } else if (hasGatherQuest) {
        await this.doGathering(strategy);
      } else {
        // No active objectives — combat for XP while waiting
        await this.doCombat(strategy);
      }
    } catch (err: any) {
      console.debug(`[agent] questing tick: ${err.message?.slice(0, 60)}`);
      // Fallback to combat if quest system errors
      await this.doCombat(strategy);
    }
  }

  private async doCombat(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const trainingBusy = await this.learnNextTechnique();
      if (trainingBusy) return;

      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // Don't engage if HP is too low — disengage and let regen kick in
      const hpPct = (me.hp ?? 0) / Math.max(me.maxHp ?? 1, 1);
      const retreatThreshold: Record<AgentStrategy, number> = {
        aggressive: 0.15,
        balanced:   0.30,
        defensive:  0.50,
      };
      if (hpPct < retreatThreshold[strategy]) {
        // Override any existing attack order so the agent actually disengages.
        await this.api("POST", "/command", {
          zoneId: this.currentZone,
          entityId: this.entityId,
          action: "move",
          x: 150,
          y: 150,
        });
        void this.logActivity(`Low HP (${Math.round(hpPct * 100)}%) — disengaging`);
        return;
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
        zoneId: this.currentZone,
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
      if (!node) { await this.doCombat(strategy); return; }

      const [nodeId, nodeEntity] = node;
      const moving = await this.moveToEntity(me, nodeEntity);
      if (moving) return;

      if (nodeEntity.type === "ore-node") {
        // Ensure mining profession learned first
        await this.learnProfession("mining");
        await this.api("POST", "/mining/gather", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentZone,
          entityId: this.entityId,
          oreNodeId: nodeId,
        });
        void this.logActivity(`Gathered ore from ${nodeEntity.name ?? "ore node"}`);
      } else {
        // Ensure herbalism profession learned first
        await this.learnProfession("herbalism");
        await this.api("POST", "/herbalism/gather", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentZone,
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
      // Step 1: Learn alchemy if needed
      const learned = await this.learnProfession("alchemy");
      if (!learned) return; // still walking to trainer or no trainer

      // Step 2: Also learn herbalism (needed for materials)
      await this.learnProfession("herbalism");

      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // Step 3: Find alchemy lab
      const lab = this.findNearestEntity(entities, me,
        (e) => e.type === "alchemy-lab"
      );
      if (!lab) { await this.doGathering(strategy); return; }

      const [labId, labEntity] = lab;
      const moving = await this.moveToEntity(me, labEntity);
      if (moving) return;

      // Step 4: Get recipes and try to brew
      const recipesRes = await this.api("GET", "/alchemy/recipes");
      const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);
      if (recipes.length === 0) { await this.doGathering(strategy); return; }

      // Try recipes from simplest (tier 1) first
      for (const recipe of recipes) {
        try {
          await this.api("POST", "/alchemy/brew", {
            walletAddress: this.custodialWallet,
            zoneId: this.currentZone,
            entityId: this.entityId,
            alchemyLabId: labId,
            recipeId: recipe.recipeId ?? recipe.id,
          });
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Brewed ${recipe.name ?? recipe.recipeId}`);
          void this.logActivity(`Brewed ${recipe.name ?? recipe.recipeId}`);
          return;
        } catch {
          // Missing materials — try next recipe
        }
      }

      // No recipes craftable — go gather herbs for materials
      await this.doGathering(strategy);
    } catch (err: any) {
      console.debug(`[agent] alchemy tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doCooking(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId || !this.custodialWallet) return;
    try {
      // Learn cooking first
      const learned = await this.learnProfession("cooking");
      if (!learned) return;

      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      // Find campfire
      const campfire = this.findNearestEntity(entities, me,
        (e) => e.type === "campfire"
      );
      if (!campfire) { await this.doGathering(strategy); return; }

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
            zoneId: this.currentZone,
            entityId: this.entityId,
            campfireId,
            recipeId: recipe.recipeId ?? recipe.id,
          });
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Cooked ${recipe.name ?? recipe.recipeId}`);
          void this.logActivity(`Cooked ${recipe.name ?? recipe.recipeId}`);
          return;
        } catch {
          // Missing materials
        }
      }

      // No recipes possible — go gather
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
      if (!altar) { await this.doCombat(strategy); return; }

      const [altarId, altarEntity] = altar;
      const moving = await this.moveToEntity(me, altarEntity);
      if (moving) return;

      if (me.equipment?.weapon) {
        // Find an enchantment elixir from inventory
        const inv = await this.api("GET", `/wallet/${this.custodialWallet}/balance`);
        const elixir = (inv?.items ?? []).find((i: any) =>
          i.category === "enchantment-elixir" && Number(i.balance) > 0
        );
        if (!elixir) { await this.doAlchemy(strategy); return; }

        await this.api("POST", "/enchanting/apply", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentZone,
          entityId: this.entityId,
          altarId,
          enchantmentElixirTokenId: Number(elixir.tokenId),
          equipmentSlot: "weapon",
        });
      } else {
        await this.doGathering(strategy);
      }
    } catch (err: any) {
      console.debug(`[agent] enchanting tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doCrafting(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId || !this.custodialWallet) return;
    try {
      // Learn blacksmithing first
      await this.learnProfession("blacksmithing");

      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

      const forge = this.findNearestEntity(entities, me,
        (e) => e.type === "forge"
      );
      if (!forge) { await this.doCombat(strategy); return; }

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
            zoneId: this.currentZone,
            entityId: this.entityId,
            forgeId,
            recipeId: recipe.recipeId ?? recipe.id,
          });
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Crafted ${recipe.name ?? recipe.recipeId}`);
          void this.logActivity(`Crafted ${recipe.name ?? recipe.recipeId}`);
          return;
        } catch {
          // Missing materials
        }
      }

      // No recipes possible — go gather materials
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
      if (!merchant) { await this.doCombat(strategy); return; }

      const [merchantId, merchantEntity] = merchant;

      // Move to merchant if not in range
      const moving = await this.moveToEntity(me, merchantEntity);
      if (moving) return;

      // Fetch merchant catalog
      const shopData = await this.api("GET", `/shop/npc/${this.currentZone}/${merchantId}`);
      const items: any[] = shopData?.items ?? [];
      if (items.length === 0) { await this.doCombat(strategy); return; }

      // Check current equipment — identify empty slots
      const equipment = me.equipment ?? {};
      const emptySlots: string[] = [];
      for (const slot of ["weapon", "chest", "legs", "boots", "helm", "shoulders", "gloves", "belt"]) {
        if (!equipment[slot]) emptySlots.push(slot);
      }

      if (emptySlots.length === 0) {
        // Fully geared — fall back to combat
        await this.doCombat(strategy);
        return;
      }

      // Check gold balance
      let inv: any = null;
      try {
        inv = await this.api("GET", `/wallet/${this.custodialWallet}/balance`);
      } catch {}
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
      await this.doCombat(strategy);
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
      const targetZone = resolveZoneId(rawTargetZone);

      if (rawTargetZone && !targetZone) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Invalid travel target zone: ${rawTargetZone}`);
        void this.logActivity(`Unknown destination "${rawTargetZone}" — clearing travel target`);
        await patchAgentConfig(this.userWallet, { focus: "questing", targetZone: undefined });
        return;
      }

      if (!targetZone || targetZone === this.currentZone) {
        // Already arrived or no target — switch back to questing
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Arrived at ${this.currentZone}, switching to questing`);
        void this.logActivity(`Arrived at ${this.currentZone}, resuming questing`);
        await patchAgentConfig(this.userWallet, { focus: "questing", targetZone: undefined });
        return;
      }

      // Fetch neighbors to find a path
      const neighborsRes = await this.api("GET", `/neighbors/${this.currentZone}`);
      const neighbors: Array<{ zone: string; levelReq: number; type: string }> =
        neighborsRes?.neighbors ?? [];

      // Direct connection?
      const direct = neighbors.find((n) => n.zone === targetZone);
      if (direct) {
        const myLevel = (await this.getEntityState())?.level ?? 1;
        if (myLevel < direct.levelReq) {
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Need level ${direct.levelReq} for ${targetZone}, currently ${myLevel} — grinding`);
          void this.logActivity(`Need Lv${direct.levelReq} for ${targetZone} (Lv${myLevel}) — training here`);
          await this.doCombat(strategy);
          return;
        }

        // Issue travel command — server handles edge-walk vs portal routing
        await this.api("POST", "/command", {
          zoneId: this.currentZone,
          entityId: this.entityId,
          action: "travel",
          targetZone,
        });
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Traveling from ${this.currentZone} → ${targetZone}`);
        void this.logActivity(`Traveling ${this.currentZone} → ${targetZone}`);
        return;
      }

      // Not directly connected — find the next zone on the path toward targetZone
      const nextZone = this.findNextZoneOnPath(neighbors, targetZone);
      if (nextZone) {
        const myLevel = (await this.getEntityState())?.level ?? 1;
        const nextLevelReq = ZONE_LEVEL_REQUIREMENTS[nextZone] ?? 1;
        if (myLevel < nextLevelReq) {
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Need level ${nextLevelReq} for ${nextZone}, currently ${myLevel} — grinding`);
          void this.logActivity(`Need Lv${nextLevelReq} for ${nextZone} (Lv${myLevel}) — training here`);
          await this.doCombat(strategy);
          return;
        }

        await this.api("POST", "/command", {
          zoneId: this.currentZone,
          entityId: this.entityId,
          action: "travel",
          targetZone: nextZone,
        });
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Traveling ${this.currentZone} → ${nextZone} (en route to ${targetZone})`);
        void this.logActivity(`Traveling ${this.currentZone} → ${nextZone} (en route to ${targetZone})`);
        return;
      }

      // Can't find a path — fall back to combat
      console.log(`[agent:${this.userWallet.slice(0, 8)}] No path from ${this.currentZone} to ${targetZone}`);
      void this.logActivity(`No path from ${this.currentZone} to ${targetZone} — training here`);
      await this.doCombat(strategy);
    } catch (err: any) {
      console.debug(`[agent] travel tick: ${err.message?.slice(0, 80)}`);
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
      .filter((z) => z && z !== this.currentZone);
    if (directNeighbors.length === 0) return null;
    if (directNeighbors.includes(targetZone)) return targetZone;

    type Node = { zone: string; firstHop: string };
    const queue: Node[] = directNeighbors.map((zone) => ({ zone, firstHop: zone }));
    const visited = new Set<string>([this.currentZone, ...directNeighbors]);

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
    const zonesByLevel = Object.entries(ZONE_LEVEL_REQUIREMENTS)
      .sort(([, a], [, b]) => a - b);

    let bestZone: string | null = null;
    for (const [zone, req] of zonesByLevel) {
      if (level >= req) bestZone = zone;
    }
    return bestZone;
  }

  private async handleLowHp(entity: any, strategy: AgentStrategy): Promise<boolean> {
    if (!this.api || !this.entityId || !this.custodialWallet) return false;
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
    } catch {}
    const ownedItems: any[] = inv?.items ?? [];

    // Try food first (cooking/consume)
    const food = ownedItems.find((i: any) => i.category === "food" && Number(i.balance) > 0);
    if (food) {
      try {
        await this.api("POST", "/cooking/consume", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentZone,
          entityId: this.entityId,
          foodTokenId: Number(food.tokenId),
        });
        console.log(`[agent:${this.userWallet.slice(0, 8)}] [${strategy}] Ate ${food.name} at ${Math.round(hpPct * 100)}% HP`);
        void this.logActivity(`Ate ${food.name} (${Math.round(hpPct * 100)}% HP)`);
        return true;
      } catch {}
    }

    // Try potion (alchemy/consume)
    const potion = ownedItems.find((i: any) =>
      (i.category === "potion" || i.category === "consumable") && Number(i.balance) > 0
    );
    if (potion) {
      try {
        await this.api("POST", "/alchemy/consume", {
          walletAddress: this.custodialWallet,
          zoneId: this.currentZone,
          entityId: this.entityId,
          tokenId: Number(potion.tokenId),
        });
        console.log(`[agent:${this.userWallet.slice(0, 8)}] [${strategy}] Used ${potion.name} at ${Math.round(hpPct * 100)}% HP`);
        void this.logActivity(`Used ${potion.name} (${Math.round(hpPct * 100)}% HP)`);
        return true;
      } catch {}
    }

    // Flee threshold
    const fleeThreshold: Record<AgentStrategy, number> = {
      aggressive: 0.05,
      balanced:   0.15,
      defensive:  0.30,
    };

    if (hpPct < fleeThreshold[strategy]) {
      await this.api("POST", "/command", {
        zoneId: this.currentZone,
        entityId: this.entityId,
        action: "move",
        x: 150,
        y: 150,
      });
      console.log(`[agent:${this.userWallet.slice(0, 8)}] [${strategy}] Fleeing at ${Math.round(hpPct * 100)}% HP`);
      void this.logActivity(`Fleeing! (${Math.round(hpPct * 100)}% HP)`);
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
      try { inv = await this.api("GET", `/wallet/${this.custodialWallet}/balance`); } catch {}
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

      // Priority 1: No weapon + enough copper for starter gear → go shopping
      if (!hasWeapon && copper >= 10) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: no weapon, going shopping`);
        void this.logActivity("No weapon equipped — heading to shop");
        await patchAgentConfig(this.userWallet, { focus: "shopping" });
        return true;
      }

      // Priority 2: Low on consumables after combat → brew/cook some
      if (!hasFood && !hasPotions && hpPct < 0.7) {
        console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: no consumables, going to cook/brew`);
        void this.logActivity("Out of consumables — going to cook");
        await patchAgentConfig(this.userWallet, { focus: "cooking" });
        return true;
      }

      // Priority 3: Outleveled current zone → travel to next zone
      const myLevel = entity.level ?? 1;
      const currentZoneLevelReq = ZONE_LEVEL_REQUIREMENTS[this.currentZone] ?? 1;
      // If agent is 3+ levels above the zone's requirement, find the next zone
      if (myLevel >= currentZoneLevelReq + 3) {
        const nextZone = this.findNextZoneForLevel(myLevel);
        if (nextZone && nextZone !== this.currentZone) {
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Self-adapt: level ${myLevel} outleveled ${this.currentZone} (req ${currentZoneLevelReq}), traveling to ${nextZone}`);
          void this.logActivity(`Outleveled ${this.currentZone} (Lv${myLevel}) — traveling to ${nextZone}`);
          await patchAgentConfig(this.userWallet, { focus: "traveling", targetZone: nextZone });
          return true;
        }
      }

      return false;
    } catch {
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

    // Universal: level up
    const level = entity.level ?? 1;
    if (level > this.lastKnownLevel && this.lastKnownLevel > 0) {
      return { type: "level_up", detail: `Reached level ${level} — re-evaluating strategy` };
    }

    // Universal: arrived in a new zone
    if (this.currentZone !== this.lastKnownZone && this.lastKnownZone !== "") {
      return { type: "zone_arrived", detail: `Arrived in ${this.currentZone}` };
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
        if (this.currentScript.targetZone && this.currentScript.targetZone === this.currentZone) {
          return { type: "script_done", detail: `Arrived at destination: ${this.currentZone}` };
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
      this.lastKnownZone = this.currentZone;

      console.log(`[agent:${this.userWallet.slice(0, 8)}] Trigger [${trigger.type}]: ${trigger.detail}`);

      // Derive user's natural-language directive from focus
      const userDirective = focusToDirective(config.focus, config.targetZone);

      // Hard-respect focus when the runner has no script yet (startup/focus change).
      if (trigger.type === "no_script") {
        this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
        void this.logActivity(`[AI] ${this.currentScript.type}: ${this.currentScript.reason ?? ""}`);
      } else {
      try {
        const newScript = await runSupervisor(trigger, {
          entity,
          entities,
          entityId: this.entityId!,
          currentZone: this.currentZone,
          custodialWallet: this.custodialWallet!,
          currentScript: this.currentScript,
          recentActivities: this.recentActivities,
          userDirective,
          apiCall: this.api!,
        });
        this.currentScript = newScript;
        void this.logActivity(`[AI] ${newScript.type}: ${newScript.reason ?? ""}`);
      } catch (err: any) {
        console.warn(`[agent:${this.userWallet.slice(0, 8)}] Supervisor failed: ${err.message?.slice(0, 60)}`);
        // Fallback: derive a script from the current focus so the bot doesn't stop
        this.currentScript = focusToScript(config.focus, strategy, config.targetZone);
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
        // Read config fresh each tick
        const config = await getAgentConfig(this.userWallet);
        if (!config?.enabled) {
          if (!firstTickDone) onFirstTickFail(new Error("Agent config disabled"));
          this.running = false;
          break;
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
          console.log(`[agent:${this.userWallet.slice(0, 8)}] First tick OK — entity ${this.entityId} in ${this.currentZone}`);
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

        // Handle low HP first (strategy affects thresholds)
        const usedPotion = await this.handleLowHp(entity, strategy);
        if (usedPotion) { await sleep(TICK_MS); continue; }

        // ── Self-adaptation: periodically check if we should auto-adjust ──
        // Every 10 ticks (~12s), check situational needs
        const allowAutoAdapt = focus === "questing" || focus === "combat";
        if (allowAutoAdapt && this.ticksSinceFocusChange % 10 === 0 && this.ticksSinceFocusChange > 0) {
          const adapted = await this.checkSelfAdaptation(entity, strategy);
          if (adapted) { this.currentScript = null; await sleep(TICK_MS); continue; }
        }

        // Auto-repair if gear is badly damaged
        const repairing = await this.handleRepair(entity);
        if (repairing) { await sleep(TICK_MS); continue; }

        // If targetZone is set, push focus to traveling so supervisor picks it up.
        // Normalize or clear malformed zone labels from chat/tool output.
        const normalizedTargetZone = resolveZoneId(config.targetZone);
        if (config.targetZone && !normalizedTargetZone) {
          await patchAgentConfig(this.userWallet, { targetZone: undefined });
          this.currentScript = null;
        }
        if (normalizedTargetZone && normalizedTargetZone !== config.targetZone) {
          await patchAgentConfig(this.userWallet, { targetZone: normalizedTargetZone });
        }
        if (normalizedTargetZone && normalizedTargetZone !== this.currentZone && focus !== "traveling") {
          await patchAgentConfig(this.userWallet, { focus: "traveling" });
          this.currentScript = null; // supervisor will assign travel script
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
