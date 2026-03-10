/**
 * Agent Behaviors — the 10 focus-specific behavior implementations.
 * Each function runs one tick of the behavior and is called from AgentRunner.executeCurrentScript().
 */

import { getAgentConfig, patchAgentConfig, type AgentStrategy } from "./agentConfigStore.js";
import { resolveRegionId, getRegionCenter, getZoneConnections, ZONE_LEVEL_REQUIREMENTS } from "../world/worldLayout.js";
import { getEntity as getWorldEntity } from "../world/zoneRuntime.js";
import { reputationManager, ReputationCategory } from "../economy/reputationManager.js";
import { isQuestNpc } from "../social/questSystem.js";
import type { AgentContext } from "./agentUtils.js";

// ── Combat ───────────────────────────────────────────────────────────────────

export async function doCombat(
  ctx: AgentContext,
  strategy: AgentStrategy,
  learnNextTechnique?: () => Promise<{ ok: boolean; reason: string }>,
): Promise<void> {
  try {
    if (ctx.currentCaps.techniquesEnabled && learnNextTechnique) {
      const trainResult = await learnNextTechnique();
      if (trainResult.ok) return;
    }

    const zs = await ctx.getZoneState();
    if (!zs) return;
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
        return;
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
    if (eligible.length === 0) return;

    const sorted = eligible.sort(([, a]: any, [, b]: any) => {
      if (strategy === "aggressive") {
        const levelDiff = (b.level ?? 1) - (a.level ?? 1);
        if (levelDiff !== 0) return levelDiff;
      }
      return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    });

    // Navigate toward the best target. Once in range, the zone runtime's
    // auto-combat AI handles technique selection and attacking — it picks
    // buffs, heals, debuffs, or the strongest attack automatically.
    const [, mob] = sorted[0] as [string, any];
    const moving = await ctx.moveToEntity(me, mob);
    if (!moving) {
      void ctx.logActivity(`Fighting ${mob.name ?? "mob"} (Lv${mob.level ?? "?"})`);
    }
  } catch (err: any) {
    console.debug(`[agent] combat tick: ${err.message?.slice(0, 60)}`);
  }
}

// ── Gathering ────────────────────────────────────────────────────────────────

export async function doGathering(ctx: AgentContext, strategy: AgentStrategy): Promise<void> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return;
    const { entities, me } = zs;

    const node = ctx.findNearestEntity(entities, me,
      (e) => e.type === "ore-node" || e.type === "flower-node",
    );
    if (!node) {
      await fallbackToCombat(ctx, "No resource nodes in this zone", strategy);
      return;
    }

    const [nodeId, nodeEntity] = node;
    const moving = await ctx.moveToEntity(me, nodeEntity);
    if (moving) return;

    if (nodeEntity.type === "ore-node") {
      await ctx.api("POST", "/mining/gather", {
        walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
        entityId: ctx.entityId, oreNodeId: nodeId,
      });
      void ctx.logActivity(`Gathered ore from ${nodeEntity.name ?? "ore node"}`);
    } else {
      await ctx.api("POST", "/herbalism/gather", {
        walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
        entityId: ctx.entityId, flowerNodeId: nodeId,
      });
      void ctx.logActivity(`Gathered herb from ${nodeEntity.name ?? "flower node"}`);
    }
  } catch (err: any) {
    console.debug(`[agent] gathering tick: ${err.message?.slice(0, 60)}`);
  }
}

// ── Alchemy ──────────────────────────────────────────────────────────────────

