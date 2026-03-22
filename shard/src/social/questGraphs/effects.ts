import type { Entity } from "../../world/zoneRuntime.js";
import { logZoneEvent } from "../../world/zoneEvents.js";
import { saveCharacter } from "../../character/characterStore.js";
import { logDiary } from "../diary.js";
import { awardQuestRewards, isQuestAvailableForPlayer, isQuestComplete, QUEST_CATALOG, type Quest } from "../questSystem.js";
import type { QuestGraphEffect } from "./types.js";

export interface QuestGraphEffectExecutionContext {
  player: Entity;
  arcId: string;
  sceneId: string;
  commit: boolean;
}

export interface QuestGraphAppliedEffect {
  effect: QuestGraphEffect;
  applied: boolean;
  reason?: string;
}

export interface QuestGraphEffectExecutionResult {
  appliedEffects: QuestGraphAppliedEffect[];
  dirty: boolean;
}

export function cloneQuestGraphPlayerState(player: Entity): Entity {
  return {
    ...player,
    activeQuests: (player.activeQuests ?? []).map((quest) => ({ ...quest })),
    completedQuests: [...(player.completedQuests ?? [])],
    storyFlags: [...(player.storyFlags ?? [])],
  };
}

function ensureQuestArrays(player: Entity): void {
  if (!player.activeQuests) player.activeQuests = [];
  if (!player.completedQuests) player.completedQuests = [];
  if (!player.storyFlags) player.storyFlags = [];
}

function hasStoryFlag(player: Entity, flag: string): boolean {
  return (player.storyFlags ?? []).includes(flag);
}

function addStoryFlag(player: Entity, flag: string): boolean {
  ensureQuestArrays(player);
  if (hasStoryFlag(player, flag)) return false;
  player.storyFlags!.push(flag);
  return true;
}

function applyQuestStoryFlags(player: Entity, flags: string[] | undefined): boolean {
  let dirty = false;
  for (const flag of flags ?? []) {
    dirty = addStoryFlag(player, flag) || dirty;
  }
  return dirty;
}

function tryStartQuest(player: Entity, questId: string): { applied: boolean; reason?: string } {
  ensureQuestArrays(player);
  const quest = QUEST_CATALOG.find((entry) => entry.id === questId);
  if (!quest) return { applied: false, reason: `Unknown quest "${questId}"` };
  if ((player.completedQuests ?? []).includes(questId)) {
    return { applied: false, reason: `Quest "${questId}" already completed` };
  }
  if ((player.activeQuests ?? []).some((entry) => entry.questId === questId)) {
    return { applied: false, reason: `Quest "${questId}" already active` };
  }
  const isAvailable = isQuestAvailableForPlayer(
    quest,
    player.completedQuests ?? [],
    player.storyFlags ?? [],
  );
  if (!isAvailable) {
    return { applied: false, reason: `Quest "${questId}" is not currently available` };
  }

  player.activeQuests!.push({
    questId,
    progress: 0,
    startedAt: Date.now(),
  });
  applyQuestStoryFlags(player, quest.grantStoryFlagsOnAccept);
  return { applied: true };
}

