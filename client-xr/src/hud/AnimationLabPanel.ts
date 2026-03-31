import type {
  AnimationLab,
  AnimationLabCameraPreset,
  AnimationLabState,
  PreviewArmorStyle,
  PreviewWeaponType,
  RigTuning,
  PreviewRace,
  PreviewClass,
  PreviewHair,
  PreviewSkin,
} from "../scene/AnimationLab.js";
import { DEFAULT_RIG_TUNING } from "../scene/AnimationLab.js";

const RACE_OPTIONS: PreviewRace[] = ["human", "elf", "dwarf", "beastkin"];
const CLASS_OPTIONS: PreviewClass[] = ["warrior", "mage", "cleric", "ranger", "rogue", "warlock", "paladin", "monk"];
const HAIR_OPTIONS: PreviewHair[] = ["short", "long", "mohawk", "ponytail", "braided", "afro", "bald"];
const SKIN_OPTIONS: PreviewSkin[] = ["light", "medium", "tan", "brown", "dark"];

const CAMERA_PRESETS: AnimationLabCameraPreset[] = ["front", "side", "three-quarter"];
const WEAPON_OPTIONS: PreviewWeaponType[] = ["none", "sword", "axe", "mace", "dagger", "staff", "bow", "pickaxe", "sickle"];
const ARMOR_OPTIONS: PreviewArmorStyle[] = ["none", "plate", "chain", "leather"];

export class AnimationLabPanel {
  private root: HTMLDivElement;
  private clipSelect!: HTMLSelectElement;
  private playBtn!: HTMLButtonElement;
  private timeSlider!: HTMLInputElement;
  private timeLabel!: HTMLSpanElement;
  private speedSlider!: HTMLInputElement;
  private speedLabel!: HTMLSpanElement;
  private loopToggle!: HTMLInputElement;
  private skeletonToggle!: HTMLInputElement;
  private weaponSelect!: HTMLSelectElement;
  private shieldToggle!: HTMLInputElement;
  private helmSelect!: HTMLSelectElement;
  private shouldersSelect!: HTMLSelectElement;
  private beltSelect!: HTMLSelectElement;
  private bootsSelect!: HTMLSelectElement;
  private cameraButtons = new Map<AnimationLabCameraPreset, HTMLButtonElement>();
  private keyTimesWrap!: HTMLDivElement;
  private suppressSlider = false;
  private rigSliders = new Map<keyof RigTuning, { slider: HTMLInputElement; label: HTMLSpanElement }>();

  constructor(
    private lab: AnimationLab,
    private camera: { applyPreset: (preset: AnimationLabCameraPreset) => void },
  ) {
    this.root = document.createElement("div");
    this.root.id = "animation-lab-panel";
    this.root.style.cssText = `
      position: fixed;
      top: 12px;
      right: 12px;
      width: 380px;
      max-height: calc(100vh - 24px);
      overflow-y: auto;
      padding: 12px;
      background: rgba(15, 12, 9, 0.94);
      border: 1px solid rgba(155, 123, 88, 0.85);
      border-radius: 10px;
      color: #f3e7d2;
      font: 12px monospace;
      z-index: 9999;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.32);
    `;
    document.body.appendChild(this.root);
    this.renderShell();
    this.bind();
    this.lab.onChange((state) => this.sync(state));
  }

  dispose() {
    this.root.remove();
  }

