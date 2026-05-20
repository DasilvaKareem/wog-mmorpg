import { playSoundEffect } from "../sfx.js";

export interface DuelRequest {
  challengeId: string;
  challengerName: string;
  challengerWallet: string;
  format: string;
  expiresAtMs: number;
}

export interface DuelRequestPopupCallbacks {
  /** Player clicked Accept. Resolve with ok=false to keep popup (e.g., for retry). */
  onAccept: (req: DuelRequest) => Promise<{ ok: boolean; error?: string }>;
  /** Player clicked Decline. */
  onDecline: (req: DuelRequest) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Centered modal popup shown when a duel challenge arrives in the inbox.
 * Non-blocking — multiple incoming requests queue and display one at a time.
 */
export class DuelRequestPopup {
  private container: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private countdownEl: HTMLDivElement;
  private acceptBtn: HTMLButtonElement;
  private declineBtn: HTMLButtonElement;
  private dismissBtn: HTMLButtonElement;
  private statusEl: HTMLDivElement;

  private queue: DuelRequest[] = [];
  private current: DuelRequest | null = null;
  private callbacks: DuelRequestPopupCallbacks;
  private inFlight = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: DuelRequestPopupCallbacks) {
    this.callbacks = callbacks;

    this.container = document.createElement("div");
    this.container.id = "duel-request-popup";
    this.container.style.display = "none";

    const card = document.createElement("div");
    card.className = "drp-card";

    const header = document.createElement("div");
    header.className = "drp-header";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "drp-title";
    this.titleEl.textContent = "\u2694 DUEL CHALLENGE";
    this.dismissBtn = document.createElement("button");
    this.dismissBtn.className = "drp-dismiss";
    this.dismissBtn.innerHTML = "&times;";
    this.dismissBtn.title = "Dismiss (see in inbox)";
    this.dismissBtn.addEventListener("click", () => this.dismissCurrent());
    header.appendChild(this.titleEl);
    header.appendChild(this.dismissBtn);

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "drp-body";

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "drp-countdown";

    const btnRow = document.createElement("div");
    btnRow.className = "drp-btn-row";

    this.acceptBtn = document.createElement("button");
    this.acceptBtn.className = "drp-btn drp-btn-accept";
    this.acceptBtn.textContent = "Accept";
    this.acceptBtn.addEventListener("click", () => void this.handleAccept());

    this.declineBtn = document.createElement("button");
    this.declineBtn.className = "drp-btn drp-btn-decline";
    this.declineBtn.textContent = "Decline";
    this.declineBtn.addEventListener("click", () => void this.handleDecline());

    btnRow.appendChild(this.declineBtn);
    btnRow.appendChild(this.acceptBtn);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "drp-status";
    this.statusEl.style.display = "none";

    card.appendChild(header);
    card.appendChild(this.bodyEl);
    card.appendChild(this.countdownEl);
    card.appendChild(this.statusEl);
    card.appendChild(btnRow);
    this.container.appendChild(card);
    document.body.appendChild(this.container);
    this.injectStyles();
  }

  /** Queue a duel request for display. Shows immediately if nothing else is open. */
  enqueue(req: DuelRequest) {
    // Dedupe by challengeId.
    if (this.current?.challengeId === req.challengeId) return;
    if (this.queue.some((q) => q.challengeId === req.challengeId)) return;
    this.queue.push(req);
    if (!this.current) this.showNext();
  }

  private showNext() {
    const next = this.queue.shift() ?? null;
    this.current = next;
    if (!next) {
      this.hide();
      return;
    }
    // Skip if already expired by the time we get here.
    if (next.expiresAtMs < Date.now()) {
      this.showNext();
      return;
    }
    this.render(next);
    this.show();
    playSoundEffect("ui_notification");
  }

  private render(req: DuelRequest) {
    this.bodyEl.innerHTML = `
      <div class="drp-row"><span class="drp-label">Challenger:</span><span class="drp-value">${escapeHtml(req.challengerName)}</span></div>
      <div class="drp-row"><span class="drp-label">Format:</span><span class="drp-value">${escapeHtml(req.format)}</span></div>
    `;
    this.acceptBtn.disabled = false;
    this.declineBtn.disabled = false;
    this.statusEl.style.display = "none";
    this.statusEl.textContent = "";
    this.updateCountdown();
    this.startCountdownTimer();
  }

