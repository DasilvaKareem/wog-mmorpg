import { Type, type Schema } from "@google/genai";
import type { Entity } from "../world/zoneRuntime.js";
import { getRedis } from "../redis.js";
import { gemini } from "../agents/geminiClient.js";
import { getAvailableQuestsForPlayer, isQuestComplete, npcMatchesQuestId, QUEST_CATALOG, type ActiveQuest, type Quest } from "./questSystem.js";
import { getNpcPersona, type NpcPersona } from "./npcPersonas.js";
import {
  validateNpcDialogueDraft,
  type NpcDialogueDraft,
  type NpcDialogueIntent,
  type SuggestedNpcAction,
} from "./npcDialogueValidator.js";

export interface NpcDialogueHistoryEntry {
  role: "player" | "npc";
  content: string;
}

export interface NpcDialogueContext {
  npc: Entity;
  player: Entity;
  message: string;
  recentHistory: NpcDialogueHistoryEntry[];
}

interface QuestStateView {
  available: Quest[];
  active: Array<{ quest: Quest; progress: number; required: number; complete: boolean }>;
  completable: Array<{ quest: Quest; progress: number; required: number }>;
}

export interface NpcDialogueResponse {
  provider: "deterministic" | "llm";
  persona: {
    id: string;
    role: string;
    archetype: string;
    tone: string;
  };
  reply: string;
  intent: NpcDialogueIntent;
  referencesQuestId?: string;
  suggestedActions: SuggestedNpcAction[];
  questContext: {
    availableQuestIds: string[];
    activeQuestIds: string[];
    completableQuestIds: string[];
  };
}

const NPC_DIALOGUE_MODEL = process.env.NPC_DIALOGUE_MODEL?.trim() || "gemini-2.5-flash-lite";
const NPC_DIALOGUE_TIMEOUT_MS = Number(process.env.NPC_DIALOGUE_TIMEOUT_MS ?? "12000");
const NPC_DIALOGUE_TEMPERATURE = Number(process.env.NPC_DIALOGUE_TEMPERATURE ?? "0.6");
const NPC_DIALOGUE_LLM_ENABLED = Boolean(
  process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.GEMINI_API_KEY?.trim(),
);
/** Force LLM on every turn (debug/eval). Default: skip LLM whenever the
 * deterministic branch matched a confident keyword pattern. */
const NPC_DIALOGUE_FORCE_LLM = process.env.NPC_DIALOGUE_FORCE_LLM === "1";
const SCOUT_KAELA_NAME = "Scout Kaela";
const SCOUT_KAELA_BRIEFED_FLAG = "tutorial:scout_kaela_briefed";
const NPC_DIALOGUE_ALLOWED_INTENTS: NpcDialogueIntent[] = [
  "greeting",
  "offer_quest",
  "quest_progress",
  "quest_turn_in",
  "tutorial",
  "lore",
  "redirect",
  "refuse",
];

// ── Redis-backed conversation history + visit counter ────────────────
// The client supplies recentHistory for back-compat, but a malicious client
// could replay a fabricated history to coax the LLM. Server-owned history
// keyed by (player wallet, npc entityId) is authoritative. History expires
// after an hour of inactivity; expiry implicitly marks a new "session".

const NPC_HISTORY_PREFIX = "npc:history";
const NPC_VISITS_PREFIX = "npc:visits";
const NPC_RL_MIN_PREFIX = "npc:rl:min";
const NPC_RL_DAY_PREFIX = "npc:rl:day";
const NPC_HISTORY_MAX_TURNS = 12;
const NPC_HISTORY_TTL_SEC = 60 * 60;
const NPC_RL_MIN_LIMIT = 20;
const NPC_RL_DAY_LIMIT = 500;
const NPC_VISITS_TTL_SEC = 60 * 60 * 24 * 30; // refresh on each visit

function historyKey(wallet: string, npcEntityId: string): string {
  return `${NPC_HISTORY_PREFIX}:${wallet.toLowerCase()}:${npcEntityId}`;
}
function visitsKey(wallet: string, npcName: string): string {
  return `${NPC_VISITS_PREFIX}:${wallet.toLowerCase()}:${npcName}`;
}

