import type { PredictionPoolStats, BetHistoryRecord } from "../api.js";
import { playSoundEffect } from "../sfx.js";
import { formatTimeUntil } from "./InboxPanel.js";

interface BetsPanelCallbacks {
  /** Fetch the active pools. */
  refreshPools: () => Promise<PredictionPoolStats[]>;
  /** Fetch the player's bet history (and any unclaimed winnings). */
  refreshHistory: () => Promise<BetHistoryRecord[]>;
  /**
   * Place a bet. Returns ok/err so the panel can surface feedback.
   * `amount` is in gold.
   */
  onPlaceBet: (poolId: string, choice: "RED" | "BLUE", amount: number) => Promise<{ ok: boolean; error?: string }>;
  /** Claim winnings from a settled pool. */
  onClaim: (poolId: string) => Promise<{ ok: boolean; error?: string }>;
}

const POLL_INTERVAL_MS = 10_000;
const COUNTDOWN_TICK_MS = 30_000;
const QUICK_BET_AMOUNTS = [10, 50, 100];

/**
 * Prediction-market panel. Two sections: Active Pools (place bets while the
 * lock window is open) and My Bets (history + claim winnings).
 */
export class BetsPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private callbacks: BetsPanelCallbacks;
  private pools: PredictionPoolStats[] = [];
  private bets: BetHistoryRecord[] = [];
  private loading = false;
  private selectedAmount: Record<string, number> = {};
  private pendingBet = new Set<string>();
  private pendingClaim = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: BetsPanelCallbacks) {
    this.callbacks = callbacks;

    this.container = document.createElement("div");
    this.container.id = "bets-panel";
    this.container.style.display = "none";

    const header = document.createElement("div");
    header.className = "bp-header";
    header.innerHTML = `<span class="bp-title">Prediction Markets</span><span class="bp-sub">Bets</span>`;
    this.container.appendChild(header);

    this.listEl = document.createElement("div");
    this.listEl.className = "bp-list";
    this.listEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "set-amount") {
        const poolId = btn.dataset.poolId!;
        const amount = Number(btn.dataset.amount);
        if (poolId && Number.isFinite(amount)) {
          this.selectedAmount[poolId] = amount;
          this.render();
        }
      } else if (action === "bet") {
        const poolId = btn.dataset.poolId!;
        const choice = btn.dataset.choice as "RED" | "BLUE";
        const amount = this.selectedAmount[poolId] ?? QUICK_BET_AMOUNTS[0];
        if (poolId && (choice === "RED" || choice === "BLUE")) {
          void this.handleBet(poolId, choice, amount);
        }
      } else if (action === "claim") {
        const poolId = btn.dataset.poolId!;
        if (poolId) void this.handleClaim(poolId);
      }
    });
    this.container.appendChild(this.listEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "bp-footer";
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
    this.loading = this.pools.length === 0 && this.bets.length === 0;
    if (this.loading) this.render();
    try {
      const [pools, bets] = await Promise.all([
        this.callbacks.refreshPools(),
        this.callbacks.refreshHistory(),
      ]);
      this.pools = pools;
      this.bets = bets;
    } catch (err) {
      console.warn("[bets-panel] refresh failed", err);
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
        if (this.pools.length > 0) this.render();
      }, COUNTDOWN_TICK_MS);
    }
  }

  private stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
  }

  private async handleBet(poolId: string, choice: "RED" | "BLUE", amount: number) {
    const key = `${poolId}:${choice}`;
    if (this.pendingBet.has(key)) return;
    this.pendingBet.add(key);
    this.render();
    const result = await this.callbacks.onPlaceBet(poolId, choice, amount);
    this.pendingBet.delete(key);
    this.render();
    if (result.ok) void this.refresh();
  }

  private async handleClaim(poolId: string) {
    if (this.pendingClaim.has(poolId)) return;
    this.pendingClaim.add(poolId);
    this.render();
    const result = await this.callbacks.onClaim(poolId);
    this.pendingClaim.delete(poolId);
    this.render();
    if (result.ok) void this.refresh();
  }

  private render() {
    if (this.loading) {
      this.listEl.innerHTML = `<div class="bp-empty">Loading…</div>`;
      this.footerEl.textContent = "";
      return;
    }

    let html = "";

    // ── Active pools ──
    html += `<div class="bp-section"><div class="bp-section-label">Active Pools</div>`;
    if (this.pools.length === 0) {
      html += `<div class="bp-empty">No live battles to bet on right now.</div>`;
    } else {
      for (const p of this.pools) {
        const selected = this.selectedAmount[p.poolId] ?? QUICK_BET_AMOUNTS[0];
        const lockLabel = p.lockTimestamp
          ? `locks in ${esc(formatTimeUntil(p.lockTimestamp * 1000))}`
          : `status: ${esc(p.status)}`;
        html += `<div class="bp-row">`;
        html += `<div class="bp-row-head"><span class="bp-pool-id">Pool ${esc(p.poolId.slice(-6))}</span><span class="bp-pool-stake">${esc(p.totalStaked)}g · ${p.participantCount} bets</span></div>`;
        html += `<div class="bp-pool-status">${lockLabel}</div>`;
        html += `<div class="bp-amount-row">`;
        for (const amt of QUICK_BET_AMOUNTS) {
          const isSel = selected === amt;
          html += `<button class="bp-chip${isSel ? " selected" : ""}" data-action="set-amount" data-pool-id="${esc(p.poolId)}" data-amount="${amt}">${amt}g</button>`;
        }
        html += `</div>`;
        html += `<div class="bp-bet-row">`;
        const redKey = `${p.poolId}:RED`;
        const blueKey = `${p.poolId}:BLUE`;
        const redPending = this.pendingBet.has(redKey);
        const bluePending = this.pendingBet.has(blueKey);
        html += `<button class="bp-bet bp-bet-red" data-action="bet" data-pool-id="${esc(p.poolId)}" data-choice="RED"${redPending ? " disabled" : ""}>${redPending ? "…" : `Bet RED ${selected}g`}</button>`;
        html += `<button class="bp-bet bp-bet-blue" data-action="bet" data-pool-id="${esc(p.poolId)}" data-choice="BLUE"${bluePending ? " disabled" : ""}>${bluePending ? "…" : `Bet BLUE ${selected}g`}</button>`;
        html += `</div>`;
        html += `</div>`;
      }
    }
    html += `</div>`;

    // ── My bets ──
    html += `<div class="bp-section"><div class="bp-section-label">My Bets</div>`;
    if (this.bets.length === 0) {
      html += `<div class="bp-empty">You haven't placed any bets yet.</div>`;
    } else {
      for (const b of this.bets.slice(0, 20)) {
        const claimPending = this.pendingClaim.has(b.poolId);
        const result = b.result ? b.result.toUpperCase() : "PENDING";
        const resultColor = b.result === "win" ? "#5dff9a" : b.result === "loss" ? "#ff8866" : "#aab";
        html += `<div class="bp-row">`;
        html += `<div class="bp-row-head"><span class="bp-pool-id">${esc(b.choice)} · ${esc(b.amount)}g</span><span style="color:${resultColor};font-size:10px">${result}</span></div>`;
        html += `<div class="bp-pool-status">Pool ${esc(b.poolId.slice(-6))}${b.payout ? ` · payout ${esc(b.payout)}g` : ""}</div>`;
        if (b.result === "win" && !b.claimed) {
          html += `<button class="bp-claim" data-action="claim" data-pool-id="${esc(b.poolId)}"${claimPending ? " disabled" : ""}>${claimPending ? "Claiming…" : "Claim winnings"}</button>`;
        }
        html += `</div>`;
      }
    }
    html += `</div>`;

    this.listEl.innerHTML = html;

    const unclaimedWins = this.bets.filter((b) => b.result === "win" && !b.claimed).length;
    this.footerEl.textContent = unclaimedWins > 0
      ? `${unclaimedWins} unclaimed win${unclaimedWins === 1 ? "" : "s"}`
      : `${this.pools.length} pool${this.pools.length === 1 ? "" : "s"} · ${this.bets.length} bet${this.bets.length === 1 ? "" : "s"}`;
  }

  private injectStyles() {
    if (document.getElementById("bets-panel-styles")) return;
    const style = document.createElement("style");
    style.id = "bets-panel-styles";
    style.textContent = `
      #bets-panel {
        position: fixed;
        bottom: 64px;
        right: 12px;
        width: 320px;
        max-height: calc(100vh - 200px);
        background: rgba(10, 16, 28, 0.94);
        border: 1px solid rgba(180, 142, 250, 0.3);
        border-radius: 8px;
        z-index: 16;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }
      .bp-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(180, 142, 250, 0.18);
      }
      .bp-title { color: #b48efa; font-weight: bold; font-size: 13px; letter-spacing: 0.5px; }
      .bp-sub { color: #667; font-size: 10px; }
      .bp-list { overflow-y: auto; flex: 1; padding: 4px 0; }
      .bp-section { padding: 6px 12px; border-bottom: 1px solid rgba(180, 142, 250, 0.1); }
      .bp-section:last-child { border-bottom: none; }
      .bp-section-label { color: #b48efa; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
      .bp-row { padding: 6px 0; border-bottom: 1px solid rgba(180, 142, 250, 0.06); }
      .bp-row:last-child { border-bottom: none; }
      .bp-row-head { display: flex; justify-content: space-between; align-items: baseline; }
      .bp-pool-id { color: #dde; font-size: 11px; font-weight: bold; }
      .bp-pool-stake { color: #ffc850; font-size: 10px; }
      .bp-pool-status { color: #99a; font-size: 10px; margin: 2px 0 6px; }
      .bp-amount-row { display: flex; gap: 4px; margin-bottom: 6px; }
      .bp-chip {
        flex: 1; padding: 4px;
        background: transparent;
        border: 1px solid rgba(180, 142, 250, 0.25);
        border-radius: 4px;
        color: #aab;
        font: 10px monospace;
        cursor: pointer;
      }
      .bp-chip:hover { color: #b48efa; }
      .bp-chip.selected { background: rgba(180, 142, 250, 0.2); color: #fff; border-color: #b48efa; }
      .bp-bet-row { display: flex; gap: 6px; }
      .bp-bet {
        flex: 1; padding: 6px 4px;
        border: 1px solid;
        border-radius: 4px;
        font: bold 10px monospace;
        cursor: pointer;
        background: transparent;
      }
      .bp-bet:disabled { opacity: 0.5; cursor: not-allowed; }
      .bp-bet-red { color: #ff4466; border-color: rgba(255, 68, 102, 0.4); }
      .bp-bet-red:hover:not(:disabled) { background: rgba(255, 68, 102, 0.12); }
      .bp-bet-blue { color: #66bbff; border-color: rgba(102, 187, 255, 0.4); }
      .bp-bet-blue:hover:not(:disabled) { background: rgba(102, 187, 255, 0.12); }
      .bp-claim {
        margin-top: 6px;
        width: 100%; padding: 4px;
        background: rgba(93, 255, 154, 0.12);
        border: 1px solid rgba(93, 255, 154, 0.4);
        border-radius: 4px;
        color: #5dff9a;
        font: bold 10px monospace;
        cursor: pointer;
      }
      .bp-claim:hover:not(:disabled) { background: rgba(93, 255, 154, 0.25); }
      .bp-claim:disabled { opacity: 0.5; cursor: not-allowed; }
      .bp-footer {
        padding: 6px 12px;
        font-size: 10px;
        color: #556;
        border-top: 1px solid rgba(180, 142, 250, 0.1);
        text-align: center;
      }
      .bp-empty { padding: 16px; text-align: center; color: #556; font-size: 11px; }
    `;
    document.head.appendChild(style);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
