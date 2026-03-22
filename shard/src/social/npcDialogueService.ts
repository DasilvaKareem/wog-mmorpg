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

function buildDeterministicDraft(
  persona: NpcPersona,
  npc: Entity,
  player: Entity,
  message: string,
  questState: QuestStateView,
): NpcDialogueDraft {
  const text = message.trim().toLowerCase();
  const hasBriefing = (player.storyFlags ?? []).includes(SCOUT_KAELA_BRIEFED_FLAG);

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

  if (questState.completable.length > 0) {
    const quest = questState.completable[0].quest;
    return {
      reply: `${persona.name === npc.name ? "" : `${npc.name} `}looks you over. "${quest.title}" is finished. If you're ready, send your champion to report in and collect the reward."`,
      intent: "quest_turn_in",
      referencesQuestId: quest.id,
      suggestedActions: [
        { label: "Turn in quest", prompt: `I'm ready to turn in ${quest.title}.` },
        { label: "Review reward", prompt: `Remind me what ${quest.title} pays.` },
      ],
    };
  }

  if (/\b(reward|pay|earn|gold|xp)\b/.test(text) && questState.active.length > 0) {
    const quest = questState.active[0].quest;
    return {
      reply: `"${quest.title}" pays out when the work is done. Finish ${objectiveLabel(quest).toLowerCase()} and come back to me.`,
      intent: "quest_progress",
      referencesQuestId: quest.id,
      suggestedActions: defaultSuggestedActions(persona, questState),
    };
  }

  if (/\b(where|lost|direction|directions|go next|next)\b/.test(text)) {
    if (questState.active.length > 0) {
      const quest = questState.active[0];
      return {
        reply: `Stay focused on "${quest.quest.title}". Your next step is simple: ${objectiveLabel(quest.quest)}. You're ${quest.progress}/${quest.required} through it.`,
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

  if (questState.active.length > 0) {
    const quest = questState.active[0];
    return {
      reply: `"${quest.quest.title}" is still in motion. ${objectiveLabel(quest.quest)}. You're ${quest.progress}/${quest.required} through it, so keep your champion on task.`,
      intent: "quest_progress",
      referencesQuestId: quest.quest.id,
      suggestedActions: defaultSuggestedActions(persona, questState),
    };
  }

  if (questState.available.length > 0) {
    const quest = questState.available[0];
    return {
      reply: `${npc.name} sets their attention on you. "${quest.title}" is the work that matters right now. ${quest.description}`,
      intent: "offer_quest",
      referencesQuestId: quest.id,
      suggestedActions: defaultSuggestedActions(persona, questState),
    };
  }

  return {
    reply: `${npc.name} keeps their tone ${persona.tone}. "I've said what matters. If you're looking for purpose, keep your eyes open and your champion moving."`,
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
    } catch {
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
