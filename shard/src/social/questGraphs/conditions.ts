import type { Entity } from "../../world/zoneRuntime.js";
import { getAvailableQuestsForPlayer, isQuestComplete, QUEST_CATALOG } from "../questSystem.js";
import type { QuestGraphCondition } from "./types.js";

export interface QuestGraphEvaluationContext {
  player: Entity;
  npcName: string;
}

export function evaluateQuestGraphCondition(
  condition: QuestGraphCondition | undefined,
  context: QuestGraphEvaluationContext,
): boolean {
  if (!condition) return true;

  switch (condition.type) {
    case "all":
      return condition.conditions.every((entry) => evaluateQuestGraphCondition(entry, context));
    case "any":
      return condition.conditions.some((entry) => evaluateQuestGraphCondition(entry, context));
    case "not":
      return !evaluateQuestGraphCondition(condition.condition, context);
    case "has_story_flag":
      return (context.player.storyFlags ?? []).includes(condition.flag);
    case "missing_story_flag":
      return !(context.player.storyFlags ?? []).includes(condition.flag);
    case "quest_completed":
      return (context.player.completedQuests ?? []).includes(condition.questId);
    case "quest_active":
      return (context.player.activeQuests ?? []).some((quest) => quest.questId === condition.questId);
    case "quest_ready_to_turn_in": {
      const activeQuest = (context.player.activeQuests ?? []).find((quest) => quest.questId === condition.questId);
      if (!activeQuest) return false;
      const questDef = QUEST_CATALOG.find((quest) => quest.id === condition.questId);
      if (!questDef) return false;
      return isQuestComplete(questDef, activeQuest.progress);
    }
    case "quest_available": {
      const completedQuestIds = context.player.completedQuests ?? [];
      const activeQuestIds = (context.player.activeQuests ?? []).map((quest) => quest.questId);
      const availableQuestIds = new Set(
        getAvailableQuestsForPlayer(
          context.npcName,
          completedQuestIds,
          activeQuestIds,
          context.player.storyFlags ?? [],
        ).map((quest) => quest.id),
      );
      return availableQuestIds.has(condition.questId);
    }
    case "origin_is":
      return context.player.origin === condition.origin;
    case "class_is":
      return context.player.classId === condition.classId;
    case "npc_is":
      return context.npcName === condition.npcName;
    default:
      return false;
  }
}
