/**
 * Tabbed wrapper that consolidates the three notification surfaces under
 * one icon: agent inbox, outgoing trade offers, and pvp prediction-market
 * bets. Each tab embeds the existing panel's container — render logic and
 * polling lifecycles still live in those panels.
 */

import { playSoundEffect } from "../sfx.js";
import type { InboxPanel } from "./InboxPanel.js";
import type { OutgoingTradesPanel } from "./OutgoingTradesPanel.js";
import type { BetsPanel } from "./BetsPanel.js";

export type NotificationsTabId = "inbox" | "trades" | "bets";

interface NotificationsPanelOptions {
  inbox: InboxPanel;
  trades: OutgoingTradesPanel;
  bets: BetsPanel;
}

const TAB_LABELS: Record<NotificationsTabId, string> = {
  inbox: "Inbox",
  trades: "Trades",
  bets: "Bets",
};

const TAB_ICONS: Record<NotificationsTabId, string> = {
  inbox: "\u{1F4EC}",
  trades: "\u{1F4B8}",
  bets: "\u{1F3B2}",
};

const TAB_ORDER: NotificationsTabId[] = ["inbox", "trades", "bets"];

const HEADER_SELECTORS: Record<NotificationsTabId, string> = {
  inbox: ".ibx-header",
  trades: ".otp-header",
  bets: ".bp-header",
};

export class NotificationsPanel {
  private container: HTMLDivElement;
  private body: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private inbox: InboxPanel;
  private trades: OutgoingTradesPanel;
  private bets: BetsPanel;
  private activeTab: NotificationsTabId = "inbox";
  private tabBadges: Record<NotificationsTabId, number> = { inbox: 0, trades: 0, bets: 0 };

  constructor(opts: NotificationsPanelOptions) {
    this.inbox = opts.inbox;
    this.trades = opts.trades;
    this.bets = opts.bets;

    this.container = document.createElement("div");
    this.container.id = "notifications-panel";
    this.container.style.display = "none";

    const header = document.createElement("div");
    header.className = "ntf-header";
    header.innerHTML = `<span class="ntf-title">Notifications</span><button class="ntf-close" aria-label="Close">×</button>`;
    this.container.appendChild(header);

    this.tabBar = document.createElement("div");
    this.tabBar.className = "ntf-tabs";
    this.container.appendChild(this.tabBar);

    this.body = document.createElement("div");
    this.body.className = "ntf-body";
    this.container.appendChild(this.body);

    document.body.appendChild(this.container);
    this.injectStyles();

    (header.querySelector(".ntf-close") as HTMLButtonElement).addEventListener("click", () => this.hide());

    this.embedPanel("inbox", this.inbox.getElement(), HEADER_SELECTORS.inbox);
    this.embedPanel("trades", this.trades.getElement(), HEADER_SELECTORS.trades);
    this.embedPanel("bets", this.bets.getElement(), HEADER_SELECTORS.bets);

    this.renderTabs();
  }

  private embedPanel(_id: NotificationsTabId, el: HTMLElement, headerSelector: string) {
    // Strip the panel's own header — the wrapper provides the title + tabs.
    el.querySelector(headerSelector)?.remove();
    // Defeat the panel's own fixed positioning + chrome so it fills the body.
    el.style.position = "static";
    el.style.bottom = "auto";
    el.style.right = "auto";
    el.style.top = "auto";
    el.style.left = "auto";
    el.style.width = "100%";
    el.style.maxHeight = "none";
    el.style.height = "100%";
    el.style.border = "none";
    el.style.background = "transparent";
    el.style.backdropFilter = "none";
    el.style.borderRadius = "0";
    el.style.boxShadow = "none";
    el.style.zIndex = "auto";
    this.body.appendChild(el);
  }

  private renderTabs() {
    this.tabBar.innerHTML = "";
    for (const id of TAB_ORDER) {
      const btn = document.createElement("button");
      btn.className = "ntf-tab";
      btn.dataset.tab = id;
      btn.innerHTML = `<span class="ntf-tab-icon">${TAB_ICONS[id]}</span><span class="ntf-tab-label">${TAB_LABELS[id]}</span>`;
      if (this.tabBadges[id] > 0) {
        const badge = document.createElement("span");
        badge.className = "ntf-tab-badge";
        badge.textContent = this.tabBadges[id] > 99 ? "99+" : String(this.tabBadges[id]);
        btn.appendChild(badge);
      }
      btn.classList.toggle("active", id === this.activeTab);
      btn.addEventListener("click", () => this.activateTab(id));
      this.tabBar.appendChild(btn);
    }
  }

