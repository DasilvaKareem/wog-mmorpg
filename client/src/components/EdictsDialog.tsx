/**
 * EdictsDialog — FF12 Gambit-style rule builder for AI champion automation.
 * Priority-ordered IF/THEN rules evaluated top-to-bottom each combat tick.
 */
import * as React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  type Edict, type EdictCondition, type EdictAction,
  type EdictConditionField, type EdictSubject, type EdictOperator,
  type EdictActionType, type EdictTargetPreference,
  CONDITION_LABELS, SUBJECT_LABELS, OPERATOR_LABELS, ACTION_LABELS,
  conditionSummary, actionSummary,
  createEdictId, createEmptyEdict,
  useEdicts,
} from "@/hooks/useEdicts";
import { useTechniques, type TechniqueInfo } from "@/hooks/useTechniques";

// ── Presets ─────────────────────────────────────────────────────────

function makeDpsPreset(techs: TechniqueInfo[], classId: string): Edict[] {
  const classTechs = techs.filter(t => t.className === classId);
  const buff = classTechs.find(t => t.type === "buff" && t.targetType === "self");
  const heal = classTechs.find(t => t.type === "healing");
  const debuff = classTechs.find(t => t.type === "debuff");
  const aoe = classTechs.find(t => t.type === "attack" && (t.targetType === "area" || (t.effects as Record<string, unknown>).maxTargets));
  const edicts: Edict[] = [];
  if (heal) edicts.push({ id: createEdictId(), name: "Emergency heal", enabled: true,
    conditions: [{ subject: "self", field: "hp_pct", operator: "lt", value: 25 }],
    action: { type: "use_technique", techniqueId: heal.id } });
  if (buff) edicts.push({ id: createEdictId(), name: "Self-buff", enabled: true,
    conditions: [{ subject: "self", field: "active_effect", operator: "not_has", value: "buff" }],
    action: { type: "use_technique", techniqueId: buff.id } });
  if (debuff) edicts.push({ id: createEdictId(), name: "Debuff target", enabled: true,
    conditions: [{ subject: "target", field: "effect_from_self", operator: "not_has", value: "debuff" }],
    action: { type: "use_technique", techniqueId: debuff.id } });
  if (aoe) edicts.push({ id: createEdictId(), name: "AoE when 3+ enemies", enabled: true,
    conditions: [{ subject: "self", field: "nearby_enemies", operator: "gte", value: 3 }],
    action: { type: "use_technique", techniqueId: aoe.id } });
  edicts.push({ id: createEdictId(), name: "Attack", enabled: true,
    conditions: [{ subject: "self", field: "always", operator: "eq", value: true }],
    action: { type: "attack" } });
  return edicts;
}

function makeHealerPreset(techs: TechniqueInfo[], classId: string): Edict[] {
  const classTechs = techs.filter(t => t.className === classId);
  const selfHeal = classTechs.find(t => t.type === "healing" && (t.targetType === "self" || t.targetType === "ally"));
  const partyHeal = classTechs.find(t => t.type === "healing" && t.targetType === "party") ?? selfHeal;
  const buff = classTechs.find(t => t.type === "buff");
  const edicts: Edict[] = [];
  if (selfHeal) edicts.push({ id: createEdictId(), name: "Emergency self-heal", enabled: true,
    conditions: [{ subject: "self", field: "hp_pct", operator: "lt", value: 30 }],
    action: { type: "use_technique", techniqueId: selfHeal.id } });
  if (partyHeal) {
    edicts.push({ id: createEdictId(), name: "Heal ally < 50%", enabled: true,
      conditions: [{ subject: "ally_lowest_hp", field: "hp_pct", operator: "lt", value: 50 }],
      action: { type: "use_technique", techniqueId: partyHeal.id } });
    edicts.push({ id: createEdictId(), name: "Heal ally < 80%", enabled: true,
      conditions: [{ subject: "ally_lowest_hp", field: "hp_pct", operator: "lt", value: 80 }],
      action: { type: "use_technique", techniqueId: partyHeal.id } });
  }
  if (buff) edicts.push({ id: createEdictId(), name: "Buff", enabled: true,
    conditions: [{ subject: "self", field: "active_effect", operator: "not_has", value: "buff" }],
    action: { type: "use_technique", techniqueId: buff.id } });
  edicts.push({ id: createEdictId(), name: "Attack", enabled: true,
    conditions: [{ subject: "self", field: "always", operator: "eq", value: true }],
    action: { type: "attack" } });
  return edicts;
}

