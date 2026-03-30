import * as React from "react";

import type { DialogueEffect, DialogueNode, DialogueScript } from "@/dialogue/types";

interface UseDialogueRunnerOptions {
  onEffects?: (effects: DialogueEffect[]) => void;
  onClose?: () => void;
}

interface DialogueHistoryEntry {
  nodeId: string;
  speaker: DialogueNode["speaker"];
  text: string;
}

export function useDialogueRunner(
  script: DialogueScript | null,
  options?: UseDialogueRunnerOptions,
): {
  node: DialogueNode | null;
  history: DialogueHistoryEntry[];
  advance: () => void;
  choose: (choiceId: string) => void;
} {
  const [currentNodeId, setCurrentNodeId] = React.useState<string | null>(script?.start ?? null);
  const [history, setHistory] = React.useState<DialogueHistoryEntry[]>([]);

  React.useEffect(() => {
    setCurrentNodeId(script?.start ?? null);
    setHistory([]);
  }, [script]);

  const goTo = React.useCallback((nodeId: string | null | undefined) => {
    if (!script || !nodeId) {
      options?.onClose?.();
      return;
    }
    if (!script.nodes[nodeId]) {
      options?.onClose?.();
      return;
    }
    setCurrentNodeId(nodeId);
  }, [options, script]);

  const node = React.useMemo(
    () => (script && currentNodeId ? script.nodes[currentNodeId] ?? null : null),
    [currentNodeId, script],
  );

  React.useEffect(() => {
    if (!node) return;
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last?.nodeId === node.id) return prev;
      return [...prev, { nodeId: node.id, speaker: node.speaker, text: node.text }];
    });
  }, [node]);

  const advance = React.useCallback(() => {
    if (!node || node.choices?.length) return;
    goTo(node.next);
  }, [goTo, node]);

  const choose = React.useCallback((choiceId: string) => {
    if (!node?.choices) return;
    const choice = node.choices.find((item) => item.id === choiceId);
    if (!choice || choice.disabled) return;
    if (choice.effects?.length) {
      options?.onEffects?.(choice.effects);
    }
    goTo(choice.next ?? node.next);
  }, [goTo, node, options]);

  return { node, history, advance, choose };
}
