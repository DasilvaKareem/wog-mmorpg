interface ActionBarButton {
  id: string;
  icon: string;
  label: string;
  key: string;     // keyboard shortcut hint
  onClick: () => void;
}

export class ActionBar {
  private container: HTMLDivElement;
  private buttons: ActionBarButton[] = [];

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "action-bar";
    document.body.appendChild(this.container);
    this.injectStyles();
  }

  addButton(btn: ActionBarButton) {
    this.buttons.push(btn);
    this.render();
  }

  private render() {
    let html = "";
    for (const btn of this.buttons) {
      html += `<button class="ab-btn" data-id="${btn.id}" title="${btn.label} (${btn.key})">`;
      html += `<span class="ab-icon">${btn.icon}</span>`;
      html += `<span class="ab-key">${btn.key}</span>`;
      html += `</button>`;
    }
    this.container.innerHTML = html;

    // Attach click handlers
    this.container.querySelectorAll(".ab-btn").forEach((el) => {
      const id = (el as HTMLElement).dataset.id;
      const btn = this.buttons.find((b) => b.id === id);
      if (btn) el.addEventListener("click", btn.onClick);
    });
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #action-bar {
        position: fixed;
        bottom: 12px;
        right: 12px;
        display: flex;
        gap: 4px;
        z-index: 18;
        pointer-events: auto;
      }

      .ab-btn {
        width: 44px;
        height: 44px;
        background: rgba(10, 16, 28, 0.88);
        border: 1px solid rgba(68, 255, 136, 0.2);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.12s, border-color 0.15s;
        padding: 0;
        position: relative;
      }
      .ab-btn:hover {
        background: rgba(30, 50, 45, 0.9);
        border-color: rgba(68, 255, 136, 0.5);
      }
      .ab-btn:active {
        background: rgba(40, 70, 55, 0.95);
      }

      .ab-icon {
        font-size: 20px;
        line-height: 1;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
      }

      .ab-key {
        position: absolute;
        bottom: 2px;
        right: 3px;
        font: bold 8px monospace;
        color: rgba(68, 255, 136, 0.5);
        line-height: 1;
      }
    `;
    document.head.appendChild(style);
  }
}
