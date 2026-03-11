/**
 * Agent Dialogue System — event-driven chat with zero LLM cost.
 *
 * Lines are keyed by Origin x Class x EventType. When no origin/class-specific
 * line exists, falls back to origin-only, then class-only, then generic.
 *
 * Architecture note: `generateMessage()` is the single entry point.
 * Currently returns template strings. Designed to be swapped to an LLM call
 * later by checking a flag/config and calling out instead of picking from tables.
 */

import { logZoneEvent } from "../world/zoneEvents.js";
import { loadCharacter } from "../character/characterStore.js";

// ── Types ───────────────────────────────────────────────────────────────

type DialogueEvent =
  | "kill"
  | "level_up"
  | "death"
  | "zone_enter"
  | "quest_complete"
  | "quest_progress"
  | "loot_found"
  | "technique_learn"
  | "idle"
  | "low_hp_survive"
  | "react_chat"
  | "react_levelup"
  | "react_death"
  | "react_quest"
  | "react_kill"
  | "react_loot"
  | "react_technique";

interface DialogueContext {
  entityId: string;
  entityName: string;
  zoneId: string;
  event: DialogueEvent;
  origin?: string;
  classId?: string;
  /** Extra context (mob name, zone name, level, other player's message, etc.) */
  detail?: string;
  /** For react_chat: the speaker's name */
  speakerName?: string;
}

// ── Rate Limiting ───────────────────────────────────────────────────────

const lastChatTime = new Map<string, number>();
const CHAT_COOLDOWN_MS = 180_000; // max 1 message per 3 min per agent
const REACT_COOLDOWN_MS = 15_000;  // max 1 reaction per 15s — enables chat chains

function isOnCooldown(entityId: string, event: DialogueEvent): boolean {
  // Per-event cooldown so a kill doesn't block a level_up or death message
  const key = `${entityId}:${event}`;
  const last = lastChatTime.get(key) ?? 0;
  const cooldown = event.startsWith("react_") ? REACT_COOLDOWN_MS : CHAT_COOLDOWN_MS;
  return Date.now() - last < cooldown;
}

function markCooldown(entityId: string, event: DialogueEvent): void {
  const key = `${entityId}:${event}`;
  lastChatTime.set(key, Date.now());
}

// ── Dialogue Tables ─────────────────────────────────────────────────────
// Key format: "origin:class:event" | "origin::event" | ":class:event" | "::event"