function makeTankPreset(techs: TechniqueInfo[], classId: string): Edict[] {
  const classTechs = techs.filter(t => t.className === classId);
  const defBuff = classTechs.find(t => t.type === "buff" && t.targetType === "self" && JSON.stringify(t.effects).includes("def"));
  const heal = classTechs.find(t => t.type === "healing");
  const debuff = classTechs.find(t => t.type === "debuff");
  const anyBuff = defBuff ?? classTechs.find(t => t.type === "buff" && t.targetType === "self");
  const edicts: Edict[] = [];
  if (anyBuff) edicts.push({ id: createEdictId(), name: "Shield when critical", enabled: true,
    conditions: [
      { subject: "self", field: "hp_pct", operator: "lt", value: 35 },
      { subject: "self", field: "active_effect", operator: "not_has", value: "buff" },
    ],
    action: { type: "use_technique", techniqueId: anyBuff.id } });
  if (heal) edicts.push({ id: createEdictId(), name: "Self-heal when hurt", enabled: true,
    conditions: [{ subject: "self", field: "hp_pct", operator: "lt", value: 50 }],
    action: { type: "use_technique", techniqueId: heal.id } });
  if (debuff) edicts.push({ id: createEdictId(), name: "Debuff boss", enabled: true,
    conditions: [
      { subject: "target", field: "type", operator: "is", value: "boss" },
      { subject: "target", field: "effect_from_self", operator: "not_has", value: "debuff" },
    ],
    action: { type: "use_technique", techniqueId: debuff.id } });
  edicts.push({ id: createEdictId(), name: "Focus bosses", enabled: true,
    conditions: [{ subject: "target", field: "type", operator: "is", value: "boss" }],
    action: { type: "prefer_target", targetPreference: "boss" } });
  edicts.push({ id: createEdictId(), name: "Attack", enabled: true,
    conditions: [{ subject: "self", field: "always", operator: "eq", value: true }],
    action: { type: "attack" } });
  return edicts;
}

// ── Props ───────────────────────────────────────────────────────────

interface EdictsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string | null;
  token: string | null;
  classId?: string;
  learnedTechniqueIds?: string[];
}

// ── Component ───────────────────────────────────────────────────────

