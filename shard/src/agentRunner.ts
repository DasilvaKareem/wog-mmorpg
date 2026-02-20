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
import { exportCustodialWallet } from "./custodialWalletRedis.js";
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";
import { ZONE_LEVEL_REQUIREMENTS } from "./worldLayout.js";

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
  /** Tracks ticks since last focus change — used for self-adaptation */
  private ticksSinceFocusChange = 0;
  private lastFocus: AgentFocus = "questing";
  /** Tracks consecutive combat fallback ticks */
  private combatFallbackCount = 0;

  constructor(userWallet: string) {
    this.userWallet = userWallet;
  }

  /** Log an activity message to the agent's chat history (visible to spectators). */
  private async logActivity(text: string): Promise<void> {
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
      const zs = await this.getZoneState();
      if (!zs) return;
      const { entities, me } = zs;

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
      const goldBalance = Number(inv?.gold ?? 0);

      // For each empty slot, find cheapest matching item and buy+equip
      for (const slot of emptySlots) {
        // Match items by equipSlot or armorSlot
        const matching = items.filter((item: any) => {
          if (slot === "weapon") return item.equipSlot === "weapon" || item.category === "weapon";
          return item.armorSlot === slot || item.equipSlot === slot;
        }).sort((a: any, b: any) => (a.copperPrice ?? a.buyPrice ?? 9999) - (b.copperPrice ?? b.buyPrice ?? 9999));

        if (matching.length === 0) continue;

        const cheapest = matching[0];
        const price = cheapest.copperPrice ?? cheapest.buyPrice ?? 0;
        if (price > goldBalance) continue;

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
      const targetZone = config?.targetZone;

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
    // Build a simple zone ordering based on the known world graph.
    // The zones form a mostly linear chain with some branches.
    const ZONE_ORDER: Record<string, number> = {
      "village-square": 0,
      "wild-meadow": 1,
      "dark-forest": 2,
      "auroral-plains": 3,
      "emerald-woods": 4,
      "viridian-range": 5,
      "moondancer-glade": 6,
      "felsrock-citadel": 7,
      "lake-lumina": 8,
      "azurshard-chasm": 9,
    };

    const targetOrder = ZONE_ORDER[targetZone] ?? -1;
    const currentOrder = ZONE_ORDER[this.currentZone] ?? -1;

    if (targetOrder < 0 || currentOrder < 0) return null;

    // Pick the neighbor that's closest to the target in the ordering
    let bestZone: string | null = null;
    let bestDist = Infinity;
    for (const n of currentNeighbors) {
      const nOrder = ZONE_ORDER[n.zone] ?? -1;
      if (nOrder < 0) continue;
      const dist = Math.abs(nOrder - targetOrder);
      if (dist < bestDist) {
        bestDist = dist;
        bestZone = n.zone;
      }
    }
    return bestZone;
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
      const gold = Number(inv?.gold ?? 0);
      const hasFood = items.some((i: any) => i.category === "food" && Number(i.balance) > 0);
      const hasPotions = items.some((i: any) => (i.category === "potion" || i.category === "consumable") && Number(i.balance) > 0);
      const equipment = entity.equipment ?? {};
      const hasWeapon = Boolean(equipment.weapon);

      // Priority 1: No weapon + have gold → go shopping
      if (!hasWeapon && gold >= 10) {
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
      // If agent is 5+ levels above the zone's requirement, find the next zone
      if (myLevel >= currentZoneLevelReq + 5) {
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
        const focus: AgentFocus = config.focus;

        // Track focus changes
        if (focus !== this.lastFocus) {
          this.lastFocus = focus;
          this.ticksSinceFocusChange = 0;
          this.combatFallbackCount = 0;
          console.log(`[agent:${this.userWallet.slice(0, 8)}] Focus changed → ${focus} (${strategy})`);
          void this.logActivity(`Switching focus → ${focus}`);
        }
        this.ticksSinceFocusChange++;

        // Handle low HP first (strategy affects thresholds)
        const usedPotion = await this.handleLowHp(entity, strategy);
        if (usedPotion) { await sleep(TICK_MS); continue; }

        // ── Self-adaptation: periodically check if we should auto-adjust ──
        // Every 30 ticks (~36s), check situational needs
        if (focus !== "idle" && this.ticksSinceFocusChange % 30 === 0 && this.ticksSinceFocusChange > 0) {
          const adapted = await this.checkSelfAdaptation(entity, strategy);
          if (adapted) { await sleep(TICK_MS); continue; }
        }

        // Auto-repair if gear is badly damaged
        const repairing = await this.handleRepair(entity);
        if (repairing) { await sleep(TICK_MS); continue; }

        // If targetZone is set and we're not there yet, override focus to travel
        if (config.targetZone && config.targetZone !== this.currentZone && focus !== "traveling") {
          await patchAgentConfig(this.userWallet, { focus: "traveling" });
          await this.doTravel(strategy);
        } else {
          // Execute focus (strategy flows through to combat decisions)
          switch (focus) {
            case "questing":   await this.doQuesting(strategy); break;
            case "combat":     await this.doCombat(strategy); break;
            case "gathering":  await this.doGathering(strategy); break;
            case "enchanting": await this.doEnchanting(strategy); break;
            case "crafting":   await this.doCrafting(strategy); break;
            case "alchemy":    await this.doAlchemy(strategy); break;
            case "cooking":    await this.doCooking(strategy); break;
            case "trading":    await this.doShopping(strategy); break;
            case "shopping":   await this.doShopping(strategy); break;
            case "traveling":  await this.doTravel(strategy); break;
            case "idle":       break;
          }
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
