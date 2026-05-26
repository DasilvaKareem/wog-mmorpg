import { logZoneEvent } from "../../world/zoneEvents.js";
import { emitAgentChat } from "../agentDialogue.js";
import {
  actionBlocked,
  actionCompleted,
  actionIdle,
  actionProgressed,
  formatAgentError,
  type ActionResult,
  type AgentContext,
} from "../agentUtils.js";
import type { BotScript } from "../../types/botScriptTypes.js";

const PROFESSION_HUB_ZONE = "village-square";

const SKINNING_KNIFE_TOKENS: Record<number, number> = {
  76: 1,
  77: 2,
  78: 3,
  79: 4,
};

function skinningKnifeTier(tokenId: number | undefined): number {
  return tokenId ? (SKINNING_KNIFE_TOKENS[tokenId] ?? 0) : 0;
}

async function ensureSkinningKnife(ctx: AgentContext, me: any): Promise<boolean> {
  const equipped = me.equipment?.weapon;
  if (
    equipped
    && !equipped.broken
    && Number(equipped.durability ?? 0) > 0
    && skinningKnifeTier(Number(equipped.tokenId)) > 0
  ) {
    return true;
  }

  const { items } = await ctx.getWalletBalance();
  const knife = items
    .filter((item: any) => skinningKnifeTier(Number(item.tokenId)) > 0 && Number(item.balance ?? 0) > 0)
    .sort((a: any, b: any) => skinningKnifeTier(Number(b.tokenId)) - skinningKnifeTier(Number(a.tokenId)))[0];

  if (!knife) {
    // No knife anywhere — enqueue a hub detour so the agent buys one.
    // Without this the caller loops forever on "Preparing skinning knife".
    if (ctx.currentRegion !== PROFESSION_HUB_ZONE) {
      const home = ctx.homeZone ?? ctx.currentRegion;
      const chain: BotScript[] = [
        { type: "travel", targetZone: PROFESSION_HUB_ZONE, reason: "Buy skinning knife" },
        { type: "shop", reason: "Buy skinning knife at hub" },
      ];
      if (home && home !== PROFESSION_HUB_ZONE) {
        chain.push({ type: "travel", targetZone: home, reason: `Return to ${home}` });
        chain.push({ type: "quest", reason: `Resume skinning in ${home}` });
      }
      await ctx.enqueueActions(chain, true);
      void ctx.logActivity(`No skinning knife — traveling to ${PROFESSION_HUB_ZONE} to buy one`);
    } else {
      void ctx.logActivity("No skinning knife — need to buy from a merchant here");
    }
    return false;
  }

  const equippedKnife = await ctx.equipItem(Number(knife.tokenId));
  if (equippedKnife) void ctx.logActivity(`Equipped ${knife.name ?? "skinning knife"}`);
  return false;
}

export async function doSkinning(ctx: AgentContext): Promise<ActionResult> {
  try {
    const learned = await ctx.learnProfession("skinning");
    if (!learned) {
      const failure = ctx.getLastLearnFailure("skinning");
      if (failure?.category === "strategic") {
        // Unrecoverable: insufficient gold, wrong class, etc. Surface this to
        // the circuit breaker so the supervisor rotates focus to combat / gold
        // grinding instead of pinning the agent on skinning forever.
        return actionBlocked(`Skinning learn blocked: ${failure.reason}`, {
          failureKey: "skinning:learn-blocked",
          endpoint: "/professions/learn",
          category: "strategic",
        });
      }
      return actionProgressed("Working toward skinning access");
    }

    const zs = await ctx.getZoneState();
    if (!zs) return actionIdle("Zone state unavailable");
    const { me } = zs;

    const knifeReady = await ensureSkinningKnife(ctx, me);
    if (!knifeReady) {
      return actionProgressed("Preparing skinning knife");
    }

    const corpsesRes = await ctx.api("GET", `/skinning/corpses?region=${encodeURIComponent(ctx.currentRegion)}`);
    const corpses: any[] = corpsesRes?.corpses ?? [];
    const corpse = corpses
      .filter((c) => !ctx.isInteractionOnCooldown(`skinning:corpse:${c.id}`))
      .sort((a, b) => {
        const levelDiff = Number(a.level ?? 1) - Number(b.level ?? 1);
        if (levelDiff !== 0) return levelDiff;
        return Math.hypot((a.x ?? 0) - me.x, (a.y ?? 0) - me.y) - Math.hypot((b.x ?? 0) - me.x, (b.y ?? 0) - me.y);
      })[0];

    if (!corpse) {
      return actionBlocked("No skinnable corpses in zone", {
        failureKey: `skinning:no-corpses:${ctx.currentRegion}`,
        targetName: ctx.currentRegion,
        category: "strategic",
      });
    }

    const moving = await ctx.moveToEntity(me, corpse, 45);
    if (moving) return actionProgressed(`Moving to ${corpse.name ?? "corpse"}`);

    try {
      const result = await ctx.api("POST", "/skinning/harvest", {
        walletAddress: ctx.custodialWallet,
        zoneId: ctx.currentRegion,
        entityId: ctx.entityId,
        corpseId: corpse.id,
      });
      const drops = Array.isArray(result?.items) ? result.items : Array.isArray(result?.drops) ? result.drops : [];
      const label = drops.map((d: any) => d.name).filter(Boolean).join(", ") || corpse.name || "corpse";
      void ctx.logActivity(`Skinned ${corpse.name ?? "corpse"}`);
      logZoneEvent({
        zoneId: ctx.currentRegion,
        type: "profession",
        tick: 0,
        message: `${me.name} is skinning ${corpse.name ?? "a corpse"}`,
        entityId: ctx.entityId,
        entityName: me.name,
        data: { profession: "skinning", target: corpse.name, drops: label },
      });
      emitAgentChat({
        entityId: ctx.entityId,
        entityName: me.name ?? "Agent",
        zoneId: ctx.currentRegion,
        event: "gathering",
        origin: me.origin,
        classId: me.classId,
        detail: corpse.name ?? "corpse",
      });
      return actionCompleted(`Skinned ${corpse.name ?? "corpse"}`);
    } catch (err: any) {
      const reason = formatAgentError(err);
      ctx.setInteractionCooldown(`skinning:corpse:${corpse.id}`, 60_000);
      void ctx.logActivity(`Skinning failed: ${reason}`);
      return actionBlocked(reason, {
        failureKey: `skinning:${corpse.id}`,
        endpoint: "/skinning/harvest",
        targetId: corpse.id,
        targetName: corpse.name,
      });
    }
  } catch (err: any) {
    const reason = formatAgentError(err);
    return actionBlocked(reason, { failureKey: `skinning:error:${ctx.currentRegion}` });
  }
}
