import type { InventoryItem } from "../types.js";

const QUALITY_COLORS: Record<string, string> = {
  common: "#aaaaaa",
  uncommon: "#44cc44",
  rare: "#4488ff",
  epic: "#aa44ff",
  legendary: "#ffaa22",
};

const CATEGORY_ICONS: Record<string, string> = {
  weapon: "\u2694",       // crossed swords
  armor: "\u{1F6E1}",    // shield
  shield: "\u{1F6E1}",
  potion: "\u{1F9EA}",   // test tube
  consumable: "\u{1F372}",// pot of food
  food: "\u{1F356}",     // meat
  material: "\u{1F9F1}", // brick
  ore: "\u26CF",          // pick
  herb: "\u{1F33F}",     // herb
  gem: "\u{1F48E}",      // gem
  leather: "\u{1F9F6}",  // yarn
  recipe: "\u{1F4DC}",   // scroll
  ring: "\u{1F48D}",     // ring
  amulet: "\u{1F4FF}",   // prayer beads
  tool: "\u{1F527}",     // wrench
};

function getCategoryIcon(item: InventoryItem): string {
  const cat = (item.category ?? "").toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (cat.includes(key)) return icon;
  }
  // Fallback: slot-based
  if (item.equipSlot) {
    if (item.equipSlot.includes("weapon") || item.equipSlot.includes("hand")) return "\u2694";
    if (item.equipSlot.includes("head")) return "\u{1FA96}";
    if (item.equipSlot.includes("chest") || item.equipSlot.includes("body")) return "\u{1F455}";
    if (item.equipSlot.includes("legs")) return "\u{1F456}";
    if (item.equipSlot.includes("feet") || item.equipSlot.includes("boot")) return "\u{1F462}";
  }
  return "\u{1F4E6}"; // package fallback
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface BagPanelCallbacks {
  onUseItem?: (item: InventoryItem) => void;
  onEquipItem?: (item: InventoryItem) => void;
}

export class BagPanel {
  private container: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private tooltipEl: HTMLDivElement;
  private callbacks: BagPanelCallbacks;

  private items: InventoryItem[] = [];
  private isOwn = false;

