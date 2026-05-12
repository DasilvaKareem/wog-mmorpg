import type { ActiveEffect, Entity } from "../types.js";

interface RenderedTile {
  el: HTMLDivElement;
  timerEl: HTMLSpanElement;
  fillEl: HTMLDivElement | null;
  effect: ActiveEffect;
}

const TYPE_ORDER: Record<ActiveEffect["type"], number> = {
  buff: 0,
  hot: 1,
  shield: 2,
  debuff: 3,
  dot: 4,
};

const TYPE_LABEL: Record<ActiveEffect["type"], string> = {
  buff: "Buff",
  hot: "Heal over time",
  shield: "Shield",
  debuff: "Debuff",
  dot: "Damage over time",
};

const TYPE_GLYPH: Record<ActiveEffect["type"], string> = {
  buff: "B",
  hot: "H",
  shield: "S",
  debuff: "D",
  dot: "•",
};

export class BuffBar {
  private readonly root: HTMLDivElement;
  private readonly buffRow: HTMLDivElement;
  private readonly divider: HTMLDivElement;
  private readonly debuffRow: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private readonly tiles = new Map<string, RenderedTile>();
  private hoveredKey: string | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "buff-bar";
    this.root.style.display = "none";

    this.buffRow = document.createElement("div");
    this.buffRow.className = "bb-row bb-buffs";

    this.divider = document.createElement("div");
    this.divider.className = "bb-divider";
    this.divider.style.display = "none";

    this.debuffRow = document.createElement("div");
    this.debuffRow.className = "bb-row bb-debuffs";

    this.root.appendChild(this.buffRow);
    this.root.appendChild(this.divider);
    this.root.appendChild(this.debuffRow);
    document.body.appendChild(this.root);

    this.tooltip = document.createElement("div");
    this.tooltip.id = "buff-bar-tooltip";
    this.tooltip.style.display = "none";
    document.body.appendChild(this.tooltip);