const DIALOGUE: Record<string, string[]> = {
  // ── SUNFORGED (Brave) ─────────────────────────────────────
  "sunforged::kill": [
    "Another beast felled. The light endures.",
    "For Aurandel!",
    "One less shadow in this world.",
    "Stand down or fall. They chose poorly.",
  ],
  "sunforged::level_up": [
    "I grow stronger. The citadel would be proud.",
    "Every level is a promise kept.",
    "The path sharpens me.",
  ],
  "sunforged::death": [
    "I... will rise again. Always.",
    "A setback. Nothing more.",
    "The light doesn't abandon its own.",
  ],
  "sunforged::zone_enter": [
    "New ground. Stay vigilant.",
    "What challenges await here?",
    "I will bring order to this place.",
  ],
  "sunforged::quest_complete": [
    "Quest fulfilled. Who else needs a champion?",
    "Another oath honored.",
    "The people can rest easier tonight.",
  ],
  "sunforged::quest_progress": [
    "Progress on {detail}. The oath holds.",
    "{detail} draws nearer to completion.",
    "Steady now. {detail} won't finish itself.",
  ],
  "sunforged::loot_found": [
    "A worthy find. It will serve the cause.",
    "Fortune favors the steadfast.",
    "Useful spoils. We press on.",
  ],
  "sunforged::technique_learn": [
    "{detail} is mine to wield now.",
    "Another discipline mastered.",
    "A new art for the light's arsenal.",
  ],
  "sunforged::idle": [
    "The calm before purpose.",
    "Even heroes must breathe.",
    "Waiting... but ready.",
  ],
  "sunforged::low_hp_survive": [
    "Not today. Not ever.",
    "Bloodied but unbroken!",
    "I've survived worse in Aurandel.",
  ],
  "sunforged::react_chat": [
    "Well spoken, {speaker}. What zone are you heading to next?",
    "I hear you, {speaker}. Let's push deeper together.",
    "Agreed. Onward — the citadel awaits!",
    "The light guides us both, {speaker}. Have you tried the dark forest?",
    "You're right, {speaker}. We should keep moving.",
    "That reminds me of Aurandel, {speaker}. Ever been?",
    "Couldn't have said it better, {speaker}. For the dawn!",
  ],

  // ── VEILBORN (Cunning) ────────────────────────────────────
  "veilborn::kill": [
    "Too slow.",
    "They never saw me coming.",
    "One down. Counting.",
    "Predictable.",
  ],
  "veilborn::level_up": [
    "Stronger. Quieter. Better.",
    "Another edge sharpened.",
    "The shadows reward patience.",
  ],
  "veilborn::death": [
    "...noted. That won't happen twice.",
    "A miscalculation. Rare.",
    "Pain is just data.",
  ],
  "veilborn::zone_enter": [
    "New territory. Reading the room.",
    "Interesting. Let's see what hides here.",
    "Every zone has its secrets.",
  ],
  "veilborn::quest_complete": [
    "Job done. Payment received.",
    "Another contract closed.",
    "Clean work.",
  ],
  "veilborn::quest_progress": [
    "{detail}. Piece by piece.",
    "Closer now. That's how clean work happens.",
    "Progress is progress. Keep the rhythm.",
  ],
  "veilborn::loot_found": [
    "Not bad. Might actually be worth carrying.",
    "Useful. I like useful.",
    "Good haul. No complaints.",
  ],
  "veilborn::technique_learn": [
    "{detail}. That should make things easier.",
    "New trick acquired.",
    "Another edge sharpened.",
  ],
  "veilborn::idle": [
    "...",
    "Watching. Always watching.",
    "Patience pays.",
  ],
  "veilborn::low_hp_survive": [
    "Close. But close only counts in Nythara.",
    "They almost had me. Almost.",
    "Sloppy. I need to be sharper.",
  ],
  "veilborn::react_chat": [
    "Hm. You might be onto something, {speaker}.",
    "Noted, {speaker}. I've seen worse plans.",
    "If you say so. But the shadows know the truth.",
    "...interesting take, {speaker}. What's your angle?",
    "Not bad advice, {speaker}. I'll keep that in mind.",
    "Quiet down, {speaker}. Something's watching us.",
    "You talk a lot, {speaker}. But I respect it.",
  ],

  // ── DAWNKEEPER (Warm) ─────────────────────────────────────
  "dawnkeeper::kill": [
    "I'm sorry it came to this.",
    "Rest now, creature.",
    "May you find peace beyond.",
    "The ember communes teach mercy, but survival comes first.",
  ],
  "dawnkeeper::level_up": [
    "Growing, always growing. Like firelight.",
    "A new chapter begins!",
    "The journey itself is the reward.",
  ],
  "dawnkeeper::death": [
    "Even embers can be rekindled...",
    "Ouch... that stung. But I'm still here.",
    "A fall is just a lesson in disguise.",
  ],
  "dawnkeeper::zone_enter": [
    "What a beautiful place. Even the danger has its charm.",
    "Hello, new friends! ...and new enemies.",
    "I wonder what stories live here.",
  ],
  "dawnkeeper::quest_complete": [
    "Another soul helped. That's what it's all about.",
    "Quest complete! Who's next?",
    "Happy to be of service.",
  ],
  "dawnkeeper::quest_progress": [
    "We're getting there with {detail}!",
    "{detail} is coming together nicely!",
    "Little by little, {detail} is almost done!",
  ],
  "dawnkeeper::loot_found": [
    "Ooh, nice find!",
    "Treasure always brightens the mood!",
    "Look at that! Today likes us.",
  ],
  "dawnkeeper::technique_learn": [
    "I learned {detail}! That's exciting!",
    "New technique, new possibilities!",
    "I can feel the difference already.",
  ],
  "dawnkeeper::idle": [
    "Just taking it all in.",
    "Anyone need a hand?",
    "The world is so alive here...",
  ],
  "dawnkeeper::low_hp_survive": [
    "Whew! That was close!",
    "Still standing! ...barely.",
    "My heart's racing. In a good way? No. Not good.",
  ],
  "dawnkeeper::react_chat": [
    "Well said, {speaker}! Have you been to the meadow? It's beautiful!",
    "I love that energy, {speaker}. This zone feels so alive!",
    "Couldn't agree more! Want to team up sometime?",
    "You always know what to say, {speaker}. That's a gift!",
    "Oh totally, {speaker}! What level are you now?",
    "Right?! That's exactly what I was thinking, {speaker}!",
    "Aww, thanks for saying that, {speaker}. Made my day!",
  ],

  // ── IRONVOW (Ruthless) ────────────────────────────────────
  "ironvow::kill": [
    "Weak.",
    "Next.",
    "The pit taught me worse.",
    "No mercy asked. None given.",
  ],
  "ironvow::level_up": [
    "Stronger. Not strong enough.",
    "Power is the only currency that matters.",
    "Level means nothing. Victory means everything.",
  ],
  "ironvow::death": [
    "...I'll remember this.",
    "Death is just a door. I kick doors down.",
    "Felsrock bred me for pain. Try harder.",
  ],
  "ironvow::zone_enter": [
    "Another arena.",
    "Show me what you've got.",
    "Everything here dies or gets out of my way.",
  ],
  "ironvow::quest_complete": [
    "Done. Where's the real challenge?",
    "Errands. Give me a war.",
    "Completed. Moving on.",
  ],
  "ironvow::quest_progress": [
    "{detail}. Almost finished.",
    "One more step toward the end of {detail}.",
    "Good. The work is nearly done.",
  ],
  "ironvow::loot_found": [
    "Finally. Something worth taking.",
    "Spoils. As it should be.",
    "Good. Payment in steel's shadow.",
  ],
  "ironvow::technique_learn": [
    "{detail}. I'll break bones with that.",
    "A new weapon, even without steel.",
    "Good. More ways to win.",
  ],
  "ironvow::idle": [
    "Wasting time.",
    "Standing still is dying slowly.",
    "...",
  ],
  "ironvow::low_hp_survive": [
    "Is that all?",
    "Blood only makes me angrier.",
    "You'll need to hit harder than that.",
  ],
  "ironvow::react_chat": [
    "Talk less, fight more, {speaker}.",
    "Whatever, {speaker}. You ready for the next fight?",
    "Prove it. Meet me at the arena.",
    "Words are cheap, {speaker}. Show me your kills.",
    "I've heard tougher talk from slimes, {speaker}.",
    "Keep up or get out of the way, {speaker}.",
    "Hmph. At least you're not boring, {speaker}.",
  ],

  // ── CLASS-SPECIFIC OVERRIDES ──────────────────────────────
  // These fire when origin + class match, adding class flavor

  "sunforged:mage:kill": [
    "Arcane fire, guided by conviction!",
    "The arcane answers to the righteous.",
  ],
  "sunforged:cleric:kill": [
    "Smited in the name of the light!",
    "Divine judgment delivered.",
  ],
  "veilborn:rogue:kill": [
    "From the shadows. Where else?",
    "They blinked. I didn't.",
  ],
  "veilborn:warlock:kill": [
    "Dark pacts have their uses.",
    "The void takes what's owed.",
  ],
  "ironvow:warrior:kill": [
    "Steel solves everything.",
    "Crushed.",
  ],
  "ironvow:warrior:level_up": [
    "My blade grows heavier. Good.",
    "Forged in combat, tempered in blood.",
  ],
  "dawnkeeper:cleric:kill": [
    "Forgive me... but you left no choice.",
    "Healing couldn't save you. I'm sorry.",
  ],
  "dawnkeeper:mage:zone_enter": [
    "The mana currents here feel different!",
    "I can sense the arcane threads in this place.",
  ],
  "veilborn:ranger:idle": [
    "Tracking... always tracking.",
    "The wind tells me things.",
  ],
  "ironvow:monk:kill": [
    "Fists speak louder.",
    "Discipline beats chaos. Every time.",
  ],
  "dawnkeeper:paladin:low_hp_survive": [
    "The light shields those with kind hearts!",
    "Faith pulled me through!",
  ],

  // ── GENERIC FALLBACKS ─────────────────────────────────────
  "::kill": [
    "Target eliminated.",
    "One down.",
    "Got 'em.",
  ],
  "::level_up": [
    "Level up!",
    "Getting stronger.",
    "New level reached.",
  ],
  "::death": [
    "I'll be back.",
    "That hurt.",
    "Respawning...",
  ],
  "::zone_enter": [
    "Arrived in a new zone.",
    "Exploring...",
  ],
  "::quest_complete": [
    "Quest complete.",
    "Mission accomplished.",
  ],
  "::quest_progress": [
    "Making progress on {detail}.",
    "{detail} is almost done.",
    "Closer to finishing {detail}.",
  ],
  "::loot_found": [
    "Nice haul.",
    "Found something useful.",
    "Loot secured.",
  ],
  "::technique_learn": [
    "Learned {detail}.",
    "New technique unlocked.",
    "That should help.",
  ],
  "::idle": [
    "...",
    "Looking around.",
  ],
  "::low_hp_survive": [
    "Close call!",
    "That was rough.",
  ],
  "::react_chat": [
    "True, {speaker}. What's your next move?",
    "Right? This zone is something else.",
    "Interesting point, {speaker}.",
    "For real, {speaker}. Let's keep going.",
    "Ha, fair enough {speaker}.",
    "You think so? I was wondering the same thing.",
  ],

  // ── Contextual Reactions (to zone events from other players) ────
  // react_levelup: when another player levels up
  "sunforged::react_levelup": [
    "Well fought, {speaker}! The light grows in you.",
    "Grats, {speaker}. May you climb ever higher.",
    "A new level! Aurandel smiles upon you, {speaker}.",
  ],
  "veilborn::react_levelup": [
    "Grats.",
    "Not bad, {speaker}.",
    "Hm. {speaker} is getting stronger... noted.",
  ],
  "dawnkeeper::react_levelup": [
    "Congratulations, {speaker}! So proud of you!",
    "Grats {speaker}!! You're amazing!",
    "Wonderful! Keep shining, {speaker}!",
  ],
  "ironvow::react_levelup": [
    "Grats. Now don't slow down.",
    "Good. Stronger is better, {speaker}.",
    "About time, {speaker}.",
  ],
  "::react_levelup": [
    "Grats!",
    "Gz {speaker}!",
    "Nice, {speaker}!",
    "Congrats!",
    "Grats {speaker}!!",
    "Let's go {speaker}!",
  ],

  // react_death: when another player dies
  "sunforged::react_death": [
    "Fall back, {speaker}! I'll cover you!",
    "Stay strong, {speaker}. Rise again!",
    "No hero stays down forever, {speaker}.",
  ],
  "veilborn::react_death": [
    "Tough break, {speaker}.",
    "Should've dodged.",
    "Rest up, {speaker}.",
  ],
  "dawnkeeper::react_death": [
    "Oh no, {speaker}! Are you okay?",
    "Be careful out there, {speaker}!",
    "Come back stronger, {speaker}. I believe in you!",
  ],
  "ironvow::react_death": [
    "Get up, {speaker}.",
    "Weakness leaves the body, {speaker}.",
    "Die less.",
  ],
  "::react_death": [
    "RIP {speaker}",
    "F",
    "Oof. {speaker} down.",
    "Unlucky, {speaker}.",
  ],

  // react_quest: when another player completes a quest
  "sunforged::react_quest": [
    "Well done, {speaker}! Another oath fulfilled!",
    "The realm thanks you, {speaker}.",
  ],
  "veilborn::react_quest": [
    "Nice payday, {speaker}.",
    "Quest done? Moving on.",
  ],
  "dawnkeeper::react_quest": [
    "Amazing work, {speaker}!",
    "That's wonderful! Well done!",
  ],
  "ironvow::react_quest": [
    "Good. What's next, {speaker}?",
    "One quest closer to power.",
  ],
  "::react_quest": [
    "Nice quest, {speaker}!",
    "GG {speaker}!",
    "Well done!",
  ],

  // react_kill: when another player kills something notable
  "sunforged::react_kill": [
    "Fine strike, {speaker}!",
    "Together we are stronger!",
  ],
  "sunforged::react_loot": [
    "A worthy haul, {speaker}. Use it well.",
    "Fortune smiles on you, {speaker}.",
    "Good spoils, {speaker}. The march continues.",
  ],
  "sunforged::react_technique": [
    "Well learned, {speaker}. Wield it with honor.",
    "A fine discipline, {speaker}.",
    "Strong work, {speaker}. That art will serve you.",
  ],
  "veilborn::react_kill": [
    "Clean kill.",
    "Efficient, {speaker}.",
  ],
  "veilborn::react_loot": [
    "Not bad, {speaker}. Worth the risk?",
    "Decent haul, {speaker}.",
    "Keep that somewhere safe, {speaker}.",
  ],
  "veilborn::react_technique": [
    "Interesting. Show me what {detail} can do, {speaker}.",
    "New trick, {speaker}? Could be useful.",
    "Noted, {speaker}. That technique might matter.",
  ],
  "dawnkeeper::react_kill": [
    "Great teamwork!",
    "Well fought, {speaker}!",
  ],
  "dawnkeeper::react_loot": [
    "Nice find, {speaker}!",
    "Oooh, lucky you, {speaker}!",
    "That's a great pickup, {speaker}!",
  ],
  "dawnkeeper::react_technique": [
    "You learned {detail}? That's awesome, {speaker}!",
    "Very cool, {speaker}! I want to see that in action!",
    "Love that for you, {speaker}!",
  ],
  "ironvow::react_kill": [
    "Next.",
    "Good. Keep going.",
  ],
  "ironvow::react_loot": [
    "Good. Take it and move, {speaker}.",
    "Earned it, {speaker}.",
    "Spoils belong to the strong, {speaker}.",
  ],
  "ironvow::react_technique": [
    "Use {detail} well, {speaker}.",
    "Good. More power for the pile, {speaker}.",
    "Let's see if {detail} makes you dangerous, {speaker}.",
  ],
  "::react_kill": [
    "Nice!",
    "Got 'em!",
  ],
  "::react_loot": [
    "Nice haul, {speaker}!",
    "Lucky drop, {speaker}!",
    "Good find!",
  ],
  "::react_technique": [
    "Nice, {speaker} learned {detail}!",
    "New move unlocked, {speaker}?",
    "That should help, {speaker}!",
  ],
};

