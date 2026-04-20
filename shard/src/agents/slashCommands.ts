/**
 * Slash Commands — WoW-style terminal commands for the agent chat.
 *
 * Intercepted BEFORE the LLM call. Instant, free, no AI tokens burned.
 * Returns null if the message is not a slash command (pass through to LLM).
 */

import {
  getAllEntities,
  getEntitiesInRegion,
  getEntitiesNear,
  getEntity,
  getOrCreateZone,
  getWorldTick,
  rememberPartyAutoCombatTarget,
  type Entity,
} from "../world/zoneRuntime.js";
import { getZoneConnections, ZONE_LEVEL_REQUIREMENTS, getWorldLayout } from "../world/worldLayout.js";
import { getZoneEvents } from "../world/zoneEvents.js";
import { getAvailableQuestsForPlayer, isQuestNpc } from "../social/questSystem.js";
import { getPartyLeaderId, getPlayerPartyId, getPartyMembers } from "../social/partySystem.js";
import { buildPartyCoordinationReport } from "../social/partyReport.js";
import { getLearnedProfessions } from "../professions/professions.js";
import { fetchLiquidationInventory } from "./agentUtils.js";
import {
  getAgentConfig,
  getAgentEntityRef,
  getAgentCustodialWallet,
  patchAgentConfig,
  type AgentFocus,
  type GatherPreference,
  type AgentStrategy,
} from "./agentConfigStore.js";
import { agentManager } from "./agentManager.js";
import { resolveRegionId } from "../world/worldLayout.js";
import { ITEM_CATALOG, getItemByTokenId, getItemRarity, type EquipmentSlot } from "../items/itemCatalog.js";
import { getItemBalance } from "../blockchain/blockchain.js";
import { getItemInstance, getWalletInstances, isItemInstanceOwnedBy } from "../items/itemRng.js";
import { recalculateEntityVitals } from "../world/zoneRuntime.js";
import { logDiary, narrativeEquip, narrativeUnequip } from "../social/diary.js";
import { saveCharacter } from "../character/characterStore.js";

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

function formatPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
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
      gather: "gathering", gathering: "gathering", mine: "gathering", herb: "gathering", herbalism: "gathering",
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
    if (focus === "gathering") {
      const gatherNodeType: GatherPreference =
        focusInput === "mine" ? "ore" :
        (focusInput === "herb" || focusInput === "herbalism") ? "herb" :
        "both";
      patch.gatherNodeType = gatherNodeType;
    } else {
      patch.gatherNodeType = undefined;
    }
    if (focus === "traveling" && zoneInput) {
      const resolved = resolveRegionId(zoneInput);
      if (resolved) patch.targetZone = resolved;
      else return { response: `Unknown zone: ${zoneInput}` };
    }

    await patchAgentConfig(ctx.authWallet, patch);
    const runner = agentManager.getRunner(ctx.authWallet);
    if (runner) await runner.clearScript();

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
    if (runner) await runner.clearScript();
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

    const leaderId = getPartyLeaderId(ctx.entityId);
    const members = getPartyMembers(ctx.entityId);
    const lines = members.map((id) => {
      const member = getEntity(id);
      if (!member) return `  (unknown)`;
      const leaderTag = id === leaderId ? " [leader]" : "";
      return `  ${member.name}${leaderTag} — L${member.level ?? "?"} ${member.classId ?? "?"} (${Math.round((member.hp / Math.max(member.maxHp, 1)) * 100)}% HP)`;
    });

    return { response: `Party (${members.length}):\n${lines.join("\n")}` };
  },
});

cmd({
  aliases: ["partydebug", "partymetrics", "coord"],
  usage: "/partydebug",
  description: "Show recent party coordination metrics and party events",
  handler: (_args, ctx) => {
    if (!ctx.entityId || !ctx.entity) return { response: "No character in world." };
    const partyId = getPlayerPartyId(ctx.entityId);
    if (!partyId) return { response: "You are not in a party." };

    const runner = agentManager.getRunner(ctx.authWallet);
    const partyTelemetry = runner?.getSnapshot().telemetry?.party ?? {};
    const topMetrics = Object.entries(partyTelemetry)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => `  ${name}: ${count}`);

    const recentPartyEvents = getZoneEvents(ctx.entity.region ?? "unknown", 80)
      .filter((event) => event.type === "party")
      .slice(-6)
      .map((event) => `  ${event.message}`);

    const leaderId = getPartyLeaderId(ctx.entityId);
    const leader = leaderId ? getEntity(leaderId) : null;

    return {
      response: [
        `Party Debug`,
        `Party: ${partyId}`,
        `Leader: ${leader?.name ?? leaderId ?? "unknown"}`,
        `Metrics:`,
        ...(topMetrics.length > 0 ? topMetrics : ["  (no party metrics yet)"]),
        `Recent party events:`,
        ...(recentPartyEvents.length > 0 ? recentPartyEvents : ["  (no recent party events)"]),
      ].join("\n"),
    };
  },
});

