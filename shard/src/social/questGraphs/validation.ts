import { QUEST_CATALOG } from "../questSystem.js";
import type {
  QuestArcDefinition,
  QuestGraphCondition,
  QuestGraphEffect,
  QuestGraphNode,
  QuestGraphValidationIssue,
} from "./types.js";

function validateConditionReferences(
  arc: QuestArcDefinition,
  sceneId: string,
  nodeId: string,
  condition: QuestGraphCondition | undefined,
  issues: QuestGraphValidationIssue[],
): void {
  if (!condition) return;

  if (condition.type === "all" || condition.type === "any") {
    for (const entry of condition.conditions) {
      validateConditionReferences(arc, sceneId, nodeId, entry, issues);
    }
    return;
  }

  if (condition.type === "not") {
    validateConditionReferences(arc, sceneId, nodeId, condition.condition, issues);
    return;
  }

  if (
    (
      condition.type === "quest_active"
      || condition.type === "quest_available"
      || condition.type === "quest_completed"
      || condition.type === "quest_ready_to_turn_in"
    )
    && !QUEST_CATALOG.some((quest) => quest.id === condition.questId)
  ) {
    issues.push({
      arcId: arc.id,
      sceneId,
      nodeId,
      message: `Unknown quest reference "${condition.questId}" in condition`,
    });
  }
}

function validateEffectReferences(
  arc: QuestArcDefinition,
  sceneId: string,
  nodeId: string,
  effects: QuestGraphEffect[] | undefined,
  issues: QuestGraphValidationIssue[],
): void {
  for (const effect of effects ?? []) {
    if (
      (effect.type === "start_quest" || effect.type === "complete_quest")
      && !QUEST_CATALOG.some((quest) => quest.id === effect.questId)
    ) {
      issues.push({
        arcId: arc.id,
        sceneId,
        nodeId,
        message: `Unknown quest reference "${effect.questId}" in effect`,
      });
    }
  }
}

function validateNodeLinks(
  arc: QuestArcDefinition,
  sceneId: string,
  node: QuestGraphNode,
  nodes: Record<string, QuestGraphNode>,
  issues: QuestGraphValidationIssue[],
): void {
  const ensureNode = (targetId: string | null | undefined, label: string) => {
    if (!targetId) return;
    if (!nodes[targetId]) {
      issues.push({
        arcId: arc.id,
        sceneId,
        nodeId: node.id,
        message: `${label} references missing node "${targetId}"`,
      });
    }
  };

  if (node.type === "line" || node.type === "effect" || node.type === "choice") {
    ensureNode(node.next, "next");
  }

  if (node.type === "branch") {
    for (const branch of node.branches) {
      validateConditionReferences(arc, sceneId, node.id, branch.condition, issues);
      ensureNode(branch.next, "branch");
    }
    ensureNode(node.fallbackNext, "fallback");
  }

  if (node.type === "choice") {
    for (const choice of node.choices) {
      validateConditionReferences(arc, sceneId, node.id, choice.condition, issues);
      validateEffectReferences(arc, sceneId, node.id, choice.effects, issues);
      ensureNode(choice.next, `choice "${choice.id}"`);
    }
  }

  if (node.type === "effect") {
    validateEffectReferences(arc, sceneId, node.id, node.effects, issues);
  }

  if (node.type === "freeform") {
    for (const route of node.routes) {
      validateConditionReferences(arc, sceneId, node.id, route.condition, issues);
      validateEffectReferences(arc, sceneId, node.id, route.effects, issues);
      ensureNode(route.next, `freeform route "${route.id}"`);
    }
  }
}

export function validateQuestArc(arc: QuestArcDefinition): QuestGraphValidationIssue[] {
  const issues: QuestGraphValidationIssue[] = [];
  const sceneIds = new Set(Object.keys(arc.scenes));

  if (!sceneIds.has(arc.startingSceneId)) {
    issues.push({
      arcId: arc.id,
      message: `Arc startingSceneId "${arc.startingSceneId}" is missing`,
    });
  }

  for (const [sceneId, scene] of Object.entries(arc.scenes)) {
    validateConditionReferences(arc, sceneId, "__scene__", scene.entryCondition, issues);

    if (!scene.nodes[scene.startNodeId]) {
      issues.push({
        arcId: arc.id,
        sceneId,
        message: `Scene startNodeId "${scene.startNodeId}" is missing`,
      });
    }

    for (const node of Object.values(scene.nodes)) {
      validateNodeLinks(arc, sceneId, node, scene.nodes, issues);
    }
  }

  return issues;
}

export function validateQuestArcCatalog(arcs: QuestArcDefinition[]): QuestGraphValidationIssue[] {
  return arcs.flatMap((arc) => validateQuestArc(arc));
}