  private renderShell() {
    const clipOptions = this.lab.getClipNames()
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");
    const weaponOptions = WEAPON_OPTIONS
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");
    const armorOptions = ARMOR_OPTIONS
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");

    this.root.innerHTML = `
      <div style="font-size:15px;color:#f6d39b;margin-bottom:10px;font-weight:bold">Animation Lab</div>
      <div style="color:#bba78a;margin-bottom:12px">Open with <code>?animlab=1</code>. Press <code>P</code> for live weapon and armor socket tuning while you scrub.</div>

      <label style="display:block;margin-bottom:10px">
        <div style="margin-bottom:4px;color:#cab394">Clip</div>
        <select id="al-clip" style="${this.selectCss()}">${clipOptions}</select>
      </label>

      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button id="al-play" style="${this.buttonCss("#7c5a2f")}">Pause</button>
        <label style="display:flex;align-items:center;gap:6px"><input id="al-loop" type="checkbox" checked> Loop</label>
        <label style="display:flex;align-items:center;gap:6px"><input id="al-skel" type="checkbox"> Skeleton</label>
      </div>

      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:#cab394">Time</span>
          <span id="al-time-label">0.000 / 0.000</span>
        </div>
        <input id="al-time" type="range" min="0" max="1" step="0.001" value="0" style="width:100%;accent-color:#d7a45a">
      </div>

      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:#cab394">Speed</span>
          <span id="al-speed-label">1.00x</span>
        </div>
        <input id="al-speed" type="range" min="0.05" max="2" step="0.05" value="1" style="width:100%;accent-color:#84c6ff">
      </div>

      <div style="margin-bottom:12px">
        <div style="margin-bottom:6px;color:#cab394">Equipment Preview</div>
        <label style="display:block;margin-bottom:8px">
          <div style="margin-bottom:4px;color:#a89275">Weapon</div>
          <select id="al-weapon" style="${this.selectCss()}">${weaponOptions}</select>
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><input id="al-shield" type="checkbox"> Shield</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label>
            <div style="margin-bottom:4px;color:#a89275">Helm</div>
            <select id="al-helm" style="${this.selectCss()}">${armorOptions}</select>
          </label>
          <label>
            <div style="margin-bottom:4px;color:#a89275">Shoulders</div>
            <select id="al-shoulders" style="${this.selectCss()}">${armorOptions}</select>
          </label>
          <label>
            <div style="margin-bottom:4px;color:#a89275">Belt</div>
            <select id="al-belt" style="${this.selectCss()}">${armorOptions}</select>
          </label>
          <label>
            <div style="margin-bottom:4px;color:#a89275">Boots</div>
            <select id="al-boots" style="${this.selectCss()}">${armorOptions}</select>
          </label>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="margin-bottom:6px;color:#cab394">Character</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label>
            <div style="margin-bottom:4px;color:#a89275">Race</div>
            <select id="al-race" style="${this.selectCss()}">${RACE_OPTIONS.map(r => `<option value="${r}">${r}</option>`).join("")}</select>
          </label>
          <label>
            <div style="margin-bottom:4px;color:#a89275">Class</div>
            <select id="al-class" style="${this.selectCss()}">${CLASS_OPTIONS.map(c => `<option value="${c}">${c}</option>`).join("")}</select>
          </label>
          <label>
            <div style="margin-bottom:4px;color:#a89275">Hair</div>
            <select id="al-hair" style="${this.selectCss()}">${HAIR_OPTIONS.map(h => `<option value="${h}">${h}</option>`).join("")}</select>
          </label>
          <label>
            <div style="margin-bottom:4px;color:#a89275">Skin</div>
            <select id="al-skin" style="${this.selectCss()}">${SKIN_OPTIONS.map(s => `<option value="${s}">${s}</option>`).join("")}</select>
          </label>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="margin-bottom:6px;color:#cab394;cursor:pointer" id="al-rig-toggle">Rig Tuning &#9660;</div>
        <div id="al-rig-section" style="display:none">
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><input id="al-female" type="checkbox"> Female</label>
          <div id="al-rig-sliders"></div>
          <button id="al-rig-reset" style="${this.buttonCss("#4a2a2a")}; margin-top:6px">Reset Defaults</button>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="margin-bottom:6px;color:#cab394">Camera</div>
        <div id="al-camera-wrap" style="display:flex;gap:6px"></div>
      </div>

      <div>
        <div style="margin-bottom:6px;color:#cab394">Key Times</div>
        <div id="al-key-times" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      </div>
    `;

    this.clipSelect = this.root.querySelector("#al-clip") as HTMLSelectElement;
    this.playBtn = this.root.querySelector("#al-play") as HTMLButtonElement;
    this.timeSlider = this.root.querySelector("#al-time") as HTMLInputElement;
    this.timeLabel = this.root.querySelector("#al-time-label") as HTMLSpanElement;
    this.speedSlider = this.root.querySelector("#al-speed") as HTMLInputElement;
    this.speedLabel = this.root.querySelector("#al-speed-label") as HTMLSpanElement;
    this.loopToggle = this.root.querySelector("#al-loop") as HTMLInputElement;
    this.skeletonToggle = this.root.querySelector("#al-skel") as HTMLInputElement;
    this.weaponSelect = this.root.querySelector("#al-weapon") as HTMLSelectElement;
    this.shieldToggle = this.root.querySelector("#al-shield") as HTMLInputElement;
    this.helmSelect = this.root.querySelector("#al-helm") as HTMLSelectElement;
    this.shouldersSelect = this.root.querySelector("#al-shoulders") as HTMLSelectElement;
    this.beltSelect = this.root.querySelector("#al-belt") as HTMLSelectElement;
    this.bootsSelect = this.root.querySelector("#al-boots") as HTMLSelectElement;
    this.keyTimesWrap = this.root.querySelector("#al-key-times") as HTMLDivElement;

    const cameraWrap = this.root.querySelector("#al-camera-wrap") as HTMLDivElement;
    for (const preset of CAMERA_PRESETS) {
      const button = document.createElement("button");
      button.textContent = preset;
      button.style.cssText = this.buttonCss("#32424f");
      button.addEventListener("click", () => this.camera.applyPreset(preset));
      cameraWrap.appendChild(button);
      this.cameraButtons.set(preset, button);
    }

    // Rig tuning section
    const rigToggle = this.root.querySelector("#al-rig-toggle") as HTMLDivElement;
    const rigSection = this.root.querySelector("#al-rig-section") as HTMLDivElement;
    rigToggle.addEventListener("click", () => {
      const open = rigSection.style.display === "none";
      rigSection.style.display = open ? "block" : "none";
      rigToggle.innerHTML = `Rig Tuning ${open ? "&#9650;" : "&#9660;"}`;
    });

    const sliderDefs: { key: keyof RigTuning; label: string; min: number; max: number; step: number }[] = [
      { key: "scale",         label: "Scale",          min: 0.5, max: 2.0,  step: 0.05 },
      { key: "shoulderWidth", label: "Shoulder Width",  min: 0.1, max: 0.6,  step: 0.01 },
      { key: "hipWidth",      label: "Hip Width",       min: 0.05, max: 0.4, step: 0.01 },
      { key: "torsoHeight",   label: "Torso Height",    min: 0.4, max: 1.2,  step: 0.02 },
      { key: "legLength",     label: "Leg Length",       min: 0.2, max: 0.8,  step: 0.02 },
      { key: "armLength",     label: "Arm Length",       min: 0.2, max: 0.8,  step: 0.02 },
    ];

    const rigSlidersWrap = this.root.querySelector("#al-rig-sliders") as HTMLDivElement;
    for (const def of sliderDefs) {
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom:8px";
      const header = document.createElement("div");
      header.style.cssText = "display:flex;justify-content:space-between;margin-bottom:2px";
      const nameSpan = document.createElement("span");
      nameSpan.style.color = "#a89275";
      nameSpan.textContent = def.label;
      const valSpan = document.createElement("span");
      valSpan.textContent = String(DEFAULT_RIG_TUNING[def.key]);
      header.appendChild(nameSpan);
      header.appendChild(valSpan);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(def.min);
      slider.max = String(def.max);
      slider.step = String(def.step);
      slider.value = String(DEFAULT_RIG_TUNING[def.key]);
      slider.style.cssText = "width:100%;accent-color:#d7a45a";
      row.appendChild(header);
      row.appendChild(slider);
      rigSlidersWrap.appendChild(row);
      this.rigSliders.set(def.key, { slider, label: valSpan });
    }
  }

