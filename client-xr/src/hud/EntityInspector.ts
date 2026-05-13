import type { Entity } from "../types.js";

type EquipmentItem = NonNullable<NonNullable<Entity["equipment"]>[string]>;

interface EntityInspectorOptions {
  canActOnPlayer?: (entity: Entity) => boolean;
  onAddFriend?: (entity: Entity) => Promise<string>;
  onTrade?: (entity: Entity) => Promise<string>;
  onDuel?: (entity: Entity) => Promise<string>;
  canCommandAgent?: () => boolean;
  onAgentGather?: (entity: Entity) => Promise<string>;
}

const GATHER_TYPES: Record<string, { verb: string; noun: string }> = {
  "ore-node":    { verb: "Mine",    noun: "ore vein" },
  "flower-node": { verb: "Gather",  noun: "flower"   },
  "nectar-node": { verb: "Gather",  noun: "nectar"   },
  "crop-node":   { verb: "Harvest", noun: "crop"     },
};

const SLOT_LEFT: string[] = ["helm", "chest", "gloves", "legs", "boots", "weapon"];
const SLOT_RIGHT: string[] = ["shoulders", "cape", "belt", "ring", "amulet", "shield"];

const SLOT_ICONS: Record<string, string> = {
  weapon: "\u2694",        // crossed swords
  shield: "\u{1F6E1}",     // shield
  chest: "\u{1F455}",      // shirt
  legs: "\u{1F456}",       // jeans
  boots: "\u{1F462}",      // boot
  helm: "\u{1FA96}",       // helmet
  shoulders: "\u{1FAE2}",  // shrug
  gloves: "\u{1F9E4}",     // gloves
  belt: "\u25AC",          // black rectangle (belt)
  cape: "\u{1F9E3}",       // scarf
  ring: "\u{1F48D}",       // ring
  amulet: "\u{1F4FF}",     // prayer beads
};

const SLOT_LABELS: Record<string, string> = {
  weapon: "Weapon", shield: "Off-hand", chest: "Chest", legs: "Legs",
  boots: "Boots", helm: "Head", shoulders: "Shoulders", gloves: "Hands",
  belt: "Waist", cape: "Back", ring: "Ring", amulet: "Neck",
};

/**
 * HTML overlay panel showing inspected entity details.
 * For players: WoW-style paper-doll with equipment slots + hover tooltips.
 * For other entities: compact HP/info panel.
 */
export class EntityInspector {
  private panel: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private currentEntity: Entity | null = null;
  private _locked = false;
  private readonly options: EntityInspectorOptions;
  private actionFeedback = "";
  private activeAction: "friend" | "trade" | "duel" | "gather" | null = null;
  private lastAnchor: { x: number; y: number } | null = null;

  constructor(options: EntityInspectorOptions = {}) {
    this.options = options;
    this.panel = document.createElement("div");
    this.panel.id = "entity-inspector";
    this.panel.style.cssText = `
      position: fixed;
      display: none;
      background: rgba(8, 12, 22, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      padding: 10px 14px 12px;
      color: #ddd;
      font: 13px/1.4 monospace;
      pointer-events: auto;
      z-index: 20;
      min-width: 220px;
      max-width: 360px;
      backdrop-filter: blur(6px);
      box-shadow: 0 8px 28px rgba(0,0,0,0.6);
      transition: opacity 0.2s, background 0.2s;
    `;
    document.body.appendChild(this.panel);

    this.tooltip = document.createElement("div");
    this.tooltip.id = "entity-inspector-tooltip";
    this.tooltip.style.cssText = `
      position: fixed;
      display: none;
      z-index: 21;
      background: rgba(8, 12, 22, 0.97);
      border: 1px solid rgba(68, 255, 136, 0.3);
      border-radius: 6px;
      padding: 8px 10px;
      font: 11px monospace;
      color: #ccc;
      max-width: 240px;
      pointer-events: none;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    `;
    document.body.appendChild(this.tooltip);

    this.injectStyles();

    this.panel.addEventListener("click", this.onPanelClick);
    this.panel.addEventListener("mouseover", this.onPanelHover);
    this.panel.addEventListener("mouseout", this.onPanelLeave);

    // Close on outside click — desktop + mobile
    const dismissIfOutside = (target: EventTarget | null) => {
      if (target !== this.panel && !this.panel.contains(target as Node)) {
        this.hide();
      }
    };
    document.addEventListener("mousedown", (e) => dismissIfOutside(e.target));
    document.addEventListener("touchstart", (e) => dismissIfOutside(e.target), { passive: true });

    // Escape closes the panel
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.panel.style.display !== "none") {
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
    const w = this.panel.offsetWidth;
    const h = this.panel.offsetHeight;

    // For player paper-doll (taller content) center horizontally near click.
    const isWide = (this.currentEntity?.type === "player") && !!this.currentEntity?.equipment;

    let x: number;
    let y: number;
    if (isWide) {
      // Try centered around click; clamp.
      x = screenX - w / 2;
      y = Math.max(8, screenY - h / 2);
    } else {
      x = screenX + 16;
      y = screenY - h / 2;
      if (x + w > window.innerWidth - 8) x = screenX - w - 16;
    }
    if (x < 8) x = 8;
    if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
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
    this.panel.style.left = "";
    this.panel.style.right = "12px";
    this.panel.style.top = "12px";
  }

