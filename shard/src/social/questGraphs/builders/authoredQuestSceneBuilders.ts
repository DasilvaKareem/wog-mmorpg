import type { QuestArcDefinition, QuestGraphChoice, QuestGraphCondition, QuestGraphNode } from "../types.js";

export interface AuthoredTalkQuestSceneConfig {
  sceneId: string;
  npcName: string;
  title: string;
  questId: string;
  introLine: string;
  detailLine: string;
  freeformText: string;
  freeformPrompt: string;
  freeformPlaceholder: string;
  freeformFallback: string;
  completionLine: string;
  revisitLine: string;
  idleLine: string;
}

export interface MarcusWelcomeTourSceneConfig {
  sceneId: string;
  npcName: string;
  title: string;
  welcomeQuestId: string;
  finalQuestId: string;
  welcomeActiveText: string;
  welcomeContextText: string;
  welcomeCompleteText: string;
  betweenAssignmentsText: string;
  finalOfferText: string;
  finalDetailsText: string;
  finalFreeformText: string;
  finalFreeformPrompt: string;
  finalFreeformPlaceholder: string;
  finalFreeformFallback: string;
  finalActiveText: string;
  finalWaitText: string;
  finalCompleteText: string;
  finalRevisitText: string;
  idleText: string;
}

export interface StagedContractAvailableStateConfig {
  promptText: string;
  acceptLabel: string;
  acceptedText: string;
  effectType: "start_quest" | "complete_quest";
  detailsLabel?: string;
  detailsText?: string;
  freeformLabel?: string;
  freeformText?: string;
  freeformPrompt?: string;
  freeformPlaceholder?: string;
  freeformFallback?: string;
  declineLabel?: string;
  declineText?: string;
  zoneEventMessage?: string;
}

export interface StagedContractActiveStateConfig {
  promptText: string;
  primaryLabel: string;
  resultText: string;
  resultEffectType?: "start_quest" | "complete_quest";
  secondaryLabel?: string;
  secondaryText?: string;
  declineLabel?: string;
  declineText?: string;
}

export interface StagedContractStageConfig {
  stageId: string;
  questId: string;
  available?: StagedContractAvailableStateConfig;
  active?: StagedContractActiveStateConfig;
  completedText?: string;
}

export interface StagedContractsSceneConfig {
  sceneId: string;
  npcName: string;
  title: string;
  idleText: string;
  stages: StagedContractStageConfig[];
}

export interface KaelaBriefingSceneConfig {
  sceneId: string;
  npcName: string;
  title: string;
  briefingFlag: string;
  introLines: string[];
  readyPrompt: string;
  readyLabel: string;
  repeatLabel: string;
  completionText: string;
  alreadyBriefedText: string;
}

export interface MarcusOnboardingSceneConfig {
  sceneId: string;
  npcName: string;
  title: string;
  requiredFlag: string;
  welcomeQuestId: string;
  blockedText: string;
  introText: string;
  optionsPrompt: string;
  acceptLabel: string;
  contextLabel: string;
  freeformLabel: string;
  declineLabel: string;
  hintText: string;
  freeformText: string;
  freeformPrompt: string;
  freeformPlaceholder: string;
  freeformFallback: string;
  acceptedText: string;
  declineText: string;
  zoneEventMessage: string;
}

