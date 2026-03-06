/**
 * Agent Survival — HP management, gear repair, and self-adaptation logic.
 * Extracted from AgentRunner to keep the main loop focused on orchestration.
 */

import { patchAgentConfig, type AgentFocus, type AgentStrategy } from "./agentConfigStore.js";
import { ZONE_LEVEL_REQUIREMENTS, getZoneConnections } from "../world/worldLayout.js";
import type { AgentContext } from "./agentUtils.js";

// ── Low HP handling ──────────────────────────────────────────────────────────

export async function handleLowHp(
  ctx: AgentContext,
  entity: any,
  strategy: AgentStrategy,
): Promise<boolean> {
  if (!ctx.currentCaps.retreatEnabled) return false;

  const hpPct = entity.hp / (entity.maxHp || 1);
  const threshold: Record<AgentStrategy, number> = {
    aggressive: 0.15,
    balanced: 0.25,
    defensive: 0.40,
  };
  if (hpPct > threshold[strategy]) return false;

  // Check inventory for consumables
  const { items: ownedItems } = await ctx.getWalletBalance();

  // Try food first
  const food = ownedItems.find((i: any) => i.category === "food" && Number(i.balance) > 0);
  if (food) {
    try {
      await ctx.api("POST", "/cooking/consume", {
        walletAddress: ctx.custodialWallet,
        zoneId: ctx.currentRegion,
        entityId: ctx.entityId,
        foodTokenId: Number(food.tokenId),
      });
      console.log(`[agent:${ctx.walletTag}] [${strategy}] Ate ${food.name} at ${Math.round(hpPct * 100)}% HP`);
      void ctx.logActivity(`Ate ${food.name} (${Math.round(hpPct * 100)}% HP)`);
      return true;
    } catch (err: any) {
      console.debug(`[agent:${ctx.walletTag}] eat food: ${err.message?.slice(0, 60)}`);
    }
  }

  // Try potion
  const potion = ownedItems.find(
    (i: any) => (i.category === "potion" || i.category === "consumable") && Number(i.balance) > 0,
  );
  if (potion) {
    try {
      await ctx.api("POST", "/alchemy/consume", {
        walletAddress: ctx.custodialWallet,
        zoneId: ctx.currentRegion,
        entityId: ctx.entityId,
        tokenId: Number(potion.tokenId),
      });
      console.log(`[agent:${ctx.walletTag}] [${strategy}] Used ${potion.name} at ${Math.round(hpPct * 100)}% HP`);
      void ctx.logActivity(`Used ${potion.name} (${Math.round(hpPct * 100)}% HP)`);
      return true;
    } catch (err: any) {
      console.debug(`[agent:${ctx.walletTag}] use potion: ${err.message?.slice(0, 60)}`);
    }
  }

  // Flee threshold
  const fleeThreshold: Record<AgentStrategy, number> = {
    aggressive: 0.05,
    balanced: 0.15,
    defensive: 0.30,
  };
  if (hpPct < fleeThreshold[strategy]) {
    ctx.issueCommand({ action: "move", x: 150, y: 150 });
    console.log(`[agent:${ctx.walletTag}] [${strategy}] Fleeing at ${Math.round(hpPct * 100)}% HP`);
    void ctx.logActivity(`Fleeing! (${Math.round(hpPct * 100)}% HP)`);
    return true;
  }
  return false;
}

// ── Gear repair ──────────────────────────────────────────────────────────────

export function needsRepair(entity: any): boolean {
  const equipment = entity.equipment ?? {};
  for (const eq of Object.values(equipment)) {
    const e = eq as any;
    if (!e || e.maxDurability <= 0) continue;
    if (e.broken || e.durability / e.maxDurability < 0.2) return true;
  }
  return false;
}

// ── Self-adaptation ──────────────────────────────────────────────────────────

export interface AdaptationState {
  currentFocus: AgentFocus;
  ticksSinceFocusChange: number;
  ticksInCurrentZone: number;
  findNextZoneForLevel(level: number): string | null;
}

