import type {
  AuthoredTalkQuestSceneConfig,
  KaelaBriefingSceneConfig,
  MarcusOnboardingSceneConfig,
  MarcusWelcomeTourSceneConfig,
  StagedContractsSceneConfig,
} from "../builders/authoredQuestSceneBuilders.js";

export interface AuthoredQuestArcMeta {
  id: string;
  title: string;
  summary: string;
  zoneIds: string[];
  tags: string[];
  startingSceneId: string;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[questGraphs] ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string, label: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[questGraphs] ${label}.${key} must be a non-empty string`);
  }
  return value;
}

function readStringArray(source: Record<string, unknown>, key: string, label: string): string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new Error(`[questGraphs] ${label}.${key} must be an array of non-empty strings`);
  }
  return [...value];
}

function readObject(source: Record<string, unknown>, key: string, label: string): Record<string, unknown> {
  return assertRecord(source[key], `${label}.${key}`);
}

function readObjectArray(source: Record<string, unknown>, key: string, label: string): Record<string, unknown>[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new Error(`[questGraphs] ${label}.${key} must be an array`);
  }
  return value.map((entry, index) => assertRecord(entry, `${label}.${key}[${index}]`));
}

export function parseAuthoredQuestArcMeta(input: unknown, label: string): AuthoredQuestArcMeta {
  const source = assertRecord(input, label);
  return {
    id: readString(source, "id", label),
    title: readString(source, "title", label),
    summary: readString(source, "summary", label),
    zoneIds: readStringArray(source, "zoneIds", label),
    tags: readStringArray(source, "tags", label),
    startingSceneId: readString(source, "startingSceneId", label),
  };
}

export function parseKaelaBriefingSceneConfig(input: unknown, label: string): KaelaBriefingSceneConfig {
  const source = assertRecord(input, label);
  return {
    sceneId: readString(source, "sceneId", label),
    npcName: readString(source, "npcName", label),
    title: readString(source, "title", label),
    briefingFlag: readString(source, "briefingFlag", label),
    introLines: readStringArray(source, "introLines", label),
    readyPrompt: readString(source, "readyPrompt", label),
    readyLabel: readString(source, "readyLabel", label),
    repeatLabel: readString(source, "repeatLabel", label),
    completionText: readString(source, "completionText", label),
    alreadyBriefedText: readString(source, "alreadyBriefedText", label),
  };
}

export function parseMarcusOnboardingSceneConfig(input: unknown, label: string): MarcusOnboardingSceneConfig {
  const source = assertRecord(input, label);
  return {
    sceneId: readString(source, "sceneId", label),
    npcName: readString(source, "npcName", label),
    title: readString(source, "title", label),
    requiredFlag: readString(source, "requiredFlag", label),
    welcomeQuestId: readString(source, "welcomeQuestId", label),
    blockedText: readString(source, "blockedText", label),
    introText: readString(source, "introText", label),
    optionsPrompt: readString(source, "optionsPrompt", label),
    acceptLabel: readString(source, "acceptLabel", label),
    contextLabel: readString(source, "contextLabel", label),
    freeformLabel: readString(source, "freeformLabel", label),
    declineLabel: readString(source, "declineLabel", label),
    hintText: readString(source, "hintText", label),
    freeformText: readString(source, "freeformText", label),
    freeformPrompt: readString(source, "freeformPrompt", label),
    freeformPlaceholder: readString(source, "freeformPlaceholder", label),
    freeformFallback: readString(source, "freeformFallback", label),
    acceptedText: readString(source, "acceptedText", label),
    declineText: readString(source, "declineText", label),
    zoneEventMessage: readString(source, "zoneEventMessage", label),
  };
}

export function parseMarcusWelcomeTourSceneConfig(input: unknown, label: string): MarcusWelcomeTourSceneConfig {
  const source = assertRecord(input, label);
  return {
    sceneId: readString(source, "sceneId", label),
    npcName: readString(source, "npcName", label),
    title: readString(source, "title", label),
    welcomeQuestId: readString(source, "welcomeQuestId", label),
    finalQuestId: readString(source, "finalQuestId", label),
    welcomeActiveText: readString(source, "welcomeActiveText", label),
    welcomeContextText: readString(source, "welcomeContextText", label),
    welcomeCompleteText: readString(source, "welcomeCompleteText", label),
    betweenAssignmentsText: readString(source, "betweenAssignmentsText", label),
    finalOfferText: readString(source, "finalOfferText", label),
    finalDetailsText: readString(source, "finalDetailsText", label),
    finalFreeformText: readString(source, "finalFreeformText", label),
    finalFreeformPrompt: readString(source, "finalFreeformPrompt", label),
    finalFreeformPlaceholder: readString(source, "finalFreeformPlaceholder", label),
    finalFreeformFallback: readString(source, "finalFreeformFallback", label),
    finalActiveText: readString(source, "finalActiveText", label),
    finalWaitText: readString(source, "finalWaitText", label),
    finalCompleteText: readString(source, "finalCompleteText", label),
    finalRevisitText: readString(source, "finalRevisitText", label),
    idleText: readString(source, "idleText", label),
  };
}

function parseOptionalString(source: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = source[key];
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[questGraphs] ${label}.${key} must be a non-empty string when present`);
  }
  return value;
}

