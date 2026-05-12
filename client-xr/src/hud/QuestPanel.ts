import type { ActiveQuest, AvailableQuest, CompletedQuest, QuestLogResponse, ZoneQuestsResponse } from "../types.js";
import { playSoundEffect } from "../sfx.js";

interface QuestPanelCallbacks {
  onAcceptQuest: (questId: string, npcEntityId: string, npcName: string) => void;
  onCompleteQuest: (questId: string, npcEntityId: string, questTitle: string, questDesc: string, objectiveType: string) => void;
  onTalkToNpc: (npcEntityId: string, npcName: string, questTitle: string, questDesc: string, objectiveType: string) => void;
  onAbandonQuest: (questId: string, questTitle: string) => void;
  onOpenAvailable?: () => void;
  /**
   * Pin the agent to a specific quest, or pass null to clear focus. The UI
   * shows a Focus / Focused-Unfocus toggle on each active quest row.
   */
  onFocusQuest?: (questId: string | null, questTitle: string) => void;
}

type QuestTab = "active" | "available" | "completed";

/**
 * Side panel showing quest log (active + available quests).
 * Positioned on the right side below the minimap.
 */
export class QuestPanel {
  private container: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private listEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private activeTab: QuestTab = "active";
  private callbacks: QuestPanelCallbacks;
  private isOwn = false;

  private activeQuests: ActiveQuest[] = [];
  private completedQuests: CompletedQuest[] = [];
  private completedCount = 0;
  private availableQuests: AvailableQuest[] = [];
  private expandedIds = new Set<string>();
  private confirmAbandonId: string | null = null;
  private focusedQuestId: string | null = null;

