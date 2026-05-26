import { playSoundEffect } from "../sfx.js";

export type RequestKind = "duel" | "party" | "trade" | "friend";

export interface RequestPopupItem {
  /** Unique id (challengeId / inviteId / tradeId-as-string). Used for dedupe. */
  id: string;
  kind: RequestKind;
  /** Header text, e.g. "DUEL CHALLENGE", "PARTY INVITE", "TRADE OFFER". */
  title: string;
  /** Subtitle / "from X" line shown under the title. */
  subtitle: string;
  /** Detail rows: label/value pairs shown in the body. */
  rows: Array<{ label: string; value: string }>;
  /** Optional expiry timestamp (ms epoch). If present, popup shows live countdown and auto-dismisses on expiry. */
  expiresAtMs?: number;
  acceptLabel?: string;
  declineLabel?: string;
  onAccept: () => Promise<{ ok: boolean; error?: string }>;
  onDecline: () => Promise<{ ok: boolean; error?: string }>;
}

const KIND_THEME: Record<RequestKind, { color: string; icon: string }> = {
  duel:   { color: "#ff4466", icon: "\u2694" },          // crossed swords
  party:  { color: "#b48cff", icon: "\u{1F465}" },        // busts in silhouette
  trade:  { color: "#5dff9a", icon: "\u{1F381}" },        // wrapped gift
  friend: { color: "#7fd6be", icon: "\u{1F91D}" },        // handshake
};

const NOTIFICATION_SFX_DEBOUNCE_MS = 500;

/**
 * Centered modal popup for time-sensitive incoming requests (duel, party, trade).
 * Queues multiple requests and shows them one at a time. Auto-dismisses on expiry.
 *
 * Edge cases handled:
 *  - ESC key dismisses current item (request stays in inbox)
 *  - Click backdrop dismisses current item
 *  - VR suspend: while suspended, queue continues to accumulate but DOM stays hidden;
 *    resuming shows the next item
 *  - clear() wipes everything (use on wallet/identity change)
 *  - Autofocus accept button for keyboard nav
 *  - Notification SFX debounced so bursts don't sound spammy
 *  - Re-checks expiry just before firing accept/decline API
 *  - Shows "+N more" chip when multiple requests are queued behind the current one
 */
export class RequestPopup {
  private container: HTMLDivElement;
  private cardEl: HTMLDivElement;
  private iconEl: HTMLSpanElement;
  private titleEl: HTMLDivElement;
  private queueBadgeEl: HTMLSpanElement;
  private subtitleEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private countdownEl: HTMLDivElement;
  private acceptBtn: HTMLButtonElement;
  private declineBtn: HTMLButtonElement;
  private dismissBtn: HTMLButtonElement;
  private statusEl: HTMLDivElement;

  private queue: RequestPopupItem[] = [];
  private current: RequestPopupItem | null = null;
  private inFlight = false;
  private suspended = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private lastSfxMs = 0;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "request-popup";
    this.container.style.display = "none";
    // Click on the backdrop (container itself, not card) dismisses.
    this.container.addEventListener("click", (e) => {
      if (e.target === this.container && !this.inFlight) this.dismissCurrent();
    });

    this.cardEl = document.createElement("div");
    this.cardEl.className = "rqp-card";
    this.cardEl.setAttribute("role", "dialog");
    this.cardEl.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "rqp-header";
    this.iconEl = document.createElement("span");
    this.iconEl.className = "rqp-icon";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "rqp-title";
    this.queueBadgeEl = document.createElement("span");
    this.queueBadgeEl.className = "rqp-queue-badge";
    this.queueBadgeEl.style.display = "none";
    this.dismissBtn = document.createElement("button");
    this.dismissBtn.className = "rqp-dismiss";
    this.dismissBtn.innerHTML = "&times;";
    this.dismissBtn.title = "Dismiss (stays in inbox)";
    this.dismissBtn.setAttribute("aria-label", "Dismiss");
    this.dismissBtn.addEventListener("click", () => this.dismissCurrent());
    const titleWrap = document.createElement("div");
    titleWrap.className = "rqp-title-wrap";
    titleWrap.appendChild(this.iconEl);
    titleWrap.appendChild(this.titleEl);
    titleWrap.appendChild(this.queueBadgeEl);
    header.appendChild(titleWrap);
    header.appendChild(this.dismissBtn);

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "rqp-subtitle";

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "rqp-body";

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "rqp-countdown";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "rqp-status";
    this.statusEl.style.display = "none";

