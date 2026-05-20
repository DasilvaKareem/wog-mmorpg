import { fetchNanopayStatus, submitTopUp, type NanopayStatus } from "../api.js";
import { playSoundEffect } from "../sfx.js";

export interface AgentStats {
  goldCopper: number;   // raw copper (10,000 copper = 1 gold)
  xp: number;
  level: number;
  maxXp?: number;
}

interface WalletPanelOptions {
  getToken: () => Promise<string | null>;
  getWallet: () => string | null;
  getStats?: () => AgentStats | null;
}

const TOP_UP_AMOUNTS = [0.1, 0.25, 1.0];
const POLL_MS = 2000;
const MAX_SAMPLES = 150;                     // 5-minute rolling window at 2s polls
const MIN_WINDOW_MS = 10_000;               // need ≥10s of data before showing rate
const FALLBACK_DRAIN_PER_MS = 0.000001 / 1200;

// ── formatting helpers ────────────────────────────────────────────────────────

function fmtUsdc(n: number): string {
  if (n <= 0) return "$0.000000";
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01)   return `$${n.toFixed(5)}`;
  if (n < 0.1)    return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function fmtGold(copper: number): string {
  const gold = copper / 10_000;
  if (gold >= 10_000) return `${(gold / 1000).toFixed(1)}k`;
  if (gold >= 1_000)  return `${(gold / 1000).toFixed(2)}k`;
  if (gold >= 1)      return gold.toFixed(1);
  return `${Math.round(copper)}c`;
}

function fmtXp(xp: number): string {
  if (xp >= 1_000_000) return `${(xp / 1_000_000).toFixed(2)}M`;
  if (xp >= 1_000)     return `${(xp / 1_000).toFixed(1)}k`;
  return Math.round(xp).toString();
}

