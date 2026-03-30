import type { ActiveQuestEntry, AvailableQuestEntry } from "@/hooks/useQuestLog";

export type DialogueSpeaker = "npc" | "champion" | "system";

export interface DialoguePortrait {
  side: "left" | "right";
  alt: string;
  src?: string;
  label?: string;
  accent?: string;
}

export interface DialogueBadge {
  label: string;
  color: string;
}

export interface DialogueObjectivePanel {
  label: string;
}

export interface DialogueRewardsPanel {
  xp: number;
  copperLabel: string;
}

export interface DialogueProgressPanel {
  value: number;
  max: number;
  complete: boolean;
}

export type DialogueEffect =
  | {
      type: "acceptQuest";
      quest: AvailableQuestEntry;
      npc: { id: string; name: string; zoneId?: string };
    }
  | {
      type: "turnInQuest";
      quest: ActiveQuestEntry;
      npc: { id: string; name: string; zoneId?: string };
    }
  | {
      type: "setStoryFlag";
      flag: string;
    }
  | { type: "close" };

export interface DialogueChoice {
  id: string;
  label: string;
  next?: string | null;
  variant?: "primary" | "secondary" | "danger";
  effects?: DialogueEffect[];
  disabled?: boolean;
}

export interface DialogueNode {
  id: string;
  speaker: DialogueSpeaker;
  text: string;
  next?: string | null;
  title?: string;
  badge?: DialogueBadge;
  portrait?: DialoguePortrait;
  objective?: DialogueObjectivePanel;
  rewards?: DialogueRewardsPanel;
  progress?: DialogueProgressPanel;
  choices?: DialogueChoice[];
}

export interface DialogueScript {
  start: string;
  nodes: Record<string, DialogueNode>;
}
