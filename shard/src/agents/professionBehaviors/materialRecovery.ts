import type { AgentContext, ActionResult } from "../agentUtils.js";
import type { AgentStrategy, GatherPreference } from "../agentConfigStore.js";
import type { CraftProfession } from "./recipeBooks.js";

export type MaterialRecoveryKind =
  | { type: "gather"; preference: GatherPreference; targetItemName: string }
  | { type: "skin"; targetItemName?: string }
  | { type: "combat"; targetItemName: string }
  | { type: "hub"; reason: string };

export function planMaterialRecovery(
  profession: CraftProfession | string,
  materialName: string,
): MaterialRecoveryKind {
  const name = materialName.trim();

  if (/raw meat|meat|boar|fish/i.test(name)) {
    return { type: "combat", targetItemName: name };
  }

  if (/leather|hide|pelt|bone|scale|fur/i.test(name)) {
    return { type: "skin", targetItemName: name };
  }

  if (
    profession === "alchemy" ||
    /lily|rose|lavender|clover|mint|dandelion|sage|moonflower|starbloom|dragon'?s breath|herb|flower|mushroom/i.test(name)
  ) {
    return { type: "gather", preference: "herb", targetItemName: name };
  }

  if (/ore|bar|ingot|coal|tin|copper|iron|silver|gold|gem|ruby|sapphire|emerald|diamond/i.test(name)) {
    return { type: "gather", preference: "ore", targetItemName: name };
  }

  return { type: "gather", preference: "both", targetItemName: name };
}

export async function routeToProfessionHubForStation(
  ctx: AgentContext,
  stationType: string,
  strategy: AgentStrategy,
): Promise<ActionResult> {
  const hub = "village-square";
  if (ctx.currentRegion === hub) {
    return {
      status: "blocked",
      reason: `No ${stationType} in ${ctx.currentRegion}`,
      failureKey: `station:missing:${stationType}:${ctx.currentRegion}`,
      category: "strategic",
    };
  }

  await ctx.enqueueActions([
    { type: "travel", targetZone: hub, reason: `Find ${stationType} for profession work` },
    { type: strategy === "aggressive" ? "combat" : "quest", reason: "Resume after profession station detour" },
  ], true);
  void ctx.logActivity(`No ${stationType} here — traveling to ${hub}`);
  return { status: "progressed", reason: `Traveling to ${hub} for ${stationType}` };
}
