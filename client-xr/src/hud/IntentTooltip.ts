export class IntentTooltip {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "intent-tooltip";
    this.el.style.cssText = `
      position: fixed;
      top: 52px;
      right: 12px;
      max-width: 320px;
      padding: 8px 12px;
      background: rgba(8, 14, 24, 0.82);
      border: 1px solid rgba(90, 180, 255, 0.24);
      border-radius: 8px;
      color: #d9ecff;
      font: 12px/1.45 monospace;
      letter-spacing: 0.01em;
      z-index: 16;
      pointer-events: none;
      backdrop-filter: blur(5px);
      display: none;
    `;
    document.body.appendChild(this.el);
  }

  setText(text: string | null) {
    if (!text) {
      this.el.style.display = "none";
      this.el.textContent = "";
      return;
    }

    this.el.textContent = text;
    this.el.style.display = "block";
  }
}
