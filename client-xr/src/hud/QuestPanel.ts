import type { ActiveQuest, AvailableQuest, QuestLogResponse, ZoneQuestsResponse } from "../types.js";

interface QuestPanelCallbacks {
  onAcceptQuest: (questId: string, npcEntityId: string, npcName: string) => void;
  onCompleteQuest: (questId: string, npcEntityId: string, questTitle: string, questDesc: string, objectiveType: string) => void;
  onTalkToNpc: (npcEntityId: string, npcName: string, questTitle: string, questDesc: string, objectiveType: string) => void;
  onOpenAvailable?: () => void;
}

/**
 * Side panel showing quest log (active + available quests).
 * Positioned on the right side below the minimap.
 */
export class QuestPanel {
  private container: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private listEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private activeTab: "active" | "available" = "active";
  private callbacks: QuestPanelCallbacks;
  private isOwn = false;

  private activeQuests: ActiveQuest[] = [];
  private completedCount = 0;
  private availableQuests: AvailableQuest[] = [];

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
    this.tabBar.innerHTML = `
      <button class="qp-tab active" data-tab="active">Active</button>
      <button class="qp-tab" data-tab="available">Available</button>
    `;
    this.tabBar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".qp-tab") as HTMLButtonElement;
      if (!btn) return;
      const tab = btn.dataset.tab as "active" | "available";
      this.activeTab = tab;
      this.tabBar.querySelectorAll(".qp-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (tab === "available") {
        this.callbacks.onOpenAvailable?.();
      }
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
      const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement;
      if (!btn) return;
      const action = btn.dataset.action;
      const questId = btn.dataset.questId ?? "";
      const npcId = btn.dataset.npcId ?? "";

      if (action === "accept") {
        const npcName = btn.dataset.npcName ?? "";
        this.callbacks.onAcceptQuest(questId, npcId, npcName);
      } else if (action === "complete") this.callbacks.onCompleteQuest(questId, npcId, btn.dataset.questTitle ?? "", btn.dataset.questDesc ?? "", btn.dataset.objType ?? "kill");
      else if (action === "talk") this.callbacks.onTalkToNpc(npcId, btn.dataset.npcName ?? "", btn.dataset.questTitle ?? "", btn.dataset.questDesc ?? "", "talk");
    });
  }

  setPlayer(_walletAddress: string | null, isOwn: boolean) {
    this.isOwn = isOwn;
  }

  updateQuestLog(data: QuestLogResponse) {
    this.activeQuests = data.activeQuests;
    this.completedCount = data.completedQuests.length;
    this.render();
  }

  updateZoneQuests(data: ZoneQuestsResponse) {
    this.availableQuests = data.quests;
    if (this.activeTab === "available") this.render();
  }

  /** Open the panel to the Available tab (e.g. when clicking a quest-giver) */
  showAvailable() {
    this.activeTab = "available";
    this.tabBar.querySelectorAll(".qp-tab").forEach((b) => {
      b.classList.toggle("active", (b as HTMLElement).dataset.tab === "available");
    });
    this.container.style.display = "flex";
    this.callbacks.onOpenAvailable?.();
    this.render();
  }

  toggle() {
    if (this.container.style.display === "none") {
      this.container.style.display = "flex";
      if (this.activeTab === "available") {
        this.callbacks.onOpenAvailable?.();
      }
      this.render();
    } else {
      this.container.style.display = "none";
    }
  }

  show() {
    this.container.style.display = "flex";
    this.render();
  }

  hide() {
    this.container.style.display = "none";
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  private render() {
    if (this.activeTab === "active") {
      this.renderActive();
    } else {
      this.renderAvailable();
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
      const pct = q.required > 0 ? Math.round((q.progress / q.required) * 100) : 0;
      const icon = OBJECTIVE_ICONS[q.objective.type] ?? "?";
      const barColor = q.complete ? "#66bbff" : "#4488cc";

      html += `<div class="qp-quest">`;
      html += `<div class="qp-quest-header">`;
      html += `<span class="qp-icon">${icon}</span>`;
      html += `<span class="qp-quest-title">${esc(q.title)}</span>`;
      html += `</div>`;
      html += `<div class="qp-quest-desc">${esc(q.description)}</div>`;

      if (q.complete) {
        html += `<div class="qp-ready">READY TO TURN IN</div>`;
        if (this.isOwn && q.npcEntityId) {
          html += `<button class="qp-btn" data-action="complete" data-quest-id="${esc(q.questId)}" data-npc-id="${esc(q.npcEntityId)}" data-quest-title="${esc(q.title)}" data-quest-desc="${esc(q.description)}" data-obj-type="${esc(q.objective.type)}">Turn In</button>`;
        }
      } else {
        html += `<div class="qp-progress">`;
        html += `<div class="qp-progress-text">${q.progress} / ${q.required}</div>`;
        html += `<div class="qp-bar"><div class="qp-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
        html += `</div>`;
      }

      html += `<div class="qp-rewards">${q.rewards.copper}g  ${q.rewards.xp} XP</div>`;
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
      const icon = OBJECTIVE_ICONS[q.objective.type] ?? "?";
      const target = q.objective.targetMobName ?? q.objective.targetNpcName ?? q.objective.targetItemName ?? "";
      const objText = `${capitalize(q.objective.type)} ${q.objective.count > 1 ? q.objective.count + " " : ""}${target}`;

      html += `<div class="qp-quest">`;
      html += `<div class="qp-quest-header">`;
      html += `<span class="qp-icon">${icon}</span>`;
      html += `<span class="qp-quest-title">${esc(q.title)}</span>`;
      html += `</div>`;
      html += `<div class="qp-quest-npc">${esc(q.npcName)}</div>`;
      html += `<div class="qp-quest-desc">${esc(objText)}</div>`;
      html += `<div class="qp-rewards">${q.rewards.copper}g  ${q.rewards.xp} XP</div>`;

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

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #quest-panel {
        position: fixed;
        top: 184px;
        right: 12px;
        width: 280px;
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

      .qp-quest-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 2px;
      }
      .qp-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
      .qp-quest-title { color: #dde; font-weight: bold; font-size: 12px; }
      .qp-quest-npc { color: #88aacc; font-size: 11px; margin-left: 24px; }
      .qp-quest-desc { color: #889; font-size: 11px; margin: 2px 0 4px 24px; }

      .qp-progress { margin-left: 24px; }
      .qp-progress-text { font-size: 11px; color: #99b; margin-bottom: 2px; }
      .qp-bar { background: #222; border-radius: 3px; height: 5px; }
      .qp-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }

      .qp-ready {
        margin-left: 24px;
        color: #66bbff;
        font-size: 11px;
        font-weight: bold;
        margin-bottom: 4px;
      }

      .qp-rewards {
        margin-left: 24px;
        font-size: 10px;
        color: #997;
        margin-top: 2px;
      }

      .qp-btn {
        display: block;
        margin: 6px 0 0 24px;
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