export async function doAlchemy(ctx: AgentContext, strategy: AgentStrategy): Promise<void> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return;
    const { entities, me } = zs;

    const lab = ctx.findNearestEntity(entities, me, (e) => e.type === "alchemy-lab");
    if (!lab) {
      void ctx.logActivity("No alchemy lab here — gathering herbs instead");
      await doGathering(ctx, strategy);
      return;
    }

    const [labId, labEntity] = lab;
    const moving = await ctx.moveToEntity(me, labEntity);
    if (moving) return;

    const recipesRes = await ctx.api("GET", "/alchemy/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);
    if (recipes.length === 0) {
      void ctx.logActivity("No alchemy recipes available — gathering materials");
      await doGathering(ctx, strategy);
      return;
    }

    for (const recipe of recipes) {
      try {
        await ctx.api("POST", "/alchemy/brew", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, alchemyLabId: labId,
          recipeId: recipe.recipeId ?? recipe.id,
        });
        console.log(`[agent:${ctx.walletTag}] Brewed ${recipe.name ?? recipe.recipeId}`);
        void ctx.logActivity(`Brewed ${recipe.name ?? recipe.recipeId}`);
        return;
      } catch (err: any) {
        console.debug(`[agent:${ctx.walletTag}] brew ${recipe.name ?? recipe.recipeId}: ${err.message?.slice(0, 60)}`);
      }
    }

    void ctx.logActivity("Missing ingredients for all potions — gathering herbs");
    await doGathering(ctx, strategy);
  } catch (err: any) {
    console.debug(`[agent] alchemy tick: ${err.message?.slice(0, 60)}`);
  }
}

// ── Cooking ──────────────────────────────────────────────────────────────────

export async function doCooking(ctx: AgentContext, strategy: AgentStrategy): Promise<void> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return;
    const { entities, me } = zs;

    const campfire = ctx.findNearestEntity(entities, me, (e) => e.type === "campfire");
    if (!campfire) {
      void ctx.logActivity("No campfire here — gathering ingredients instead");
      await doGathering(ctx, strategy);
      return;
    }

    const [campfireId, campfireEntity] = campfire;
    const moving = await ctx.moveToEntity(me, campfireEntity);
    if (moving) return;

    const recipesRes = await ctx.api("GET", "/cooking/recipes");
    const recipes = recipesRes?.recipes ?? [];
    for (const recipe of recipes) {
      try {
        await ctx.api("POST", "/cooking/cook", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, campfireId,
          recipeId: recipe.recipeId ?? recipe.id,
        });
        console.log(`[agent:${ctx.walletTag}] Cooked ${recipe.name ?? recipe.recipeId}`);
        void ctx.logActivity(`Cooked ${recipe.name ?? recipe.recipeId}`);
        return;
      } catch (err: any) {
        console.debug(`[agent:${ctx.walletTag}] cook ${recipe.name ?? recipe.recipeId}: ${err.message?.slice(0, 60)}`);
      }
    }

    void ctx.logActivity("Can't cook anything — missing ingredients, going to gather");
    await doGathering(ctx, strategy);
  } catch (err: any) {
    console.debug(`[agent] cooking tick: ${err.message?.slice(0, 60)}`);
  }
}

// ── Enchanting ───────────────────────────────────────────────────────────────

export async function doEnchanting(ctx: AgentContext, strategy: AgentStrategy): Promise<void> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return;
    const { entities, me } = zs;

    const altar = ctx.findNearestEntity(entities, me, (e) => e.type === "enchanting-altar");
    if (!altar) {
      await fallbackToCombat(ctx, "No enchanting altar in this zone", strategy);
      return;
    }

    const [altarId, altarEntity] = altar;
    const moving = await ctx.moveToEntity(me, altarEntity);
    if (moving) return;

    if (me.equipment?.weapon) {
      const { items } = await ctx.getWalletBalance();
      const elixir = items.find((i: any) => i.category === "enchantment-elixir" && Number(i.balance) > 0);
      if (!elixir) {
        void ctx.logActivity("No enchantment elixirs — brewing some first");
        await doAlchemy(ctx, strategy);
        return;
      }

      await ctx.api("POST", "/enchanting/apply", {
        walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
        entityId: ctx.entityId, altarId,
        enchantmentElixirTokenId: Number(elixir.tokenId),
        equipmentSlot: "weapon",
      });
    } else {
      void ctx.logActivity("No weapon to enchant — gathering materials instead");
      await doGathering(ctx, strategy);
    }
  } catch (err: any) {
    console.debug(`[agent] enchanting tick: ${err.message?.slice(0, 60)}`);
  }
}