async function tryCompleteQuest(
  player: Entity,
  questId: string,
  context: QuestGraphEffectExecutionContext,
): Promise<{ applied: boolean; reason?: string }> {
  ensureQuestArrays(player);
  const quest = QUEST_CATALOG.find((entry) => entry.id === questId);
  if (!quest) return { applied: false, reason: `Unknown quest "${questId}"` };
  if ((player.completedQuests ?? []).includes(questId)) {
    return { applied: false, reason: `Quest "${questId}" already completed` };
  }

  let activeQuest = (player.activeQuests ?? []).find((entry) => entry.questId === questId);
  if (!activeQuest) {
    if (quest.objective.type !== "talk") {
      return { applied: false, reason: `Quest "${questId}" is not active` };
    }

    const isAvailable = isQuestAvailableForPlayer(
      quest,
      player.completedQuests ?? [],
      player.storyFlags ?? [],
    );
    if (!isAvailable) {
      return { applied: false, reason: `Quest "${questId}" is not currently available` };
    }

    player.activeQuests!.push({
      questId,
      progress: 0,
      startedAt: Date.now(),
    });
    applyQuestStoryFlags(player, quest.grantStoryFlagsOnAccept);
    activeQuest = player.activeQuests![player.activeQuests!.length - 1];
  }

  if (quest.objective.type === "talk") {
    activeQuest.progress = quest.objective.count;
  }

  if (!isQuestComplete(quest, activeQuest.progress)) {
    return { applied: false, reason: `Quest "${questId}" is not complete` };
  }

  player.activeQuests = (player.activeQuests ?? []).filter((entry) => entry.questId !== questId);
  if (!(player.completedQuests ?? []).includes(questId)) {
    player.completedQuests!.push(questId);
  }
  applyQuestStoryFlags(player, quest.grantStoryFlagsOnComplete);

  if (context.commit) {
    await awardQuestRewards(player, quest);
    logQuestGraphCompletionEvent(player, quest);
  }

  return { applied: true };
}

function logQuestGraphCompletionEvent(player: Entity, quest: Quest): void {
  logZoneEvent({
    zoneId: player.region ?? "unknown",
    type: "quest",
    tick: 0,
    message: `${player.name}: Completed "${quest.title}" via dialogue scene`,
    entityId: player.id,
    entityName: player.name,
  });
}

export async function applyQuestGraphEffects(
  effects: QuestGraphEffect[] | undefined,
  context: QuestGraphEffectExecutionContext,
): Promise<QuestGraphEffectExecutionResult> {
  if (!effects?.length) return { appliedEffects: [], dirty: false };

  ensureQuestArrays(context.player);
  let dirty = false;
  const appliedEffects: QuestGraphAppliedEffect[] = [];

  for (const effect of effects) {
    if (effect.type === "set_story_flag") {
      const applied = addStoryFlag(context.player, effect.flag);
      appliedEffects.push({
        effect,
        applied,
        ...(applied ? {} : { reason: `Story flag "${effect.flag}" already set` }),
      });
      dirty ||= applied;
      continue;
    }

    if (effect.type === "start_quest") {
      const result = tryStartQuest(context.player, effect.questId);
      appliedEffects.push({
        effect,
        applied: result.applied,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      dirty ||= result.applied;
      continue;
    }

    if (effect.type === "complete_quest") {
      const result = await tryCompleteQuest(context.player, effect.questId, context);
      appliedEffects.push({
        effect,
        applied: result.applied,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      dirty ||= result.applied;
      continue;
    }

    if (effect.type === "log_diary") {
      if (context.commit && context.player.walletAddress) {
        logDiary(
          context.player.walletAddress,
          context.player.name,
          context.player.region ?? "unknown",
          context.player.x,
          context.player.y,
          "quest_complete",
          effect.headline,
          effect.narrative,
          {
            arcId: context.arcId,
            sceneId: context.sceneId,
            ...(effect.details ?? {}),
          },
        );
      }
      appliedEffects.push({ effect, applied: true });
      continue;
    }

    if (effect.type === "emit_zone_event") {
      if (context.commit) {
        logZoneEvent({
          zoneId: context.player.region ?? "unknown",
          type: effect.eventType,
          tick: 0,
          message: effect.message,
          entityId: context.player.id,
          entityName: context.player.name,
        });
      }
      appliedEffects.push({ effect, applied: true });
      continue;
    }
  }

  return { appliedEffects, dirty };
}

export async function persistQuestGraphPlayerState(player: Entity): Promise<void> {
  if (!player.walletAddress || !player.name) return;
  await saveCharacter(player.walletAddress, player.name, {
    completedQuests: player.completedQuests ?? [],
    storyFlags: player.storyFlags ?? [],
  });
}
