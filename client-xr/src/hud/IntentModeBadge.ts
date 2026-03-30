export type IntentVisibilityMode = "minimal" | "tactical" | "spectator";

export class IntentModeBadge {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "intent-mode-badge";
    this.el.style.cssText = `
      position: fixed;
      top: 12px;
      right: 12px;
      padding: 6px 10px;
      background: rgba(8, 14, 24, 0.78);
      border: 1px solid rgba(255, 204, 90, 0.28);
      border-radius: 999px;
      color: #ffd98a;
      font: 11px/1 monospace;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      z-index: 17;
      pointer-events: none;
      backdrop-filter: blur(5px);
    `;
    document.body.appendChild(this.el);
    this.setMode("minimal");
  }

  setMode(mode: IntentVisibilityMode) {
    this.el.textContent = `Intent ${mode} · V`;
  }
}