export function buildAuthoredTalkQuestScene(config: AuthoredTalkQuestSceneConfig): QuestArcDefinition["scenes"][string] {
  const nodes: Record<string, QuestGraphNode> = {
    root: {
      id: "root",
      type: "branch",
      branches: [
        {
          condition: { type: "quest_completed", questId: config.questId },
          next: "revisit",
        },
        {
          condition: { type: "quest_active", questId: config.questId },
          next: "active_intro",
        },
        {
          condition: { type: "quest_available", questId: config.questId },
          next: "offer_intro",
        },
      ],
      fallbackNext: "idle",
    },
    offer_intro: {
      id: "offer_intro",
      type: "line",
      speaker: "npc",
      text: config.introLine,
      next: "offer_choice",
    },
    offer_choice: {
      id: "offer_choice",
      type: "choice",
      speaker: "npc",
      text: "How do you want to handle this?",
      choices: [
        {
          id: "accept",
          label: "Let's settle it now.",
          style: "primary",
          next: "complete_effect",
        },
        {
          id: "details",
          label: "Explain it clearly.",
          style: "secondary",
          next: "details_line",
        },
        {
          id: "freeform",
          label: "Let me ask in my own words.",
          style: "secondary",
          next: "freeform",
        },
        {
          id: "later",
          label: "Later.",
          style: "danger",
          next: "decline_line",
        },
      ],
    },
    details_line: {
      id: "details_line",
      type: "line",
      speaker: "npc",
      text: config.detailLine,
      next: "offer_choice",
    },
    freeform: {
      id: "freeform",
      type: "freeform",
      speaker: "npc",
      text: config.freeformText,
      prompt: config.freeformPrompt,
      placeholder: config.freeformPlaceholder,
      fallbackText: config.freeformFallback,
      routes: [
        {
          id: "freeform_accept",
          label: "Accept now",
          intents: ["accept", "lets do it", "i'm ready", "settle it now", "i'll take it", "continue"],
          phrases: ["give it to me", "i can handle this", "move us forward"],
          next: "complete_effect",
        },
        {
          id: "freeform_details",
          label: "Ask for details",
          intents: ["details", "explain", "clarify", "what exactly", "what do you need"],
          phrases: ["say it plainly", "tell me what matters"],
          next: "details_line",
        },
        {
          id: "freeform_later",
          label: "Come back later",
          intents: ["later", "not now", "wait", "come back"],
          phrases: ["another time", "i need a moment"],
          next: "decline_line",
        },
      ],
    },
    active_intro: {
      id: "active_intro",
      type: "choice",
      speaker: "npc",
      text: "We're already in the middle of this exchange. Finish it now or ask what you missed.",
      choices: [
        {
          id: "finish",
          label: "Finish it now.",
          style: "primary",
          next: "complete_effect",
        },
        {
          id: "active_details",
          label: "Remind me what matters.",
          style: "secondary",
          next: "details_line",
        },
        {
          id: "active_later",
          label: "I'll return later.",
          style: "danger",
          next: "decline_line",
        },
      ],
    },
    complete_effect: {
      id: "complete_effect",
      type: "effect",
      effects: [{ type: "complete_quest", questId: config.questId }],
      next: "completion_line",
    },
    completion_line: {
      id: "completion_line",
      type: "line",
      speaker: "npc",
      text: config.completionLine,
      next: "scene_end",
    },
    decline_line: {
      id: "decline_line",
      type: "line",
      speaker: "npc",
      text: "Then don't waste either of our time. Return when you're ready to move.",
      next: "scene_end",
    },
    revisit: {
      id: "revisit",
      type: "line",
      speaker: "npc",
      text: config.revisitLine,
      next: "scene_end",
    },
    idle: {
      id: "idle",
      type: "line",
      speaker: "npc",
      text: config.idleLine,
      next: "scene_end",
    },
    scene_end: {
      id: "scene_end",
      type: "end",
      text: `${config.npcName}'s welcome-tour scene is complete.`,
    },
  };

  return {
    id: config.sceneId,
    npcName: config.npcName,
    title: config.title,
    startNodeId: "root",
    nodes,
  };
}