cmd({
  aliases: ["partyreport", "partyrep", "preport"],
  usage: "/partyreport",
  description: "Summarize party cohesion and leader-follow effectiveness",
  handler: (_args, ctx) => {
    if (!ctx.entityId || !ctx.entity) return { response: "No character in world." };
    const partyId = getPlayerPartyId(ctx.entityId);
    if (!partyId) return { response: "You are not in a party." };
    const report = buildPartyCoordinationReport(partyId);
    if (!report) return { response: "Party report unavailable." };

    const recentLines = report.recentEvents.length > 0
      ? report.recentEvents.slice(0, 8).map((event) => `  ${event.message}`)
      : ["  (no recent party events)"];

    const topMetricLines = report.metrics.top.map(({ kind, count }) => `  ${kind}: ${count}`);

    return {
      response: [
        `Party Report`,
        `Party: ${report.partyId}`,
        `Leader: ${report.leader.name ?? report.leader.entityId ?? "unknown"}`,
        `Members: ${report.counts.liveMembers}/${report.counts.totalMembers} live`,
        `Cohesion: ${report.counts.followerCount > 0 ? `${report.counts.nearLeaderFollowers}/${report.counts.followerCount} followers near leader (${report.ratios.cohesionPct}%)` : "n/a (no followers)"}`,
        `Cohesion failures: ${report.counts.cohesionFailures} (${report.counts.offZoneFollowers} off-zone, ${report.counts.spacingFailures} too far)`,
        `Leader-call assist share: ${report.ratios.leaderCallAssistPct}% (${report.metrics.assistLeaderTarget}/${Math.max(1, report.metrics.assistTotal)})`,
        `Leader-support share: ${report.ratios.leaderSupportPct}% (${report.metrics.leaderSupportTotal}/${Math.max(1, report.metrics.supportTotal)})`,
        `Follow activity share: ${report.ratios.followActivityPct}% (${report.metrics.followLeader}/${Math.max(1, report.metrics.followLeader + report.metrics.assistTotal)})`,
        `Party metrics:`,
        ...(topMetricLines.length > 0 ? topMetricLines : ["  (no party metrics yet)"]),
        `Recent party events:`,
        ...recentLines,
      ].join("\n"),
    };
  },
});

// ── /target (/focus-mob, /attack) ────────────────────────────────────────────

