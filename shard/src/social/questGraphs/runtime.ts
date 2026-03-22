import type { Entity } from "../../world/zoneRuntime.js";
import { evaluateQuestGraphCondition } from "./conditions.js";
import { applyQuestGraphEffects, type QuestGraphAppliedEffect, type QuestGraphEffectExecutionContext } from "./effects.js";
import { resolveFreeformQuestIntent } from "./freeform.js";
import type {
  QuestArcDefinition,
  QuestGraphChoiceNode,
  QuestGraphFreeformNode,
  QuestGraphNode,
  QuestGraphRenderableNode,
  QuestSceneDefinition,
} from "./types.js";

export interface QuestGraphRuntimeStepResult {
  node: QuestGraphRenderableNode;
  appliedEffects: QuestGraphAppliedEffect[];
  dirty: boolean;
  resolution?: {
    type: "freeform";
    confidence: number;
    matchedRouteId?: string;
    fallbackText?: string;
  };
}

interface QuestGraphRuntimeContext {
  player: Entity;
  scene: QuestSceneDefinition;
  effectContext: QuestGraphEffectExecutionContext;
}

function implicitEndNode(): QuestGraphRenderableNode {
  return {
    id: "__implicit_end__",
    type: "end",
    text: "End of scene.",
  };
}

function renderChoiceNode(node: QuestGraphChoiceNode, player: Entity, npcName: string): QuestGraphRenderableNode {
  const choices = node.choices
    .filter((choice) => evaluateQuestGraphCondition(choice.condition, { player, npcName }))
    .map((choice) => ({
      id: choice.id,
      label: choice.label,
      style: choice.style,
    }));

  return {
    id: node.id,
    type: "choice",
    speaker: node.speaker,
    text: node.text,
    choices,
  };
}

function renderFreeformNode(node: QuestGraphFreeformNode, player: Entity, npcName: string): QuestGraphRenderableNode {
  const routes = node.routes
    .filter((route) => evaluateQuestGraphCondition(route.condition, { player, npcName }))
    .map((route) => ({
      id: route.id,
      label: route.label,
    }));

  return {
    id: node.id,
    type: "freeform",
    speaker: node.speaker,
    text: node.text,
    prompt: node.prompt,
    placeholder: node.placeholder,
    fallbackText: node.fallbackText,
    routes,
  };
}

function renderNode(node: QuestGraphNode, player: Entity, npcName: string): QuestGraphRenderableNode {
  if (node.type === "line") {
    return { id: node.id, type: "line", speaker: node.speaker, text: node.text };
  }
  if (node.type === "choice") {
    return renderChoiceNode(node, player, npcName);
  }
  if (node.type === "freeform") {
    return renderFreeformNode(node, player, npcName);
  }
  if (node.type === "end") {
    return { id: node.id, type: "end", text: node.text };
  }
  return implicitEndNode();
}

async function resolveDisplayableNode(
  startingNodeId: string | null | undefined,
  runtime: QuestGraphRuntimeContext,
): Promise<QuestGraphRuntimeStepResult> {
  let nodeId = startingNodeId;
  let depth = 0;
  const appliedEffects: QuestGraphAppliedEffect[] = [];
  let dirty = false;

  while (nodeId) {
    if (depth > 24) {
      return {
        node: { id: "__error__", type: "end", text: "Quest graph exceeded max traversal depth." },
        appliedEffects,
        dirty,
      };
    }
    depth += 1;

    const node = runtime.scene.nodes[nodeId];
    if (!node) {
      return {
        node: { id: "__missing__", type: "end", text: `Missing node "${nodeId}".` },
        appliedEffects,
        dirty,
      };
    }

    if (node.type === "branch") {
      const branch = node.branches.find((entry) =>
        evaluateQuestGraphCondition(entry.condition, { player: runtime.player, npcName: runtime.scene.npcName }),
      );
      nodeId = branch?.next ?? node.fallbackNext ?? null;
      continue;
    }

    if (node.type === "effect") {
      const effectResult = await applyQuestGraphEffects(node.effects, runtime.effectContext);
      appliedEffects.push(...effectResult.appliedEffects);
      dirty ||= effectResult.dirty;
      nodeId = node.next ?? null;
      continue;
    }

    return {
      node: renderNode(node, runtime.player, runtime.scene.npcName),
      appliedEffects,
      dirty,
    };
  }

  return {
    node: implicitEndNode(),
    appliedEffects,
    dirty,
  };
}

