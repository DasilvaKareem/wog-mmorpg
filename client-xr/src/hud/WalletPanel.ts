import { fetchNanopayStatus, submitTopUp, type NanopayStatus } from "../api.js";
import { playSoundEffect } from "../sfx.js";

interface WalletPanelOptions {
  getToken: () => Promise<string | null>;
  getWallet: () => string | null;
  onAgentResume?: () => void;
}

const TOP_UP_AMOUNTS = [0.1, 0.25, 1.0];

const HOURLY_RATE_USDC = 0.035; // ~$0.001 chat + ~$0.012 supervisor + ~$0.022 combat ticks

function hoursRemaining(remaining: number): string {
  if (remaining <= 0) return "0 hrs";
  const h = remaining / HOURLY_RATE_USDC;
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} hr${h >= 2 ? "s" : ""}`;
}

function fmt(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export class WalletPanel {
  private container: HTMLDivElement;
  private body: HTMLDivElement;
  private status: NanopayStatus | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private options: WalletPanelOptions;

  constructor(options: WalletPanelOptions) {
    this.options = options;

    this.container = document.createElement("div");
    this.container.id = "wallet-panel";
    this.container.style.display = "none";

    const header = document.createElement("div");
    header.className = "wp-header";
    header.innerHTML = `
      <span class="wp-title">Agent Wallet</span>
      <button class="wp-close" aria-label="Close">×</button>
    `;
    (header.querySelector(".wp-close") as HTMLButtonElement).addEventListener("click", () => this.hide());
    this.container.appendChild(header);

    this.body = document.createElement("div");
    this.body.className = "wp-body";
    this.container.appendChild(this.body);

    document.body.appendChild(this.container);
    this.injectStyles();
    this.render();
  }

  show() {
    this.container.style.display = "flex";
    this.startPolling();
    void this.poll();
  }

  hide() {
    this.container.style.display = "none";
    this.stopPolling();
  }

  isVisible() {
    return this.container.style.display !== "none";
  }

  /** Called externally after agent resumes so the badge can clear. */
  updateStatus(s: NanopayStatus) {
    this.status = s;
    if (this.isVisible()) this.render();
  }

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => { void this.poll(); }, 2000);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll() {
    const wallet = this.options.getWallet();
    const token = await this.options.getToken();
    if (!wallet || !token) return;
    try {
      const s = await fetchNanopayStatus(wallet, token);
      if (s) {
        this.status = s;
        if (this.isVisible()) this.render();
      }
    } catch { /* non-fatal */ }
  }

  private async topUp(amount: number) {
    if (this.busy) return;
    this.busy = true;
    this.renderBusy(`Adding ${fmt(amount)}…`);
    try {
      const token = await this.options.getToken();
      if (!token) throw new Error("Not authenticated");
      const res = await submitTopUp(token, amount);
      if (!res.ok) throw new Error(res.error ?? "Top up failed");
      if (res.balance) this.status = res.balance;
      playSoundEffect("ui_button_click");
    } catch (err: any) {
      console.warn("[WalletPanel] topUp error:", err.message);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private renderBusy(msg: string) {
    this.body.innerHTML = `<div class="wp-busy">${msg}</div>`;
  }

  private render() {
    const s = this.status;

    if (!s) {
      this.body.innerHTML = `<div class="wp-loading">Loading…</div>`;
      return;
    }

    const pct = s.budget > 0 ? Math.max(0, Math.min(100, (s.remaining / s.budget) * 100)) : 0;
    const barClass = s.needsTopUp ? "wp-bar-empty" : s.lowBalance ? "wp-bar-low" : "wp-bar-ok";
    const hoursLabel = s.needsTopUp ? "Agent paused" : hoursRemaining(s.remaining);

    const topUpButtons = TOP_UP_AMOUNTS.map(
      (amt) => `<button class="wp-topup-btn" data-amt="${amt}">+ ${fmt(amt)}</button>`,
    ).join("");

    this.body.innerHTML = `
      <div class="wp-section">
        <div class="wp-section-label">Compute Budget</div>
        <div class="wp-balance-row">
          <span class="wp-balance-usdc ${s.needsTopUp ? "wp-balance-empty" : s.lowBalance ? "wp-balance-low" : ""}">${fmt(s.remaining)}</span>
          <span class="wp-balance-sub">USDC</span>
        </div>
        <div class="wp-bar-track">
          <div class="wp-bar-fill ${barClass}" style="width:${pct}%"></div>
        </div>
        <div class="wp-bar-meta">
          <span class="wp-hours ${s.needsTopUp ? "wp-hours-empty" : ""}">${hoursLabel}</span>
          <span class="wp-spent">Spent ${fmt(s.spent)}</span>
        </div>
        ${s.needsTopUp ? `<div class="wp-paused-banner">Agent paused — add USDC to resume</div>` : ""}
        ${s.lowBalance && !s.needsTopUp ? `<div class="wp-low-banner">Balance getting low</div>` : ""}
        ${s.freeGranted && s.budget <= 0.051 && !s.needsTopUp ? `<div class="wp-free-banner">Using your $0.05 free starter credit</div>` : ""}
      </div>

      <div class="wp-section">
        <div class="wp-section-label">Top Up</div>
        <div class="wp-topup-row">${topUpButtons}</div>
      </div>

      <div class="wp-section wp-pricing">
        <div class="wp-section-label">Pricing <a class="wp-pricing-link" href="/pricing" target="_blank">Full table ↗</a></div>
        <div class="wp-pricing-grid">
          <span class="wp-prow-label">Combat / gather</span><span class="wp-prow-val">$0.000001 / tick</span>
          <span class="wp-prow-label">AI decision</span><span class="wp-prow-val">$0.0001 / call</span>
          <span class="wp-prow-label">Chat message</span><span class="wp-prow-val">$0.001 / msg</span>
          <span class="wp-prow-label">Idle</span><span class="wp-prow-val">Free</span>
        </div>
      </div>
    `;

    // Top-up button handlers
    this.body.querySelectorAll<HTMLButtonElement>(".wp-topup-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const amt = parseFloat(btn.dataset.amt ?? "0.1");
        void this.topUp(amt);
      });
    });
  }

  private injectStyles() {
    if (document.getElementById("wp-styles")) return;
    const style = document.createElement("style");
    style.id = "wp-styles";
    style.textContent = `
      #wallet-panel {
        position: fixed;
        bottom: 72px;
        right: 16px;
        width: min(340px, calc(100vw - 24px));
        max-height: calc(100vh - 100px);
        overflow-y: auto;
        z-index: 38;
        display: flex;
        flex-direction: column;
        font-family: "Courier New", monospace;
        background: linear-gradient(180deg, rgba(10,14,20,0.97) 0%, rgba(6,9,14,0.99) 100%);
        border: 1px solid rgba(127,214,190,0.22);
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(127,214,190,0.06);
        box-sizing: border-box;
      }

      .wp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px 10px;
        border-bottom: 1px solid rgba(127,214,190,0.1);
      }

      .wp-title {
        color: #7fd6be;
        font: 700 11px/1 "Courier New", monospace;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .wp-close {
        background: none;
        border: none;
        color: #8f8067;
        font-size: 20px;
        cursor: pointer;
        line-height: 1;
        padding: 0 2px;
      }
      .wp-close:hover { color: #f4ead0; }

      .wp-body {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0;
      }

      .wp-section {
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.04);
      }
      .wp-section:last-child { border-bottom: none; }

      .wp-section-label {
        color: #5a6070;
        font: 600 10px/1 "Courier New", monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .wp-pricing-link {
        color: #7fd6be;
        font-size: 10px;
        text-decoration: none;
        margin-left: auto;
      }
      .wp-pricing-link:hover { text-decoration: underline; }

      .wp-balance-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        margin-bottom: 10px;
      }

      .wp-balance-usdc {
        color: #f4ead0;
        font: 700 28px/1 "Courier New", monospace;
        transition: color 0.4s ease;
      }
      .wp-balance-usdc.wp-balance-low  { color: #f0a030; }
      .wp-balance-usdc.wp-balance-empty { color: #ff6060; }

      .wp-balance-sub {
        color: #5a6070;
        font: 600 11px/1 "Courier New", monospace;
      }

      .wp-bar-track {
        height: 6px;
        background: rgba(255,255,255,0.06);
        border-radius: 99px;
        overflow: hidden;
        margin-bottom: 6px;
      }

      .wp-bar-fill {
        height: 100%;
        border-radius: 99px;
        transition: width 1.2s ease, background 0.4s ease;
      }
      .wp-bar-fill.wp-bar-ok    { background: linear-gradient(90deg, #3ab88a, #7fd6be); }
      .wp-bar-fill.wp-bar-low   { background: linear-gradient(90deg, #c07820, #f0a030); }
      .wp-bar-fill.wp-bar-empty { background: #ff4040; }

      .wp-bar-meta {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .wp-hours {
        color: #8f9aaa;
        font: 500 10px/1 "Courier New", monospace;
      }
      .wp-hours.wp-hours-empty { color: #ff6060; font-weight: 700; }

      .wp-spent {
        color: #3a4050;
        font: 500 10px/1 "Courier New", monospace;
      }

      .wp-paused-banner {
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255,60,60,0.1);
        border: 1px solid rgba(255,60,60,0.25);
        color: #ff8080;
        font: 600 10px/1.4 "Courier New", monospace;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-top: 4px;
      }

      .wp-low-banner {
        padding: 7px 10px;
        border-radius: 10px;
        background: rgba(240,160,48,0.1);
        border: 1px solid rgba(240,160,48,0.25);
        color: #f0a030;
        font: 600 10px/1.4 "Courier New", monospace;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-top: 4px;
      }

      .wp-free-banner {
        padding: 7px 10px;
        border-radius: 10px;
        background: rgba(127,214,190,0.07);
        border: 1px solid rgba(127,214,190,0.18);
        color: #7fd6be;
        font: 600 10px/1.4 "Courier New", monospace;
        letter-spacing: 0.06em;
        margin-top: 4px;
      }

      .wp-topup-row {
        display: flex;
        gap: 8px;
      }

      .wp-topup-btn {
        flex: 1;
        padding: 10px 6px;
        border-radius: 12px;
        border: 1px solid rgba(127,214,190,0.2);
        background: rgba(127,214,190,0.07);
        color: #7fd6be;
        font: 700 11px/1 "Courier New", monospace;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, transform 0.15s;
        letter-spacing: 0.06em;
      }
      .wp-topup-btn:hover {
        background: rgba(127,214,190,0.16);
        border-color: rgba(127,214,190,0.4);
        transform: translateY(-1px);
      }
      .wp-topup-btn:active { transform: translateY(0); }

      .wp-pricing-grid {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 5px 12px;
      }

      .wp-prow-label {
        color: #6a7080;
        font: 500 10px/1.3 "Courier New", monospace;
      }

      .wp-prow-val {
        color: #8f9aaa;
        font: 600 10px/1.3 "Courier New", monospace;
        text-align: right;
        white-space: nowrap;
      }

      .wp-loading, .wp-busy {
        padding: 24px 16px;
        color: #5a6070;
        font: 500 11px/1 "Courier New", monospace;
        text-align: center;
        letter-spacing: 0.1em;
      }

      @media (max-width: 480px) {
        #wallet-panel {
          right: 8px;
          bottom: 68px;
          width: calc(100vw - 16px);
          border-radius: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