  private applyDefaultStyle() {
    this.panel.style.background = "rgba(8, 12, 22, 0.95)";
    this.panel.style.border = "1px solid rgba(255, 255, 255, 0.18)";
    this.panel.style.opacity = "1";
    this.panel.style.right = "";
  }

  hide() {
    this.panel.style.display = "none";
    this.tooltip.style.display = "none";
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
    const closeBtn = `<button type="button" data-action="close" aria-label="Close" style="
      position:absolute; top:6px; right:8px;
      width:26px; height:26px;
      border:1px solid rgba(255,255,255,0.18);
      border-radius:6px;
      background:rgba(255,255,255,0.05);
      color:#bbb; font:bold 14px monospace; line-height:1;
      cursor:pointer; padding:0;
    ">×</button>`;

    let html = `${closeBtn}`;
    html += `
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px; padding-right:30px;">
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
        html += this.renderPaperDoll(e);
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

    const gather = GATHER_TYPES[e.type];
    if (gather && this.options.onAgentGather && this.options.canCommandAgent?.()) {
      const busy = this.activeAction === "gather";
      html += `
        <div style="margin-top:10px;">
          <button
            type="button"
            data-action="gather"
            ${busy ? "disabled" : ""}
            style="width:100%; padding:7px 10px; border-radius:6px; border:1px solid rgba(120,220,160,0.35); background:rgba(80,180,120,0.18); color:#b7f2cc; font:bold 11px monospace; cursor:${busy ? "wait" : "pointer"}; letter-spacing:0.04em;"
          >${busy ? "..." : `${esc(gather.verb)} with your agent`}</button>
        </div>
      `;
      if (this.actionFeedback) {
        html += `<div style="margin-top:8px; font-size:11px; color:#b7f2cc;">${esc(this.actionFeedback)}</div>`;
      }
    }

    if (e.type !== "player") {
      html += `<div style="margin-top:6px; font-size:10px; color:#666;">
        pos: ${Math.round(e.x)}, ${Math.round(e.y)}
      </div>`;
    }

    return html;
  }

  private renderPaperDoll(e: Entity): string {
    const equipment = e.equipment ?? {};
    const slotCell = (slot: string): string => {
      const item = equipment[slot];
      const icon = SLOT_ICONS[slot] ?? "?";
      const label = SLOT_LABELS[slot] ?? slot;
      if (!item) {
        return `<div class="ei-slot ei-slot-empty" data-slot="${esc(slot)}" title="${esc(label)} (empty)">
          <span class="ei-slot-icon ei-empty">${icon}</span>
        </div>`;
      }
      const qColor = QUALITY_COLORS[(item.quality ?? "").toLowerCase()] ?? QUALITY_COLORS.common;
      const broken = item.broken ? `<span class="ei-slot-broken" title="Broken">!</span>` : "";
      return `<div class="ei-slot" data-slot="${esc(slot)}" style="border-color:${qColor}">
        <span class="ei-slot-icon">${icon}</span>
        ${broken}
      </div>`;
    };

    const leftHtml = SLOT_LEFT.map(slotCell).join("");
    const rightHtml = SLOT_RIGHT.map(slotCell).join("");

    return `
      <div class="ei-paperdoll">
        <div class="ei-paperdoll-col">${leftHtml}</div>
        <div class="ei-paperdoll-center">
          <div class="ei-paperdoll-portrait">${esc(initials(e.name))}</div>
          <div class="ei-paperdoll-classline">${esc(e.classId ?? "")}</div>
        </div>
        <div class="ei-paperdoll-col">${rightHtml}</div>
      </div>
    `;
  }

  private injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      .ei-paperdoll {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        margin-top: 8px;
        align-items: center;
      }
      .ei-paperdoll-col {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .ei-paperdoll-center {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 6px;
        background: rgba(255,255,255,0.03);
        border-radius: 6px;
        min-height: 200px;
      }
      .ei-paperdoll-portrait {
        width: 60px; height: 60px;
        border-radius: 50%;
        background: rgba(68,221,255,0.15);
        border: 2px solid rgba(68,221,255,0.4);
        display: flex; align-items: center; justify-content: center;
        font: bold 22px monospace;
        color: #44ddff;
      }
      .ei-paperdoll-classline {
        font-size: 10px;
        color: #999;
        text-transform: capitalize;
        text-align: center;
      }
      .ei-slot {
        width: 38px; height: 38px;
        border: 2px solid #555;
        border-radius: 5px;
        background: rgba(30,40,55,0.7);
        display: flex; align-items: center; justify-content: center;
        position: relative;
        cursor: help;
        transition: background 0.12s, transform 0.12s;
      }
      .ei-slot:hover { background: rgba(50,65,85,0.95); transform: scale(1.06); }
      .ei-slot-empty {
        border-color: rgba(80,90,110,0.25);
        background: rgba(30,40,55,0.4);
        cursor: default;
      }
      .ei-slot-icon { font-size: 18px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
      .ei-slot-icon.ei-empty { opacity: 0.25; }
      .ei-slot-broken {
        position: absolute; top: -3px; right: -3px;
        background: #c44; color: white;
        font: bold 10px monospace;
        border-radius: 50%;
        width: 14px; height: 14px;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 4px rgba(0,0,0,0.6);
      }
      @media (max-width: 480px) {
        #entity-inspector { max-width: calc(100vw - 24px) !important; }
        .ei-paperdoll-center { min-height: 140px; }
        .ei-paperdoll-portrait { width: 44px; height: 44px; font-size: 16px; }
      }
    `;
    document.head.appendChild(style);
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
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const action = btn.dataset.action as "friend" | "trade" | "duel" | "gather" | "close";
    if (action === "close") {
      this.hide();
      return;
    }
    if (!this.currentEntity) return;
    void this.handleAction(action, this.currentEntity);
  };

