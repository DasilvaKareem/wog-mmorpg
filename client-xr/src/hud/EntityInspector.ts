import type { Entity } from "../types.js";

interface EntityInspectorOptions {
  canActOnPlayer?: (entity: Entity) => boolean;
  onAddFriend?: (entity: Entity) => Promise<string>;
  onTrade?: (entity: Entity) => Promise<string>;
  onDuel?: (entity: Entity) => Promise<string>;
}

/**
 * HTML overlay panel showing inspected entity details.
 * Positioned near the entity in screen space.
 */
export class EntityInspector {
  private panel: HTMLDivElement;
  private currentEntity: Entity | null = null;
  private _locked = false;
  private readonly options: EntityInspectorOptions;
  private actionFeedback = "";
  private activeAction: "friend" | "trade" | "duel" | null = null;
  private lastAnchor: { x: number; y: number } | null = null;

  constructor(options: EntityInspectorOptions = {}) {
    this.options = options;
    this.panel = document.createElement("div");
    this.panel.id = "entity-inspector";
    this.panel.style.cssText = `
      position: fixed;
      display: none;
      background: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 12px 16px;
      color: #ddd;
      font: 13px/1.5 monospace;
      pointer-events: auto;
      z-index: 20;
      min-width: 200px;
      max-width: 300px;
      backdrop-filter: blur(4px);
      transition: opacity 0.3s, background 0.3s;
    `;
    document.body.appendChild(this.panel);
    this.panel.addEventListener("click", this.onPanelClick);

    // Close on click elsewhere
    document.addEventListener("mousedown", (e) => {
      if (e.target !== this.panel && !this.panel.contains(e.target as Node)) {
        this.hide();
      }
    });
  }

  show(entity: Entity, screenX: number, screenY: number) {
    this.currentEntity = entity;
    this.actionFeedback = "";
    this.activeAction = null;
    this.lastAnchor = { x: screenX, y: screenY };
    this.render(entity);
    this.panel.style.display = "block";

    if (this._locked) {
      this.applyLockedStyle();
    } else {
      this.applyDefaultStyle();
    }

    this.positionAt(screenX, screenY);
  }

  private positionAt(screenX: number, screenY: number) {
    // Position near click, clamped to viewport
    const w = this.panel.offsetWidth;
    const h = this.panel.offsetHeight;
    let x = screenX + 16;
    let y = screenY - h / 2;
    if (x + w > window.innerWidth - 8) x = screenX - w - 16;
    if (y < 8) y = 8;
    if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;

    this.panel.style.left = `${x}px`;
    this.panel.style.top = `${y}px`;
  }

  private render(entity: Entity) {
    this.panel.innerHTML = this.buildContent(entity);
    if (this.lastAnchor && !this._locked) {
      this.positionAt(this.lastAnchor.x, this.lastAnchor.y);
    }
  }

  /** Switch to locked mode: compact, transparent, pinned to top-right corner */
  setLocked(locked: boolean) {
    this._locked = locked;
    if (this.panel.style.display !== "none") {
      if (locked) {
        this.applyLockedStyle();
      } else {
        this.applyDefaultStyle();
      }
    }
  }

  private applyLockedStyle() {
    this.panel.style.background = "rgba(0, 0, 0, 0.35)";
    this.panel.style.border = "1px solid rgba(255, 255, 255, 0.08)";
    this.panel.style.opacity = "0.6";
    // Pin to top-right so it stays out of the way
    this.panel.style.left = "";
    this.panel.style.right = "12px";
    this.panel.style.top = "12px";
  }

  private applyDefaultStyle() {
    this.panel.style.background = "rgba(0, 0, 0, 0.85)";
    this.panel.style.border = "1px solid rgba(255, 255, 255, 0.15)";
    this.panel.style.opacity = "1";
    this.panel.style.right = "";
  }

  hide() {
    this.panel.style.display = "none";
    this.currentEntity = null;
    this.actionFeedback = "";
    this.activeAction = null;
    this.lastAnchor = null;
  }

  get inspectedEntity(): Entity | null {
    return this.currentEntity;
  }