export function buildMarcusWelcomeTourScene(config: MarcusWelcomeTourSceneConfig): QuestArcDefinition["scenes"][string] {
  const nodes: Record<string, QuestGraphNode> = {
    root: {
      id: "root",
      type: "branch",
      branches: [
        {
          condition: { type: "quest_completed", questId: config.finalQuestId },
          next: "battle_ready_revisit",
        },
        {
          condition: { type: "quest_active", questId: config.finalQuestId },
          next: "battle_ready_active",
        },
        {
          condition: { type: "quest_available", questId: config.finalQuestId },
          next: "battle_ready_offer",
        },
        {
          condition: { type: "quest_active", questId: config.welcomeQuestId },
          next: "welcome_active",
        },
        {
          condition: { type: "quest_completed", questId: config.welcomeQuestId },
          next: "between_assignments",
        },
      ],
      fallbackNext: "idle",
    },
    welcome_active: {
      id: "welcome_active",
      type: "choice",
      speaker: "npc",
      text: config.welcomeActiveText,
      choices: [
        {
          id: "welcome_finish",
          label: "Report in.",
          style: "primary",
          next: "welcome_complete_effect",
        },
        {
          id: "welcome_context",
          label: "What exactly was this meant to teach?",
          style: "secondary",
          next: "welcome_context_line",
        },
      ],
    },
    welcome_context_line: {
      id: "welcome_context_line",
      type: "line",
      speaker: "npc",
      text: config.welcomeContextText,
      next: "welcome_active",
    },
    welcome_complete_effect: {
      id: "welcome_complete_effect",
      type: "effect",
      effects: [{ type: "complete_quest", questId: config.welcomeQuestId }],
      next: "welcome_complete_line",
    },
    welcome_complete_line: {
      id: "welcome_complete_line",
      type: "line",
      speaker: "npc",
      text: config.welcomeCompleteText,
      next: "scene_end",
    },
    between_assignments: {
      id: "between_assignments",
      type: "line",
      speaker: "npc",
      text: config.betweenAssignmentsText,
      next: "scene_end",
    },
    battle_ready_offer: {
      id: "battle_ready_offer",
      type: "choice",
      speaker: "npc",
      text: config.finalOfferText,
      choices: [
        {
          id: "battle_ready_accept",
          label: "Finish the tour.",
          style: "primary",
          next: "battle_ready_effect",
        },
        {
          id: "battle_ready_details",
          label: "What comes after this?",
          style: "secondary",
          next: "battle_ready_details_line",
        },
        {
          id: "battle_ready_freeform",
          label: "Let me ask directly.",
          style: "secondary",
          next: "battle_ready_freeform",
        },
      ],
    },
    battle_ready_details_line: {
      id: "battle_ready_details_line",
      type: "line",
      speaker: "npc",
      text: config.finalDetailsText,
      next: "battle_ready_offer",
    },
    battle_ready_freeform: {
      id: "battle_ready_freeform",
      type: "freeform",
      speaker: "npc",
      text: config.finalFreeformText,
      prompt: config.finalFreeformPrompt,
      placeholder: config.finalFreeformPlaceholder,
      fallbackText: config.finalFreeformFallback,
      routes: [
        {
          id: "battle_ready_freeform_accept",
          label: "Finish the tour",
          intents: ["ready", "finish", "complete", "send me out", "i am ready", "lets finish"],
          phrases: ["close this out", "give me the last reward", "i'm ready for battle"],
          next: "battle_ready_effect",
        },
        {
          id: "battle_ready_freeform_details",
          label: "Ask what comes next",
          intents: ["what next", "what comes after", "what now", "where next"],
          phrases: ["what happens after this", "what do i do once this is done"],
          next: "battle_ready_details_line",
        },
      ],
    },
    battle_ready_active: {
      id: "battle_ready_active",
      type: "choice",
      speaker: "npc",
      text: config.finalActiveText,
      choices: [
        {
          id: "battle_ready_finish",
          label: "Settle it now.",
          style: "primary",
          next: "battle_ready_effect",
        },
        {
          id: "battle_ready_wait",
          label: "Later.",
          style: "danger",
          next: "battle_ready_wait_line",
        },
      ],
    },
    battle_ready_wait_line: {
      id: "battle_ready_wait_line",
      type: "line",
      speaker: "npc",
      text: config.finalWaitText,
      next: "scene_end",
    },
    battle_ready_effect: {
      id: "battle_ready_effect",
      type: "effect",
      effects: [{ type: "complete_quest", questId: config.finalQuestId }],
      next: "battle_ready_complete_line",
    },
    battle_ready_complete_line: {
      id: "battle_ready_complete_line",
      type: "line",
      speaker: "npc",
      text: config.finalCompleteText,
      next: "scene_end",
    },
    battle_ready_revisit: {
      id: "battle_ready_revisit",
      type: "line",
      speaker: "npc",
      text: config.finalRevisitText,
      next: "scene_end",
    },
    idle: {
      id: "idle",
      type: "line",
      speaker: "npc",
      text: config.idleText,
      next: "scene_end",
    },
    scene_end: {
      id: "scene_end",
      type: "end",
      text: `${config.npcName}'s welcome-tour scene is complete.`,
    },
  };

  return {
    id: config.sceneId,
    npcName: config.npcName,
    title: config.title,
    startNodeId: "root",
    nodes,
  };
}