  private bind() {
    this.clipSelect.addEventListener("change", () => {
      this.lab.setClip(this.clipSelect.value);
    });

    this.playBtn.addEventListener("click", () => {
      const next = this.playBtn.dataset.state !== "playing";
      this.lab.setPlaying(next);
    });

    this.timeSlider.addEventListener("input", () => {
      if (this.suppressSlider) return;
      this.lab.setTime(parseFloat(this.timeSlider.value));
    });

    this.speedSlider.addEventListener("input", () => {
      this.lab.setSpeed(parseFloat(this.speedSlider.value));
    });

    this.loopToggle.addEventListener("change", () => {
      this.lab.setLoop(this.loopToggle.checked);
    });

    this.skeletonToggle.addEventListener("change", () => {
      this.lab.setShowSkeleton(this.skeletonToggle.checked);
    });

    this.weaponSelect.addEventListener("change", () => {
      this.lab.setWeaponType(this.weaponSelect.value as PreviewWeaponType);
    });

    this.shieldToggle.addEventListener("change", () => {
      this.lab.setShieldEquipped(this.shieldToggle.checked);
    });

    this.helmSelect.addEventListener("change", () => {
      this.lab.setArmorStyle("helm", this.helmSelect.value as PreviewArmorStyle);
    });

    this.shouldersSelect.addEventListener("change", () => {
      this.lab.setArmorStyle("shoulders", this.shouldersSelect.value as PreviewArmorStyle);
    });

    this.beltSelect.addEventListener("change", () => {
      this.lab.setArmorStyle("belt", this.beltSelect.value as PreviewArmorStyle);
    });

    this.bootsSelect.addEventListener("change", () => {
      this.lab.setArmorStyle("boots", this.bootsSelect.value as PreviewArmorStyle);
    });

    // Rig tuning events
    const femaleToggle = this.root.querySelector("#al-female") as HTMLInputElement;
    femaleToggle.addEventListener("change", () => {
      this.lab.setRigTuning({ isFemale: femaleToggle.checked });
    });

    for (const [key, { slider, label }] of this.rigSliders) {
      slider.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        label.textContent = val.toFixed(2);
        this.lab.setRigTuning({ [key]: val });
      });
    }

    const resetBtn = this.root.querySelector("#al-rig-reset") as HTMLButtonElement;
    resetBtn.addEventListener("click", () => {
      this.lab.setRigTuning({ ...DEFAULT_RIG_TUNING });
    });

    // Character appearance events
    const raceSelect = this.root.querySelector("#al-race") as HTMLSelectElement;
    raceSelect.addEventListener("change", () => this.lab.setAppearance({ race: raceSelect.value as PreviewRace }));
    const classSelect = this.root.querySelector("#al-class") as HTMLSelectElement;
    classSelect.addEventListener("change", () => this.lab.setAppearance({ classId: classSelect.value as PreviewClass }));
    const hairSelect = this.root.querySelector("#al-hair") as HTMLSelectElement;
    hairSelect.addEventListener("change", () => this.lab.setAppearance({ hairStyle: hairSelect.value as PreviewHair }));
    const skinSelect = this.root.querySelector("#al-skin") as HTMLSelectElement;
    skinSelect.addEventListener("change", () => this.lab.setAppearance({ skinColor: skinSelect.value as PreviewSkin }));
  }

  private sync(state: AnimationLabState) {
    this.clipSelect.value = state.clipName;
    this.playBtn.textContent = state.playing ? "Pause" : "Play";
    this.playBtn.dataset.state = state.playing ? "playing" : "paused";
    this.loopToggle.checked = state.loop;
    this.skeletonToggle.checked = state.showSkeleton;
    this.weaponSelect.value = state.weaponType;
    this.shieldToggle.checked = state.shieldEquipped;
    this.helmSelect.value = state.helmStyle;
    this.shouldersSelect.value = state.shoulderStyle;
    this.beltSelect.value = state.beltStyle;
    this.bootsSelect.value = state.bootStyle;
    this.speedSlider.value = state.speed.toFixed(2);
    this.speedLabel.textContent = `${state.speed.toFixed(2)}x`;
    this.timeSlider.max = state.duration.toFixed(3);
    this.timeSlider.step = Math.max(state.duration / 500, 0.001).toFixed(3);
    this.suppressSlider = true;
    this.timeSlider.value = state.time.toFixed(3);
    this.suppressSlider = false;
    this.timeLabel.textContent = `${state.time.toFixed(3)} / ${state.duration.toFixed(3)}`;

    for (const [preset, button] of this.cameraButtons) {
      button.style.opacity = preset === state.cameraPreset ? "1" : "0.7";
      button.style.borderColor = preset === state.cameraPreset ? "#f6d39b" : "rgba(255,255,255,0.18)";
    }

    // Sync appearance selectors
    const raceSelect = this.root.querySelector("#al-race") as HTMLSelectElement | null;
    if (raceSelect) raceSelect.value = state.appearance.race;
    const classSelect = this.root.querySelector("#al-class") as HTMLSelectElement | null;
    if (classSelect) classSelect.value = state.appearance.classId;
    const hairSelect = this.root.querySelector("#al-hair") as HTMLSelectElement | null;
    if (hairSelect) hairSelect.value = state.appearance.hairStyle;
    const skinSelect = this.root.querySelector("#al-skin") as HTMLSelectElement | null;
    if (skinSelect) skinSelect.value = state.appearance.skinColor;

    // Sync rig tuning sliders
    const femaleToggle = this.root.querySelector("#al-female") as HTMLInputElement | null;
    if (femaleToggle) femaleToggle.checked = state.rigTuning.isFemale;
    for (const [key, { slider, label }] of this.rigSliders) {
      const val = state.rigTuning[key];
      if (typeof val === "number") {
        slider.value = val.toFixed(3);
        label.textContent = val.toFixed(2);
      }
    }

    this.renderKeyTimes(state.keyTimes, state.time);
  }

  private renderKeyTimes(times: number[], activeTime: number) {
    this.keyTimesWrap.innerHTML = "";
    for (const time of times) {
      const button = document.createElement("button");
      button.textContent = time.toFixed(3);
      const isActive = Math.abs(time - activeTime) < 0.0005;
      button.style.cssText = this.buttonCss(isActive ? "#7d6a47" : "#2f2821");
      button.style.padding = "4px 6px";
      button.addEventListener("click", () => this.lab.jumpToKeyTime(time));
      this.keyTimesWrap.appendChild(button);
    }
  }

  private buttonCss(background: string): string {
    return `
      background:${background};
      color:#f3e7d2;
      border:1px solid rgba(255,255,255,0.18);
      border-radius:6px;
      padding:6px 10px;
      font:12px monospace;
      cursor:pointer;
    `;
  }

  private selectCss(): string {
    return "width:100%;background:#211a14;color:#f3e7d2;border:1px solid #695741;padding:6px;font:12px monospace";
  }
}
