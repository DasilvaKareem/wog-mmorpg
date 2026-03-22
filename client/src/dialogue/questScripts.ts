import { formatCopperString } from "@/lib/currency";
import {
  FALLBACK_GREETINGS,
  GREETING_REPLIES,
  NPC_FOLLOWUP_LINES,
  NPC_GREETINGS,
  QUEST_REPLIES_CRAFT,
  QUEST_REPLIES_GATHER,
  QUEST_REPLIES_KILL,
  QUEST_REPLIES_TALK,
  SCOUT_KAELA_BRIEFED_FLAG,
  SCOUT_KAELA_FOLLOWUP_LINES,
  SCOUT_KAELA_INTRO_LINES,
} from "@/dialogue/data/questDialogueData";
import { getTutorialMasterPortraitUrl } from "@/lib/tutorialMaster";
import type { ActiveQuestEntry, AvailableQuestEntry } from "@/hooks/useQuestLog";
import type { DialogueNode, DialogueScript } from "@/dialogue/types";
import type { Entity } from "@/types";

const ACCENT = "#54f28b";
const GOLD = "#f2c854";
const CHAMPION_COLOR = "#44ddff";
const WARN = "#e0af68";
const DANGER = "#f25454";
const INFO = "#5dadec";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function objectiveLabel(obj: AvailableQuestEntry["objective"] | ActiveQuestEntry["objective"]): string {
  if (obj.type === "kill") return `Slay ${obj.count} ${obj.targetMobName ?? "enemies"}`;
  if (obj.type === "gather") return `Gather ${obj.count} ${obj.targetItemName ?? "items"}`;
  if (obj.type === "craft") return `Craft ${obj.count} ${obj.targetItemName ?? "items"}`;
  if (obj.type === "talk") return `Speak with ${obj.targetNpcName ?? "NPC"}`;
  return `${obj.type} x${obj.count}`;
}

function objectiveColor(type: string): string {
  if (type === "kill") return DANGER;
  if (type === "gather") return ACCENT;
  if (type === "craft") return INFO;
  if (type === "talk") return WARN;
  return INFO;
}

function getGreetingReply(origin: string | null): string {
  const lines = (origin && GREETING_REPLIES[origin]) || FALLBACK_GREETINGS;
  return pick(lines);
}

function getChampionQuestReply(obj: AvailableQuestEntry["objective"], origin: string | null): string {
  const tone = origin ?? "sunforged";
  if (obj.type === "kill") {
    const lines = QUEST_REPLIES_KILL[tone] ?? QUEST_REPLIES_KILL.sunforged;
    return pick(lines).replace("${count}", String(obj.count));
  }
  if (obj.type === "gather") {
    const lines = QUEST_REPLIES_GATHER[tone] ?? QUEST_REPLIES_GATHER.sunforged;
    return pick(lines);
  }
  if (obj.type === "craft") {
    const lines = QUEST_REPLIES_CRAFT[tone] ?? QUEST_REPLIES_CRAFT.sunforged;
    return pick(lines);
  }
  if (obj.type === "talk") {
    const lines = QUEST_REPLIES_TALK[tone] ?? QUEST_REPLIES_TALK.sunforged;
    return pick(lines);
  }
  return "Understood. I'll get it done.";
}

function activeQuestSummary(aq: ActiveQuestEntry): string {
  const pct = aq.required > 0 ? Math.round((aq.progress / aq.required) * 100) : 0;
  if (aq.complete) return `"${aq.title}" is complete. I can brief your champion to turn it in.`;
  const target = aq.objective.targetMobName ?? aq.objective.targetItemName ?? aq.objective.targetNpcName ?? "targets";
  return `"${aq.title}" — ${aq.progress}/${aq.required} ${target} (${pct}%). The work continues.`;
}

function championPortrait(championName: string, championPortraitUrl?: string | null) {
  return {
    side: "right" as const,
    alt: championName,
    src: championPortraitUrl ?? undefined,
    label: championName,
    accent: CHAMPION_COLOR,
  };
}

