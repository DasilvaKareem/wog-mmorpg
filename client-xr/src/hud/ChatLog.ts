import type { ZoneEvent } from "../types.js";

const MAX_MESSAGES = 30;
const FADE_TIME = 15_000; // ms before messages start fading

/**
 * Simple zone event chat log in the bottom-left.
 */
export class ChatLog {
  private container: HTMLDivElement;
  private messages: { el: HTMLDivElement; time: number }[] = [];
  private seenIds = new Set<string>();

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "chat-log";
    this.container.style.cssText = `
      position: fixed;
      bottom: 12px;
      left: 12px;
      width: min(400px, calc(100vw - 24px));
      max-height: 200px;
      overflow: hidden;
      color: #ccc;
      font: 12px/1.4 monospace;
      pointer-events: none;
      z-index: 10;
    `;
    document.body.appendChild(this.container);
  }

  addEvents(events: ZoneEvent[]) {
    for (const ev of events) {
      if (this.seenIds.has(ev.id)) continue;
      this.seenIds.add(ev.id);

      const el = document.createElement("div");
      el.style.cssText = "margin-bottom: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.8);";
      el.textContent = this.formatEvent(ev);
      el.style.color = EVENT_COLORS[ev.type] ?? "#999";
      this.container.appendChild(el);

      this.messages.push({ el, time: Date.now() });

      // Trim old messages
      while (this.messages.length > MAX_MESSAGES) {
        const old = this.messages.shift();
        old?.el.remove();
      }
    }

    // Scroll to bottom
    this.container.scrollTop = this.container.scrollHeight;
  }

  /** Fade old messages */
  update() {
    const now = Date.now();
    for (const msg of this.messages) {
      const age = now - msg.time;
      if (age > FADE_TIME) {
        const fadeProgress = Math.min((age - FADE_TIME) / 5000, 1);
        msg.el.style.opacity = String(1 - fadeProgress);
      }
    }
  }

  private formatEvent(ev: ZoneEvent): string {
    return ev.message;
  }
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