async function loadServerHistory(wallet: string | undefined, npcEntityId: string): Promise<NpcDialogueHistoryEntry[]> {
  if (!wallet) return [];
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw: string[] = await redis.lrange(historyKey(wallet, npcEntityId), 0, -1);
    const out: NpcDialogueHistoryEntry[] = [];
    for (const item of raw) {
      try {
        const parsed = JSON.parse(item);
        if (parsed && (parsed.role === "player" || parsed.role === "npc") && typeof parsed.content === "string") {
          out.push({ role: parsed.role, content: parsed.content });
        }
      } catch { /* skip malformed */ }
    }
    return out;
  } catch {
    return [];
  }
}

async function appendServerHistory(
  wallet: string | undefined,
  npcEntityId: string,
  entries: NpcDialogueHistoryEntry[],
): Promise<void> {
  if (!wallet || entries.length === 0) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = historyKey(wallet, npcEntityId);
    const serialized = entries.map((e) => JSON.stringify({ role: e.role, content: e.content.slice(0, 220) }));
    await redis.rpush(key, ...serialized);
    await redis.ltrim(key, -NPC_HISTORY_MAX_TURNS, -1);
    await redis.expire(key, NPC_HISTORY_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

/** Bump the (player, npc) visit counter when Redis history is empty — that's
 * our proxy for "new session". Returns the (possibly incremented) counter. */
async function getOrBumpVisitCount(
  wallet: string | undefined,
  npcName: string,
  serverHistoryWasEmpty: boolean,
): Promise<number> {
  if (!wallet) return 0;
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const k = visitsKey(wallet, npcName);
    let value: number;
    if (serverHistoryWasEmpty) {
      value = await redis.incr(k);
    } else {
      const raw = await redis.get(k);
      value = raw ? Number(raw) || 0 : 0;
    }
    await redis.expire(k, NPC_VISITS_TTL_SEC);
    return value;
  } catch {
    return 0;
  }
}

/** Per-player rate limit: returns true if the call should proceed. */
export async function checkNpcDialogueRateLimit(wallet: string | undefined): Promise<{ allowed: boolean; reason?: "minute" | "day" }> {
  if (!wallet) return { allowed: true };
  const redis = getRedis();
  if (!redis) return { allowed: true };
  try {
    const minKey = `${NPC_RL_MIN_PREFIX}:${wallet.toLowerCase()}`;
    const dayKey = `${NPC_RL_DAY_PREFIX}:${wallet.toLowerCase()}`;
    const minCount = await redis.incr(minKey);
    if (minCount === 1) await redis.expire(minKey, 60);
    if (minCount > NPC_RL_MIN_LIMIT) return { allowed: false, reason: "minute" };
    const dayCount = await redis.incr(dayKey);
    if (dayCount === 1) await redis.expire(dayKey, 60 * 60 * 24);
    if (dayCount > NPC_RL_DAY_LIMIT) return { allowed: false, reason: "day" };
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/** Deterministic fallback when the rate limit fires. The route handler can
 * return this without ever touching the LLM. */
export function buildRateLimitedReply(npc: Entity): NpcDialogueResponse {
  const persona = getNpcPersona(npc);
  return {
    provider: "deterministic",
    persona: { id: persona.id, role: persona.role, archetype: persona.archetype, tone: persona.tone },
    reply: `${npc.name} is tied up — give them a moment.`,
    intent: "redirect",
    suggestedActions: [],
    questContext: { availableQuestIds: [], activeQuestIds: [], completableQuestIds: [] },
  };
}

function sanitizeHistory(history: NpcDialogueHistoryEntry[]): NpcDialogueHistoryEntry[] {
  return history
    .filter((entry) => entry && (entry.role === "player" || entry.role === "npc"))
    .map((entry) => ({
      role: entry.role,
      content: entry.content.replace(/\s+/g, " ").trim().slice(0, 220),
    }))
    .filter((entry) => entry.content.length > 0)
    .slice(-6);
}

function objectiveLabel(quest: Quest): string {
  const objective = quest.objective;
  if (objective.type === "kill") {
    return `Defeat ${objective.count} ${objective.targetMobName ?? objective.targetMobType ?? "enemies"}`;
  }
  if (objective.type === "gather") {
    return `Gather ${objective.count} ${objective.targetItemName ?? "items"}`;
  }
  if (objective.type === "craft") {
    return `Craft ${objective.count} ${objective.targetItemName ?? "items"}`;
  }
  return `Speak with ${objective.targetNpcName ?? "the target"}`;
}

function buildQuestState(player: Entity, npc: Entity): QuestStateView {
  const completedQuestIds = player.completedQuests ?? [];
  const activeQuestIds = (player.activeQuests ?? []).map((quest) => quest.questId);
  const storyFlags = player.storyFlags ?? [];

  const available = getAvailableQuestsForPlayer(
    npc,
    completedQuestIds,
    activeQuestIds,
    storyFlags,
  );

  const active = (player.activeQuests ?? [])
    .map((entry: ActiveQuest) => {
      const quest = QUEST_CATALOG.find((candidate) => candidate.id === entry.questId);
      if (!quest || !npcMatchesQuestId(npc, quest.npcId)) return null;
      const required = quest.objective.count;
      const complete = isQuestComplete(quest, entry.progress);
      return { quest, progress: entry.progress, required, complete };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return {
    available,
    active,
    completable: active
      .filter((entry) => entry.complete)
      .map((entry) => ({ quest: entry.quest, progress: entry.progress, required: entry.required })),
  };
}

function defaultSuggestedActions(persona: NpcPersona, questState: QuestStateView): SuggestedNpcAction[] {
  if (questState.completable.length > 0) {
    const top = questState.completable[0].quest;
    return [
      {
        label: "Turn in",
        prompt: `I'm ready to turn in ${top.title}.`,
        action: { kind: "complete_quest", questId: top.id },
      },
      { label: "Ask reward", prompt: `What do I earn for ${top.title}?` },
    ];
  }
  if (questState.active.length > 0) {
    return [
      { label: "Next step", prompt: `What should I focus on for ${questState.active[0].quest.title}?` },
      { label: "Directions", prompt: "Where should I go next?" },
    ];
  }
  if (questState.available.length > 0) {
    const top = questState.available[0];
    return [
      {
        label: "Accept",
        prompt: `I'll take ${top.title}.`,
        action: { kind: "accept_quest", questId: top.id },
      },
      { label: "Hear the job", prompt: `Tell me about ${top.title}.` },
    ];
  }
  return [
    { label: "Local rumors", prompt: `What should I know around here, ${persona.name}?` },
    { label: "Point me somewhere", prompt: "Where should I head next?" },
  ];
}

/** Pick a random entry from an array, seeded loosely by the player message to avoid repeating on the same input */
function pick<T>(arr: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length];
}

/** One-line ambient flavor scoped to the NPC's role. Used by the idle and
 * lore-fallback branches so a merchant doesn't deliver guard-captain lines. */
function typeFlavor(npcType: string | undefined, pName: string, seed: string): string {
  const pool = TYPE_FLAVOR[npcType ?? ""] ?? TYPE_FLAVOR.default;
  return pick(pool, seed).replace(/\{name\}/g, pName);
}

const TYPE_FLAVOR: Record<string, string[]> = {
  merchant: [
    "Prices are firm today, {name}. Coin first, conversation second.",
    "Browse if you've coin to spend. Otherwise the shelves are for paying eyes.",
    "Word from the road: caravans are thinner this season. Stock won't last.",
  ],
  auctioneer: [
    "The floor's quiet just now. Bring something worth bidding on and I'll wake the room.",
    "Listings come and go. Check back when you've got coin to spend, {name}.",
    "Hot lots move fast — keep an eye on the board.",
  ],
  "guild-registrar": [
    "Founding a banner takes coin and conviction. Either bring both or come back later.",
    "Charters cost gold, {name}. The vault remembers every deposit.",
    "Proposals open daily. Officers vote, the chain enforces.",
  ],
  "arena-master": [
    "Step onto the sand when you're ready to be tested. The crowd has no patience.",
    "Bronze, Silver, Gold — pick your tier, {name}. Reputation is earned in blood.",
    "Queues are open. Bring your strongest build, not your favorite.",
  ],
  "profession-trainer": [
    "Skill is a craft, {name}. Bring materials and time, leave with mastery.",
    "Every recipe begins with a question. What do you want to make?",
    "Train hard. Practice harder. The materials don't lie.",
  ],
  "lore-npc": [
    "There are old things here, {name}. Listen carefully and you'll hear them.",
    "Stories outlast their tellers. Be patient and the land will speak.",
    "Some truths are buried for a reason. Some aren't.",
  ],
  "quest-giver": [
    "I keep a list of what needs doing. Ask, and I'll match it to you.",
    "Idle hands don't pay in Geneva, {name}. Bring me intent.",
    "Plenty of work passes through here. Most of it dangerous.",
  ],
  trainer: [
    "Train your blade, your stance, your wits — all three or none.",
    "Skill bends to discipline. Show me discipline.",
  ],
  default: [
    "Geneva keeps moving whether we watch or not, {name}.",
    "Stay sharp. The roads aren't gentle to the careless.",
    "Whatever you need, ask plainly — I've no patience for riddles.",
  ],
};

interface DeterministicResult {
  draft: NpcDialogueDraft;
  /** True when the deterministic branch matched a strong keyword pattern
   * (greeting+quest, accept, directions, reward, turn-in, quest/help). When
   * true, the LLM call is skipped — saves tokens on the 80%+ of NPC turns
   * that don't need flavor. False for lore requests, off-script input, and
   * the idle/no-quest fallback — those are where Gemini earns its keep. */
  confident: boolean;
}

function buildDeterministicDraft(
  persona: NpcPersona,
  npc: Entity,
  player: Entity,
  message: string,
  questState: QuestStateView,
): DeterministicResult {
  const text = message.trim().toLowerCase();
  const hasBriefing = (player.storyFlags ?? []).includes(SCOUT_KAELA_BRIEFED_FLAG);
  const pName = player.name ?? "adventurer";

  if (npc.name === SCOUT_KAELA_NAME && !hasBriefing) {
    return {
      confident: true,
      draft: {
        reply: "Before you chase glory, get the basics straight. Finish my briefing, then speak with Guard Captain Marcus to begin the village chain.",
        intent: "tutorial",
        suggestedActions: [
          { label: "Finish briefing", prompt: "Give me the short version again." },
          { label: "Find Marcus", prompt: "Where exactly do I find Guard Captain Marcus?" },
        ],
      },
    };
  }

  // ── Completable quest — ready to turn in ──
  if (questState.completable.length > 0) {
    const quest = questState.completable[0].quest;
    const replies = [
      `You've done the work on "${quest.title}". Come turn it in and claim what's yours, ${pName}.`,
      `"${quest.title}" — finished, I take it? Report back and I'll see you rewarded.`,
      `I can see it in your eyes, ${pName}. "${quest.title}" is done. Let's settle up.`,
    ];
    return {
      confident: true,
      draft: {
        reply: pick(replies, text),
        intent: "quest_turn_in",
        referencesQuestId: quest.id,
        suggestedActions: [
          { label: "Turn in quest", prompt: `I'm ready to turn in ${quest.title}.` },
          { label: "Review reward", prompt: `Remind me what ${quest.title} pays.` },
        ],
      },
    };
  }

  // ── Keyword: rewards/pay ──
  if (/\b(reward|pay|earn|gold|xp)\b/.test(text) && questState.active.length > 0) {
    const quest = questState.active[0].quest;
    return {
      confident: true,
      draft: {
        reply: `"${quest.title}" pays out when the work is done. Finish ${objectiveLabel(quest).toLowerCase()} and come back to me.`,
        intent: "quest_progress",
        referencesQuestId: quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
      },
    };
  }

  // ── Keyword: directions ──
  if (/\b(where|lost|direction|directions|go next|next)\b/.test(text)) {
    if (questState.active.length > 0) {
      const quest = questState.active[0];
      return {
        confident: true,
        draft: {
          reply: `Stay focused on "${quest.quest.title}". Your next step: ${objectiveLabel(quest.quest)}. You're ${quest.progress}/${quest.required} through it.`,
          intent: "quest_progress",
          referencesQuestId: quest.quest.id,
          suggestedActions: defaultSuggestedActions(persona, questState),
        },
      };
    }
    if (questState.available.length > 0) {
      const quest = questState.available[0];
      return {
        confident: true,
        draft: {
          reply: `If you're ready for work, start with "${quest.title}". ${quest.description}`,
          intent: "offer_quest",
          referencesQuestId: quest.id,
          suggestedActions: defaultSuggestedActions(persona, questState),
        },
      };
    }
  }

  // ── Keyword: acceptance/enthusiasm ("lets do it", "accept", "I'll take it", "sure", "yes") ──
  if (/\b(do it|accept|take it|i'm in|im in|sign me up|sure|yes|ready|let'?s go|on it)\b/.test(text)) {
    if (questState.available.length > 0) {
      const quest = questState.available[0];
      const replies = [
        `That's the spirit, ${pName}. "${quest.title}" is yours. ${objectiveLabel(quest)} — don't keep me waiting.`,
        `Good. I need someone who doesn't hesitate. "${quest.title}": ${objectiveLabel(quest).toLowerCase()}. Get it done.`,
        `Glad to hear it. Head out and ${objectiveLabel(quest).toLowerCase()} for "${quest.title}". Report back when it's finished.`,
      ];
      return {
        confident: true,
        draft: {
          reply: pick(replies, text),
          intent: "offer_quest",
          referencesQuestId: quest.id,
          suggestedActions: defaultSuggestedActions(persona, questState),
        },
      };
    }
    if (questState.active.length > 0) {
      const quest = questState.active[0];
      const replies = [
        `You're already on "${quest.quest.title}" — ${quest.progress}/${quest.required}. Keep at it, ${pName}.`,
        `I like the enthusiasm. You've got "${quest.quest.title}" in progress. ${objectiveLabel(quest.quest)} and you're ${quest.progress}/${quest.required} done.`,
      ];
      return {
        confident: true,
        draft: {
          reply: pick(replies, text),
          intent: "quest_progress",
          referencesQuestId: quest.quest.id,
          suggestedActions: defaultSuggestedActions(persona, questState),
        },
      };
    }
  }

  // ── Keyword: greetings ──
  if (/\b(hello|hi|hey|greetings|howdy|yo|sup|what'?s up|good (morning|evening|day))\b/.test(text)) {
    if (questState.active.length > 0) {
      const quest = questState.active[0];
      const replies = [
        `${pName}. I see you're working on "${quest.quest.title}" — ${quest.progress}/${quest.required}. Keep pushing.`,
        `Back again? "${quest.quest.title}" won't finish itself. You're ${quest.progress}/${quest.required} through it.`,
        `Good to see you, ${pName}. How's "${quest.quest.title}" going? ${quest.progress} of ${quest.required} so far.`,
      ];
      return {
        confident: true,
        draft: {
          reply: pick(replies, text),
          intent: "quest_progress",
          referencesQuestId: quest.quest.id,
          suggestedActions: defaultSuggestedActions(persona, questState),
        },
      };
    }
    if (questState.available.length > 0) {
      const quest = questState.available[0];
      const replies = [
        `${pName}, good timing. I've got work that needs doing — "${quest.title}". Interested?`,
        `Ah, a capable face. I could use your help with "${quest.title}". ${quest.description}`,
        `Welcome, ${pName}. If you're looking for purpose, I've got "${quest.title}" on the board.`,
      ];
      return {
        confident: true,
        draft: {
          reply: pick(replies, text),
          intent: "offer_quest",
          referencesQuestId: quest.id,
          suggestedActions: defaultSuggestedActions(persona, questState),
        },
      };
    }
    // Greeting an NPC with nothing to offer — pre-canned reply is fine,
    // not worth a Gemini round-trip. Tint with NPC-type flavor so a merchant
    // doesn't sound like a guard.
    return {
      confident: true,
      draft: {
        reply: pick([
          `${pName}. ${typeFlavor(npc.type, pName, text)}`,
          `Good to see you, ${pName}. ${typeFlavor(npc.type, pName, `${text}.alt`)}`,
          `${typeFlavor(npc.type, pName, text)} — what brings you by, ${pName}?`,
          `Ah, ${pName}. Quiet shift today. ${typeFlavor(npc.type, pName, `${text}.q`)}`,
        ], text),
        intent: "greeting",
        suggestedActions: defaultSuggestedActions(persona, questState),
      },
    };
  }

  // ── Keyword: asking about quest/help/work ──
  if (/\b(quest|job|work|task|mission|help|need|anything)\b/.test(text)) {
    if (questState.active.length > 0) {
      const quest = questState.active[0];
      return {
        confident: true,
        draft: {
          reply: `You've already got "${quest.quest.title}" on your plate. ${objectiveLabel(quest.quest)} — ${quest.progress}/${quest.required} done. Focus on that first.`,
          intent: "quest_progress",
          referencesQuestId: quest.quest.id,
          suggestedActions: defaultSuggestedActions(persona, questState),
        },
      };
    }
    if (questState.available.length > 0) {
      const quest = questState.available[0];
      return {
        confident: true,
        draft: {
          reply: `Matter of fact, I do have something. "${quest.title}" — ${quest.description} Think you can handle it?`,
          intent: "offer_quest",
          referencesQuestId: quest.id,
          suggestedActions: defaultSuggestedActions(persona, questState),
        },
      };
    }
  }

  // ── Keyword: lore/story/tell me — Gemini earns flavor here, but the
  // fallback shouldn't feel like a placeholder if the LLM is down. ──
  if (/\b(lore|story|tell me|history|about|rumor|rumour|news)\b/.test(text)) {
    const loreReplies = [
      `${npc.name} leans in. "This land has its secrets, ${pName}. Keep your eyes open and your blade sharp."`,
      `"Plenty of history in these walls. But history won't save you — skill will."`,
      `"Word travels fast here. If something's brewing, you'll know soon enough."`,
      `"${typeFlavor(npc.type, pName, `${text}.lore`)}" ${npc.name} doesn't elaborate.`,
      `"The old maps are wrong in three places I know of, ${pName}. Travel anyway."`,
      `"Every zone tells you something — if you stop long enough to listen."`,
    ];
    return {
      confident: false,
      draft: {
        reply: pick(loreReplies, text),
        intent: "lore",
        suggestedActions: defaultSuggestedActions(persona, questState),
      },
    };
  }

  // ── Fallback: active quest (no keyword match, just restating) — let Gemini add flavor ──
  if (questState.active.length > 0) {
    const quest = questState.active[0];
    const ratio = quest.progress / Math.max(quest.required, 1);
    const remaining = quest.required - quest.progress;
    const nearDone = ratio >= 0.75 && remaining > 0;
    const replies = nearDone
      ? [
          `Almost there on "${quest.quest.title}", ${pName} — just ${remaining} more. Don't slack now.`,
          `"${quest.quest.title}" is yours to close out. ${remaining} left. Finish it.`,
          `You're on the home stretch with "${quest.quest.title}". ${remaining} more and we settle up.`,
        ]
      : [
          `"${quest.quest.title}" — you're ${quest.progress}/${quest.required}. ${objectiveLabel(quest.quest)} and report back, ${pName}.`,
          `Still working on "${quest.quest.title}"? You need ${remaining} more. Get to it.`,
          `Focus, ${pName}. "${quest.quest.title}" needs ${objectiveLabel(quest.quest).toLowerCase()}. You're ${quest.progress}/${quest.required} through.`,
          `"${quest.quest.title}" is on your slate. ${remaining} to go before we talk reward.`,
        ];
    return {
      confident: false,
      draft: {
        reply: pick(replies, text),
        intent: "quest_progress",
        referencesQuestId: quest.quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
      },
    };
  }

  // ── Fallback: available quest (no keyword match) — let Gemini personalize the pitch ──
  if (questState.available.length > 0) {
    const quest = questState.available[0];
    const replies = [
      `I've got work for you, ${pName}. "${quest.title}" — ${quest.description}`,
      `${npc.name} sizes you up. "I need someone for '${quest.title}'. ${quest.description} You in?"`,
      `There's a problem that needs solving — "${quest.title}". ${quest.description} Interested, ${pName}?`,
    ];
    return {
      confident: false,
      draft: {
        reply: pick(replies, text),
        intent: "offer_quest",
        referencesQuestId: quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
      },
    };
  }

  // ── No quests at all — Gemini does the small talk, but a decent
  // deterministic fallback keeps things bearable if the LLM is off. ──
  const idleReplies = [
    `${npc.name} nods. "Nothing pressing right now, ${pName}. But stick around — things change."`,
    `"You've done good work. I'll send word if something comes up, ${pName}."`,
    `"No tasks at the moment. Rest up — you've earned it."`,
    `"${typeFlavor(npc.type, pName, `${text}.idle`)}"`,
    `${npc.name} glances past you. "Quiet day. Check the other zones — work moves around."`,
    `"Not much for you here today, ${pName}. The board will fill again soon."`,
  ];
  return {
    confident: false,
    draft: {
      reply: pick(idleReplies, text),
      intent: npc.name === SCOUT_KAELA_NAME ? "tutorial" : "greeting",
      suggestedActions: defaultSuggestedActions(persona, questState),
    },
  };
}

function buildSystemPrompt(persona: NpcPersona): string {
  return [
    `You are ${persona.name}, a quest giver in World of Geneva.`,
    `Role: ${persona.role}. Archetype: ${persona.archetype}. Tone: ${persona.tone}.`,
    "You are not the quest engine. Never invent rewards, flags, completions, or world state.",
    "Stay in character and answer in 1 short paragraph under 110 words.",
    "Return raw JSON only. No markdown fences. No preamble. No explanation.",
    `intent must be one of: ${NPC_DIALOGUE_ALLOWED_INTENTS.join(", ")}.`,
    "Use exactly these top-level keys: reply, intent, referencesQuestId, suggestedActions.",
    "referencesQuestId must be a quest id string or null.",
    "suggestedActions must be an array of up to 3 objects with label and prompt.",
    "If unsure, choose the safest grounded intent and keep the reply brief.",
    "If player.visitCount > 1, acknowledge that you've spoken before in a brief, in-character way.",
    'Example JSON: {"reply":"The meadow is not safe after dusk.","intent":"redirect","referencesQuestId":null,"suggestedActions":[{"label":"Ask about work","prompt":"What needs doing right now?"}]}',
    `Speech rules: ${persona.speechStyle.join(" ")}`,
    `Priorities: ${persona.priorities.join(" ")}`,
    `Forbidden: ${persona.forbiddenTopics.join(" ")}`,
    `Ambient guidance: ${persona.ambientPrompts.join(" ")}`,
  ].join("\n");
}

const NPC_DIALOGUE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    intent: { type: Type.STRING, enum: [...NPC_DIALOGUE_ALLOWED_INTENTS] },
    referencesQuestId: { type: Type.STRING, nullable: true },
    suggestedActions: {
      type: Type.ARRAY,
      maxItems: "3",
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          prompt: { type: Type.STRING },
        },
        required: ["label", "prompt"],
      },
    },
  },
  required: ["reply", "intent", "suggestedActions"],
  propertyOrdering: ["reply", "intent", "referencesQuestId", "suggestedActions"],
};

async function callGeminiNpcModel(payload: {
  persona: NpcPersona;
  prompt: string;
}): Promise<NpcDialogueDraft | null> {
  if (!NPC_DIALOGUE_LLM_ENABLED) return null;

  const result = await gemini.models.generateContent({
    model: NPC_DIALOGUE_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `${buildSystemPrompt(payload.persona)}\n\n${payload.prompt}` }],
      },
    ],
    config: {
      temperature: NPC_DIALOGUE_TEMPERATURE,
      maxOutputTokens: 256,
      responseMimeType: "application/json",
      responseSchema: NPC_DIALOGUE_RESPONSE_SCHEMA,
      abortSignal: AbortSignal.timeout(Math.max(2_000, NPC_DIALOGUE_TIMEOUT_MS)),
    },
  });

  const text = result.text?.trim();
  if (!text) return null;
  return JSON.parse(text) as NpcDialogueDraft;
}

