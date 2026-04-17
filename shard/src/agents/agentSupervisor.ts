/**
 * agentSupervisor.ts
 * AI strategic supervisor — called only when a significant game event fires.
 * Runs a multi-turn tool-use conversation to read game state, then sets a new BotScript.
 *
 * When the MCP client is connected, the supervisor gets access to the full WoG MCP
 * tool surface (scan_zone, get_my_status, find_mobs_for_level, what_can_i_craft, etc.)
 * instead of the limited hardcoded read tools.
 *
 * The terminal tool is always `set_script` — which is NOT an MCP tool but a local
 * action that tells the runner what behavior to execute next.
 */

import { type Content, type FunctionDeclaration, type Part, type Type } from "@google/genai";
import { gemini, GEMINI_MODEL } from "./geminiClient.js";
import { fetchLiquidationInventory, type FailureMemoryEntry } from "./agentUtils.js";
import { findPortalInZone, getSharedEdge, getZoneConnections, ZONE_LEVEL_REQUIREMENTS } from "../world/worldLayout.js";
import { getAvailableQuestsForPlayer, isQuestNpc } from "../social/questSystem.js";
import { getEntitiesInRegion } from "../world/zoneRuntime.js";
import type { ZoneEvent } from "../world/zoneEvents.js";
import type { BotScript, TriggerEvent } from "../types/botScriptTypes.js";
import type { AgentMcpClient } from "./mcpClient.js";

const MAX_TURNS_LEGACY = 5;
const MAX_TURNS_MCP = 5;

// ── Context ───────────────────────────────────────────────────────────────

export interface SupervisorContext {
  entity: any;
  entities: Record<string, any>;
  entityId: string;
  currentRegion: string;
  custodialWallet: string;
  currentScript: BotScript | null;
  recentActivities: string[];
  recentZoneEvents: ZoneEvent[];
  recentFailures: FailureMemoryEntry[];
  userDirective: string;
  /** Bound API caller from the runner (already authenticated) */
  apiCall: (method: string, path: string, body?: any) => Promise<any>;
  /** Real on-chain wallet balance in copper (pre-fetched by runner). entity.gold is always 0. */
  walletGoldCopper?: number;
  /** User's configured focus (questing, combat, gathering, etc.) — used by defaultScript fallback */
  configFocus?: string;
  /** MCP client — if connected, supervisor uses MCP tools instead of hardcoded ones. */
  mcpClient?: AgentMcpClient;
}

// ── Prompt ────────────────────────────────────────────────────────────────