// ── Crafting ─────────────────────────────────────────────────────────────────

export async function doCrafting(ctx: AgentContext, strategy: AgentStrategy): Promise<void> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return;
    const { entities, me } = zs;

    const forge = ctx.findNearestEntity(entities, me, (e) => e.type === "forge");
    if (!forge) {
      await fallbackToCombat(ctx, "No forge in this zone", strategy);
      return;
    }

    const [forgeId, forgeEntity] = forge;
    const moving = await ctx.moveToEntity(me, forgeEntity);
    if (moving) return;

    const recipesRes = await ctx.api("GET", "/crafting/recipes");
    const recipes = Array.isArray(recipesRes) ? recipesRes : (recipesRes?.recipes ?? []);

    for (const recipe of recipes) {
      try {
        await ctx.api("POST", "/crafting/forge", {
          walletAddress: ctx.custodialWallet, zoneId: ctx.currentRegion,
          entityId: ctx.entityId, forgeId,
          recipeId: recipe.recipeId ?? recipe.id,
        });
        console.log(`[agent:${ctx.walletTag}] Crafted ${recipe.name ?? recipe.recipeId}`);
        void ctx.logActivity(`Crafted ${recipe.name ?? recipe.recipeId}`);
        return;
      } catch (err: any) {
        console.debug(`[agent:${ctx.walletTag}] craft ${recipe.name ?? recipe.recipeId}: ${err.message?.slice(0, 60)}`);
      }
    }

    void ctx.logActivity("Missing materials for all recipes — gathering ore");
    await doGathering(ctx, strategy);
  } catch (err: any) {
    console.debug(`[agent] crafting tick: ${err.message?.slice(0, 60)}`);
  }
}

// ── Shopping ─────────────────────────────────────────────────────────────────

export async function doShopping(ctx: AgentContext, strategy: AgentStrategy): Promise<void> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return;
    const { entities, me } = zs;

    const merchant = ctx.findNearestEntity(entities, me, (e) => e.type === "merchant");
    if (!merchant) {
      await fallbackToCombat(ctx, "No merchants in this zone", strategy);
      return;
    }

    const [merchantId, merchantEntity] = merchant;
    const moving = await ctx.moveToEntity(me, merchantEntity);
    if (moving) return;

    const shopData = await ctx.api("GET", `/shop/npc/${merchantId}`);
    const items: any[] = shopData?.items ?? [];
    if (items.length === 0) {
      await fallbackToCombat(ctx, "Merchant has nothing to sell", strategy);
      return;
    }

    const equipment = me.equipment ?? {};
    const emptySlots: string[] = [];
    for (const slot of ["weapon", "chest", "legs", "boots", "helm", "shoulders", "gloves", "belt"]) {
      if (!equipment[slot]) emptySlots.push(slot);
    }

    if (emptySlots.length === 0) {
      void ctx.logActivity("Fully geared up — back to fighting");
      await doCombat(ctx, strategy);
      return;
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

      const tokenId = Number(cheapest.tokenId);
      const bought = await ctx.buyItem(tokenId);
      if (!bought) continue;

      await ctx.equipItem(tokenId);
      console.log(`[agent:${ctx.walletTag}] Shopping: bought+equipped ${cheapest.name ?? tokenId} for slot=${slot}`);
      void ctx.logActivity(`Bought & equipped ${cheapest.name ?? `token #${tokenId}`} (${slot})`);
      return; // one purchase per tick
    }

    await fallbackToCombat(ctx, "Can't afford any upgrades right now", strategy);
  } catch (err: any) {
    console.debug(`[agent] shopping tick: ${err.message?.slice(0, 60)}`);
  }
}

// ── Travel ───────────────────────────────────────────────────────────────────

