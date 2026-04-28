import type { LearnedTechnique } from "./LearnedTechniquesList.js";

// ── Types mirrored from shard/src/combat/edicts.ts ──────────────────

export type EdictSubject = "self" | "target" | "ally_lowest_hp" | "leader" | "leader_target";
export type EdictOperator = "lt" | "gt" | "gte" | "eq" | "has" | "not_has" | "is";
export type EdictConditionField =
  | "hp_pct" | "essence_pct" | "type" | "active_effect"
  | "effect_from_self" | "nearby_enemies" | "always";
export type EdictActionType =
  | "use_technique" | "best_technique" | "attack" | "prefer_target" | "flee" | "skip";
export type EdictTargetPreference =
  | "nearest" | "weakest" | "strongest" | "boss" | "leader_target" | "party_tagged";

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

export const MAX_EDICTS = 12;
export const MAX_CONDITIONS_PER_EDICT = 3;

// ── Display labels ──────────────────────────────────────────────────

const SUBJECT_LABELS: Record<EdictSubject, string> = {
  self: "Self",
  target: "Target",
  ally_lowest_hp: "Weakest Ally",
  leader: "Party Leader",
  leader_target: "Leader's Target",
};

const FIELD_LABELS: Record<EdictConditionField, string> = {
  hp_pct: "HP %",
  essence_pct: "Essence %",
  type: "Type",
  active_effect: "Has Effect",
  effect_from_self: "My Effect On Target",
  nearby_enemies: "Nearby Enemies",
  always: "Always",
};

const OPERATOR_LABELS: Record<EdictOperator, string> = {
  lt: "<", gt: ">", gte: ">=", eq: "=",
  has: "has", not_has: "missing", is: "is",
};

const ACTION_LABELS: Record<EdictActionType, string> = {
  use_technique: "Use Technique",
  best_technique: "Use Best Technique",
  attack: "Basic Attack",
  prefer_target: "Prefer Target",
  flee: "Flee",
  skip: "Skip Turn",
};

const TARGET_PREF_LABELS: Record<EdictTargetPreference, string> = {
  nearest: "Nearest",
  weakest: "Weakest",
  strongest: "Strongest",
  boss: "Boss",
  leader_target: "Leader's Target",
  party_tagged: "Party-tagged",
};

// ── Helpers ─────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let _nextId = 0;
function newEdictId(): string {
  return `edict-${Date.now()}-${++_nextId}`;
}

function createEmptyEdict(): Edict {
  return {
    id: newEdictId(),
    name: "New Edict",
    enabled: true,
    conditions: [{ subject: "self", field: "always", operator: "eq", value: true }],
    action: { type: "best_technique", targetPreference: "nearest" },
  };
}

function getOperatorsForField(field: EdictConditionField): EdictOperator[] {
  switch (field) {
    case "hp_pct":
    case "essence_pct":
    case "nearby_enemies":
      return ["lt", "gt", "gte", "eq"];
    case "type":
      return ["is"];
    case "active_effect":
    case "effect_from_self":
      return ["has", "not_has"];
    default:
      return ["eq"];
  }
}

function isNumericField(field: EdictConditionField): boolean {
  return field === "hp_pct" || field === "essence_pct" || field === "nearby_enemies";
}