function buildSystemPrompt(event: TriggerEvent, ctx: SupervisorContext, hasMcp: boolean): string {
  const entity = ctx.entity;
  const hpPct = Math.round((entity.hp / Math.max(entity.maxHp, 1)) * 100);
  const eq = entity.equipment ?? {};
  const equipped = Object.entries(eq)
    .filter(([, v]) => v != null)
    .map(([slot, item]: any) => `${slot}:${item.name}`)
    .join(", ") || "nothing equipped";

  const goldCopper = ctx.walletGoldCopper ?? 0;
  const goldDisplay = goldCopper >= 10000
    ? `${(goldCopper / 10000).toFixed(2)}g`
    : `${goldCopper}c`;
  const recentEvents = ctx.recentZoneEvents
    .slice(-4)
    .map((zoneEvent) => `${zoneEvent.type}: ${zoneEvent.message}`)
    .join(" | ") || "none";
  const recentFailures = ctx.recentFailures
    .slice(-4)
    .map((failure) => {
      const where = failure.targetName ?? failure.targetId ?? failure.endpoint ?? failure.key;
      const streak = failure.consecutive > 1 ? ` x${failure.consecutive}` : "";
      return `${where}: ${failure.reason}${streak}`;
    })
    .join(" | ") || "none";

  const mcpHint = hasMcp
    ? `\n- You have MCP tools: scan_zone (zone overview), get_my_status (character snapshot), find_mobs_for_level, shop_get_catalog, items_get_inventory. Call at most 1-2 reads then IMMEDIATELY call set_script. Do NOT explore — decide fast.`
    : `\n- Call read tools only if you need more information (zone, inventory, connections, quests)`;

  return `You are the decision engine for ${entity.name ?? "Agent"}, a Level ${entity.level ?? 1} ${entity.raceId ?? "human"} ${entity.classId ?? "warrior"} in World of Geneva. You decide what ${entity.name ?? "the character"} does next — but all output the player sees comes from the character's perspective, not yours.

EVENT: ${event.detail}

AGENT STATE:
  Region: ${ctx.currentRegion}  |  HP: ${entity.hp}/${entity.maxHp} (${hpPct}%)  |  Gold: ${goldDisplay}  |  Level: ${entity.level ?? 1}
  Equipped: ${equipped}
  Recent: ${ctx.recentActivities.slice(-4).join(" → ") || "none"}
  Zone Events: ${recentEvents}
  Recent Failures: ${recentFailures}

CURRENT SCRIPT: ${ctx.currentScript ? `${ctx.currentScript.type} — ${ctx.currentScript.reason ?? ""}` : "none"}

USER DIRECTIVE: ${ctx.userDirective}

Your job: Decide the next bot script to execute.
- IMPORTANT: If the current script is still valid and making progress, RE-ISSUE the same script type with the same parameters. Do NOT change scripts just because you were called. Walking to a distant target is normal progress — let it finish.
- Only change scripts when: the current goal is impossible, completed, or a clearly better opportunity exists.${mcpHint}
- Treat repeated failures as real state. If an NPC, endpoint, or action has failed repeatedly, avoid retry loops and choose a different script unless the failure is clearly transient.
- Call set_script once to finalize — this is the ONLY output that matters
- Be strategic: consider level, zone difficulty, gear, gold
- HP REGEN: You passively regenerate HP when out of combat (after ~10s). Do NOT gather herbs, cook, or shop for food just because HP is low — simply wait or keep moving and HP will recover on its own. Only use food/potions during active combat emergencies (below 20% HP). Never switch to gathering or cooking solely because of low HP.
- ECONOMY RULES: Gold earned from mob kills takes time to confirm on-chain. Agents start with 0 gold, and recyclable loot is a valid gold source.
  * EARLY GAME (< 100c): FIGHT mobs (Giant Rats, etc.) until you have at least 100 copper. Do NOT quest, gather, cook, or craft until you have 100c. Buy a weapon as soon as you can afford one (≥ 10c).
  * No weapon AND no gold (< 10c): FIGHT — agents can attack unarmed. Earn gold first.
  * No weapon AND has gold (≥ 10c): SHOP — buy the cheapest weapon available.
      * If inventory contains recyclable loot and funds are low, choose trade to recycle it into gold.
      * Has weapon + ≥ 100c: quest or combat based on zone and level.
  * If outleveled: travel to an easier zone.
- DUNGEONS: Dungeon gates spawn every 5 minutes (gate surge). If you see a dungeon-gate entity in scan_zone, you can set script to "dungeon" with gateEntityId and gateRank. The agent will walk to it, form a party, and enter. Rank E needs L3+, D=L7+, C=L12+, B=L18+, A=L28+, S=L40+. Dungeons give excellent XP. You need a matching key (E-Key, D-Key, etc.) from forging gate essences.
- FARMING: Farmland zones (sunflower-fields, harvest-hollow, copperfield-meadow, etc.) have crop nodes. Set script to "farm" and travel to a farmland zone to harvest crops. Requires a hoe (buy from shop, cheapest is Wooden Hoe at 15c). Crops yield produce for cooking/alchemy/selling. Some crops are day-only or night-only.`.trim();
}

// ── set_script declaration (always present) ──────────────────────────────

