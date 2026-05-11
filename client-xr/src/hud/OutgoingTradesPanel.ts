import type { OutgoingTradeListing } from "../api.js";
import { playSoundEffect } from "../sfx.js";
import { formatTimeUntil } from "./InboxPanel.js";

interface OutgoingTradesPanelCallbacks {
  /** Fetch listings for the wallet. Resolves with offers (may be empty). */
  refresh: () => Promise<OutgoingTradeListing[]>;
  /** Cancel a pending trade. Returns ok/err so the panel can show feedback. */
  onCancel: (tradeId: number) => Promise<{ ok: boolean; error?: string }>;
}

const POLL_INTERVAL_MS = 10_000;
const COUNTDOWN_TICK_MS = 30_000;

/**
 * Seller-side view of trade offers they've created: pending, matched, expired,
 * cancelled. Allows the seller to cancel a still-pending listing before the
 * buyer responds. Polled every 10s while open; countdown chips re-render every
 * 30s without a network round-trip.
 */
export class OutgoingTradesPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private callbacks: OutgoingTradesPanelCallbacks;
  private offers: OutgoingTradeListing[] = [];
  private loading = false;
  private cancelPending = new Set<number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: OutgoingTradesPanelCallbacks) {
    this.callbacks = callbacks;

    this.container = document.createElement("div");
    this.container.id = "outgoing-trades-panel";
    this.container.style.display = "none";

    const header = document.createElement("div");
    header.className = "otp-header";
    header.innerHTML = `<span class="otp-title">My Trade Offers</span><span class="otp-sub">Outgoing</span>`;
    this.container.appendChild(header);

    this.listEl = document.createElement("div");
    this.listEl.className = "otp-list";
    this.listEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      const tradeId = Number(btn.dataset.tradeId);
      if (!Number.isFinite(tradeId)) return;
      if (action === "cancel") void this.handleCancel(tradeId);
    });
    this.container.appendChild(this.listEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "otp-footer";
    this.container.appendChild(this.footerEl);

    document.body.appendChild(this.container);
    this.injectStyles();
  }

  show() {
    if (this.container.style.display === "flex") return;
    this.container.style.display = "flex";
    void this.refresh();
    this.startPolling();
    playSoundEffect("ui_dialog_open");
  }

  hide() {
    if (this.container.style.display === "none") return;
    this.container.style.display = "none";
    this.stopPolling();
    playSoundEffect("ui_dialog_close");
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  async refresh() {
    this.loading = true;
    if (this.offers.length === 0) this.render();
    try {
      this.offers = await this.callbacks.refresh();
    } catch (err) {
      console.warn("[outgoing-trades] refresh failed", err);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private startPolling() {
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (!this.isVisible()) { this.stopPolling(); return; }
        void this.refresh();
      }, POLL_INTERVAL_MS);
    }
    if (!this.countdownTimer) {
      this.countdownTimer = setInterval(() => {
        if (!this.isVisible()) { this.stopPolling(); return; }
        // Only re-render if at least one row still has a live countdown to show.
        if (this.offers.some((o) => o.status === "pending")) this.render();
      }, COUNTDOWN_TICK_MS);
    }
  }

  private stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
  }

  private async handleCancel(tradeId: number) {
    if (this.cancelPending.has(tradeId)) return;
    this.cancelPending.add(tradeId);
    this.render();
    const result = await this.callbacks.onCancel(tradeId);
    this.cancelPending.delete(tradeId);
    if (result.ok) {
      // Optimistic: mark cancelled locally; refresh will reconcile.
      const offer = this.offers.find((o) => o.tradeId === tradeId);
      if (offer) { offer.status = "cancelled"; offer.cancelledAtMs = Date.now(); }
    }
    this.render();
    void this.refresh();
  }

  private render() {
    if (this.loading && this.offers.length === 0) {
      this.listEl.innerHTML = `<div class="otp-empty">Loading your offers…</div>`;
      this.footerEl.textContent = "";
      return;
    }
    if (this.offers.length === 0) {
      this.listEl.innerHTML = `<div class="otp-empty">You haven't sent any trade offers yet.</div>`;
      this.footerEl.textContent = "";
      return;
    }

    let html = "";
    for (const o of this.offers) {
      const item = o.itemName ?? `token #${o.tokenId}`;
      const qty = o.quantity > 1 ? ` ×${o.quantity}` : "";
      const target = o.targetBuyerWallet ? shortenWallet(o.targetBuyerWallet) : "open market";
      const pending = this.cancelPending.has(o.tradeId);

      let statusChip = "";
      let timing = "";
      switch (o.status) {
        case "pending":
          statusChip = `<span class="otp-chip otp-chip-pending">Pending</span>`;
          timing = `expires in ${esc(formatTimeUntil(o.expiresAtMs))}`;
          break;
        case "matched":
          statusChip = `<span class="otp-chip otp-chip-matched">Accepted</span>`;
          timing = o.matchedAtMs ? `accepted ${formatTimeAgo(o.matchedAtMs)}` : "accepted";
          break;
        case "cancelled":
          statusChip = `<span class="otp-chip otp-chip-cancelled">Declined / Cancelled</span>`;
          timing = o.cancelledAtMs ? `${formatTimeAgo(o.cancelledAtMs)}` : "";
          break;
        case "expired":
          statusChip = `<span class="otp-chip otp-chip-expired">Expired</span>`;
          timing = `expired ${formatTimeAgo(o.expiresAtMs)}`;
          break;
      }

      html += `<div class="otp-row">`;
      html += `<div class="otp-head">${statusChip}<span class="otp-target">→ ${esc(target)}</span></div>`;
      html += `<div class="otp-body">${esc(item)}${esc(qty)} · <span class="otp-price">${o.askPrice}g</span></div>`;
      if (timing) html += `<div class="otp-timing">${esc(timing)}</div>`;
      if (o.status === "pending") {
        html += `<button class="otp-btn otp-btn-cancel" data-action="cancel" data-trade-id="${o.tradeId}"${pending ? " disabled" : ""}>${pending ? "Cancelling…" : "Cancel listing"}</button>`;
      }
      html += `</div>`;
    }

    this.listEl.innerHTML = html;
    const pendingCount = this.offers.filter((o) => o.status === "pending").length;
    this.footerEl.textContent = pendingCount > 0
      ? `${pendingCount} pending offer${pendingCount === 1 ? "" : "s"}`
      : `${this.offers.length} total`;
  }

  private injectStyles() {
    if (document.getElementById("outgoing-trades-panel-styles")) return;
    const style = document.createElement("style");
    style.id = "outgoing-trades-panel-styles";
    style.textContent = `
      #outgoing-trades-panel {
        position: fixed;
        bottom: 64px;
        right: 12px;
        width: 320px;
        max-height: calc(100vh - 200px);
        background: rgba(10, 16, 28, 0.94);
        border: 1px solid rgba(255, 200, 80, 0.25);
        border-radius: 8px;
        z-index: 16;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }
      .otp-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255, 200, 80, 0.18);
      }
      .otp-title { color: #ffc850; font-weight: bold; font-size: 13px; letter-spacing: 0.5px; }
      .otp-sub { color: #667; font-size: 10px; }

      .otp-list {
        overflow-y: auto;
        flex: 1;
        padding: 4px 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 200, 80, 0.2) transparent;
      }
      .otp-row {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255, 200, 80, 0.07);
      }
      .otp-row:last-child { border-bottom: none; }
      .otp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
      .otp-chip {
        font-size: 9px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 2px 6px;
        border-radius: 3px;
      }
      .otp-chip-pending { color: #66bbff; background: rgba(102, 187, 255, 0.15); }
      .otp-chip-matched { color: #5dff9a; background: rgba(93, 255, 154, 0.15); }
      .otp-chip-cancelled { color: #ff8866; background: rgba(255, 136, 102, 0.12); }
      .otp-chip-expired { color: #889; background: rgba(150, 150, 170, 0.12); }
      .otp-target { color: #99a; font-size: 11px; }
      .otp-body { color: #dde; font-size: 12px; }
      .otp-price { color: #ffc850; font-weight: bold; }
      .otp-timing { color: #99a; font-size: 10px; margin-top: 2px; }

      .otp-btn {
        margin-top: 6px;
        padding: 4px 10px;
        background: transparent;
        border: 1px solid rgba(255, 136, 102, 0.4);
        border-radius: 4px;
        color: #ff8866;
        font: bold 11px monospace;
        cursor: pointer;
      }
      .otp-btn:hover:not(:disabled) { background: rgba(255, 136, 102, 0.12); }
      .otp-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .otp-footer {
        padding: 6px 12px;
        font-size: 10px;
        color: #556;
        border-top: 1px solid rgba(255, 200, 80, 0.08);
        text-align: center;
      }
      .otp-empty { padding: 20px; text-align: center; color: #556; font-size: 11px; }
    `;
    document.head.appendChild(style);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortenWallet(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