export function buildStagedContractsScene(config: StagedContractsSceneConfig): QuestArcDefinition["scenes"][string] {
  const nodes: Record<string, QuestGraphNode> = {};
  const activeBranches: Array<{ condition: QuestGraphCondition; next: string }> = [];
  const availableBranches: Array<{ condition: QuestGraphCondition; next: string }> = [];
  const completedBranches: Array<{ condition: QuestGraphCondition; next: string }> = [];
  const prioritizedStages = [...config.stages].reverse();

  for (const stage of prioritizedStages) {
    if (stage.completedText) {
      completedBranches.push({
        condition: { type: "quest_completed", questId: stage.questId },
        next: `${stage.stageId}_completed`,
      });
      nodes[`${stage.stageId}_completed`] = {
        id: `${stage.stageId}_completed`,
        type: "line",
        speaker: "npc",
        text: stage.completedText,
        next: "scene_end",
      };
    }

    if (stage.active) {
      activeBranches.push({
        condition: { type: "quest_active", questId: stage.questId },
        next: `${stage.stageId}_active`,
      });

      const activeChoices: QuestGraphChoice[] = [
        {
          id: `${stage.stageId}_active_primary`,
          label: stage.active.primaryLabel,
          style: "primary" as const,
          next: stage.active.resultEffectType ? `${stage.stageId}_active_effect` : `${stage.stageId}_active_result`,
        },
      ];

      if (stage.active.secondaryLabel && stage.active.secondaryText) {
        activeChoices.push({
          id: `${stage.stageId}_active_secondary`,
          label: stage.active.secondaryLabel,
          style: "secondary" as const,
          next: `${stage.stageId}_active_secondary_line`,
        });
        nodes[`${stage.stageId}_active_secondary_line`] = {
          id: `${stage.stageId}_active_secondary_line`,
          type: "line",
          speaker: "npc",
          text: stage.active.secondaryText,
          next: `${stage.stageId}_active`,
        };
      }

      if (stage.active.declineLabel && stage.active.declineText) {
        activeChoices.push({
          id: `${stage.stageId}_active_decline`,
          label: stage.active.declineLabel,
          style: "danger" as const,
          next: `${stage.stageId}_active_decline_line`,
        });
        nodes[`${stage.stageId}_active_decline_line`] = {
          id: `${stage.stageId}_active_decline_line`,
          type: "line",
          speaker: "npc",
          text: stage.active.declineText,
          next: "scene_end",
        };
      }

      nodes[`${stage.stageId}_active`] = {
        id: `${stage.stageId}_active`,
        type: "choice",
        speaker: "npc",
        text: stage.active.promptText,
        choices: activeChoices,
      };

      if (stage.active.resultEffectType) {
        nodes[`${stage.stageId}_active_effect`] = {
          id: `${stage.stageId}_active_effect`,
          type: "effect",
          effects: [{ type: stage.active.resultEffectType, questId: stage.questId }],
          next: `${stage.stageId}_active_result`,
        };
      }

      nodes[`${stage.stageId}_active_result`] = {
        id: `${stage.stageId}_active_result`,
        type: "line",
        speaker: "npc",
        text: stage.active.resultText,
        next: "scene_end",
      };
    }

    if (stage.available) {
      availableBranches.push({
        condition: { type: "quest_available", questId: stage.questId },
        next: `${stage.stageId}_offer`,
      });

      const offerChoices: QuestGraphChoice[] = [
        {
          id: `${stage.stageId}_offer_accept`,
          label: stage.available.acceptLabel,
          style: "primary" as const,
          next: `${stage.stageId}_offer_effect`,
        },
      ];

      if (stage.available.detailsLabel && stage.available.detailsText) {
        offerChoices.push({
          id: `${stage.stageId}_offer_details`,
          label: stage.available.detailsLabel,
          style: "secondary" as const,
          next: `${stage.stageId}_offer_details_line`,
        });
        nodes[`${stage.stageId}_offer_details_line`] = {
          id: `${stage.stageId}_offer_details_line`,
          type: "line",
          speaker: "npc",
          text: stage.available.detailsText,
          next: `${stage.stageId}_offer`,
        };
      }

      if (
        stage.available.freeformLabel
        && stage.available.freeformText
        && stage.available.freeformPrompt
        && stage.available.freeformPlaceholder
        && stage.available.freeformFallback
      ) {
        offerChoices.push({
          id: `${stage.stageId}_offer_freeform`,
          label: stage.available.freeformLabel,
          style: "secondary" as const,
          next: `${stage.stageId}_offer_freeform_node`,
        });
        nodes[`${stage.stageId}_offer_freeform_node`] = {
          id: `${stage.stageId}_offer_freeform_node`,
          type: "freeform",
          speaker: "npc",
          text: stage.available.freeformText,
          prompt: stage.available.freeformPrompt,
          placeholder: stage.available.freeformPlaceholder,
          fallbackText: stage.available.freeformFallback,
          routes: [
            {
              id: `${stage.stageId}_offer_freeform_accept`,
              label: "Accept the assignment",
              intents: ["accept", "ready", "do it", "lets do it", "continue", "finish this"],
              phrases: ["i am ready", "give me the work", "settle it now"],
              next: `${stage.stageId}_offer_effect`,
            },
            {
              id: `${stage.stageId}_offer_freeform_details`,
              label: "Ask for details",
              intents: ["details", "what next", "explain", "clarify", "what now"],
              phrases: ["tell me clearly", "what should i know"],
              next: `${stage.stageId}_offer_details_line`,
            },
            {
              id: `${stage.stageId}_offer_freeform_decline`,
              label: "Decline for now",
              intents: ["later", "not now", "wait", "come back"],
              phrases: ["another time", "i need a moment"],
              next: `${stage.stageId}_offer_decline_line`,
            },
          ],
        };
      }

      if (stage.available.declineLabel && stage.available.declineText) {
        offerChoices.push({
          id: `${stage.stageId}_offer_decline`,
          label: stage.available.declineLabel,
          style: "danger" as const,
          next: `${stage.stageId}_offer_decline_line`,
        });
        nodes[`${stage.stageId}_offer_decline_line`] = {
          id: `${stage.stageId}_offer_decline_line`,
          type: "line",
          speaker: "npc",
          text: stage.available.declineText,
          next: "scene_end",
        };
      }

      nodes[`${stage.stageId}_offer`] = {
        id: `${stage.stageId}_offer`,
        type: "choice",
        speaker: "npc",
        text: stage.available.promptText,
        choices: offerChoices,
      };

      const offerEffects: Array<{ type: "start_quest" | "complete_quest"; questId: string } | { type: "emit_zone_event"; eventType: "chat" | "quest"; message: string }> = [
        { type: stage.available.effectType, questId: stage.questId },
      ];
      if (stage.available.zoneEventMessage) {
        offerEffects.push({
          type: "emit_zone_event",
          eventType: "quest",
          message: stage.available.zoneEventMessage,
        });
      }
      nodes[`${stage.stageId}_offer_effect`] = {
        id: `${stage.stageId}_offer_effect`,
        type: "effect",
        effects: offerEffects,
        next: `${stage.stageId}_offer_result`,
      };
      nodes[`${stage.stageId}_offer_result`] = {
        id: `${stage.stageId}_offer_result`,
        type: "line",
        speaker: "npc",
        text: stage.available.acceptedText,
        next: "scene_end",
      };
    }
  }

  nodes.root = {
    id: "root",
    type: "branch",
    branches: [...activeBranches, ...availableBranches, ...completedBranches],
    fallbackNext: "idle",
  };
  nodes.idle = {
    id: "idle",
    type: "line",
    speaker: "npc",
    text: config.idleText,
    next: "scene_end",
  };
  nodes.scene_end = {
    id: "scene_end",
    type: "end",
    text: `${config.npcName}'s staged contract scene is complete.`,
  };

  return {
    id: config.sceneId,
    npcName: config.npcName,
    title: config.title,
    startNodeId: "root",
    nodes,
  };
}

