import type { ProfessionStatusResponse, ProfessionSkillSummary } from "../types.js";
import { LearnedTechniquesList, type LearnedTechnique } from "./LearnedTechniquesList.js";
import { EdictEditor, type Edict } from "./EdictEditor.js";
import { playSoundEffect } from "../sfx.js";

const PROFESSIONS: { id: string; name: string; icon: string }[] = [
  { id: "mining",          name: "Mining",          icon: "\u26CF"    },
  { id: "herbalism",       name: "Herbalism",       icon: "\u{1F33F}" },
  { id: "skinning",        name: "Skinning",        icon: "\u{1F9F6}" },
  { id: "blacksmithing",   name: "Blacksmithing",   icon: "\u2692"    },
  { id: "alchemy",         name: "Alchemy",         icon: "\u{1F9EA}" },
  { id: "cooking",         name: "Cooking",         icon: "\u{1F372}" },
  { id: "leatherworking",  name: "Leatherworking",  icon: "\u{1F4DC}" },
  { id: "jewelcrafting",   name: "Jewelcrafting",   icon: "\u{1F48E}" },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type SkillsTab = "professions" | "skills" | "edicts" | "farm";

export interface FarmPlotData {
  owned: boolean;
  plotId?: string;
  zoneId?: string;
  buildingType?: string;
  buildingStage?: number;
  claimedAt?: number;
  cost?: number;
}

export interface FarmCropNode {
  id: string;
  name: string;
  cropType?: string;
  charges: number;
  maxCharges: number;
  depleted: boolean;
  requiredHoeTier: number;
}

export interface FarmTabData {
  plot: FarmPlotData | null;
  nodes: FarmCropNode[];
  currentZoneId?: string;
}

export interface SkillsPanelCallbacks {
  /** Save the full edict list. */
  saveEdicts: (edicts: Edict[]) => Promise<{ ok: boolean; error?: string }>;
  /** Fired when the user switches tabs — host may kick polling. */
  onTabChange?: (tab: SkillsTab) => void;
  /** Fired when the user clicks a profession cell — host opens the recipes panel. */
  onProfessionClick?: (info: {
    profId: string;
    profName: string;
    profIcon: string;
    skillLevel: number;
    learned: boolean;
  }) => void;
}

/**
 * Two-tab panel:
 *  - Professions: skill levels for the 9 gathering/crafting professions
 *  - Skills:      learned techniques + edict (gambit) editor
 */
export class SkillsPanel {
  private container: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private bodyEl: HTMLDivElement;

  // Professions tab
  private profGrid: HTMLDivElement;
  private profTooltip: HTMLDivElement;
  private learnedIds = new Set<string>();
  private skills: Record<string, ProfessionSkillSummary> = {};

  // Skills tab
  private skillsScroll: HTMLDivElement;
  private techniquesList: LearnedTechniquesList;

  // Edicts tab
  private edictsScroll: HTMLDivElement;
  private edictEditor: EdictEditor;

  // Farm tab
  private farmScroll: HTMLDivElement;
  private lastFarmData: FarmTabData | null = null;

  private activeTab: SkillsTab = "professions";
  private callbacks: SkillsPanelCallbacks;

  constructor(callbacks: SkillsPanelCallbacks) {
    this.callbacks = callbacks;

    this.container = document.createElement("div");
    this.container.id = "skills-panel";
    this.container.style.display = "none";

    // ── Tab bar ────────────────────────────────────────────────
    this.tabBar = document.createElement("div");
    this.tabBar.className = "sk-tabs";
    this.tabBar.innerHTML = `
      <span class="sk-drag-handle" data-drag-handle="skills" title="Drag panel">:::</span>
      <button class="sk-tab active" data-tab="professions">Professions</button>
      <button class="sk-tab" data-tab="skills">Skills</button>
      <button class="sk-tab" data-tab="edicts">Edicts</button>
      <button class="sk-tab" data-tab="farm">Farm</button>
      <button class="sk-close" type="button" title="Close">×</button>
    `;
    this.tabBar.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".sk-close")) {
        playSoundEffect("ui_dialog_close");
        this.hide();
        return;
      }
      const btn = target.closest(".sk-tab") as HTMLButtonElement | null;
      if (!btn) return;
      const tab = btn.dataset.tab as SkillsTab;
      if (tab === this.activeTab) return;
      playSoundEffect("ui_tab_switch");
      this.activeTab = tab;
      this.tabBar.querySelectorAll(".sk-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      this.applyActiveTab();
      this.callbacks.onTabChange?.(tab);
    });
    this.container.appendChild(this.tabBar);

    // ── Body (holds whichever tab is active) ──────────────────
    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "sk-body";
    this.container.appendChild(this.bodyEl);

    // ── Professions view ──────────────────────────────────────
    this.profGrid = document.createElement("div");
    this.profGrid.className = "sk-grid";
    this.profGrid.addEventListener("mouseover", (e) => {
      const cell = (e.target as HTMLElement).closest(".sk-cell") as HTMLElement;
      if (!cell?.dataset.prof) return;
      this.showProfTooltip(cell.dataset.prof, cell);
    });
    this.profGrid.addEventListener("mouseout", (e) => {
      const cell = (e.target as HTMLElement).closest(".sk-cell") as HTMLElement;
      if (!cell) return;
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related && cell.contains(related)) return;
      this.profTooltip.style.display = "none";
    });
    this.profGrid.addEventListener("click", (e) => {
      const cell = (e.target as HTMLElement).closest(".sk-cell") as HTMLElement;
      const profId = cell?.dataset.prof;
      if (!profId) return;
      const prof = PROFESSIONS.find((p) => p.id === profId);
      if (!prof) return;
      playSoundEffect("ui_tab_switch");
      this.profTooltip.style.display = "none";
      this.callbacks.onProfessionClick?.({
        profId,
        profName: prof.name,
        profIcon: prof.icon,
        skillLevel: this.skills[profId]?.level ?? 0,
        learned: this.learnedIds.has(profId),
      });
    });

    // ── Skills view ───────────────────────────────────────────
    this.skillsScroll = document.createElement("div");
    this.skillsScroll.className = "sk-skills-scroll";

    this.techniquesList = new LearnedTechniquesList();
    const techHeader = document.createElement("div");
    techHeader.className = "sk-section-head";
    techHeader.innerHTML = `<span class="sk-section-title">Learned Techniques</span>`;
    this.skillsScroll.appendChild(techHeader);
    this.skillsScroll.appendChild(this.techniquesList.container);

    // ── Edicts view ───────────────────────────────────────────
    this.edictsScroll = document.createElement("div");
    this.edictsScroll.className = "sk-skills-scroll";

    const edictHeader = document.createElement("div");
    edictHeader.className = "sk-section-head";
    edictHeader.innerHTML = `<span class="sk-section-title">Edicts (Gambits)</span><span class="sk-section-hint">First match wins, evaluated top-to-bottom</span>`;
    this.edictsScroll.appendChild(edictHeader);

    this.edictEditor = new EdictEditor({
      onSave: (edicts) => this.callbacks.saveEdicts(edicts),
    });
    this.edictsScroll.appendChild(this.edictEditor.container);

    // ── Farm view ─────────────────────────────────────────────
    this.farmScroll = document.createElement("div");
    this.farmScroll.className = "sk-skills-scroll";

    // ── Tooltip (professions) ─────────────────────────────────
    this.profTooltip = document.createElement("div");
    this.profTooltip.className = "sk-tooltip";
    this.profTooltip.style.display = "none";
    document.body.appendChild(this.profTooltip);

    document.body.appendChild(this.container);

    this.injectStyles();
    LearnedTechniquesList.injectStyles();
    EdictEditor.injectStyles();

    this.applyActiveTab();
    this.renderProfessions();
  }

  // ── Public API ────────────────────────────────────────────────

  updateProfessions(data: ProfessionStatusResponse) {
    this.learnedIds = new Set(data.professions);
    this.skills = data.skills ?? {};
    this.renderProfessions();
  }

  updateTechniques(techniques: LearnedTechnique[]) {
    this.techniquesList.update(techniques);
    this.edictEditor.setTechniques(techniques);
  }

  updateEdicts(edicts: Edict[]) {
    this.edictEditor.setEdicts(edicts);
  }

  updateFarm(data: FarmTabData) {
    this.lastFarmData = data;
    if (this.activeTab === "farm") this.renderFarm();
  }

  getActiveTab(): SkillsTab {
    return this.activeTab;
  }

  toggle() {
    if (this.container.style.display === "none") {
      this.show();
    } else {
      this.hide();
    }
  }

  show() {
    if (this.container.style.display === "flex") return;
    this.container.style.display = "flex";
    playSoundEffect("ui_dialog_open");
  }

  hide() {
    if (this.container.style.display === "none") return;
    this.container.style.display = "none";
    this.profTooltip.style.display = "none";
    playSoundEffect("ui_dialog_close");
  }

  isVisible(): boolean { return this.container.style.display !== "none"; }

  // ── Internals ─────────────────────────────────────────────────

  private applyActiveTab() {
    this.bodyEl.innerHTML = "";
    if (this.activeTab === "professions") {
      this.bodyEl.appendChild(this.profGrid);
      this.profTooltip.style.display = "none";
    } else if (this.activeTab === "skills") {
      this.bodyEl.appendChild(this.skillsScroll);
    } else if (this.activeTab === "farm") {
      this.bodyEl.appendChild(this.farmScroll);
      this.renderFarm();
    } else {
      this.bodyEl.appendChild(this.edictsScroll);
    }
  }

  private renderProfessions() {
    let html = "";
    for (const prof of PROFESSIONS) {
      const learned = this.learnedIds.has(prof.id);
      const skill = this.skills[prof.id];
      const level = skill?.level ?? 0;
      const progress = skill?.progress ?? 0;
      const cls = learned ? "sk-cell sk-learned" : "sk-cell sk-locked";

      html += `<div class="${cls}" data-prof="${esc(prof.id)}">`;
      html += `<div class="sk-cell-icon">${prof.icon}</div>`;
      html += `<div class="sk-cell-info">`;
      html += `<div class="sk-cell-name">${esc(prof.name)}</div>`;
      if (learned) {
        html += `<div class="sk-cell-level">${level}</div>`;
        html += `<div class="sk-cell-bar"><div class="sk-cell-bar-fill" style="width:${progress}%"></div></div>`;
      } else {
        html += `<div class="sk-cell-level sk-cell-level-locked">--</div>`;
      }
      html += `</div>`;
      html += `</div>`;
    }
    this.profGrid.innerHTML = html;
  }

  private showProfTooltip(profId: string, cell: HTMLElement) {
    const prof = PROFESSIONS.find((p) => p.id === profId);
    if (!prof) return;
    const learned = this.learnedIds.has(profId);
    const skill = this.skills[profId];

    let html = `<div class="sk-tt-name">${prof.icon} ${esc(prof.name)}</div>`;
    if (learned && skill) {
      html += `<div class="sk-tt-level">Level ${skill.level} / 300</div>`;
      html += `<div class="sk-tt-bar-wrap">`;
      html += `<div class="sk-tt-bar"><div class="sk-tt-bar-fill" style="width:${skill.progress}%"></div></div>`;
      html += `<div class="sk-tt-bar-label">${Math.round(skill.progress)}%</div>`;
      html += `</div>`;
      html += `<div class="sk-tt-xp">XP: ${skill.xp.toLocaleString()}</div>`;
      html += `<div class="sk-tt-actions">Actions: ${skill.actions.toLocaleString()}</div>`;
      html += `<div class="sk-tt-hint">Click to view recipes</div>`;
    } else {
      html += `<div class="sk-tt-locked">Not learned</div>`;
      html += `<div class="sk-tt-hint">Visit a profession trainer · click to preview recipes</div>`;
    }

    this.profTooltip.innerHTML = html;
    this.profTooltip.style.display = "block";

    const cellRect = cell.getBoundingClientRect();
    const ttRect = this.profTooltip.getBoundingClientRect();
    let left = cellRect.left - ttRect.width - 8;
    let top = cellRect.top;
    if (left < 4) { left = cellRect.left; top = cellRect.bottom + 4; }
    top = Math.min(top, window.innerHeight - ttRect.height - 4);
    top = Math.max(4, top);

    this.profTooltip.style.left = `${left}px`;
    this.profTooltip.style.top = `${top}px`;
  }

  private renderFarm() {
    const d = this.lastFarmData;
    if (!d) {
      this.farmScroll.innerHTML = `<div class="fm-loading">Loading farm data...</div>`;
      return;
    }

    let html = "";

    // ── Your Plot ──────────────────────────────────────────────
    html += `<div class="sk-section-head">`;
    html += `<span class="sk-section-title">\u{1F331} Your Plot</span>`;
    html += `</div>`;

    if (d.plot?.owned) {
      const p = d.plot;
      const zone = p.zoneId ?? "unknown";
      const stage = p.buildingStage ?? 0;
      const building = p.buildingType ?? "empty";
      const claimed = p.claimedAt ? new Date(p.claimedAt).toLocaleDateString() : "—";
      const stageLabel = stage === 0 ? "Empty" : stage === 1 ? "Foundation" : stage === 2 ? "Framed" : stage === 3 ? "Roofed" : `Stage ${stage}`;
      html += `<div class="fm-plot-card">`;
      html += `<div class="fm-plot-row"><span class="fm-plot-label">Plot</span><span class="fm-plot-val">${esc(p.plotId ?? "—")}</span></div>`;
      html += `<div class="fm-plot-row"><span class="fm-plot-label">Zone</span><span class="fm-plot-val">${esc(zone)}</span></div>`;
      html += `<div class="fm-plot-row"><span class="fm-plot-label">Building</span><span class="fm-plot-val">${esc(building)}</span></div>`;
      html += `<div class="fm-plot-row"><span class="fm-plot-label">Stage</span><span class="fm-plot-val fm-stage">${esc(stageLabel)}</span></div>`;
      html += `<div class="fm-plot-row"><span class="fm-plot-label">Claimed</span><span class="fm-plot-val fm-dim">${claimed}</span></div>`;
      html += `<div class="fm-stage-bar">`;
      for (let i = 0; i < 4; i++) {
        html += `<div class="fm-stage-pip${i < stage ? " fm-pip-done" : ""}"></div>`;
      }
      html += `</div>`;
      html += `</div>`;
    } else {
      html += `<div class="fm-no-plot">`;
      html += `<div class="fm-no-plot-icon">\u{1FAB5}</div>`;
      html += `<div class="fm-no-plot-title">No plot claimed</div>`;
      html += `<div class="fm-no-plot-steps">`;
      html += `<div class="fm-step"><span class="fm-step-num">1</span>Travel to <b>sunflower-fields</b></div>`;
      html += `<div class="fm-step"><span class="fm-step-num">2</span>Talk to <b>Farmhand Amos</b> for a quest</div>`;
      html += `<div class="fm-step"><span class="fm-step-num">3</span>Complete quest, visit <b>Plot Registrar Helga</b></div>`;
      html += `<div class="fm-step"><span class="fm-step-num">4</span>Claim a plot for <b>25–50 gold</b></div>`;
      html += `</div>`;
      html += `</div>`;
    }

    // ── Crop Nodes ─────────────────────────────────────────────
    const zone = d.currentZoneId ? esc(d.currentZoneId) : "current zone";
    html += `<div class="sk-section-head" style="margin-top:6px">`;
    html += `<span class="sk-section-title">\u{1F33E} Crop Nodes — ${zone}</span>`;
    html += `</div>`;

    if (d.nodes.length === 0) {
      html += `<div class="fm-loading">No crop nodes in this zone</div>`;
    } else {
      html += `<div class="fm-nodes">`;
      for (const n of d.nodes) {
        const dep = n.depleted;
        const pct = n.maxCharges > 0 ? Math.round((n.charges / n.maxCharges) * 100) : 0;
        const tierStr = `T${n.requiredHoeTier}`;
        html += `<div class="fm-node${dep ? " fm-node-dep" : ""}">`;
        html += `<span class="fm-node-icon">${dep ? "\u{1F534}" : "\u{1F7E2}"}</span>`;
        html += `<div class="fm-node-info">`;
        html += `<div class="fm-node-name">${esc(n.name)}</div>`;
        html += `<div class="fm-node-bar-wrap">`;
        if (dep) {
          html += `<span class="fm-node-dep-label">Depleted</span>`;
        } else {
          html += `<div class="fm-node-bar"><div class="fm-node-bar-fill" style="width:${pct}%"></div></div>`;
          html += `<span class="fm-node-charges">${n.charges}/${n.maxCharges}</span>`;
        }
        html += `</div>`;
        html += `</div>`;
        html += `<span class="fm-node-tier">${tierStr}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    this.farmScroll.innerHTML = html;
  }

  private injectStyles() {
    if (document.getElementById("sk-panel-styles")) return;
    const style = document.createElement("style");
    style.id = "sk-panel-styles";
    style.textContent = `
      #skills-panel {
        position: fixed;
        bottom: 64px;
        right: 12px;
        width: 280px;
        max-height: calc(100vh - 120px);
        background: rgba(10, 16, 28, 0.94);
        border: 1px solid rgba(68, 255, 136, 0.2);
        border-radius: 8px;
        z-index: 16;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }

      .sk-tabs {
        display: flex;
        align-items: center;
        border-bottom: 1px solid rgba(68, 255, 136, 0.15);
        flex-shrink: 0;
      }
      .sk-drag-handle {
        width: 26px;
        flex: 0 0 26px;
        text-align: center;
        color: #6b8;
        font: bold 10px/1 monospace;
        letter-spacing: 1px;
        user-select: none;
        cursor: move;
        border-right: 1px solid rgba(68, 255, 136, 0.15);
      }
      .sk-tab {
        flex: 1;
        padding: 8px 0;
        background: none;
        border: none;
        color: #667;
        font: bold 12px monospace;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s;
        border-bottom: 2px solid transparent;
      }
      .sk-tab:hover { color: #aab; }
      .sk-tab.active { color: #4f8; border-bottom-color: #4f8; }
      .sk-close {
        flex: 0 0 32px;
        background: rgba(255, 100, 100, 0.12);
        border: none;
        border-left: 1px solid rgba(68, 255, 136, 0.15);
        color: #f88;
        font: bold 16px monospace;
        line-height: 1;
        cursor: pointer;
        padding: 8px 0;
      }
      .sk-close:hover { background: rgba(255, 100, 100, 0.28); color: #fff; }

      .sk-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .sk-grid {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(68, 255, 136, 0.2) transparent;
      }

      .sk-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.12s;
      }
      .sk-cell:hover { background: rgba(50, 65, 85, 0.6); }
      .sk-learned { background: rgba(30, 40, 55, 0.7); }
      .sk-locked { background: rgba(20, 25, 35, 0.5); opacity: 0.5; }

      .sk-cell-icon { font-size: 20px; width: 28px; text-align: center; flex-shrink: 0; }
      .sk-cell-info { flex: 1; min-width: 0; }
      .sk-cell-name { font-size: 11px; color: #bbc; font-weight: bold; }
      .sk-cell-level { font-size: 18px; font-weight: bold; color: #ffcc44; text-align: right; min-width: 30px; }
      .sk-cell-level-locked { color: #556; font-size: 14px; }

      .sk-cell-bar {
        height: 3px;
        background: rgba(80, 90, 110, 0.4);
        border-radius: 2px;
        margin-top: 2px;
        overflow: hidden;
      }
      .sk-cell-bar-fill {
        height: 100%;
        background: #4f8;
        border-radius: 2px;
        transition: width 0.3s;
      }

      /* Skills tab */
      .sk-skills-scroll {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(68, 255, 136, 0.2) transparent;
      }
      .sk-section-head {
        display: flex; flex-direction: column;
        padding: 8px 10px 4px;
        border-bottom: 1px solid rgba(68, 255, 136, 0.1);
      }
      .sk-section-title {
        color: #4f8; font: bold 11px monospace;
        text-transform: uppercase; letter-spacing: 0.5px;
      }
      .sk-section-hint {
        color: #667; font: 10px monospace; font-style: italic; margin-top: 1px;
      }

      /* Tooltip (profession) */
      .sk-tooltip {
        position: fixed;
        z-index: 100;
        background: rgba(8, 12, 22, 0.96);
        border: 1px solid rgba(68, 255, 136, 0.3);
        border-radius: 6px;
        padding: 8px 10px;
        font: 11px monospace;
        color: #ccc;
        max-width: 200px;
        pointer-events: none;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      }
      .sk-tt-name { font-weight: bold; font-size: 13px; color: #ffcc44; margin-bottom: 4px; }
      .sk-tt-level { color: #bbc; font-size: 11px; margin-bottom: 4px; }
      .sk-tt-bar-wrap { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
      .sk-tt-bar { flex: 1; height: 6px; background: rgba(80, 90, 110, 0.5); border-radius: 3px; overflow: hidden; }
      .sk-tt-bar-fill { height: 100%; background: #4f8; border-radius: 3px; }
      .sk-tt-bar-label { color: #4f8; font-size: 10px; min-width: 28px; text-align: right; }
      .sk-tt-xp { color: #997; font-size: 10px; }
      .sk-tt-actions { color: #997; font-size: 10px; }
      .sk-tt-locked { color: #665; font-size: 11px; margin-bottom: 2px; }
      .sk-tt-hint { color: #556; font-size: 10px; font-style: italic; }

      /* Farm tab */
      .fm-loading { padding: 12px 10px; color: #556; font-size: 11px; font-style: italic; }

      .fm-plot-card {
        margin: 6px 8px;
        background: rgba(30, 45, 25, 0.5);
        border: 1px solid rgba(80, 180, 80, 0.2);
        border-radius: 5px;
        padding: 8px 10px;
      }
      .fm-plot-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .fm-plot-label { color: #778; font-size: 10px; }
      .fm-plot-val { color: #bdc; font-size: 11px; font-weight: bold; }
      .fm-stage { color: #8fa; }
      .fm-dim { color: #667; font-weight: normal; }
      .fm-stage-bar { display: flex; gap: 3px; margin-top: 6px; }
      .fm-stage-pip { flex: 1; height: 4px; background: rgba(80,100,80,0.4); border-radius: 2px; }
      .fm-pip-done { background: #5c9; }

      .fm-no-plot {
        margin: 6px 8px;
        background: rgba(25, 30, 20, 0.5);
        border: 1px solid rgba(68, 255, 136, 0.1);
        border-radius: 5px;
        padding: 10px;
        text-align: center;
      }
      .fm-no-plot-icon { font-size: 24px; margin-bottom: 4px; }
      .fm-no-plot-title { color: #8a9; font-size: 11px; font-weight: bold; margin-bottom: 8px; }
      .fm-no-plot-steps { text-align: left; }
      .fm-step { display: flex; align-items: flex-start; gap: 6px; color: #99a; font-size: 10px; margin-bottom: 5px; line-height: 1.4; }
      .fm-step b { color: #bdc; }
      .fm-step-num {
        flex-shrink: 0;
        width: 16px; height: 16px;
        background: rgba(68, 255, 136, 0.15);
        border-radius: 50%;
        text-align: center; line-height: 16px;
        color: #4f8; font-size: 9px; font-weight: bold;
      }

      .fm-nodes { display: flex; flex-direction: column; gap: 2px; padding: 4px 8px 8px; }
      .fm-node {
        display: flex; align-items: center; gap: 7px;
        padding: 5px 7px;
        background: rgba(30, 40, 25, 0.55);
        border-radius: 4px;
        border: 1px solid rgba(80, 180, 80, 0.15);
      }
      .fm-node-dep { opacity: 0.45; }
      .fm-node-icon { font-size: 12px; flex-shrink: 0; }
      .fm-node-info { flex: 1; min-width: 0; }
      .fm-node-name { font-size: 10px; color: #bdc; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .fm-node-bar-wrap { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
      .fm-node-bar { flex: 1; height: 3px; background: rgba(60,80,50,0.5); border-radius: 2px; overflow: hidden; }
      .fm-node-bar-fill { height: 100%; background: #5c9; border-radius: 2px; transition: width 0.3s; }
      .fm-node-charges { color: #7a9; font-size: 9px; min-width: 24px; text-align: right; }
      .fm-node-dep-label { color: #a66; font-size: 9px; font-style: italic; }
      .fm-node-tier { color: #667; font-size: 9px; flex-shrink: 0; }
    `;
    document.head.appendChild(style);
  }
}
