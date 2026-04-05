import { QUEST_CATALOG, type Quest } from "../../questSystem.js";
import type { QuestArcDefinition, QuestGraphNode } from "../types.js";

function slugifyNpcName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildQuestGiverArcId(npcName: string): string {
  return `questgiver-${slugifyNpcName(npcName)}`;
}

function objectiveSummary(quest: Quest): string {
  switch (quest.objective.type) {
    case "talk":
      return `Listen to what ${quest.objective.targetNpcName ?? quest.npcId} has to say about "${quest.title}".`;
    case "kill":
      return quest.objective.targetMobName
        ? `Defeat ${quest.objective.count} ${quest.objective.targetMobName}.`
        : `Defeat ${quest.objective.count} ${quest.objective.targetMobType ?? "targets"}.`;
    case "gather":
      return `Gather ${quest.objective.count} ${quest.objective.targetItemName ?? "materials"}.`;
    case "craft":
      return `Craft ${quest.objective.count} ${quest.objective.targetItemName ?? "items"}.`;
    default:
      return "Complete the assigned work.";
  }
}

function acceptanceLine(quest: Quest): string {
  if (quest.objective.type === "talk") {
    return "Good. We can settle this exchange right here and now.";
  }
  return "Good. Take the work seriously and return when the objective is complete.";
}

function activeStatusLine(quest: Quest): string {
  if (quest.objective.type === "kill") {
    return `You're still on \"${quest.title}\". The fieldwork comes first; talk after the target is down.`;
  }
  if (quest.objective.type === "gather") {
    return `You're still on \"${quest.title}\". Bring me the materials before you ask for the reward.`;
  }
  if (quest.objective.type === "craft") {
    return `You're still on \"${quest.title}\". Finish the craft, then return for payment.`;
  }
  return `You're already working on \"${quest.title}\". Finish it before we move on.`;
}

function turnInLine(quest: Quest): string {
  return `You came back with \"${quest.title}\" handled. If the work is truly done, I'll settle your reward now.`;
}

function idleLine(npcName: string): string {
  return `${npcName} nods. "I have nothing more for you at the moment. Return later."`;
}