const SET_SCRIPT_DECL: FunctionDeclaration = {
  name: "set_script",
  description: "Set the bot's behavior script. Call this once to finalize the decision.",
  parameters: {
    type: "OBJECT" as Type,
    properties: {
      type: {
        type: "STRING" as Type,
        enum: ["combat", "gather", "travel", "shop", "trade", "craft", "brew", "cook", "quest", "learn", "goto", "idle", "dungeon", "farm"],
        description: "Which behavior mode the bot should run. Use 'learn' to find a trainer and learn techniques, 'goto' to walk to a specific NPC, 'dungeon' to enter a dungeon gate, 'farm' to harvest crops in farmland zones.",
      },
      maxLevelOffset: {
        type: "NUMBER" as Type,
        description: "combat only: max mob level above agent level to engage (1=safe, 5=aggressive)",
      },
      nodeType: {
        type: "STRING" as Type,
        enum: ["ore", "herb", "both"],
        description: "gather only: which resource nodes to target",
      },
      targetZone: {
        type: "STRING" as Type,
        description: "travel only: destination region ID",
      },
      maxGold: {
        type: "NUMBER" as Type,
        description: "shop only: maximum gold to spend this session",
      },
      gateEntityId: {
        type: "STRING" as Type,
        description: "dungeon only: entity ID of the dungeon gate to open",
      },
      gateRank: {
        type: "STRING" as Type,
        description: "dungeon only: rank of the gate (E/D/C/B/A/S)",
      },
      reason: {
        type: "STRING" as Type,
        description: "Brief explanation for why this script was chosen (shown in activity log)",
      },
    },
    required: ["type", "reason"],
  },
};

// ── Legacy hardcoded tools (fallback when MCP is unavailable) ────────────

function buildLegacyTools(): FunctionDeclaration[] {
  return [
    {
      name: "read_zone",
      description: "Read the current region — lists mobs, resource nodes, and NPCs with IDs, levels, and distances",
      parameters: { type: "OBJECT" as Type, properties: {} },
    },
    {
      name: "read_inventory",
      description: "Read the agent's inventory — items owned with counts and categories, plus gold balance",
      parameters: { type: "OBJECT" as Type, properties: {} },
    },
    {
      name: "read_connections",
      description: "Read regions reachable from the current region and their level requirements",
      parameters: { type: "OBJECT" as Type, properties: {} },
    },
    {
      name: "read_quests",
      description: "Read available and active quests in the current region",
      parameters: { type: "OBJECT" as Type, properties: {} },
    },
    SET_SCRIPT_DECL,
  ];
}

// ── Legacy tool execution (reads game state locally) ─────────────────────

