import { loadAuthoredQuestArcsFromJson } from "./data/authoredArcLoader.js";
import { generatedQuestGiverArcs } from "./arcs/generatedQuestGiverArcs.js";
import { validateQuestArcCatalog } from "./validation.js";
import type { QuestArcDefinition, QuestGraphValidationIssue } from "./types.js";

const AUTHORED_QUEST_ARCS = loadAuthoredQuestArcsFromJson();

export const QUEST_ARC_CATALOG: QuestArcDefinition[] = [
  ...AUTHORED_QUEST_ARCS,
  ...generatedQuestGiverArcs,
];

export const QUEST_ARC_VALIDATION_ISSUES: QuestGraphValidationIssue[] = validateQuestArcCatalog(QUEST_ARC_CATALOG);

export function listQuestArcs(): QuestArcDefinition[] {
  return QUEST_ARC_CATALOG;
}

export function listQuestArcSummaries(): Array<{
  id: string;
  title: string;
  summary: string;
  zoneIds: string[];
  tags: string[];
  startingSceneId: string;
  sceneCount: number;
}> {
  return QUEST_ARC_CATALOG.map((arc) => ({
    id: arc.id,
    title: arc.title,
    summary: arc.summary,
    zoneIds: arc.zoneIds,
    tags: arc.tags,
    startingSceneId: arc.startingSceneId,
    sceneCount: Object.keys(arc.scenes).length,
  }));
}

export function getQuestArcById(arcId: string): QuestArcDefinition | undefined {
  return QUEST_ARC_CATALOG.find((arc) => arc.id === arcId);
}