  constructor(callbacks: BagPanelCallbacks = {}) {
    this.callbacks = callbacks;

    this.container = document.createElement("div");
    this.container.id = "bag-panel";
    this.container.style.display = "none";

    // Header
    this.headerEl = document.createElement("div");
    this.headerEl.className = "bag-header";
    this.headerEl.innerHTML = `<span class="bag-title">Bag</span><span class="bag-count"></span>`;
    this.container.appendChild(this.headerEl);

    // Grid
    this.gridEl = document.createElement("div");
    this.gridEl.className = "bag-grid";
    this.container.appendChild(this.gridEl);

    // Tooltip (shared, positioned on hover)
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "bag-tooltip";
    this.tooltipEl.style.display = "none";
    document.body.appendChild(this.tooltipEl);

    document.body.appendChild(this.container);
    this.injectStyles();

    // Hover events (delegated)
    this.gridEl.addEventListener("mouseover", (e) => {
      const cell = (e.target as HTMLElement).closest(".bag-cell[data-idx]") as HTMLElement;
      if (!cell) return;
      const idx = Number(cell.dataset.idx);
      const item = this.items[idx];
      if (!item) return;
      this.showTooltip(item, cell);
    });

    this.gridEl.addEventListener("mouseout", (e) => {
      const cell = (e.target as HTMLElement).closest(".bag-cell") as HTMLElement;
      if (!cell) return;
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related && cell.contains(related)) return;
      this.tooltipEl.style.display = "none";
    });
  }

  setPlayer(_walletAddress: string | null, isOwn: boolean) {
    this.isOwn = isOwn;
  }

  updateInventory(items: InventoryItem[]) {
    this.items = items;
    this.render();
  }

  toggle() {
    if (this.container.style.display === "none") {
      this.container.style.display = "flex";
      this.render();
    } else {
      this.container.style.display = "none";
      this.tooltipEl.style.display = "none";
    }
  }

  show() { this.container.style.display = "flex"; this.render(); }
  hide() { this.container.style.display = "none"; this.tooltipEl.style.display = "none"; }
  isVisible(): boolean { return this.container.style.display !== "none"; }

  private render() {
    const countEl = this.headerEl.querySelector(".bag-count");
    if (countEl) countEl.textContent = `${this.items.length} items`;

    // Minimum 20 cells (4 cols x 5 rows), expand as needed
    const minCells = 20;
    const totalCells = Math.max(minCells, this.items.length);

    let html = "";
    for (let i = 0; i < totalCells; i++) {
      const item = this.items[i];
      if (item) {
        const rarity = (item.rarity ?? "common").toLowerCase();
        const borderColor = QUALITY_COLORS[rarity] ?? QUALITY_COLORS.common;
        const icon = getCategoryIcon(item);
        const equipped = item.equipped ? ' bag-equipped' : '';

        html += `<div class="bag-cell bag-cell-filled${equipped}" data-idx="${i}" style="border-color:${borderColor}">`;
        html += `<span class="bag-cell-icon">${icon}</span>`;
        if (item.quantity > 1) {
          html += `<span class="bag-cell-qty">${item.quantity}</span>`;
        }
        if (item.equipped) {
          html += `<span class="bag-cell-equip">E</span>`;
        }
        html += `</div>`;
      } else {
        html += `<div class="bag-cell bag-cell-empty"></div>`;
      }
    }

    this.gridEl.innerHTML = html;
  }

  private showTooltip(item: InventoryItem, cell: HTMLElement) {
    const rarity = (item.rarity ?? "common").toLowerCase();
    const rarityColor = QUALITY_COLORS[rarity] ?? QUALITY_COLORS.common;
    const slotText = item.equipSlot ? `[${item.equipSlot}]` : "";

    let html = `<div class="bag-tt-name" style="color:${rarityColor}">${esc(item.name)}</div>`;
    html += `<div class="bag-tt-meta">${esc(rarity)} ${esc(item.category)} ${esc(slotText)}</div>`;
    if (item.description) {
      html += `<div class="bag-tt-desc">${esc(item.description)}</div>`;
    }
    if (item.durability != null && item.maxDurability != null) {
      html += `<div class="bag-tt-dur">Durability: ${item.durability}/${item.maxDurability}</div>`;
    }
    if (item.quantity > 1) {
      html += `<div class="bag-tt-qty">Qty: ${item.quantity}</div>`;
    }
    if (item.equipped) {
      html += `<div class="bag-tt-equipped">Equipped</div>`;
    }

    this.tooltipEl.innerHTML = html;
    this.tooltipEl.style.display = "block";

    // Position tooltip to the left of the cell
    const cellRect = cell.getBoundingClientRect();
    const ttRect = this.tooltipEl.getBoundingClientRect();
    let left = cellRect.left - ttRect.width - 8;
    let top = cellRect.top;

    // If it would go off-screen left, show below instead
    if (left < 4) {
      left = cellRect.left;
      top = cellRect.bottom + 4;
    }
    // Clamp to viewport
    top = Math.min(top, window.innerHeight - ttRect.height - 4);
    top = Math.max(4, top);

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #bag-panel {
        position: fixed;
        bottom: 12px;
        right: 12px;
        width: 228px;
        max-height: calc(100vh - 200px);
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

      .bag-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(68, 255, 136, 0.15);
      }
      .bag-title { color: #4f8; font-weight: bold; font-size: 13px; }
      .bag-count { color: #667; font-size: 11px; }

      .bag-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        padding: 8px;
        overflow-y: auto;
        flex: 1;
        scrollbar-width: thin;
        scrollbar-color: rgba(68, 255, 136, 0.2) transparent;
      }

      .bag-cell {
        aspect-ratio: 1;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        cursor: default;
        transition: background 0.12s;
      }

      .bag-cell-empty {
        background: rgba(30, 40, 55, 0.5);
        border: 1px solid rgba(80, 90, 110, 0.25);
      }

      .bag-cell-filled {
        background: rgba(30, 40, 55, 0.8);
        border: 2px solid;
        cursor: pointer;
      }
      .bag-cell-filled:hover {
        background: rgba(50, 65, 85, 0.9);
      }

      .bag-cell-icon {
        font-size: 22px;
        line-height: 1;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
      }

      .bag-cell-qty {
        position: absolute;
        bottom: 2px;
        right: 3px;
        font-size: 10px;
        font-weight: bold;
        color: #fff;
        text-shadow: 0 0 3px #000, 0 0 3px #000;
        line-height: 1;
      }

      .bag-cell-equip {
        position: absolute;
        top: 1px;
        left: 3px;
        font-size: 9px;
        font-weight: bold;
        color: #4f8;
        text-shadow: 0 0 3px #000;
        line-height: 1;
      }

      .bag-equipped {
        box-shadow: inset 0 0 8px rgba(68, 255, 136, 0.25);
      }

      /* Tooltip */
      .bag-tooltip {
        position: fixed;
        z-index: 100;
        background: rgba(8, 12, 22, 0.96);
        border: 1px solid rgba(68, 255, 136, 0.3);
        border-radius: 6px;
        padding: 8px 10px;
        font: 11px monospace;
        color: #ccc;
        max-width: 220px;
        pointer-events: none;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      }
      .bag-tt-name { font-weight: bold; font-size: 12px; margin-bottom: 3px; }
      .bag-tt-meta { color: #778; font-size: 10px; margin-bottom: 4px; text-transform: capitalize; }
      .bag-tt-desc { color: #99a; font-size: 10px; margin-bottom: 4px; line-height: 1.3; }
      .bag-tt-dur { color: #997; font-size: 10px; }
      .bag-tt-qty { color: #997; font-size: 10px; }
      .bag-tt-equipped { color: #4f8; font-size: 10px; font-weight: bold; margin-top: 2px; }
    `;
    document.head.appendChild(style);
  }
}
