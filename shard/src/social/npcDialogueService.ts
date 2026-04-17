import type { Entity } from "../world/zoneRuntime.js";
import { getAvailableQuestsForPlayer, isQuestComplete, QUEST_CATALOG, type ActiveQuest, type Quest } from "./questSystem.js";
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

const NPC_DIALOGUE_API_BASE_URL = process.env.NPC_DIALOGUE_API_BASE_URL?.trim() || "";
const NPC_DIALOGUE_API_KEY = process.env.NPC_DIALOGUE_API_KEY?.trim() || "";
const NPC_DIALOGUE_MODEL = process.env.NPC_DIALOGUE_MODEL?.trim() || "gpt-4.1-mini";
const NPC_DIALOGUE_TIMEOUT_MS = Number(process.env.NPC_DIALOGUE_TIMEOUT_MS ?? "12000");
const NPC_DIALOGUE_TEMPERATURE = Number(
  process.env.NPC_DIALOGUE_TEMPERATURE
  ?? (NPC_DIALOGUE_MODEL.toLowerCase().includes("schematron") ? "0.2" : "0.6"),
);
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
    npc.name,
    completedQuestIds,
    activeQuestIds,
    storyFlags,
  );

  const active = (player.activeQuests ?? [])
    .map((entry: ActiveQuest) => {
      const quest = QUEST_CATALOG.find((candidate) => candidate.id === entry.questId);
      if (!quest || quest.npcId !== npc.name) return null;
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
    return [
      { label: "Turn it in", prompt: `I'm ready to turn in ${questState.completable[0].quest.title}.` },
      { label: "Ask reward", prompt: `What do I earn for ${questState.completable[0].quest.title}?` },
    ];
  }
  if (questState.active.length > 0) {
    return [
      { label: "Next step", prompt: `What should I focus on for ${questState.active[0].quest.title}?` },
      { label: "Directions", prompt: "Where should I go next?" },
    ];
  }
  if (questState.available.length > 0) {
    return [
      { label: "Hear the job", prompt: `Tell me about ${questState.available[0].title}.` },
      { label: "What's urgent?", prompt: "What needs doing most right now?" },
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

function buildDeterministicDraft(
  persona: NpcPersona,
  npc: Entity,
  player: Entity,
  message: string,
  questState: QuestStateView,
): NpcDialogueDraft {
  const text = message.trim().toLowerCase();
  const hasBriefing = (player.storyFlags ?? []).includes(SCOUT_KAELA_BRIEFED_FLAG);
  const pName = player.name ?? "adventurer";

  if (npc.name === SCOUT_KAELA_NAME && !hasBriefing) {
    return {
      reply: "Before you chase glory, get the basics straight. Finish my briefing, then speak with Guard Captain Marcus to begin the village chain.",
      intent: "tutorial",
      suggestedActions: [
        { label: "Finish briefing", prompt: "Give me the short version again." },
        { label: "Find Marcus", prompt: "Where exactly do I find Guard Captain Marcus?" },
      ],
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
      reply: pick(replies, text),
      intent: "quest_turn_in",
      referencesQuestId: quest.id,
      suggestedActions: [
        { label: "Turn in quest", prompt: `I'm ready to turn in ${quest.title}.` },
        { label: "Review reward", prompt: `Remind me what ${quest.title} pays.` },
      ],
    };
  }

  // ── Keyword: rewards/pay ──
  if (/\b(reward|pay|earn|gold|xp)\b/.test(text) && questState.active.length > 0) {
    const quest = questState.active[0].quest;
    return {
      reply: `"${quest.title}" pays out when the work is done. Finish ${objectiveLabel(quest).toLowerCase()} and come back to me.`,
      intent: "quest_progress",
      referencesQuestId: quest.id,
      suggestedActions: defaultSuggestedActions(persona, questState),
    };
  }

  // ── Keyword: directions ──
  if (/\b(where|lost|direction|directions|go next|next)\b/.test(text)) {
    if (questState.active.length > 0) {
      const quest = questState.active[0];
      return {
        reply: `Stay focused on "${quest.quest.title}". Your next step: ${objectiveLabel(quest.quest)}. You're ${quest.progress}/${quest.required} through it.`,
        intent: "quest_progress",
        referencesQuestId: quest.quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
      };
    }
    if (questState.available.length > 0) {
      const quest = questState.available[0];
      return {
        reply: `If you're ready for work, start with "${quest.title}". ${quest.description}`,
        intent: "offer_quest",
        referencesQuestId: quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
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
        reply: pick(replies, text),
        intent: "offer_quest",
        referencesQuestId: quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
      };
    }
    if (questState.active.length > 0) {
      const quest = questState.active[0];
      const replies = [
        `You're already on "${quest.quest.title}" — ${quest.progress}/${quest.required}. Keep at it, ${pName}.`,
        `I like the enthusiasm. You've got "${quest.quest.title}" in progress. ${objectiveLabel(quest.quest)} and you're ${quest.progress}/${quest.required} done.`,
      ];
      return {
        reply: pick(replies, text),
        intent: "quest_progress",
        referencesQuestId: quest.quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
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
        reply: pick(replies, text),
        intent: "quest_progress",
        referencesQuestId: quest.quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
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
        reply: pick(replies, text),
        intent: "offer_quest",
        referencesQuestId: quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
      };
    }
    return {
      reply: pick([
        `${pName}. Not much to report right now. Check back later — things change fast around here.`,
        `Good to see you, ${pName}. No urgent work at the moment, but stay sharp.`,
      ], text),
      intent: "greeting",
      suggestedActions: defaultSuggestedActions(persona, questState),
    };
  }

  // ── Keyword: asking about quest/help/work ──
  if (/\b(quest|job|work|task|mission|help|need|anything)\b/.test(text)) {
    if (questState.active.length > 0) {
      const quest = questState.active[0];
      return {
        reply: `You've already got "${quest.quest.title}" on your plate. ${objectiveLabel(quest.quest)} — ${quest.progress}/${quest.required} done. Focus on that first.`,
        intent: "quest_progress",
        referencesQuestId: quest.quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
      };
    }
    if (questState.available.length > 0) {
      const quest = questState.available[0];
      return {
        reply: `Matter of fact, I do have something. "${quest.title}" — ${quest.description} Think you can handle it?`,
        intent: "offer_quest",
        referencesQuestId: quest.id,
        suggestedActions: defaultSuggestedActions(persona, questState),
      };
    }
  }

  // ── Keyword: lore/story/tell me ──
  if (/\b(lore|story|tell me|history|about|rumor|rumour|news)\b/.test(text)) {
    const loreReplies = [
      `${npc.name} leans in. "This land has its secrets, ${pName}. Keep your eyes open and your blade sharp."`,
      `"Plenty of history in these walls. But history won't save you — skill will."`,
      `"Word travels fast here. If something's brewing, you'll know soon enough."`,
    ];
    return {
      reply: pick(loreReplies, text),
      intent: "lore",
      suggestedActions: defaultSuggestedActions(persona, questState),
    };
  }

  // ── Fallback: active quest ──
  if (questState.active.length > 0) {
    const quest = questState.active[0];
    const replies = [
      `"${quest.quest.title}" — you're ${quest.progress}/${quest.required}. ${objectiveLabel(quest.quest)} and report back, ${pName}.`,
      `Still working on "${quest.quest.title}"? You need ${quest.required - quest.progress} more. Get to it.`,
      `Focus, ${pName}. "${quest.quest.title}" needs ${objectiveLabel(quest.quest).toLowerCase()}. You're ${quest.progress}/${quest.required} through.`,
    ];
    return {
      reply: pick(replies, text),
      intent: "quest_progress",
      referencesQuestId: quest.quest.id,
      suggestedActions: defaultSuggestedActions(persona, questState),
    };
  }

  // ── Fallback: available quest ──
  if (questState.available.length > 0) {
    const quest = questState.available[0];
    const replies = [
      `I've got work for you, ${pName}. "${quest.title}" — ${quest.description}`,
      `${npc.name} sizes you up. "I need someone for '${quest.title}'. ${quest.description} You in?"`,
      `There's a problem that needs solving — "${quest.title}". ${quest.description} Interested, ${pName}?`,
    ];
    return {
      reply: pick(replies, text),
      intent: "offer_quest",
      referencesQuestId: quest.id,
      suggestedActions: defaultSuggestedActions(persona, questState),
    };
  }

  // ── No quests at all ──
  const idleReplies = [
    `${npc.name} nods. "Nothing pressing right now, ${pName}. But stick around — things change."`,
    `"You've done good work. I'll send word if something comes up, ${pName}."`,
    `"No tasks at the moment. Rest up — you've earned it."`,
  ];
  return {
    reply: pick(idleReplies, text),
    intent: npc.name === SCOUT_KAELA_NAME ? "tutorial" : "greeting",
    suggestedActions: defaultSuggestedActions(persona, questState),
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
    'Example JSON: {"reply":"The meadow is not safe after dusk.","intent":"redirect","referencesQuestId":null,"suggestedActions":[{"label":"Ask about work","prompt":"What needs doing right now?"}]}',
    `Speech rules: ${persona.speechStyle.join(" ")}`,
    `Priorities: ${persona.priorities.join(" ")}`,
    `Forbidden: ${persona.forbiddenTopics.join(" ")}`,
    `Ambient guidance: ${persona.ambientPrompts.join(" ")}`,
  ].join("\n");
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) return trimmed;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(firstBrace, i + 1);
      }
    }
  }

  return trimmed;
}