    const btnRow = document.createElement("div");
    btnRow.className = "rqp-btn-row";
    this.declineBtn = document.createElement("button");
    this.declineBtn.className = "rqp-btn rqp-btn-decline";
    this.declineBtn.addEventListener("click", () => void this.handleDecline());
    this.acceptBtn = document.createElement("button");
    this.acceptBtn.className = "rqp-btn rqp-btn-accept";
    this.acceptBtn.addEventListener("click", () => void this.handleAccept());
    btnRow.appendChild(this.declineBtn);
    btnRow.appendChild(this.acceptBtn);

    this.cardEl.appendChild(header);
    this.cardEl.appendChild(this.subtitleEl);
    this.cardEl.appendChild(this.bodyEl);
    this.cardEl.appendChild(this.countdownEl);
    this.cardEl.appendChild(this.statusEl);
    this.cardEl.appendChild(btnRow);
    this.container.appendChild(this.cardEl);
    document.body.appendChild(this.container);
    this.injectStyles();

    document.addEventListener("keydown", this.onKeydown);
  }

  /** Queue a request for display. Shows immediately if nothing else is open. */
  enqueue(item: RequestPopupItem) {
    if (this.current && this.current.kind === item.kind && this.current.id === item.id) return;
    if (this.queue.some((q) => q.kind === item.kind && q.id === item.id)) return;
    this.queue.push(item);
    if (!this.current) this.showNext();
    else this.updateQueueBadge();
  }

  /**
   * Pause display (used during XR session). Queue keeps growing; resuming
   * displays the next item. Already-actioned items keep their state.
   */
  setSuspended(suspended: boolean) {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    if (suspended) {
      this.container.style.display = "none";
      this.stopCountdownTimer();
    } else {
      // Resume: if we already have a current item, re-display it. Otherwise pull next.
      if (this.current) {
        if (this.current.expiresAtMs !== undefined && this.current.expiresAtMs < Date.now()) {
          this.advance();
        } else {
          this.show();
          if (this.current.expiresAtMs !== undefined) this.startCountdownTimer();
        }
      } else {
        this.showNext();
      }
    }
  }

  /** Wipe queue and hide. Use on wallet/identity change. */
  clear() {
    this.queue.length = 0;
    this.current = null;
    this.inFlight = false;
    this.stopCountdownTimer();
    this.hide();
    this.updateQueueBadge();
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (this.container.style.display === "none") return;
    if (this.inFlight) return;
    e.preventDefault();
    this.dismissCurrent();
  };

  private showNext() {
    const next = this.queue.shift() ?? null;
    this.current = next;
    if (!next) {
      this.hide();
      this.updateQueueBadge();
      return;
    }
    if (next.expiresAtMs !== undefined && next.expiresAtMs < Date.now()) {
      this.showNext();
      return;
    }
    if (this.suspended) {
      // Hold this item; it will display when resumed.
      this.updateQueueBadge();
      return;
    }
    this.render(next);
    this.show();
    this.playNotificationSfx();
    // Defer focus so it sticks after the show.
    setTimeout(() => { try { this.acceptBtn.focus(); } catch { /* ignore */ } }, 0);
  }

  private render(item: RequestPopupItem) {
    const theme = KIND_THEME[item.kind];
    this.cardEl.style.setProperty("--rqp-accent", theme.color);
    this.iconEl.textContent = theme.icon;
    this.titleEl.textContent = item.title;
    this.subtitleEl.textContent = item.subtitle;
    this.bodyEl.innerHTML = item.rows
      .map((r) => `<div class="rqp-row"><span class="rqp-label">${escapeHtml(r.label)}</span><span class="rqp-value">${escapeHtml(r.value)}</span></div>`)
      .join("");
    this.acceptBtn.textContent = item.acceptLabel ?? "Accept";
    this.declineBtn.textContent = item.declineLabel ?? "Decline";
    this.acceptBtn.disabled = false;
    this.declineBtn.disabled = false;
    this.statusEl.style.display = "none";
    this.statusEl.textContent = "";
    this.statusEl.classList.remove("rqp-status-error");
    this.updateQueueBadge();

    if (item.expiresAtMs !== undefined) {
      this.countdownEl.style.display = "block";
      this.updateCountdown();
      this.startCountdownTimer();
    } else {
      this.countdownEl.style.display = "none";
      this.stopCountdownTimer();
    }
  }

  private updateQueueBadge() {
    const remaining = this.queue.length;
    if (remaining > 0) {
      this.queueBadgeEl.textContent = `+${remaining} more`;
      this.queueBadgeEl.style.display = "inline-block";
    } else {
      this.queueBadgeEl.style.display = "none";
    }
  }

  private updateCountdown() {
    if (!this.current || this.current.expiresAtMs === undefined) return;
    const remainMs = this.current.expiresAtMs - Date.now();
    if (remainMs <= 0) {
      this.countdownEl.textContent = "Expired";
      this.countdownEl.classList.add("rqp-expired");
      this.acceptBtn.disabled = true;
      this.declineBtn.disabled = true;
      setTimeout(() => { if (this.current) this.dismissCurrent(); }, 1200);
      return;
    }
    const sec = Math.ceil(remainMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    this.countdownEl.textContent = m > 0 ? `Expires in ${m}m ${s}s` : `Expires in ${s}s`;
    this.countdownEl.classList.toggle("rqp-warning", remainMs < 30_000);
    this.countdownEl.classList.remove("rqp-expired");
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

  private playNotificationSfx() {
    const now = Date.now();
    if (now - this.lastSfxMs < NOTIFICATION_SFX_DEBOUNCE_MS) return;
    this.lastSfxMs = now;
    playSoundEffect("ui_notification");
  }

  private async handleAccept() {
    if (!this.current || this.inFlight) return;
    const item = this.current;
    // Recheck expiry before firing the API call — avoids wasted requests.
    if (item.expiresAtMs !== undefined && item.expiresAtMs < Date.now()) {
      this.setStatus("Expired", true);
      setTimeout(() => this.dismissCurrent(), 600);
      return;
    }
    this.inFlight = true;
    this.acceptBtn.disabled = true;
    this.declineBtn.disabled = true;
    this.setStatus("Accepting…", false);
    playSoundEffect("ui_button_click");
    try {
      const res = await item.onAccept();
      if (res.ok) {
        this.setStatus("Accepted!", false);
        setTimeout(() => this.advance(), 700);
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
    const item = this.current;
    if (item.expiresAtMs !== undefined && item.expiresAtMs < Date.now()) {
      this.advance();
      return;
    }
    this.inFlight = true;
    this.acceptBtn.disabled = true;
    this.declineBtn.disabled = true;
    this.setStatus("Declining…", false);
    playSoundEffect("ui_button_click");
    try {
      const res = await item.onDecline();
      if (res.ok) {
        this.setStatus("Declined.", false);
        setTimeout(() => this.advance(), 500);
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
    this.statusEl.classList.toggle("rqp-status-error", isError);
  }

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
    if (document.getElementById("rqp-styles")) return;
    const style = document.createElement("style");
    style.id = "rqp-styles";
    style.textContent = `
      #request-popup {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.35);
        padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
      }
      #request-popup .rqp-card {
        --rqp-accent: #5dff9a;
        min-width: 320px;
        max-width: 440px;
        background: rgba(18, 14, 22, 0.96);
        border: 2px solid var(--rqp-accent);
        border-radius: 10px;
        box-shadow: 0 0 32px color-mix(in srgb, var(--rqp-accent) 45%, transparent), 0 8px 24px rgba(0,0,0,0.6);
        backdrop-filter: blur(8px);
        font-family: 'Courier New', monospace;
        color: #f5f0f0;
        padding: 16px 18px;
        animation: rqp-pulse 1.8s ease-in-out infinite;
      }
      @keyframes rqp-pulse {
        0%, 100% { box-shadow: 0 0 28px color-mix(in srgb, var(--rqp-accent) 40%, transparent), 0 8px 24px rgba(0,0,0,0.6); }
        50%      { box-shadow: 0 0 48px color-mix(in srgb, var(--rqp-accent) 70%, transparent), 0 8px 24px rgba(0,0,0,0.6); }
      }
      #request-popup .rqp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;
        gap: 8px;
      }
      #request-popup .rqp-title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
      }
      #request-popup .rqp-icon {
        font-size: 16px;
        color: var(--rqp-accent);
        text-shadow: 0 0 6px color-mix(in srgb, var(--rqp-accent) 60%, transparent);
      }
      #request-popup .rqp-title {
        font-weight: bold;
        font-size: 14px;
        letter-spacing: 1px;
        color: var(--rqp-accent);
        text-shadow: 0 0 6px color-mix(in srgb, var(--rqp-accent) 60%, transparent);
      }
      #request-popup .rqp-queue-badge {
        display: inline-block;
        font-size: 10px;
        font-weight: bold;
        letter-spacing: 0.5px;
        padding: 2px 8px;
        border-radius: 10px;
        background: rgba(255,255,255,0.12);
        color: #fff;
      }
      #request-popup .rqp-dismiss {
        background: transparent;
        border: none;
        color: #999;
        font-size: 20px;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
        border-radius: 4px;
      }
      #request-popup .rqp-dismiss:hover { color: #fff; background: rgba(255,255,255,0.08); }
      #request-popup .rqp-dismiss:focus-visible { outline: 2px solid var(--rqp-accent); outline-offset: 2px; }
      #request-popup .rqp-subtitle {
        font-size: 11px;
        color: #999;
        margin-bottom: 12px;
      }
      #request-popup .rqp-body { margin-bottom: 4px; }
      #request-popup .rqp-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 12px;
        gap: 12px;
      }
      #request-popup .rqp-label { color: #999; flex-shrink: 0; }
      #request-popup .rqp-value { color: #fff; font-weight: bold; max-width: 60%; text-align: right; overflow-wrap: anywhere; }
      #request-popup .rqp-countdown {
        font-size: 11px;
        color: #aaa;
        text-align: center;
        margin: 10px 0;
        padding: 6px;
        background: rgba(255,255,255,0.04);
        border-radius: 4px;
      }
      #request-popup .rqp-countdown.rqp-warning { color: #ffc24f; }
      #request-popup .rqp-countdown.rqp-expired { color: var(--rqp-accent); }
      #request-popup .rqp-status {
        font-size: 11px;
        text-align: center;
        padding: 6px;
        margin-bottom: 8px;
        color: #5dff9a;
      }
      #request-popup .rqp-status.rqp-status-error { color: #ff4466; }
      #request-popup .rqp-btn-row {
        display: flex;
        gap: 10px;
        margin-top: 8px;
      }
      #request-popup .rqp-btn {
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
        min-height: 36px;
      }
      #request-popup .rqp-btn:hover:not(:disabled) { filter: brightness(1.2); }
      #request-popup .rqp-btn:active:not(:disabled) { transform: translateY(1px); }
      #request-popup .rqp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      #request-popup .rqp-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      #request-popup .rqp-btn-accept {
        background: var(--rqp-accent);
        color: #0a0a0a;
      }
      #request-popup .rqp-btn-decline {
        background: #444;
        color: #fff;
        border: 1px solid #666;
      }

      /* Mobile: full-width card, larger tap targets, no expensive blur */
      @media (max-width: 480px) {
        #request-popup .rqp-card {
          min-width: 0;
          width: calc(100vw - 24px);
          max-width: calc(100vw - 24px);
          margin: 12px;
          padding: 14px 14px;
          backdrop-filter: none;
          animation: none;
        }
        #request-popup .rqp-btn { padding: 14px; font-size: 13px; min-height: 44px; }
        #request-popup .rqp-dismiss { padding: 8px 12px; font-size: 24px; }
        #request-popup .rqp-row { font-size: 13px; }
      }

      /* Reduced-motion: drop the pulsing border */
      @media (prefers-reduced-motion: reduce) {
        #request-popup .rqp-card { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