export function parseStagedContractsSceneConfig(input: unknown, label: string): StagedContractsSceneConfig {
  const source = assertRecord(input, label);
  const rawStages = source.stages;
  if (!Array.isArray(rawStages) || rawStages.length === 0) {
    throw new Error(`[questGraphs] ${label}.stages must be a non-empty array`);
  }

  return {
    sceneId: readString(source, "sceneId", label),
    npcName: readString(source, "npcName", label),
    title: readString(source, "title", label),
    idleText: readString(source, "idleText", label),
    stages: rawStages.map((entry, index) => {
      const stage = assertRecord(entry, `${label}.stages[${index}]`);
      const availableSource = stage.available == null ? null : assertRecord(stage.available, `${label}.stages[${index}].available`);
      const activeSource = stage.active == null ? null : assertRecord(stage.active, `${label}.stages[${index}].active`);

      return {
        stageId: readString(stage, "stageId", `${label}.stages[${index}]`),
        questId: readString(stage, "questId", `${label}.stages[${index}]`),
        completedText: parseOptionalString(stage, "completedText", `${label}.stages[${index}]`),
        available: availableSource ? {
          promptText: readString(availableSource, "promptText", `${label}.stages[${index}].available`),
          acceptLabel: readString(availableSource, "acceptLabel", `${label}.stages[${index}].available`),
          acceptedText: readString(availableSource, "acceptedText", `${label}.stages[${index}].available`),
          effectType: readString(availableSource, "effectType", `${label}.stages[${index}].available`) as "start_quest" | "complete_quest",
          detailsLabel: parseOptionalString(availableSource, "detailsLabel", `${label}.stages[${index}].available`),
          detailsText: parseOptionalString(availableSource, "detailsText", `${label}.stages[${index}].available`),
          freeformLabel: parseOptionalString(availableSource, "freeformLabel", `${label}.stages[${index}].available`),
          freeformText: parseOptionalString(availableSource, "freeformText", `${label}.stages[${index}].available`),
          freeformPrompt: parseOptionalString(availableSource, "freeformPrompt", `${label}.stages[${index}].available`),
          freeformPlaceholder: parseOptionalString(availableSource, "freeformPlaceholder", `${label}.stages[${index}].available`),
          freeformFallback: parseOptionalString(availableSource, "freeformFallback", `${label}.stages[${index}].available`),
          declineLabel: parseOptionalString(availableSource, "declineLabel", `${label}.stages[${index}].available`),
          declineText: parseOptionalString(availableSource, "declineText", `${label}.stages[${index}].available`),
          zoneEventMessage: parseOptionalString(availableSource, "zoneEventMessage", `${label}.stages[${index}].available`),
        } : undefined,
        active: activeSource ? {
          promptText: readString(activeSource, "promptText", `${label}.stages[${index}].active`),
          primaryLabel: readString(activeSource, "primaryLabel", `${label}.stages[${index}].active`),
          resultText: readString(activeSource, "resultText", `${label}.stages[${index}].active`),
          resultEffectType: parseOptionalString(activeSource, "resultEffectType", `${label}.stages[${index}].active`) as "start_quest" | "complete_quest" | undefined,
          secondaryLabel: parseOptionalString(activeSource, "secondaryLabel", `${label}.stages[${index}].active`),
          secondaryText: parseOptionalString(activeSource, "secondaryText", `${label}.stages[${index}].active`),
          declineLabel: parseOptionalString(activeSource, "declineLabel", `${label}.stages[${index}].active`),
          declineText: parseOptionalString(activeSource, "declineText", `${label}.stages[${index}].active`),
        } : undefined,
      };
    }),
  };
}

