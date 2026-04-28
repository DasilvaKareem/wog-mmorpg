export interface LearnedTechnique {
  id: string;
  name: string;
  description?: string;
  className: string;
  type: string;
  levelRequired: number;
  essenceCost: number;
  cooldown: number;
}

const TYPE_ORDER = ["attack", "buff", "debuff", "healing"];
const TYPE_LABELS: Record<string, string> = {
  attack: "Attacks",
  buff: "Buffs",
  debuff: "Debuffs",
  healing: "Healing",
};
const TYPE_COLORS: Record<string, string> = {
  attack: "#f86",
  buff: "#4f8",
  debuff: "#c6f",
  healing: "#fc6",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Read-only list of learned techniques grouped by type.
 * Consumed by the Skills tab of SkillsPanel.
 */
export class LearnedTechniquesList {
  readonly container: HTMLDivElement;
  private techniques: LearnedTechnique[] = [];

  constructor() {
    this.container = document.createElement("div");
    this.container.className = "lt-wrap";
    this.render();
  }

  update(techniques: LearnedTechnique[]) {
    this.techniques = techniques;
    this.render();
  }

  getTechniques(): LearnedTechnique[] {
    return this.techniques;
  }

  private render() {
    if (this.techniques.length === 0) {
      this.container.innerHTML = `<div class="lt-empty">No techniques learned yet. Visit a trainer NPC to learn techniques for your class.</div>`;
      return;
    }

    const grouped: Record<string, LearnedTechnique[]> = {};
    for (const t of this.techniques) {
      const key = TYPE_ORDER.includes(t.type) ? t.type : "attack";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    }

    let html = "";
    for (const type of TYPE_ORDER) {
      const items = grouped[type];
      if (!items || items.length === 0) continue;
      items.sort((a, b) => a.levelRequired - b.levelRequired || a.name.localeCompare(b.name));
      const color = TYPE_COLORS[type] ?? "#aaa";
      html += `<div class="lt-group">`;
      html += `<div class="lt-group-header" style="color:${color}">${esc(TYPE_LABELS[type] ?? type)} <span class="lt-group-count">${items.length}</span></div>`;
      for (const t of items) {
        const cost = t.essenceCost > 0 ? `${t.essenceCost}e` : "—";
        const cd = t.cooldown > 0 ? `${t.cooldown}s` : "—";
        html += `<div class="lt-item" title="${esc(t.description ?? "")}">`;
        html += `<div class="lt-item-row">`;
        html += `<span class="lt-item-name">${esc(t.name)}</span>`;
        html += `<span class="lt-item-lvl">L${t.levelRequired}</span>`;
        html += `</div>`;
        html += `<div class="lt-item-meta"><span>Cost ${cost}</span><span>CD ${cd}</span></div>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    this.container.innerHTML = html;
  }

  static injectStyles() {
    if (document.getElementById("lt-styles")) return;
    const style = document.createElement("style");
    style.id = "lt-styles";
    style.textContent = `
      .lt-wrap { display: flex; flex-direction: column; gap: 8px; padding: 6px; }
      .lt-group { display: flex; flex-direction: column; gap: 2px; }
      .lt-group-header {
        font: bold 11px monospace;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 4px 2px 2px;
        border-bottom: 1px solid rgba(68, 255, 136, 0.1);
      }
      .lt-group-count { color: #556; font-weight: normal; font-size: 10px; margin-left: 4px; }
      .lt-item {
        padding: 4px 6px;
        background: rgba(30, 40, 55, 0.6);
        border-radius: 3px;
      }
      .lt-item + .lt-item { margin-top: 2px; }
      .lt-item-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
      .lt-item-name { color: #dde; font-size: 11px; font-weight: bold; }
      .lt-item-lvl { color: #998; font-size: 10px; flex-shrink: 0; }
      .lt-item-meta {
        display: flex; justify-content: space-between;
        color: #779; font-size: 10px; margin-top: 1px;
      }
      .lt-empty {
        padding: 16px 10px;
        text-align: center;
        color: #667;
        font-size: 11px;
        font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }
}