export async function doTravel(ctx: AgentContext, _strategy: AgentStrategy): Promise<void> {
  try {
    const config = await getAgentConfig(ctx.userWallet);
    const rawTargetZone = config?.targetZone;
    const targetZone = resolveRegionId(rawTargetZone);

    if (rawTargetZone && !targetZone) {
      console.log(`[agent:${ctx.walletTag}] Invalid travel target zone: ${rawTargetZone}`);
      void ctx.logActivity(`Unknown destination "${rawTargetZone}" — clearing travel target`);
      await patchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
      return;
    }

    if (!targetZone || targetZone === ctx.currentRegion) {
      console.log(`[agent:${ctx.walletTag}] Arrived at ${ctx.currentRegion}, switching to questing`);
      void ctx.logActivity(`Arrived at ${ctx.currentRegion}, resuming questing`);
      await patchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
      return;
    }

    const center = getRegionCenter(targetZone);
    if (!center) {
      console.log(`[agent:${ctx.walletTag}] Unknown region: ${targetZone}`);
      await patchAgentConfig(ctx.userWallet, { focus: "questing", targetZone: undefined });
      return;
    }

    // Set travel state directly on the entity (bypasses HTTP /command to avoid
    // silent auth/network failures that were preventing travel from working)
    const entity = getWorldEntity(ctx.entityId);
    if (!entity) {
      console.log(`[agent:${ctx.walletTag}] Travel failed: entity ${ctx.entityId} not found in world`);
      return;
    }
    entity.order = { action: "move", x: center.x, y: center.z };
    entity.travelTargetZone = targetZone;
    entity.gotoMode = true;
    console.log(`[agent:${ctx.walletTag}] Traveling ${ctx.currentRegion} → ${targetZone} (order → ${center.x},${center.z})`);
    void ctx.logActivity(`Traveling ${ctx.currentRegion} → ${targetZone}`);
  } catch (err: any) {
    console.log(`[agent:${ctx.walletTag}] travel tick ERROR: ${err.message?.slice(0, 120)}`);
  }
}

// ── Goto NPC ─────────────────────────────────────────────────────────────────

export async function doGotoNpc(
  ctx: AgentContext,
  findNextZoneOnPath: (neighbors: Array<{ zone: string }>, targetZone: string) => string | null,
): Promise<void> {
  try {
    ctx.setEntityGotoMode(true);

    const config = await getAgentConfig(ctx.userWallet);
    const target = config?.gotoTarget;
    if (!target) {
      ctx.setEntityGotoMode(false);
      await patchAgentConfig(ctx.userWallet, { gotoTarget: undefined });
      ctx.setScript(null);
      return;
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
      }
      return;
    }

    // In the right zone — find the entity
    const zs = await ctx.getZoneState();
    if (!zs) return;
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
      return;
    }

    const moving = await ctx.moveToEntity(me, targetEntity);
    if (moving) {
      void ctx.logActivity(`Walking to ${targetName ?? "NPC"}`);
      return;
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
        void ctx.logActivity(`Could not learn ${profession}: ${learnErr.message?.slice(0, 60)}`);
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
        void ctx.logActivity(`Could not learn technique: ${learnErr.message?.slice(0, 60)}`);
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
  } catch (err: any) {
    ctx.setEntityGotoMode(false);
    console.debug(`[agent] doGotoNpc: ${err.message?.slice(0, 60)}`);
  }
}

// ── Questing ─────────────────────────────────────────────────────────────────