function buildModelPrompt(
  persona: NpcPersona,
  npc: Entity,
  player: Entity,
  message: string,
  history: NpcDialogueHistoryEntry[],
  questState: QuestStateView,
  visitCount: number,
): string {
  return JSON.stringify({
    npc: {
      id: npc.id,
      name: npc.name,
      type: npc.type,
      region: npc.region ?? "unknown",
      persona: {
        role: persona.role,
        archetype: persona.archetype,
        tone: persona.tone,
      },
    },
    player: {
      id: player.id,
      name: player.name,
      origin: player.origin ?? null,
      classId: player.classId ?? null,
      storyFlags: player.storyFlags ?? [],
      visitCount,
    },
    playerMessage: message,
    recentHistory: history,
    questState: {
      available: questState.available.map((quest) => ({
        id: quest.id,
        title: quest.title,
        description: quest.description,
        objective: objectiveLabel(quest),
      })),
      active: questState.active.map((entry) => ({
        id: entry.quest.id,
        title: entry.quest.title,
        progress: `${entry.progress}/${entry.required}`,
        complete: entry.complete,
        objective: objectiveLabel(entry.quest),
      })),
      completable: questState.completable.map((entry) => ({
        id: entry.quest.id,
        title: entry.quest.title,
      })),
    },
    instructions: {
      respondAsNpc: true,
      keepQuestAuthorityDeterministic: true,
      keepResponseShort: true,
      outputJsonOnly: true,
      allowedIntents: NPC_DIALOGUE_ALLOWED_INTENTS,
    },
  });
}