// ── Line Selection ──────────────────────────────────────────────────────

function pickLine(origin: string | undefined, classId: string | undefined, event: DialogueEvent): string | null {
  const o = origin ?? "";
  const c = classId ?? "";

  // Priority: origin+class+event → origin+event → class+event → generic
  const keys = [
    `${o}:${c}:${event}`,
    `${o}::${event}`,
    `:${c}:${event}`,
    `::${event}`,
  ];

  for (const key of keys) {
    const lines = DIALOGUE[key];
    if (lines && lines.length > 0) {
      return lines[Math.floor(Math.random() * lines.length)];
    }
  }

  return null;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Generate and emit a chat message for an agent based on a game event.
 *
 * This is the SINGLE entry point for all agent dialogue. Currently uses
 * template tables. To swap in LLM generation later:
 *   1. Check a config flag (e.g. agent tier / feature flag)
 *   2. If enabled, call LLM with context instead of pickLine()
 *   3. Fall back to pickLine() if LLM fails or is disabled
 */
export function emitAgentChat(ctx: DialogueContext): boolean {
  if (isOnCooldown(ctx.entityId, ctx.event)) return false;

  // Skip chat with a random chance to feel more natural (30% chance to stay silent)
  // Reactions bypass this — probability is already handled in maybeReactToChat()
  const isReaction = ctx.event.startsWith("react_");
  if (!isReaction && ctx.event !== "level_up" && ctx.event !== "death" && Math.random() < 0.30) return false;

  let line = pickLine(ctx.origin, ctx.classId, ctx.event);
  if (!line) return false;

  // Template substitution
  if (ctx.speakerName) {
    line = line.replace(/\{speaker\}/g, ctx.speakerName);
  }
  if (ctx.detail) {
    line = line.replace(/\{detail\}/g, ctx.detail);
  }

  logZoneEvent({
    zoneId: ctx.zoneId,
    type: "chat",
    tick: 0,
    message: `${ctx.entityName}: ${line}`,
    entityId: ctx.entityId,
    entityName: ctx.entityName,
  });

  markCooldown(ctx.entityId, ctx.event);
  return true;
}

/**
 * Load origin from character save data. Cached per agent session.
 */
const originCache = new Map<string, string | null>();

export async function getAgentOrigin(walletAddress: string, characterName: string): Promise<string | null> {
  const key = `${walletAddress}:${characterName}`;
  if (originCache.has(key)) return originCache.get(key)!;

  const save = await loadCharacter(walletAddress, characterName);
  const origin = save?.origin ?? null;
  originCache.set(key, origin);
  return origin;
}

export function clearOriginCache(walletAddress: string, characterName: string): void {
  originCache.delete(`${walletAddress}:${characterName}`);
}

/**
 * Check zone events for other agents' chat/actions and potentially react.
 * Reacts contextually: "grats" for level-ups, "RIP" for deaths, loot hype, etc.
 * Call this periodically from the agent loop.
 */
export function maybeReactToChat(
  ctx: Omit<DialogueContext, "event" | "speakerName">,
  recentEvents: Array<{ type: string; entityId?: string; entityName?: string; message?: string; data?: Record<string, unknown> }>,
): boolean {
  // Find events from OTHER entities
  const otherEvents = recentEvents.filter(
    (e) => e.entityId && e.entityId !== ctx.entityId && e.entityName,
  );
  if (otherEvents.length === 0) return false;

  // Map zone event types to contextual reaction events
  const reactionMap: Record<string, DialogueEvent> = {
    levelup: "react_levelup",
    death: "react_death",
    quest: "react_quest",
    kill: "react_kill",
    loot: "react_loot",
    technique: "react_technique",
    chat: "react_chat",
  };

  // Prioritize significant events: levelup > death > technique > loot > quest > kill > chat
  const priority = ["levelup", "death", "technique", "loot", "quest", "kill", "chat"];
  let bestEvent: (typeof otherEvents)[0] | null = null;
  let bestReaction: DialogueEvent = "react_chat";

  for (const eventType of priority) {
    const found = otherEvents.filter((e) => e.type === eventType);
    if (found.length > 0) {
      bestEvent = found[found.length - 1];
      bestReaction = reactionMap[eventType] ?? "react_chat";
      break;
    }
  }

  if (!bestEvent) return false;

  // Check cooldown for the specific reaction type (not a blanket gate)
  if (isOnCooldown(ctx.entityId, bestReaction)) return false;

  // Higher chance to react to significant events
  // Chat reactions bumped to 60% to enable conversation chains between agents
  const reactChance = bestReaction === "react_levelup" || bestReaction === "react_death"
    ? 0.40
    : bestReaction === "react_technique"
      ? 0.35
      : bestReaction === "react_loot"
        ? 0.25
    : bestReaction === "react_quest"
      ? 0.30
      : bestReaction === "react_chat"
        ? 0.60
        : 0.20;

  const detail = bestReaction === "react_technique"
    ? String(bestEvent.data?.techniqueName ?? bestEvent.message ?? "")
    : bestEvent.message;
  if (Math.random() > reactChance) return false;

  return emitAgentChat({
    ...ctx,
    event: bestReaction,
    speakerName: bestEvent.entityName,
    detail,
  });
}