  constructor(callbacks: QuestPanelCallbacks) {
    this.callbacks = callbacks;

    // Main container
    this.container = document.createElement("div");
    this.container.id = "quest-panel";
    this.container.style.display = "none";

    // Header
    const header = document.createElement("div");
    header.className = "qp-header";
    header.innerHTML = `<span class="qp-title">Quest Log</span>`;
    this.container.appendChild(header);

    // Tab bar
    this.tabBar = document.createElement("div");
    this.tabBar.className = "qp-tabs";
    this.renderTabs();
    this.tabBar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".qp-tab") as HTMLButtonElement;
      if (!btn) return;
      const tab = btn.dataset.tab as QuestTab;
      if (this.activeTab !== tab) {
        playSoundEffect("ui_tab_switch");
      }
      this.activeTab = tab;
      if (tab === "available") {
        this.callbacks.onOpenAvailable?.();
      }
      this.renderTabs();
      this.render();
    });
    this.container.appendChild(this.tabBar);

    // List
    this.listEl = document.createElement("div");
    this.listEl.className = "qp-list";
    this.container.appendChild(this.listEl);

    // Footer
    this.footerEl = document.createElement("div");
    this.footerEl.className = "qp-footer";
    this.container.appendChild(this.footerEl);

    document.body.appendChild(this.container);
    this.injectStyles();

    // Delegate clicks
    this.listEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest("[data-action]") as HTMLElement | null;
      if (btn) {
        e.stopPropagation();
        const action = btn.dataset.action;
        const questId = btn.dataset.questId ?? "";
        const npcId = btn.dataset.npcId ?? "";

        playSoundEffect("ui_button_click");

        if (action === "accept") {
          const npcName = btn.dataset.npcName ?? "";
          this.callbacks.onAcceptQuest(questId, npcId, npcName);
        } else if (action === "complete") {
          this.callbacks.onCompleteQuest(questId, npcId, btn.dataset.questTitle ?? "", btn.dataset.questDesc ?? "", btn.dataset.objType ?? "kill");
        } else if (action === "talk") {
          this.callbacks.onTalkToNpc(npcId, btn.dataset.npcName ?? "", btn.dataset.questTitle ?? "", btn.dataset.questDesc ?? "", "talk");
        } else if (action === "abandon-request") {
          this.confirmAbandonId = questId;
          this.render();
        } else if (action === "abandon-cancel") {
          this.confirmAbandonId = null;
          this.render();
        } else if (action === "abandon-confirm") {
          this.confirmAbandonId = null;
          this.callbacks.onAbandonQuest(questId, btn.dataset.questTitle ?? "");
        } else if (action === "focus") {
          const title = btn.dataset.questTitle ?? "";
          // Optimistic toggle so the user sees feedback immediately; main.ts
          // can call setFocusedQuestId() after the server confirms.
          const wasFocused = this.focusedQuestId === questId;
          this.focusedQuestId = wasFocused ? null : questId;
          this.render();
          this.callbacks.onFocusQuest?.(wasFocused ? null : questId, title);
        }
        return;
      }

      const header = target.closest("[data-expand-id]") as HTMLElement | null;
      if (header) {
        const id = header.dataset.expandId!;
        if (this.expandedIds.has(id)) this.expandedIds.delete(id);
        else this.expandedIds.add(id);
        playSoundEffect("ui_button_click");
        if (this.confirmAbandonId && this.confirmAbandonId !== id) this.confirmAbandonId = null;
        this.render();
      }
    });
  }

  setPlayer(_walletAddress: string | null, isOwn: boolean) {
    this.isOwn = isOwn;
  }

  /** Apply the server-confirmed focused quest so the badge stays in sync. */
  setFocusedQuestId(questId: string | null) {
    if (this.focusedQuestId === questId) return;
    this.focusedQuestId = questId;
    if (this.activeTab === "active") this.render();
  }

  updateQuestLog(data: QuestLogResponse) {
    this.activeQuests = data.activeQuests;
    this.completedQuests = data.completedQuests;
    this.completedCount = this.completedQuests.length;
    this.renderTabs();
    this.render();
  }

  updateZoneQuests(data: ZoneQuestsResponse) {
    this.availableQuests = data.quests;
    this.renderTabs();
    if (this.activeTab === "available") this.render();
  }

  /** Open the panel to the Available tab (e.g. when clicking a quest-giver) */
  showAvailable() {
    this.activeTab = "available";
    this.renderTabs();
    this.show();
    this.callbacks.onOpenAvailable?.();
  }

  toggle() {
    if (this.container.style.display === "none") {
      this.show();
      if (this.activeTab === "available") {
        this.callbacks.onOpenAvailable?.();
      }
    } else {
      this.hide();
    }
  }

  show() {
    if (this.container.style.display === "flex") return;
    this.container.style.display = "flex";
    this.render();
    playSoundEffect("ui_dialog_open");
  }

  hide() {
    if (this.container.style.display === "none") return;
    this.container.style.display = "none";
    playSoundEffect("ui_dialog_close");
  }

  isVisible(): boolean { return this.container.style.display !== "none"; }

  private renderTabs() {
    const tabs: Array<{ id: QuestTab; label: string; count: number }> = [
      { id: "active", label: "Active", count: this.activeQuests.length },
      { id: "available", label: "Available", count: this.availableQuests.length },
      { id: "completed", label: "Completed", count: this.completedQuests.length },
    ];
    this.tabBar.innerHTML = tabs.map((tab) => `
      <button class="qp-tab${this.activeTab === tab.id ? " active" : ""}" data-tab="${tab.id}">
        <span>${tab.label}</span>
        <span class="qp-tab-count">${tab.count}</span>
      </button>
    `).join("");
  }

  private render() {
    if (this.activeTab === "active") {
      this.renderActive();
    } else if (this.activeTab === "available") {
      this.renderAvailable();
    } else {
      this.renderCompleted();
    }
  }

  private renderActive() {
    if (this.activeQuests.length === 0) {
      this.listEl.innerHTML = `<div class="qp-empty">No active quests</div>`;
      this.footerEl.textContent = this.completedCount > 0 ? `${this.completedCount} completed` : "";
      return;
    }

    let html = "";
    for (const q of this.activeQuests) {
      const expandId = `active:${q.questId}`;
      const expanded = this.expandedIds.has(expandId);
      const pct = q.required > 0 ? Math.round((q.progress / q.required) * 100) : 0;
      const icon = OBJECTIVE_ICONS[q.objective.type] ?? "?";
      const barColor = q.complete ? "#66bbff" : "#4488cc";
      const chevron = expanded ? "\u25BC" : "\u25B6";

      const isFocused = this.focusedQuestId === q.questId;
      html += `<div class="qp-quest${expanded ? " qp-expanded" : ""}${isFocused ? " qp-focused" : ""}">`;
      html += `<div class="qp-quest-header" data-expand-id="${esc(expandId)}">`;
      html += `<span class="qp-chevron">${chevron}</span>`;
      html += `<span class="qp-icon">${icon}</span>`;
      html += `<span class="qp-quest-title">${esc(q.title)}</span>`;
      if (isFocused) html += `<span class="qp-focused-pill">FOCUS</span>`;
      if (q.complete) html += `<span class="qp-ready-pill">READY</span>`;
      html += `</div>`;

      html += `<div class="qp-quest-desc">${esc(q.description)}</div>`;

      if (q.complete) {
        if (this.isOwn && q.npcEntityId) {
          html += `<button class="qp-btn" data-action="complete" data-quest-id="${esc(q.questId)}" data-npc-id="${esc(q.npcEntityId)}" data-quest-title="${esc(q.title)}" data-quest-desc="${esc(q.description)}" data-obj-type="${esc(q.objective.type)}">Turn In</button>`;
        }
      } else {
        html += `<div class="qp-progress">`;
        html += `<div class="qp-progress-text">${q.progress} / ${q.required}</div>`;
        html += `<div class="qp-bar"><div class="qp-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
        html += `</div>`;
      }

      html += this.renderRewardsBlock(q.rewards, expanded);

      if (expanded) {
        html += `<div class="qp-detail-block">`;
        html += `<div class="qp-detail-row"><span class="qp-detail-label">Objective</span><span class="qp-detail-val">${esc(formatObjective(q.objective))}</span></div>`;
        if (q.required > 1 || q.progress > 0) {
          html += `<div class="qp-detail-row"><span class="qp-detail-label">Progress</span><span class="qp-detail-val">${q.progress} / ${q.required}</span></div>`;
        }
        html += `</div>`;

        if (this.isOwn) {
          if (this.confirmAbandonId === q.questId) {
            html += `<div class="qp-abandon-confirm">Abandon "${esc(q.title)}"? Progress will be lost.</div>`;
            html += `<div class="qp-btn-row">`;
            html += `<button class="qp-btn qp-btn-danger" data-action="abandon-confirm" data-quest-id="${esc(q.questId)}" data-quest-title="${esc(q.title)}">Confirm</button>`;
            html += `<button class="qp-btn qp-btn-ghost" data-action="abandon-cancel" data-quest-id="${esc(q.questId)}">Cancel</button>`;
            html += `</div>`;
          } else {
            const focusLabel = isFocused ? "Unfocus" : "Focus Agent on This Quest";
            const focusClass = isFocused ? "qp-btn qp-btn-focused qp-abandon" : "qp-btn qp-btn-focus qp-abandon";
            html += `<button class="${focusClass}" data-action="focus" data-quest-id="${esc(q.questId)}" data-quest-title="${esc(q.title)}">${focusLabel}</button>`;
            html += `<button class="qp-btn qp-btn-ghost qp-abandon" data-action="abandon-request" data-quest-id="${esc(q.questId)}">Abandon Quest</button>`;
          }
        }
      }

      html += `</div>`;
    }

    this.listEl.innerHTML = html;
    this.footerEl.textContent = this.completedCount > 0 ? `${this.completedCount} completed` : "";
  }

  private renderAvailable() {
    if (this.availableQuests.length === 0) {
      this.listEl.innerHTML = `<div class="qp-empty">No quests available in this zone</div>`;
      this.footerEl.textContent = "";
      return;
    }

    let html = "";
    for (const q of this.availableQuests) {
      const expandId = `avail:${q.questId}`;
      const expanded = this.expandedIds.has(expandId);
      const icon = OBJECTIVE_ICONS[q.objective.type] ?? "?";
      const chevron = expanded ? "\u25BC" : "\u25B6";

      html += `<div class="qp-quest${expanded ? " qp-expanded" : ""}">`;
      html += `<div class="qp-quest-header" data-expand-id="${esc(expandId)}">`;
      html += `<span class="qp-chevron">${chevron}</span>`;
      html += `<span class="qp-icon">${icon}</span>`;
      html += `<span class="qp-quest-title">${esc(q.title)}</span>`;
      html += `</div>`;
      html += `<div class="qp-quest-npc">${esc(q.npcName)}</div>`;
      html += `<div class="qp-quest-desc">${esc(q.description)}</div>`;

      if (expanded) {
        html += `<div class="qp-detail-block">`;
        html += `<div class="qp-detail-row"><span class="qp-detail-label">Objective</span><span class="qp-detail-val">${esc(formatObjective(q.objective))}</span></div>`;
        html += `<div class="qp-detail-row"><span class="qp-detail-label">Quest Giver</span><span class="qp-detail-val">${esc(q.npcName)}</span></div>`;
        html += `</div>`;
      }

      html += this.renderRewardsBlock(q.rewards, expanded);

      if (this.isOwn) {
        if (q.objective.type === "talk") {
          html += `<button class="qp-btn" data-action="talk" data-npc-id="${esc(q.npcEntityId)}" data-npc-name="${esc(q.npcName)}" data-quest-title="${esc(q.title)}" data-quest-desc="${esc(q.description)}">Talk</button>`;
        } else {
          html += `<button class="qp-btn" data-action="accept" data-quest-id="${esc(q.questId)}" data-npc-id="${esc(q.npcEntityId)}" data-npc-name="${esc(q.npcName)}">Accept</button>`;
        }
      }

      html += `</div>`;
    }

    this.listEl.innerHTML = html;
    this.footerEl.textContent = `${this.availableQuests.length} quest${this.availableQuests.length !== 1 ? "s" : ""} available`;
  }

  private renderCompleted() {
    if (this.completedQuests.length === 0) {
      this.listEl.innerHTML = `<div class="qp-empty">No completed quests</div>`;
      this.footerEl.textContent = "";
      return;
    }

    let html = "";
    for (const q of this.completedQuests) {
      const expandId = `done:${q.questId}`;
      const expanded = this.expandedIds.has(expandId);
      const chevron = expanded ? "\u25BC" : "\u25B6";

      html += `<div class="qp-quest qp-quest-completed${expanded ? " qp-expanded" : ""}">`;
      html += `<div class="qp-quest-header" data-expand-id="${esc(expandId)}">`;
      html += `<span class="qp-chevron">${chevron}</span>`;
      html += `<span class="qp-icon qp-complete-icon">&#10003;</span>`;
      html += `<span class="qp-quest-title">${esc(q.title)}</span>`;
      html += `<span class="qp-complete-label">Completed</span>`;
      html += `</div>`;
      html += `<div class="qp-quest-desc">${esc(q.description)}</div>`;
      html += this.renderRewardsBlock(q.rewards, expanded);
      html += `</div>`;
    }

    this.listEl.innerHTML = html;
    this.footerEl.textContent = `${this.completedQuests.length} completed`;
  }

  private renderRewardsBlock(rewards: { copper: number; xp: number; items?: { tokenId: number; quantity: number }[] }, expanded: boolean): string {
    if (!expanded) {
      const summary = `${rewards.copper}g  ${rewards.xp} XP${rewards.items?.length ? `  +${rewards.items.length} item${rewards.items.length > 1 ? "s" : ""}` : ""}`;
      return `<div class="qp-rewards">${esc(summary)}</div>`;
    }
    let html = `<div class="qp-rewards-block"><div class="qp-rewards-title">Rewards</div>`;
    html += `<div class="qp-detail-row"><span class="qp-detail-label">Gold</span><span class="qp-detail-val">${rewards.copper}g</span></div>`;
    html += `<div class="qp-detail-row"><span class="qp-detail-label">Experience</span><span class="qp-detail-val">${rewards.xp} XP</span></div>`;
    if (rewards.items?.length) {
      for (const it of rewards.items) {
        html += `<div class="qp-detail-row"><span class="qp-detail-label">Item</span><span class="qp-detail-val">#${it.tokenId} ×${it.quantity}</span></div>`;
      }
    }
    html += `</div>`;
    return html;
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #quest-panel {
        position: fixed;
        top: 184px;
        right: 12px;
        width: 320px;
        max-height: calc(100vh - 200px);
        background: rgba(10, 16, 28, 0.92);
        border: 1px solid rgba(102, 187, 255, 0.25);
        border-radius: 8px;
        z-index: 15;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }

      .qp-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(102, 187, 255, 0.15);
      }
      .qp-title { color: #66bbff; font-weight: bold; font-size: 13px; }

      .qp-tabs {
        display: flex;
        border-bottom: 1px solid rgba(102, 187, 255, 0.15);
      }
      .qp-tab {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        flex: 1;
        padding: 7px 0;
        background: none;
        border: none;
        color: #667;
        font: bold 12px monospace;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s;
        border-bottom: 2px solid transparent;
      }
      .qp-tab:hover { color: #aab; }
      .qp-tab.active { color: #66bbff; border-bottom-color: #66bbff; }
      .qp-tab-count {
        min-width: 14px;
        height: 14px;
        padding: 0 4px;
        border-radius: 999px;
        background: rgba(102, 187, 255, 0.12);
        color: #99aacc;
        font-size: 9px;
        line-height: 14px;
      }
      .qp-tab.active .qp-tab-count {
        background: rgba(102, 187, 255, 0.25);
        color: #cceeff;
      }

      .qp-list {
        overflow-y: auto;
        flex: 1;
        padding: 4px 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(102, 187, 255, 0.2) transparent;
      }

      .qp-quest {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(102, 187, 255, 0.08);
      }
      .qp-quest:last-child { border-bottom: none; }
      .qp-quest.qp-expanded { background: rgba(102, 187, 255, 0.04); }

      .qp-quest-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 2px;
        cursor: pointer;
        user-select: none;
      }
      .qp-quest-header:hover .qp-quest-title { color: #fff; }
      .qp-chevron {
        color: #557;
        font-size: 9px;
        width: 10px;
        flex-shrink: 0;
        transition: color 0.15s;
      }
      .qp-quest-header:hover .qp-chevron { color: #88aacc; }
      .qp-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
      .qp-quest-title {
        color: #dde;
        font-weight: bold;
        font-size: 12px;
        flex: 1;
        min-width: 0;
        overflow-wrap: break-word;
      }
      .qp-quest-npc { color: #88aacc; font-size: 11px; margin-left: 34px; }
      .qp-quest-desc {
        color: #99a;
        font-size: 11px;
        margin: 2px 0 4px 34px;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: break-word;
      }
      .qp-expanded .qp-quest-desc { color: #bbc; }
      .qp-quest-completed .qp-quest-title { color: #aee2c8; }
      .qp-complete-icon { color: #5dff9a; }
      .qp-complete-label {
        color: #5dff9a;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        flex-shrink: 0;
      }
      .qp-ready-pill {
        background: rgba(102, 187, 255, 0.2);
        color: #66bbff;
        font-size: 9px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 3px;
        letter-spacing: 0.06em;
        flex-shrink: 0;
      }
      .qp-focused-pill {
        background: rgba(255, 200, 80, 0.18);
        color: #ffc850;
        font-size: 9px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 3px;
        letter-spacing: 0.06em;
        flex-shrink: 0;
      }
      .qp-quest.qp-focused {
        background: rgba(255, 200, 80, 0.06);
        border-left: 2px solid rgba(255, 200, 80, 0.6);
      }

      .qp-progress { margin-left: 34px; margin-top: 4px; }
      .qp-progress-text { font-size: 11px; color: #99b; margin-bottom: 2px; }
      .qp-bar { background: #222; border-radius: 3px; height: 5px; }
      .qp-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }

      .qp-rewards {
        margin-left: 34px;
        font-size: 10px;
        color: #aa9;
        margin-top: 4px;
      }
      .qp-rewards-block {
        margin: 6px 0 0 34px;
        padding: 6px 8px;
        background: rgba(0, 0, 0, 0.25);
        border-left: 2px solid rgba(255, 200, 80, 0.4);
        border-radius: 3px;
      }
      .qp-rewards-title {
        color: #ffc850;
        font-size: 10px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 3px;
      }

      .qp-detail-block {
        margin: 6px 0 0 34px;
        padding: 6px 8px;
        background: rgba(0, 0, 0, 0.25);
        border-left: 2px solid rgba(102, 187, 255, 0.4);
        border-radius: 3px;
      }
      .qp-detail-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 10px;
        padding: 1px 0;
      }
      .qp-detail-label { color: #778; text-transform: uppercase; letter-spacing: 0.05em; }
      .qp-detail-val { color: #ccd; text-align: right; overflow-wrap: anywhere; }

      .qp-btn {
        display: block;
        margin: 6px 0 0 34px;
        padding: 4px 12px;
        background: rgba(102, 187, 255, 0.12);
        border: 1px solid rgba(102, 187, 255, 0.3);
        border-radius: 4px;
        color: #66bbff;
        font: bold 11px monospace;
        cursor: pointer;
        transition: background 0.15s;
      }
      .qp-btn:hover { background: rgba(102, 187, 255, 0.25); }
      .qp-btn-row { display: flex; gap: 6px; margin-left: 34px; margin-top: 6px; }
      .qp-btn-row .qp-btn { margin: 0; flex: 1; }
      .qp-btn-ghost {
        background: transparent;
        border-color: rgba(150, 150, 170, 0.3);
        color: #99a;
      }
      .qp-btn-ghost:hover { background: rgba(150, 150, 170, 0.12); color: #ccd; }
      .qp-btn-danger {
        background: rgba(220, 80, 80, 0.15);
        border-color: rgba(220, 80, 80, 0.4);
        color: #ff8888;
      }
      .qp-btn-danger:hover { background: rgba(220, 80, 80, 0.3); }
      .qp-btn-focus {
        background: rgba(255, 200, 80, 0.12);
        border-color: rgba(255, 200, 80, 0.4);
        color: #ffc850;
      }
      .qp-btn-focus:hover { background: rgba(255, 200, 80, 0.25); }
      .qp-btn-focused {
        background: rgba(255, 200, 80, 0.25);
        border-color: rgba(255, 200, 80, 0.6);
        color: #ffe3a8;
      }
      .qp-btn-focused:hover { background: rgba(255, 200, 80, 0.15); }
      .qp-abandon { width: calc(100% - 34px); text-align: center; margin-top: 8px; }
      .qp-abandon-confirm {
        margin: 8px 0 0 34px;
        padding: 6px 8px;
        background: rgba(220, 80, 80, 0.1);
        border-left: 2px solid rgba(220, 80, 80, 0.5);
        border-radius: 3px;
        font-size: 11px;
        color: #ffaaaa;
        line-height: 1.4;
      }

      .qp-footer {
        padding: 6px 12px;
        font-size: 10px;
        color: #556;
        border-top: 1px solid rgba(102, 187, 255, 0.08);
        text-align: center;
      }

      .qp-empty { padding: 20px; text-align: center; color: #556; }
    `;
    document.head.appendChild(style);
  }
}

const OBJECTIVE_ICONS: Record<string, string> = {
  kill: "\u2694",    // crossed swords
  talk: "\u{1F4AC}", // speech bubble
  gather: "\u2618",  // shamrock/clover
  craft: "\u2692",   // hammer and pick
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatObjective(obj: { type: string; count: number; targetMobName?: string; targetNpcName?: string; targetItemName?: string }): string {
  const target = obj.targetMobName ?? obj.targetNpcName ?? obj.targetItemName ?? "";
  const verb = capitalize(obj.type);
  if (obj.count > 1) return `${verb} ${obj.count} ${target}`.trim();
  return `${verb} ${target}`.trim();
}
