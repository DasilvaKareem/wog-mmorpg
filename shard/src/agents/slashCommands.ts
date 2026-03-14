/**
 * Slash Commands — WoW-style terminal commands for the agent chat.
 *
 * Intercepted BEFORE the LLM call. Instant, free, no AI tokens burned.
 * Returns null if the message is not a slash command (pass through to LLM).
 */

import { getAllEntities, getEntitiesInRegion, getEntitiesNear, getEntity, type Entity } from "../world/zoneRuntime.js";
import { getZoneConnections, ZONE_LEVEL_REQUIREMENTS, getWorldLayout } from "../world/worldLayout.js";
import { getAvailableQuestsForPlayer, isQuestNpc } from "../social/questSystem.js";
import { getPlayerPartyId, getPartyMembers } from "../social/partySystem.js";
import { getLearnedProfessions } from "../professions/professions.js";
import { fetchLiquidationInventory } from "./agentUtils.js";
import {
  getAgentConfig,
  getAgentEntityRef,
  getAgentCustodialWallet,
  patchAgentConfig,
  type AgentFocus,
  type AgentStrategy,
} from "./agentConfigStore.js";
import { agentManager } from "./agentManager.js";
import { resolveRegionId } from "../world/worldLayout.js";

export interface SlashCommandResult {
  /** The formatted response text to display in chat */
  response: string;
  /** If true, the agent config was changed */
  configChanged?: boolean;
}

// ── Command Registry ───────────────────────────────────────────────────────

type CommandHandler = (args: string, ctx: CommandContext) => Promise<SlashCommandResult> | SlashCommandResult;

interface CommandDef {
  aliases: string[];
  usage: string;
  description: string;
  handler: CommandHandler;
}

interface CommandContext {
  authWallet: string;
  entity: Entity | null;
  entityId: string | null;
  region: string | null;
  custodialWallet: string | null;
}

const COMMANDS: CommandDef[] = [];

function cmd(def: CommandDef) {
  COMMANDS.push(def);
}

// ── /help ──────────────────────────────────────────────────────────────────