export async function doQuesting(
  ctx: AgentContext,
  strategy: AgentStrategy,
  findNextZoneForLevel: (level: number) => string | null,
): Promise<void> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return;
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
          const moving = await ctx.moveToEntity(me, npcEntity);
          if (moving) {
            void ctx.logActivity(`Walking to ${aq.quest?.npcId} to turn in "${aq.quest?.title}"`);
            return;
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
              return;
            }
          } catch (err: any) {
            console.debug(`[agent:${ctx.walletTag}] quest complete: ${err.message?.slice(0, 60)}`);
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
          const moving = await ctx.moveToEntity(me, npcEntity);
          if (moving) {
            void ctx.logActivity(`Walking to ${targetNpcName} for talk quest`);
            return;
          }
          try {
            await ctx.api("POST", "/quests/talk", {
              zoneId: ctx.currentRegion, playerId: ctx.entityId, npcEntityId,
            });
            void ctx.logActivity(`Talked to ${targetNpcName} for "${tq.quest?.title}"`);
            return;
          } catch (err: any) {
            console.debug(`[agent:${ctx.walletTag}] quest talk: ${err.message?.slice(0, 60)}`);
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
          }
        } else if (currentActive === 0) {
          const myLevel = me.level ?? 1;
          const nextZone = findNextZoneForLevel(myLevel);
          if (nextZone && nextZone !== ctx.currentRegion) {
            console.log(`[agent:${ctx.walletTag}] No quests left in ${ctx.currentRegion}, traveling to ${nextZone}`);
            void ctx.logActivity(`No quests remaining — traveling to ${nextZone}`);
            await patchAgentConfig(ctx.userWallet, { focus: "traveling", targetZone: nextZone });
            ctx.setScript(null);
            return;
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
      await doQuestCombat(ctx, strategy, questMobNames);
    } else if (hasGatherQuest) {
      void ctx.logActivity("Gathering resources for quest");
      await doGathering(ctx, strategy);
    } else {
      await fallbackToCombat(ctx, "No quest objectives to work on", strategy);
    }
  } catch (err: any) {
    console.debug(`[agent] questing tick: ${err.message?.slice(0, 60)}`);
    await fallbackToCombat(ctx, "Quest system error", strategy);
  }
}

// ── Quest-aware combat ──────────────────────────────────────────────────────

/** Like doCombat but prioritizes mobs whose names match active kill quests. */
async function doQuestCombat(
  ctx: AgentContext,
  strategy: AgentStrategy,
  questMobNames: Set<string>,
): Promise<void> {
  try {
    const zs = await ctx.getZoneState();
    if (!zs) return;
    const { entities, me } = zs;

    const myLevel = me.level ?? 1;
    const maxMobLevel = myLevel + (strategy === "aggressive" ? 5 : strategy === "defensive" ? 0 : 2);

    const eligible = Object.entries(entities).filter(
      ([, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && (e.level ?? 1) <= maxMobLevel,
    );
    if (eligible.length === 0) return;

    // Sort: quest mobs first, then by distance
    const sorted = eligible.sort(([, a]: any, [, b]: any) => {
      const aIsQuest = questMobNames.has((a.name ?? "").toLowerCase()) ? 0 : 1;
      const bIsQuest = questMobNames.has((b.name ?? "").toLowerCase()) ? 0 : 1;
      if (aIsQuest !== bIsQuest) return aIsQuest - bIsQuest;
      return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    });

    const [, mob] = sorted[0] as [string, any];
    const isQuestTarget = questMobNames.has((mob.name ?? "").toLowerCase());
    const moving = await ctx.moveToEntity(me, mob);
    if (!moving) {
      void ctx.logActivity(isQuestTarget
        ? `Hunting ${mob.name} for quest (Lv${mob.level ?? "?"})`
        : `Fighting ${mob.name ?? "mob"} (Lv${mob.level ?? "?"})`);
    }
  } catch (err: any) {
    console.debug(`[agent] quest combat tick: ${err.message?.slice(0, 60)}`);
  }
}

// ── Shared helper ────────────────────────────────────────────────────────────

async function fallbackToCombat(
  ctx: AgentContext,
  reason: string,
  strategy: AgentStrategy,
): Promise<void> {
  void ctx.logActivity(`${reason} — fighting to earn XP/gold`);
  ctx.setScript({ type: "combat", maxLevelOffset: 1, reason: `Farming gold: ${reason}` });
  await doCombat(ctx, strategy);
}