function hoursRemaining(remaining: number): string {
  if (remaining <= 0) return "0 hrs";
  const HOURLY = 0.035;
  const h = remaining / HOURLY;
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} hr${h >= 2 ? "s" : ""}`;
}

// ── stat sample ring buffer ───────────────────────────────────────────────────

interface StatSample {
  ts: number;
  goldCopper: number;
  xp: number;
}

function computePerHour(samples: StatSample[], field: "goldCopper" | "xp"): number | null {
  if (samples.length < 2) return null;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const elapsedMs = newest.ts - oldest.ts;
  if (elapsedMs < MIN_WINDOW_MS) return null;
  const delta = newest[field] - oldest[field];
  if (delta <= 0) return null; // not earning yet (or decreased — don't show negative)
  return (delta / elapsedMs) * 3_600_000;
}

// ── component ─────────────────────────────────────────────────────────────────

export class WalletPanel {
  private container: HTMLDivElement;
  private body: HTMLDivElement;

  // Nanopay state
  private status: NanopayStatus | null = null;
  private displayed = 0;
  private drainPerMs = 0;
  private lastPollAt = 0;
  private lastPollRemaining = 0;
  private rafHandle = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  // Stat tracking
  private statSamples: StatSample[] = [];
  private latestStats: AgentStats | null = null;
  private goldPerHour: number | null = null;
  private xpPerHour: number | null = null;

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
    (header.querySelector(".wp-close") as HTMLButtonElement)
      .addEventListener("click", () => this.hide());
    this.container.appendChild(header);

    this.body = document.createElement("div");
    this.body.className = "wp-body";
    this.container.appendChild(this.body);

    document.body.appendChild(this.container);
    this.injectStyles();
    this.render();
  }

  // ── public API ────────────────────────────────────────────────────────────

  show() {
    this.container.style.display = "flex";
    void this.poll();
    this.startPolling();
    this.startAnimation();
  }

  hide() {
    this.container.style.display = "none";
    this.stopPolling();
    this.stopAnimation();
  }

  isVisible() { return this.container.style.display !== "none"; }

  // ── polling ───────────────────────────────────────────────────────────────

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => { void this.poll(); }, POLL_MS);
  }

  private stopPolling() {
    if (this.pollTimer !== null) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private async poll() {
    const wallet = this.options.getWallet();
    const token  = await this.options.getToken();
    if (!wallet || !token) return;

    // Snapshot stats before awaiting so timestamp aligns with the fetch
    const stats = this.options.getStats?.() ?? null;

    try {
      const s = await fetchNanopayStatus(wallet, token);
      if (!s) return;

      const now = performance.now();

      // Drain rate from consecutive nanopay polls
      if (this.lastPollAt > 0 && this.lastPollRemaining > s.remaining) {
        this.drainPerMs = (this.lastPollRemaining - s.remaining) / (now - this.lastPollAt);
      } else if (s.remaining >= this.lastPollRemaining && this.lastPollAt > 0) {
        this.drainPerMs = 0;
      }
      this.lastPollAt        = now;
      this.lastPollRemaining = s.remaining;
      this.displayed         = s.remaining;

      // Stat sampling
      if (stats && stats.goldCopper >= 0 && stats.xp >= 0) {
        this.latestStats = stats;
        this.statSamples.push({ ts: Date.now(), goldCopper: stats.goldCopper, xp: stats.xp });
        if (this.statSamples.length > MAX_SAMPLES) this.statSamples.shift();
        this.goldPerHour = computePerHour(this.statSamples, "goldCopper");
        this.xpPerHour   = computePerHour(this.statSamples, "xp");
      }

      const prevStatus = this.status;
      this.status = s;

      const structureChanged =
        !prevStatus ||
        prevStatus.needsTopUp !== s.needsTopUp ||
        prevStatus.lowBalance  !== s.lowBalance  ||
        prevStatus.freeGranted !== s.freeGranted ||
        Math.abs(prevStatus.budget - s.budget) > 0.0001;

      if (structureChanged) this.render();
      else this.updateStatChips(); // rate-only refresh, no full rebuild
    } catch { /* non-fatal */ }
  }

  // ── rAF drain animation ───────────────────────────────────────────────────

  private startAnimation() {
    this.stopAnimation();
    const tick = (now: number) => {
      this.rafHandle = requestAnimationFrame(tick);
      if (!this.status) return;
      const rate = this.drainPerMs > 0
        ? this.drainPerMs
        : (this.status.needsTopUp || !this.status.budget) ? 0 : FALLBACK_DRAIN_PER_MS;
      const elapsed = now - this.lastPollAt;
      this.displayed = Math.max(0, this.lastPollRemaining - rate * elapsed);
      this.updateLiveElements();
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private stopAnimation() {
    if (this.rafHandle) { cancelAnimationFrame(this.rafHandle); this.rafHandle = 0; }
  }

  private updateLiveElements() {
    const s = this.status;
    if (!s) return;
    const pct     = s.budget > 0 ? Math.max(0, Math.min(100, (this.displayed / s.budget) * 100)) : 0;
    const isEmpty = this.displayed <= 0;
    const isLow   = !isEmpty && s.budget > 0 && this.displayed / s.budget <= 0.2;

    const balEl  = this.body.querySelector<HTMLElement>(".wp-balance-usdc");
    const barEl  = this.body.querySelector<HTMLElement>(".wp-bar-fill");
    const hrsEl  = this.body.querySelector<HTMLElement>(".wp-hours");
    const spntEl = this.body.querySelector<HTMLElement>(".wp-spent");
    if (!balEl) return;

    balEl.textContent = fmtUsdc(this.displayed);
    balEl.classList.toggle("wp-balance-empty", isEmpty);
    balEl.classList.toggle("wp-balance-low",   isLow && !isEmpty);

    if (barEl) {
      barEl.style.width = `${pct}%`;
      barEl.classList.toggle("wp-bar-ok",    !isLow && !isEmpty);
      barEl.classList.toggle("wp-bar-low",   isLow);
      barEl.classList.toggle("wp-bar-empty", isEmpty);
    }
    if (hrsEl) hrsEl.textContent = isEmpty ? "Agent paused" : hoursRemaining(this.displayed);
    if (spntEl) spntEl.textContent = `Spent ${fmtUsdc(s.budget - this.displayed)}`;
  }

  /** Update only the stat chips without rebuilding the full DOM */
  private updateStatChips() {
    const chips = this.body.querySelector<HTMLElement>(".wp-stat-chips");
    if (!chips) return;
    chips.innerHTML = this.renderStatChipsHTML();
  }

  // ── top-up ────────────────────────────────────────────────────────────────

  private async topUp(amount: number) {
    if (this.busy) return;
    this.busy = true;
    const saved = this.body.innerHTML;
    this.body.innerHTML = `<div class="wp-busy">Adding ${fmtUsdc(amount)}…</div>`;
    try {
      const token = await this.options.getToken();
      if (!token) throw new Error("Not authenticated");
      const res = await submitTopUp(token, amount);
      if (!res.ok) throw new Error(res.error ?? "Top up failed");
      if (res.balance) {
        this.status            = res.balance;
        this.displayed         = res.balance.remaining;
        this.lastPollRemaining = res.balance.remaining;
        this.lastPollAt        = performance.now();
        this.drainPerMs        = 0;
      }
      playSoundEffect("ui_button_click");
    } catch (err: any) {
      console.warn("[WalletPanel] topUp error:", err.message);
      this.body.innerHTML = saved;
      return;
    } finally {
      this.busy = false;
    }
    this.render();
  }

  // ── render helpers ────────────────────────────────────────────────────────

  private renderStatChipsHTML(): string {
    const chips: string[] = [];

    if (this.goldPerHour !== null) {
      chips.push(`
        <div class="wp-chip">
          <span class="wp-chip-icon">🪙</span>
          <span class="wp-chip-val">${fmtGold(this.goldPerHour)}</span>
          <span class="wp-chip-label">gold/hr</span>
        </div>`);
    } else {
      chips.push(`
        <div class="wp-chip wp-chip-dim">
          <span class="wp-chip-icon">🪙</span>
          <span class="wp-chip-val">—</span>
          <span class="wp-chip-label">gold/hr</span>
        </div>`);
    }

    if (this.xpPerHour !== null) {
      chips.push(`
        <div class="wp-chip">
          <span class="wp-chip-icon">⭐</span>
          <span class="wp-chip-val">${fmtXp(this.xpPerHour)}</span>
          <span class="wp-chip-label">xp/hr</span>
        </div>`);
    } else {
      chips.push(`
        <div class="wp-chip wp-chip-dim">
          <span class="wp-chip-icon">⭐</span>
          <span class="wp-chip-val">—</span>
          <span class="wp-chip-label">xp/hr</span>
        </div>`);
    }

    if (this.latestStats) {
      const pctXp = this.latestStats.maxXp && this.latestStats.maxXp > 0
        ? Math.round((this.latestStats.xp / this.latestStats.maxXp) * 100)
        : null;
      chips.push(`
        <div class="wp-chip">
          <span class="wp-chip-icon">⚡</span>
          <span class="wp-chip-val">Lv ${this.latestStats.level}</span>
          <span class="wp-chip-label">${pctXp !== null ? `${pctXp}% xp` : "level"}</span>
        </div>`);
    }

    return chips.join("");
  }

  // ── full structural render ────────────────────────────────────────────────

  private render() {
    const s      = this.status;
    const wallet = this.options.getWallet();
    if (!s) {
      this.body.innerHTML = `<div class="wp-loading">Loading…</div>`;
      return;
    }

    const pct      = s.budget > 0 ? Math.max(0, Math.min(100, (this.displayed / s.budget) * 100)) : 0;
    const isEmpty  = this.displayed <= 0;
    const isLow    = !isEmpty && s.budget > 0 && this.displayed / s.budget <= 0.2;
    const barClass = isEmpty ? "wp-bar-empty" : isLow ? "wp-bar-low" : "wp-bar-ok";
    const balClass = isEmpty ? "wp-balance-empty" : isLow ? "wp-balance-low" : "";

    const topUpButtons = TOP_UP_AMOUNTS.map(
      (amt) => `<button class="wp-topup-btn" data-amt="${amt}">+ ${fmtUsdc(amt)}</button>`,
    ).join("");

    this.body.innerHTML = `
      <div class="wp-section">
        <div class="wp-section-label">Compute Budget</div>
        <div class="wp-balance-row">
          <span class="wp-balance-usdc ${balClass}">${fmtUsdc(this.displayed)}</span>
          <span class="wp-balance-sub">USDC</span>
        </div>
        <div class="wp-bar-track">
          <div class="wp-bar-fill ${barClass}" style="width:${pct}%"></div>
        </div>
        <div class="wp-bar-meta">
          <span class="wp-hours ${isEmpty ? "wp-hours-empty" : ""}">${isEmpty ? "Agent paused" : hoursRemaining(this.displayed)}</span>
          <span class="wp-spent">Spent ${fmtUsdc(s.budget - this.displayed)}</span>
        </div>
        ${isEmpty ? `<div class="wp-paused-banner">Agent paused — add USDC to resume</div>` : ""}
        ${isLow   ? `<div class="wp-low-banner">Balance getting low</div>` : ""}
        ${s.freeGranted && s.budget <= 0.051 && !isEmpty ? `<div class="wp-free-banner">Using $0.05 free starter credit</div>` : ""}
      </div>

      <div class="wp-section">
        <div class="wp-section-label">Session Stats</div>
        <div class="wp-stat-chips">${this.renderStatChipsHTML()}</div>
      </div>

      <div class="wp-section">
        <div class="wp-section-label">Top Up</div>
        <div class="wp-topup-row">${topUpButtons}</div>
      </div>

      <div class="wp-section">
        <div class="wp-section-label">Receive USDC</div>
        <div class="wp-receive-row">
          <span class="wp-receive-addr">${wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "—"}</span>
          <button class="wp-copy-btn" data-addr="${wallet ?? ""}" aria-label="Copy wallet address">Copy</button>
        </div>
        <div class="wp-receive-hint">Send USDC to this address from any wallet</div>
      </div>

      <div class="wp-section">
        <div class="wp-section-label">Pricing <a class="wp-pricing-link" href="/pricing" target="_blank">Full table ↗</a></div>
        <div class="wp-pricing-grid">
          <span class="wp-prow-label">Combat / gather</span><span class="wp-prow-val">$0.000001 / tick</span>
          <span class="wp-prow-label">AI decision</span><span class="wp-prow-val">$0.0001 / call</span>
          <span class="wp-prow-label">Chat message</span><span class="wp-prow-val">$0.001 / msg</span>
          <span class="wp-prow-label">Idle</span><span class="wp-prow-val">Free</span>
        </div>
      </div>
    `;

    this.body.querySelectorAll<HTMLButtonElement>(".wp-topup-btn").forEach((btn) => {
      btn.addEventListener("click", () => void this.topUp(parseFloat(btn.dataset.amt ?? "0.1")));
    });

    this.body.querySelector<HTMLButtonElement>(".wp-copy-btn")?.addEventListener("click", (e) => {
      const btn  = e.currentTarget as HTMLButtonElement;
      const addr = btn.dataset.addr ?? "";
      if (!addr) return;
      navigator.clipboard.writeText(addr).then(() => {
        btn.textContent = "Copied!";
        btn.classList.add("wp-copy-btn-ok");
        setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("wp-copy-btn-ok"); }, 1500);
      }).catch(() => {});
    });
  }

  // ── styles ────────────────────────────────────────────────────────────────

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
        flex-shrink: 0;
      }

      .wp-title {
        color: #7fd6be;
        font: 700 11px/1 "Courier New", monospace;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .wp-close {
        background: none; border: none;
        color: #8f8067; font-size: 20px;
        cursor: pointer; line-height: 1; padding: 0 2px;
      }
      .wp-close:hover { color: #f4ead0; }

      .wp-body { display: flex; flex-direction: column; }

      .wp-section {
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.04);
      }
      .wp-section:last-child { border-bottom: none; }

      .wp-section-label {
        color: #5a6070;
        font: 600 10px/1 "Courier New", monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        margin-bottom: 10px;
        display: flex; align-items: center; gap: 8px;
      }

      .wp-pricing-link {
        color: #7fd6be; font-size: 10px;
        text-decoration: none; margin-left: auto;
      }
      .wp-pricing-link:hover { text-decoration: underline; }

      /* ── Balance ── */

      .wp-balance-row {
        display: flex; align-items: baseline;
        gap: 6px; margin-bottom: 10px;
      }

      .wp-balance-usdc {
        color: #f4ead0;
        font: 700 28px/1 "Courier New", monospace;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        transition: color 0.5s ease;
      }
      .wp-balance-usdc.wp-balance-low   { color: #f0a030; }
      .wp-balance-usdc.wp-balance-empty { color: #ff6060; }

      .wp-balance-sub { color: #5a6070; font: 600 11px/1 "Courier New", monospace; }

      .wp-bar-track {
        height: 5px;
        background: rgba(255,255,255,0.06);
        border-radius: 99px; overflow: hidden;
        margin-bottom: 6px;
      }

      .wp-bar-fill {
        height: 100%; border-radius: 99px;
        transition: background 0.5s ease;
        /* width driven by rAF — no CSS transition */
      }
      .wp-bar-fill.wp-bar-ok    { background: linear-gradient(90deg, #3ab88a, #7fd6be); }
      .wp-bar-fill.wp-bar-low   { background: linear-gradient(90deg, #c07820, #f0a030); }
      .wp-bar-fill.wp-bar-empty { background: #ff4040; }

      .wp-bar-meta {
        display: flex; justify-content: space-between; margin-bottom: 6px;
      }

      .wp-hours { color: #8f9aaa; font: 500 10px/1 "Courier New", monospace; }
      .wp-hours.wp-hours-empty { color: #ff6060; font-weight: 700; }

      .wp-spent {
        color: #3a4050; font: 500 10px/1 "Courier New", monospace;
        font-variant-numeric: tabular-nums;
      }

      .wp-paused-banner, .wp-low-banner, .wp-free-banner {
        padding: 7px 10px; border-radius: 10px;
        font: 600 10px/1.4 "Courier New", monospace;
        letter-spacing: 0.06em; margin-top: 4px;
      }
      .wp-paused-banner {
        background: rgba(255,60,60,0.1); border: 1px solid rgba(255,60,60,0.25); color: #ff8080;
        text-transform: uppercase;
      }
      .wp-low-banner {
        background: rgba(240,160,48,0.1); border: 1px solid rgba(240,160,48,0.25); color: #f0a030;
        text-transform: uppercase;
      }
      .wp-free-banner {
        background: rgba(127,214,190,0.07); border: 1px solid rgba(127,214,190,0.18); color: #7fd6be;
      }

      /* ── Stat chips ── */

      .wp-stat-chips {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
      }

      .wp-chip {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px 6px 7px;
        border-radius: 12px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        gap: 3px;
      }

      .wp-chip-dim {
        opacity: 0.4;
      }

      .wp-chip-icon {
        font-size: 14px;
        line-height: 1;
      }

      .wp-chip-val {
        color: #f4ead0;
        font: 700 12px/1 "Courier New", monospace;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }

      .wp-chip-label {
        color: #5a6070;
        font: 500 9px/1 "Courier New", monospace;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      /* ── Top-up ── */

      .wp-topup-row { display: flex; gap: 8px; }

      .wp-topup-btn {
        flex: 1; padding: 10px 6px;
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

      /* ── Receive ── */

      .wp-receive-row {
        display: flex; align-items: center;
        gap: 8px; margin-bottom: 6px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px; padding: 9px 12px;
      }

      .wp-receive-addr {
        flex: 1;
        color: #8f9aaa;
        font: 600 12px/1 "Courier New", monospace;
        letter-spacing: 0.04em;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .wp-copy-btn {
        background: rgba(127,214,190,0.08);
        border: 1px solid rgba(127,214,190,0.2);
        border-radius: 8px; padding: 5px 10px;
        color: #7fd6be;
        font: 700 10px/1 "Courier New", monospace;
        letter-spacing: 0.08em; cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        flex-shrink: 0;
      }
      .wp-copy-btn:hover { background: rgba(127,214,190,0.16); border-color: rgba(127,214,190,0.4); }
      .wp-copy-btn.wp-copy-btn-ok { color: #3ab88a; border-color: rgba(58,184,138,0.4); }

      .wp-receive-hint {
        color: #3a4050;
        font: 500 9px/1.3 "Courier New", monospace;
        letter-spacing: 0.06em;
      }

      /* ── Pricing ── */

      .wp-pricing-grid { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; }
      .wp-prow-label { color: #6a7080; font: 500 10px/1.3 "Courier New", monospace; }
      .wp-prow-val   { color: #8f9aaa; font: 600 10px/1.3 "Courier New", monospace; text-align: right; white-space: nowrap; }

      .wp-loading, .wp-busy {
        padding: 24px 16px; color: #5a6070;
        font: 500 11px/1 "Courier New", monospace;
        text-align: center; letter-spacing: 0.1em;
      }

      @media (max-width: 480px) {
        #wallet-panel { right: 8px; bottom: 68px; width: calc(100vw - 16px); border-radius: 16px; }
      }
    `;
    document.head.appendChild(style);
  }
}