export function buildKaelaBriefingScene(config: KaelaBriefingSceneConfig): QuestArcDefinition["scenes"][string] {
  const introNodes: Record<string, QuestGraphNode> = {};

  for (let index = 0; index < config.introLines.length; index += 1) {
    const nodeId = `intro_${index}`;
    const nextId = index === config.introLines.length - 1 ? "intro_choice" : `intro_${index + 1}`;
    introNodes[nodeId] = {
      id: nodeId,
      type: "line",
      speaker: "npc",
      text: config.introLines[index],
      next: nextId,
    };
  }

  const firstIntroNodeId = config.introLines.length > 0 ? "intro_0" : "intro_choice";

  return {
    id: config.sceneId,
    npcName: config.npcName,
    title: config.title,
    startNodeId: "briefing_gate",
    nodes: {
      briefing_gate: {
        id: "briefing_gate",
        type: "branch",
        branches: [
          {
            condition: { type: "has_story_flag", flag: config.briefingFlag },
            next: "already_briefed",
          },
        ],
        fallbackNext: firstIntroNodeId,
      },
      ...introNodes,
      intro_choice: {
        id: "intro_choice",
        type: "choice",
        speaker: "npc",
        text: config.readyPrompt,
        choices: [
          {
            id: "ready",
            label: config.readyLabel,
            style: "primary",
            next: "mark_briefed",
          },
          {
            id: "repeat",
            label: config.repeatLabel,
            style: "secondary",
            next: firstIntroNodeId,
          },
        ],
      },
      mark_briefed: {
        id: "mark_briefed",
        type: "effect",
        effects: [{ type: "set_story_flag", flag: config.briefingFlag }],
        next: "briefing_complete",
      },
      briefing_complete: {
        id: "briefing_complete",
        type: "line",
        speaker: "npc",
        text: config.completionText,
        next: "briefing_end",
      },
      already_briefed: {
        id: "already_briefed",
        type: "line",
        speaker: "npc",
        text: config.alreadyBriefedText,
        next: "briefing_end",
      },
      briefing_end: {
        id: "briefing_end",
        type: "end",
        text: `${config.npcName}'s briefing scene is complete.`,
      },
    },
  };
}