  private updateCountdown() {
    if (!this.current) return;
    const remainMs = this.current.expiresAtMs - Date.now();
    if (remainMs <= 0) {
      this.countdownEl.textContent = "Expired";
      this.countdownEl.classList.add("drp-expired");
      this.acceptBtn.disabled = true;
      this.declineBtn.disabled = true;
      // Auto-advance after a brief pause.
      setTimeout(() => { if (this.current) this.dismissCurrent(); }, 1200);
      return;
    }
    const sec = Math.ceil(remainMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    this.countdownEl.textContent = m > 0 ? `Expires in ${m}m ${s}s` : `Expires in ${s}s`;
    this.countdownEl.classList.toggle("drp-warning", remainMs < 30_000);
    this.countdownEl.classList.remove("drp-expired");
  }

  private startCountdownTimer() {
    this.stopCountdownTimer();
    this.countdownTimer = setInterval(() => this.updateCountdown(), 1000);
  }

  private stopCountdownTimer() {
    if (!this.countdownTimer) return;
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  private async handleAccept() {
    if (!this.current || this.inFlight) return;
    const req = this.current;
    this.inFlight = true;
    this.acceptBtn.disabled = true;
    this.declineBtn.disabled = true;
    this.setStatus("Accepting…", false);
    playSoundEffect("ui_button_click");
    try {
      const res = await this.callbacks.onAccept(req);
      if (res.ok) {
        this.setStatus("Accepted!", false);
        setTimeout(() => this.advance(), 800);
      } else {
        this.setStatus(res.error ?? "Failed", true);
        this.acceptBtn.disabled = false;
        this.declineBtn.disabled = false;
      }
    } catch (err) {
      this.setStatus(String(err), true);
      this.acceptBtn.disabled = false;
      this.declineBtn.disabled = false;
    } finally {
      this.inFlight = false;
    }
  }

  private async handleDecline() {
    if (!this.current || this.inFlight) return;
    const req = this.current;
    this.inFlight = true;
    this.acceptBtn.disabled = true;
    this.declineBtn.disabled = true;
    this.setStatus("Declining…", false);
    playSoundEffect("ui_button_click");
    try {
      const res = await this.callbacks.onDecline(req);
      if (res.ok) {
        this.setStatus("Declined.", false);
        setTimeout(() => this.advance(), 600);
      } else {
        this.setStatus(res.error ?? "Failed", true);
        this.acceptBtn.disabled = false;
        this.declineBtn.disabled = false;
      }
    } catch (err) {
      this.setStatus(String(err), true);
      this.acceptBtn.disabled = false;
      this.declineBtn.disabled = false;
    } finally {
      this.inFlight = false;
    }
  }

  private setStatus(text: string, isError: boolean) {
    this.statusEl.textContent = text;
    this.statusEl.style.display = "block";
    this.statusEl.classList.toggle("drp-status-error", isError);
  }

  /** Dismiss without action — request stays in inbox for later. */
  private dismissCurrent() {
    playSoundEffect("ui_dialog_close");
    this.advance();
  }

  private advance() {
    this.current = null;
    this.stopCountdownTimer();
    this.showNext();
  }

  private show() {
    this.container.style.display = "flex";
  }

  private hide() {
    this.container.style.display = "none";
    this.stopCountdownTimer();
  }

  private injectStyles() {
    if (document.getElementById("drp-styles")) return;
    const style = document.createElement("style");
    style.id = "drp-styles";
    style.textContent = `
      #duel-request-popup {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        pointer-events: none;
        background: transparent;
      }
      #duel-request-popup .drp-card {
        pointer-events: auto;
        min-width: 320px;
        max-width: 420px;
        background: rgba(20, 12, 24, 0.96);
        border: 2px solid #ff4466;
        border-radius: 10px;
        box-shadow: 0 0 32px rgba(255, 68, 102, 0.45), 0 8px 24px rgba(0,0,0,0.6);
        backdrop-filter: blur(8px);
        font-family: 'Courier New', monospace;
        color: #f5f0f0;
        padding: 16px 18px;
        animation: drp-pulse 1.6s ease-in-out infinite;
      }
      @keyframes drp-pulse {
        0%, 100% { box-shadow: 0 0 32px rgba(255, 68, 102, 0.45), 0 8px 24px rgba(0,0,0,0.6); }
        50%      { box-shadow: 0 0 48px rgba(255, 68, 102, 0.75), 0 8px 24px rgba(0,0,0,0.6); }
      }
      #duel-request-popup .drp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      #duel-request-popup .drp-title {
        font-weight: bold;
        font-size: 14px;
        letter-spacing: 1px;
        color: #ff4466;
        text-shadow: 0 0 6px rgba(255, 68, 102, 0.6);
      }
      #duel-request-popup .drp-dismiss {
        background: transparent;
        border: none;
        color: #999;
        font-size: 20px;
        cursor: pointer;
        padding: 0 6px;
        line-height: 1;
      }
      #duel-request-popup .drp-dismiss:hover { color: #fff; }
      #duel-request-popup .drp-body { margin-bottom: 10px; }
      #duel-request-popup .drp-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 12px;
      }
      #duel-request-popup .drp-label { color: #999; }
      #duel-request-popup .drp-value { color: #fff; font-weight: bold; }
      #duel-request-popup .drp-countdown {
        font-size: 11px;
        color: #aaa;
        text-align: center;
        margin: 10px 0;
        padding: 6px;
        background: rgba(255,255,255,0.04);
        border-radius: 4px;
      }
      #duel-request-popup .drp-countdown.drp-warning {
        color: #ffc24f;
      }
      #duel-request-popup .drp-countdown.drp-expired {
        color: #ff4466;
      }
      #duel-request-popup .drp-status {
        font-size: 11px;
        text-align: center;
        padding: 6px;
        margin-bottom: 8px;
        color: #5dff9a;
      }
      #duel-request-popup .drp-status.drp-status-error { color: #ff4466; }
      #duel-request-popup .drp-btn-row {
        display: flex;
        gap: 10px;
        margin-top: 4px;
      }
      #duel-request-popup .drp-btn {
        flex: 1;
        padding: 10px;
        border: none;
        border-radius: 6px;
        font-family: inherit;
        font-size: 12px;
        font-weight: bold;
        letter-spacing: 1px;
        cursor: pointer;
        transition: filter 0.15s, transform 0.05s;
      }
      #duel-request-popup .drp-btn:hover:not(:disabled) { filter: brightness(1.2); }
      #duel-request-popup .drp-btn:active:not(:disabled) { transform: translateY(1px); }
      #duel-request-popup .drp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      #duel-request-popup .drp-btn-accept {
        background: #5dff9a;
        color: #002a10;
      }
      #duel-request-popup .drp-btn-decline {
        background: #444;
        color: #fff;
        border: 1px solid #666;
      }
    `;
    document.head.appendChild(style);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
