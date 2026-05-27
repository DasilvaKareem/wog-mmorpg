import {
  isSoundEffectsEnabled,
  setSoundEffectsEnabled,
  getSoundEffectMasterVolume,
  setSoundEffectMasterVolume,
  playSoundEffect,
} from "../sfx.js";
import { QualityManager } from "../quality/QualityManager.js";
import { TIER_CONFIGS, TIER_LABELS, TIER_ORDER, type Tier } from "../quality/tierConfig.js";
import { postBugReport, type BugReportPayload } from "../api.js";
import { getRecentErrors } from "../utils/errorBuffer.js";
import { playerSession } from "../state/PlayerSession.js";

type TabId = "audio" | "graphics" | "bug";

type BugCategory = BugReportPayload["category"];
const BUG_CATEGORIES: Array<{ id: BugCategory; label: string }> = [
  { id: "gameplay", label: "Gameplay" },
  { id: "visual", label: "Visual / Graphics" },
  { id: "performance", label: "Performance" },
  { id: "crash", label: "Crash / Freeze" },
  { id: "other", label: "Other" },
];

const TITLE_MAX = 80;
const DESC_MAX = 1000;

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
      { id: "graphics", label: "Graphics" },
      { id: "bug", label: "Bug Report" },
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
    else if (this.activeTab === "graphics") this.renderGraphicsTab();
    else if (this.activeTab === "bug") this.renderBugTab();
  }

  private renderGraphicsTab() {
    const detected = QualityManager.detectedTier();
    const current = QualityManager.current();
    const stored = (() => {
      try { return localStorage.getItem("wog-quality-tier") ?? ""; } catch { return ""; }
    })();

    const section = document.createElement("section");
    section.className = "settings-section";
    section.innerHTML = `<h3>Quality Tier</h3>`;

    const detectedRow = document.createElement("div");
    detectedRow.className = "settings-row";
    detectedRow.innerHTML = `<span class="settings-slider-label">Detected</span><span style="color:#9ab">${TIER_LABELS[detected]}</span>`;
    section.appendChild(detectedRow);

    const selectRow = document.createElement("label");
    selectRow.className = "settings-row settings-row-slider";
    const selectLabel = document.createElement("span");
    selectLabel.className = "settings-slider-label";
    selectLabel.textContent = "Tier";
    const select = document.createElement("select");
    select.className = "settings-select";
    const autoOpt = document.createElement("option");
    autoOpt.value = "";
    autoOpt.textContent = `Auto (${TIER_LABELS[detected]})`;
    select.appendChild(autoOpt);
    for (const tier of TIER_ORDER) {
      const opt = document.createElement("option");
      opt.value = tier;
      opt.textContent = TIER_LABELS[tier];
      select.appendChild(opt);
    }
    select.value = stored;
    selectRow.appendChild(selectLabel);
    selectRow.appendChild(select);
    section.appendChild(selectRow);

    const note = document.createElement("div");
    note.className = "settings-graphics-note";
    note.textContent =
      "Some changes require reloading the page (antialias, asset preloads). DPR, render scale, and polling cadence update immediately.";
    section.appendChild(note);

    const reloadBtn = document.createElement("button");
    reloadBtn.className = "settings-reload-btn";
    reloadBtn.textContent = "Reload now";
    reloadBtn.style.display = "none";
    reloadBtn.addEventListener("click", () => window.location.reload());
    section.appendChild(reloadBtn);

    // Compare a target tier's config against what the renderer was built
    // with — antialias and asset-preload decisions need a reload to apply.
    const bootCfg = TIER_CONFIGS[current];
    const needsReload = (next: Tier) => {
      const target = TIER_CONFIGS[next];
      return (
        target.antialias !== bootCfg.antialias ||
        target.preloadTown !== bootCfg.preloadTown ||
        target.npcDeferMs !== bootCfg.npcDeferMs ||
        target.preloadPlayerClassesAtBoot !== bootCfg.preloadPlayerClassesAtBoot
      );
    };

    select.addEventListener("change", () => {
      const value = select.value;
      const next: Tier | null = value === "" ? null : (value as Tier);
      QualityManager.setOverride(next);
      const resolved = next ?? detected;
      reloadBtn.style.display = needsReload(resolved) ? "" : "none";
      playSoundEffect("ui_tab_switch");
    });

    this.body.appendChild(section);
  }

  private renderBugTab() {
    const section = document.createElement("section");
    section.className = "settings-section";
    section.innerHTML = `<h3>Report a Bug</h3>`;

    const catRow = document.createElement("label");
    catRow.className = "settings-row settings-row-slider";
    const catLabel = document.createElement("span");
    catLabel.className = "settings-slider-label";
    catLabel.textContent = "Category";
    const catSelect = document.createElement("select");
    catSelect.className = "settings-select";
    for (const c of BUG_CATEGORIES) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label;
      catSelect.appendChild(opt);
    }
    catRow.appendChild(catLabel);
    catRow.appendChild(catSelect);
    section.appendChild(catRow);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "settings-input";
    titleInput.maxLength = TITLE_MAX;
    titleInput.placeholder = "Short title (e.g. Quest reward not credited)";
    section.appendChild(this.fieldWrap("Title", titleInput));

    const descInput = document.createElement("textarea");
    descInput.className = "settings-textarea";
    descInput.maxLength = DESC_MAX;
    descInput.rows = 5;
    descInput.placeholder = "What happened? Steps to reproduce, what you expected, what you saw.";
    section.appendChild(this.fieldWrap("Details", descInput));

    const counter = document.createElement("div");
    counter.className = "settings-counter";
    counter.textContent = `0 / ${DESC_MAX}`;
    descInput.addEventListener("input", () => {
      counter.textContent = `${descInput.value.length} / ${DESC_MAX}`;
    });
    section.appendChild(counter);

    const note = document.createElement("div");
    note.className = "settings-graphics-note";
    note.textContent = "We auto-attach your character, zone, browser info, and recent errors.";
    section.appendChild(note);

    const status = document.createElement("div");
    status.className = "settings-bug-status";
    section.appendChild(status);

    const submit = document.createElement("button");
    submit.className = "settings-reload-btn";
    submit.textContent = "Submit report";
    submit.addEventListener("click", async () => {
      const title = titleInput.value.trim();
      const description = descInput.value.trim();
      if (!title) { status.textContent = "Please enter a title."; status.className = "settings-bug-status err"; return; }
      if (!description) { status.textContent = "Please describe what happened."; status.className = "settings-bug-status err"; return; }

      submit.disabled = true;
      status.textContent = "Sending…";
      status.className = "settings-bug-status";

      const payload: BugReportPayload = {
        category: catSelect.value as BugCategory,
        title,
        description,
        context: this.collectBugContext(),
      };
      const result = await postBugReport(payload);
      submit.disabled = false;

      if (result.ok) {
        status.textContent = `✓ Thanks — ref ${result.id ?? "received"}`;
        status.className = "settings-bug-status ok";
        titleInput.value = "";
        descInput.value = "";
        counter.textContent = `0 / ${DESC_MAX}`;
        playSoundEffect("ui_tab_switch");
      } else {
        status.textContent = `✗ ${result.error ?? "Failed to send"}`;
        status.className = "settings-bug-status err";
      }
    });
    section.appendChild(submit);

    this.body.appendChild(section);
  }

  private fieldWrap(label: string, input: HTMLElement): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "settings-field";
    const text = document.createElement("span");
    text.className = "settings-field-label";
    text.textContent = label;
    wrap.appendChild(text);
    wrap.appendChild(input);
    return wrap;
  }

  private collectBugContext(): BugReportPayload["context"] {
    const buildSha = (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? "";
    return {
      walletAddress: playerSession.wallet ?? undefined,
      characterId: playerSession.entityId ?? undefined,
      zoneId: playerSession.zoneId ?? undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      screen: `${window.innerWidth}x${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      qualityTier: String(QualityManager.current()),
      clientVersion: buildSha || undefined,
      recentErrors: getRecentErrors(),
    };
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
      .settings-select {
        flex: 1;
        background: rgba(10, 16, 28, 0.8);
        color: #ccc;
        border: 1px solid rgba(255, 194, 79, 0.3);
        border-radius: 4px;
        padding: 4px 8px;
        font: 12px monospace;
        cursor: pointer;
      }
      .settings-graphics-note {
        margin-top: 8px;
        padding: 6px 8px;
        background: rgba(255, 194, 79, 0.08);
        border: 1px solid rgba(255, 194, 79, 0.2);
        border-radius: 4px;
        color: #d4b370;
        font-size: 11px;
        line-height: 1.4;
      }
      .settings-reload-btn {
        margin-top: 8px;
        width: 100%;
        background: rgba(255, 194, 79, 0.2);
        border: 1px solid #ffc24f;
        color: #ffc24f;
        padding: 6px 10px;
        font: bold 11px monospace;
        letter-spacing: 0.5px;
        cursor: pointer;
        border-radius: 4px;
      }
      .settings-reload-btn:hover {
        background: rgba(255, 194, 79, 0.35);
      }
      .settings-reload-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .settings-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 0;
      }
      .settings-field-label {
        color: #9ab;
        font: bold 11px monospace;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .settings-input,
      .settings-textarea {
        background: rgba(10, 16, 28, 0.8);
        color: #ddd;
        border: 1px solid rgba(255, 194, 79, 0.3);
        border-radius: 4px;
        padding: 6px 8px;
        font: 12px monospace;
        width: 100%;
        box-sizing: border-box;
      }
      .settings-textarea {
        resize: vertical;
        min-height: 80px;
        line-height: 1.4;
      }
      .settings-input:focus,
      .settings-textarea:focus {
        outline: none;
        border-color: #ffc24f;
      }
      .settings-counter {
        text-align: right;
        color: #667;
        font-size: 10px;
        margin-top: 2px;
      }
      .settings-bug-status {
        margin-top: 8px;
        padding: 4px 0;
        min-height: 16px;
        font-size: 11px;
        color: #9ab;
      }
      .settings-bug-status.ok { color: #6dcf6d; }
      .settings-bug-status.err { color: #f88; }
    `;
    document.head.appendChild(style);
  }
}
