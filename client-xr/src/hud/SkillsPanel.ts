import type { ProfessionStatusResponse, ProfessionSkillSummary } from "../types.js";

const PROFESSIONS: { id: string; name: string; icon: string }[] = [
  { id: "mining",          name: "Mining",          icon: "\u26CF"          }, // pick
  { id: "herbalism",       name: "Herbalism",       icon: "\u{1F33F}"      }, // herb
  { id: "skinning",        name: "Skinning",        icon: "\u{1F9F6}"      }, // yarn/hide
  { id: "blacksmithing",   name: "Blacksmithing",   icon: "\u2692"          }, // hammer+pick
  { id: "alchemy",         name: "Alchemy",         icon: "\u{1F9EA}"      }, // test tube
  { id: "cooking",         name: "Cooking",         icon: "\u{1F372}"      }, // pot of food
  { id: "leatherworking",  name: "Leatherworking",  icon: "\u{1F4DC}"      }, // scroll
  { id: "jewelcrafting",   name: "Jewelcrafting",   icon: "\u{1F48E}"      }, // gem
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export class SkillsPanel {
  private container: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private tooltipEl: HTMLDivElement;

  private learnedIds: Set<string> = new Set();
  private skills: Record<string, ProfessionSkillSummary> = {};

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "skills-panel";
    this.container.style.display = "none";

    // Header
    const header = document.createElement("div");
    header.className = "sk-header";
    header.innerHTML = `<span class="sk-title">Skills</span>`;
    this.container.appendChild(header);

    // Grid
    this.gridEl = document.createElement("div");
    this.gridEl.className = "sk-grid";
    this.container.appendChild(this.gridEl);

    // Tooltip
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "sk-tooltip";
    this.tooltipEl.style.display = "none";
    document.body.appendChild(this.tooltipEl);

    document.body.appendChild(this.container);
    this.injectStyles();
    this.render();

    // Hover
    this.gridEl.addEventListener("mouseover", (e) => {
      const cell = (e.target as HTMLElement).closest(".sk-cell") as HTMLElement;
      if (!cell?.dataset.prof) return;
      this.showTooltip(cell.dataset.prof, cell);
    });
    this.gridEl.addEventListener("mouseout", (e) => {
      const cell = (e.target as HTMLElement).closest(".sk-cell") as HTMLElement;
      if (!cell) return;
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related && cell.contains(related)) return;
      this.tooltipEl.style.display = "none";
    });
  }

  updateProfessions(data: ProfessionStatusResponse) {
    this.learnedIds = new Set(data.professions);
    this.skills = data.skills ?? {};
    this.render();
  }

  toggle() {
    if (this.container.style.display === "none") {
      this.container.style.display = "flex";
    } else {
      this.container.style.display = "none";
      this.tooltipEl.style.display = "none";
    }
  }

  show() { this.container.style.display = "flex"; }
  hide() { this.container.style.display = "none"; this.tooltipEl.style.display = "none"; }
  isVisible(): boolean { return this.container.style.display !== "none"; }

  private render() {
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
    this.gridEl.innerHTML = html;
  }

  private showTooltip(profId: string, cell: HTMLElement) {
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

    this.tooltipEl.innerHTML = html;
    this.tooltipEl.style.display = "block";

    const cellRect = cell.getBoundingClientRect();
    const ttRect = this.tooltipEl.getBoundingClientRect();
    let left = cellRect.left - ttRect.width - 8;
    let top = cellRect.top;
    if (left < 4) { left = cellRect.left; top = cellRect.bottom + 4; }
    top = Math.min(top, window.innerHeight - ttRect.height - 4);
    top = Math.max(4, top);

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #skills-panel {
        position: fixed;
        bottom: 64px;
        right: 12px;
        width: 240px;
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

      .sk-header {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(68, 255, 136, 0.15);
      }
      .sk-title { color: #4f8; font-weight: bold; font-size: 13px; }

      .sk-grid {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px;
        overflow-y: auto;
        max-height: calc(100vh - 200px);
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

      /* Tooltip */
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