export function parseAuthoredTalkQuestSceneConfig(input: unknown, label: string): AuthoredTalkQuestSceneConfig {
  const source = assertRecord(input, label);
  return {
    sceneId: readString(source, "sceneId", label),
    npcName: readString(source, "npcName", label),
    title: readString(source, "title", label),
    questId: readString(source, "questId", label),
    introLine: readString(source, "introLine", label),
    detailLine: readString(source, "detailLine", label),
    freeformText: readString(source, "freeformText", label),
    freeformPrompt: readString(source, "freeformPrompt", label),
    freeformPlaceholder: readString(source, "freeformPlaceholder", label),
    freeformFallback: readString(source, "freeformFallback", label),
    completionLine: readString(source, "completionLine", label),
    revisitLine: readString(source, "revisitLine", label),
    idleLine: readString(source, "idleLine", label),
  };
}

export function parseAuthoredTalkQuestSceneConfigArray(input: unknown, label: string): AuthoredTalkQuestSceneConfig[] {
  const source = assertRecord({ scenes: input }, label);
  return readObjectArray(source, "scenes", label).map((entry, index) =>
    parseAuthoredTalkQuestSceneConfig(entry, `${label}[${index}]`),
  );
}

export function loadOnboardingJsonContent(input: unknown): {
  meta: AuthoredQuestArcMeta;
  kaelaBriefingScene: KaelaBriefingSceneConfig;
  marcusOnboardingScene: MarcusOnboardingSceneConfig;
} {
  const source = assertRecord(input, "villageSquareOnboarding");
  return {
    meta: parseAuthoredQuestArcMeta(readObject(source, "meta", "villageSquareOnboarding"), "villageSquareOnboarding.meta"),
    kaelaBriefingScene: parseKaelaBriefingSceneConfig(
      readObject(source, "kaelaBriefingScene", "villageSquareOnboarding"),
      "villageSquareOnboarding.kaelaBriefingScene",
    ),
    marcusOnboardingScene: parseMarcusOnboardingSceneConfig(
      readObject(source, "marcusOnboardingScene", "villageSquareOnboarding"),
      "villageSquareOnboarding.marcusOnboardingScene",
    ),
  };
}

export function loadWelcomeTourJsonContent(input: unknown): {
  meta: AuthoredQuestArcMeta;
  marcusScene: MarcusWelcomeTourSceneConfig;
  talkScenes: AuthoredTalkQuestSceneConfig[];
} {
  const source = assertRecord(input, "villageSquareWelcomeTour");
  return {
    meta: parseAuthoredQuestArcMeta(readObject(source, "meta", "villageSquareWelcomeTour"), "villageSquareWelcomeTour.meta"),
    marcusScene: parseMarcusWelcomeTourSceneConfig(
      readObject(source, "marcusScene", "villageSquareWelcomeTour"),
      "villageSquareWelcomeTour.marcusScene",
    ),
    talkScenes: parseAuthoredTalkQuestSceneConfigArray(
      source.talkScenes,
      "villageSquareWelcomeTour.talkScenes",
    ),
  };
}
