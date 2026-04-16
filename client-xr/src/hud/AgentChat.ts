import type { ZoneEvent } from "../types.js";
import { getAuthToken } from "../auth.js";
import { CANDIDATE_BASES, toUrl } from "../api.js";
const MAX_MESSAGES = 80;
const COLLAPSED_VISIBLE = 6;

type MsgRole = "user" | "agent" | "event" | "system";

interface ChatEntry {
  role: MsgRole;
  text: string;
  time: number;
  color: string;
}

const SLASH_COMMANDS = [
  { cmd: "/help",     desc: "List all commands" },
  { cmd: "/status",   desc: "Your stats, HP, gear" },
  { cmd: "/who",      desc: "Online players" },
  { cmd: "/look",     desc: "Scan nearby entities" },
  { cmd: "/find",     desc: "Search by name" },
  { cmd: "/bag",      desc: "Inventory & gold" },
  { cmd: "/quests",   desc: "Active & available quests" },
  { cmd: "/map",      desc: "World map & zones" },
  { cmd: "/focus",    desc: "Change agent activity" },
  { cmd: "/strategy", desc: "Combat strategy" },
  { cmd: "/party",    desc: "Party members" },
  { cmd: "/travel",   desc: "Travel to a zone" },
  { cmd: "/where",    desc: "Current position" },
  { cmd: "/equip",    desc: "Equip item by name" },
  { cmd: "/unequip",  desc: "Unequip by slot or name" },
  { cmd: "/speak",    desc: "Speak publicly as your champion" },
];

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "\"" ? "&quot;" : "&#39;",
  );
}

function formatScriptTarget(s: { targetZone?: string | null; targetName?: string | null; nodeType?: string | null }): string {
  const parts: string[] = [];
  if (s.targetName) parts.push(`→ ${escapeHtml(s.targetName)}`);
  if (s.targetZone) parts.push(`@ ${escapeHtml(s.targetZone.replace(/-/g, " "))}`);
  if (s.nodeType) parts.push(`[${escapeHtml(s.nodeType)}]`);
  return parts.length > 0 ? `<span class="ai-script-target">${parts.join(" ")}</span>` : "";
}

const SCRIPT_LABELS: Record<string, string> = {
  combat: "Fighting mobs",
  gather: "Gathering resources",
  travel: "Traveling",
  shop: "Shopping",
  craft: "Crafting",
  quest: "Questing",
  dungeon: "Running dungeon",
  idle: "Idling",
  follow: "Following party",
  rest: "Resting",
};

function humanizeScript(s: { type: string; targetZone?: string | null; targetName?: string | null; nodeType?: string | null }): string {
  const base = SCRIPT_LABELS[s.type] ?? s.type.replace(/-/g, " ");
  if (s.type === "travel" && s.targetZone) return `Traveling to ${s.targetZone.replace(/-/g, " ")}`;
  if (s.type === "gather" && s.nodeType) return `Gathering ${s.nodeType}`;
  if (s.targetName) return `${base} → ${s.targetName}`;
  return base;
}

const EVENT_COLORS: Record<string, string> = {
  combat: "#ff8866",
  death: "#cc4444",
  loot: "#ffcc44",
  chat: "#ccddee",
  quest: "#66bbff",
  levelup: "#44ff88",
  spawn: "#888",
  despawn: "#666",
  trade: "#ffaa44",
  craft: "#cc8844",
};

/**
 * Unified chat console: zone events + agent command input + slash commands.
 * Press Enter or T to focus, type a command, Enter to send.
 */
type ActiveTab = "chat" | "ai";

interface AgentStatus {
  currentActivity: string | null;
  currentScript: {
    type: string;
    reason: string | null;
    targetZone?: string | null;
    targetName?: string | null;
    nodeType?: string | null;
  } | null;
  actionQueue: Array<{
    type: string;
    reason: string | null;
    targetZone?: string | null;
    targetName?: string | null;
    nodeType?: string | null;
  }>;
  recentActivities: string[];
  running: boolean;
  entity?: { name: string; level: number; hp: number | null; maxHp: number | null } | null;
  zoneId?: string | null;
}

export class AgentChat {
  private root: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private log: HTMLDivElement;
  private aiPanel: HTMLDivElement;
  private input: HTMLInputElement;
  private autocompleteEl: HTMLDivElement;
  private messages: ChatEntry[] = [];
  private seenEventIds = new Set<string>();
  private expanded = false;
  private sending = false;
  private walletAddress: string | null = null;
  private entityId: string | null = null;
  private suggestions: typeof SLASH_COMMANDS = [];
  private selectedSuggestion = 0;
  private activeTab: ActiveTab = "chat";
  private aiStatus: AgentStatus | null = null;
  private aiPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "agent-chat";