    this.injectStyles();
  }

  update(own: Entity | null | undefined): void {
    const effects = own?.activeEffects ?? [];
    if (effects.length === 0) {
      if (this.root.style.display !== "none") this.root.style.display = "none";
      this.clearTooltip();
      this.removeAllTiles();
      return;
    }
    if (this.root.style.display === "none") this.root.style.display = "";

    const sorted = [...effects].sort((a, b) => {
      const ord = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
      if (ord !== 0) return ord;
      return (b.remainingTicks - a.remainingTicks) || a.id.localeCompare(b.id);
    });

    const nextKeys = new Set<string>();
    const buffs: ActiveEffect[] = [];
    const debuffs: ActiveEffect[] = [];
    for (const fx of sorted) {
      nextKeys.add(this.keyFor(fx));
      if (fx.type === "debuff" || fx.type === "dot") debuffs.push(fx);
      else buffs.push(fx);
    }

    for (const [key, tile] of this.tiles) {
      if (!nextKeys.has(key)) {
        tile.el.remove();
        this.tiles.delete(key);
        if (this.hoveredKey === key) this.clearTooltip();
      }
    }

    this.syncRow(this.buffRow, buffs);
    this.syncRow(this.debuffRow, debuffs);

    this.divider.style.display = buffs.length > 0 && debuffs.length > 0 ? "" : "none";

    if (this.hoveredKey) {
      const tile = this.tiles.get(this.hoveredKey);
      if (tile) this.renderTooltipFor(tile.effect);
    }
  }

  private syncRow(row: HTMLDivElement, list: ActiveEffect[]): void {
    let prev: HTMLElement | null = null;
    for (const fx of list) {
      const key = this.keyFor(fx);
      let tile = this.tiles.get(key);
      if (!tile) {
        tile = this.createTile(fx);
        this.tiles.set(key, tile);
      }
      tile.effect = fx;
      this.updateTile(tile, fx);

      if (tile.el.parentElement !== row) {
        row.appendChild(tile.el);
      } else if (prev ? prev.nextElementSibling !== tile.el : row.firstElementChild !== tile.el) {
        row.insertBefore(tile.el, prev ? prev.nextElementSibling : row.firstElementChild);
      }
      prev = tile.el;
    }
  }

  private createTile(fx: ActiveEffect): RenderedTile {
    const el = document.createElement("div");
    el.className = `bb-tile bb-${fx.type}`;

    const glyph = document.createElement("span");
    glyph.className = "bb-glyph";
    glyph.textContent = TYPE_GLYPH[fx.type] ?? "?";

    const timerEl = document.createElement("span");
    timerEl.className = "bb-timer";

    const fillTrack = document.createElement("div");
    fillTrack.className = "bb-track";
    const fillEl = document.createElement("div");
    fillEl.className = "bb-fill";
    fillTrack.appendChild(fillEl);

    el.appendChild(glyph);
    el.appendChild(timerEl);
    el.appendChild(fillTrack);

    const key = this.keyFor(fx);
    el.addEventListener("mouseenter", () => {
      this.hoveredKey = key;
      const tile = this.tiles.get(key);
      if (tile) {
        this.positionTooltip(tile.el);
        this.renderTooltipFor(tile.effect);
      }
    });
    el.addEventListener("mouseleave", () => {
      if (this.hoveredKey === key) this.clearTooltip();
    });
    el.addEventListener("mousemove", () => {
      const tile = this.tiles.get(key);
      if (tile) this.positionTooltip(tile.el);
    });

    return { el, timerEl, fillEl, effect: fx };
  }

  private updateTile(tile: RenderedTile, fx: ActiveEffect): void {
    const isShield = fx.type === "shield";
    const shieldMax = fx.shieldMaxHp ?? fx.maxShieldHp;

    if (isShield && fx.shieldHp != null && shieldMax) {
      tile.timerEl.textContent = `${Math.max(0, Math.round(fx.shieldHp))}`;
    } else {
      const secs = Math.max(0, Math.ceil(fx.remainingTicks));
      tile.timerEl.textContent = `${secs}s`;
      tile.timerEl.classList.toggle("bb-timer-low", secs > 0 && secs <= 3);
    }

    if (tile.fillEl) {
      let pct: number | null = null;
      if (isShield && fx.shieldHp != null && shieldMax) {
        pct = Math.max(0, Math.min(1, fx.shieldHp / shieldMax));
      } else if (fx.durationTicks && fx.durationTicks > 0) {
        pct = Math.max(0, Math.min(1, fx.remainingTicks / fx.durationTicks));
      }
      if (pct == null) {
        tile.fillEl.style.display = "none";
      } else {
        tile.fillEl.style.display = "";
        tile.fillEl.style.width = `${pct * 100}%`;
      }
    }
  }

  private renderTooltipFor(fx: ActiveEffect): void {
    const shieldMax = fx.shieldMaxHp ?? fx.maxShieldHp;
    const lines: string[] = [];
    lines.push(`<div class="bbt-name bbt-${fx.type}">${escapeHtml(fx.name)}</div>`);
    lines.push(`<div class="bbt-kind">${TYPE_LABEL[fx.type] ?? fx.type}</div>`);

    if (fx.statModifiers) {
      const parts = Object.entries(fx.statModifiers)
        .filter(([, v]) => v != null && v !== 0)
        .map(([stat, v]) => {
          const n = v ?? 0;
          return `${n > 0 ? "+" : ""}${n}% ${stat}`;
        });
      if (parts.length > 0) {
        lines.push(`<div class="bbt-line">${escapeHtml(parts.join(", "))}</div>`);
      }
    }
    if (fx.dotDamage) {
      lines.push(`<div class="bbt-line bbt-dot">${fx.dotDamage} damage every second</div>`);
    }
    if (fx.hotHealPerTick) {
      lines.push(`<div class="bbt-line bbt-hot">+${fx.hotHealPerTick} HP every second</div>`);
    }
    if (fx.shieldHp != null && shieldMax) {
      lines.push(
        `<div class="bbt-line bbt-shield">Absorbs ${Math.max(0, Math.round(fx.shieldHp))} / ${shieldMax} damage</div>`,
      );
    }

    if (fx.type !== "shield") {
      const secs = Math.max(0, Math.ceil(fx.remainingTicks));
      const cls = secs <= 5 ? "bbt-foot bbt-foot-low" : "bbt-foot";
      lines.push(`<div class="${cls}">${secs}s remaining</div>`);
    }

    this.tooltip.innerHTML = lines.join("");
    this.tooltip.style.display = "block";
  }

  private positionTooltip(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    this.tooltip.style.visibility = "hidden";
    this.tooltip.style.display = "block";
    const tipRect = this.tooltip.getBoundingClientRect();
    const top = Math.max(8, Math.min(window.innerHeight - tipRect.height - 8, rect.bottom + 6));
    const left = Math.max(8, rect.right - tipRect.width);
    this.tooltip.style.top = `${top}px`;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.visibility = "";
  }

  private clearTooltip(): void {
    this.hoveredKey = null;
    this.tooltip.style.display = "none";
  }

  private removeAllTiles(): void {
    for (const tile of this.tiles.values()) tile.el.remove();
    this.tiles.clear();
  }

  private keyFor(fx: ActiveEffect): string {
    return `${fx.type}:${fx.id}`;
  }

  private injectStyles(): void {
    const s = document.createElement("style");
    s.textContent = `
      #buff-bar {
        position: fixed;
        top: 12px;
        right: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        z-index: 18;
        pointer-events: none;
        font: 11px monospace;
        color: #f3dfb3;
        background: rgba(20, 14, 8, 0.88);
        border: 1px solid rgba(255, 214, 102, 0.32);
        border-radius: 8px;
        padding: 6px 8px;
        backdrop-filter: blur(6px);
      }
      .bb-row {
        display: flex;
        gap: 4px;
      }
      .bb-row:empty { display: none; }
      .bb-divider {
        width: 1px;
        align-self: stretch;
        background: rgba(255, 214, 102, 0.22);
        margin: 2px 2px;
      }
      .bb-tile {
        position: relative;
        width: 34px;
        height: 34px;
        border-radius: 6px;
        border: 1px solid rgba(0, 0, 0, 0.5);
        background: rgba(255, 255, 255, 0.05);
        pointer-events: auto;
        cursor: help;
        overflow: hidden;
        box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
      }
      .bb-buff   { background: rgba(68,  204, 68,  0.22); border-color: #44cc44; }
      .bb-hot    { background: rgba(122, 223, 149, 0.22); border-color: #7adf95; }
      .bb-shield { background: rgba(93,  173, 236, 0.22); border-color: #5dadec; }
      .bb-debuff { background: rgba(204, 68,  68,  0.22); border-color: #cc4444; }
      .bb-dot    { background: rgba(224, 122, 58,  0.22); border-color: #e07a3a; }
      .bb-glyph {
        position: absolute;
        top: 0; left: 0; right: 0;
        text-align: center;
        line-height: 22px;
        font-size: 13px;
        font-weight: bold;
        color: #ffe8a8;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.7);
      }
      .bb-timer {
        position: absolute;
        right: 2px;
        bottom: 1px;
        font-size: 9px;
        color: #f3dfb3;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.9);
      }
      .bb-timer-low {
        color: #ffd14a;
        animation: bb-pulse 0.8s ease-in-out infinite;
      }
      @keyframes bb-pulse {
        0%, 100% { color: #ffd14a; }
        50%      { color: #ff5252; }
      }
      .bb-track {
        position: absolute;
        left: 0; right: 0; bottom: 0;
        height: 3px;
        background: rgba(0, 0, 0, 0.45);
      }
      .bb-fill {
        height: 100%;
        background: currentColor;
        transition: width 0.2s linear;
      }
      .bb-buff   .bb-fill { background: #44cc44; }
      .bb-hot    .bb-fill { background: #7adf95; }
      .bb-shield .bb-fill { background: #5dadec; }
      .bb-debuff .bb-fill { background: #cc4444; }
      .bb-dot    .bb-fill { background: #e07a3a; }

      #buff-bar-tooltip {
        position: fixed;
        max-width: 280px;
        padding: 8px 10px;
        background: rgba(8, 14, 24, 0.92);
        border: 1px solid rgba(255, 214, 102, 0.32);
        border-radius: 8px;
        color: #d9ecff;
        font: 11px/1.4 monospace;
        z-index: 19;
        pointer-events: none;
        backdrop-filter: blur(5px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
      }
      .bbt-name {
        font-size: 12px;
        font-weight: bold;
        color: #ffe8a8;
        margin-bottom: 1px;
      }
      .bbt-name.bbt-debuff, .bbt-name.bbt-dot { color: #ff9a8a; }
      .bbt-name.bbt-shield { color: #b6d9ff; }
      .bbt-kind {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 240, 207, 0.55);
        margin-bottom: 4px;
      }
      .bbt-line { margin-top: 2px; color: #e6f0ff; }
      .bbt-dot    { color: #ff7a5c; }
      .bbt-hot    { color: #7adf95; }
      .bbt-shield { color: #b6d9ff; }
      .bbt-foot {
        margin-top: 5px;
        padding-top: 4px;
        border-top: 1px dashed rgba(255, 214, 102, 0.2);
        font-size: 10px;
        color: rgba(255, 240, 207, 0.7);
      }
      .bbt-foot-low { color: #ffd14a; }

      @media (max-width: 480px) {
        #buff-bar { padding: 4px 6px; }
        .bb-tile { width: 26px; height: 26px; }
        .bb-glyph { line-height: 16px; font-size: 11px; }
        .bb-timer { font-size: 8px; }
      }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