export async function checkSelfAdaptation(
  ctx: AgentContext,
  entity: any,
  strategy: AgentStrategy,
  state: AdaptationState,
): Promise<boolean> {
  try {
    const hpPct = entity.hp / (entity.maxHp || 1);
    const { copper, items } = await ctx.getWalletBalance();
    const hasFood = items.some((i: any) => i.category === "food" && Number(i.balance) > 0);
    const hasPotions = items.some(
      (i: any) => (i.category === "potion" || i.category === "consumable") && Number(i.balance) > 0,
    );
    const equipment = entity.equipment ?? {};
    const hasWeapon = Boolean(equipment.weapon);
    const currentFocus = state.currentFocus;

    // Crafting escape hatch: stuck in gathering/crafting for 60+ ticks → return to questing
    if (
      (currentFocus === "gathering" || currentFocus === "crafting") &&
      state.ticksSinceFocusChange > 60
    ) {
      console.log(`[agent:${ctx.walletTag}] Self-adapt: stuck in ${currentFocus} for ${state.ticksSinceFocusChange} ticks, returning to questing`);
      void ctx.logActivity(`Done ${currentFocus} — back to questing`);
      await patchAgentConfig(ctx.userWallet, { focus: "questing" });
      return true;
    }

    // Priority 0: Early-game bootstrap — keep killing mobs until 100 copper
    if (copper < 100 && currentFocus !== "combat" && currentFocus !== "shopping") {
      console.log(`[agent:${ctx.walletTag}] Self-adapt: only ${copper}c, need 100c — staying in combat`);
      void ctx.logActivity(`Only ${copper}c — killing mobs for starter gold`);
      await patchAgentConfig(ctx.userWallet, { focus: "combat" });
      return true;
    }

    // Priority 1: No weapon + enough copper → go shopping
    if (!hasWeapon && copper >= 10) {
      console.log(`[agent:${ctx.walletTag}] Self-adapt: no weapon, going shopping`);
      void ctx.logActivity("No weapon equipped — heading to shop");
      await patchAgentConfig(ctx.userWallet, { focus: "shopping" });
      return true;
    }

    // Priority 1b: Missing armor pieces → go shopping
    const armorSlots = ["chest", "legs", "boots", "helm", "shoulders", "gloves", "belt"];
    const emptyArmorSlots = armorSlots.filter((s) => !equipment[s]);
    if (emptyArmorSlots.length >= 2 && copper >= 40 && currentFocus !== "shopping") {
      console.log(`[agent:${ctx.walletTag}] Self-adapt: ${emptyArmorSlots.length} empty armor slots, going shopping`);
      void ctx.logActivity(`Missing ${emptyArmorSlots.length} armor pieces — heading to shop`);
      await patchAgentConfig(ctx.userWallet, { focus: "shopping" });
      return true;
    }

    // Priority 2: Critically low HP with no consumables
    if (!hasFood && !hasPotions && hpPct < 0.3) {
      const hasCookingIngredients = items.some(
        (i: any) =>
          (i.category === "material" || i.category === "ingredient" || i.category === "meat" || i.category === "herb") &&
          Number(i.balance) > 0,
      );
      if (hasCookingIngredients) {
        console.log(`[agent:${ctx.walletTag}] Self-adapt: has ingredients, going to cook`);
        void ctx.logActivity("Has ingredients — cooking food");
        await patchAgentConfig(ctx.userWallet, { focus: "cooking" });
        return true;
      }
      if (copper >= 10) {
        console.log(`[agent:${ctx.walletTag}] Self-adapt: no consumables, shopping for food`);
        void ctx.logActivity("No consumables — shopping for food");
        await patchAgentConfig(ctx.userWallet, { focus: "shopping" });
        return true;
      }
      return false;
    }

    // Priority 2b: Periodic gathering → crafting cycle
    if (
      state.ticksSinceFocusChange > 100 &&
      copper >= 200 &&
      (currentFocus === "questing" || currentFocus === "combat")
    ) {
      console.log(`[agent:${ctx.walletTag}] Self-adapt: crafting cycle — ${state.ticksSinceFocusChange} ticks in ${currentFocus}`);
      void ctx.logActivity("Switching to gathering & crafting for gear upgrades");
      await patchAgentConfig(ctx.userWallet, { focus: "gathering" });
      return true;
    }

    // Priority 3: Outleveled current zone → travel
    const myLevel = entity.level ?? 1;
    const currentZoneLevelReq = ZONE_LEVEL_REQUIREMENTS[ctx.currentRegion] ?? 1;
    if (myLevel >= currentZoneLevelReq + 2) {
      const nextZone = state.findNextZoneForLevel(myLevel);
      if (nextZone && nextZone !== ctx.currentRegion) {
        console.log(`[agent:${ctx.walletTag}] Self-adapt: level ${myLevel} outleveled ${ctx.currentRegion}, traveling to ${nextZone}`);
        void ctx.logActivity(`Outleveled ${ctx.currentRegion} (Lv${myLevel}) — traveling to ${nextZone}`);
        await patchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone: nextZone });
        return true;
      }
    }

    // Priority 4: Roaming — been in same zone too long
    if (
      state.ticksInCurrentZone >= 200 &&
      (currentFocus === "questing" || currentFocus === "combat")
    ) {
      const neighbors = getZoneConnections(ctx.currentRegion).filter((z) => {
        const req = ZONE_LEVEL_REQUIREMENTS[z] ?? 1;
        return myLevel >= req && z !== ctx.currentRegion;
      });
      if (neighbors.length > 0) {
        const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
        console.log(`[agent:${ctx.walletTag}] Self-adapt: roaming after ${state.ticksInCurrentZone} ticks → ${pick}`);
        void ctx.logActivity(`Exploring new territory — heading to ${pick}`);
        await patchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone: pick });
        return true;
      }
    }

    return false;
  } catch (err: any) {
    console.debug(`[agent:${ctx.walletTag}] self-adapt: ${err.message?.slice(0, 60)}`);
    return false;
  }
}
