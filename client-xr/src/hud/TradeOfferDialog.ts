import type { InventoryItem } from "../types.js";
import { playSoundEffect } from "../sfx.js";

interface TradeOfferDialogCallbacks {
  onSubmit: (params: {
    tokenId: number;
    quantity: number;
    askPrice: number;
    itemName: string;
  }) => Promise<void>;
}

/**
 * Modal for composing a targeted P2P trade offer. The seller picks one item
 * from their inventory and sets a gold ask price. Submission is delegated to
 * the host (main.ts) via the onSubmit callback so progress/error feedback can
 * flow through the shared AgentChat system message channel.
 */
export class TradeOfferDialog {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private priceInput: HTMLInputElement;
  private quantityInput: HTMLInputElement;
  private submitBtn: HTMLButtonElement;
  private statusEl: HTMLDivElement;
  private titleEl: HTMLSpanElement;

  private items: InventoryItem[] = [];
  private selectedTokenId: number | null = null;
  private recipientName = "";
  private callbacks: TradeOfferDialogCallbacks;
  private submitting = false;

  constructor(callbacks: TradeOfferDialogCallbacks) {
    this.callbacks = callbacks;

    this.container = document.createElement("div");
    this.container.id = "trade-offer-dialog";
    this.container.style.display = "none";

    const card = document.createElement("div");
    card.className = "tod-card";

    const header = document.createElement("div");
    header.className = "tod-header";
    this.titleEl = document.createElement("span");
    this.titleEl.className = "tod-title";
    this.titleEl.textContent = "Send Trade Offer";
    const closeBtn = document.createElement("button");
    closeBtn.className = "tod-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(this.titleEl);
    header.appendChild(closeBtn);

    const itemLabel = document.createElement("div");
    itemLabel.className = "tod-label";
    itemLabel.textContent = "Select item to sell";

    this.listEl = document.createElement("div");
    this.listEl.className = "tod-item-list";
    this.listEl.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest("[data-token-id]") as HTMLElement | null;
      if (!row) return;
      const tokenId = Number(row.dataset.tokenId);
      this.selectedTokenId = Number.isFinite(tokenId) ? tokenId : null;
      const max = this.selectedTokenId !== null
        ? (this.items.find((it) => it.tokenId === this.selectedTokenId)?.quantity ?? 1)
        : 1;
      this.quantityInput.max = String(max);
      if (Number(this.quantityInput.value) > max) this.quantityInput.value = String(max);
      this.renderItems();
      this.refreshSubmit();
      playSoundEffect("ui_button_click");
    });

    const formRow = document.createElement("div");
    formRow.className = "tod-form-row";

    const qtyWrap = document.createElement("div");
    qtyWrap.className = "tod-field";
    const qtyLabel = document.createElement("label");
    qtyLabel.textContent = "Quantity";
    this.quantityInput = document.createElement("input");
    this.quantityInput.type = "number";
    this.quantityInput.min = "1";
    this.quantityInput.value = "1";
    this.quantityInput.addEventListener("input", () => this.refreshSubmit());
    qtyWrap.appendChild(qtyLabel);
    qtyWrap.appendChild(this.quantityInput);

    const priceWrap = document.createElement("div");
    priceWrap.className = "tod-field tod-field-grow";
    const priceLabel = document.createElement("label");
    priceLabel.textContent = "Ask price (gold)";
    this.priceInput = document.createElement("input");
    this.priceInput.type = "number";
    this.priceInput.min = "1";
    this.priceInput.placeholder = "100";
    this.priceInput.addEventListener("input", () => this.refreshSubmit());
    priceWrap.appendChild(priceLabel);
    priceWrap.appendChild(this.priceInput);

    formRow.appendChild(qtyWrap);
    formRow.appendChild(priceWrap);

    this.submitBtn = document.createElement("button");
    this.submitBtn.className = "tod-submit";
    this.submitBtn.textContent = "Send Offer";
    this.submitBtn.disabled = true;
    this.submitBtn.addEventListener("click", () => void this.submit());

    this.statusEl = document.createElement("div");
    this.statusEl.className = "tod-status";

    card.appendChild(header);
    card.appendChild(itemLabel);
    card.appendChild(this.listEl);
    card.appendChild(formRow);
    card.appendChild(this.statusEl);
    card.appendChild(this.submitBtn);

    this.container.appendChild(card);
    this.container.addEventListener("click", (e) => {
      // Click outside the card closes.
      if (e.target === this.container) this.hide();
    });
    document.body.appendChild(this.container);

    this.injectStyles();
  }

  open(recipientName: string, items: InventoryItem[]) {
    this.recipientName = recipientName;
    this.items = items.filter((it) => it.quantity > 0 && !it.equipped);
    this.selectedTokenId = null;
    this.priceInput.value = "";
    this.quantityInput.value = "1";
    this.quantityInput.max = "1";
    this.statusEl.textContent = "";
    this.statusEl.className = "tod-status";
    this.submitting = false;
    this.submitBtn.disabled = true;
    this.submitBtn.textContent = "Send Offer";
    this.titleEl.textContent = `Send Trade Offer to ${recipientName}`;
    this.renderItems();
    this.show();
  }

  show() {
    if (this.container.style.display === "flex") return;
    this.container.style.display = "flex";
    playSoundEffect("ui_dialog_open");
  }

  hide() {
    if (this.container.style.display === "none") return;
    this.container.style.display = "none";
    playSoundEffect("ui_dialog_close");
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  private renderItems() {
    if (this.items.length === 0) {
      this.listEl.innerHTML = `<div class="tod-empty">No tradeable items in your bag.</div>`;
      return;
    }
    this.listEl.innerHTML = this.items
      .map((it) => {
        const selected = it.tokenId === this.selectedTokenId ? " selected" : "";
        const name = esc(it.displayName ?? it.name);
        const rarity = it.rarity ? ` <span class="tod-rarity tod-rarity-${esc(it.rarity)}">${esc(it.rarity)}</span>` : "";
        const qty = it.quantity > 1 ? ` <span class="tod-qty">×${it.quantity}</span>` : "";
        return `<button class="tod-item-row${selected}" data-token-id="${it.tokenId}">
          <span class="tod-item-name">${name}${rarity}</span>${qty}
        </button>`;
      })
      .join("");
  }

  private refreshSubmit() {
    const tokenSelected = this.selectedTokenId !== null;
    const qty = Number(this.quantityInput.value);
    const price = Number(this.priceInput.value);
    const ok = tokenSelected && qty > 0 && price > 0 && !this.submitting;
    this.submitBtn.disabled = !ok;
  }

  private async submit() {
    if (this.submitting) return;
    if (this.selectedTokenId === null) return;
    const item = this.items.find((it) => it.tokenId === this.selectedTokenId);
    if (!item) return;
    const quantity = Math.max(1, Math.floor(Number(this.quantityInput.value) || 1));
    const askPrice = Math.max(1, Math.floor(Number(this.priceInput.value) || 0));
    if (askPrice < 1) {
      this.statusEl.textContent = "Set an ask price greater than zero.";
      this.statusEl.className = "tod-status tod-status-error";
      return;
    }
    if (quantity > item.quantity) {
      this.statusEl.textContent = `You only have ${item.quantity} of that item.`;
      this.statusEl.className = "tod-status tod-status-error";
      return;
    }

    this.submitting = true;
    this.submitBtn.disabled = true;
    this.submitBtn.textContent = "Sending...";
    this.statusEl.textContent = `Listing on-chain — this can take a few seconds.`;
    this.statusEl.className = "tod-status tod-status-progress";

    try {
      await this.callbacks.onSubmit({
        tokenId: item.tokenId,
        quantity,
        askPrice,
        itemName: item.displayName ?? item.name,
      });
      this.statusEl.textContent = `Offer sent to ${this.recipientName}.`;
      this.statusEl.className = "tod-status tod-status-success";
      this.submitBtn.textContent = "Sent";
      setTimeout(() => this.hide(), 1200);
    } catch (err) {
      this.statusEl.textContent = err instanceof Error ? err.message : String(err);
      this.statusEl.className = "tod-status tod-status-error";
      this.submitBtn.textContent = "Send Offer";
      this.submitting = false;
      this.refreshSubmit();
    }
  }

  private injectStyles() {
    if (document.getElementById("trade-offer-dialog-styles")) return;
    const style = document.createElement("style");
    style.id = "trade-offer-dialog-styles";
    style.textContent = `
      #trade-offer-dialog {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        z-index: 40;
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        backdrop-filter: blur(2px);
      }
      .tod-card {
        width: 380px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 80px);
        background: rgba(10, 16, 28, 0.96);
        border: 1px solid rgba(102, 187, 255, 0.35);
        border-radius: 10px;
        padding: 14px 16px 16px;
        font: 12px monospace;
        color: #ccd;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: 0 8px 36px rgba(0, 0, 0, 0.6);
      }
      .tod-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(102, 187, 255, 0.18);
      }
      .tod-title {
        color: #66bbff;
        font-weight: bold;
        font-size: 13px;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tod-close {
        background: none;
        border: none;
        color: #99a;
        font-size: 18px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
      }
      .tod-close:hover { color: #fff; }
      .tod-label {
        color: #889;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .tod-item-list {
        flex: 1 1 auto;
        max-height: 220px;
        overflow-y: auto;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(102, 187, 255, 0.12);
        border-radius: 5px;
        padding: 4px;
      }
      .tod-item-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        background: none;
        border: 1px solid transparent;
        border-radius: 4px;
        color: #ccd;
        font: 11px monospace;
        text-align: left;
        cursor: pointer;
      }
      .tod-item-row:hover { background: rgba(102, 187, 255, 0.08); }
      .tod-item-row.selected {
        background: rgba(102, 187, 255, 0.16);
        border-color: rgba(102, 187, 255, 0.5);
      }
      .tod-item-name { color: #dde; }
      .tod-qty { color: #889; font-size: 10px; }
      .tod-rarity {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 1px 4px;
        border-radius: 3px;
        margin-left: 4px;
      }
      .tod-rarity-common { background: rgba(180,180,180,0.15); color: #bbb; }
      .tod-rarity-uncommon { background: rgba(64,180,80,0.15); color: #6fdb86; }
      .tod-rarity-rare { background: rgba(102,187,255,0.15); color: #66bbff; }
      .tod-rarity-epic { background: rgba(180,90,220,0.15); color: #c47ae0; }
      .tod-rarity-legendary { background: rgba(255,180,60,0.18); color: #ffc850; }
      .tod-empty {
        text-align: center;
        color: #667;
        padding: 16px;
        font-size: 11px;
      }
      .tod-form-row {
        display: flex;
        gap: 8px;
      }
      .tod-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        flex: 0 0 88px;
      }
      .tod-field-grow { flex: 1; }
      .tod-field label {
        color: #778;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .tod-field input {
        background: rgba(0,0,0,0.4);
        border: 1px solid rgba(102, 187, 255, 0.22);
        border-radius: 4px;
        padding: 5px 7px;
        color: #cde;
        font: 12px monospace;
        outline: none;
      }
      .tod-field input:focus { border-color: rgba(102, 187, 255, 0.55); }
      .tod-submit {
        background: rgba(102, 187, 255, 0.18);
        border: 1px solid rgba(102, 187, 255, 0.45);
        border-radius: 5px;
        padding: 7px 12px;
        color: #66bbff;
        font: bold 12px monospace;
        cursor: pointer;
      }
      .tod-submit:hover:not(:disabled) { background: rgba(102, 187, 255, 0.3); }
      .tod-submit:disabled { opacity: 0.45; cursor: not-allowed; }
      .tod-status {
        min-height: 14px;
        font-size: 11px;
        color: #aab;
      }
      .tod-status-progress { color: #66bbff; }
      .tod-status-success { color: #5dff9a; }
      .tod-status-error { color: #ff8866; }
    `;
    document.head.appendChild(style);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