  private buildContent(e: Entity): string {
    const typeColor = TYPE_COLORS[e.type] ?? "#ccc";
    const hpPct = e.maxHp > 0 ? Math.round((e.hp / e.maxHp) * 100) : 100;
    const hpColor = hpPct > 50 ? "#4c4" : hpPct > 25 ? "#cc4" : "#c44";

    const levelStr = e.level != null ? `Lv ${e.level}` : "";

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
        <span style="color:${typeColor}; font-weight:bold; font-size:14px;">
          ${esc(e.name)}
        </span>
        ${levelStr ? `<span style="color:#aaa; font-size:12px; margin-left:8px;">${levelStr}</span>` : ""}
      </div>
      <div style="color:#888; font-size:11px; margin-bottom:6px;">
        ${esc(e.type)}${e.partyId ? ` · <span style="color:#5cf;">In Party</span>` : ""}
      </div>
    `;

    // HP bar
    html += `
      <div style="margin-bottom:6px;">
        <div style="display:flex; justify-content:space-between; font-size:11px; color:#999;">
          <span>HP</span>
          <span style="color:${hpColor}">${e.hp} / ${e.maxHp}</span>
        </div>
        <div style="background:#333; border-radius:3px; height:6px; margin-top:2px;">
          <div style="background:${hpColor}; width:${hpPct}%; height:100%; border-radius:3px;"></div>
        </div>
      </div>
    `;

    // Player-specific info
    if (e.type === "player") {
      if (e.classId || e.raceId) {
        html += `<div style="font-size:12px; color:#aaa;">
          ${esc(e.raceId ?? "")} ${esc(e.classId ?? "")}
        </div>`;
      }
      if (e.guildName) {
        html += `<div style="font-size:11px; color:#cc8;">&lt;${esc(e.guildName)}&gt;</div>`;
      }
      if (e.equipment) {
        const slots = Object.entries(e.equipment).filter(([, v]) => v);
        if (slots.length > 0) {
          html += `<div style="margin-top:6px; font-size:11px; color:#888;">Equipment:</div>`;
          for (const [slot, item] of slots) {
            if (!item) continue;
            const qColor = QUALITY_COLORS[item.quality ?? ""] ?? "#aaa";
            html += `<div style="font-size:11px; color:${qColor};">
              ${esc(slot)}: ${esc(item.name ?? `#${item.tokenId}`)}
            </div>`;
          }
        }
      }
    }

    if (e.type === "player" && this.options.canActOnPlayer?.(e)) {
      html += `
        <div style="margin-top:10px; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:6px;">
          ${this.renderActionButton("friend", "Add Friend")}
          ${this.renderActionButton("trade", "Trade")}
          ${this.renderActionButton("duel", "Duel")}
        </div>
      `;
      if (this.actionFeedback) {
        html += `<div style="margin-top:8px; font-size:11px; color:#9edbff;">${esc(this.actionFeedback)}</div>`;
      }
    }

    // Position
    html += `<div style="margin-top:6px; font-size:10px; color:#666;">
      pos: ${Math.round(e.x)}, ${Math.round(e.y)}
    </div>`;

    return html;
  }

  private renderActionButton(action: "friend" | "trade" | "duel", label: string): string {
    const busy = this.activeAction === action;
    return `
      <button
        type="button"
        data-action="${action}"
        ${busy ? "disabled" : ""}
        style="padding:6px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.06); color:#dfe8ff; font:11px monospace; cursor:${busy ? "wait" : "pointer"};"
      >${busy ? "..." : label}</button>
    `;
  }

  private onPanelClick = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    if (!btn || !this.currentEntity) return;
    e.preventDefault();
    e.stopPropagation();
    const action = btn.dataset.action as "friend" | "trade" | "duel";
    void this.handleAction(action, this.currentEntity);
  };

  private async handleAction(action: "friend" | "trade" | "duel", entity: Entity) {
    const handlers = {
      friend: this.options.onAddFriend,
      trade: this.options.onTrade,
      duel: this.options.onDuel,
    } as const;
    const handler = handlers[action];
    if (!handler) return;

    this.activeAction = action;
    this.actionFeedback = "";
    this.render(entity);
    try {
      this.actionFeedback = await handler(entity);
    } catch (err) {
      this.actionFeedback = err instanceof Error ? err.message : "Action failed";
    } finally {
      this.activeAction = null;
      if (this.currentEntity?.id === entity.id) {
        this.render(this.currentEntity);
      }
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TYPE_COLORS: Record<string, string> = {
  player: "#44ddff",
  mob: "#ff6666",
  boss: "#cc66ff",
  npc: "#4488ff",
  merchant: "#ffcc00",
  "quest-giver": "#66bbff",
  "guild-registrar": "#ccbb33",
  auctioneer: "#bb8833",
  "arena-master": "#cc3333",
  "profession-trainer": "#44cc88",
  "crafting-master": "#cc8844",
  "lore-npc": "#8888cc",
};

const QUALITY_COLORS: Record<string, string> = {
  common: "#aaa",
  uncommon: "#4c4",
  rare: "#44f",
  epic: "#a4f",
  legendary: "#fa2",
};
