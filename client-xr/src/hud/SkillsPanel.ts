import type { ProfessionStatusResponse, ProfessionSkillSummary } from "../types.js";
import { LearnedTechniquesList, type LearnedTechnique } from "./LearnedTechniquesList.js";
import { EdictEditor, type Edict } from "./EdictEditor.js";

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

export type SkillsTab = "professions" | "skills" | "edicts";

export interface SkillsPanelCallbacks {
  /** Save the full edict list. */
  saveEdicts: (edicts: Edict[]) => Promise<{ ok: boolean; error?: string }>;
  /** Fired when the user switches tabs — host may kick polling. */
  onTabChange?: (tab: SkillsTab) => void;
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
      <button class="sk-tab active" data-tab="professions">Professions</button>
      <button class="sk-tab" data-tab="skills">Skills</button>
      <button class="sk-tab" data-tab="edicts">Edicts</button>
    `;
    this.tabBar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".sk-tab") as HTMLButtonElement | null;
      if (!btn) return;
      const tab = btn.dataset.tab as SkillsTab;
      if (tab === this.activeTab) return;
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

  getActiveTab(): SkillsTab {
    return this.activeTab;
  }

  toggle() {
    if (this.container.style.display === "none") {
      this.container.style.display = "flex";
    } else {
      this.hide();
    }
  }

  show() { this.container.style.display = "flex"; }

  hide() {
    this.container.style.display = "none";
    this.profTooltip.style.display = "none";
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  // ── Internals ─────────────────────────────────────────────────

  private applyActiveTab() {
    this.bodyEl.innerHTML = "";
    if (this.activeTab === "professions") {
      this.bodyEl.appendChild(this.profGrid);
      this.profTooltip.style.display = "none";
    } else if (this.activeTab === "skills") {
      this.bodyEl.appendChild(this.skillsScroll);
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
    } else {
      html += `<div class="sk-tt-locked">Not learned</div>`;
      html += `<div class="sk-tt-hint">Visit a profession trainer to learn</div>`;
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
        border-bottom: 1px solid rgba(68, 255, 136, 0.15);
        flex-shrink: 0;
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
    `;
    document.head.appendChild(style);
  }
}