  show() {
    if (this.container.style.display === "flex") return;
    this.container.style.display = "flex";
    playSoundEffect("ui_dialog_open");
    this.activateTab(this.activeTab);
  }

  hide() {
    if (this.container.style.display === "none") return;
    this.container.style.display = "none";
    // Stop polling on all three so background pollers don't burn cycles.
    this.inbox.hide();
    this.trades.hide();
    this.bets.hide();
    playSoundEffect("ui_dialog_close");
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  activateTab(id: NotificationsTabId) {
    this.activeTab = id;
    // Toggle visibility of each embedded panel via show()/hide() so polling
    // lifecycles in the inner panels stay correct.
    if (id === "inbox") {
      this.trades.hide();
      this.bets.hide();
      this.inbox.show();
    } else if (id === "trades") {
      this.inbox.hide();
      this.bets.hide();
      this.trades.show();
    } else {
      this.inbox.hide();
      this.trades.hide();
      this.bets.show();
    }
    this.renderTabs();
  }

  /** Set a numeric badge on a tab (e.g. unread inbox count). 0 hides it. */
  setTabBadge(id: NotificationsTabId, count: number) {
    this.tabBadges[id] = Math.max(0, Math.floor(count));
    if (this.isVisible()) this.renderTabs();
  }

  /** Total unread across all tabs — for the action-bar icon badge. */
  totalBadgeCount(): number {
    return this.tabBadges.inbox + this.tabBadges.trades + this.tabBadges.bets;
  }

  /** Convenience: refresh whichever tab is currently active. */
  async refreshActive(): Promise<void> {
    if (this.activeTab === "inbox") await this.inbox.refresh();
    else if (this.activeTab === "trades") await this.trades.refresh();
    else await this.bets.refresh();
  }

  /** Refresh inbox specifically — used by the periodic inbox poller. */
  async refreshInbox(): Promise<void> {
    await this.inbox.refresh();
  }

  private injectStyles() {
    if (document.getElementById("notifications-panel-styles")) return;
    const style = document.createElement("style");
    style.id = "notifications-panel-styles";
    style.textContent = `
      #notifications-panel {
        position: fixed;
        bottom: 64px;
        right: 12px;
        width: 320px;
        max-height: calc(100vh - 120px);
        background: rgba(10, 16, 28, 0.96);
        border: 1px solid rgba(255, 194, 79, 0.3);
        border-radius: 8px;
        z-index: 17;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
        overflow: hidden;
      }
      .ntf-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255, 194, 79, 0.18);
        flex: 0 0 auto;
      }
      .ntf-title {
        color: #ffc24f;
        font-weight: bold;
        font-size: 13px;
        letter-spacing: 0.5px;
      }
      .ntf-close {
        background: none;
        border: none;
        color: #888;
        font: 18px monospace;
        cursor: pointer;
        padding: 0 4px;
      }
      .ntf-close:hover { color: #ddd; }
      .ntf-tabs {
        display: flex;
        border-bottom: 1px solid rgba(255, 194, 79, 0.18);
        flex: 0 0 auto;
      }
      .ntf-tab {
        flex: 1;
        background: none;
        border: none;
        padding: 8px 4px;
        color: #667;
        cursor: pointer;
        font: 11px monospace;
        letter-spacing: 0.5px;
        border-bottom: 2px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        position: relative;
      }
      .ntf-tab.active {
        color: #ffc24f;
        border-bottom-color: #ffc24f;
      }
      .ntf-tab:hover:not(.active) { color: #aaa; }
      .ntf-tab-icon { font-size: 13px; }
      .ntf-tab-label { letter-spacing: 0.3px; }
      .ntf-tab-badge {
        background: #ff4466;
        color: #fff;
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 8px;
        font-weight: bold;
        min-width: 16px;
        text-align: center;
        line-height: 1.3;
      }
      .ntf-body {
        flex: 1 1 auto;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      /* Defeat the embedded panels' own fixed positioning + chrome. */
      .ntf-body #inbox-panel,
      .ntf-body #outgoing-trades-panel,
      .ntf-body #bets-panel {
        position: static !important;
        bottom: auto !important;
        right: auto !important;
        width: 100% !important;
        max-height: none !important;
        height: auto !important;
        border: none !important;
        background: transparent !important;
        backdrop-filter: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        z-index: auto !important;
        flex: 1 1 auto;
        min-height: 0;
      }
    `;
    document.head.appendChild(style);
  }
}
