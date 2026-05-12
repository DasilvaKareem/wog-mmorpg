import { CANDIDATE_BASES, toUrl } from "../api.js";
import { playSoundEffect } from "../sfx.js";

interface InboxMessage {
  id: string;
  from: string;
  fromName: string;
  to: string;
  type: "direct" | "trade-request" | "trade-offer" | "trade-result" | "match-found" | "duel-request" | "duel-result" | "party-invite" | "broadcast" | "system";
  body: string;
  data?: Record<string, unknown>;
  ts: number;
  /** Server-tracked read timestamp (ms). Null/undefined = unread. */
  readAt?: number | null;
}

export interface TradeOfferPayload {
  tradeId: number;
  tokenId: number;
  quantity: number;
  askPrice: number;
  itemName: string | null;
  sellerName: string;
  sellerWallet: string;
  expiresAtMs: number;
}

const TYPE_ICONS: Record<string, string> = {
  system: "\u2728",
  direct: "\u{1F4E8}",
  "trade-request": "\u{1F4B0}",
  "trade-offer": "\u{1F381}",
  "trade-result": "\u{1F4DC}",
  "match-found": "\u{1F3DB}",
  "duel-request": "\u2694",
  "duel-result": "\u{1F4DC}",
  "party-invite": "\u{1F465}",
  broadcast: "\u{1F4E2}",
};

const TYPE_COLORS: Record<string, string> = {
  system: "#ffc24f",
  direct: "#8cc8ff",
  "trade-request": "#f0c05a",
  "trade-offer": "#5dff9a",
  "trade-result": "#ffc850",
  "match-found": "#ff4466",
  "duel-request": "#ff4466",
  "duel-result": "#ffc850",
  "party-invite": "#b48cff",
  broadcast: "#ff88aa",
};

const MESSAGE_LIMIT = 60;