function npcPortrait(npc: Entity) {
  return {
    side: "left" as const,
    alt: npc.name,
    label: npc.name,
    accent: GOLD,
  };
}

interface QuestDialogueBuildOptions {
  npc: Entity;
  quests: AvailableQuestEntry[];
  activeQuests: ActiveQuestEntry[];
  championName: string;
  championOrigin: string | null;
  championPortraitUrl?: string | null;
}

interface ScoutKaelaDialogueBuildOptions {
  alreadyBriefed: boolean;
  canPersistProgress: boolean;
}

export function buildScoutKaelaDialogueScript(options: ScoutKaelaDialogueBuildOptions): DialogueScript {
  const { alreadyBriefed, canPersistProgress } = options;
  const nodes: Record<string, DialogueNode> = {};
  const portrait = {
    side: "left" as const,
    alt: "Scout Kaela",
    src: getTutorialMasterPortraitUrl(),
    label: "Scout Kaela",
    accent: GOLD,
  };

  const lines = alreadyBriefed ? SCOUT_KAELA_FOLLOWUP_LINES : SCOUT_KAELA_INTRO_LINES;

  for (let i = 0; i < lines.length; i += 1) {
    const id = `tutorial_${i}`;
    nodes[id] = {
      id,
      speaker: "npc",
      text: lines[i],
      next: i < lines.length - 1 ? `tutorial_${i + 1}` : "tutorial_commit",
      portrait,
    };
  }

  nodes.tutorial_commit = alreadyBriefed
    ? {
        id: "tutorial_commit",
        speaker: "npc",
        text: "The path is open. Marcus is waiting.",
        portrait,
        badge: { label: "READY", color: ACCENT },
        choices: [
          {
            id: "tutorial_commit_close",
            label: "Back to the world",
            next: null,
            variant: "primary",
          },
        ],
      }
    : {
        id: "tutorial_commit",
        speaker: "npc",
        text: canPersistProgress
          ? "That's the briefing. I'll mark you as cleared for the village chain."
          : "That's the briefing. Reconnect your wallet before I can clear you for the village chain.",
        portrait,
        badge: { label: "BRIEFING", color: GOLD },
        choices: canPersistProgress
          ? [
              {
                id: "tutorial_commit_confirm",
                label: "Understood. Send me to Marcus.",
                next: null,
                variant: "primary",
                effects: [{ type: "setStoryFlag", flag: SCOUT_KAELA_BRIEFED_FLAG }],
              },
            ]
          : [
              {
                id: "tutorial_commit_locked",
                label: "Wallet required",
                next: undefined,
                variant: "secondary",
                disabled: true,
              },
              {
                id: "tutorial_commit_close",
                label: "Close",
                next: null,
                variant: "secondary",
              },
            ],
      };

  return { start: "tutorial_0", nodes };
}

