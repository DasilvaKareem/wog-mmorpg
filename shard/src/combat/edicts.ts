// ── Edicts: FF12-style Gambit rules for AI champion automation ──────
//
// Evaluated top-to-bottom each combat tick. First match wins.
// If no edict matches, existing pickTechnique() AI takes over.

// ── Condition model ─────────────────────────────────────────────────

export type EdictSubject = "self" | "target" | "ally_lowest_hp";

export type EdictOperator =
  | "lt" | "gt" | "gte" | "eq"     // numeric comparisons
  | "has" | "not_has"               // effect presence
  | "is";                           // type/class checks

export type EdictConditionField =
  | "hp_pct"            // (hp / maxHp) * 100
  | "essence_pct"       // (essence / maxEssence) * 100
  | "type"              // "mob" | "boss" | "player"
  | "active_effect"     // "buff" | "debuff" | "dot" | "shield"
  | "effect_from_self"  // "debuff" | "dot" — cast by this entity
  | "nearby_enemies"    // count within 70 units
  | "always";           // unconditional (catch-all)

export interface EdictCondition {
  subject: EdictSubject;
  field: EdictConditionField;
  operator: EdictOperator;
  value: number | string | boolean;
}

// ── Action model ────────────────────────────────────────────────────

export type EdictActionType =
  | "use_technique"     // cast a specific learned technique
  | "attack"            // basic auto-attack
  | "prefer_target"     // override target selection
  | "flee"              // disengage, move away
  | "skip";             // do nothing this tick

export type EdictTargetPreference = "nearest" | "weakest" | "strongest" | "boss";

export interface EdictAction {
  type: EdictActionType;
  techniqueId?: string;                         // for use_technique
  targetPreference?: EdictTargetPreference;     // for prefer_target
}

// ── Complete Edict rule ─────────────────────────────────────────────

export interface Edict {
  id: string;                   // client-generated uuid
  name: string;                 // human-readable label
  enabled: boolean;
  conditions: EdictCondition[]; // ALL must be true (AND logic)
  action: EdictAction;
}

// ── Constraints ─────────────────────────────────────────────────────

export const MAX_EDICTS = 12;
export const MAX_CONDITIONS_PER_EDICT = 3;

// ── Validation ──────────────────────────────────────────────────────

const VALID_FIELDS: Set<string> = new Set<EdictConditionField>([
  "hp_pct", "essence_pct", "type", "active_effect",
  "effect_from_self", "nearby_enemies", "always",
]);

const VALID_OPERATORS: Set<string> = new Set<EdictOperator>([
  "lt", "gt", "gte", "eq", "has", "not_has", "is",
]);

const VALID_SUBJECTS: Set<string> = new Set<EdictSubject>([
  "self", "target", "ally_lowest_hp",
]);

const VALID_ACTION_TYPES: Set<string> = new Set<EdictActionType>([
  "use_technique", "attack", "prefer_target", "flee", "skip",
]);

export function validateEdicts(edicts: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(edicts)) return { valid: false, error: "edicts must be an array" };
  if (edicts.length > MAX_EDICTS) return { valid: false, error: `max ${MAX_EDICTS} edicts` };

  for (let i = 0; i < edicts.length; i++) {
    const e = edicts[i] as Record<string, unknown>;
    if (!e || typeof e !== "object") return { valid: false, error: `edict[${i}] must be an object` };
    if (typeof e.id !== "string") return { valid: false, error: `edict[${i}].id must be a string` };
    if (typeof e.name !== "string") return { valid: false, error: `edict[${i}].name must be a string` };
    if (typeof e.enabled !== "boolean") return { valid: false, error: `edict[${i}].enabled must be boolean` };

    const conditions = e.conditions;
    if (!Array.isArray(conditions)) return { valid: false, error: `edict[${i}].conditions must be an array` };
    if (conditions.length > MAX_CONDITIONS_PER_EDICT) return { valid: false, error: `edict[${i}] max ${MAX_CONDITIONS_PER_EDICT} conditions` };

    for (let j = 0; j < conditions.length; j++) {
      const c = conditions[j] as Record<string, unknown>;
      if (!VALID_SUBJECTS.has(c.subject as string)) return { valid: false, error: `edict[${i}].conditions[${j}].subject invalid` };
      if (!VALID_FIELDS.has(c.field as string)) return { valid: false, error: `edict[${i}].conditions[${j}].field invalid` };
      if (!VALID_OPERATORS.has(c.operator as string)) return { valid: false, error: `edict[${i}].conditions[${j}].operator invalid` };
    }

    const action = e.action as Record<string, unknown>;
    if (!action || typeof action !== "object") return { valid: false, error: `edict[${i}].action must be an object` };
    if (!VALID_ACTION_TYPES.has(action.type as string)) return { valid: false, error: `edict[${i}].action.type invalid` };
    if (action.type === "use_technique" && typeof action.techniqueId !== "string") {
      return { valid: false, error: `edict[${i}].action.techniqueId required for use_technique` };
    }
  }

  return { valid: true };
}