cmd({
  aliases: ["help", "h", "?", "commands"],
  usage: "/help [command]",
  description: "List all commands or get help for a specific one",
  handler: (args) => {
    if (args) {
      const target = args.toLowerCase().replace(/^\//, "");
      const found = COMMANDS.find((c) => c.aliases.includes(target));
      if (found) {
        return {
          response: `${found.usage}\n${found.description}`,
        };
      }
      return { response: `Unknown command: /${target}. Type /help to see all commands.` };
    }
    const lines = COMMANDS.map((c) => `  /${c.aliases[0].padEnd(12)} ${c.description}`);
    return {
      response: `Available commands:\n${lines.join("\n")}\n\nType /help <command> for details.`,
    };
  },
});

// ── /status (/stats, /me) ──────────────────────────────────────────────────

cmd({
  aliases: ["status", "stats", "me", "stat"],
  usage: "/status",
  description: "Show your character's stats, HP, level, and gear",
  handler: async (_args, ctx) => {
    if (!ctx.entity) return { response: "No character found in world." };
    const e = ctx.entity;
    const hpPct = Math.round((e.hp / Math.max(e.maxHp, 1)) * 100);
    const eq = (e.equipment ?? {}) as Record<string, any>;
    const gear = Object.entries(eq)
      .filter(([, v]) => v != null)
      .map(([slot, item]) => `  ${slot}: ${item.name ?? `#${item.tokenId}`}${item.broken ? " (BROKEN)" : ""}`)
      .join("\n") || "  (none)";

    const stats = e.effectiveStats ?? e.stats;
    const statLine = stats
      ? `STR ${stats.str} | DEF ${stats.def} | AGI ${stats.agi} | INT ${stats.int} | FAITH ${stats.faith} | LUCK ${stats.luck}`
      : "unknown";

    const techniques = (e.learnedTechniques ?? []).join(", ") || "none";

    let professions = "none";
    if (ctx.custodialWallet) {
      try {
        const learned = getLearnedProfessions(ctx.custodialWallet);
        if (learned.length > 0) professions = learned.join(", ");
      } catch { /* non-fatal */ }
    }

    return {
      response: [
        `${e.name} — Level ${e.level ?? 1} ${e.raceId ?? "human"} ${e.classId ?? "warrior"}`,
        `HP: ${e.hp}/${e.maxHp} (${hpPct}%) | Essence: ${e.essence ?? 0}/${e.maxEssence ?? 0}`,
        `Zone: ${e.region ?? "unknown"} | Kills: ${e.kills ?? 0} | XP: ${e.xp ?? 0}`,
        `Stats: ${statLine}`,
        `Techniques: ${techniques}`,
        `Professions: ${professions}`,
        `Equipment:\n${gear}`,
      ].join("\n"),
    };
  },
});

// ── /who ────────────────────────────────────────────────────────────────────

cmd({
  aliases: ["who", "players", "online"],
  usage: "/who [zone]",
  description: "List online players, optionally filtered by zone",
  handler: (args) => {
    const filterZone = args ? resolveRegionId(args) : null;
    const players: string[] = [];

    for (const entity of getAllEntities().values()) {
      if (entity.type !== "player") continue;
      if (filterZone && entity.region !== filterZone) continue;
      players.push(`  ${entity.name} — L${entity.level ?? 1} ${entity.classId ?? "?"} in ${entity.region ?? "?"}`);
    }

    if (players.length === 0) {
      return { response: filterZone ? `No players in ${filterZone}.` : "No players online." };
    }

    const header = filterZone ? `Players in ${filterZone} (${players.length}):` : `Online players (${players.length}):`;
    return { response: `${header}\n${players.join("\n")}` };
  },
});

// ── /look (/scan) ──────────────────────────────────────────────────────────

cmd({
  aliases: ["look", "scan", "nearby"],
  usage: "/look",
  description: "See what's around you — mobs, NPCs, nodes, players",
  handler: (_args, ctx) => {
    if (!ctx.entity) return { response: "No character in world." };
    const e = ctx.entity;
    const near = getEntitiesNear(e.x, e.y, 250);

    const mobs: string[] = [];
    const npcs: string[] = [];
    const nodes: string[] = [];
    const players: string[] = [];

    for (const n of near) {
      if (n.id === ctx.entityId) continue;
      const dist = Math.round(Math.hypot(n.x - e.x, n.y - e.y));
      if ((n.type === "mob" || n.type === "boss") && n.hp > 0) {
        mobs.push(`  ${n.name} L${n.level ?? "?"} (${n.hp}/${n.maxHp}) — ${dist}m`);
      } else if (n.type === "player") {
        players.push(`  ${n.name} L${n.level ?? "?"} — ${dist}m`);
      } else if (n.type === "ore-node" || n.type === "flower-node") {
        nodes.push(`  ${n.name} — ${dist}m`);
      } else if (n.type !== "corpse") {
        npcs.push(`  ${n.name} (${n.type}) — ${dist}m`);
      }
    }

    const sections: string[] = [`You are in ${e.region ?? "unknown"}.`];
    if (mobs.length > 0) sections.push(`Mobs (${mobs.length}):\n${mobs.slice(0, 10).join("\n")}`);
    if (players.length > 0) sections.push(`Players (${players.length}):\n${players.join("\n")}`);
    if (npcs.length > 0) sections.push(`NPCs (${npcs.length}):\n${npcs.slice(0, 8).join("\n")}`);
    if (nodes.length > 0) sections.push(`Resources (${nodes.length}):\n${nodes.slice(0, 6).join("\n")}`);
    if (mobs.length === 0 && players.length === 0 && npcs.length === 0 && nodes.length === 0) {
      sections.push("Nothing nearby.");
    }

    return { response: sections.join("\n\n") };
  },
});

// ── /find ──────────────────────────────────────────────────────────────────

cmd({
  aliases: ["find", "search", "locate"],
  usage: "/find <name>",
  description: "Search for a player, NPC, or mob by name",
  handler: (args, ctx) => {
    if (!args) return { response: "Usage: /find <name>" };
    const query = args.toLowerCase();
    const results: string[] = [];

    for (const entity of getAllEntities().values()) {
      if (entity.hp <= 0) continue;
      if (entity.name.toLowerCase().includes(query)) {
        const dist = ctx.entity
          ? Math.round(Math.hypot(entity.x - ctx.entity.x, entity.y - ctx.entity.y))
          : null;
        results.push(`  ${entity.name} (${entity.type}, L${entity.level ?? "?"}) in ${entity.region ?? "?"}${dist != null ? ` — ${dist}m` : ""}`);
      }
      if (results.length >= 15) break;
    }

    if (results.length === 0) return { response: `Nothing found matching "${args}".` };
    return { response: `Found:\n${results.join("\n")}` };
  },
});

// ── /bag (/inventory, /inv, /items) ─────────────────────────────────────────

cmd({
  aliases: ["bag", "inventory", "inv", "items", "i"],
  usage: "/bag",
  description: "Check your inventory and gold",
  handler: async (_args, ctx) => {
    if (!ctx.custodialWallet) return { response: "No wallet found." };
    try {
      const inv = await fetchLiquidationInventory(ctx.custodialWallet);
      const goldDisplay = inv.copper >= 10000
        ? `${(inv.copper / 10000).toFixed(2)} gold`
        : `${inv.copper} copper`;

      const items = inv.items
        .filter((i: any) => Number(i.balance) > 0)
        .map((i: any) => `  ${i.name} x${i.balance} (${i.category})${i.recyclableQuantity > 0 ? ` [recycle: ${i.recycleCopperValue}c]` : ""}`)
        .slice(0, 20);

      return {
        response: `Gold: ${goldDisplay}\n\nItems (${items.length}):\n${items.length > 0 ? items.join("\n") : "  (empty)"}`,
      };
    } catch {
      return { response: "Failed to load inventory." };
    }
  },
});

// ── /quests (/quest, /q) ────────────────────────────────────────────────────

cmd({
  aliases: ["quests", "quest", "q"],
  usage: "/quests",
  description: "Show active and available quests",
  handler: (_args, ctx) => {
    if (!ctx.entity) return { response: "No character in world." };
    const e = ctx.entity;
    const active = (e.activeQuests ?? []) as Array<{ questId: string; progress: number }>;
    const completedIds = (e.completedQuests ?? []) as string[];
    const activeIds = active.map((q) => q.questId);

    const sections: string[] = [];

    if (active.length > 0) {
      const lines = active.map((q) => `  ${q.questId} — progress: ${q.progress}`);
      sections.push(`Active quests (${active.length}):\n${lines.join("\n")}`);
    } else {
      sections.push("No active quests.");
    }

    if (ctx.region) {
      const available: string[] = [];
      for (const zoneEntity of getEntitiesInRegion(ctx.region)) {
        if (!isQuestNpc(zoneEntity)) continue;
        const quests = getAvailableQuestsForPlayer(zoneEntity.name, completedIds, activeIds);
        for (const q of quests) {
          available.push(`  "${q.title}" from ${zoneEntity.name}`);
        }
      }
      if (available.length > 0) {
        sections.push(`Available in ${ctx.region} (${available.length}):\n${available.join("\n")}`);
      }
    }

    sections.push(`Completed: ${completedIds.length} quests`);
    return { response: sections.join("\n\n") };
  },
});

// ── /map (/zones, /world) ──────────────────────────────────────────────────

cmd({
  aliases: ["map", "zones", "world"],
  usage: "/map",
  description: "Show the world map — all zones, levels, and connections",
  handler: (_args, ctx) => {
    const myLevel = ctx.entity?.level ?? 1;
    const myZone = ctx.entity?.region;
    const layout = getWorldLayout();
    const zoneIds = Object.keys(layout.zones);

    const lines = zoneIds.map((z) => {
      const req = ZONE_LEVEL_REQUIREMENTS[z] ?? 1;
      const connections = getZoneConnections(z);
      const here = z === myZone ? " <-- YOU" : "";
      const locked = myLevel < req ? " (LOCKED)" : "";
      return `  ${z} (L${req})${locked}${here} → ${connections.join(", ") || "none"}`;
    });

    return { response: `World Map:\n${lines.join("\n")}` };
  },
});

// ── /focus (/set) ──────────────────────────────────────────────────────────

cmd({
  aliases: ["focus", "set", "do"],
  usage: "/focus <activity> [zone]",
  description: "Change what your agent does: combat, questing, gathering, crafting, etc.",
  handler: async (args, ctx) => {
    if (!args) {
      const config = await getAgentConfig(ctx.authWallet);
      return {
        response: `Current focus: ${config?.focus ?? "unknown"} | Strategy: ${config?.strategy ?? "balanced"}\n\nUsage: /focus <activity> [zone]\nActivities: combat, questing, gathering, crafting, alchemy, cooking, enchanting, shopping, trading, traveling, learning, idle`,
      };
    }

    const parts = args.split(/\s+/);
    const focusInput = parts[0].toLowerCase();
    const zoneInput = parts.slice(1).join("-");

    const VALID_FOCUSES: Record<string, AgentFocus> = {
      combat: "combat", fight: "combat", grind: "combat",
      quest: "questing", questing: "questing",
      gather: "gathering", gathering: "gathering", mine: "gathering", herb: "gathering",
      craft: "crafting", crafting: "crafting", forge: "crafting",
      brew: "alchemy", alchemy: "alchemy", potion: "alchemy",
      cook: "cooking", cooking: "cooking",
      enchant: "enchanting", enchanting: "enchanting",
      shop: "shopping", shopping: "shopping", buy: "shopping",
      trade: "trading", trading: "trading", sell: "trading",
      travel: "traveling", traveling: "traveling", go: "traveling", move: "traveling",
      learn: "learning", learning: "learning", train: "learning",
      dungeon: "dungeon", dungeons: "dungeon", gate: "dungeon",
      idle: "idle", rest: "idle", stop: "idle", afk: "idle",
    };

    const focus = VALID_FOCUSES[focusInput];
    if (!focus) {
      return { response: `Unknown activity: ${focusInput}\nValid: combat, questing, gathering, crafting, alchemy, cooking, enchanting, shopping, trading, traveling, learning, dungeon, idle` };
    }

    const patch: Record<string, unknown> = { focus };
    if (focus === "traveling" && zoneInput) {
      const resolved = resolveRegionId(zoneInput);
      if (resolved) patch.targetZone = resolved;
      else return { response: `Unknown zone: ${zoneInput}` };
    }

    await patchAgentConfig(ctx.authWallet, patch);
    const runner = agentManager.getRunner(ctx.authWallet);
    if (runner) runner.clearScript();

    const zoneMsg = patch.targetZone ? ` → ${patch.targetZone}` : "";
    return { response: `Focus set to: ${focus}${zoneMsg}`, configChanged: true };
  },
});

// ── /strategy (/strat) ─────────────────────────────────────────────────────

cmd({
  aliases: ["strategy", "strat"],
  usage: "/strategy <aggressive|balanced|defensive>",
  description: "Change combat strategy",
  handler: async (args, ctx) => {
    const valid = ["aggressive", "balanced", "defensive"];
    const input = (args || "").toLowerCase();
    if (!valid.includes(input)) {
      const config = await getAgentConfig(ctx.authWallet);
      return { response: `Current strategy: ${config?.strategy ?? "balanced"}\nUsage: /strategy <aggressive|balanced|defensive>` };
    }
    await patchAgentConfig(ctx.authWallet, { strategy: input as AgentStrategy });
    const runner = agentManager.getRunner(ctx.authWallet);
    if (runner) runner.clearScript();
    return { response: `Strategy set to: ${input}`, configChanged: true };
  },
});

// ── /party ──────────────────────────────────────────────────────────────────

cmd({
  aliases: ["party", "group", "team"],
  usage: "/party",
  description: "Show your current party members",
  handler: (_args, ctx) => {
    if (!ctx.entityId) return { response: "No character in world." };
    const partyId = getPlayerPartyId(ctx.entityId);
    if (!partyId) return { response: "You are not in a party." };

    const members = getPartyMembers(ctx.entityId);
    const lines = members.map((id) => {
      const member = getEntity(id);
      if (!member) return `  (unknown)`;
      return `  ${member.name} — L${member.level ?? "?"} ${member.classId ?? "?"} (${Math.round((member.hp / Math.max(member.maxHp, 1)) * 100)}% HP)`;
    });

    return { response: `Party (${members.length}):\n${lines.join("\n")}` };
  },
});

// ── /travel (/go, /move) ────────────────────────────────────────────────────

cmd({
  aliases: ["travel", "go", "move"],
  usage: "/travel <zone>",
  description: "Travel to a zone",
  handler: async (args, ctx) => {
    if (!args) {
      const connections = ctx.region ? getZoneConnections(ctx.region) : [];
      return { response: `Usage: /travel <zone>\n\nNearby zones: ${connections.join(", ") || "none"}` };
    }
    const resolved = resolveRegionId(args);
    if (!resolved) return { response: `Unknown zone: ${args}` };

    const req = ZONE_LEVEL_REQUIREMENTS[resolved] ?? 1;
    const myLevel = ctx.entity?.level ?? 1;
    if (myLevel < req) return { response: `${resolved} requires level ${req}. You are level ${myLevel}.` };

    await patchAgentConfig(ctx.authWallet, { focus: "traveling", targetZone: resolved });
    const runner = agentManager.getRunner(ctx.authWallet);
    if (runner) runner.clearScript();
    return { response: `Traveling to ${resolved}...`, configChanged: true };
  },
});

// ── /where (/loc, /pos) ────────────────────────────────────────────────────

cmd({
  aliases: ["where", "loc", "pos", "location"],
  usage: "/where",
  description: "Show your current position and zone",
  handler: (_args, ctx) => {
    if (!ctx.entity) return { response: "No character in world." };
    const e = ctx.entity;
    return {
      response: `${e.name} is at (${Math.round(e.x)}, ${Math.round(e.y)}) in ${e.region ?? "unknown"}`,
    };
  },
});

// ── Main handler ───────────────────────────────────────────────────────────

/**
 * Try to handle a chat message as a slash command.
 * Returns null if the message is not a slash command → pass to LLM.
 */
export async function handleSlashCommand(
  message: string,
  authWallet: string,
): Promise<SlashCommandResult | null> {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const cmdName = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).slice(1).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  const def = COMMANDS.find((c) => c.aliases.includes(cmdName));
  if (!def) {
    return {
      response: `Unknown command: /${cmdName}. Type /help for a list of commands.`,
    };
  }

  // Build context
  const ref = await getAgentEntityRef(authWallet);
  const entity = ref?.entityId ? getEntity(ref.entityId) ?? null : null;
  const custodialWallet = await getAgentCustodialWallet(authWallet);

  const ctx: CommandContext = {
    authWallet,
    entity,
    entityId: ref?.entityId ?? null,
    region: entity?.region ?? ref?.zoneId ?? null,
    custodialWallet,
  };

  return def.handler(args, ctx);
}
