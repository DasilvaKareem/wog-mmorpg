const ICONS: Record<string, string> = {
  kill: "\u2694",    // ⚔
  gather: "\u2618",  // ☘
  craft: "\u2692",   // ⚒
  talk: "\u{1F4AC}", // 💬
};

interface ToastEntry {
  text: string;
  type: string;
}

export class QuestProgressToast {
  private el: HTMLDivElement;
  private queue: ToastEntry[] = [];
  private playing = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "quest-progress-toast";
    document.body.appendChild(this.el);
    this.injectStyles();
  }

  show(objectiveType: string, progress: number, required: number, targetName: string): void {
    const icon = ICONS[objectiveType] ?? "?";
    const verb = objectiveType === "kill" ? "slain" : objectiveType === "gather" ? "gathered" : objectiveType === "craft" ? "crafted" : "";
    const text = verb
      ? `${icon} ${progress}/${required} ${targetName} ${verb}`
      : `${icon} ${progress}/${required} ${targetName}`;
    this.queue.push({ text, type: objectiveType });
    if (!this.playing) void this.drain();
  }

  private async drain(): Promise<void> {
    this.playing = true;
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      await this.playOne(entry);
    }
    this.playing = false;
  }

  private playOne(entry: ToastEntry): Promise<void> {
    return new Promise((resolve) => {
      this.el.textContent = entry.text;
      this.el.classList.remove("qpt-out");
      void this.el.offsetWidth;
      this.el.classList.add("qpt-in");

      setTimeout(() => {
        this.el.classList.remove("qpt-in");
        this.el.classList.add("qpt-out");
        setTimeout(() => {
          this.el.classList.remove("qpt-out");
          resolve();
        }, 400);
      }, 180 + 1500);
    });
  }

  private injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      #quest-progress-toast {
        position: fixed;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        z-index: 27;
        opacity: 0;
        font: bold 13px monospace;
        color: #e8dfa0;
        background: rgba(10, 14, 22, 0.82);
        border: 1px solid rgba(255, 210, 80, 0.35);
        border-radius: 20px;
        padding: 5px 16px;
        white-space: nowrap;
        backdrop-filter: blur(4px);
        text-shadow: 0 0 10px rgba(255, 200, 60, 0.6);
      }
      #quest-progress-toast.qpt-in  { animation: qpt-in  180ms ease-out forwards; }
      #quest-progress-toast.qpt-out { animation: qpt-out 400ms ease-in  forwards; }
      @keyframes qpt-in {
        from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.94); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1.00); }
      }
      @keyframes qpt-out {
        from { opacity: 1; transform: translateX(-50%) translateY(0); }
        to   { opacity: 0; transform: translateX(-50%) translateY(-6px); }
      }
    `;
    document.head.appendChild(style);
  }
}
