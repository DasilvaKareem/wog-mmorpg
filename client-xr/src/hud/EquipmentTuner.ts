/**
 * In-game equipment position/rotation tuner.
 * Press P to toggle. Adjusts values live, prints final values to console.
 */

interface TunableSlot {
  label: string;
  pos: { x: number; y: number; z: number };
  rot: { x: number; y: number; z: number };
}

const SLOTS: Record<string, TunableSlot> = {
  sword:           { label: "Sword",          pos: { x: 0, y: 0, z: 0.1 },          rot: { x: 1.408, y: -0.192, z: 0.158 } },
  axe:             { label: "Axe",            pos: { x: -0.02, y: 0.14, z: 0.19 }, rot: { x: 0.808, y: -1.342, z: -0.142 } },
  staff:           { label: "Staff",          pos: { x: 0.05, y: 0.15, z: 0.12 },  rot: { x: 0.05, y: 0, z: 0.05 } },
  bow:             { label: "Bow",            pos: { x: 0.05, y: -0.1, z: 0.15 },  rot: { x: 0, y: 0.3, z: 0 } },
  dagger:          { label: "Dagger",         pos: { x: 0.03, y: -0.05, z: 0.1 },  rot: { x: 0.1, y: 0, z: -0.1 } },
  mace:            { label: "Mace",           pos: { x: 0.05, y: 0, z: 0.12 },     rot: { x: 0.1, y: 0, z: -0.1 } },
  pickaxe:         { label: "Pickaxe",        pos: { x: 0.05, y: 0.05, z: 0.12 },  rot: { x: 0.15, y: 0, z: -0.1 } },
  shield:          { label: "Shield",         pos: { x: -0.05, y: -0.05, z: 0.18 },rot: { x: 0, y: 0.3, z: 0 } },
  helmPlate:       { label: "Helm (Plate)",   pos: { x: 0, y: 0.08, z: 0 },        rot: { x: 0, y: 0, z: 0 } },
  helmChain:       { label: "Helm (Chain)",   pos: { x: 0, y: 0.06, z: 0 },        rot: { x: 0, y: 0, z: 0 } },
  helmLeather:     { label: "Helm (Leather)", pos: { x: 0, y: 0.1, z: 0 },         rot: { x: 0, y: 0, z: 0 } },
  shoulderPlate:   { label: "Shoulder (Plate)",pos: { x: 0, y: 0.05, z: 0 },       rot: { x: 0, y: 0, z: 0 } },
  shoulderChain:   { label: "Shoulder (Chain)",pos: { x: 0, y: 0.03, z: 0 },       rot: { x: 0, y: 0, z: 0 } },
  beltPlate:       { label: "Belt (Plate)",   pos: { x: 0, y: 0.02, z: 0 },       rot: { x: Math.PI / 2, y: 0, z: 0 } },
  beltLeather:     { label: "Belt (Leather)", pos: { x: 0, y: 0.02, z: 0 },       rot: { x: Math.PI / 2, y: 0, z: 0 } },
  bootPlate:       { label: "Boot (Plate)",   pos: { x: 0, y: -0.22, z: 0.02 },   rot: { x: 0, y: 0, z: 0 } },
  bootLeather:     { label: "Boot (Leather)", pos: { x: 0, y: -0.18, z: 0.01 },   rot: { x: 0, y: 0, z: 0 } },
};

