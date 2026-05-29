import { playSoundEffect } from "../sfx.js";

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
  private activeIds = new Set<string>();

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
      const keyHint = btn.key ? ` <kbd class="ab-tt-key">${btn.key}</kbd>` : "";
      html += `<button class="ab-btn" data-id="${btn.id}">`;
      html += `<span class="ab-icon">${btn.icon}</span>`;
      html += `<span class="ab-key">${btn.key}</span>`;
      html += `<span class="ab-badge" data-id="${btn.id}" hidden></span>`;
      html += `<span class="ab-tooltip">${btn.label}${keyHint}</span>`;
      html += `</button>`;
    }
    this.container.innerHTML = html;

    // Attach click handlers
    this.container.querySelectorAll(".ab-btn").forEach((el) => {
      const id = (el as HTMLElement).dataset.id;
      const btn = this.buttons.find((b) => b.id === id);
      if (id) {
        el.classList.toggle("active", this.activeIds.has(id));
      }
      if (btn) {
        el.addEventListener("click", () => {
          playSoundEffect("ui_button_click");
          btn.onClick();
        });
      }
    });
  }

  /** Show a red count badge on a button; pass 0 to hide. */
  setBadge(id: string, count: number) {
    const badge = this.container.querySelector<HTMLElement>(`.ab-badge[data-id="${id}"]`);
    if (!badge) return;
    if (count <= 0) {
      badge.hidden = true;
      badge.textContent = "";
    } else {
      badge.hidden = false;
      badge.textContent = count > 99 ? "99+" : String(count);
    }
  }

  /** Play a brief pulse ring on a button to draw attention. */
  pulse(id: string) {
    const btn = this.container.querySelector<HTMLElement>(`.ab-btn[data-id="${id}"]`);
    if (!btn) return;
    btn.classList.remove("ab-pulse");
    void btn.offsetWidth;
    btn.classList.add("ab-pulse");
  }

  setActive(id: string, active: boolean) {
    if (active) this.activeIds.add(id);
    else this.activeIds.delete(id);
    const btn = this.container.querySelector<HTMLElement>(`.ab-btn[data-id="${id}"]`);
    if (!btn) return;
    btn.classList.toggle("active", active);
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      /* --wog-ab-reserve is the vertical "safe zone" the action bar occupies
         at the bottom of the viewport (button height + bottom gap + iOS
         home-indicator inset). HUD bottom-sheets read this so they stop
         above the icons instead of bleeding into them. Defined here because
         the action bar is the authority on its own height. */
      :root { --wog-ab-reserve: 0px; }

      #action-bar {
        position: fixed;
        bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        right: 12px;
        display: flex;
        gap: 4px;
        z-index: 18;
        pointer-events: auto;
        max-width: calc(100vw - 16px);
        flex-wrap: nowrap;
        justify-content: flex-end;
      }

      /* Single-row layout on phones — buttons shrink so all icons stay
         visible without wrapping. Sized so 8 buttons fit in 360px CSS.
         Keep the breakpoints ordered largest→smallest so the narrowest
         --wog-ab-reserve wins where multiple queries match. */
      @media (max-width: 600px) {
        :root { --wog-ab-reserve: calc(38px + 20px + env(safe-area-inset-bottom, 0px)); }
        #action-bar { gap: 3px; right: 8px; max-width: calc(100vw - 12px); }
        .ab-btn { width: 38px !important; height: 38px !important; }
        .ab-icon { font-size: 17px !important; }
        .ab-key { display: none; }
      }
      @media (max-width: 480px) {
        :root { --wog-ab-reserve: calc(34px + 18px + env(safe-area-inset-bottom, 0px)); }
        #action-bar { gap: 2px; right: 6px; max-width: calc(100vw - 8px); }
        .ab-btn { width: 34px !important; height: 34px !important; border-radius: 5px; }
        .ab-icon { font-size: 15px !important; }
      }
      @media (max-width: 380px) {
        :root { --wog-ab-reserve: calc(30px + 16px + env(safe-area-inset-bottom, 0px)); }
        #action-bar { gap: 2px; right: 4px; max-width: calc(100vw - 4px); }
        .ab-btn { width: 30px !important; height: 30px !important; border-radius: 4px; }
        .ab-icon { font-size: 13px !important; }
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
      .ab-btn.active {
        background: rgba(30, 74, 56, 0.95);
        border-color: rgba(68, 255, 136, 0.92);
        box-shadow: inset 0 0 0 1px rgba(68, 255, 136, 0.35), 0 0 0 1px rgba(68, 255, 136, 0.25);
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

      .ab-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        background: #e33;
        color: #fff;
        border-radius: 8px;
        font: bold 10px/16px monospace;
        text-align: center;
        pointer-events: none;
        box-shadow: 0 0 0 2px rgba(10, 16, 28, 0.95);
      }

      .ab-btn.ab-pulse {
        animation: ab-pulse 0.65s ease-out;
      }
      @keyframes ab-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(255, 80, 80, 0.75); }
        100% { box-shadow: 0 0 0 16px rgba(255, 80, 80, 0); }
      }

      .ab-tooltip {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
        background: rgba(8, 14, 24, 0.97);
        border: 1px solid rgba(68, 255, 136, 0.28);
        border-radius: 6px;
        padding: 5px 9px;
        white-space: nowrap;
        font: 11px/1.4 monospace;
        color: #c8d8e8;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.14s ease, transform 0.14s ease;
        z-index: 19;
        box-shadow: 0 2px 12px rgba(0,0,0,0.55);
      }
      /* small arrow pointing down */
      .ab-tooltip::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: rgba(68, 255, 136, 0.28);
      }
      .ab-btn:hover .ab-tooltip {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      /* hide on mobile — touch users can't hover */
      @media (max-width: 600px) {
        .ab-tooltip { display: none; }
      }

      .ab-tt-key {
        display: inline-block;
        background: rgba(68, 255, 136, 0.1);
        border: 1px solid rgba(68, 255, 136, 0.3);
        border-radius: 3px;
        padding: 0 4px;
        font: bold 9px/15px monospace;
        color: rgba(68, 255, 136, 0.85);
        margin-left: 5px;
        vertical-align: middle;
      }
    `;
    document.head.appendChild(style);
  }
}
