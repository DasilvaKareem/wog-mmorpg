/**
 * agentDecisionEngine.ts
 * LLM-powered per-tick decision engine for the agent loop.
 * Called every DECISION_INTERVAL ticks — returns ONE structured action the runner executes.
 */

import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/** How many ticks between LLM decisions. Default 5 = ~6s at 1200ms/tick. */
export const DECISION_INTERVAL = parseInt(process.env.AGENT_DECISION_INTERVAL ?? "5", 10);
const DECISION_MODEL = process.env.AGENT_DECISION_MODEL ?? "openai/gpt-oss-120b";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ZoneMob {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  dist: number;
}

export interface ZoneNPC {
  id: string;
  name: string;
  type: string;
  dist: number;
  teachesProfession?: string;
}

export interface ZoneNode {
  id: string;
  name: string;
  type: "ore-node" | "flower-node";
  dist: number;
}

export interface InventoryItem {
  tokenId: number;
  name: string;
  category: string;
  count: number;
}

export interface AgentContext {
  name: string;
  level: number;
  race: string;
  classId: string;
  hp: number;
  maxHp: number;
  gold: number;
  zone: string;
  x: number;
  z: number;
  equipment: Record<string, string | null>;
  inventory: InventoryItem[];
  professions: string[];
  mobs: ZoneMob[];
  npcs: ZoneNPC[];
  nodes: ZoneNode[];
  nearbyPlayers: Array<{ id: string; name: string; level: number; dist: number }>;
  connectedZones: Array<{ zone: string; levelReq: number }>;
  /** Natural-language directive from the user (derived from focus + targetZone). */
  directive: string;
  /** Last 8 activity log entries for context continuity. */
  recentActivity: string[];
}

export interface AgentDecision {
  tool: string;
  args: Record<string, any>;
  commentary: string;
}

// ── Prompt builder ────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: AgentContext): string {
  const hpPct = Math.round((ctx.hp / Math.max(ctx.maxHp, 1)) * 100);

  const eqLines = Object.entries(ctx.equipment)
    .map(([slot, item]) => `  ${slot.padEnd(12)}: ${item ?? "empty"}`)
    .join("\n");

  const invLines = ctx.inventory.length > 0
    ? ctx.inventory.map((i) => `  ${i.name} ×${i.count} [${i.category}]`).join("\n")
    : "  (nothing)";

  const mobLines = ctx.mobs.length > 0
    ? ctx.mobs.slice(0, 8).map((m) =>
        `  [${m.id}] ${m.name} Lv${m.level} HP:${m.hp}/${m.maxHp} dist:${Math.round(m.dist)}`
      ).join("\n")
    : "  (none visible)";

  const npcLines = ctx.npcs.length > 0
    ? ctx.npcs.slice(0, 8).map((n) =>
        `  [${n.id}] ${n.name} (${n.type})${n.teachesProfession ? ` teaches:${n.teachesProfession}` : ""} dist:${Math.round(n.dist)}`
      ).join("\n")
    : "  (none)";

  const nodeLines = ctx.nodes.length > 0
    ? ctx.nodes.slice(0, 6).map((n) =>
        `  [${n.id}] ${n.name} (${n.type}) dist:${Math.round(n.dist)}`
      ).join("\n")
    : "  (none)";

  const zoneLines = ctx.connectedZones.length > 0
    ? ctx.connectedZones.map((z) => `  ${z.zone} (requires Lv${z.levelReq})`).join("\n")
    : "  (none)";

  const activityLines = ctx.recentActivity.length > 0
    ? ctx.recentActivity.map((a) => `  - ${a}`).join("\n")
    : "  (none yet)";

  return `You are ${ctx.name}, a Level ${ctx.level} ${ctx.race} ${ctx.classId} in World of Geneva — a blockchain MMORPG.
You are an autonomous AI agent. Each tick you choose ONE concrete action to take.

=== YOUR STATE ===
Zone: ${ctx.zone}  |  HP: ${ctx.hp}/${ctx.maxHp} (${hpPct}%)  |  Gold: ${ctx.gold}g  |  Level: ${ctx.level}
Professions learned: ${ctx.professions.join(", ") || "none"}

Equipment:
${eqLines}

Inventory:
${invLines}

=== ZONE CONTEXT ===
Mobs:
${mobLines}

NPCs:
${npcLines}

Resource Nodes:
${nodeLines}

Travel options from here:
${zoneLines}

=== RECENT ACTIONS ===
${activityLines}

=== DIRECTIVE ===
${ctx.directive}

=== DECISION RULES ===
- HP below 20%? Use a consumable immediately, or flee if you have nothing
- No weapon equipped and have gold? Go shopping first — everything else waits
- Outleveled this zone (5+ levels above its requirement)? Travel to the next zone
- Always use a REAL entity ID from the lists above — never invent IDs
- Be decisive and purposeful — you are an intelligent adventurer, not a random bot`.trim();
}

