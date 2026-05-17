interface TutorialStep {
  type: "welcome" | "highlight" | "quest";
  selector?: string;
  title: string;
  body: string;
}

const STEPS: TutorialStep[] = [
  {
    type: "welcome",
    title: "Welcome to World of Geneva!",
    body: "Your AI agent lives here and plays for you. Let\u2019s walk you through the controls \u2014 takes 30 seconds.",
  },
  {
    type: "highlight",
    selector: '.ab-btn[data-id="bag"]',
    title: "Bag \uD83C\uDF92",
    body: "Everything your agent loots \u2014 items, gold, equipment. Press <b>B</b> to open anytime.",
  },
  {
    type: "highlight",
    selector: '.ab-btn[data-id="quests"]',
    title: "Quests \uD83D\uDCDC",
    body: "Missions from NPCs across the world. Completing them earns XP and gold. Press <b>Q</b>.",
  },
  {
    type: "highlight",
    selector: '.ab-btn[data-id="skills"]',
    title: "Skills \u2692",
    body: "Combat techniques your agent can learn and use in battle. Press <b>P</b>.",
  },
  {
    type: "highlight",
    selector: '.ab-btn[data-id="inbox"]',
    title: "Inbox \uD83D\uDCEC",
    body: "Your agent logs every quest completion, level\u2011up, and alert here. Press <b>I</b>.",
  },
  {
    type: "highlight",
    selector: '.ab-btn[data-id="chat"]',
    title: "Agent Chat \uD83D\uDCAC",
    body: "Talk directly to your agent \u2014 give orders, ask questions, change their focus. Press <b>T</b>.",
  },
  {
    type: "quest",
    title: "Your First Quest",
    body: "Guard Captain Marcus is waiting in the village square. Click his quest to get started!",
  },
];

const PAD = 12;
const CARD_W = 288;
const STYLES_ID = "tut-styles";

export class TutorialOverlay {
  private ring: HTMLDivElement;
  private backdrop: HTMLDivElement;
  private card: HTMLDivElement;
  private step = 0;
  private togglePanel: (id: string) => void;
  private marcusCleanup: (() => void) | null = null;
  private stylesInjected = false;

  constructor(togglePanel: (id: string) => void) {
    this.togglePanel = togglePanel;

    this.backdrop = document.createElement("div");
    this.backdrop.className = "tut-backdrop";

    this.ring = document.createElement("div");
    this.ring.className = "tut-ring";

    this.card = document.createElement("div");
    this.card.className = "tut-card";
  }