cmd({
  aliases: ["target", "attack"],
  usage: "/target <mob name>",
  description: "Focus a mob by name — you and your party will attack it",
  handler: (_args, ctx) => {
    if (!_args) return { response: "Usage: /target <mob name>\nExample: /target Azushard Dragon" };
    if (!ctx.entity) return { response: "No character in world." };
    if (!ctx.entityId) return { response: "No character in world." };
    if (ctx.entity.hp <= 0) return { response: "You are dead." };

    const region = ctx.entity.region;
    if (!region) return { response: "Not in a region." };

    const query = _args.toLowerCase();
    const zone = getOrCreateZone(region);

    // Find nearest matching mob/boss
    let bestMob: Entity | null = null;
    let bestDist = Infinity;
    for (const other of zone.entities.values()) {
      if (other.type !== "mob" && other.type !== "boss") continue;
      if (other.hp <= 0) continue;
      if (!other.name.toLowerCase().includes(query)) continue;
      const dx = other.x - ctx.entity.x;
      const dy = other.y - ctx.entity.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestMob = other;
      }
    }

    if (!bestMob) return { response: `No mob matching "${_args}" found nearby.` };

    // Set attack order on the player's entity
    ctx.entity.order = { action: "attack", targetId: bestMob.id };

    // Set party target lock so party members (including rentals) focus the same target
    const partyId = getPlayerPartyId(ctx.entityId);
    if (partyId) {
      rememberPartyAutoCombatTarget(ctx.entityId, region, bestMob.id, getWorldTick());
    }

    const dist = Math.round(bestDist);
    return {
      response: `Targeting ${bestMob.name} (L${bestMob.level ?? "?"}, ${bestMob.hp}/${bestMob.maxHp} HP) — ${dist}m away${partyId ? ". Party will focus this target." : ""}`,
    };
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
    if (runner) await runner.clearScript();
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

// ── /equip ────────────────────────────────────────────────────────────────

const EQUIPMENT_SLOTS: EquipmentSlot[] = [
  "weapon", "shield", "chest", "legs", "boots", "helm",
  "shoulders", "gloves", "belt", "cape", "ring", "amulet",
];

/** Fuzzy-match an item name against the catalog. Returns best matches. */
function findItemsByName(query: string): typeof ITEM_CATALOG {
  const q = query.toLowerCase();
  // Exact match first
  const exact = ITEM_CATALOG.filter((i) => i.name.toLowerCase() === q);
  if (exact.length > 0) return exact;
  // Substring match
  const partial = ITEM_CATALOG.filter((i) => i.name.toLowerCase().includes(q));
  if (partial.length > 0) return partial;
  // Word-based: every query word must appear somewhere in the name
  const words = q.split(/\s+/);
  return ITEM_CATALOG.filter((i) => {
    const name = i.name.toLowerCase();
    return words.every((w) => name.includes(w));
  });
}

cmd({
  aliases: ["equip", "eq", "wear", "wield"],
  usage: "/equip <item name>",
  description: "Equip an item from your inventory by name",
  handler: async (args, ctx) => {
    if (!args) {
      return { response: "Usage: /equip <item name>\nExamples: /equip steel longsword, /equip chainmail shirt, /equip oak shield" };
    }
    if (!ctx.entity) return { response: "No character in world." };
    if (!ctx.custodialWallet) return { response: "No wallet found." };

    const entity = ctx.entity;
    const region = ctx.region;
    if (!region) return { response: "Not in a zone." };

    // Find item by name
    const matches = findItemsByName(args);
    const equippable = matches.filter(
      (i) => (i.category === "weapon" || i.category === "armor" || i.category === "tool") && i.equipSlot
    );

    if (equippable.length === 0) {
      if (matches.length > 0) {
        return { response: `"${matches[0].name}" is not equippable (${matches[0].category}).` };
      }
      // Suggest close matches
      const q = args.toLowerCase();
      const allEquippable = ITEM_CATALOG.filter((i) => i.equipSlot);
      const suggestions = allEquippable
        .filter((i) => {
          const name = i.name.toLowerCase();
          return q.split(/\s+/).some((w) => name.includes(w));
        })
        .slice(0, 5)
        .map((i) => `  ${i.name} (${i.equipSlot})`);
      const suggestText = suggestions.length > 0
        ? `\n\nDid you mean:\n${suggestions.join("\n")}`
        : "\n\nUse /bag to see your inventory.";
      return { response: `No equippable item matching "${args}".${suggestText}` };
    }

    if (equippable.length > 1) {
      // Check if there's a single exact name match among equippable
      const exactMatch = equippable.filter((i) => i.name.toLowerCase() === args.toLowerCase());
      if (exactMatch.length === 1) {
        equippable.length = 0;
        equippable.push(exactMatch[0]);
      } else {
        const list = equippable.slice(0, 8).map((i) => `  ${i.name} (${i.equipSlot}, ${getItemRarity(i.copperPrice)})`);
        return { response: `Multiple matches:\n${list.join("\n")}\n\nBe more specific.` };
      }
    }

    const item = equippable[0];

    // Check wallet owns the item
    const balance = await getItemBalance(ctx.custodialWallet, item.tokenId);
    if (balance < 1n) {
      return { response: `You don't own ${item.name}. Use /bag to check your inventory.` };
    }

    // Check for crafted instances — prefer highest quality
    const instances = getWalletInstances(ctx.custodialWallet)
      .filter((inst) => inst.baseTokenId === Number(item.tokenId));
    const bestInstance = instances.length > 0
      ? instances.sort((a, b) => {
          const tierOrder: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3 };
          return (tierOrder[b.quality.tier] ?? 0) - (tierOrder[a.quality.tier] ?? 0);
        })[0]
      : undefined;

    // Equip it
    entity.equipment ??= {};
    const slot = item.equipSlot!;
    const durability = bestInstance?.currentDurability ?? bestInstance?.rolledMaxDurability ?? item.maxDurability ?? 0;
    const maxDurability = bestInstance?.currentMaxDurability ?? bestInstance?.rolledMaxDurability ?? item.maxDurability ?? 0;
    const displayName = bestInstance?.displayName ?? item.name;

    entity.equipment[slot] = {
      tokenId: Number(item.tokenId),
      name: displayName,
      xrVisualId: item.xrVisualId ?? null,
      durability,
      maxDurability,
      broken: false,
      ...(bestInstance && {
        instanceId: bestInstance.instanceId,
        quality: bestInstance.quality.tier,
        rolledStats: bestInstance.rolledStats,
        enchantments: bestInstance.enchantments ? [...bestInstance.enchantments] : undefined,
        bonusAffix: bestInstance.bonusAffix
          ? {
              name: bestInstance.bonusAffix.name,
              statBonuses: bestInstance.bonusAffix.statBonuses,
              specialEffect: bestInstance.bonusAffix.specialEffect,
            }
          : undefined,
      }),
    };
    recalculateEntityVitals(entity);

    // Diary + persistence
    if (entity.walletAddress) {
      const { headline, narrative } = narrativeEquip(entity.name, entity.raceId, entity.classId, region, displayName, slot);
      logDiary(entity.walletAddress, entity.name, region, entity.x, entity.y, "equip", headline, narrative, {
        itemName: displayName,
        tokenId: item.tokenId.toString(),
        slot,
      });
      saveCharacter(entity.walletAddress, entity.name, { equipment: entity.equipment }).catch(() => {});
    }

    const rarity = getItemRarity(item.copperPrice);
    const statsText = item.statBonuses
      ? Object.entries(item.statBonuses)
          .filter(([, v]) => v !== 0)
          .map(([k, v]) => `${(v as number) > 0 ? "+" : ""}${v} ${k.toUpperCase()}`)
          .join(", ")
      : "";
    const qualityText = bestInstance ? ` [${bestInstance.quality.tier}]` : "";

    return {
      response: `Equipped ${displayName}${qualityText} → ${slot}\n${rarity} ${item.category} | ${statsText || "no stat bonuses"} | ${durability}/${maxDurability} durability`,
    };
  },
});

// ── /unequip ──────────────────────────────────────────────────────────────

cmd({
  aliases: ["unequip", "uneq", "remove"],
  usage: "/unequip <slot or item name>",
  description: "Unequip an item by slot (weapon, chest, etc.) or item name",
  handler: async (args, ctx) => {
    if (!args) {
      const equipped = ctx.entity?.equipment
        ? Object.entries(ctx.entity.equipment)
            .filter(([, v]) => v != null)
            .map(([slot, item]: [string, any]) => `  ${slot}: ${item.name ?? `#${item.tokenId}`}`)
        : [];
      const gearList = equipped.length > 0 ? equipped.join("\n") : "  (nothing equipped)";
      return { response: `Usage: /unequip <slot or item name>\nSlots: ${EQUIPMENT_SLOTS.join(", ")}\n\nCurrently equipped:\n${gearList}` };
    }
    if (!ctx.entity) return { response: "No character in world." };

    const entity = ctx.entity;
    const region = ctx.region;
    if (!region) return { response: "Not in a zone." };

    const input = args.toLowerCase().trim();

    // Try as slot name first
    let slot: EquipmentSlot | null = null;
    if (EQUIPMENT_SLOTS.includes(input as EquipmentSlot)) {
      slot = input as EquipmentSlot;
    } else {
      // Try matching by item name in equipped items
      if (entity.equipment) {
        for (const [s, item] of Object.entries(entity.equipment)) {
          if (!item) continue;
          if ((item as any).name?.toLowerCase().includes(input)) {
            slot = s as EquipmentSlot;
            break;
          }
        }
      }
    }

    if (!slot) {
      return { response: `No equipped item matching "${args}".\nUse /status to see your gear, or specify a slot: ${EQUIPMENT_SLOTS.join(", ")}` };
    }

    const equipped = entity.equipment?.[slot];
    if (!equipped) {
      return { response: `Nothing equipped in ${slot} slot.` };
    }

    const itemName = (equipped as any).name ?? `item #${(equipped as any).tokenId}`;

    // Unequip
    delete entity.equipment![slot];
    if (Object.keys(entity.equipment ?? {}).length === 0) {
      entity.equipment = undefined;
    }
    recalculateEntityVitals(entity);

    if (entity.walletAddress) {
      const { headline, narrative } = narrativeUnequip(entity.name, entity.raceId, entity.classId, region, slot);
      logDiary(entity.walletAddress, entity.name, region, entity.x, entity.y, "unequip", headline, narrative, { slot });
      saveCharacter(entity.walletAddress, entity.name, { equipment: entity.equipment ?? {} }).catch(() => {});
    }

    return { response: `Unequipped ${itemName} from ${slot}.` };
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
