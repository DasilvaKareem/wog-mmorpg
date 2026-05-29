import { fetchNanopayStatus, fetchNanopayBreakdown, fetchTelegramStatus, fetchTelegramBotLink, type NanopayStatus, type SpendBreakdown } from "../api.js";

export interface AgentStats {
  goldCopper: number;   // raw copper (10,000 copper = 1 gold)
  xp: number;
  level: number;
  maxXp?: number;
}

interface WalletPanelOptions {
  getToken: () => Promise<string | null>;
  /** Owner wallet — used for auth-bound API calls (status/breakdown). */
  getWallet: () => string | null;
  /** Optional custodial deposit address — shown in the copy button. Falls back to getWallet(). */
  getReceiveAddress?: () => string | null;
  getStats?: () => AgentStats | null;
}

const POLL_MS = 2000;
const MAX_SAMPLES = 150;
const MIN_WINDOW_MS = 10_000;

// ── formatting helpers ────────────────────────────────────────────────────────

function fmtUsdc(n: number): string {
  if (n <= 0) return "$0.000000";
  // Always show 6 decimals — agent actions cost as little as $0.000001, so
  // anything coarser (e.g. 3 decimals on a $20 balance) makes the number look
  // frozen and hides spend. Full precision lets users watch the balance drain.
  return `$${n.toFixed(6)}`;
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

function fmtAgo(ts: number): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
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

  // Stat tracking
  private statSamples: StatSample[] = [];
  private latestStats: AgentStats | null = null;
  private goldPerHour: number | null = null;
  private xpPerHour: number | null = null;

  // Telegram state
  private telegramLinked = false;
  private telegramUrl: string | null = null;

  // Breakdown state
  private breakdown: SpendBreakdown | null = null;
  private breakdownLoaded = false;

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
    void this.fetchTelegramInfo();
    void this.fetchBreakdown();
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

  private async fetchTelegramInfo() {
    const wallet = this.options.getWallet();
    if (!wallet) return;
    try {
      const [statusRes, linkRes] = await Promise.all([
        fetchTelegramStatus(wallet),
        fetchTelegramBotLink(wallet),
      ]);
      const linked = statusRes?.linked ?? false;
      const url    = linkRes?.url ?? null;
      if (linked !== this.telegramLinked || url !== this.telegramUrl) {
        this.telegramLinked = linked;
        this.telegramUrl    = url;
        this.updateTelegramRow();
      }
    } catch { /* non-fatal */ }
  }

  private async fetchBreakdown() {
    const wallet = this.options.getWallet();
    const token  = await this.options.getToken();
    if (!wallet || !token) return;
    try {
      const data = await fetchNanopayBreakdown(wallet, token);
      this.breakdown = data;
      this.breakdownLoaded = true;
      const el = this.body.querySelector<HTMLElement>(".wp-history-list");
      if (el) el.innerHTML = this.renderBreakdownHTML();
    } catch { /* non-fatal */ }
  }

  private updateTelegramRow() {
    const row = this.body.querySelector<HTMLElement>(".wp-telegram-row");
    if (!row) return;
    row.innerHTML = this.renderTelegramRowInnerHTML();
    this.wireTelegramBtn(row);
  }

  private renderTelegramRowInnerHTML(): string {
    if (this.telegramLinked) {
      return `
        <span class="wp-contact-icon">✈️</span>
        <span class="wp-tg-connected">Telegram connected</span>
      `;
    }
    if (this.telegramUrl) {
      return `
        <span class="wp-contact-icon">✈️</span>
        <a class="wp-tg-btn" href="${this.telegramUrl}" target="_blank" rel="noopener">
          Connect Telegram →
        </a>
      `;
    }
    return `
      <span class="wp-contact-icon">✈️</span>
      <span class="wp-tg-unavailable">Telegram not configured</span>
    `;
  }

  private wireTelegramBtn(row: HTMLElement) {
    row.querySelector<HTMLAnchorElement>(".wp-tg-btn")?.addEventListener("click", () => {
      // After user opens the bot, re-poll status in a few seconds
      setTimeout(() => { void this.fetchTelegramInfo(); }, 5000);
      setTimeout(() => { void this.fetchTelegramInfo(); }, 15000);
    });
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
      // Only interpolate when we've measured a real drain from consecutive polls.
      // Without it, display holds at the last server value — no false animation.
      if (this.drainPerMs > 0) {
        const elapsed = now - this.lastPollAt;
        this.displayed = Math.max(0, this.lastPollRemaining - this.drainPerMs * elapsed);
        this.updateLiveElements();
      }
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

  // ── history helpers ───────────────────────────────────────────────────────

  private renderBreakdownHTML(): string {
    if (!this.breakdownLoaded) return `<div class="wp-history-empty">Loading…</div>`;

    const bd   = this.breakdown;
    const LABELS: Record<string, string> = {
      supervisor: "AI decisions",
      chat:       "Chat messages",
      banter:     "Banter",
      combat:     "Combat",
      gather:     "Gathering",
    };
    const ORDER = ["supervisor", "chat", "banter", "combat", "gather"];

    const rows: string[] = [];

    // Spending breakdown bars
    const entries = ORDER
      .map((k) => ({ key: k, val: bd?.breakdown[k] ?? 0 }))
      .filter((e) => e.val > 0);

    if (entries.length > 0) {
      const total = entries.reduce((s, e) => s + e.val, 0);
      for (const { key, val } of entries) {
        const pct    = total > 0 ? Math.round((val / total) * 100) : 0;
        const amt    = val < 0.001 ? val.toFixed(6) : val < 1 ? val.toFixed(4) : val.toFixed(2);
        rows.push(`
          <div class="wp-bd-row">
            <span class="wp-bd-label">${LABELS[key] ?? key}</span>
            <div class="wp-bd-bar-track">
              <div class="wp-bd-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="wp-bd-pct">${pct}%</span>
            <span class="wp-bd-amt">$${amt}</span>
          </div>`);
      }
    } else {
      rows.push(`<div class="wp-history-empty">No spend yet this session</div>`);
    }

    // Top-ups
    const topups = bd?.topups ?? [];
    if (topups.length > 0) {
      rows.push(`<div class="wp-bd-divider">Top-ups</div>`);
      for (const t of topups.slice(0, 5)) {
        const amt = t.amount < 1 ? t.amount.toFixed(4) : t.amount.toFixed(2);
        rows.push(`
          <div class="wp-hist-row">
            <span class="wp-hist-label">Added funds</span>
            <span class="wp-hist-ago">${fmtAgo(t.ts)}</span>
            <span class="wp-hist-amt wp-hist-credit">+$${amt}</span>
          </div>`);
      }
    }

    return rows.join("");
  }

  // ── full structural render ────────────────────────────────────────────────

  private render() {
    const s      = this.status;
    const wallet = this.options.getWallet();
    // Copy-button shows the custodial deposit address (in the watcher's set).
    // Fall back to the owner wallet if not configured.
    const recvAddr = this.options.getReceiveAddress?.() ?? wallet;
    if (!s) {
      this.body.innerHTML = `<div class="wp-loading">Loading…</div>`;
      return;
    }

    const pct      = s.budget > 0 ? Math.max(0, Math.min(100, (this.displayed / s.budget) * 100)) : 0;
    const isEmpty  = this.displayed <= 0;
    const isLow    = !isEmpty && s.budget > 0 && this.displayed / s.budget <= 0.2;
    const barClass = isEmpty ? "wp-bar-empty" : isLow ? "wp-bar-low" : "wp-bar-ok";
    const balClass = isEmpty ? "wp-balance-empty" : isLow ? "wp-balance-low" : "";

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
        <div class="wp-section-label">Add Funds</div>
        <div class="wp-receive-row">
          <span class="wp-receive-addr">${recvAddr ? `${recvAddr.slice(0, 6)}…${recvAddr.slice(-4)}` : "—"}</span>
          <button class="wp-copy-btn" data-addr="${recvAddr ?? ""}" aria-label="Copy wallet address">Copy</button>
        </div>
        <div class="wp-receive-hint">Send USDC to this address on <b>Base mainnet</b> or <b>Arc testnet</b> from any wallet</div>
      </div>

      <div class="wp-section">
        <div class="wp-section-label">Activity</div>
        <div class="wp-history-list">${this.renderBreakdownHTML()}</div>
      </div>

      <div class="wp-section">
        <div class="wp-section-label">Agent Contact</div>
        <div class="wp-contact-hint">Get notified when your agent needs attention</div>
        <div class="wp-contact-fields">
          <div class="wp-contact-row">
            <span class="wp-contact-icon">📧</span>
            <input class="wp-contact-input" data-key="email" type="email" placeholder="Email" value="${this.loadContact("email")}" autocomplete="email" />
          </div>
          <div class="wp-contact-row wp-telegram-row">
            ${this.renderTelegramRowInnerHTML()}
          </div>
          <div class="wp-contact-row">
            <span class="wp-contact-icon">💬</span>
            <input class="wp-contact-input" data-key="whatsapp" type="tel" placeholder="WhatsApp number" value="${this.loadContact("whatsapp")}" autocomplete="tel" />
          </div>
          <div class="wp-contact-row">
            <span class="wp-contact-icon">📱</span>
            <input class="wp-contact-input" data-key="phone" type="tel" placeholder="Phone / SMS" value="${this.loadContact("phone")}" autocomplete="tel" />
          </div>
        </div>
        <button class="wp-contact-save">Save</button>
      </div>
    `;

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

    this.body.querySelector<HTMLButtonElement>(".wp-contact-save")?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      this.body.querySelectorAll<HTMLInputElement>(".wp-contact-input").forEach((inp) => {
        this.saveContact(inp.dataset.key ?? "", inp.value.trim());
      });
      btn.textContent = "Saved ✓";
      btn.classList.add("wp-contact-save-ok");
      setTimeout(() => { btn.textContent = "Save"; btn.classList.remove("wp-contact-save-ok"); }, 1500);
    });

    const tgRow = this.body.querySelector<HTMLElement>(".wp-telegram-row");
    if (tgRow) this.wireTelegramBtn(tgRow);
  }

  private loadContact(key: string): string {
    return localStorage.getItem(`wog:contact:${key}`) ?? "";
  }

  private saveContact(key: string, value: string): void {
    if (!key) return;
    if (value) localStorage.setItem(`wog:contact:${key}`, value);
    else localStorage.removeItem(`wog:contact:${key}`);
  }

  // ── styles ────────────────────────────────────────────────────────────────

  private injectStyles() {
    if (document.getElementById("wp-styles")) return;
    const style = document.createElement("style");
    style.id = "wp-styles";
    style.textContent = `
      /* ── Panel shell ── */

      #wallet-panel {
        position: fixed;
        bottom: 72px;
        right: 16px;
        width: min(340px, calc(100vw - 24px));
        max-height: calc(100vh - 100px);
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
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
        color: #8f8067; font-size: 22px;
        cursor: pointer; line-height: 1;
        padding: 4px 6px; margin: -4px -6px;
        min-width: 44px; min-height: 44px;
        display: flex; align-items: center; justify-content: flex-end;
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

      /* ── Balance ── */

      .wp-balance-row {
        display: flex; align-items: baseline;
        gap: 6px; margin-bottom: 10px;
      }

      .wp-balance-usdc {
        color: #f4ead0;
        font: 700 22px/1 "Courier New", monospace;
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

      .wp-chip-dim { opacity: 0.4; }

      .wp-chip-icon { font-size: 14px; line-height: 1; }

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

      /* ── Receive ── */

      .wp-receive-row {
        display: flex; align-items: center;
        gap: 8px; margin-bottom: 6px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px; padding: 9px 12px;
        min-height: 44px;
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
        border-radius: 8px; padding: 0 14px;
        min-height: 36px;
        color: #7fd6be;
        font: 700 10px/1 "Courier New", monospace;
        letter-spacing: 0.08em; cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        flex-shrink: 0;
        touch-action: manipulation;
      }
      .wp-copy-btn:hover { background: rgba(127,214,190,0.16); border-color: rgba(127,214,190,0.4); }
      .wp-copy-btn.wp-copy-btn-ok { color: #3ab88a; border-color: rgba(58,184,138,0.4); }

      .wp-receive-hint {
        color: #3a4050;
        font: 500 9px/1.3 "Courier New", monospace;
        letter-spacing: 0.06em;
      }

      /* ── Contact ── */

      .wp-contact-hint {
        color: #3a4050;
        font: 500 9px/1.3 "Courier New", monospace;
        letter-spacing: 0.06em;
        margin-bottom: 10px;
      }

      .wp-contact-fields { display: flex; flex-direction: column; gap: 7px; margin-bottom: 10px; }

      .wp-contact-row {
        display: flex; align-items: center; gap: 8px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px; padding: 0 10px;
        min-height: 44px;
      }

      .wp-contact-icon { font-size: 14px; line-height: 1; flex-shrink: 0; }

      .wp-contact-input {
        flex: 1; background: none; border: none; outline: none;
        color: #f4ead0;
        font: 500 16px/1 "Courier New", monospace;
        letter-spacing: 0.02em;
        min-width: 0;
        padding: 13px 0;
      }
      .wp-contact-input::placeholder { color: #3a4050; }

      .wp-contact-save {
        width: 100%; min-height: 44px;
        border-radius: 12px;
        border: 1px solid rgba(127,214,190,0.2);
        background: rgba(127,214,190,0.07);
        color: #7fd6be;
        font: 700 11px/1 "Courier New", monospace;
        letter-spacing: 0.1em; cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
        touch-action: manipulation;
      }
      .wp-contact-save:hover { background: rgba(127,214,190,0.14); border-color: rgba(127,214,190,0.4); }
      .wp-contact-save:active { background: rgba(127,214,190,0.22); }
      .wp-contact-save.wp-contact-save-ok { color: #3ab88a; border-color: rgba(58,184,138,0.4); background: rgba(58,184,138,0.08); }

      /* ── Telegram row ── */

      .wp-tg-btn {
        flex: 1;
        display: flex; align-items: center; justify-content: center;
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid rgba(127,214,190,0.3);
        background: rgba(127,214,190,0.08);
        color: #7fd6be;
        font: 700 11px/1 "Courier New", monospace;
        letter-spacing: 0.08em;
        text-decoration: none;
        cursor: pointer;
        text-align: center;
        transition: background 0.15s, border-color 0.15s;
        touch-action: manipulation;
      }
      .wp-tg-btn:hover  { background: rgba(127,214,190,0.16); border-color: rgba(127,214,190,0.5); }
      .wp-tg-btn:active { background: rgba(127,214,190,0.22); }

      .wp-tg-connected {
        flex: 1;
        color: #3ab88a;
        font: 600 11px/1 "Courier New", monospace;
        letter-spacing: 0.04em;
      }
      .wp-tg-connected::before { content: "✓ "; }

      .wp-tg-unavailable {
        flex: 1;
        color: #3a4050;
        font: 500 10px/1 "Courier New", monospace;
        letter-spacing: 0.04em;
      }

      /* ── Spend breakdown ── */

      .wp-history-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .wp-bd-row {
        display: grid;
        grid-template-columns: 90px 1fr auto auto;
        align-items: center;
        gap: 6px;
      }

      .wp-bd-label {
        color: #8f9aaa;
        font: 500 10px/1 "Courier New", monospace;
        letter-spacing: 0.02em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .wp-bd-bar-track {
        height: 4px;
        background: rgba(255,255,255,0.06);
        border-radius: 99px;
        overflow: hidden;
      }

      .wp-bd-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #3a5060, #7fd6be);
        border-radius: 99px;
        transition: width 0.4s ease;
      }

      .wp-bd-pct {
        color: #3a4050;
        font: 500 9px/1 "Courier New", monospace;
        white-space: nowrap;
        min-width: 26px;
        text-align: right;
      }

      .wp-bd-amt {
        color: #6a7080;
        font: 600 10px/1 "Courier New", monospace;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        min-width: 52px;
        text-align: right;
      }

      .wp-bd-divider {
        color: #3a4050;
        font: 600 9px/1 "Courier New", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        padding-top: 4px;
        border-top: 1px solid rgba(255,255,255,0.04);
        margin-top: 2px;
      }

      .wp-hist-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 8px;
      }

      .wp-hist-label {
        color: #8f9aaa;
        font: 500 10px/1 "Courier New", monospace;
        letter-spacing: 0.04em;
      }

      .wp-hist-ago {
        color: #3a4050;
        font: 500 9px/1 "Courier New", monospace;
        white-space: nowrap;
      }

      .wp-hist-amt {
        font: 700 10px/1 "Courier New", monospace;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .wp-hist-credit { color: #3ab88a; }

      .wp-history-empty {
        color: #3a4050;
        font: 500 10px/1 "Courier New", monospace;
        letter-spacing: 0.06em;
        padding: 2px 0;
      }

      .wp-loading, .wp-busy {
        padding: 24px 16px; color: #5a6070;
        font: 500 11px/1 "Courier New", monospace;
        text-align: center; letter-spacing: 0.1em;
      }

      /* ── Mobile: bottom sheet ── */

      @media (max-width: 600px) {
        #wallet-panel {
          left: 0; right: 0; bottom: 0;
          width: 100%;
          max-height: 70vh;
          border-radius: 20px 20px 0 0;
          border-left: none; border-right: none; border-bottom: none;
          box-shadow: 0 -8px 40px rgba(0,0,0,0.7);
        }

        .wp-header {
          padding: 10px 16px 8px;
        }

        /* drag handle visual cue */
        .wp-header::before {
          content: "";
          position: absolute;
          top: 6px; left: 50%;
          transform: translateX(-50%);
          width: 36px; height: 4px;
          border-radius: 99px;
          background: rgba(255,255,255,0.12);
          pointer-events: none;
        }
        .wp-header { position: relative; }

        .wp-section { padding: 10px 14px; }

        .wp-section-label { margin-bottom: 8px; }

        .wp-balance-usdc { font-size: 20px; }

        .wp-stat-chips { gap: 5px; }

        .wp-chip { padding: 7px 4px 6px; }

        .wp-chip-val { font-size: 11px; }

        .wp-contact-fields { gap: 5px; }

        .wp-contact-input { font-size: 16px; }
      }
    `;
    document.head.appendChild(style);
  }
}