export class EquipmentTuner {
  private el: HTMLDivElement;
  private visible = false;
  private activeSlot: string = "sword";
  private onChange?: (slot: string, pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number }) => void;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "equip-tuner";
    this.el.style.cssText = `
      position:fixed; top:10px; right:10px; width:320px; max-height:85vh; overflow-y:scroll;
      background:rgba(0,0,0,0.95); color:#eee; font:12px monospace; padding:12px;
      border:1px solid #4f8; border-radius:8px; z-index:9999; display:none;
      pointer-events:auto; user-select:none;
      scrollbar-width:thin; scrollbar-color:#4f8 #222;
    `;
    document.body.appendChild(this.el);

    window.addEventListener("keydown", (e) => {
      if (e.key === "p" || e.key === "P") {
        this.visible = !this.visible;
        this.el.style.display = this.visible ? "block" : "none";
        if (this.visible) this.render();
      }
    });
  }

  /** Set callback for when values change */
  setOnChange(fn: (slot: string, pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number }) => void) {
    this.onChange = fn;
  }

  /** Get current values for a slot */
  getSlot(name: string): TunableSlot | undefined {
    return SLOTS[name];
  }

  private render() {
    const slot = SLOTS[this.activeSlot];
    if (!slot) return;

    let html = `<div style="margin-bottom:8px;font-size:14px;color:#4f8;font-weight:bold">Equipment Tuner (P to close)</div>`;

    // Slot selector
    html += `<div style="margin-bottom:8px"><select id="et-slot" style="width:100%;background:#222;color:#eee;border:1px solid #555;padding:4px;font:12px monospace">`;
    for (const [key, s] of Object.entries(SLOTS)) {
      html += `<option value="${key}" ${key === this.activeSlot ? "selected" : ""}>${s.label}</option>`;
    }
    html += `</select></div>`;

    // Position sliders
    html += `<div style="color:#aaa;margin:6px 0 2px">Position</div>`;
    for (const axis of ["x", "y", "z"] as const) {
      const v = slot.pos[axis];
      html += this.sliderRow(`pos-${axis}`, axis.toUpperCase(), v, -0.5, 0.5, 0.01);
    }

    // Rotation sliders
    html += `<div style="color:#aaa;margin:6px 0 2px">Rotation</div>`;
    for (const axis of ["x", "y", "z"] as const) {
      const v = slot.rot[axis];
      html += this.sliderRow(`rot-${axis}`, `R${axis.toUpperCase()}`, v, -Math.PI, Math.PI, 0.05);
    }

    // Copy button
    html += `<button id="et-copy" style="margin-top:10px;width:100%;padding:6px;background:#264;color:#4f8;border:1px solid #4f8;border-radius:4px;font:12px monospace;cursor:pointer">Copy Values to Console</button>`;

    this.el.innerHTML = html;

    // Bind events
    const select = this.el.querySelector("#et-slot") as HTMLSelectElement;
    select?.addEventListener("change", () => {
      this.activeSlot = select.value;
      this.render();
    });

    // Bind sliders
    for (const group of ["pos", "rot"] as const) {
      for (const axis of ["x", "y", "z"] as const) {
        const slider = this.el.querySelector(`#et-${group}-${axis}`) as HTMLInputElement;
        const label = this.el.querySelector(`#et-val-${group}-${axis}`) as HTMLSpanElement;
        slider?.addEventListener("input", () => {
          const val = parseFloat(slider.value);
          slot[group][axis] = val;
          if (label) label.textContent = val.toFixed(3);
          this.onChange?.(this.activeSlot, slot.pos, slot.rot);
        });
      }
    }

    // Copy button
    const copyBtn = this.el.querySelector("#et-copy") as HTMLButtonElement;
    copyBtn?.addEventListener("click", () => {
      const p = slot.pos;
      const r = slot.rot;
      const code = `// ${slot.label}\nwpn.position.set(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)});\nwpn.rotation.set(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)});`;
      console.log(`\n=== ${slot.label} ===\n${code}\n`);
      this.dumpAll();
    });
  }

  private sliderRow(id: string, label: string, value: number, min: number, max: number, step: number): string {
    return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
      <span style="width:24px;color:#888">${label}</span>
      <input id="et-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="flex:1;accent-color:#4f8">
      <span id="et-val-${id}" style="width:50px;text-align:right;color:#4f8">${value.toFixed(3)}</span>
    </div>`;
  }

  private dumpAll() {
    console.log("\n=== ALL EQUIPMENT VALUES ===");
    for (const [key, s] of Object.entries(SLOTS)) {
      const p = s.pos;
      const r = s.rot;
      console.log(`${key}: pos(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}) rot(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)})`);
    }
    console.log("===========================\n");
  }
}

/** Singleton */
let _tuner: EquipmentTuner | null = null;
export function getEquipmentTuner(): EquipmentTuner {
  if (!_tuner) _tuner = new EquipmentTuner();
  return _tuner;
}