export function buildMarcusOnboardingScene(config: MarcusOnboardingSceneConfig): QuestArcDefinition["scenes"][string] {
  return {
    id: config.sceneId,
    npcName: config.npcName,
    title: config.title,
    startNodeId: "marcus_gate",
    nodes: {
      marcus_gate: {
        id: "marcus_gate",
        type: "branch",
        branches: [
          {
            condition: { type: "has_story_flag", flag: config.requiredFlag },
            next: "marcus_intro",
          },
        ],
        fallbackNext: "blocked_by_kaela",
      },
      blocked_by_kaela: {
        id: "blocked_by_kaela",
        type: "line",
        speaker: "npc",
        text: config.blockedText,
        next: "marcus_end",
      },
      marcus_intro: {
        id: "marcus_intro",
        type: "line",
        speaker: "npc",
        text: config.introText,
        next: "marcus_options",
      },
      marcus_options: {
        id: "marcus_options",
        type: "choice",
        speaker: "npc",
        text: config.optionsPrompt,
        choices: [
          {
            id: "accept",
            label: config.acceptLabel,
            style: "primary",
            next: "start_welcome_quest",
            condition: { type: "quest_available", questId: config.welcomeQuestId },
          },
          {
            id: "ask_context",
            label: config.contextLabel,
            style: "secondary",
            next: "marcus_hint",
          },
          {
            id: "freeform",
            label: config.freeformLabel,
            style: "secondary",
            next: "marcus_freeform",
          },
          {
            id: "later",
            label: config.declineLabel,
            style: "danger",
            next: "marcus_decline",
          },
        ],
      },
      marcus_hint: {
        id: "marcus_hint",
        type: "line",
        speaker: "npc",
        text: config.hintText,
        next: "marcus_options",
      },
      marcus_freeform: {
        id: "marcus_freeform",
        type: "freeform",
        speaker: "npc",
        text: config.freeformText,
        prompt: config.freeformPrompt,
        placeholder: config.freeformPlaceholder,
        fallbackText: config.freeformFallback,
        routes: [
          {
            id: "accept_work",
            label: "Accept the assignment",
            intents: ["accept quest", "give me work", "ready for work", "i am ready", "job", "assignment"],
            phrases: ["what is first", "what's first", "i'll do it", "send me out"],
            next: "start_welcome_quest",
            condition: { type: "quest_available", questId: config.welcomeQuestId },
          },
          {
            id: "ask_guidance",
            label: "Ask for guidance",
            intents: ["where next", "what should i know", "guide me", "where do i go"],
            phrases: ["tell me about the meadow", "what am i walking into"],
            next: "marcus_hint",
          },
          {
            id: "decline_now",
            label: "Decline for now",
            intents: ["not now", "later", "wait", "busy"],
            phrases: ["come back later", "i need a moment"],
            next: "marcus_decline",
          },
        ],
      },
      start_welcome_quest: {
        id: "start_welcome_quest",
        type: "effect",
        effects: [
          { type: "start_quest", questId: config.welcomeQuestId },
          {
            type: "emit_zone_event",
            eventType: "quest",
            message: config.zoneEventMessage,
          },
        ],
        next: "quest_accepted",
      },
      quest_accepted: {
        id: "quest_accepted",
        type: "line",
        speaker: "npc",
        text: config.acceptedText,
        next: "marcus_end",
      },
      marcus_decline: {
        id: "marcus_decline",
        type: "line",
        speaker: "npc",
        text: config.declineText,
        next: "marcus_end",
      },
      marcus_end: {
        id: "marcus_end",
        type: "end",
        text: `${config.npcName}'s onboarding scene is complete.`,
      },
    },
  };
}
