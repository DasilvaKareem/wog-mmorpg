import type { Entity, NpcDialogueMessage, ShopItem } from "../types.js";
import { fetchShopInventory, buyShopItem, sendNpcDialogue } from "../api.js";

const NPC_DIALOG_TYPES = new Set([
  "merchant", "quest-giver", "lore-npc", "guild-registrar",
  "auctioneer", "arena-master", "trainer", "profession-trainer",
  "forge", "alchemy-lab", "enchanting-altar", "campfire",
  "tanning-rack", "jewelers-bench",
]);

const TYPE_ACCENT: Record<string, string> = {
  merchant: "#ffcc00",
  "quest-giver": "#66bbff",
  "lore-npc": "#8888cc",
  "guild-registrar": "#44cc88",
  auctioneer: "#ff9944",
  "arena-master": "#ff4466",
  trainer: "#88aaff",
  "profession-trainer": "#88aaff",
  forge: "#ff6633",
  "alchemy-lab": "#aa44ff",
  "enchanting-altar": "#cc66ff",
  campfire: "#ff8844",
  "tanning-rack": "#aa8855",
  "jewelers-bench": "#44ddcc",
  npc: "#4488ff",
};

interface NpcDialogCallbacks {
  getAuthToken: () => Promise<string | null>;
  getOwnEntityId: () => string | null;
  getOwnWalletAddress: () => string | null;
  onShowQuests: () => void;
}

export class NpcDialog {
  private overlay: HTMLDivElement;
  private container: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private contentEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private callbacks: NpcDialogCallbacks;

  private entity: Entity | null = null;
  private activeTab = "";
  private chatHistory: NpcDialogueMessage[] = [];
  private shopItems: ShopItem[] = [];
  private shopLoading = false;
  private dialogSending = false;
  private playerGold: number | null = null;

