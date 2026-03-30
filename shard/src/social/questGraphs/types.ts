export type QuestGraphSpeaker = "npc" | "player" | "system";

export type QuestGraphCondition =
  | { type: "all"; conditions: QuestGraphCondition[] }
  | { type: "any"; conditions: QuestGraphCondition[] }
  | { type: "not"; condition: QuestGraphCondition }
  | { type: "has_story_flag"; flag: string }
  | { type: "missing_story_flag"; flag: string }
  | { type: "quest_completed"; questId: string }
  | { type: "quest_active"; questId: string }
  | { type: "quest_ready_to_turn_in"; questId: string }
  | { type: "quest_available"; questId: string }
  | { type: "origin_is"; origin: string }
  | { type: "class_is"; classId: string }
  | { type: "npc_is"; npcName: string };

export type QuestGraphEffect =
  | { type: "set_story_flag"; flag: string }
  | { type: "start_quest"; questId: string }
  | { type: "complete_quest"; questId: string }
  | {
      type: "log_diary";
      headline: string;
      narrative: string;
      details?: Record<string, unknown>;
    }
  | {
      type: "emit_zone_event";
      eventType: "chat" | "quest";
      message: string;
    };

export interface QuestGraphChoice {
  id: string;
  label: string;
  next?: string | null;
  condition?: QuestGraphCondition;
  effects?: QuestGraphEffect[];
  style?: "primary" | "secondary" | "danger";
}

export interface QuestGraphFreeformRoute {
  id: string;
  label: string;
  next?: string | null;
  intents: string[];
  phrases?: string[];
  condition?: QuestGraphCondition;
  effects?: QuestGraphEffect[];
}

export interface QuestGraphLineNode {
  id: string;
  type: "line";
  speaker: QuestGraphSpeaker;
  text: string;
  next?: string | null;
}

export interface QuestGraphChoiceNode {
  id: string;
  type: "choice";
  speaker: QuestGraphSpeaker;
  text: string;
  choices: QuestGraphChoice[];
  next?: string | null;
}

export interface QuestGraphBranchNode {
  id: string;
  type: "branch";
  branches: Array<{
    condition: QuestGraphCondition;
    next: string;
  }>;
  fallbackNext?: string | null;
}

export interface QuestGraphEffectNode {
  id: string;
  type: "effect";
  effects: QuestGraphEffect[];
  next?: string | null;
}

export interface QuestGraphFreeformNode {
  id: string;
  type: "freeform";
  speaker: QuestGraphSpeaker;
  text: string;
  prompt: string;
  placeholder?: string;
  routes: QuestGraphFreeformRoute[];
  fallbackText?: string;
}

export interface QuestGraphEndNode {
  id: string;
  type: "end";
  text?: string;
}

export type QuestGraphNode =
  | QuestGraphLineNode
  | QuestGraphChoiceNode
  | QuestGraphBranchNode
  | QuestGraphEffectNode
  | QuestGraphFreeformNode
  | QuestGraphEndNode;

export interface QuestSceneDefinition {
  id: string;
  npcName: string;
  title: string;
  startNodeId: string;
  entryCondition?: QuestGraphCondition;
  nodes: Record<string, QuestGraphNode>;
}

export interface QuestArcDefinition {
  id: string;
  title: string;
  summary: string;
  zoneIds: string[];
  tags: string[];
  startingSceneId: string;
  scenes: Record<string, QuestSceneDefinition>;
}

export interface QuestGraphRenderableChoice {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
}

export interface QuestGraphRenderableFreeformRoute {
  id: string;
  label: string;
}

export type QuestGraphRenderableNode =
  | {
      id: string;
      type: "line";
      speaker: QuestGraphSpeaker;
      text: string;
    }
  | {
      id: string;
      type: "choice";
      speaker: QuestGraphSpeaker;
      text: string;
      choices: QuestGraphRenderableChoice[];
    }
  | {
      id: string;
      type: "freeform";
      speaker: QuestGraphSpeaker;
      text: string;
      prompt: string;
      placeholder?: string;
      routes: QuestGraphRenderableFreeformRoute[];
      fallbackText?: string;
    }
  | {
      id: string;
      type: "end";
      text?: string;
    };

export interface QuestGraphValidationIssue {
  arcId: string;
  sceneId?: string;
  nodeId?: string;
  message: string;
}