function getSceneOrThrow(arc: QuestArcDefinition, sceneId: string): QuestSceneDefinition {
  const scene = arc.scenes[sceneId];
  if (!scene) {
    throw new Error(`Unknown scene "${sceneId}" in arc "${arc.id}"`);
  }
  return scene;
}

export async function startQuestGraphScene(
  arc: QuestArcDefinition,
  sceneId: string,
  effectContext: QuestGraphEffectExecutionContext,
): Promise<QuestGraphRuntimeStepResult> {
  const scene = getSceneOrThrow(arc, sceneId);
  if (!evaluateQuestGraphCondition(scene.entryCondition, { player: effectContext.player, npcName: scene.npcName })) {
    return {
      node: {
        id: "__entry_blocked__",
        type: "end",
        text: "This scene is not currently available for the player.",
      },
      appliedEffects: [],
      dirty: false,
    };
  }

  return resolveDisplayableNode(scene.startNodeId, {
    player: effectContext.player,
    scene,
    effectContext,
  });
}

export async function advanceQuestGraphScene(
  arc: QuestArcDefinition,
  sceneId: string,
  nodeId: string,
  input: { choiceId?: string; freeformInput?: string },
  effectContext: QuestGraphEffectExecutionContext,
): Promise<QuestGraphRuntimeStepResult> {
  const scene = getSceneOrThrow(arc, sceneId);
  const node = scene.nodes[nodeId];
  if (!node) {
    return {
      node: { id: "__missing__", type: "end", text: `Missing node "${nodeId}".` },
      appliedEffects: [],
      dirty: false,
    };
  }

  if (node.type === "line") {
    return resolveDisplayableNode(node.next ?? null, {
      player: effectContext.player,
      scene,
      effectContext,
    });
  }

  if (node.type === "choice") {
    const choice = node.choices.find((entry) => entry.id === input.choiceId);
    if (!choice) {
      return {
        node: renderNode(node, effectContext.player, scene.npcName),
        appliedEffects: [],
        dirty: false,
      };
    }
    if (!evaluateQuestGraphCondition(choice.condition, { player: effectContext.player, npcName: scene.npcName })) {
      return {
        node: renderNode(node, effectContext.player, scene.npcName),
        appliedEffects: [],
        dirty: false,
      };
    }

    const effectResult = await applyQuestGraphEffects(choice.effects, effectContext);
    const nextStep = await resolveDisplayableNode(choice.next ?? node.next ?? null, {
      player: effectContext.player,
      scene,
      effectContext,
    });
    return {
      node: nextStep.node,
      appliedEffects: [...effectResult.appliedEffects, ...nextStep.appliedEffects],
      dirty: effectResult.dirty || nextStep.dirty,
    };
  }

  if (node.type === "freeform") {
    const allowedRoutes = node.routes.filter((route) =>
      evaluateQuestGraphCondition(route.condition, { player: effectContext.player, npcName: scene.npcName }),
    );
    const resolution = resolveFreeformQuestIntent(input.freeformInput ?? "", allowedRoutes);

    if (!resolution.route) {
      return {
        node: renderNode(node, effectContext.player, scene.npcName),
        appliedEffects: [],
        dirty: false,
        resolution: {
          type: "freeform",
          confidence: resolution.confidence,
          fallbackText: node.fallbackText,
        },
      };
    }

    const effectResult = await applyQuestGraphEffects(resolution.route.effects, effectContext);
    const nextStep = await resolveDisplayableNode(resolution.route.next ?? null, {
      player: effectContext.player,
      scene,
      effectContext,
    });
    return {
      node: nextStep.node,
      appliedEffects: [...effectResult.appliedEffects, ...nextStep.appliedEffects],
      dirty: effectResult.dirty || nextStep.dirty,
      resolution: {
        type: "freeform",
        confidence: resolution.confidence,
        matchedRouteId: resolution.route.id,
      },
    };
  }

  if (node.type === "end") {
    return {
      node: renderNode(node, effectContext.player, scene.npcName),
      appliedEffects: [],
      dirty: false,
    };
  }

  return {
    node: renderNode(node, effectContext.player, scene.npcName),
    appliedEffects: [],
    dirty: false,
  };
}