  constructor(callbacks: NpcDialogCallbacks) {
    this.callbacks = callbacks;

    // Overlay backdrop
    this.overlay = document.createElement("div");
    this.overlay.id = "npc-dialog";
    this.overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.5);
      z-index:50; display:none; align-items:center; justify-content:center;
    `;
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Modal container
    this.container = document.createElement("div");
    this.container.className = "nd-container";
    this.container.addEventListener("click", (e) => e.stopPropagation());

    this.headerEl = document.createElement("div");
    this.headerEl.className = "nd-header";
    this.container.appendChild(this.headerEl);

    this.tabBar = document.createElement("div");
    this.tabBar.className = "nd-tabs";
    this.tabBar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".nd-tab") as HTMLElement;
      if (!btn?.dataset.tab) return;
      this.activeTab = btn.dataset.tab;
      this.tabBar.querySelectorAll(".nd-tab").forEach((b) =>
        b.classList.toggle("active", (b as HTMLElement).dataset.tab === this.activeTab));
      this.renderContent();
    });
    this.container.appendChild(this.tabBar);

    this.contentEl = document.createElement("div");
    this.contentEl.className = "nd-content";
    this.container.appendChild(this.contentEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "nd-footer";
    this.container.appendChild(this.footerEl);

    this.overlay.appendChild(this.container);
    document.body.appendChild(this.overlay);
    this.injectStyles();

    // Delegate shop buy clicks
    this.contentEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement;
      if (!btn) return;
      if (btn.dataset.action === "buy" && btn.dataset.tokenId) {
        void this.handleBuy(Number(btn.dataset.tokenId));
      }
    });

    // Internal escape handler
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen()) {
        this.close();
        e.stopPropagation();
      }
    });
  }

  static isNpcType(type: string): boolean {
    return NPC_DIALOG_TYPES.has(type);
  }

  open(entity: Entity) {
    this.entity = entity;
    this.chatHistory = [];
    this.shopItems = [];
    this.playerGold = null;
    this.shopLoading = false;
    this.dialogSending = false;

    const accent = TYPE_ACCENT[entity.type] ?? "#aaa";
    this.container.style.borderColor = accent.replace(")", ",0.4)").replace("rgb", "rgba");
    this.container.style.borderColor = hexToRgba(accent, 0.4);

    // Header
    const typeLabel = entity.type.replace(/-/g, " ");
    this.headerEl.innerHTML = `
      <div class="nd-header-left">
        <span class="nd-npc-name" style="color:${accent}">${esc(entity.name)}</span>
        <span class="nd-npc-type">${esc(typeLabel)}</span>
      </div>
      <button class="nd-close">&times;</button>
    `;
    this.headerEl.querySelector(".nd-close")!.addEventListener("click", () => this.close());

    // Tabs
    const tabs = this.getTabs(entity.type);
    this.tabBar.innerHTML = tabs.map((t, i) =>
      `<button class="nd-tab${i === 0 ? " active" : ""}" data-tab="${t.id}" style="--accent:${accent}">${t.label}</button>`
    ).join("");
    this.activeTab = tabs[0].id;

    this.overlay.style.display = "flex";
    this.renderContent();
  }

  close() {
    this.overlay.style.display = "none";
    this.entity = null;
    this.chatHistory = [];
  }

  isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  // ── Tab logic ──────────────────────────────────────────────────

  private getTabs(type: string): { id: string; label: string }[] {
    switch (type) {
      case "merchant":
        return [{ id: "shop", label: "Shop" }, { id: "dialog", label: "Talk" }];
      case "quest-giver":
        return [{ id: "dialog", label: "Talk" }, { id: "quests", label: "Quests" }];
      default:
        return [{ id: "dialog", label: "Talk" }];
    }
  }

  // ── Content rendering ──────────────────────────────────────────

  private renderContent() {
    if (this.activeTab === "shop") this.renderShop();
    else if (this.activeTab === "quests") this.renderQuests();
    else this.renderDialog();
  }

  // ── Dialog view ────────────────────────────────────────────────

  private renderDialog() {
    const accent = TYPE_ACCENT[this.entity?.type ?? ""] ?? "#aaa";

    let msgs = "";
    for (const m of this.chatHistory) {
      if (m.role === "npc") {
        msgs += `<div class="nd-msg nd-msg-npc" style="border-left-color:${accent}">
          <span class="nd-msg-name" style="color:${accent}">${esc(this.entity?.name ?? "NPC")}</span>
          <span class="nd-msg-text">${esc(m.content)}</span>
        </div>`;
      } else {
        msgs += `<div class="nd-msg nd-msg-player">
          <span class="nd-msg-name" style="color:#efc97f">You</span>
          <span class="nd-msg-text">${esc(m.content)}</span>
        </div>`;
      }
    }

    if (this.dialogSending) {
      msgs += `<div class="nd-msg nd-msg-npc" style="border-left-color:${accent}">
        <span class="nd-msg-text" style="color:#667">...</span>
      </div>`;
    }

    if (this.chatHistory.length === 0 && !this.dialogSending) {
      msgs = `<div class="nd-empty">Start a conversation...</div>`;
    }

    this.contentEl.innerHTML = `<div class="nd-chat-messages" id="nd-chat-scroll">${msgs}</div>`;

    // Input
    const hasChar = !!this.callbacks.getOwnEntityId();
    if (hasChar) {
      this.footerEl.innerHTML = `
        <div class="nd-chat-input-row">
          <input class="nd-chat-input" type="text" placeholder="Say something..." maxlength="200" />
          <button class="nd-chat-send">Send</button>
        </div>
      `;
      const input = this.footerEl.querySelector(".nd-chat-input") as HTMLInputElement;
      const sendBtn = this.footerEl.querySelector(".nd-chat-send") as HTMLButtonElement;

      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && input.value.trim()) {
          void this.handleDialogSend(input.value.trim());
          input.value = "";
        }
      });
      input.addEventListener("keyup", (e) => e.stopPropagation());
      sendBtn.addEventListener("click", () => {
        if (input.value.trim()) {
          void this.handleDialogSend(input.value.trim());
          input.value = "";
        }
      });

      // Focus the input
      requestAnimationFrame(() => input.focus());
    } else {
      this.footerEl.innerHTML = `<div class="nd-footer-text">Deploy a character to interact</div>`;
    }

    // Auto-greeting on first open
    if (this.chatHistory.length === 0 && !this.dialogSending && hasChar) {
      void this.handleDialogSend("");
    }

    // Scroll to bottom
    const scroll = this.contentEl.querySelector("#nd-chat-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  private async handleDialogSend(message: string) {
    if (!this.entity || this.dialogSending) return;

    const token = await this.callbacks.getAuthToken();
    const entityId = this.callbacks.getOwnEntityId();
    if (!token || !entityId) return;

    // Add player message to history (skip for empty greeting)
    if (message) {
      this.chatHistory.push({ role: "player", content: message });
    }
    this.dialogSending = true;
    this.renderDialog();

    const result = await sendNpcDialogue(
      token, this.entity.id, entityId, message,
      this.chatHistory.slice(-10),
    );

    this.dialogSending = false;
    if (result.ok && result.data) {
      this.chatHistory.push({ role: "npc", content: result.data.response });
    } else {
      this.chatHistory.push({ role: "npc", content: "(no response)" });
    }
    this.renderDialog();
  }

  // ── Shop view ──────────────────────────────────────────────────

  private renderShop() {
    if (this.shopItems.length === 0 && !this.shopLoading) {
      this.shopLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading shop...</div>`;
      this.footerEl.innerHTML = "";
      void this.loadShop();
      return;
    }

    if (this.shopLoading) {
      this.contentEl.innerHTML = `<div class="nd-empty">Loading shop...</div>`;
      this.footerEl.innerHTML = "";
      return;
    }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";

    for (const item of this.shopItems) {
      const stats = Object.entries(item.statBonuses || {})
        .map(([k, v]) => `+${v} ${k.toUpperCase()}`)
        .join(", ");
      const stockText = item.stock != null ? `${item.stock} left` : "";
      const price = item.currentPrice ?? item.copperPrice;
      const slotText = item.equipSlot ? `[${item.equipSlot}]` : item.category || "";

      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header">`;
      html += `<span class="nd-shop-item-name">${esc(item.name)}</span>`;
      html += `<span class="nd-shop-item-slot">${esc(slotText)}</span>`;
      html += `</div>`;
      if (item.description) {
        html += `<div class="nd-shop-item-desc">${esc(item.description)}</div>`;
      }
      if (stats) {
        html += `<div class="nd-shop-item-stats">${stats}</div>`;
      }
      html += `<div class="nd-shop-item-footer">`;
      html += `<span class="nd-shop-item-price">${price}g</span>`;
      if (stockText) html += `<span class="nd-shop-item-stock">${stockText}</span>`;
      if (hasChar) {
        html += `<button class="nd-btn" data-action="buy" data-token-id="${item.tokenId}">Buy</button>`;
      }
      html += `</div>`;
      html += `</div>`;
    }

    if (!html) html = `<div class="nd-empty">This merchant has nothing for sale</div>`;
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;

    // Footer with gold
    const goldText = this.playerGold != null ? `Your gold: ${this.playerGold}` : "";
    this.footerEl.innerHTML = goldText ? `<div class="nd-footer-text">${goldText}</div>` : "";
  }

  private async loadShop() {
    if (!this.entity) return;
    const data = await fetchShopInventory(this.entity.id);
    this.shopLoading = false;
    if (data) {
      this.shopItems = data.items;
    }
    if (this.activeTab === "shop") this.renderShop();
  }

  private async handleBuy(tokenId: number) {
    if (!this.entity) return;
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;

    const btn = this.contentEl.querySelector(`[data-token-id="${tokenId}"]`) as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }

    const result = await buyShopItem(token, addr, tokenId, 1, this.entity.id);

    if (result.ok && result.data) {
      this.playerGold = result.data.remainingGold;
      // Update local stock
      const item = this.shopItems.find((i) => i.tokenId === tokenId);
      if (item && item.stock != null) item.stock = Math.max(0, item.stock - 1);
      if (btn) { btn.textContent = "Bought!"; setTimeout(() => this.renderShop(), 1000); }
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = "Buy"; }, 2000); }
    }

    // Update gold footer
    if (this.playerGold != null) {
      this.footerEl.innerHTML = `<div class="nd-footer-text">Your gold: ${this.playerGold}</div>`;
    }
  }

  // ── Quests view ────────────────────────────────────────────────

  private renderQuests() {
    this.contentEl.innerHTML = `<div class="nd-empty">Quest log opened in side panel.</div>`;
    this.footerEl.innerHTML = "";
    this.callbacks.onShowQuests();
  }

  // ── Styles ─────────────────────────────────────────────────────

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .nd-container {
        width: 440px;
        max-height: 70vh;
        background: rgba(10, 16, 28, 0.95);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 10px;
        backdrop-filter: blur(8px);
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        pointer-events: auto;
        overflow: hidden;
      }

      .nd-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .nd-header-left { display: flex; flex-direction: column; gap: 2px; }
      .nd-npc-name { font-size: 15px; font-weight: bold; }
      .nd-npc-type { font-size: 11px; color: #667; text-transform: capitalize; }
      .nd-close {
        background: none; border: none; color: #667; font-size: 22px;
        cursor: pointer; padding: 0 4px; line-height: 1;
      }
      .nd-close:hover { color: #ccc; }

      .nd-tabs {
        display: flex;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .nd-tab {
        flex: 1;
        padding: 7px 0;
        background: none;
        border: none;
        color: #556;
        font: bold 12px monospace;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color 0.15s;
      }
      .nd-tab:hover { color: #99a; }
      .nd-tab.active { color: var(--accent, #66bbff); border-bottom-color: var(--accent, #66bbff); }

      .nd-content {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.1) transparent;
        min-height: 200px;
        max-height: calc(70vh - 160px);
      }

      .nd-footer {
        border-top: 1px solid rgba(255,255,255,0.08);
        min-height: 0;
      }
      .nd-footer:empty { display: none; }
      .nd-footer-text { padding: 8px 16px; font-size: 11px; color: #667; text-align: center; }

      .nd-empty { padding: 30px; text-align: center; color: #556; }

      /* ── Dialog view ── */
      .nd-chat-messages {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 16px;
        overflow-y: auto;
        max-height: calc(70vh - 200px);
      }
      .nd-msg { padding: 6px 0; }
      .nd-msg-npc {
        border-left: 2px solid #66bbff;
        padding-left: 10px;
      }
      .nd-msg-player {
        border-left: 2px solid #efc97f;
        padding-left: 10px;
      }
      .nd-msg-name { display: block; font-size: 10px; font-weight: bold; margin-bottom: 2px; }
      .nd-msg-text { display: block; font-size: 12px; color: #dde; line-height: 1.5; }

      .nd-chat-input-row {
        display: flex;
        gap: 6px;
        padding: 8px 12px;
      }
      .nd-chat-input {
        flex: 1;
        padding: 6px 10px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 4px;
        color: #dde;
        font: 12px monospace;
        outline: none;
      }
      .nd-chat-input:focus { border-color: rgba(255,255,255,0.25); }
      .nd-chat-send {
        padding: 6px 14px;
        background: rgba(102,187,255,0.12);
        border: 1px solid rgba(102,187,255,0.3);
        border-radius: 4px;
        color: #66bbff;
        font: bold 11px monospace;
        cursor: pointer;
      }
      .nd-chat-send:hover { background: rgba(102,187,255,0.25); }

      /* ── Shop view ── */
      .nd-shop-grid {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .nd-shop-item {
        padding: 10px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .nd-shop-item:last-child { border-bottom: none; }
      .nd-shop-item-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 2px;
      }
      .nd-shop-item-name { color: #dde; font-weight: bold; }
      .nd-shop-item-slot { color: #667; font-size: 10px; }
      .nd-shop-item-desc { color: #778; font-size: 11px; margin-bottom: 3px; }
      .nd-shop-item-stats { color: #4c4; font-size: 11px; margin-bottom: 4px; }
      .nd-shop-item-footer {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .nd-shop-item-price { color: #ffcc00; font-weight: bold; font-size: 12px; }
      .nd-shop-item-stock { color: #667; font-size: 10px; }

      .nd-btn {
        margin-left: auto;
        padding: 3px 10px;
        background: rgba(255,204,0,0.1);
        border: 1px solid rgba(255,204,0,0.3);
        border-radius: 4px;
        color: #ffcc00;
        font: bold 11px monospace;
        cursor: pointer;
      }
      .nd-btn:hover { background: rgba(255,204,0,0.2); }
      .nd-btn:disabled { opacity: 0.5; cursor: default; }
    `;
    document.head.appendChild(style);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
