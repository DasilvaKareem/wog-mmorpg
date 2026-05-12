/**
 * Center-screen event banner for level-ups, quest milestones, etc.
 * Multiple events queue and play in sequence so a level-up + quest-complete
 * in the same tick don't stomp each other.
 */

export type EventBannerType =
  | "level-up"
  | "profession-level-up"
  | "skill-learned"
  | "quest-complete"
  | "quest-abandoned";

interface BannerSpec {
  title: string;
  subtitle?: string;
  accent: string;       // primary glow color
  accentSoft: string;   // softer text-shadow
  textColor: string;
  border: string;
}

const SPECS: Record<EventBannerType, BannerSpec> = {
  "level-up": {
    title: "LEVEL UP!",
    accent: "rgba(255, 215, 90, 0.95)",
    accentSoft: "rgba(255, 200, 100, 0.6)",
    textColor: "#fff6d8",
    border: "rgba(255, 215, 90, 0.5)",
  },
  "profession-level-up": {
    title: "PROFESSION LEVEL UP!",
    accent: "rgba(110, 200, 255, 0.95)",
    accentSoft: "rgba(110, 200, 255, 0.55)",
    textColor: "#e0f1ff",
    border: "rgba(110, 200, 255, 0.5)",
  },
  "skill-learned": {
    title: "NEW SKILL LEARNED!",
    accent: "rgba(190, 140, 255, 0.95)",
    accentSoft: "rgba(190, 140, 255, 0.55)",
    textColor: "#efe1ff",
    border: "rgba(190, 140, 255, 0.5)",
  },
  "quest-complete": {
    title: "QUEST COMPLETE",
    accent: "rgba(120, 240, 160, 0.95)",
    accentSoft: "rgba(120, 240, 160, 0.55)",
    textColor: "#e2ffe9",
    border: "rgba(120, 240, 160, 0.5)",
  },
  "quest-abandoned": {
    title: "QUEST ABANDONED",
    accent: "rgba(255, 110, 110, 0.95)",
    accentSoft: "rgba(255, 110, 110, 0.55)",
    textColor: "#ffe2e2",
    border: "rgba(255, 110, 110, 0.5)",
  },
};

const FADE_IN_MS = 350;
const HOLD_MS = 2400;
const FADE_OUT_MS = 600;

interface QueuedEvent {
  type: EventBannerType;
  subtitle?: string;
}

export class EventBanner {
  private container: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private queue: QueuedEvent[] = [];
  private playing = false;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "event-banner";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "event-banner-title";
    this.container.appendChild(this.titleEl);

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "event-banner-subtitle";
    this.container.appendChild(this.subtitleEl);

    document.body.appendChild(this.container);
    this.injectStyles();
  }

  show(type: EventBannerType, subtitle?: string): void {
    this.queue.push({ type, subtitle });
    if (!this.playing) void this.drain();
  }

  private async drain(): Promise<void> {
    this.playing = true;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      await this.playOne(event);
    }
    this.playing = false;
  }

  private playOne(event: QueuedEvent): Promise<void> {
    return new Promise((resolve) => {
      const spec = SPECS[event.type];
      this.titleEl.textContent = spec.title;
      this.subtitleEl.textContent = event.subtitle ?? "";
      this.subtitleEl.style.display = event.subtitle ? "block" : "none";

      this.container.style.setProperty("--banner-accent", spec.accent);
      this.container.style.setProperty("--banner-accent-soft", spec.accentSoft);
      this.container.style.setProperty("--banner-text", spec.textColor);
      this.container.style.setProperty("--banner-border", spec.border);

      this.container.classList.remove("event-banner-out");
      void this.container.offsetWidth;
      this.container.classList.add("event-banner-in");

      setTimeout(() => {
        this.container.classList.remove("event-banner-in");
        this.container.classList.add("event-banner-out");
        setTimeout(() => {
          this.container.classList.remove("event-banner-out");
          resolve();
        }, FADE_OUT_MS);
      }, FADE_IN_MS + HOLD_MS);
    });
  }

  private injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      #event-banner {
        position: fixed;
        top: 28vh;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        pointer-events: none;
        z-index: 28;
        opacity: 0;
        font-family: "Cinzel", "Georgia", "Times New Roman", serif;
        padding: 14px 36px;
        background: linear-gradient(180deg, rgba(10, 14, 22, 0.78), rgba(10, 14, 22, 0.6));
        border-top: 1px solid var(--banner-border, rgba(255,215,90,0.5));
        border-bottom: 1px solid var(--banner-border, rgba(255,215,90,0.5));
        box-shadow:
          0 0 60px var(--banner-accent-soft, rgba(255,200,100,0.4)),
          inset 0 0 30px rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(6px);
      }

      #event-banner.event-banner-in  { animation: event-banner-in  ${FADE_IN_MS}ms cubic-bezier(.2,.9,.3,1) forwards; }
      #event-banner.event-banner-out { animation: event-banner-out ${FADE_OUT_MS}ms ease-in forwards; }

      @keyframes event-banner-in {
        0%   { opacity: 0; transform: translate(-50%, -24px) scale(0.92); }
        70%  { opacity: 1; transform: translate(-50%, 4px)   scale(1.04); }
        100% { opacity: 1; transform: translate(-50%, 0)     scale(1.00); }
      }
      @keyframes event-banner-out {
        0%   { opacity: 1; transform: translate(-50%, 0); }
        100% { opacity: 0; transform: translate(-50%, -16px); }
      }

      .event-banner-title {
        font-size: clamp(22px, 3.4vw, 38px);
        font-weight: 700;
        letter-spacing: 0.16em;
        color: var(--banner-text, #fff6d8);
        text-shadow:
          0 0 18px var(--banner-accent, rgba(255,215,90,0.95)),
          0 2px 6px rgba(0, 0, 0, 0.9);
      }

      .event-banner-subtitle {
        margin-top: 6px;
        font-size: clamp(12px, 1.4vw, 16px);
        color: rgba(255, 255, 255, 0.78);
        font-style: italic;
        letter-spacing: 0.06em;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
      }
    `;
    document.head.appendChild(style);
  }
}