function getValueOptions(field: EdictConditionField): [string, string][] {
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

function fieldDefault(field: EdictConditionField): Partial<EdictCondition> {
  switch (field) {
    case "hp_pct": return { operator: "lt", value: 40 };
    case "essence_pct": return { operator: "lt", value: 30 };
    case "type": return { operator: "is", value: "boss" };
    case "active_effect": return { operator: "not_has", value: "buff" };
    case "effect_from_self": return { operator: "not_has", value: "debuff" };
    case "nearby_enemies": return { operator: "gte", value: 3 };
    case "always": return { operator: "eq", value: true };
  }
}

function conditionSummary(c: EdictCondition): string {
  if (c.field === "always") return "Always";
  const subj = SUBJECT_LABELS[c.subject] ?? c.subject;
  const field = FIELD_LABELS[c.field] ?? c.field;
  const op = OPERATOR_LABELS[c.operator] ?? c.operator;
  const val = typeof c.value === "boolean" ? "" : ` ${c.value}`;
  return `${subj} ${field} ${op}${val}`;
}

function actionSummary(a: EdictAction, techName?: string): string {
  if (a.type === "use_technique") return techName ?? a.techniqueId ?? "???";
  if (a.type === "best_technique") {
    const pref = a.targetPreference ? TARGET_PREF_LABELS[a.targetPreference] : "Nearest";
    return `Best → ${pref}`;
  }
  if (a.type === "prefer_target") {
    const pref = a.targetPreference ? TARGET_PREF_LABELS[a.targetPreference] : "Nearest";
    return `Target ${pref}`;
  }
  return ACTION_LABELS[a.type] ?? a.type;
}

// ── Callbacks the host panel provides ───────────────────────────────

export interface EdictEditorCallbacks {
  /** Called with the full edict list when user clicks Save. */
  onSave: (edicts: Edict[]) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Full edict management UI — list view with expandable card editors.
 * Drop-in sibling of LearnedTechniquesList; rendered into a host container.
 */
export class EdictEditor {
  readonly container: HTMLDivElement;
  private edicts: Edict[] = [];
  private techniques: LearnedTechnique[] = [];
  private editingIdx: number | null = null;
  private saving = false;
  private dirty = false;
  private loaded = false;
  private statusText = "";
  private statusKind: "idle" | "ok" | "warn" | "error" = "idle";
  private callbacks: EdictEditorCallbacks;

  constructor(callbacks: EdictEditorCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement("div");
    this.container.className = "ee-wrap";
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.container.addEventListener("change", (e) => this.onChange(e));
    this.container.addEventListener("input", (e) => this.onInput(e));
    this.container.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest(".ee-select")) e.stopPropagation();
    });
    this.render();
  }

  setTechniques(techs: LearnedTechnique[]) {
    this.techniques = techs;
    this.render();
  }

  setEdicts(edicts: Edict[]) {
    // Don't clobber in-progress user edits. Polls re-fire every 30s and after
    // saves; if the user is mid-edit (or a save silently failed), overwriting
    // here would erase their work.
    if (this.loaded && this.dirty) return;
    // Track the currently-expanded edict by id so the card stays open after a
    // poll/save round-trip (otherwise the save looks like it reverted).
    const prevEditingId =
      this.editingIdx != null ? this.edicts[this.editingIdx]?.id ?? null : null;
    this.edicts = edicts.map((e) => ({
      ...e,
      conditions: e.conditions.map((c) => ({ ...c })),
      action: { ...e.action },
    }));
    this.loaded = true;
    this.dirty = false;
    this.setStatus(`Loaded ${this.edicts.length} edict${this.edicts.length === 1 ? "" : "s"}.`, "ok", false);
    if (prevEditingId) {
      const newIdx = this.edicts.findIndex((e) => e.id === prevEditingId);
      this.editingIdx = newIdx >= 0 ? newIdx : null;
    } else {
      this.editingIdx = null;
    }
    this.render();
  }

  // ── Render ────────────────────────────────────────────────────────

  private render() {
    const techById = new Map(this.techniques.map((t) => [t.id, t]));
    let html = "";

    html += `<div class="ee-toolbar">`;
    html += `<div class="ee-presets">`;
    html += `<span class="ee-presets-label">Preset:</span>`;
    html += `<button class="ee-preset-btn" data-preset="dps">DPS</button>`;
    html += `<button class="ee-preset-btn" data-preset="tank">Tank</button>`;
    html += `<button class="ee-preset-btn" data-preset="healer">Healer</button>`;
    html += `</div>`;
    const saveLabel = this.saving ? "Saving..." : this.dirty ? "Save *" : "Saved";
    const saveCls = `ee-save${this.dirty ? " dirty" : ""}`;
    html += `<button class="${saveCls}" data-save="1" ${!this.dirty || this.saving ? "disabled" : ""}>${saveLabel}</button>`;
    html += `</div>`;
    if (this.statusText) {
      html += `<div class="ee-status ee-status-${this.statusKind}">${esc(this.statusText)}</div>`;
    }

    if (!this.loaded) {
      html += `<div class="ee-empty">Loading edicts...</div>`;
      this.container.innerHTML = html;
      return;
    }

    if (this.edicts.length === 0) {
      html += `<div class="ee-empty">No edicts set. Your champion uses default behavior.<br>Try a preset above or add a rule.</div>`;
    }

    for (let idx = 0; idx < this.edicts.length; idx++) {
      const edict = this.edicts[idx];
      const expanded = this.editingIdx === idx;
      const tech = edict.action.techniqueId ? techById.get(edict.action.techniqueId) : undefined;
      const summary = edict.conditions.map(conditionSummary).join(" AND ") || "No conditions";
      const enabledCls = edict.enabled ? " ee-on" : " ee-off";

      html += `<div class="ee-card${enabledCls}" data-idx="${idx}">`;
      html += `<div class="ee-card-head">`;
      html += `<div class="ee-reorder">`;
      html += `<button class="ee-up" data-up="${idx}" ${idx === 0 ? "disabled" : ""} title="Move up">\u25B2</button>`;
      html += `<button class="ee-down" data-down="${idx}" ${idx === this.edicts.length - 1 ? "disabled" : ""} title="Move down">\u25BC</button>`;
      html += `</div>`;
      html += `<button class="ee-toggle" data-toggle="${idx}" title="Enable/disable">${edict.enabled ? "\u25C9" : "\u25CB"}</button>`;
      html += `<button class="ee-summary" data-expand="${idx}">`;
      html += `<div class="ee-name">${esc(edict.name)}</div>`;
      html += `<div class="ee-rule">IF ${esc(summary)} <span class="ee-arrow">\u2192</span> <span class="ee-action">${esc(actionSummary(edict.action, tech?.name))}</span></div>`;
      html += `</button>`;
      html += `<button class="ee-del" data-del="${idx}" title="Delete">\u2715</button>`;
      html += `</div>`;

      if (expanded) {
        html += this.renderEditorBody(edict, idx);
      }

      html += `</div>`;
    }

    if (this.edicts.length < MAX_EDICTS) {
      html += `<button class="ee-add" data-add="1">+ Add Edict</button>`;
    } else {
      html += `<div class="ee-max">Max ${MAX_EDICTS} edicts reached.</div>`;
    }

    this.container.innerHTML = html;
  }

  private renderEditorBody(edict: Edict, idx: number): string {
    let html = `<div class="ee-body" data-body-idx="${idx}">`;
    html += `<input class="ee-input-name" type="text" data-name="${idx}" value="${esc(edict.name)}" placeholder="Edict name" maxlength="40">`;

    html += `<div class="ee-section"><div class="ee-section-title">If</div>`;
    for (let ci = 0; ci < edict.conditions.length; ci++) {
      html += this.renderConditionRow(edict, idx, ci);
    }
    if (edict.conditions.length < MAX_CONDITIONS_PER_EDICT) {
      html += `<button class="ee-add-cond" data-add-cond="${idx}">+ AND</button>`;
    }
    html += `</div>`;

    html += `<div class="ee-section"><div class="ee-section-title">Then</div>`;
    html += this.renderActionRow(edict, idx);
    html += `</div>`;

    html += `</div>`;
    return html;
  }

  private renderConditionRow(edict: Edict, idx: number, ci: number): string {
    const c = edict.conditions[ci];
    let html = `<div class="ee-row" data-row-idx="${idx}" data-cond-idx="${ci}">`;
    html += this.selectHtml(`subject-${idx}-${ci}`, c.subject, Object.entries(SUBJECT_LABELS) as [string, string][], "cond-subject");
    html += this.selectHtml(`field-${idx}-${ci}`, c.field, Object.entries(FIELD_LABELS) as [string, string][], "cond-field");

    if (c.field !== "always") {
      const ops = getOperatorsForField(c.field);
      html += this.selectHtml(`op-${idx}-${ci}`, c.operator, ops.map((o) => [o, OPERATOR_LABELS[o]]) as [string, string][], "cond-op");
      if (isNumericField(c.field)) {
        html += `<input class="ee-input-num" type="number" data-cond-val="${idx}-${ci}" value="${esc(String(c.value))}" min="0" max="100">`;
      } else {
        const opts = getValueOptions(c.field);
        html += this.selectHtml(`val-${idx}-${ci}`, String(c.value), opts, "cond-val");
      }
    }

    if (edict.conditions.length > 1) {
      html += `<button class="ee-del-cond" data-del-cond="${idx}-${ci}" title="Remove">\u2715</button>`;
    }
    html += `</div>`;
    return html;
  }

  private renderActionRow(edict: Edict, idx: number): string {
    const a = edict.action;
    let html = `<div class="ee-row" data-action-idx="${idx}">`;
    html += this.selectHtml(`act-type-${idx}`, a.type, Object.entries(ACTION_LABELS) as [string, string][], "act-type");

    if (a.type === "use_technique") {
      const techOpts: [string, string][] = this.techniques.length
        ? this.techniques.map((t) => [t.id, `${t.name} (${t.type})`])
        : [["", "— no learned techniques —"]];
      html += this.selectHtml(`act-tech-${idx}`, a.techniqueId ?? techOpts[0][0], techOpts, "act-tech");
      if (a.techniqueId && !this.techniques.some((t) => t.id === a.techniqueId)) {
        html += `<span class="ee-warn" title="Technique not learned">\u26A0</span>`;
      }
    } else if (a.type === "best_technique" || a.type === "prefer_target") {
      const prefOpts = Object.entries(TARGET_PREF_LABELS) as [string, string][];
      html += this.selectHtml(`act-pref-${idx}`, a.targetPreference ?? "nearest", prefOpts, "act-pref");
    }

    html += `</div>`;
    return html;
  }

  private selectHtml(
    _key: string,
    value: string,
    options: [string, string][],
    dataRole: string,
  ): string {
    let html = `<select class="ee-select" data-role="${dataRole}">`;
    for (const [v, label] of options) {
      const sel = v === value ? " selected" : "";
      html += `<option value="${esc(v)}"${sel}>${esc(label)}</option>`;
    }
    html += `</select>`;
    return html;
  }

  /**
   * Patch just the summary line of a single card + the toolbar save button.
   * Used instead of a full re-render when a dropdown/input change doesn't
   * alter the card's structure — avoids closing open selects and losing focus.
   */
  private updateSummary(idx: number) {
    const edict = this.edicts[idx];
    if (!edict) return;
    const techById = new Map(this.techniques.map((t) => [t.id, t]));
    const tech = edict.action.techniqueId ? techById.get(edict.action.techniqueId) : undefined;
    const summary = edict.conditions.map(conditionSummary).join(" AND ") || "No conditions";
    const ruleEl = this.container.querySelector(
      `.ee-card[data-idx="${idx}"] .ee-rule`,
    ) as HTMLElement | null;
    if (ruleEl) {
      ruleEl.innerHTML =
        `IF ${esc(summary)} <span class="ee-arrow">\u2192</span> ` +
        `<span class="ee-action">${esc(actionSummary(edict.action, tech?.name))}</span>`;
    }
    this.refreshSaveButton();
  }

  /** Update the Save button label/enabled state without touching card DOM. */
  private refreshSaveButton() {
    const btn = this.container.querySelector("[data-save]") as HTMLButtonElement | null;
    if (!btn) return;
    const label = this.saving ? "Saving..." : this.dirty ? "Save *" : "Saved";
    btn.textContent = label;
    btn.className = `ee-save${this.dirty ? " dirty" : ""}`;
    btn.disabled = !this.dirty || this.saving;
  }

  // ── Event handlers ────────────────────────────────────────────────

  private onClick(e: Event) {
    const target = e.target as HTMLElement;

    const preset = target.closest<HTMLElement>("[data-preset]");
    if (preset) {
      const name = preset.dataset.preset as "dps" | "tank" | "healer";
      this.applyPreset(name);
      return;
    }

    if (target.matches("[data-save]")) {
      void this.save();
      return;
    }

    const expandBtn = target.closest<HTMLElement>("[data-expand]");
    if (expandBtn) {
      const idx = Number(expandBtn.dataset.expand);
      this.editingIdx = this.editingIdx === idx ? null : idx;
      this.render();
      return;
    }

    const toggle = target.closest<HTMLElement>("[data-toggle]");
    if (toggle) {
      const idx = Number(toggle.dataset.toggle);
      this.edicts[idx].enabled = !this.edicts[idx].enabled;
      this.markDirty();
      this.render();
      return;
    }

    const del = target.closest<HTMLElement>("[data-del]");
    if (del) {
      const idx = Number(del.dataset.del);
      this.edicts.splice(idx, 1);
      if (this.editingIdx === idx) this.editingIdx = null;
      else if (this.editingIdx != null && this.editingIdx > idx) this.editingIdx -= 1;
      this.markDirty();
      this.render();
      return;
    }

    const up = target.closest<HTMLElement>("[data-up]");
    if (up && !(up as HTMLButtonElement).disabled) {
      const idx = Number(up.dataset.up);
      if (idx > 0) {
        [this.edicts[idx - 1], this.edicts[idx]] = [this.edicts[idx], this.edicts[idx - 1]];
        if (this.editingIdx === idx) this.editingIdx = idx - 1;
        else if (this.editingIdx === idx - 1) this.editingIdx = idx;
        this.markDirty();
        this.render();
      }
      return;
    }

    const down = target.closest<HTMLElement>("[data-down]");
    if (down && !(down as HTMLButtonElement).disabled) {
      const idx = Number(down.dataset.down);
      if (idx < this.edicts.length - 1) {
        [this.edicts[idx + 1], this.edicts[idx]] = [this.edicts[idx], this.edicts[idx + 1]];
        if (this.editingIdx === idx) this.editingIdx = idx + 1;
        else if (this.editingIdx === idx + 1) this.editingIdx = idx;
        this.markDirty();
        this.render();
      }
      return;
    }

    if (target.matches("[data-add]")) {
      if (this.edicts.length >= MAX_EDICTS) return;
      this.edicts.push(createEmptyEdict());
      this.editingIdx = this.edicts.length - 1;
      this.markDirty();
      this.render();
      return;
    }

    const addCond = target.closest<HTMLElement>("[data-add-cond]");
    if (addCond) {
      const idx = Number(addCond.dataset.addCond);
      const edict = this.edicts[idx];
      if (edict.conditions.length >= MAX_CONDITIONS_PER_EDICT) return;
      edict.conditions.push({ subject: "self", field: "hp_pct", operator: "lt", value: 50 });
      this.markDirty();
      this.render();
      return;
    }

    const delCond = target.closest<HTMLElement>("[data-del-cond]");
    if (delCond) {
      const [idxStr, ciStr] = (delCond.dataset.delCond ?? "").split("-");
      const idx = Number(idxStr);
      const ci = Number(ciStr);
      const edict = this.edicts[idx];
      if (edict.conditions.length > 1) {
        edict.conditions.splice(ci, 1);
        this.markDirty();
        this.render();
      }
      return;
    }
  }

  private onInput(e: Event) {
    const target = e.target as HTMLElement;
    if (target.matches(`.ee-input-name`)) {
      const el = target as HTMLInputElement;
      const idx = Number(el.dataset.name);
      this.edicts[idx].name = el.value;
      this.markDirty();
      // Name is displayed via the card title, not the summary — patch it.
      const nameEl = this.container.querySelector(
        `.ee-card[data-idx="${idx}"] .ee-name`,
      ) as HTMLElement | null;
      if (nameEl) nameEl.textContent = el.value;
      this.refreshSaveButton();
      return;
    }
    if (target.matches(`.ee-input-num`)) {
      const el = target as HTMLInputElement;
      const [idxStr, ciStr] = (el.dataset.condVal ?? "").split("-");
      const idx = Number(idxStr);
      const ci = Number(ciStr);
      this.edicts[idx].conditions[ci].value = Number(el.value);
      this.markDirty();
      this.updateSummary(idx);
      return;
    }
    if (target.matches(".ee-select")) {
      this.applySelectChange(target as HTMLSelectElement);
    }
  }

  private onChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    if (!target.matches(".ee-select")) return;
    this.applySelectChange(target);
  }

  private applySelectChange(target: HTMLSelectElement) {
    const role = target.dataset.role;
    const row = target.closest<HTMLElement>("[data-row-idx], [data-action-idx]");
    if (!row) return;

    if (role && role.startsWith("cond-")) {
      const idx = Number(row.dataset.rowIdx);
      const ci = Number(row.dataset.condIdx);
      const cond = this.edicts[idx].conditions[ci];
      // Field changes the available operators / value widget → must re-render.
      // All other cond changes just mutate state; avoid a full wipe so the
      // dropdown doesn't close mid-click and focus doesn't jump.
      let structuralChange = false;
      if (role === "cond-subject") cond.subject = target.value as EdictSubject;
      else if (role === "cond-field") {
        const newField = target.value as EdictConditionField;
        cond.field = newField;
        Object.assign(cond, fieldDefault(newField));
        structuralChange = true;
      } else if (role === "cond-op") cond.operator = target.value as EdictOperator;
      else if (role === "cond-val") cond.value = target.value;
      this.markDirty();
      this.setStatus(`Changed ${FIELD_LABELS[cond.field] ?? cond.field}. Save to apply.`, "warn", false);
      if (structuralChange) this.render();
      else this.updateSummary(idx);
      return;
    }

    if (role && role.startsWith("act-")) {
      const idx = Number(row.dataset.actionIdx);
      const act = this.edicts[idx].action;
      // act-type swaps between technique picker / target-pref picker / nothing
      // → structural. act-tech and act-pref just update a value.
      let structuralChange = false;
      if (role === "act-type") {
        act.type = target.value as EdictActionType;
        // Reset contextual fields so the new action is valid.
        if (act.type === "use_technique") {
          act.targetPreference = undefined;
          act.techniqueId = this.techniques[0]?.id ?? "";
        } else if (act.type === "best_technique" || act.type === "prefer_target") {
          act.techniqueId = undefined;
          act.targetPreference = act.targetPreference ?? "nearest";
        } else {
          act.techniqueId = undefined;
          act.targetPreference = undefined;
        }
        structuralChange = true;
      } else if (role === "act-tech") {
        act.techniqueId = target.value;
      } else if (role === "act-pref") {
        act.targetPreference = target.value as EdictTargetPreference;
      }
      this.markDirty();
      this.setStatus(`Changed action to ${ACTION_LABELS[act.type] ?? act.type}. Save to apply.`, "warn", false);
      if (structuralChange) this.render();
      else this.updateSummary(idx);
      return;
    }
  }

  // ── Presets ───────────────────────────────────────────────────────

  private applyPreset(name: "dps" | "tank" | "healer") {
    const techs = this.techniques;
    const find = (pred: (t: LearnedTechnique) => boolean) => techs.find(pred);

    const heal = find((t) => t.type === "healing");
    const buff = find((t) => t.type === "buff");
    const debuff = find((t) => t.type === "debuff");

    const edicts: Edict[] = [];
    edicts.push({
      id: newEdictId(),
      name: "Flee when critical",
      enabled: true,
      conditions: [{ subject: "self", field: "hp_pct", operator: "lt", value: 15 }],
      action: { type: "flee" },
    });

    if (name === "healer" && heal) {
      edicts.push({
        id: newEdictId(),
        name: "Emergency self-heal",
        enabled: true,
        conditions: [{ subject: "self", field: "hp_pct", operator: "lt", value: 40 }],
        action: { type: "use_technique", techniqueId: heal.id },
      });
      edicts.push({
        id: newEdictId(),
        name: "Heal ally < 50%",
        enabled: true,
        conditions: [{ subject: "ally_lowest_hp", field: "hp_pct", operator: "lt", value: 50 }],
        action: { type: "use_technique", techniqueId: heal.id },
      });
    } else if (name === "tank") {
      if (buff) edicts.push({
        id: newEdictId(),
        name: "Shield when hurt",
        enabled: true,
        conditions: [
          { subject: "self", field: "hp_pct", operator: "lt", value: 50 },
          { subject: "self", field: "active_effect", operator: "not_has", value: "buff" },
        ],
        action: { type: "use_technique", techniqueId: buff.id },
      });
      if (heal) edicts.push({
        id: newEdictId(),
        name: "Self-heal when low",
        enabled: true,
        conditions: [{ subject: "self", field: "hp_pct", operator: "lt", value: 50 }],
        action: { type: "use_technique", techniqueId: heal.id },
      });
      edicts.push({
        id: newEdictId(),
        name: "Focus bosses",
        enabled: true,
        conditions: [{ subject: "target", field: "type", operator: "is", value: "boss" }],
        action: { type: "best_technique", targetPreference: "boss" },
      });
    } else if (name === "dps") {
      if (heal) edicts.push({
        id: newEdictId(),
        name: "Panic heal",
        enabled: true,
        conditions: [{ subject: "self", field: "hp_pct", operator: "lt", value: 25 }],
        action: { type: "use_technique", techniqueId: heal.id },
      });
      if (buff) edicts.push({
        id: newEdictId(),
        name: "Self-buff",
        enabled: true,
        conditions: [{ subject: "self", field: "active_effect", operator: "not_has", value: "buff" }],
        action: { type: "use_technique", techniqueId: buff.id },
      });
      if (debuff) edicts.push({
        id: newEdictId(),
        name: "Debuff target",
        enabled: true,
        conditions: [{ subject: "target", field: "effect_from_self", operator: "not_has", value: "debuff" }],
        action: { type: "use_technique", techniqueId: debuff.id },
      });
    }

    edicts.push({
      id: newEdictId(),
      name: "Best technique on nearest",
      enabled: true,
      conditions: [{ subject: "self", field: "always", operator: "eq", value: true }],
      action: { type: "best_technique", targetPreference: "nearest" },
    });

    this.edicts = edicts;
    this.editingIdx = null;
    this.markDirty();
    this.render();
  }

  // ── Save ──────────────────────────────────────────────────────────

  private markDirty() {
    this.dirty = true;
  }

  private setStatus(text: string, kind: "idle" | "ok" | "warn" | "error", refresh = true) {
    this.statusText = text;
    this.statusKind = kind;
    if (refresh) this.render();
  }

  private async save() {
    if (this.saving || !this.dirty) return;
    this.saving = true;
    this.setStatus("Saving edicts...", "warn", false);
    this.render();
    try {
      const result = await this.callbacks.onSave(this.snapshot());
      if (result.ok) {
        this.dirty = false;
        this.setStatus(`Saved ${this.edicts.length} edict${this.edicts.length === 1 ? "" : "s"}.`, "ok", false);
      } else {
        this.setStatus(result.error ? `Save failed: ${result.error}` : "Save failed.", "error", false);
      }
    } catch (err) {
      this.setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`, "error", false);
    } finally {
      this.saving = false;
      this.render();
    }
  }

  private snapshot(): Edict[] {
    return this.edicts.map((e) => ({
      ...e,
      conditions: e.conditions.map((c) => ({ ...c })),
      action: { ...e.action },
    }));
  }

  // ── Styles ────────────────────────────────────────────────────────

  static injectStyles() {
    if (document.getElementById("ee-styles")) return;
    const style = document.createElement("style");
    style.id = "ee-styles";
    style.textContent = `
      .ee-wrap { display: flex; flex-direction: column; gap: 4px; padding: 6px; }

      .ee-toolbar {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 4px 2px 6px;
        border-bottom: 1px solid rgba(68, 255, 136, 0.1);
      }
      .ee-presets { display: flex; gap: 4px; align-items: center; }
      .ee-presets-label { color: #779; font-size: 10px; text-transform: uppercase; }
      .ee-preset-btn {
        padding: 2px 6px; background: rgba(30, 40, 55, 0.6);
        border: 1px solid rgba(68, 255, 136, 0.15);
        border-radius: 3px;
        color: #aab; font: bold 10px monospace; cursor: pointer;
      }
      .ee-preset-btn:hover { color: #4f8; border-color: #4f8; }

      .ee-save {
        padding: 3px 10px; background: rgba(30, 40, 55, 0.6);
        border: 1px solid rgba(68, 255, 136, 0.25);
        border-radius: 3px;
        color: #667; font: bold 10px monospace; text-transform: uppercase;
        cursor: pointer;
      }
      .ee-save.dirty { color: #ffcc44; border-color: #ffcc44; }
      .ee-save.dirty:hover { background: #ffcc44; color: #0a1021; }
      .ee-save:disabled { cursor: default; opacity: 0.8; }
      .ee-status {
        padding: 4px 6px;
        border: 1px solid rgba(68, 255, 136, 0.12);
        border-radius: 3px;
        background: rgba(10, 16, 28, 0.55);
        color: #889;
        font: 10px/1.35 monospace;
      }
      .ee-status-ok { color: #7fd; border-color: rgba(68, 255, 136, 0.22); }
      .ee-status-warn { color: #ffcc44; border-color: rgba(255, 204, 68, 0.28); }
      .ee-status-error { color: #ff7777; border-color: rgba(255, 90, 90, 0.35); }

      .ee-empty, .ee-max {
        padding: 12px 10px; text-align: center; color: #667;
        font-size: 11px; font-style: italic;
      }

      .ee-card {
        border: 1px solid rgba(68, 255, 136, 0.12);
        border-left: 3px solid #333;
        border-radius: 3px;
        background: rgba(20, 28, 42, 0.6);
      }
      .ee-card.ee-on { border-left-color: #4f8; }
      .ee-card.ee-off { opacity: 0.55; }

      .ee-card-head {
        display: flex; align-items: stretch; gap: 2px;
        padding: 2px;
      }
      .ee-reorder { display: flex; flex-direction: column; gap: 1px; }
      .ee-up, .ee-down {
        padding: 0; width: 16px; height: 12px;
        background: none; border: none; color: #556;
        font-size: 9px; cursor: pointer;
      }
      .ee-up:hover, .ee-down:hover { color: #4f8; }
      .ee-up:disabled, .ee-down:disabled { color: #334; cursor: default; }

      .ee-toggle {
        padding: 0 4px; background: none; border: none;
        color: #4f8; font-size: 14px; cursor: pointer;
        width: 20px; flex-shrink: 0;
      }
      .ee-off .ee-toggle { color: #556; }

      .ee-summary {
        flex: 1; background: none; border: none;
        padding: 2px 4px; text-align: left;
        cursor: pointer; min-width: 0;
      }
      .ee-name {
        color: #dde; font: bold 11px monospace;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ee-rule {
        color: #889; font: 10px monospace;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ee-arrow { color: #4f8; }
      .ee-action { color: #ffcc44; }

      .ee-del {
        padding: 0 6px; background: none; border: none;
        color: #556; font-size: 12px; cursor: pointer;
      }
      .ee-del:hover { color: #f66; }

      .ee-body {
        padding: 6px 8px 8px;
        border-top: 1px solid rgba(68, 255, 136, 0.1);
        background: rgba(10, 16, 28, 0.5);
        display: flex; flex-direction: column; gap: 6px;
      }

      .ee-input-name {
        width: 100%;
        padding: 3px 6px;
        background: rgba(10, 16, 28, 0.8);
        border: 1px solid rgba(68, 255, 136, 0.15);
        border-radius: 2px;
        color: #dde; font: 11px monospace;
        outline: none;
      }
      .ee-input-name:focus { border-color: #4f8; }

      .ee-section { display: flex; flex-direction: column; gap: 3px; }
      .ee-section-title {
        color: #667; font: bold 9px monospace; text-transform: uppercase;
      }

      .ee-row {
        display: flex; flex-wrap: wrap; align-items: center; gap: 3px;
      }
      .ee-select {
        padding: 2px 4px;
        background: rgba(10, 16, 28, 0.8);
        border: 1px solid rgba(68, 255, 136, 0.15);
        border-radius: 2px;
        color: #dde; font: 10px monospace;
        outline: none;
        max-width: 140px;
      }
      .ee-select:focus { border-color: #4f8; }
      .ee-input-num {
        width: 44px;
        padding: 2px 4px;
        background: rgba(10, 16, 28, 0.8);
        border: 1px solid rgba(68, 255, 136, 0.15);
        border-radius: 2px;
        color: #dde; font: 10px monospace; text-align: center;
        outline: none;
      }
      .ee-input-num:focus { border-color: #4f8; }
      .ee-del-cond {
        padding: 0 4px; background: none; border: none;
        color: #556; font-size: 11px; cursor: pointer;
      }
      .ee-del-cond:hover { color: #f66; }
      .ee-warn { color: #f66; font-size: 12px; }

      .ee-add-cond {
        margin-top: 2px;
        padding: 2px 8px; background: none;
        border: 1px dashed rgba(68, 255, 136, 0.2);
        border-radius: 2px;
        color: #667; font: 10px monospace; cursor: pointer;
        align-self: flex-start;
      }
      .ee-add-cond:hover { color: #4f8; border-color: #4f8; }

      .ee-add {
        margin-top: 4px;
        padding: 6px 10px; background: rgba(20, 28, 42, 0.4);
        border: 1px dashed rgba(68, 255, 136, 0.25);
        border-radius: 3px;
        color: #667; font: bold 11px monospace; cursor: pointer;
      }
      .ee-add:hover { color: #4f8; border-color: #4f8; background: rgba(68, 255, 136, 0.06); }
    `;
    document.head.appendChild(style);
  }
}