  private onPanelHover = (e: MouseEvent) => {
    const slot = (e.target as HTMLElement).closest<HTMLElement>(".ei-slot");
    if (!slot || !this.currentEntity?.equipment) return;
    const slotName = slot.dataset.slot;
    if (!slotName) return;
    const item = this.currentEntity.equipment[slotName];
    this.showTooltip(slotName, item, slot);
  };

  private onPanelLeave = (e: MouseEvent) => {
    const slot = (e.target as HTMLElement).closest<HTMLElement>(".ei-slot");
    if (!slot) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && slot.contains(related)) return;
    this.tooltip.style.display = "none";
  };

  private showTooltip(slotName: string, item: EquipmentItem | undefined, cell: HTMLElement) {
    const label = SLOT_LABELS[slotName] ?? slotName;
    let html = "";
    if (!item) {
      html = `<div style="color:#888"><b>${esc(label)}</b><div style="margin-top:2px; font-size:10px; color:#667">Empty slot</div></div>`;
    } else {
      const quality = (item.quality ?? "common").toLowerCase();
      const qColor = QUALITY_COLORS[quality] ?? QUALITY_COLORS.common;
      const name = item.name ?? `Item #${item.tokenId}`;
      html += `<div style="color:${qColor}; font-weight:bold; font-size:12px;">${esc(name)}</div>`;
      html += `<div style="color:#778; font-size:10px; margin-bottom:4px; text-transform:capitalize;">${esc(quality)} · ${esc(label)}</div>`;
      if (item.durability != null && item.maxDurability != null && item.maxDurability > 0) {
        const dPct = Math.round((item.durability / item.maxDurability) * 100);
        const dColor = dPct > 50 ? "#4c4" : dPct > 20 ? "#cc4" : "#c44";
        html += `<div style="font-size:10px; color:${dColor};">Durability: ${item.durability}/${item.maxDurability}</div>`;
        html += `<div style="background:#333; border-radius:2px; height:3px; margin-top:2px; width:100%;"><div style="background:${dColor}; width:${dPct}%; height:100%; border-radius:2px;"></div></div>`;
      }
      if (item.broken) {
        html += `<div style="font-size:10px; color:#c44; margin-top:3px; font-weight:bold;">BROKEN</div>`;
      }
    }
    this.tooltip.innerHTML = html;
    this.tooltip.style.display = "block";

    const cellRect = cell.getBoundingClientRect();
    const ttRect = this.tooltip.getBoundingClientRect();
    let left = cellRect.right + 8;
    let top = cellRect.top;
    if (left + ttRect.width > window.innerWidth - 8) {
      left = cellRect.left - ttRect.width - 8;
    }
    if (left < 8) {
      left = cellRect.left;
      top = cellRect.bottom + 6;
    }
    top = Math.min(top, window.innerHeight - ttRect.height - 4);
    top = Math.max(4, top);
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private async handleAction(action: "friend" | "trade" | "duel" | "gather", entity: Entity) {
    const handlers = {
      friend: this.options.onAddFriend,
      trade: this.options.onTrade,
      duel: this.options.onDuel,
      gather: this.options.onAgentGather,
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
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
  common: "#aaaaaa",
  uncommon: "#44cc44",
  rare: "#4488ff",
  epic: "#aa44ff",
  legendary: "#ffaa22",
};