    this.tabBar = document.createElement("div");
    this.tabBar.className = "agent-chat-tabs";

    this.log = document.createElement("div");
    this.log.className = "agent-chat-log";

    this.aiPanel = document.createElement("div");
    this.aiPanel.className = "agent-chat-ai";
    this.aiPanel.hidden = true;

    this.autocompleteEl = document.createElement("div");
    this.autocompleteEl.className = "agent-chat-autocomplete";
    this.autocompleteEl.hidden = true;

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "agent-chat-input";
    this.input.placeholder = "Send a command to your agent...";
    this.input.spellcheck = false;
    this.input.autocomplete = "off";

    this.renderTabs();

    this.root.appendChild(this.tabBar);
    this.root.appendChild(this.log);
    this.root.appendChild(this.aiPanel);
    this.root.appendChild(this.autocompleteEl);
    this.root.appendChild(this.input);
    document.body.appendChild(this.root);

    this.injectStyles();
    this.bindEvents();
    this.collapse();
  }

  // ── Tab management ───────────────────────────────────────────────

  setTab(tab: ActiveTab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.renderTabs();
    const isAi = tab === "ai";
    this.log.hidden = isAi;
    this.aiPanel.hidden = !isAi;
    this.input.style.display = isAi ? "none" : "";
    if (isAi) {
      this.startAiPolling();
      void this.refreshAiStatus();
    } else {
      this.stopAiPolling();
    }
  }

  private renderTabs() {
    this.tabBar.innerHTML = "";
    for (const [id, label] of [["chat", "Chat"], ["ai", "Bot"]] as const) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "agent-chat-tab" + (this.activeTab === id ? " active" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => this.setTab(id));
      this.tabBar.appendChild(btn);
    }
  }

  // ── AI status polling + render ───────────────────────────────────

  private startAiPolling() {
    if (this.aiPollTimer) return;
    this.aiPollTimer = setInterval(() => void this.refreshAiStatus(), 2500);
  }

  private stopAiPolling() {
    if (this.aiPollTimer) { clearInterval(this.aiPollTimer); this.aiPollTimer = null; }
  }

  private aiError: string | null = null;

  private async refreshAiStatus() {
    if (!this.walletAddress) {
      this.aiError = "Not signed in — no wallet address available.";
      this.aiStatus = null;
      this.renderAiPanel();
      return;
    }
    const token = await getAuthToken(this.walletAddress);
    if (!token) {
      this.aiError = "No auth token — sign in again.";
      this.renderAiPanel();
      return;
    }
    let lastErr = "";
    for (const base of CANDIDATE_BASES) {
      try {
        const res = await fetch(toUrl(base, `/agent/status/${this.walletAddress}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status} from ${base || "same-origin"}`;
          continue;
        }
        this.aiStatus = await res.json();
        this.aiError = null;
        this.renderAiPanel();
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    this.aiError = lastErr || "Agent status fetch failed";
    this.renderAiPanel();
  }

  private renderAiPanel() {
    const s = this.aiStatus;
    if (!s) {
      const msg = this.aiError ?? "Loading bot status...";
      this.aiPanel.innerHTML = `<div class="ai-empty" style="color:#ffcc44">${escapeHtml(msg)}</div>`;
      return;
    }
    // Defensive: server may omit these fields if the runner isn't spun up yet.
    const actionQueue = Array.isArray(s.actionQueue) ? s.actionQueue : [];
    const recentActivities = Array.isArray(s.recentActivities) ? s.recentActivities : [];
    s.actionQueue = actionQueue;
    s.recentActivities = recentActivities;

    const running = s.running;
    const headerHtml = `
      <div class="ai-header">
        <span class="ai-status-dot ${running ? "running" : "idle"}"></span>
        <span class="ai-status-text">${running ? "BOT RUNNING" : "BOT IDLE"}</span>
        ${s.entity ? `<span class="ai-entity">${escapeHtml(s.entity.name)} · Lv${s.entity.level}</span>` : ""}
      </div>`;

    const currentLabel = s.currentScript ? humanizeScript(s.currentScript) : (s.currentActivity ?? "Idle");
    const activityHtml = `
      <div class="ai-section">
        <div class="ai-label">CURRENTLY</div>
        <div class="ai-current">${escapeHtml(currentLabel)}</div>
        ${s.currentScript ? `
          <div class="ai-script">
            <span class="ai-script-type">${escapeHtml(s.currentScript.type)}</span>
            ${formatScriptTarget(s.currentScript)}
            ${s.currentScript.reason ? `<div class="ai-script-reason">Why: ${escapeHtml(s.currentScript.reason)}</div>` : ""}
          </div>
        ` : ""}
      </div>`;

    const queueHtml = `
      <div class="ai-section">
        <div class="ai-label">NEXT UP <span class="ai-count">${s.actionQueue.length}</span></div>
        ${s.actionQueue.length === 0
          ? `<div class="ai-empty">Nothing queued — supervisor will pick next action</div>`
          : s.actionQueue.map((q, i) => `
              <div class="ai-queue-item">
                <span class="ai-queue-index">${i + 1}</span>
                <div class="ai-queue-body">
                  <div class="ai-queue-title">${escapeHtml(humanizeScript(q))}</div>
                  ${q.reason ? `<div class="ai-script-reason">${escapeHtml(q.reason)}</div>` : ""}
                </div>
              </div>`).join("")}
      </div>`;

    const recentHtml = s.recentActivities.length > 0 ? `
      <div class="ai-section">
        <div class="ai-label">HISTORY</div>
        ${s.recentActivities.slice().reverse().map((a) => `<div class="ai-recent-item">${escapeHtml(a)}</div>`).join("")}
      </div>` : "";

    this.aiPanel.innerHTML = headerHtml + activityHtml + queueHtml + recentHtml;
  }

  setWallet(address: string | null) {
    this.walletAddress = address;
  }

  setEntityId(id: string | null) {
    this.entityId = id;
  }

  /** Add zone events to the feed */
  addEvents(events: ZoneEvent[]) {
    for (const ev of events) {
      if (this.seenEventIds.has(ev.id)) continue;
      this.seenEventIds.add(ev.id);
      this.push({
        role: "event",
        text: ev.message,
        time: Date.now(),
        color: EVENT_COLORS[ev.type] ?? "#999",
      });
    }
  }

  /** Is the input currently focused (capturing keyboard) */
  isFocused(): boolean {
    return document.activeElement === this.input;
  }

  /** Expand and focus the input */
  expand() {
    this.show();
    this.expanded = true;
    this.root.classList.add("expanded");
    if (this.activeTab === "chat") this.input.focus();
    this.scrollToBottom();
    if (this.activeTab === "ai") {
      this.startAiPolling();
      void this.refreshAiStatus();
    }
  }

  /** Collapse and blur */
  collapse() {
    this.expanded = false;
    this.root.classList.remove("expanded");
    this.input.blur();
    this.input.value = "";
    this.hideAutocomplete();
    this.stopAiPolling();
  }

  /** Whether the chat panel is visible at all (not display:none) */
  isVisible(): boolean {
    return !this.root.classList.contains("chat-hidden");
  }

  /** Show the chat panel (does not auto-expand input) */
  show() {
    this.root.classList.remove("chat-hidden");
  }

  /** Hide the chat panel entirely */
  hide() {
    this.collapse();
    this.root.classList.add("chat-hidden");
  }

  /** Toggle visibility; when showing, also expand the input for typing */
  toggle() {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.expand();
    }
  }

  private push(entry: ChatEntry) {
    this.messages.push(entry);
    while (this.messages.length > MAX_MESSAGES) this.messages.shift();
    this.renderMessages();
  }

  private renderMessages() {
    const visible = this.expanded
      ? this.messages
      : this.messages.slice(-COLLAPSED_VISIBLE);

    this.log.innerHTML = "";
    for (const msg of visible) {
      const el = document.createElement("div");
      el.className = `agent-chat-msg agent-chat-${msg.role}`;

      if (msg.role === "user") {
        el.textContent = `> ${msg.text}`;
        el.style.color = "#efc97f";
      } else if (msg.role === "agent") {
        el.textContent = msg.text;
        el.style.color = "#7fd6be";
      } else if (msg.role === "system") {
        el.textContent = msg.text;
        el.style.color = "#ff8866";
      } else {
        el.textContent = msg.text;
        el.style.color = msg.color;
      }

      this.log.appendChild(el);
    }
    this.scrollToBottom();
  }

  private scrollToBottom() {
    this.log.scrollTop = this.log.scrollHeight;
  }

  // ── Autocomplete ──────────────────────────────────────────────────

  private updateAutocomplete() {
    const val = this.input.value;
    if (val.startsWith("/") && !val.includes(" ")) {
      const q = val.toLowerCase();
      this.suggestions = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
      this.selectedSuggestion = 0;
      if (this.suggestions.length > 0) {
        this.renderAutocomplete();
        return;
      }
    }
    this.hideAutocomplete();
  }

  private renderAutocomplete() {
    this.autocompleteEl.innerHTML = "";
    for (let i = 0; i < this.suggestions.length; i++) {
      const s = this.suggestions[i];
      const row = document.createElement("div");
      row.className = "agent-chat-ac-row" + (i === this.selectedSuggestion ? " selected" : "");
      row.innerHTML = `<span class="ac-cmd">${s.cmd}</span> <span class="ac-desc">${s.desc}</span>`;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.input.value = s.cmd + " ";
        this.hideAutocomplete();
        this.input.focus();
      });
      this.autocompleteEl.appendChild(row);
    }
    this.autocompleteEl.hidden = false;
  }

  private hideAutocomplete() {
    this.suggestions = [];
    this.autocompleteEl.hidden = true;
    this.autocompleteEl.innerHTML = "";
  }

  private completeSelected() {
    if (this.suggestions.length === 0) return false;
    const s = this.suggestions[this.selectedSuggestion];
    this.input.value = s.cmd + " ";
    this.hideAutocomplete();
    return true;
  }

  // ── Send ──────────────────────────────────────────────────────────

  private async send() {
    const text = this.input.value.trim();
    if (!text || this.sending) return;

    this.push({ role: "user", text, time: Date.now(), color: "#efc97f" });
    this.input.value = "";
    this.hideAutocomplete();

    if (!this.walletAddress) {
      this.push({ role: "system", text: "Not signed in.", time: Date.now(), color: "#ff8866" });
      return;
    }

    const token = await getAuthToken(this.walletAddress);
    if (!token) {
      this.push({ role: "system", text: "Auth failed — try signing in again.", time: Date.now(), color: "#ff8866" });
      return;
    }

    // /speak or /say → send to /chat endpoint
    const speakMatch = text.match(/^\/(?:speak|say)\s+(.+)$/is);
    if (speakMatch) {
      const spoken = speakMatch[1].trim();
      if (!this.entityId) {
        this.push({ role: "system", text: "No character found — deploy your agent first.", time: Date.now(), color: "#ff8866" });
        return;
      }
      await this.sendSpeak(token, spoken);
      return;
    }

    // Everything else → /agent/chat
    await this.sendChat(token, text);
  }

  private async sendSpeak(token: string, message: string) {
    this.sending = true;
    this.input.placeholder = "Speaking...";
    try {
      let lastErr = "";
      let ok = false;
      for (const base of CANDIDATE_BASES) {
        try {
          const res = await fetch(toUrl(base, "/chat"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ entityId: this.entityId, message }),
          });
          if (res.ok) { ok = true; break; }
          lastErr = `${res.status} — ${(await res.text()).slice(0, 120)}`;
        } catch {
          // Try next candidate base.
        }
      }
      if (!ok) {
        this.push({ role: "system", text: `Speak failed: ${lastErr || "All API bases unreachable"}`, time: Date.now(), color: "#ff8866" });
      }
    } catch (err) {
      this.push({ role: "system", text: `Network error: ${err}`, time: Date.now(), color: "#ff8866" });
    } finally {
      this.sending = false;
      this.input.placeholder = "Send a command to your agent...";
    }
  }

  private async sendChat(token: string, message: string) {
    this.sending = true;
    this.input.placeholder = "Sending...";
    try {
      let res: Response | null = null;
      for (const base of CANDIDATE_BASES) {
        try {
          const r = await fetch(toUrl(base, "/agent/chat"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ message }),
          });
          if (r.ok || r.status < 500) { res = r; break; }
        } catch {
          // Try next candidate base.
        }
      }

      if (!res) {
        this.push({ role: "system", text: "All API bases unreachable", time: Date.now(), color: "#ff8866" });
        return;
      }
      if (!res.ok) {
        const body = await res.text();
        this.push({ role: "system", text: `Error: ${res.status} — ${body.slice(0, 120)}`, time: Date.now(), color: "#ff8866" });
        return;
      }

      const data = await res.json();
      if (data.response) {
        this.push({ role: "agent", text: data.response, time: Date.now(), color: "#7fd6be" });
      }
    } catch (err) {
      this.push({ role: "system", text: `Network error: ${err}`, time: Date.now(), color: "#ff8866" });
    } finally {
      this.sending = false;
      this.input.placeholder = "Send a command to your agent...";
    }
  }

  // ── Events ────────────────────────────────────────────────────────

  private bindEvents() {
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();

      // Autocomplete navigation
      if (this.suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.selectedSuggestion = (this.selectedSuggestion + 1) % this.suggestions.length;
          this.renderAutocomplete();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.selectedSuggestion = (this.selectedSuggestion - 1 + this.suggestions.length) % this.suggestions.length;
          this.renderAutocomplete();
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          this.completeSelected();
          return;
        }
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (this.suggestions.length > 0 && !this.input.value.includes(" ")) {
          this.completeSelected();
        } else if (this.input.value.trim()) {
          void this.send();
        } else {
          this.collapse();
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (this.suggestions.length > 0) {
          this.hideAutocomplete();
        } else {
          this.collapse();
        }
      }
    });

    this.input.addEventListener("input", () => this.updateAutocomplete());
    this.input.addEventListener("keyup", (e) => e.stopPropagation());
  }

  // ── Styles ────────────────────────────────────────────────────────

  private injectStyles() {
    if (document.getElementById("agent-chat-styles")) return;
    const style = document.createElement("style");
    style.id = "agent-chat-styles";
    style.textContent = `
      #agent-chat {
        position: fixed;
        bottom: 12px;
        left: 12px;
        width: 420px;
        z-index: 15;
        font: 12px/1.5 'Courier New', monospace;
        transition: background 150ms ease;
        border-radius: 8px;
        pointer-events: auto;
      }

      #agent-chat.chat-hidden {
        display: none;
      }

      #agent-chat.expanded {
        background: rgba(8, 6, 4, 0.85);
        border: 1px solid rgba(239, 201, 127, 0.18);
        backdrop-filter: blur(6px);
      }

      .agent-chat-tabs {
        display: flex;
        border-bottom: 1px solid rgba(239, 201, 127, 0.12);
        background: rgba(8, 6, 4, 0.75);
        border: 1px solid rgba(239, 201, 127, 0.12);
        border-radius: 8px 8px 0 0;
        overflow: hidden;
        pointer-events: auto;
      }

      #agent-chat.expanded .agent-chat-tabs {
        background: rgba(0, 0, 0, 0.35);
        border: none;
        border-bottom: 1px solid rgba(239, 201, 127, 0.12);
      }

      .agent-chat-tab {
        flex: 1;
        padding: 6px 10px;
        background: transparent;
        border: none;
        color: rgba(239, 201, 127, 0.5);
        font: 600 10px/1 'Courier New', monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .agent-chat-tab:hover { color: rgba(239, 201, 127, 0.85); }
      .agent-chat-tab.active {
        color: #efc97f;
        background: rgba(239, 201, 127, 0.1);
        border-bottom: 2px solid #efc97f;
      }

      .agent-chat-ai {
        display: none;
        padding: 8px 10px;
        max-height: 260px;
        overflow-y: auto;
        pointer-events: auto;
        background: rgba(8, 6, 4, 0.75);
        border-left: 1px solid rgba(239, 201, 127, 0.12);
        border-right: 1px solid rgba(239, 201, 127, 0.12);
        border-bottom: 1px solid rgba(239, 201, 127, 0.12);
        border-radius: 0 0 8px 8px;
      }

      .agent-chat-ai:not([hidden]) {
        display: block;
      }

      #agent-chat.expanded .agent-chat-ai:not([hidden]) {
        max-height: 320px;
        background: transparent;
        border: none;
      }

      .ai-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(239, 201, 127, 0.1);
        margin-bottom: 8px;
      }

      .ai-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .ai-status-dot.running { background: #54f28b; box-shadow: 0 0 8px #54f28b; animation: aiPulse 1.5s ease-in-out infinite; }
      .ai-status-dot.idle { background: #666; }

      @keyframes aiPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      .ai-status-text {
        font-size: 10px;
        letter-spacing: 0.1em;
        color: #efc97f;
        font-weight: bold;
      }

      .ai-entity {
        margin-left: auto;
        color: #7fd6be;
        font-size: 11px;
      }

      .ai-section { margin-bottom: 12px; }

      .ai-label {
        color: rgba(239, 201, 127, 0.55);
        font-size: 9px;
        letter-spacing: 0.18em;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .ai-count {
        color: #efc97f;
        background: rgba(239, 201, 127, 0.12);
        padding: 1px 6px;
        border-radius: 8px;
        font-size: 9px;
      }

      .ai-current {
        color: #f4ead0;
        font-size: 12px;
        font-weight: bold;
        margin-bottom: 4px;
      }

      .ai-script, .ai-queue-item {
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.3);
        border-left: 2px solid rgba(127, 214, 190, 0.4);
        margin-bottom: 4px;
        font-size: 11px;
      }

      .ai-queue-item {
        border-left-color: rgba(239, 201, 127, 0.4);
        display: flex;
        gap: 8px;
      }

      .ai-queue-index {
        color: rgba(239, 201, 127, 0.5);
        font-size: 10px;
        min-width: 14px;
      }

      .ai-queue-body { flex: 1; min-width: 0; }

      .ai-queue-title {
        color: #f4ead0;
        font-size: 11px;
        font-weight: bold;
      }

      .ai-script-type {
        color: #7fd6be;
        text-transform: uppercase;
        font-size: 10px;
        font-weight: bold;
        letter-spacing: 0.08em;
      }

      .ai-script-target {
        color: rgba(244, 234, 208, 0.7);
        font-size: 10px;
        margin-left: 4px;
      }

      .ai-script-reason {
        color: rgba(244, 234, 208, 0.5);
        font-style: italic;
        font-size: 10px;
        margin-top: 2px;
      }

      .ai-recent-item {
        padding: 2px 8px;
        color: rgba(244, 234, 208, 0.55);
        font-size: 10px;
        border-left: 1px solid rgba(239, 201, 127, 0.15);
        margin-bottom: 1px;
      }

      .ai-empty {
        color: rgba(239, 201, 127, 0.4);
        font-size: 10px;
        font-style: italic;
        padding: 4px 0;
      }

      .agent-chat-log {
        max-height: 120px;
        overflow: hidden;
        padding: 6px 8px 2px;
        pointer-events: none;
      }

      #agent-chat.expanded .agent-chat-log {
        max-height: 260px;
        overflow-y: auto;
        pointer-events: auto;
      }

      .agent-chat-msg {
        margin-bottom: 2px;
        text-shadow: 0 1px 3px rgba(0,0,0,0.9);
        word-wrap: break-word;
      }

      .agent-chat-user {
        font-weight: bold;
      }

      .agent-chat-autocomplete {
        display: none;
        max-height: 160px;
        overflow-y: auto;
        border-top: 1px solid rgba(239, 201, 127, 0.12);
        background: rgba(12, 10, 8, 0.95);
      }

      #agent-chat.expanded .agent-chat-autocomplete:not([hidden]) {
        display: block;
      }

      .agent-chat-ac-row {
        padding: 5px 10px;
        cursor: pointer;
        display: flex;
        gap: 8px;
        align-items: baseline;
      }

      .agent-chat-ac-row:hover,
      .agent-chat-ac-row.selected {
        background: rgba(239, 201, 127, 0.1);
      }

      .ac-cmd {
        color: #c792ea;
        font-weight: bold;
        flex-shrink: 0;
      }

      .ac-desc {
        color: rgba(239, 201, 127, 0.5);
        font-size: 11px;
      }

      .agent-chat-input {
        display: none;
        width: 100%;
        padding: 8px 10px;
        border: none;
        border-top: 1px solid rgba(239, 201, 127, 0.12);
        background: rgba(0, 0, 0, 0.3);
        color: #f4ead0;
        font: 12px/1.4 'Courier New', monospace;
        outline: none;
        border-radius: 0 0 8px 8px;
        box-sizing: border-box;
      }

      #agent-chat.expanded .agent-chat-input {
        display: block;
      }

      .agent-chat-input::placeholder {
        color: rgba(239, 201, 127, 0.4);
      }

      .agent-chat-log::-webkit-scrollbar,
      .agent-chat-autocomplete::-webkit-scrollbar {
        width: 4px;
      }
      .agent-chat-log::-webkit-scrollbar-track,
      .agent-chat-autocomplete::-webkit-scrollbar-track {
        background: transparent;
      }
      .agent-chat-log::-webkit-scrollbar-thumb,
      .agent-chat-autocomplete::-webkit-scrollbar-thumb {
        background: rgba(239, 201, 127, 0.2);
        border-radius: 2px;
      }
    `;
    document.head.appendChild(style);
  }
}