async function callCompatibleNpcModel(payload: {
  persona: NpcPersona;
  prompt: string;
}): Promise<NpcDialogueDraft | null> {
  if (!NPC_DIALOGUE_API_BASE_URL) return null;

  const endpoint = `${NPC_DIALOGUE_API_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (NPC_DIALOGUE_API_KEY) {
    headers.Authorization = `Bearer ${NPC_DIALOGUE_API_KEY}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(Math.max(2_000, NPC_DIALOGUE_TIMEOUT_MS)),
    body: JSON.stringify({
      model: NPC_DIALOGUE_MODEL,
      temperature: NPC_DIALOGUE_TEMPERATURE,
      max_tokens: 220,
      messages: [
        { role: "system", content: buildSystemPrompt(payload.persona) },
        { role: "user", content: payload.prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`npc dialogue provider ${response.status}`);
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  const content = Array.isArray(rawContent)
    ? rawContent.map((part: any) => part?.text ?? part?.content ?? "").join("\n").trim()
    : String(rawContent ?? "").trim();

  if (!content) return null;

  const jsonText = extractJsonObject(content);
  return JSON.parse(jsonText) as NpcDialogueDraft;
}

function buildModelPrompt(
  persona: NpcPersona,
  npc: Entity,
  player: Entity,
  message: string,
  history: NpcDialogueHistoryEntry[],
  questState: QuestStateView,
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
  const history = sanitizeHistory(context.recentHistory);
  const persona = getNpcPersona(context.npc);
  const questState = buildQuestState(context.player, context.npc);

  let draft = buildDeterministicDraft(
    persona,
    context.npc,
    context.player,
    context.message,
    questState,
  );
  let provider: "deterministic" | "llm" = "deterministic";

  if (NPC_DIALOGUE_API_BASE_URL) {
    try {
      const llmDraft = await callCompatibleNpcModel({
        persona,
        prompt: buildModelPrompt(
          persona,
          context.npc,
          context.player,
          context.message,
          history,
          questState,
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
