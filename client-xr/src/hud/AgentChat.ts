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
export class AgentChat {
  private root: HTMLDivElement;
  private log: HTMLDivElement;
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

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "agent-chat";

    this.log = document.createElement("div");
    this.log.className = "agent-chat-log";

    this.autocompleteEl = document.createElement("div");
    this.autocompleteEl.className = "agent-chat-autocomplete";
    this.autocompleteEl.hidden = true;

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "agent-chat-input";
    this.input.placeholder = "Send a command to your agent...";
    this.input.spellcheck = false;
    this.input.autocomplete = "off";

    this.root.appendChild(this.log);
    this.root.appendChild(this.autocompleteEl);
    this.root.appendChild(this.input);
    document.body.appendChild(this.root);

    this.injectStyles();
    this.bindEvents();
    this.collapse();
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
    this.expanded = true;
    this.root.classList.add("expanded");
    this.input.focus();
    this.scrollToBottom();
  }

  /** Collapse and blur */
  collapse() {
    this.expanded = false;
    this.root.classList.remove("expanded");
    this.input.blur();
    this.input.value = "";
    this.hideAutocomplete();
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

      #agent-chat.expanded {
        background: rgba(8, 6, 4, 0.85);
        border: 1px solid rgba(239, 201, 127, 0.18);
        backdrop-filter: blur(6px);
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
