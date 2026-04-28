import { CANDIDATE_BASES, toUrl } from "../api.js";

interface InboxMessage {
  id: string;
  from: string;
  fromName: string;
  to: string;
  type: "direct" | "trade-request" | "party-invite" | "broadcast" | "system";
  body: string;
  data?: Record<string, unknown>;
  ts: number;
  /** Server-tracked read timestamp (ms). Null/undefined = unread. */
  readAt?: number | null;
}

const TYPE_ICONS: Record<string, string> = {
  system: "\u2728",
  direct: "\u{1F4E8}",
  "trade-request": "\u{1F4B0}",
  "party-invite": "\u{1F465}",
  broadcast: "\u{1F4E2}",
};

const TYPE_COLORS: Record<string, string> = {
  system: "#ffc24f",
  direct: "#8cc8ff",
  "trade-request": "#f0c05a",
  "party-invite": "#b48cff",
  broadcast: "#ff88aa",
};

const MESSAGE_LIMIT = 60;

export class InboxPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private custodialWallet: string | null = null;
  private messages: InboxMessage[] = [];
  private serverUnread = 0;
  private onUnreadChange: (count: number) => void;
  private apiBase: string | null = null;

  constructor(callbacks: { onUnreadChange?: (count: number) => void } = {}) {
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
    this.container.appendChild(this.listEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "ibx-footer";
    this.container.appendChild(this.footerEl);

    document.body.appendChild(this.container);
    this.injectStyles();
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
        this.messages = msgs;
        this.serverUnread = Number(data.unread ?? msgs.filter((m) => !m.readAt).length);
        this.apiBase = base;
        this.render();
        this.onUnreadChange(this.serverUnread);
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
    this.container.style.display = "flex";
    void (async () => {
      await this.refresh();
      await this.markAllSeen();
    })();
  }

  hide() {
    this.container.style.display = "none";
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
