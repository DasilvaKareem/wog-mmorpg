import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/config";

// ── Edict types (mirrored from shard) ───────────────────────────────

export type EdictSubject = "self" | "target" | "ally_lowest_hp";
export type EdictOperator = "lt" | "gt" | "gte" | "eq" | "has" | "not_has" | "is";
export type EdictConditionField =
  | "hp_pct" | "essence_pct" | "type" | "active_effect"
  | "effect_from_self" | "nearby_enemies" | "always";
export type EdictActionType = "use_technique" | "attack" | "prefer_target" | "flee" | "skip";
export type EdictTargetPreference = "nearest" | "weakest" | "strongest" | "boss";

export interface EdictCondition {
  subject: EdictSubject;
  field: EdictConditionField;
  operator: EdictOperator;
  value: number | string | boolean;
}

export interface EdictAction {
  type: EdictActionType;
  techniqueId?: string;
  targetPreference?: EdictTargetPreference;
}

export interface Edict {
  id: string;
  name: string;
  enabled: boolean;
  conditions: EdictCondition[];
  action: EdictAction;
}

// ── Condition/action display labels ─────────────────────────────────

export const CONDITION_LABELS: Record<EdictConditionField, string> = {
  hp_pct: "HP %",
  essence_pct: "Essence %",
  type: "Type",
  active_effect: "Has Effect",
  effect_from_self: "My Effect On Target",
  nearby_enemies: "Nearby Enemies",
  always: "Always",
};

export const SUBJECT_LABELS: Record<EdictSubject, string> = {
  self: "Self",
  target: "Target",
  ally_lowest_hp: "Weakest Ally",
};

export const OPERATOR_LABELS: Record<EdictOperator, string> = {
  lt: "<",
  gt: ">",
  gte: ">=",
  eq: "=",
  has: "has",
  not_has: "missing",
  is: "is",
};

export const ACTION_LABELS: Record<EdictActionType, string> = {
  use_technique: "Use Technique",
  attack: "Attack",
  prefer_target: "Prefer Target",
  flee: "Flee",
  skip: "Skip Turn",
};

// ── Hook ────────────────────────────────────────────────────────────

export function useEdicts(walletAddress: string | null, token: string | null) {
  const [edicts, setEdicts] = useState<Edict[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load edicts on mount / wallet change
  useEffect(() => {
    if (!walletAddress || !token) return;
    setLoading(true);
    fetch(`${API_URL}/agent/edicts/${walletAddress}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => setEdicts(data.edicts ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [walletAddress, token]);

  // Save edicts
  const saveEdicts = useCallback(async (updated: Edict[]) => {
    if (!walletAddress || !token) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/agent/edicts`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ edicts: updated }),
      });
      if (res.ok) {
        setEdicts(updated);
      }
    } finally {
      setSaving(false);
    }
  }, [walletAddress, token]);

  return { edicts, setEdicts, loading, saving, saveEdicts };
}

// ── Helpers ─────────────────────────────────────────────────────────

let _nextId = 0;
export function createEdictId(): string {
  return `edict-${Date.now()}-${++_nextId}`;
}

export function createEmptyEdict(): Edict {
  return {
    id: createEdictId(),
    name: "New Edict",
    enabled: true,
    conditions: [{ subject: "self", field: "always", operator: "eq", value: true }],
    action: { type: "attack" },
  };
}

export function conditionSummary(c: EdictCondition): string {
  if (c.field === "always") return "Always";
  const subj = SUBJECT_LABELS[c.subject] ?? c.subject;
  const field = CONDITION_LABELS[c.field] ?? c.field;
  const op = OPERATOR_LABELS[c.operator] ?? c.operator;
  const val = typeof c.value === "boolean" ? "" : ` ${c.value}`;
  return `${subj} ${field} ${op}${val}`;
}

export function actionSummary(a: EdictAction, techniqueName?: string): string {
  if (a.type === "use_technique") return techniqueName ?? a.techniqueId ?? "???";
  if (a.type === "prefer_target") return `Target ${a.targetPreference ?? "nearest"}`;
  return ACTION_LABELS[a.type] ?? a.type;
}
