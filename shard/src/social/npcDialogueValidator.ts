export type NpcDialogueIntent =
  | "greeting"
  | "offer_quest"
  | "quest_progress"
  | "quest_turn_in"
  | "tutorial"
  | "lore"
  | "redirect"
  | "refuse";

export interface SuggestedNpcAction {
  label: string;
  prompt: string;
}

export interface NpcDialogueDraft {
  reply: string;
  intent?: string;
  referencesQuestId?: string | null;
  suggestedActions?: Array<{
    label?: string | null;
    prompt?: string | null;
  }> | null;
}

export interface NpcDialogueValidationContext {
  availableQuestIds: string[];
  activeQuestIds: string[];
  completableQuestIds: string[];
  isTutorialNpc: boolean;
}

export interface NpcDialogueValidated {
  reply: string;
  intent: NpcDialogueIntent;
  referencesQuestId?: string;
  suggestedActions: SuggestedNpcAction[];
}

const ALLOWED_INTENTS = new Set<NpcDialogueIntent>([
  "greeting",
  "offer_quest",
  "quest_progress",
  "quest_turn_in",
  "tutorial",
  "lore",
  "redirect",
  "refuse",
]);

function clampReply(reply: string): string {
  const cleaned = reply.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 320) return cleaned;
  return `${cleaned.slice(0, 317).trimEnd()}...`;
}

function normalizeActionLabel(label: string): string {
  const trimmed = label.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Ask";
  return trimmed.length > 42 ? `${trimmed.slice(0, 39).trimEnd()}...` : trimmed;
}

function normalizeActionPrompt(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.length > 140 ? `${trimmed.slice(0, 137).trimEnd()}...` : trimmed;
}

function normalizeIntent(rawIntent: string | undefined, ctx: NpcDialogueValidationContext): NpcDialogueIntent {
  if (rawIntent && ALLOWED_INTENTS.has(rawIntent as NpcDialogueIntent)) {
    const intent = rawIntent as NpcDialogueIntent;
    if (intent === "offer_quest" && ctx.availableQuestIds.length === 0) return "redirect";
    if (intent === "quest_turn_in" && ctx.completableQuestIds.length === 0) return "quest_progress";
    if (intent === "tutorial" && !ctx.isTutorialNpc) return "redirect";
    if (intent === "quest_progress" && ctx.activeQuestIds.length === 0 && ctx.completableQuestIds.length === 0) {
      return ctx.availableQuestIds.length > 0 ? "offer_quest" : "greeting";
    }
    return intent;
  }

  if (ctx.isTutorialNpc) return "tutorial";
  if (ctx.completableQuestIds.length > 0) return "quest_turn_in";
  if (ctx.activeQuestIds.length > 0) return "quest_progress";
  if (ctx.availableQuestIds.length > 0) return "offer_quest";
  return "greeting";
}

export function validateNpcDialogueDraft(
  draft: NpcDialogueDraft,
  ctx: NpcDialogueValidationContext,
): NpcDialogueValidated {
  const reply = clampReply(draft.reply || "...");
  const intent = normalizeIntent(draft.intent, ctx);

  let referencesQuestId: string | undefined;
  const rawQuestId = draft.referencesQuestId?.trim();
  if (rawQuestId) {
    const allowedQuestIds = new Set([
      ...ctx.availableQuestIds,
      ...ctx.activeQuestIds,
      ...ctx.completableQuestIds,
    ]);
    if (allowedQuestIds.has(rawQuestId)) {
      referencesQuestId = rawQuestId;
    }
  }

  const suggestedActions = (draft.suggestedActions ?? [])
    .map((action) => ({
      label: normalizeActionLabel(action.label ?? ""),
      prompt: normalizeActionPrompt(action.prompt ?? ""),
    }))
    .filter((action) => action.prompt.length > 0)
    .slice(0, 3);

  return {
    reply,
    intent,
    ...(referencesQuestId ? { referencesQuestId } : {}),
    suggestedActions,
  };
}