export interface InboxPanelCallbacks {
  onUnreadChange?: (count: number) => void;
  /** Accept a targeted trade offer. Resolves with ok+message; ok=false → keep buttons. */
  onAcceptTrade?: (offer: TradeOfferPayload) => Promise<{ ok: boolean; error?: string }>;
  /** Decline a targeted trade offer. Resolves with ok+message; ok=false → keep buttons. */
  onDeclineTrade?: (offer: TradeOfferPayload) => Promise<{ ok: boolean; error?: string }>;
  /**
   * A `trade-result` message just arrived (accepted/declined/expired). Use this
   * to refresh inventory + gold so the user sees the delta without waiting for
   * the next inventory poll. Fires once per new message id.
   */
  onTradeResult?: (data: { kind?: string; tradeId?: number }) => void;
  /**
   * A `match-found` message just arrived. Fired once per new message id so the
   * host can play a sound, toast, and auto-open the battle viewer.
   */
  onMatchFound?: (data: { battleId?: string; format?: string; team?: string; arenaName?: string }) => void;
  /** Player clicked "Enter Arena" on a match-found row. */
  onOpenBattle?: (battleId: string) => void;
  /** Accept a duel challenge. */
  onAcceptDuel?: (challengeId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Decline a duel challenge. */
  onDeclineDuel?: (challengeId: string) => Promise<{ ok: boolean; error?: string }>;
}

const COUNTDOWN_TICK_MS = 30_000;

export class InboxPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private custodialWallet: string | null = null;
  private messages: InboxMessage[] = [];
  private serverUnread = 0;
  private onUnreadChange: (count: number) => void;
  private callbacks: InboxPanelCallbacks;
  private apiBase: string | null = null;
  /** tradeIds whose Accept/Decline buttons are currently inflight or settled. */
  private tradeActionState = new Map<number, "pending" | "accepted" | "declined" | "failed">();
  /** message ids we've already surfaced — used to detect first-sight trade-result deliveries. */
  private seenTradeResultIds = new Set<string>();
  /** First-sight tracking for match-found notifications. */
  private seenMatchFoundIds = new Set<string>();
  /** challengeIds whose Accept/Decline buttons are pending or settled. */
  private duelActionState = new Map<string, "pending" | "accepted" | "declined" | "failed">();
  /** Local timer that re-renders countdown chips while the panel is open. */
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: InboxPanelCallbacks = {}) {
    this.callbacks = callbacks;
    this.onUnreadChange = callbacks.onUnreadChange ?? (() => {});

    this.container = document.createElement("div");
    this.container.id = "inbox-panel";
    this.container.style.display = "none";

    const header = document.createElement("div");
    header.className = "ibx-header";
    header.innerHTML = `<span class="ibx-title">Inbox</span><span class="ibx-sub">Agent Notifications</span>`;
    this.container.appendChild(header);

    this.listEl = document.createElement("div");
    this.listEl.className = "ibx-list";
    this.listEl.addEventListener("click", (e) => {
      const tradeBtn = (e.target as HTMLElement).closest("[data-trade-action]") as HTMLElement | null;
      if (tradeBtn) {
        const action = tradeBtn.dataset.tradeAction;
        const tradeId = Number(tradeBtn.dataset.tradeId);
        if (!Number.isFinite(tradeId)) return;
        const msg = this.messages.find(
          (m) => m.type === "trade-offer" && (m.data as TradeOfferPayload | undefined)?.tradeId === tradeId,
        );
        if (!msg) return;
        const payload = msg.data as TradeOfferPayload | undefined;
        if (!payload) return;
        void this.handleTradeAction(action ?? "", payload);
        return;
      }

      const matchBtn = (e.target as HTMLElement).closest("[data-match-action]") as HTMLElement | null;
      if (matchBtn) {
        const battleId = matchBtn.dataset.battleId;
        if (battleId) this.callbacks.onOpenBattle?.(battleId);
        return;
      }

      const duelBtn = (e.target as HTMLElement).closest("[data-duel-action]") as HTMLElement | null;
      if (duelBtn) {
        const action = duelBtn.dataset.duelAction;
        const challengeId = duelBtn.dataset.challengeId;
        if (!challengeId) return;
        void this.handleDuelAction(action ?? "", challengeId);
        return;
      }
    });
    this.container.appendChild(this.listEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "ibx-footer";
    this.container.appendChild(this.footerEl);

    document.body.appendChild(this.container);
    this.injectStyles();
  }

  /** Expose the container so it can be embedded inside a parent (tabs). */
  getElement(): HTMLElement {
    return this.container;
  }

  setCustodialWallet(wallet: string | null) {
    this.custodialWallet = wallet ? wallet.toLowerCase() : null;
    this.messages = [];
    this.serverUnread = 0;
    this.render();
  }

  getUnreadCount(): number {
    return this.serverUnread;
  }

  async refresh(): Promise<void> {
    if (!this.custodialWallet) return;
    const path = `/inbox/${this.custodialWallet}/history?limit=${MESSAGE_LIMIT}`;
    for (const base of CANDIDATE_BASES) {
      try {
        const res = await fetch(toUrl(base, path));
        if (!res.ok) continue;
        const data = await res.json();
        const msgs: InboxMessage[] = Array.isArray(data.messages) ? data.messages : [];
        msgs.sort((a, b) => b.ts - a.ts);

        // Detect newly-arrived trade-result + match-found messages so the host
        // can react without waiting for the regular poll interval.
        const isFirstFetch = this.messages.length === 0 && this.seenTradeResultIds.size === 0 && this.seenMatchFoundIds.size === 0;
        const freshTradeResults: InboxMessage[] = [];
        const freshMatchFound: InboxMessage[] = [];
        for (const m of msgs) {
          if (m.type === "trade-result") {
            if (this.seenTradeResultIds.has(m.id)) continue;
            this.seenTradeResultIds.add(m.id);
            if (!isFirstFetch) freshTradeResults.push(m);
          } else if (m.type === "match-found") {
            if (this.seenMatchFoundIds.has(m.id)) continue;
            this.seenMatchFoundIds.add(m.id);
            if (!isFirstFetch) freshMatchFound.push(m);
          }
        }

        this.messages = msgs;
        const newUnread = Number(data.unread ?? msgs.filter((m) => !m.readAt).length);
        if (newUnread > this.serverUnread) {
          playSoundEffect("ui_notification");
        }
        this.serverUnread = newUnread;
        this.apiBase = base;
        this.render();
        this.onUnreadChange(this.serverUnread);

        for (const m of freshTradeResults) {
          const data = (m.data ?? {}) as { kind?: string; tradeId?: number };
          this.callbacks.onTradeResult?.(data);
        }
        for (const m of freshMatchFound) {
          const data = (m.data ?? {}) as { battleId?: string; format?: string; team?: string; arenaName?: string };
          this.callbacks.onMatchFound?.(data);
        }
        return;
      } catch {
        // try next base
      }
    }
  }

  toggle() {
    if (this.container.style.display === "none") {
      this.show();
    } else {
      this.hide();
    }
  }

  show() {
    if (this.container.style.display === "flex") return;
    this.container.style.display = "flex";
    void (async () => {
      await this.refresh();
      await this.markAllSeen();
    })();
    this.startCountdownTimer();
    playSoundEffect("ui_dialog_open");
  }

  hide() {
    if (this.container.style.display === "none") return;
    this.container.style.display = "none";
    this.stopCountdownTimer();
    playSoundEffect("ui_dialog_close");
  }

  /**
   * Re-render every 30s while the panel is visible so trade-offer countdown
   * chips ("expires in 2h 14m") stay current without a network round-trip.
   * Only re-renders if there's at least one live trade-offer row.
   */
  private startCountdownTimer() {
    if (this.countdownTimer) return;
    this.countdownTimer = setInterval(() => {
      if (this.container.style.display === "none") {
        this.stopCountdownTimer();
        return;
      }
      const hasLiveOffer = this.messages.some(
        (m) => m.type === "trade-offer" && this.tradeActionState.get((m.data as TradeOfferPayload | undefined)?.tradeId ?? -1) === undefined,
      );
      const hasLiveDuel = this.messages.some(
        (m) => m.type === "duel-request" && this.duelActionState.get(((m.data ?? {}) as { challengeId?: string }).challengeId ?? "") === undefined,
      );
      if (hasLiveOffer || hasLiveDuel) this.render();
    }, COUNTDOWN_TICK_MS);
  }

  private stopCountdownTimer() {
    if (!this.countdownTimer) return;
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  /**
   * Mark every currently-unread message as read on the server. The server
   * persists read_at per message so this state survives reloads and new
   * browsers, unlike the old localStorage lastSeenTs approach.
   */
  private async markAllSeen(): Promise<void> {
    if (!this.custodialWallet || this.messages.length === 0) return;
    const unreadIds = this.messages.filter((m) => !m.readAt).map((m) => m.id);
    if (unreadIds.length === 0) return;
    const bases = this.apiBase != null ? [this.apiBase, ...CANDIDATE_BASES.filter((b) => b !== this.apiBase)] : CANDIDATE_BASES;
    const path = `/inbox/${this.custodialWallet}/read`;
    const nowMs = Date.now();
    for (const base of bases) {
      try {
        const res = await fetch(toUrl(base, path), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: unreadIds }),
        });
        if (!res.ok) continue;
        for (const m of this.messages) {
          if (unreadIds.includes(m.id)) m.readAt = nowMs;
        }
        this.serverUnread = 0;
        this.onUnreadChange(0);
        this.render();
        return;
      } catch {
        // try next base
      }
    }
  }

  private render() {
    if (!this.custodialWallet) {
      this.listEl.innerHTML = `<div class="ibx-empty">Deploy an agent to see messages.</div>`;
      this.footerEl.textContent = "";
      return;
    }
    if (this.messages.length === 0) {
      this.listEl.innerHTML = `<div class="ibx-empty">No messages yet. Your agent will log events here.</div>`;
      this.footerEl.textContent = "";
      return;
    }

    let html = "";
    for (const m of this.messages) {
      const unread = !m.readAt;
      const icon = TYPE_ICONS[m.type] ?? "\u2709";
      const color = TYPE_COLORS[m.type] ?? "#9ab";
      const sender = m.fromName || m.from.slice(0, 8) || "system";
      const time = formatTime(m.ts);
      html += `<div class="ibx-row${unread ? " ibx-unread" : ""}">`;
      html += `<div class="ibx-icon" style="color:${color}">${icon}</div>`;
      html += `<div class="ibx-content">`;
      html += `<div class="ibx-meta"><span class="ibx-from" style="color:${color}">${esc(sender)}</span><span class="ibx-time">${esc(time)}</span></div>`;
      html += `<div class="ibx-body">${esc(m.body)}</div>`;
      if (m.type === "trade-offer") {
        html += this.renderTradeOfferControls(m);
      } else if (m.type === "match-found") {
        html += this.renderMatchFoundControls(m);
      } else if (m.type === "duel-request") {
        html += this.renderDuelRequestControls(m);
      }
      html += `</div>`;
      html += `</div>`;
    }

    this.listEl.innerHTML = html;
    const total = this.messages.length;
    const unread = this.getUnreadCount();
    this.footerEl.textContent = unread > 0
      ? `${unread} unread of ${total}`
      : `${total} message${total === 1 ? "" : "s"}`;
  }

  private renderTradeOfferControls(m: InboxMessage): string {
    const payload = m.data as TradeOfferPayload | undefined;
    if (!payload || typeof payload.tradeId !== "number") return "";
    const state = this.tradeActionState.get(payload.tradeId);
    const now = Date.now();
    const expired = typeof payload.expiresAtMs === "number" && payload.expiresAtMs <= now;

    if (state === "accepted") {
      return `<div class="ibx-trade-result ibx-trade-success">Trade accepted.</div>`;
    }
    if (state === "declined") {
      return `<div class="ibx-trade-result ibx-trade-muted">Offer declined.</div>`;
    }
    if (expired) {
      return `<div class="ibx-trade-result ibx-trade-muted">Offer expired.</div>`;
    }

    const askPrice = typeof payload.askPrice === "number" ? payload.askPrice : 0;
    const item = payload.itemName ?? `token #${payload.tokenId}`;
    const qty = payload.quantity > 1 ? ` ×${payload.quantity}` : "";
    const disabled = state === "pending";
    const busy = state === "pending" ? ` <span class="ibx-trade-busy">working…</span>` : "";
    const countdown = typeof payload.expiresAtMs === "number"
      ? `<span class="ibx-trade-countdown" title="expires ${new Date(payload.expiresAtMs).toLocaleString()}">expires in ${esc(formatTimeUntil(payload.expiresAtMs))}</span>`
      : "";
    return `<div class="ibx-trade-actions">
      <div class="ibx-trade-summary">${esc(item)}${esc(qty)} · <span class="ibx-trade-price">${askPrice}g</span>${countdown ? " · " + countdown : ""}</div>
      <div class="ibx-trade-btn-row">
        <button class="ibx-trade-btn ibx-trade-accept" data-trade-action="accept" data-trade-id="${payload.tradeId}"${disabled ? " disabled" : ""}>Accept</button>
        <button class="ibx-trade-btn ibx-trade-decline" data-trade-action="decline" data-trade-id="${payload.tradeId}"${disabled ? " disabled" : ""}>Decline</button>${busy}
      </div>
    </div>`;
  }

  private async handleTradeAction(action: string, payload: TradeOfferPayload) {
    if (this.tradeActionState.get(payload.tradeId) === "pending") return;
    this.tradeActionState.set(payload.tradeId, "pending");
    this.render();

    try {
      if (action === "accept") {
        const result = await this.callbacks.onAcceptTrade?.(payload);
        if (result?.ok) {
          this.tradeActionState.set(payload.tradeId, "accepted");
        } else {
          this.tradeActionState.set(payload.tradeId, "failed");
        }
      } else if (action === "decline") {
        const result = await this.callbacks.onDeclineTrade?.(payload);
        if (result?.ok) {
          this.tradeActionState.set(payload.tradeId, "declined");
        } else {
          this.tradeActionState.set(payload.tradeId, "failed");
        }
      }
    } catch {
      this.tradeActionState.set(payload.tradeId, "failed");
    }

    // If failed, re-enable the buttons for retry by clearing the entry.
    if (this.tradeActionState.get(payload.tradeId) === "failed") {
      this.tradeActionState.delete(payload.tradeId);
    }
    this.render();
  }

  private renderMatchFoundControls(m: InboxMessage): string {
    const data = (m.data ?? {}) as { battleId?: string; format?: string; team?: string; arenaName?: string };
    if (!data.battleId) return "";
    const team = data.team ? data.team.toUpperCase() : "";
    const teamColor = data.team === "red" ? "#ff4466" : data.team === "blue" ? "#66bbff" : "#cce";
    return `<div class="ibx-trade-actions">
      <div class="ibx-trade-summary">${esc(data.format?.toUpperCase() ?? "PVP")} · <span style="color:${teamColor}">Team ${esc(team)}</span> · ${esc(data.arenaName ?? "Arena")}</div>
      <div class="ibx-trade-btn-row">
        <button class="ibx-trade-btn ibx-trade-accept" data-match-action="enter" data-battle-id="${esc(data.battleId)}">Enter Arena</button>
      </div>
    </div>`;
  }

  private renderDuelRequestControls(m: InboxMessage): string {
    const data = (m.data ?? {}) as { challengeId?: string; challengerName?: string; format?: string; expiresAtMs?: number };
    if (!data.challengeId) return "";
    const state = this.duelActionState.get(data.challengeId);
    const expired = typeof data.expiresAtMs === "number" && data.expiresAtMs <= Date.now();

    if (state === "accepted") return `<div class="ibx-trade-result ibx-trade-success">Duel accepted — queueing now.</div>`;
    if (state === "declined") return `<div class="ibx-trade-result ibx-trade-muted">Duel declined.</div>`;
    if (expired) return `<div class="ibx-trade-result ibx-trade-muted">Challenge expired.</div>`;

    const disabled = state === "pending";
    const busy = state === "pending" ? ` <span class="ibx-trade-busy">working…</span>` : "";
    const countdown = typeof data.expiresAtMs === "number"
      ? `<span class="ibx-trade-countdown">expires in ${esc(formatTimeUntil(data.expiresAtMs))}</span>`
      : "";
    return `<div class="ibx-trade-actions">
      <div class="ibx-trade-summary">Duel: ${esc(data.format?.toUpperCase() ?? "1V1")}${countdown ? " · " + countdown : ""}</div>
      <div class="ibx-trade-btn-row">
        <button class="ibx-trade-btn ibx-trade-accept" data-duel-action="accept" data-challenge-id="${esc(data.challengeId)}"${disabled ? " disabled" : ""}>Accept</button>
        <button class="ibx-trade-btn ibx-trade-decline" data-duel-action="decline" data-challenge-id="${esc(data.challengeId)}"${disabled ? " disabled" : ""}>Decline</button>${busy}
      </div>
    </div>`;
  }

  private async handleDuelAction(action: string, challengeId: string) {
    if (this.duelActionState.get(challengeId) === "pending") return;
    this.duelActionState.set(challengeId, "pending");
    this.render();

    try {
      if (action === "accept") {
        const result = await this.callbacks.onAcceptDuel?.(challengeId);
        this.duelActionState.set(challengeId, result?.ok ? "accepted" : "failed");
      } else if (action === "decline") {
        const result = await this.callbacks.onDeclineDuel?.(challengeId);
        this.duelActionState.set(challengeId, result?.ok ? "declined" : "failed");
      }
    } catch {
      this.duelActionState.set(challengeId, "failed");
    }

    if (this.duelActionState.get(challengeId) === "failed") {
      this.duelActionState.delete(challengeId);
    }
    this.render();
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #inbox-panel {
        position: fixed;
        bottom: 64px;
        right: 12px;
        width: 300px;
        max-height: calc(100vh - 200px);
        background: rgba(10, 16, 28, 0.94);
        border: 1px solid rgba(255, 194, 79, 0.25);
        border-radius: 8px;
        z-index: 16;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }

      .ibx-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255, 194, 79, 0.18);
      }
      .ibx-title { color: #ffc24f; font-weight: bold; font-size: 13px; letter-spacing: 0.5px; }
      .ibx-sub { color: #667; font-size: 10px; }

      .ibx-list {
        overflow-y: auto;
        flex: 1;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 194, 79, 0.2) transparent;
      }

      .ibx-row {
        display: flex;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255, 194, 79, 0.07);
        align-items: flex-start;
      }
      .ibx-row:last-child { border-bottom: none; }
      .ibx-row.ibx-unread {
        background: rgba(255, 194, 79, 0.06);
        border-left: 2px solid rgba(255, 194, 79, 0.55);
      }

      .ibx-icon { font-size: 16px; line-height: 1.2; flex-shrink: 0; width: 18px; text-align: center; }
      .ibx-content { flex: 1; min-width: 0; }
      .ibx-meta {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 2px;
      }
      .ibx-from { font-weight: bold; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ibx-time { font-size: 10px; color: #556; flex-shrink: 0; }
      .ibx-body {
        font-size: 11px;
        color: #bcd;
        line-height: 1.35;
        word-wrap: break-word;
        white-space: pre-wrap;
      }

      .ibx-trade-actions {
        margin-top: 6px;
        padding: 6px 8px;
        background: rgba(0, 0, 0, 0.25);
        border-left: 2px solid rgba(93, 255, 154, 0.4);
        border-radius: 3px;
      }
      .ibx-trade-summary { font-size: 11px; color: #cce; margin-bottom: 5px; }
      .ibx-trade-price { color: #ffc850; font-weight: bold; }
      .ibx-trade-countdown { color: #99a; font-size: 10px; }
      .ibx-trade-btn-row { display: flex; gap: 6px; align-items: center; }
      .ibx-trade-btn {
        flex: 1;
        padding: 4px 10px;
        border-radius: 4px;
        font: bold 11px monospace;
        cursor: pointer;
        background: transparent;
        border: 1px solid;
      }
      .ibx-trade-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .ibx-trade-accept {
        color: #5dff9a;
        border-color: rgba(93, 255, 154, 0.45);
      }
      .ibx-trade-accept:hover:not(:disabled) { background: rgba(93, 255, 154, 0.12); }
      .ibx-trade-decline {
        color: #ff8866;
        border-color: rgba(255, 136, 102, 0.4);
      }
      .ibx-trade-decline:hover:not(:disabled) { background: rgba(255, 136, 102, 0.12); }
      .ibx-trade-busy { font-size: 10px; color: #aab; }
      .ibx-trade-result {
        margin-top: 6px;
        padding: 4px 8px;
        font-size: 11px;
        border-radius: 3px;
      }
      .ibx-trade-success {
        color: #5dff9a;
        background: rgba(93, 255, 154, 0.08);
        border-left: 2px solid rgba(93, 255, 154, 0.4);
      }
      .ibx-trade-muted {
        color: #889;
        background: rgba(0, 0, 0, 0.2);
        border-left: 2px solid rgba(150, 150, 170, 0.25);
      }

      .ibx-empty {
        padding: 24px 16px;
        color: #556;
        text-align: center;
        font-size: 11px;
      }

      .ibx-footer {
        padding: 6px 12px;
        font-size: 10px;
        color: #556;
        border-top: 1px solid rgba(255, 194, 79, 0.1);
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const d = new Date(ts);
  const hour24 = d.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const ampm = hour24 < 12 ? "am" : "pm";
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hour12}:${minutes}${ampm}`;
}

/** Render the time remaining until `expiresAtMs` as a compact chip. */
export function formatTimeUntil(expiresAtMs: number): string {
  const diff = expiresAtMs - Date.now();
  if (diff <= 0) return "expired";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh > 0 ? `${d}d ${hh}h` : `${d}d`;
}