  start(): void {
    this.injectStyles();
    this.step = 0;
    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.ring);
    document.body.appendChild(this.card);
    this.showStep();
  }

  private showStep(): void {
    const s = STEPS[this.step];
    const isLast = this.step === STEPS.length - 1;

    if (s.type === "quest") {
      this.ring.style.display = "none";
      this.backdrop.style.display = "block";
      this.card.innerHTML = "";
      this.togglePanel("quests");
      setTimeout(() => this.showMarcusStep(), 400);
      return;
    }

    if (s.type === "welcome" || !s.selector) {
      this.ring.style.display = "none";
      this.backdrop.style.display = "block";
      this.positionCardCentered();
    } else {
      const target = document.querySelector<HTMLElement>(s.selector);
      if (!target) { this.advance(); return; }
      this.backdrop.style.display = "none";
      this.ring.style.display = "block";
      this.positionRing(target);
      this.positionCardNearRing();
    }

    this.renderCard(s.title, s.body, isLast ? "Got it!" : "Next \u2192", () => this.advance());
  }

  private showMarcusStep(): void {
    const s = STEPS[this.step];
    const npcEls = Array.from(document.querySelectorAll<HTMLElement>(".qp-quest-npc"));
    const marcusNpc = npcEls.find((el) => el.textContent?.includes("Marcus"));
    const questRow = marcusNpc?.closest<HTMLElement>(".qp-quest");

    if (!questRow) {
      // Quest already accepted or panel not loaded — finish gracefully
      this.finish();
      return;
    }

    this.backdrop.style.display = "none";
    this.ring.style.display = "block";
    this.positionRing(questRow, 8);
    this.positionCardNearRing();
    this.renderCard(s.title, s.body, "Got it!", () => this.finish());

    const onClick = () => { this.finish(); };
    questRow.addEventListener("click", onClick, { once: true });
    this.marcusCleanup = () => questRow.removeEventListener("click", onClick);
  }

  private advance(): void {
    if (this.marcusCleanup) { this.marcusCleanup(); this.marcusCleanup = null; }
    this.step++;
    if (this.step >= STEPS.length) { this.finish(); return; }
    this.showStep();
  }

  private finish(): void {
    if (this.marcusCleanup) { this.marcusCleanup(); this.marcusCleanup = null; }
    localStorage.setItem("wog:tutorial-v1", "1");
    this.backdrop.remove();
    this.ring.remove();
    this.card.remove();
  }

  private positionRing(target: HTMLElement, padding = PAD): void {
    const r = target.getBoundingClientRect();
    this.ring.style.left = `${r.left - padding}px`;
    this.ring.style.top = `${r.top - padding}px`;
    this.ring.style.width = `${r.width + padding * 2}px`;
    this.ring.style.height = `${r.height + padding * 2}px`;
  }

  private positionCardNearRing(): void {
    const ringRect = this.ring.getBoundingClientRect();
    const aboveSpace = ringRect.top;
    const belowSpace = window.innerHeight - ringRect.bottom;
    const placeAbove = aboveSpace >= 140 || aboveSpace > belowSpace;

    // Horizontal: center on ring, clamp to viewport
    let left = ringRect.left + ringRect.width / 2 - CARD_W / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - CARD_W - 10));

    if (placeAbove) {
      this.card.style.top = `${ringRect.top - 16}px`;
      this.card.style.transform = "translateY(-100%)";
    } else {
      this.card.style.top = `${ringRect.bottom + 16}px`;
      this.card.style.transform = "none";
    }
    this.card.style.left = `${left}px`;
  }

  private positionCardCentered(): void {
    this.card.style.left = `${window.innerWidth / 2 - CARD_W / 2}px`;
    this.card.style.top = "50%";
    this.card.style.transform = "translateY(-50%)";
  }

  private renderCard(title: string, body: string, nextLabel: string, onNext: () => void): void {
    this.card.innerHTML = `
      <div class="tut-title">${title}</div>
      <div class="tut-body">${body}</div>
      <div class="tut-footer">
        <button class="tut-skip">Skip tutorial</button>
        <button class="tut-next">${nextLabel}</button>
      </div>
    `;
    this.card.querySelector<HTMLButtonElement>(".tut-next")!.addEventListener("click", onNext, { once: true });
    this.card.querySelector<HTMLButtonElement>(".tut-skip")!.addEventListener("click", () => this.finish(), { once: true });
  }

  private injectStyles(): void {
    if (this.stylesInjected || document.getElementById(STYLES_ID)) return;
    this.stylesInjected = true;
    const style = document.createElement("style");
    style.id = STYLES_ID;
    style.textContent = `
      .tut-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.58);
        z-index: 9989;
        pointer-events: none;
      }

      .tut-ring {
        position: fixed;
        z-index: 9990;
        border-radius: 10px;
        border: 2px solid #ffd700;
        pointer-events: none;
        animation: tut-pulse 1.6s ease-in-out infinite;
      }
      @keyframes tut-pulse {
        0%,100% {
          box-shadow:
            0 0 0 9999px rgba(0,0,0,0.58),
            0 0 12px 2px rgba(255,215,0,0.3);
        }
        50% {
          box-shadow:
            0 0 0 9999px rgba(0,0,0,0.58),
            0 0 36px 12px rgba(255,215,0,0.8);
        }
      }

      .tut-card {
        position: fixed;
        z-index: 9991;
        width: ${CARD_W}px;
        background: rgba(8, 14, 24, 0.97);
        border: 1px solid rgba(255, 215, 0, 0.45);
        border-radius: 10px;
        padding: 16px 18px 14px;
        box-shadow: 0 4px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,215,0,0.1);
        pointer-events: all;
        font-family: monospace;
      }

      .tut-title {
        font-size: 15px;
        font-weight: bold;
        color: #ffd700;
        margin-bottom: 8px;
        letter-spacing: 0.02em;
      }

      .tut-body {
        font-size: 13px;
        color: #ccd6e0;
        line-height: 1.55;
        margin-bottom: 14px;
      }

      .tut-body b {
        color: #7fffb0;
        font-weight: bold;
      }

      .tut-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }

      .tut-skip {
        background: none;
        border: none;
        color: rgba(180, 180, 200, 0.5);
        font: 11px monospace;
        cursor: pointer;
        padding: 4px 0;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .tut-skip:hover { color: rgba(200, 200, 220, 0.8); }

      .tut-next {
        background: rgba(255, 215, 0, 0.12);
        border: 1px solid rgba(255, 215, 0, 0.55);
        border-radius: 6px;
        color: #ffd700;
        font: bold 13px monospace;
        padding: 6px 16px;
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s;
        letter-spacing: 0.03em;
      }
      .tut-next:hover {
        background: rgba(255, 215, 0, 0.22);
        border-color: rgba(255, 215, 0, 0.85);
      }
      .tut-next:active { background: rgba(255, 215, 0, 0.3); }
    `;
    document.head.appendChild(style);
  }
}
