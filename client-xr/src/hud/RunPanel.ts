interface RunPanelState {
  enabled: boolean;
  running: boolean;
  energy: number;
  maxEnergy: number;
  available: boolean;
}

interface RunPanelOptions {
  onToggle: () => void;
}

export class RunPanel {
  private readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private readonly energyLabel: HTMLSpanElement;
  private readonly energyFill: HTMLDivElement;
  private state: RunPanelState = {
    enabled: false,
    running: false,
    energy: 0,
    maxEnergy: 100,
    available: false,
  };

  constructor(options: RunPanelOptions) {
    this.root = document.createElement("div");
    this.root.id = "run-panel";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "run-toggle";
    this.button.addEventListener("click", () => options.onToggle());

    const energyBar = document.createElement("div");
    energyBar.className = "run-energy-bar";

    this.energyFill = document.createElement("div");
    this.energyFill.className = "run-energy-fill";
    energyBar.appendChild(this.energyFill);

    const footer = document.createElement("div");
    footer.className = "run-footer";

    this.status = document.createElement("span");
    this.status.className = "run-status";

    this.energyLabel = document.createElement("span");
    this.energyLabel.className = "run-energy-label";

    footer.append(this.status, this.energyLabel);
    this.root.append(this.button, energyBar, footer);
    document.body.appendChild(this.root);

    this.injectStyles();
    this.render();
  }

  update(next: Partial<RunPanelState>) {
    this.state = { ...this.state, ...next };
    this.render();
  }

  reset() {
    this.state = {
      enabled: false,
      running: false,
      energy: 0,
      maxEnergy: 100,
      available: false,
    };
    this.render();
  }

  private render() {
    const maxEnergy = Math.max(1, this.state.maxEnergy || 100);
    const energy = Math.max(0, Math.min(this.state.energy, maxEnergy));
    const energyPct = Math.round((energy / maxEnergy) * 100);

    this.button.textContent = this.state.enabled ? "RUN ON" : "RUN OFF";
    this.button.disabled = !this.state.available;
    this.button.classList.toggle("active", this.state.enabled);
    this.button.classList.toggle("depleted", this.state.enabled && energyPct === 0);
    this.energyFill.style.width = `${energyPct}%`;
    this.energyFill.classList.toggle("low", energyPct <= 20);
    this.status.textContent = this.state.running ? "Running" : this.state.enabled ? "Ready" : "Walking";
    this.energyLabel.textContent = `${energyPct}%`;
    this.root.classList.toggle("inactive", !this.state.available);
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #run-panel {
        position: fixed;
        right: 12px;
        bottom: 78px;
        width: 156px;
        padding: 10px;
        border: 1px solid rgba(255, 214, 102, 0.32);
        border-radius: 10px;
        background: rgba(20, 14, 8, 0.88);
        color: #f3dfb3;
        font: 12px monospace;
        z-index: 16;
        display: flex;
        flex-direction: column;
        gap: 8px;
        backdrop-filter: blur(6px);
      }
      #run-panel.inactive {
        opacity: 0.45;
      }
      #run-panel .run-toggle {
        border: 1px solid rgba(255, 214, 102, 0.35);
        border-radius: 8px;
        background: rgba(60, 40, 18, 0.9);
        color: #f5d985;
        cursor: pointer;
        font: bold 12px monospace;
        letter-spacing: 0.08em;
        padding: 8px 10px;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      #run-panel .run-toggle:hover:not(:disabled) {
        background: rgba(88, 58, 24, 0.95);
      }
      #run-panel .run-toggle.active {
        background: linear-gradient(180deg, rgba(153, 101, 34, 0.96), rgba(109, 68, 20, 0.96));
        border-color: rgba(255, 214, 102, 0.7);
        color: #fff7df;
      }
      #run-panel .run-toggle.depleted {
        color: #ffb17a;
      }
      #run-panel .run-toggle:disabled {
        cursor: default;
      }
      #run-panel .run-energy-bar {
        height: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
      }
      #run-panel .run-energy-fill {
        height: 100%;
        width: 0;
        border-radius: inherit;
        background: linear-gradient(90deg, #c6ff68 0%, #ffe16b 60%, #ff9f4a 100%);
        transition: width 0.12s linear;
      }
      #run-panel .run-energy-fill.low {
        background: linear-gradient(90deg, #ffbf6b 0%, #ff7f50 100%);
      }
      #run-panel .run-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: rgba(255, 240, 207, 0.84);
      }
      #run-panel .run-status {
        text-transform: uppercase;
        font-size: 10px;
        letter-spacing: 0.08em;
      }
      #run-panel .run-energy-label {
        color: #ffe38c;
      }
    `;
    document.head.appendChild(style);
  }
}
