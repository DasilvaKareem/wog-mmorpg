import {
  isSoundEffectsEnabled,
  setSoundEffectsEnabled,
  getSoundEffectMasterVolume,
  setSoundEffectMasterVolume,
  playSoundEffect,
} from "../sfx.js";

type TabId = "audio";

const MUSIC_MUTED_KEY = "wog-music-muted";
const MUSIC_VOLUME_KEY = "wog-music-volume";

function isMusicMuted(): boolean {
  try { return localStorage.getItem(MUSIC_MUTED_KEY) === "1"; } catch { return false; }
}

function setMusicMuted(muted: boolean): void {
  try { localStorage.setItem(MUSIC_MUTED_KEY, muted ? "1" : "0"); } catch {}
  window.dispatchEvent(new CustomEvent("wog:music-toggle", { detail: { muted } }));
}

function getMusicVolume(): number {
  try {
    const raw = localStorage.getItem(MUSIC_VOLUME_KEY);
    if (raw === null) return 0.35;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0.35;
    return Math.min(1, Math.max(0, n));
  } catch { return 0.35; }
}

function setMusicVolume(v: number): void {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.35));
  try { localStorage.setItem(MUSIC_VOLUME_KEY, String(clamped)); } catch {}
  window.dispatchEvent(new CustomEvent("wog:music-volume", { detail: { volume: clamped } }));
}

export class SettingsPanel {
  private container: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private body: HTMLDivElement;
  private activeTab: TabId = "audio";

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "settings-panel";
    this.container.style.display = "none";

    const header = document.createElement("div");
    header.className = "settings-header";
    header.innerHTML = `<span class="settings-title">Settings</span><button class="settings-close" aria-label="Close">×</button>`;
    this.container.appendChild(header);

    this.tabBar = document.createElement("div");
    this.tabBar.className = "settings-tabs";
    this.container.appendChild(this.tabBar);

    this.body = document.createElement("div");
    this.body.className = "settings-body";
    this.container.appendChild(this.body);

    document.body.appendChild(this.container);
    this.injectStyles();

    (header.querySelector(".settings-close") as HTMLButtonElement).addEventListener("click", () => this.hide());

    this.buildTabs();
    this.renderActive();
  }

  toggle() {
    if (this.container.style.display === "none") this.show();
    else this.hide();
  }

  show() {
    this.container.style.display = "flex";
    this.renderActive();
    playSoundEffect("ui_dialog_open");
  }

  hide() {
    this.container.style.display = "none";
    playSoundEffect("ui_dialog_close");
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  private buildTabs() {
    const tabs: Array<{ id: TabId; label: string }> = [
      { id: "audio", label: "Audio" },
    ];
    this.tabBar.innerHTML = "";
    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.className = "settings-tab";
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      btn.addEventListener("click", () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        this.renderActive();
        playSoundEffect("ui_tab_switch");
      });
      this.tabBar.appendChild(btn);
    }
  }

  private renderActive() {
    for (const b of this.tabBar.querySelectorAll<HTMLButtonElement>(".settings-tab")) {
      b.classList.toggle("active", b.dataset.tab === this.activeTab);
    }
    this.body.innerHTML = "";
    if (this.activeTab === "audio") this.renderAudioTab();
  }

  private renderAudioTab() {
    const music = document.createElement("section");
    music.className = "settings-section";
    music.innerHTML = `<h3>Music</h3>`;
    music.appendChild(this.muteRow("Mute music", isMusicMuted(), (m) => setMusicMuted(m)));
    music.appendChild(this.volumeRow("Volume", getMusicVolume(), (v) => setMusicVolume(v)));

    const sfx = document.createElement("section");
    sfx.className = "settings-section";
    sfx.innerHTML = `<h3>Sound Effects</h3>`;
    sfx.appendChild(this.muteRow("Mute SFX", !isSoundEffectsEnabled(), (m) => setSoundEffectsEnabled(!m)));
    sfx.appendChild(this.volumeRow("Volume", getSoundEffectMasterVolume(), (v) => {
      setSoundEffectMasterVolume(v);
    }));

    this.body.appendChild(music);
    this.body.appendChild(sfx);
  }

  private muteRow(label: string, initial: boolean, onChange: (muted: boolean) => void): HTMLElement {
    const row = document.createElement("label");
    row.className = "settings-row settings-row-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = initial;
    cb.addEventListener("change", () => onChange(cb.checked));
    const text = document.createElement("span");
    text.textContent = label;
    row.appendChild(cb);
    row.appendChild(text);
    return row;
  }

  private volumeRow(label: string, initial: number, onChange: (v: number) => void): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row settings-row-slider";
    const labelEl = document.createElement("span");
    labelEl.className = "settings-slider-label";
    labelEl.textContent = label;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(Math.round(initial * 100));
    const readout = document.createElement("span");
    readout.className = "settings-slider-value";
    readout.textContent = `${slider.value}`;
    slider.addEventListener("input", () => {
      const v = Number(slider.value) / 100;
      readout.textContent = slider.value;
      onChange(v);
    });
    row.appendChild(labelEl);
    row.appendChild(slider);
    row.appendChild(readout);
    return row;
  }

  private injectStyles() {
    if (document.getElementById("settings-panel-styles")) return;
    const style = document.createElement("style");
    style.id = "settings-panel-styles";
    style.textContent = `
      #settings-panel {
        position: fixed;
        bottom: 64px;
        right: 12px;
        width: 300px;
        max-height: calc(100vh - 120px);
        background: rgba(10, 16, 28, 0.96);
        border: 1px solid rgba(255, 194, 79, 0.3);
        border-radius: 8px;
        z-index: 17;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }
      .settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255, 194, 79, 0.2);
      }
      .settings-title {
        color: #ffc24f;
        font-weight: bold;
        font-size: 13px;
        letter-spacing: 0.5px;
      }
      .settings-close {
        background: none;
        border: none;
        color: #888;
        font: 18px monospace;
        cursor: pointer;
        padding: 0 4px;
      }
      .settings-close:hover { color: #ddd; }
      .settings-tabs {
        display: flex;
        border-bottom: 1px solid rgba(255, 194, 79, 0.18);
      }
      .settings-tab {
        flex: 1;
        background: none;
        border: none;
        padding: 8px 4px;
        color: #667;
        cursor: pointer;
        font: 11px monospace;
        letter-spacing: 0.5px;
        border-bottom: 2px solid transparent;
      }
      .settings-tab.active {
        color: #ffc24f;
        border-bottom-color: #ffc24f;
      }
      .settings-tab:hover:not(.active) { color: #aaa; }
      .settings-body {
        flex: 1;
        overflow-y: auto;
        padding: 10px 12px;
      }
      .settings-section {
        margin-bottom: 16px;
      }
      .settings-section h3 {
        margin: 0 0 6px;
        color: #9ab;
        font: bold 11px monospace;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .settings-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
      }
      .settings-row-check { cursor: pointer; }
      .settings-row-check input { accent-color: #ffc24f; cursor: pointer; }
      .settings-row-slider { gap: 10px; }
      .settings-slider-label { flex: 0 0 60px; color: #bbb; }
      .settings-row-slider input[type="range"] {
        flex: 1;
        accent-color: #ffc24f;
      }
      .settings-slider-value {
        flex: 0 0 28px;
        text-align: right;
        color: #888;
        font-variant-numeric: tabular-nums;
      }
    `;
    document.head.appendChild(style);
  }
}