export function buildNpcQuestDialogueScript(options: QuestDialogueBuildOptions): DialogueScript {
  const { npc, quests, activeQuests, championName, championOrigin, championPortraitUrl } = options;
  const nodes: Record<string, DialogueNode> = {};
  const championCard = championPortrait(championName, championPortraitUrl);
  const npcCard = npcPortrait(npc);

  const addNode = (node: DialogueNode) => {
    nodes[node.id] = node;
  };

  const startNode = "greeting";
  const hasOffers = quests.length > 0;
  const hasActive = activeQuests.length > 0;

  addNode({
    id: "greeting",
    speaker: "npc",
    text: hasOffers
      ? pick(NPC_GREETINGS)
      : hasActive
      ? pick(NPC_FOLLOWUP_LINES)
      : "I have nothing for you right now. Return later, champion.",
    next: hasOffers ? "greeting_reply" : hasActive ? "active_0" : null,
    portrait: npcCard,
  });

  if (hasOffers) {
    addNode({
      id: "greeting_reply",
      speaker: "champion",
      text: getGreetingReply(championOrigin),
      next: "offer_0",
      portrait: championCard,
    });
  }

  quests.forEach((quest, index) => {
    const offerId = `offer_${index}`;
    const replyId = `offer_reply_${index}`;
    const choiceId = `offer_choice_${index}`;
    const acceptId = `offer_accept_${index}`;
    const declineId = `offer_decline_${index}`;
    const nextId = index < quests.length - 1
      ? `offer_${index + 1}`
      : hasActive
      ? "active_0"
      : null;

    addNode({
      id: offerId,
      speaker: "npc",
      text: quest.description,
      next: replyId,
      title: quest.title,
      badge: { label: quest.objective.type.toUpperCase(), color: objectiveColor(quest.objective.type) },
      portrait: npcCard,
      objective: { label: objectiveLabel(quest.objective) },
    });

    addNode({
      id: replyId,
      speaker: "champion",
      text: getChampionQuestReply(quest.objective, championOrigin),
      next: choiceId,
      title: quest.title,
      badge: { label: quest.objective.type.toUpperCase(), color: objectiveColor(quest.objective.type) },
      portrait: championCard,
      objective: { label: objectiveLabel(quest.objective) },
    });

    addNode({
      id: choiceId,
      speaker: "npc",
      text: `The terms are clear. ${objectiveLabel(quest.objective)}. Reward: ${formatCopperString(quest.rewards.copper)} and ${quest.rewards.xp} XP.`,
      title: quest.title,
      badge: { label: "DECISION", color: GOLD },
      portrait: npcCard,
      objective: { label: objectiveLabel(quest.objective) },
      rewards: {
        xp: quest.rewards.xp,
        copperLabel: formatCopperString(quest.rewards.copper),
      },
      choices: [
        {
          id: `${choiceId}_accept`,
          label: "Send Champion",
          next: acceptId,
          variant: "primary",
          effects: [{ type: "acceptQuest", quest, npc: { id: npc.id, name: npc.name, zoneId: npc.zoneId } }],
        },
        {
          id: `${choiceId}_decline`,
          label: "Not Now",
          next: declineId,
          variant: "secondary",
        },
      ],
    });

    addNode({
      id: acceptId,
      speaker: "npc",
      text: `Good. I'll await word of "${quest.title}".`,
      next: nextId,
      title: quest.title,
      badge: { label: "DISPATCHED", color: ACCENT },
      portrait: npcCard,
    });

    addNode({
      id: declineId,
      speaker: "champion",
      text: "Not this time. Keep the offer open.",
      next: nextId,
      title: quest.title,
      badge: { label: "DEFERRED", color: WARN },
      portrait: championCard,
    });
  });

  activeQuests.forEach((quest, index) => {
    const nodeId = `active_${index}`;
    const nextId = index < activeQuests.length - 1 ? `active_${index + 1}` : null;

    addNode({
      id: nodeId,
      speaker: "npc",
      text: activeQuestSummary(quest),
      next: quest.complete && quest.npcEntityId ? undefined : nextId,
      title: quest.title,
      badge: {
        label: quest.complete ? "READY" : "IN PROGRESS",
        color: quest.complete ? ACCENT : WARN,
      },
      portrait: npcCard,
      progress: {
        value: quest.progress,
        max: quest.required,
        complete: quest.complete,
      },
      objective: { label: objectiveLabel(quest.objective) },
      rewards: {
        xp: quest.rewards.xp,
        copperLabel: formatCopperString(quest.rewards.copper),
      },
      choices: quest.complete && quest.npcEntityId ? [
        {
          id: `${nodeId}_turn_in`,
          label: "Send Champion To Turn In",
          next: nextId,
          variant: "primary",
          effects: [{
            type: "turnInQuest",
            quest,
            npc: {
              id: quest.npcEntityId,
              name: npc.name,
              zoneId: npc.zoneId,
            },
          }],
        },
        {
          id: `${nodeId}_later`,
          label: "Later",
          next: nextId,
          variant: "secondary",
        },
      ] : undefined,
    });
  });

  return { start: startNode, nodes };
}
