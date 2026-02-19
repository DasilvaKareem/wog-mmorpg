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
  type AgentFocus,
  type AgentStrategy,
} from "./agentConfigStore.js";
import { exportCustodialWallet } from "./custodialWalletRedis.js";
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";

const API_URL = process.env.API_URL || "http://localhost:3000";
const TICK_MS = 1200;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type ApiCaller = ReturnType<typeof createAuthenticatedAPI>;

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

  constructor(userWallet: string) {
    this.userWallet = userWallet;
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

    // Check entity still alive
    try {
      const state = await this.api("GET", `/zones/${this.currentZone}`);
      if (state?.entities?.[this.entityId]) return true;
    } catch {}

    // Scan all zones
    try {
      const zones = await this.api("GET", "/state");
      for (const [zid, zdata] of Object.entries(zones.zones ?? {})) {
        const ents = (zdata as any).entities ?? {};
        if (ents[this.entityId]) {
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

  // ── Focus behaviours ──────────────────────────────────────────────────────

  private async doQuesting(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const state = await this.api("GET", `/zones/${this.currentZone}`);
      const npcId = Object.entries(state?.entities ?? {}).find(
        ([, e]: any) => e.type === "quest-giver"
      )?.[0];
      if (!npcId) return;

      const questsRes = await this.api("GET", `/quests/available/${this.currentZone}/${this.entityId}`);
      const available = questsRes?.quests ?? [];
      if (available.length === 0) {
        await this.doCombat(strategy);
        return;
      }

      const q = available[0];
      try {
        await this.api("POST", "/quests/accept", {
          zoneId: this.currentZone,
          playerId: this.entityId,
          questId: q.id,
        });
      } catch {
        // Already accepted — just progress it
      }

      await this.doCombat(strategy);
    } catch (err: any) {
      console.debug(`[agent] questing tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doCombat(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const state = await this.api("GET", `/zones/${this.currentZone}`);
      const entities = state?.entities ?? {};

      const me = entities[this.entityId];
      if (!me) return;

      const myLevel = me.level ?? 1;

      // How far above our level we'll engage depends on strategy:
      //   aggressive → attack mobs up to 5 levels above (risk for big XP)
      //   balanced   → attack mobs up to 2 levels above (current safe default)
      //   defensive  → only attack mobs at or below our level
      const levelCap: Record<AgentStrategy, number> = {
        aggressive: myLevel + 5,
        balanced:   myLevel + 2,
        defensive:  myLevel,
      };
      const maxMobLevel = levelCap[strategy];

      // Aggressive: prefer highest-level mob (most XP)
      // Balanced/defensive: prefer nearest mob
      const eligible = Object.entries(entities)
        .filter(([, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && (e.level ?? 1) <= maxMobLevel);

      if (eligible.length === 0) return;

      const sorted = eligible.sort(([, a]: any, [, b]: any) => {
        if (strategy === "aggressive") {
          // Highest level first (most XP), tie-break by distance
          const levelDiff = (b.level ?? 1) - (a.level ?? 1);
          if (levelDiff !== 0) return levelDiff;
        }
        // Nearest first
        return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
      });

      const [mobId, mob] = sorted[0] as [string, any];
      const dist = Math.hypot(mob.x - me.x, mob.y - me.y);
      if (dist > 80) {
        await this.api("POST", "/command", {
          zoneId: this.currentZone,
          entityId: this.entityId,
          action: "move",
          x: mob.x,
          y: mob.y,
        });
        return;
      }

      await this.api("POST", "/command", {
        zoneId: this.currentZone,
        entityId: this.entityId,
        action: "attack",
        targetId: mobId,
      });
    } catch (err: any) {
      console.debug(`[agent] combat tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doGathering(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const state = await this.api("GET", `/zones/${this.currentZone}`);
      const entities = state?.entities ?? {};
      const me = entities[this.entityId];
      if (!me) return;

      // Find nearest ore or flower node
      const nodes = Object.entries(entities)
        .filter(([, e]: any) => e.type === "ore-node" || e.type === "flower-node")
        .sort(([, a]: any, [, b]: any) => {
          const da = Math.hypot((a as any).x - me.x, (a as any).y - me.y);
          const db = Math.hypot((b as any).x - me.x, (b as any).y - me.y);
          return da - db;
        });

      if (nodes.length === 0) { await this.doCombat(strategy); return; }

      const [nodeId, node] = nodes[0] as [string, any];
      const dist = Math.hypot(node.x - me.x, node.y - me.y);

      if (dist > 60) {
        await this.api("POST", "/command", {
          zoneId: this.currentZone, entityId: this.entityId, action: "move",
          x: node.x, y: node.y,
        });
        return;
      }

      if (node.type === "ore-node") {
        await this.api("POST", "/mining/mine", {
          zoneId: this.currentZone, playerId: this.entityId, nodeId,
        });
      } else {
        await this.api("POST", "/herbalism/gather", {
          zoneId: this.currentZone, playerId: this.entityId, nodeId,
        });
      }
    } catch (err: any) {
      console.debug(`[agent] gathering tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doEnchanting(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const state = await this.api("GET", `/zones/${this.currentZone}`);
      const entities = state?.entities ?? {};
      const me = entities[this.entityId];
      if (!me) return;

      const enchanter = Object.entries(entities).find(([, e]: any) => e.type === "enchanter")?.[0];
      if (!enchanter) { await this.doCombat(strategy); return; }

      const enchNode = entities[enchanter] as any;
      const dist = Math.hypot(enchNode.x - me.x, enchNode.y - me.y);
      if (dist > 80) {
        await this.api("POST", "/command", {
          zoneId: this.currentZone, entityId: this.entityId, action: "move",
          x: enchNode.x, y: enchNode.y,
        });
        return;
      }

      if (me.equipment?.weapon) {
        await this.api("POST", "/enchanting/enchant", {
          zoneId: this.currentZone,
          playerId: this.entityId,
          enchanterEntityId: enchanter,
          tokenId: me.equipment.weapon.tokenId,
          slot: "weapon",
        });
      } else {
        await this.doGathering(strategy);
      }
    } catch (err: any) {
      console.debug(`[agent] enchanting tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async doCrafting(strategy: AgentStrategy): Promise<void> {
    if (!this.api || !this.entityId) return;
    try {
      const state = await this.api("GET", `/zones/${this.currentZone}`);
      const entities = state?.entities ?? {};
      const me = entities[this.entityId];
      if (!me) return;

      const crafter = Object.entries(entities).find(
        ([, e]: any) => e.type === "blacksmith" || e.type === "crafting-station"
      )?.[0];

      if (!crafter) { await this.doCombat(strategy); return; }

      const craftNode = entities[crafter] as any;
      const dist = Math.hypot(craftNode.x - me.x, craftNode.y - me.y);
      if (dist > 80) {
        await this.api("POST", "/command", {
          zoneId: this.currentZone, entityId: this.entityId, action: "move",
          x: craftNode.x, y: craftNode.y,
        });
        return;
      }

      const recipes = await this.api("GET", `/crafting/recipes/${this.currentZone}/${this.entityId}`);
      const available = (recipes?.recipes ?? []).filter((r: any) => r.canCraft);
      if (available.length === 0) { await this.doGathering(strategy); return; }

      const best = available[available.length - 1];
      await this.api("POST", "/crafting/forge", {
        zoneId: this.currentZone,
        playerId: this.entityId,
        crafterEntityId: crafter,
        recipeId: best.id,
      });
    } catch (err: any) {
      console.debug(`[agent] crafting tick: ${err.message?.slice(0, 60)}`);
    }
  }

  private async handleLowHp(entity: any, strategy: AgentStrategy): Promise<boolean> {
    if (!this.api || !this.entityId) return false;
    const hpPct = entity.hp / (entity.maxHp || 1);

    // HP threshold to trigger healing/flee depends on strategy:
    //   aggressive → only react at 15% HP (keep fighting until nearly dead)
    //   balanced   → react at 25% HP
    //   defensive  → react at 40% HP (heal early, always stay safe)
    const threshold: Record<AgentStrategy, number> = {
      aggressive: 0.15,
      balanced:   0.25,
      defensive:  0.40,
    };

    if (hpPct > threshold[strategy]) return false;

    // Try to use a health potion
    try {
      await this.api("POST", "/cooking/consume", {
        zoneId: this.currentZone,
        playerId: this.entityId,
        tokenId: 3,
      });
      console.log(`[agent:${this.userWallet.slice(0, 8)}] [${strategy}] Used potion at ${Math.round(hpPct * 100)}% HP`);
      return true;
    } catch {}

    // Flee threshold: aggressive never flees, defensive flees earlier
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
    }
    return false;
  }

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

        // Get entity state
        const entity = await this.getEntityState();
        if (!entity) {
          if (!firstTickDone) {
            onFirstTickFail(new Error("Could not read entity state from zone"));
            this.running = false;
            break;
          }
          await sleep(TICK_MS);
          continue;
        }

        // ── First tick verified — agent is alive and well ──
        if (!firstTickDone) {
          firstTickDone = true;
          console.log(`[agent:${this.userWallet.slice(0, 8)}] First tick OK — entity ${this.entityId} in ${this.currentZone}`);
          onFirstTick();
        }

        const strategy: AgentStrategy = config.strategy ?? "balanced";

        // Handle low HP first (strategy affects thresholds)
        const usedPotion = await this.handleLowHp(entity, strategy);
        if (usedPotion) { await sleep(TICK_MS); continue; }

        // Execute focus (strategy flows through to combat decisions)
        const focus: AgentFocus = config.focus;
        switch (focus) {
          case "questing":   await this.doQuesting(strategy); break;
          case "combat":     await this.doCombat(strategy); break;
          case "gathering":  await this.doGathering(strategy); break;
          case "enchanting": await this.doEnchanting(strategy); break;
          case "crafting":   await this.doCrafting(strategy); break;
          case "trading":    await this.doCombat(strategy); break;
          case "idle":       break;
        }
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