export function EdictsDialog({
  open, onOpenChange, walletAddress, token, classId, learnedTechniqueIds,
}: EdictsDialogProps) {
  const { edicts, setEdicts, loading, saving, saveEdicts } = useEdicts(walletAddress, token);
  const { techniques, getTechnique } = useTechniques();
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null);
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);

  // Filter techniques to what the character has learned
  const learnedTechs = React.useMemo(() => {
    if (!learnedTechniqueIds) return techniques.filter(t => t.className === classId);
    const ids = new Set(learnedTechniqueIds);
    return techniques.filter(t => ids.has(t.id));
  }, [techniques, classId, learnedTechniqueIds]);

  const handleSave = () => { void saveEdicts(edicts); };

  const addEdict = () => {
    if (edicts.length >= 12) return;
    setEdicts([...edicts, createEmptyEdict()]);
    setEditingIdx(edicts.length);
  };

  const removeEdict = (idx: number) => {
    setEdicts(edicts.filter((_, i) => i !== idx));
    setEditingIdx(null);
  };

  const toggleEdict = (idx: number) => {
    const updated = [...edicts];
    updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled };
    setEdicts(updated);
  };

  const updateEdict = (idx: number, patch: Partial<Edict>) => {
    const updated = [...edicts];
    updated[idx] = { ...updated[idx], ...patch };
    setEdicts(updated);
  };

  const applyPreset = (preset: "dps" | "healer" | "tank") => {
    const cid = classId ?? "warrior";
    switch (preset) {
      case "dps": setEdicts(makeDpsPreset(techniques, cid)); break;
      case "healer": setEdicts(makeHealerPreset(techniques, cid)); break;
      case "tank": setEdicts(makeTankPreset(techniques, cid)); break;
    }
    setEditingIdx(null);
  };

  // ── Drag-and-drop reorder ─────────────────────────────────────────
  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...edicts];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setEdicts(reordered);
    setDragIdx(idx);
  };
  const onDragEnd = () => setDragIdx(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Edicts</DialogTitle>
            <div className="flex gap-1">
              {(["dps", "healer", "tank"] as const).map(p => (
                <button key={p} type="button"
                  onClick={() => applyPreset(p)}
                  className="border border-[#2d3651] bg-[#1b2236] px-2 py-0.5 text-[8px] uppercase text-[#9aa7cc] hover:text-[#ffdd57] hover:border-[#ffdd57]"
                >{p}</button>
              ))}
            </div>
          </div>
          <DialogDescription>
            Priority rules for your champion. First match wins — drag to reorder.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-[9px] text-[#6b7394]">Loading...</div>
        ) : (
          <div className="max-h-[55dvh] overflow-y-auto space-y-1.5 pr-1">
            {edicts.map((edict, idx) => (
              <div
                key={edict.id}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                className={`flex flex-col border-2 ${
                  edict.enabled ? "border-l-4 border-l-[#54f28b] border-[#2d3651]" : "border-[#1e2740] opacity-50"
                } bg-[#1b2236] ${dragIdx === idx ? "opacity-60" : ""}`}
              >
                {/* Summary row */}
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span className="cursor-grab text-[10px] text-[#6b7394] select-none">⣿</span>
                  <button type="button" onClick={() => toggleEdict(idx)}
                    className={`h-3 w-3 border ${edict.enabled ? "border-[#54f28b] bg-[#54f28b]" : "border-[#6b7394]"}`}
                  />
                  <button type="button" onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}
                    className="flex-1 text-left min-w-0">
                    <span className="text-[9px] text-[#edf2ff] truncate block">{edict.name}</span>
                    <span className="text-[8px] text-[#6b7394] truncate block">
                      IF {edict.conditions.map(conditionSummary).join(" AND ")}
                      {" → "}
                      <span className="text-[#ffdd57]">{actionSummary(edict.action, getTechnique(edict.action.techniqueId ?? "")?.name)}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => removeEdict(idx)}
                    className="text-[10px] text-[#6b7394] hover:text-[#f25454]">✕</button>
                </div>

                {/* Expanded edit form */}
                {editingIdx === idx && (
                  <EdictEditor
                    edict={edict}
                    techniques={learnedTechs}
                    onChange={(patch) => updateEdict(idx, patch)}
                  />
                )}
              </div>
            ))}

            {edicts.length < 12 && (
              <button type="button" onClick={addEdict}
                className="w-full border-2 border-dashed border-[#2d3651] bg-[#141b2e] py-2 text-[9px] text-[#6b7394] hover:text-[#ffdd57] hover:border-[#ffdd57]">
                + Add Edict
              </button>
            )}

            {edicts.length === 0 && (
              <div className="py-6 text-center text-[9px] text-[#6b7394]">
                No edicts set. Your champion uses default AI.<br />
                Try a preset above or add your own rules.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)}
            className="border-2 border-[#2d3651] bg-[#1b2236] px-3 py-1 text-[9px] uppercase text-[#9aa7cc] hover:text-[#edf2ff]">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="border-2 border-[#ffdd57] bg-[#1b2236] px-3 py-1 text-[9px] uppercase text-[#ffdd57] hover:bg-[#ffdd57] hover:text-[#0a1021] disabled:opacity-40">
            {saving ? "Saving..." : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Inline editor for a single edict ────────────────────────────────

function EdictEditor({
  edict, techniques, onChange,
}: {
  edict: Edict;
  techniques: TechniqueInfo[];
  onChange: (patch: Partial<Edict>) => void;
}) {
  const updateCondition = (ci: number, patch: Partial<EdictCondition>) => {
    const updated = [...edict.conditions];
    updated[ci] = { ...updated[ci], ...patch };
    onChange({ conditions: updated });
  };

  const addCondition = () => {
    if (edict.conditions.length >= 3) return;
    onChange({ conditions: [...edict.conditions, { subject: "self", field: "hp_pct", operator: "lt", value: 50 }] });
  };

  const removeCondition = (ci: number) => {
    onChange({ conditions: edict.conditions.filter((_, i) => i !== ci) });
  };

  const updateAction = (patch: Partial<EdictAction>) => {
    onChange({ action: { ...edict.action, ...patch } });
  };

  return (
    <div className="border-t border-[#2d3651] bg-[#141b2e] px-2 py-2 space-y-2">
      {/* Name */}
      <input
        value={edict.name}
        onChange={e => onChange({ name: e.target.value })}
        className="w-full bg-[#0a1021] border border-[#2d3651] px-1.5 py-0.5 text-[9px] text-[#edf2ff] outline-none focus:border-[#ffdd57]"
        placeholder="Edict name"
      />

      {/* Conditions */}
      <div className="space-y-1">
        <div className="text-[8px] uppercase text-[#6b7394]">If</div>
        {edict.conditions.map((cond, ci) => (
          <div key={ci} className="flex items-center gap-1 flex-wrap">
            <Sel value={cond.subject} onChange={v => updateCondition(ci, { subject: v as EdictSubject })}
              options={Object.entries(SUBJECT_LABELS)} />
            <Sel value={cond.field} onChange={v => {
              const defaults: Record<string, Partial<EdictCondition>> = {
                hp_pct: { operator: "lt", value: 40 },
                essence_pct: { operator: "lt", value: 30 },
                type: { operator: "is", value: "boss" },
                active_effect: { operator: "not_has", value: "buff" },
                effect_from_self: { operator: "not_has", value: "debuff" },
                nearby_enemies: { operator: "gte", value: 3 },
                always: { operator: "eq", value: true },
              };
              updateCondition(ci, { field: v as EdictConditionField, ...(defaults[v] ?? {}) });
            }} options={Object.entries(CONDITION_LABELS)} />
            {cond.field !== "always" && (
              <>
                <Sel value={cond.operator} onChange={v => updateCondition(ci, { operator: v as EdictOperator })}
                  options={getOperatorsForField(cond.field).map(o => [o, OPERATOR_LABELS[o]])} />
                {needsNumericValue(cond.field) ? (
                  <input type="number" value={cond.value as number}
                    onChange={e => updateCondition(ci, { value: Number(e.target.value) })}
                    className="w-10 bg-[#0a1021] border border-[#2d3651] px-1 py-0.5 text-[9px] text-[#edf2ff] outline-none text-center" />
                ) : (
                  <Sel value={String(cond.value)}
                    onChange={v => updateCondition(ci, { value: v })}
                    options={getValueOptionsForField(cond.field)} />
                )}
              </>
            )}
            {edict.conditions.length > 1 && (
              <button type="button" onClick={() => removeCondition(ci)}
                className="text-[9px] text-[#6b7394] hover:text-[#f25454]">✕</button>
            )}
          </div>
        ))}
        {edict.conditions.length < 3 && (
          <button type="button" onClick={addCondition}
            className="text-[8px] text-[#6b7394] hover:text-[#ffdd57]">+ AND</button>
        )}
      </div>

      {/* Action */}
      <div className="space-y-1">
        <div className="text-[8px] uppercase text-[#6b7394]">Then</div>
        <div className="flex items-center gap-1 flex-wrap">
          <Sel value={edict.action.type}
            onChange={v => updateAction({ type: v as EdictActionType, techniqueId: undefined, targetPreference: undefined })}
            options={Object.entries(ACTION_LABELS)} />
          {edict.action.type === "use_technique" && (
            <Sel value={edict.action.techniqueId ?? ""}
              onChange={v => updateAction({ techniqueId: v })}
              options={techniques.map(t => [t.id, `${t.name} (${t.type})`])} />
          )}
          {edict.action.type === "prefer_target" && (
            <Sel value={edict.action.targetPreference ?? "nearest"}
              onChange={v => updateAction({ targetPreference: v as EdictTargetPreference })}
              options={[["nearest", "Nearest"], ["weakest", "Weakest"], ["strongest", "Strongest"], ["boss", "Boss"]]} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tiny select helper ──────────────────────────────────────────────

function Sel({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="bg-[#0a1021] border border-[#2d3651] px-1 py-0.5 text-[9px] text-[#edf2ff] outline-none focus:border-[#ffdd57] max-w-[140px]">
      {options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );
}

// ── Field helpers ───────────────────────────────────────────────────

function getOperatorsForField(field: EdictConditionField): EdictOperator[] {
  switch (field) {
    case "hp_pct": case "essence_pct": case "nearby_enemies":
      return ["lt", "gt", "gte", "eq"];
    case "type":
      return ["is"];
    case "active_effect": case "effect_from_self":
      return ["has", "not_has"];
    default:
      return ["eq"];
  }
}

function needsNumericValue(field: EdictConditionField): boolean {
  return field === "hp_pct" || field === "essence_pct" || field === "nearby_enemies";
}

function getValueOptionsForField(field: EdictConditionField): [string, string][] {
  switch (field) {
    case "type":
      return [["mob", "Mob"], ["boss", "Boss"], ["player", "Player"]];
    case "active_effect":
      return [["buff", "Buff"], ["debuff", "Debuff"], ["dot", "DoT"], ["shield", "Shield"]];
    case "effect_from_self":
      return [["debuff", "Debuff"], ["dot", "DoT"]];
    default:
      return [];
  }
}