export async function generateNpcDialogueResponse(
  context: NpcDialogueContext,
): Promise<NpcDialogueResponse> {
  const wallet = context.player.walletAddress;
  // Server-owned history is authoritative; the client-supplied history is
  // only used as a cold-start fallback when Redis has nothing yet.
  const serverHistory = await loadServerHistory(wallet, context.npc.id);
  const history = sanitizeHistory(serverHistory.length > 0 ? serverHistory : context.recentHistory);
  const visitCount = await getOrBumpVisitCount(wallet, context.npc.name, serverHistory.length === 0);
  const persona = getNpcPersona(context.npc);
  const questState = buildQuestState(context.player, context.npc);

  const deterministic = buildDeterministicDraft(
    persona,
    context.npc,
    context.player,
    context.message,
    questState,
  );
  let draft = deterministic.draft;
  let provider: "deterministic" | "llm" = "deterministic";

  // Only burn Gemini tokens when the deterministic branch wasn't confident —
  // i.e. lore/flavor requests, off-script player input, or idle small talk.
  // Greetings, accept/turn-in, directions, reward, quest/help with an active
  // or available quest already have crisp pre-written replies.
  const shouldCallLlm = NPC_DIALOGUE_LLM_ENABLED && (NPC_DIALOGUE_FORCE_LLM || !deterministic.confident);
  if (shouldCallLlm) {
    try {
      const llmDraft = await callGeminiNpcModel({
        persona,
        prompt: buildModelPrompt(
          persona,
          context.npc,
          context.player,
          context.message,
          history,
          questState,
          visitCount,
        ),
      });
      if (llmDraft?.reply) {
        draft = llmDraft;
        provider = "llm";
      }
    } catch (err: any) {
      console.error(`[npc-dialogue] LLM call failed: ${err?.message ?? err}`);
      provider = "deterministic";
    }
  }

  const validated = validateNpcDialogueDraft(draft, {
    availableQuestIds: questState.available.map((quest) => quest.id),
    activeQuestIds: questState.active.map((entry) => entry.quest.id),
    completableQuestIds: questState.completable.map((entry) => entry.quest.id),
    isTutorialNpc: context.npc.name === SCOUT_KAELA_NAME,
  });

  // Persist this turn so subsequent calls see authoritative history.
  await appendServerHistory(wallet, context.npc.id, [
    { role: "player", content: context.message },
    { role: "npc", content: validated.reply },
  ]);

  return {
    provider,
    persona: {
      id: persona.id,
      role: persona.role,
      archetype: persona.archetype,
      tone: persona.tone,
    },
    reply: validated.reply,
    intent: validated.intent,
    ...(validated.referencesQuestId ? { referencesQuestId: validated.referencesQuestId } : {}),
    suggestedActions: validated.suggestedActions.length > 0
      ? validated.suggestedActions
      : defaultSuggestedActions(persona, questState),
    questContext: {
      availableQuestIds: questState.available.map((quest) => quest.id),
      activeQuestIds: questState.active.map((entry) => entry.quest.id),
      completableQuestIds: questState.completable.map((entry) => entry.quest.id),
    },
  };
}
