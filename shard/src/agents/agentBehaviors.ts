/**
 * Agent Behaviors — the 10 focus-specific behavior implementations.
 * Each function runs one tick of the behavior and is called from AgentRunner.executeCurrentScript().
 */

import { getAgentConfig, patchAgentConfig, type AgentStrategy } from "./agentConfigStore.js";
import { resolveRegionId, getRegionCenter, getZoneConnections, ZONE_LEVEL_REQUIREMENTS } from "../world/worldLayout.js";
import { getEntity as getWorldEntity } from "../world/zoneRuntime.js";
import { getClassById } from "../character/classes.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";
import { sendInboxMessage } from "./agentInbox.js";
import { pickLine } from "./agentDialogue.js";
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
} from "./agentUtils.js";

const MELEE_RANGE = 40;
const PROFESSION_HUB_ZONE = "village-square";
const PICKAXE_TOKENS: Record<number, number> = { 27: 1, 28: 2, 29: 3, 30: 4 };
const SICKLE_TOKENS: Record<number, number> = { 41: 1, 42: 2, 43: 3, 44: 4 };
const ENCHANTMENT_ELIXIR_TOKENS = new Set([55, 56, 57, 58, 59, 60, 61]);

/** Return the attack range for an entity based on its class, with a small buffer so
 *  the entity stops just inside range rather than right at the edge. */