function buildQuestNodes(quest: Quest): Record<string, QuestGraphNode> {
  const offerEffectType = quest.objective.type === "talk" ? "complete_quest" : "start_quest";
  return {
    [`${quest.id}_offer_intro`]: {
      id: `${quest.id}_offer_intro`,
      type: "line",
      speaker: "npc",
      text: `${quest.description}`,
      next: `${quest.id}_offer_choice`,
    },
    [`${quest.id}_offer_choice`]: {
      id: `${quest.id}_offer_choice`,
      type: "choice",
      speaker: "npc",
      text: "How do you want to respond?",
      choices: [
        {
          id: `${quest.id}_accept`,
          label: quest.objective.type === "talk" ? "Let's handle it now." : "I accept the assignment.",
          style: "primary",
          next: `${quest.id}_offer_effect`,
        },
        {
          id: `${quest.id}_explain`,
          label: "Explain the objective.",
          style: "secondary",
          next: `${quest.id}_details`,
        },
        {
          id: `${quest.id}_ask_freely`,
          label: "Let me ask in my own words.",
          style: "secondary",
          next: `${quest.id}_freeform`,
        },
        {
          id: `${quest.id}_decline`,
          label: "Not now.",
          style: "danger",
          next: `${quest.id}_decline_line`,
        },
      ],
    },
    [`${quest.id}_freeform`]: {
      id: `${quest.id}_freeform`,
      type: "freeform",
      speaker: "npc",
      text: `"Go ahead — ask me anything about ${quest.title}."`,
      prompt: `Respond to ${quest.npcId}.`,
      placeholder: "What would you like to say?",
      fallbackText: `${quest.npcId} pauses, waiting for a clearer answer.`,
      routes: [
        {
          id: `${quest.id}_freeform_accept`,
          label: "Accept the assignment",
          intents: ["accept", "i accept", "i'll do it", "give me the job", "i'm ready", "lets do it"],
          phrases: ["i will handle it", "send me out", "give me the contract"],
          next: `${quest.id}_offer_effect`,
        },
        {
          id: `${quest.id}_freeform_details`,
          label: "Ask for details",
          intents: ["details", "explain", "what do you need", "what is the objective", "clarify"],
          phrases: ["what exactly am i doing", "tell me the task"],
          next: `${quest.id}_details`,
        },
        {
          id: `${quest.id}_freeform_decline`,
          label: "Decline for now",
          intents: ["not now", "later", "wait", "decline"],
          phrases: ["come back later", "i need a moment"],
          next: `${quest.id}_decline_line`,
        },
      ],
    },
    [`${quest.id}_details`]: {
      id: `${quest.id}_details`,
      type: "line",
      speaker: "npc",
      text: objectiveSummary(quest),
      next: `${quest.id}_offer_choice`,
    },
    [`${quest.id}_offer_effect`]: {
      id: `${quest.id}_offer_effect`,
      type: "effect",
      effects: [{ type: offerEffectType, questId: quest.id }],
      next: `${quest.id}_accepted`,
    },
    [`${quest.id}_accepted`]: {
      id: `${quest.id}_accepted`,
      type: "line",
      speaker: "npc",
      text: acceptanceLine(quest),
      next: "scene_end",
    },
    [`${quest.id}_decline_line`]: {
      id: `${quest.id}_decline_line`,
      type: "line",
      speaker: "npc",
      text: "Then step aside and come back when you're ready to commit.",
      next: "scene_end",
    },
    [`${quest.id}_active_intro`]: {
      id: `${quest.id}_active_intro`,
      type: "choice",
      speaker: "npc",
      text: activeStatusLine(quest),
      choices: [
        {
          id: `${quest.id}_active_objective`,
          label: "Remind me of the objective.",
          style: "secondary",
          next: `${quest.id}_active_details`,
        },
        {
          id: `${quest.id}_active_later`,
          label: "I'll get back to it.",
          style: "primary",
          next: "scene_end",
        },
      ],
    },
    [`${quest.id}_active_details`]: {
      id: `${quest.id}_active_details`,
      type: "line",
      speaker: "npc",
      text: objectiveSummary(quest),
      next: "scene_end",
    },
    [`${quest.id}_turnin_intro`]: {
      id: `${quest.id}_turnin_intro`,
      type: "choice",
      speaker: "npc",
      text: turnInLine(quest),
      choices: [
        {
          id: `${quest.id}_turnin_complete`,
          label: "Collect the reward.",
          style: "primary",
          next: `${quest.id}_turnin_effect`,
        },
        {
          id: `${quest.id}_turnin_wait`,
          label: "I'll speak to you later.",
          style: "secondary",
          next: "scene_end",
        },
      ],
    },
    [`${quest.id}_turnin_effect`]: {
      id: `${quest.id}_turnin_effect`,
      type: "effect",
      effects: [{ type: "complete_quest", questId: quest.id }],
      next: `${quest.id}_turnin_done`,
    },
    [`${quest.id}_turnin_done`]: {
      id: `${quest.id}_turnin_done`,
      type: "line",
      speaker: "npc",
      text: "Then take what you've earned and be ready for whatever follows.",
      next: "scene_end",
    },
  };
}

function buildQuestGiverArc(npcName: string, quests: Quest[]): QuestArcDefinition {
  const nodes: Record<string, QuestGraphNode> = {
    root: {
      id: "root",
      type: "branch",
      branches: [
        ...quests.map((quest) => ({
          condition: { type: "quest_ready_to_turn_in" as const, questId: quest.id },
          next: `${quest.id}_turnin_intro`,
        })),
        ...quests.map((quest) => ({
          condition: { type: "quest_active" as const, questId: quest.id },
          next: `${quest.id}_active_intro`,
        })),
        ...quests.map((quest) => ({
          condition: { type: "quest_available" as const, questId: quest.id },
          next: `${quest.id}_offer_intro`,
        })),
      ],
      fallbackNext: "idle",
    },
    idle: {
      id: "idle",
      type: "line",
      speaker: "npc",
      text: idleLine(npcName),
      next: "scene_end",
    },
    scene_end: {
      id: "scene_end",
      type: "end",
      text: `${npcName} turns back to their work.`,
    },
  };

  for (const quest of quests) {
    Object.assign(nodes, buildQuestNodes(quest));
  }

  return {
    id: buildQuestGiverArcId(npcName),
    title: `${npcName} Quest Flow`,
    summary: `Generated quest-giver graph for ${npcName}.`,
    zoneIds: [],
    tags: ["quest-giver", "generated"],
    startingSceneId: "root",
    scenes: {
      root: {
        id: "root",
        npcName,
        title: `${npcName}`,
        startNodeId: "root",
        nodes,
      },
    },
  };
}

export const generatedQuestGiverArcs: QuestArcDefinition[] = (() => {
  const questsByNpc = new Map<string, Quest[]>();
  for (const quest of QUEST_CATALOG) {
    const list = questsByNpc.get(quest.npcId);
    if (list) {
      list.push(quest);
    } else {
      questsByNpc.set(quest.npcId, [quest]);
    }
  }

  return Array.from(questsByNpc.entries()).map(([npcName, quests]) => buildQuestGiverArc(npcName, quests));
})();