// ── Tool definitions ──────────────────────────────────────────────────────

function buildTools(): Groq.Chat.ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "attack_mob",
        description: "Move to and attack a specific mob or boss in the zone",
        parameters: {
          type: "object",
          properties: {
            mob_id: { type: "string", description: "Entity ID of the mob to attack (from the Mobs list above)" },
            commentary: { type: "string", description: "Short in-character description of the action" },
          },
          required: ["mob_id", "commentary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "gather_resource",
        description: "Move to and gather from a specific ore node or flower node",
        parameters: {
          type: "object",
          properties: {
            node_id: { type: "string", description: "Entity ID of the resource node (from Resource Nodes list above)" },
            commentary: { type: "string", description: "Short in-character description" },
          },
          required: ["node_id", "commentary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "buy_from_merchant",
        description: "Walk to a merchant NPC and buy gear or supplies. Use when missing equipment or need consumables.",
        parameters: {
          type: "object",
          properties: {
            merchant_id: { type: "string", description: "Entity ID of the merchant NPC (from NPCs list above)" },
            commentary: { type: "string", description: "Short in-character description" },
          },
          required: ["merchant_id", "commentary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "travel_to_zone",
        description: "Begin traveling to a connected zone. Use when current zone is too easy or directive requires it.",
        parameters: {
          type: "object",
          properties: {
            zone_id: { type: "string", description: "Zone ID to travel to (must appear in Travel options above)" },
            commentary: { type: "string", description: "Short in-character description" },
          },
          required: ["zone_id", "commentary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "learn_profession",
        description: "Learn a profession from a trainer NPC in the zone",
        parameters: {
          type: "object",
          properties: {
            profession_id: {
              type: "string",
              enum: ["mining", "herbalism", "skinning", "blacksmithing", "alchemy", "cooking", "leatherworking", "jewelcrafting"],
              description: "The profession to learn",
            },
            commentary: { type: "string", description: "Short in-character description" },
          },
          required: ["profession_id", "commentary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "craft_or_brew",
        description: "Craft, brew, or cook at a crafting station (forge, alchemy lab, or campfire)",
        parameters: {
          type: "object",
          properties: {
            station_id: { type: "string", description: "Entity ID of the crafting station (from NPCs list above)" },
            station_type: { type: "string", enum: ["forge", "alchemy-lab", "campfire"], description: "Type of station" },
            commentary: { type: "string", description: "Short in-character description" },
          },
          required: ["station_id", "station_type", "commentary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "use_consumable",
        description: "Use a food or potion from inventory to restore HP",
        parameters: {
          type: "object",
          properties: {
            token_id: { type: "number", description: "Token ID of the consumable item" },
            item_type: { type: "string", enum: ["food", "potion"], description: "food or potion" },
            commentary: { type: "string", description: "Short in-character description" },
          },
          required: ["token_id", "item_type", "commentary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "repair_gear",
        description: "Repair damaged equipment at a blacksmith NPC",
        parameters: {
          type: "object",
          properties: {
            blacksmith_id: { type: "string", description: "Entity ID of the blacksmith NPC" },
            commentary: { type: "string", description: "Short in-character description" },
          },
          required: ["blacksmith_id", "commentary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "idle",
        description: "Do nothing this tick. Only use when there is genuinely nothing productive available.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Why there is nothing to do right now" },
            commentary: { type: "string", description: "Short in-character description" },
          },
          required: ["reason", "commentary"],
        },
      },
    },
  ];
}

// ── Main export ───────────────────────────────────────────────────────────

export async function makeDecision(ctx: AgentContext): Promise<AgentDecision | null> {
  try {
    const res = await groq.chat.completions.create({
      model: DECISION_MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt(ctx) },
        { role: "user", content: "What do you do this tick? Pick one action." },
      ],
      tools: buildTools(),
      tool_choice: "required",
      max_tokens: 256,
      temperature: 0.5,
    });

    const toolCall = res.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) return null;

    const args = JSON.parse(toolCall.function.arguments ?? "{}") as Record<string, any>;
    return {
      tool: toolCall.function.name,
      args,
      commentary: (args.commentary as string | undefined) ?? toolCall.function.name,
    };
  } catch (err: any) {
    console.warn(`[decisionEngine] LLM call failed: ${err.message?.slice(0, 80)}`);
    return null;
  }
}