async function executeLegacyTool(
  toolName: string,
  ctx: SupervisorContext,
): Promise<unknown> {
  switch (toolName) {
    case "read_zone": {
      const myX = ctx.entity.x ?? 0;
      const myZ = ctx.entity.y ?? ctx.entity.z ?? 0;
      const dist = (e: any) =>
        Math.round(Math.hypot((e.x ?? 0) - myX, (e.y ?? e.z ?? 0) - myZ));

      const mobs: any[] = [];
      const nodes: any[] = [];
      const npcs: any[] = [];

      for (const [id, e] of Object.entries(ctx.entities)) {
        if (id === ctx.entityId) continue;
        const d = dist(e);
        if ((e.type === "mob" || e.type === "boss") && e.hp > 0) {
          mobs.push({ id, name: e.name, level: e.level ?? 1, hp: e.hp, maxHp: e.maxHp, dist: d });
        } else if (e.type === "ore-node" || e.type === "flower-node") {
          nodes.push({ id, name: e.name, type: e.type, dist: d });
        } else if (e.type !== "player") {
          npcs.push({ id, name: e.name, type: e.type, dist: d });
        }
      }

      mobs.sort((a, b) => a.dist - b.dist);
      nodes.sort((a, b) => a.dist - b.dist);

      return { region: ctx.currentRegion, mobs: mobs.slice(0, 8), nodes: nodes.slice(0, 6), npcs: npcs.slice(0, 8) };
    }

    case "read_inventory": {
      const inv = await fetchLiquidationInventory(ctx.custodialWallet);
      return {
        gold: inv.copper,
        items: inv.items
          .filter((i: any) => Number(i.balance) > 0)
          .map((i: any) => ({
            tokenId: i.tokenId,
            name: i.name,
            category: i.category,
            count: Number(i.balance),
            equippedCount: i.equippedCount,
            recyclableQuantity: i.recyclableQuantity,
            recycleCopperValue: i.recycleCopperValue,
          })),
      };
    }

    case "read_connections": {
      const connections = getZoneConnections(ctx.currentRegion).map((connZone) => {
        const edge = getSharedEdge(ctx.currentRegion, connZone);
        const levelReq = ZONE_LEVEL_REQUIREMENTS[connZone] ?? 1;
        if (edge) {
          return { zone: connZone, direction: edge, levelReq, type: "walk" as const };
        }
        const portalPos = findPortalInZone(ctx.currentRegion, connZone);
        return {
          zone: connZone,
          direction: "portal" as const,
          levelReq,
          type: "portal" as const,
          ...(portalPos && { portalPosition: { x: portalPos.x, z: portalPos.z } }),
        };
      });
      return { connections };
    }

    case "read_quests": {
      const completedQuestIds = ctx.entity.completedQuests ?? [];
      const activeQuestIds = (ctx.entity.activeQuests ?? []).map((quest: any) => quest.questId);
      const available = [];
      for (const entity of getEntitiesInRegion(ctx.currentRegion)) {
        if (!isQuestNpc(entity)) continue;
        const quests = getAvailableQuestsForPlayer(entity.name, completedQuestIds, activeQuestIds);
        for (const quest of quests) {
          available.push({
            questId: quest.id,
            title: quest.title,
            npcEntityId: entity.id,
            npcName: entity.name,
            objective: quest.objective,
            rewards: quest.rewards,
          });
        }
      }
      return { active: ctx.entity.activeQuests ?? [], available };
    }

    default:
      return { error: "unknown tool" };
  }
}

// ── Main export ───────────────────────────────────────────────────────────

export async function runSupervisor(
  event: TriggerEvent,
  ctx: SupervisorContext,
): Promise<BotScript> {
  const hasMcp = Boolean(ctx.mcpClient?.isConnected());
  const maxTurns = hasMcp ? MAX_TURNS_MCP : MAX_TURNS_LEGACY;
  const systemInstruction = buildSystemPrompt(event, ctx, hasMcp);

  // Build tools: MCP tools (non-blocking only) + set_script, or legacy fallback
  let toolDecls: FunctionDeclaration[];
  if (hasMcp) {
    const mcpTools = ctx.mcpClient!.getGeminiTools(/* includeBlocking */ false, /* supervisorOnly */ true);
    toolDecls = [...mcpTools, SET_SCRIPT_DECL];
  } else {
    toolDecls = buildLegacyTools();
  }

  const contents: Content[] = [
    { role: "user", parts: [{ text: "What should the bot do next?" }] },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    let res;
    try {
      res = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: toolDecls }],
          temperature: 0.3,
          maxOutputTokens: 512,
        },
      });
    } catch (err: any) {
      console.warn(`[supervisor] LLM call failed (turn ${turn}): ${err.message?.slice(0, 80)}`);
      break;
    }

    const parts = res.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) break;

    // Add model response to conversation history
    contents.push({ role: "model", parts });

    const fnCalls = parts.filter((p: Part) => p.functionCall);
    if (fnCalls.length === 0) break; // LLM gave up without setting a script

    const responseParts: Part[] = [];

    for (const part of fnCalls) {
      const fc = part.functionCall!;

      // set_script is the terminal tool — extract and return immediately
      if (fc.name === "set_script") {
        const script = fc.args as unknown as BotScript;
        console.log(`[supervisor] set_script(${event.type}): ${script.type} — ${script.reason}`);
        return script;
      }

      let result: unknown;

      // Route to MCP or legacy handler
      if (hasMcp && ctx.mcpClient!.hasTool(fc.name!)) {
        try {
          const mcpResult = await ctx.mcpClient!.callTool(
            fc.name!,
            (fc.args ?? {}) as Record<string, unknown>,
            {
              entityId: ctx.entityId,
              zoneId: ctx.currentRegion,
              walletAddress: ctx.custodialWallet,
            },
          );
          // Parse JSON response for Gemini
          try { result = JSON.parse(mcpResult); } catch { result = { text: mcpResult }; }
        } catch (err: any) {
          console.warn(`[supervisor] MCP tool ${fc.name} failed: ${err.message?.slice(0, 60)}`);
          result = { error: err.message?.slice(0, 100) };
        }
      } else {
        result = await executeLegacyTool(fc.name!, ctx);
      }

      responseParts.push({
        functionResponse: { name: fc.name!, response: result as Record<string, unknown> },
      });
    }

    if (responseParts.length > 0) {
      contents.push({ role: "user", parts: responseParts });
    }
  }

  // LLM didn't call set_script — derive a safe default from the event
  console.warn(`[supervisor] no set_script call for event=${event.type}, using default`);
  return defaultScript(event, ctx);
}