function getCombatStopDist(me: any): number {
  if (me.classId) {
    const classDef = getClassById(me.classId);
    if (classDef) return Math.max(MELEE_RANGE - 5, classDef.attackRange - 10);
  }
  return MELEE_RANGE - 5;
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
): [string, any] | null {
  const matches = Object.entries(entities)
    .filter(([, e]) => {
      if (preference === "ore") return e.type === "ore-node";
      if (preference === "herb") return e.type === "flower-node";
      return e.type === "ore-node" || e.type === "flower-node";
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

    const sorted = eligible.sort(([, a]: any, [, b]: any) => {
      if (strategy === "aggressive") {
        const levelDiff = (b.level ?? 1) - (a.level ?? 1);
        if (levelDiff !== 0) return levelDiff;
      }
      return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    });

    // Navigate toward the best target — stop at class attack range so
    // ranged classes (ranger, mage, warlock, cleric) don't walk into melee.
    // Once in range, the zone runtime's auto-combat AI handles technique
    // selection and attacking automatically.
    const [, mob] = sorted[0] as [string, any];
    const stopDist = getCombatStopDist(me);
    const moving = await ctx.moveToEntity(me, mob, stopDist);
    if (moving) return actionProgressed(`Closing on ${mob.name ?? "mob"}`);
    void ctx.logActivity(`Fighting ${mob.name ?? "mob"} (Lv${mob.level ?? "?"})`);
    return actionProgressed(`Fighting ${mob.name ?? "mob"}`);
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
        return actionCompleted(`Mined ${nodeEntity.name ?? "ore node"}`);
      } catch (err: any) {
        const reason = formatAgentError(err);
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
        return actionCompleted(`Gathered ${nodeEntity.name ?? "flower node"}`);
      } catch (err: any) {
        const reason = formatAgentError(err);
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

    // Set travel state directly on the entity (bypasses HTTP /command to avoid
    // silent auth/network failures that were preventing travel from working)
    const entity = getWorldEntity(ctx.entityId);
    if (!entity) {
      console.log(`[agent:${ctx.walletTag}] Travel failed: entity ${ctx.entityId} not found in world`);
      return actionBlocked(`Travel failed: entity ${ctx.entityId} not found`, {
        failureKey: `travel:entity:${ctx.entityId}`,
      });
    }
    entity.order = { action: "move", x: center.x, y: center.z };
    entity.travelTargetZone = targetZone;
    entity.gotoMode = true;
    console.log(`[agent:${ctx.walletTag}] Traveling ${ctx.currentRegion} → ${targetZone} (order → ${center.x},${center.z})`);
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
              reputationManager.submitFeedback(
                ctx.userWallet, ReputationCategory.Agent,
                Math.max(1, Math.floor((completeRes.rewards?.xp ?? 50) / 50)),
                `Agent completed quest: ${aq.quest?.title ?? "unknown"}`,
              );
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

    // 3. Accept new quests
    const currentActive = activeQuests.filter((aq: any) => !aq.complete).length;
    if (currentActive < 3) {
      try {
        const availRes = await ctx.api("GET", `/quests/zone/${ctx.currentRegion}/${ctx.entityId}`);
        const available: any[] = availRes?.quests ?? [];
        if (available.length > 0) {
          const q = available[0];
          const acceptRes = await ctx.api("POST", "/quests/accept", {
            zoneId: ctx.currentRegion, playerId: ctx.entityId, questId: q.questId,
          });
          if (acceptRes?.accepted) {
            void ctx.logActivity(`Accepted quest: "${q.title}" from ${q.npcName}`);
            // Tell summoner what quest we're doing next
            const agentName = me.name ?? "Agent";
            const origin = me.origin ?? undefined;
            const classId = me.classId ?? undefined;
            const acceptLine = pickLine(origin, classId, "summon_quest_accept")
              ?? `Just picked up a new quest: "${q.title}". Should I go for it?`;
            const acceptBody = acceptLine.replace(/\{detail\}/g, q.title ?? "a quest");
            void sendInboxMessage({
              from: ctx.custodialWallet,
              fromName: agentName,
              to: ctx.userWallet,
              type: "direct",
              body: acceptBody,
            });
            return actionCompleted(`Accepted quest ${q.title}`);
          }
        } else if (currentActive === 0) {
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
        console.debug(`[agent:${ctx.walletTag}] quest accept: ${err.message?.slice(0, 60)}`);
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
      return doQuestCombat(ctx, strategy, questMobNames);
    } else if (hasGatherQuest) {
      void ctx.logActivity("Gathering resources for quest");
      return doGathering(ctx, strategy);
    } else {
      return fallbackToCombat(ctx, "No quest objectives to work on", strategy);
    }
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] questing tick: ${reason.slice(0, 60)}`);
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

    // Sort: quest mobs first, then by distance
    const sorted = eligible.sort(([, a]: any, [, b]: any) => {
      const aIsQuest = questMobNames.has((a.name ?? "").toLowerCase()) ? 0 : 1;
      const bIsQuest = questMobNames.has((b.name ?? "").toLowerCase()) ? 0 : 1;
      if (aIsQuest !== bIsQuest) return aIsQuest - bIsQuest;
      return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    });

    const [, mob] = sorted[0] as [string, any];
    const isQuestTarget = questMobNames.has((mob.name ?? "").toLowerCase());
    const stopDist = getCombatStopDist(me);
    const moving = await ctx.moveToEntity(me, mob, stopDist);
    if (moving) return actionProgressed(`Moving to ${mob.name ?? "mob"}`);
    void ctx.logActivity(isQuestTarget
      ? `Hunting ${mob.name} for quest (Lv${mob.level ?? "?"})`
      : `Fighting ${mob.name ?? "mob"} (Lv${mob.level ?? "?"})`);
    return actionProgressed(`Engaging ${mob.name ?? "mob"}`);
  } catch (err: any) {
    const reason = formatAgentError(err);
    console.debug(`[agent] quest combat tick: ${reason.slice(0, 60)}`);
    return actionBlocked(reason, { failureKey: `quest-combat:error:${ctx.currentRegion}` });
  }
}

// ── Shared helper ────────────────────────────────────────────────────────────

async function fallbackToCombat(
  ctx: AgentContext,
  reason: string,
  strategy: AgentStrategy,
): Promise<ActionResult> {
  void ctx.logActivity(`${reason} — fighting to earn XP/gold`);
  ctx.setScript({ type: "combat", maxLevelOffset: 1, reason: `Farming gold: ${reason}` });
  const result = await doCombat(ctx, strategy);
  return result.status === "idle" ? actionProgressed(reason) : result;
}
