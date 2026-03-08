/**
 * agentSupervisor.ts
 * AI strategic supervisor — called only when a significant game event fires.
 * Runs a multi-turn tool-use conversation to read game state, then sets a new BotScript.
 *
 * Read tools (MCP-style):
 *   read_zone       → mobs, nodes, NPCs in current zone
 *   read_inventory  → items owned + gold
 *   read_connections → reachable zones + level requirements
 *   read_quests     → available quests in current zone
 *
 * Write tool (the output):
 *   set_script      → new BotScript for the bot to execute
 */

import { type Content, type FunctionDeclaration, type Part, type Type } from "@google/genai";
import { gemini, GEMINI_MODEL } from "./geminiClient.js";
import { fetchWalletBalance } from "./agentUtils.js";
import { findPortalInZone, getSharedEdge, getZoneConnections, ZONE_LEVEL_REQUIREMENTS } from "../world/worldLayout.js";
import { getAvailableQuestsForPlayer } from "../social/questSystem.js";
import { getEntitiesInRegion } from "../world/zoneRuntime.js";
import type { ZoneEvent } from "../world/zoneEvents.js";
import type { BotScript, TriggerEvent } from "../types/botScriptTypes.js";

const MAX_TURNS = 5;

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
  userDirective: string;
  /** Bound API caller from the runner (already authenticated) */
  apiCall: (method: string, path: string, body?: any) => Promise<any>;
  /** Real on-chain wallet balance in copper (pre-fetched by runner). entity.gold is always 0. */
  walletGoldCopper?: number;
}

// ── Prompt ────────────────────────────────────────────────────────────────

function buildSystemPrompt(event: TriggerEvent, ctx: SupervisorContext): string {
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

  return `You are the strategic supervisor for ${entity.name ?? "Agent"}, a Level ${entity.level ?? 1} ${entity.raceId ?? "human"} ${entity.classId ?? "warrior"} in World of Geneva.

EVENT: ${event.detail}

AGENT STATE:
  Region: ${ctx.currentRegion}  |  HP: ${entity.hp}/${entity.maxHp} (${hpPct}%)  |  Gold: ${goldDisplay}  |  Level: ${entity.level ?? 1}
  Equipped: ${equipped}
  Recent: ${ctx.recentActivities.slice(-4).join(" → ") || "none"}
  Zone Events: ${recentEvents}

CURRENT SCRIPT: ${ctx.currentScript ? `${ctx.currentScript.type} — ${ctx.currentScript.reason ?? ""}` : "none"}

USER DIRECTIVE: ${ctx.userDirective}

Your job: Decide the next bot script to execute.
- IMPORTANT: If the current script is still valid and making progress, RE-ISSUE the same script type with the same parameters. Do NOT change scripts just because you were called. Walking to a distant target is normal progress — let it finish.
- Only change scripts when: the current goal is impossible, completed, or a clearly better opportunity exists.
- Call read tools only if you need more information (zone, inventory, connections, quests)
- Call set_script once to finalize — this is the ONLY output that matters
- Be strategic: consider level, zone difficulty, gear, gold
- HP REGEN: You passively regenerate HP when out of combat (after ~10s). Do NOT gather herbs, cook, or shop for food just because HP is low — simply wait or keep moving and HP will recover on its own. Only use food/potions during active combat emergencies (below 20% HP). Never switch to gathering or cooking solely because of low HP.
- ECONOMY RULES: Gold earned from mob kills takes time to confirm on-chain. Agents start with 0 gold.
  * EARLY GAME (< 100c): FIGHT mobs (Giant Rats, etc.) until you have at least 100 copper. Do NOT quest, gather, cook, or craft until you have 100c. Buy a weapon as soon as you can afford one (≥ 10c).
  * No weapon AND no gold (< 10c): FIGHT — agents can attack unarmed. Earn gold first.
  * No weapon AND has gold (≥ 10c): SHOP — buy the cheapest weapon available.
  * Has weapon + ≥ 100c: quest or combat based on zone and level.
  * If outleveled: travel to an easier zone.`.trim();
}

// ── Tools ─────────────────────────────────────────────────────────────────

function buildTools(): FunctionDeclaration[] {
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
    {
      name: "set_script",
      description: "Set the bot's behavior script. Call this once to finalize the decision.",
      parameters: {
        type: "OBJECT" as Type,
        properties: {
          type: {
            type: "STRING" as Type,
            enum: ["combat", "gather", "travel", "shop", "craft", "brew", "cook", "quest", "idle"],
            description: "Which behavior mode the bot should run",
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
          reason: {
            type: "STRING" as Type,
            description: "Brief explanation for why this script was chosen (shown in activity log)",
          },
        },
        required: ["type", "reason"],
      },
    },
  ];
}

// ── Tool execution (reads game state locally, no extra round-trips) ────────

async function executeTool(
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
      const inv = await fetchWalletBalance(ctx.custodialWallet);
      return {
        gold: inv.copper,
        items: inv.items
          .filter((i: any) => Number(i.balance) > 0)
          .map((i: any) => ({ tokenId: i.tokenId, name: i.name, category: i.category, count: Number(i.balance) })),
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
        if (entity.type !== "quest-giver") continue;
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
  const systemInstruction = buildSystemPrompt(event, ctx);
  const contents: Content[] = [
    { role: "user", parts: [{ text: "What should the bot do next?" }] },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let res;
    try {
      res = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: buildTools() }],
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

      // Read tools — execute locally and feed results back
      const result = await executeTool(fc.name!, ctx);
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
  if (event.type === "level_up") return { type: "combat", maxLevelOffset: 2, reason: "Leveled up — keep fighting" };
  if (event.type === "zone_arrived") return { type: "quest", reason: "New region — check for quests" };
  if (event.type === "no_targets") {
    return { type: "travel", reason: "Area cleared — move on" };
  }
  return { type: "combat", maxLevelOffset: 2, reason: "Default combat" };
}