function defaultScript(event: TriggerEvent, ctx: SupervisorContext): BotScript {
  const entity = ctx.entity;
  const eq = entity.equipment ?? {};
  const hasWeapon = Boolean(eq.weapon);
  const goldCopper = ctx.walletGoldCopper ?? 0;

  if (!hasWeapon) {
    // Only go shopping if the agent can actually afford something
    if (goldCopper >= 10) return { type: "shop", reason: "Has gold — buying a weapon" };
    // Broke + no weapon → fight unarmed to earn gold first
    return { type: "combat", maxLevelOffset: 0, reason: "No gold or weapon — fighting unarmed to earn gold" };
  }
  if (event.type === "blocked") {
    if (ctx.currentScript?.type === "quest") return { type: "combat", maxLevelOffset: 1, reason: "Quest path blocked — regroup with combat" };
    if (ctx.currentScript?.type === "shop" || ctx.currentScript?.type === "trade") return { type: "combat", maxLevelOffset: 1, reason: "Economy path blocked — farming gold instead" };
    return { type: "combat", maxLevelOffset: 1, reason: "Action blocked — switching to reliable combat" };
  }
  if (event.type === "level_up") return { type: "combat", maxLevelOffset: 2, reason: "Leveled up — keep fighting" };
  if (event.type === "zone_arrived") {
    // Respect user's configured focus instead of always forcing quests
    const focus = ctx.configFocus;
    if (focus && focus !== "questing") {
      const FOCUS_TO_SCRIPT: Record<string, BotScript> = {
        combat:     { type: "combat", maxLevelOffset: 2, reason: `Arrived — continuing combat` },
        gathering:  { type: "gather", reason: `Arrived — continuing gathering` },
        crafting:   { type: "craft", reason: `Arrived — continuing crafting` },
        alchemy:    { type: "brew", reason: `Arrived — continuing alchemy` },
        cooking:    { type: "cook", reason: `Arrived — continuing cooking` },
        enchanting: { type: "enchant", reason: `Arrived — continuing enchanting` },
        shopping:   { type: "shop", reason: `Arrived — continuing shopping` },
        trading:    { type: "trade", reason: `Arrived — continuing trading` },
        farming:    { type: "farm", reason: `Arrived — continuing farming` },
        idle:       { type: "idle", reason: `Arrived — staying idle as requested` },
      };
      if (FOCUS_TO_SCRIPT[focus]) return FOCUS_TO_SCRIPT[focus];
    }
    return { type: "quest", reason: "New region — check for quests" };
  }
  if (event.type === "no_targets") {
    return { type: "travel", reason: "Area cleared — move on" };
  }
  return { type: "combat", maxLevelOffset: 2, reason: "Default combat" };
}
