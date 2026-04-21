import * as THREE from "three";
import { fetchCharacters, fetchClasses, fetchRaces, createCharacter, spawnCharacter, deployAgent } from "../api.js";
import { getAuthToken } from "../auth.js";
import type { CharacterAssets, CharacterInstance } from "../scene/CharacterAssets.js";
import { AvatarAssets } from "../scene/AvatarAssets.js";
import { getGradientMap } from "../scene/ToonPipeline.js";
import type { CharacterListEntry, CharacterListResponse, ClassDef, RaceDef, Entity } from "../types.js";

export interface CharacterReadyDetail {
  walletAddress: string;
  entityId: string;
  zoneId: string;
  characterName: string;
  custodialWallet?: string | null;
}

interface CharacterSelectOptions {
  onCharacterReady: (detail: CharacterReadyDetail) => void;
  onBack: () => void;
  charAssets: CharacterAssets;
}

type View = "list" | "create";

const STARTING_ZONE = "village-square";

const STAT_LABELS: Record<string, string> = {
  str: "STR", def: "DEF", hp: "HP", agi: "AGI",
  int: "INT", mp: "MP", faith: "FTH", luck: "LCK", essence: "ESS",
};

/** Class → outfit color (mirrors CharacterAssets) */
const CLASS_OUTFIT_COLOR: Record<string, number> = {
  warrior: 0xcc3333, paladin: 0xe6c830, mage: 0x3366dd, cleric: 0xeeeeff,
  ranger: 0x33aa44, rogue: 0x8833bb, warlock: 0x33bb66, monk: 0xe69628,
};

export class CharacterSelect {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private listContainer: HTMLDivElement;
  private createContainer: HTMLDivElement;
  private walletAddress: string = "";
  private busy = false;
  private classes: ClassDef[] = [];
  private races: RaceDef[] = [];
  private selectedClass: string = "";
  private selectedRace: string = "";
  private liveEntity: CharacterListResponse["liveEntity"] = null;
  private deployedCharacterName: string | null = null;
  private characters: CharacterListEntry[] = [];

  // 3D preview state
  private charAssets: CharacterAssets;
  private avatarAssets = new AvatarAssets();
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene = new THREE.Scene();
  private previewCamera: THREE.PerspectiveCamera;
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCharacter: CharacterInstance | null = null;
  private previewGroup = new THREE.Group(); // holds current character
  private previewClock = new THREE.Clock(false);
  private previewRAF = 0;
  private currentIndex = 0;
  private autoRotateSpeed = 0.4; // radians/sec
  private isDragging = false;
  private dragStartX = 0;
  private dragStartRotation = 0;

  constructor(private options: CharacterSelectOptions) {
    this.charAssets = options.charAssets;
    this.previewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    this.previewCamera.position.set(0, 0, 3.5);
    this.previewCamera.lookAt(0, 0, 0);

    this.injectStyles();

    this.root = document.createElement("div");
    this.root.id = "char-select";
    this.root.innerHTML = `<div class="cs-scrim"></div>`;

    this.panel = document.createElement("div");
    this.panel.className = "cs-panel";
    this.panel.innerHTML = `
      <div class="cs-header">
        <button type="button" class="cs-btn cs-btn-ghost cs-header-back" data-action="back">Back</button>
        <span class="cs-kicker">World of Geneva XR</span>
        <h1>Select Character</h1>
      </div>
      <div class="cs-preview-wrap">
        <button type="button" class="cs-arrow cs-arrow-left" data-action="prev">&lsaquo;</button>
        <div class="cs-preview-viewport"></div>
        <button type="button" class="cs-arrow cs-arrow-right" data-action="next">&rsaquo;</button>
      </div>
      <div class="cs-char-info-bar"></div>
      <div class="cs-list" data-view="list"></div>
      <div class="cs-create" data-view="create" style="display:none"></div>
      <div class="cs-status">Loading characters...</div>
    `;

    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);

    this.statusEl = this.panel.querySelector(".cs-status") as HTMLDivElement;
    this.listContainer = this.panel.querySelector("[data-view='list']") as HTMLDivElement;
    this.createContainer = this.panel.querySelector("[data-view='create']") as HTMLDivElement;

    // Arrows
    this.panel.querySelector("[data-action='prev']")!.addEventListener("click", () => this.cycleCharacter(-1));
    this.panel.querySelector("[data-action='next']")!.addEventListener("click", () => this.cycleCharacter(1));

    // Back
    this.panel.querySelector("[data-action='back']")!.addEventListener("click", () => {
      if (this.currentView() === "create" && this.characters.length > 0) {
        this.showView("list");
      } else {
        this.options.onBack();
      }
    });

    this.root.style.display = "none";
    this.setupPreviewScene();
  }

  // ── 3D Preview Setup ───────────────────────────────────────────────

  private setupPreviewScene() {
    const viewport = this.panel.querySelector(".cs-preview-viewport") as HTMLDivElement;

    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.className = "cs-preview-canvas";
    viewport.appendChild(this.previewCanvas);

    this.previewRenderer = new THREE.WebGLRenderer({
      canvas: this.previewCanvas,
      alpha: true,
      antialias: true,
    });
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.previewRenderer.setClearColor(0x000000, 0);
    this.previewRenderer.toneMapping = THREE.NoToneMapping;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffeedd, 0.6);
    this.previewScene.add(ambient);

    const key = new THREE.DirectionalLight(0xfff5e0, 1.2);
    key.position.set(2, 3, 4);
    this.previewScene.add(key);

    const fill = new THREE.DirectionalLight(0xaaccff, 0.4);
    fill.position.set(-2, 1, 2);
    this.previewScene.add(fill);

    const rim = new THREE.DirectionalLight(0xffd4a0, 0.3);
    rim.position.set(0, 2, -3);
    this.previewScene.add(rim);

    // Ground disc for visual grounding
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.8, 32),
      new THREE.MeshToonMaterial({
        color: 0x2a1f15,
        gradientMap: getGradientMap(),
        transparent: true,
        opacity: 0.5,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.45;
    this.previewScene.add(ground);

    this.previewScene.add(this.previewGroup);

    // Drag to rotate
    this.previewCanvas.addEventListener("pointerdown", (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartRotation = this.previewGroup.rotation.y;
      this.previewCanvas!.setPointerCapture(e.pointerId);
    });
    this.previewCanvas.addEventListener("pointermove", (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStartX;
      this.previewGroup.rotation.y = this.dragStartRotation + dx * 0.01;
    });
    this.previewCanvas.addEventListener("pointerup", () => { this.isDragging = false; });
    this.previewCanvas.addEventListener("pointercancel", () => { this.isDragging = false; });
  }

  private resizePreview() {
    const viewport = this.panel.querySelector(".cs-preview-viewport") as HTMLDivElement;
    if (!viewport || !this.previewRenderer) return;
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (w === 0 || h === 0) return;
    this.previewRenderer.setSize(w, h);
    this.previewCamera.aspect = w / h;
    this.previewCamera.updateProjectionMatrix();
  }

  private startPreviewLoop() {
    this.previewClock.start();
    const loop = () => {
      this.previewRAF = requestAnimationFrame(loop);
      const dt = this.previewClock.getDelta();

      // Update animation mixer
      if (this.previewCharacter) {
        this.previewCharacter.mixer.update(dt);
      }

      // Auto-rotate when not dragging
      if (!this.isDragging) {
        this.previewGroup.rotation.y += this.autoRotateSpeed * dt;
      }

      this.previewRenderer!.render(this.previewScene, this.previewCamera);
    };
    loop();
  }

  private stopPreviewLoop() {
    if (this.previewRAF) {
      cancelAnimationFrame(this.previewRAF);
      this.previewRAF = 0;
    }
    this.previewClock.stop();
  }

  // ── Character 3D Model ─────────────────────────────────────────────

  private showCharacterPreview(char: CharacterListEntry) {
    // Clear previous
    while (this.previewGroup.children.length > 0) {
      this.previewGroup.remove(this.previewGroup.children[0]);
    }
    this.previewCharacter = null;

    if (!this.charAssets.isReady()) return;

    const classId = char.properties.class ?? "warrior";
    const raceId = char.properties.race ?? "human";
    const gender = "male"; // characters in list don't always have gender stored

    // Build a fake entity for AvatarAssets to resolve colors
    const fakeEntity: Entity = {
      id: "preview",
      type: "player",
      name: char.name,
      x: 0, y: 0,
      hp: 100, maxHp: 100,
      classId,
      raceId,
      gender: gender as "male" | "female",
      skinColor: "medium",
      eyeColor: "brown",
    };

    const avatar = this.avatarAssets.resolvePlayer(fakeEntity);

    const instance = this.charAssets.buildCharacter({
      wogClass: classId,
      isFemale: avatar.features.isFemale,
      skinColor: avatar.colors.skinHex,
      hairColor: avatar.colors.hairHex,
      eyeColor: avatar.colors.eyeHex,
      outfitColor: CLASS_OUTFIT_COLOR[classId] ?? avatar.colors.bodyHex,
      scale: 0.5,
    });

    if (!instance) return;

    this.previewCharacter = instance;
    // Model origin is at feet — shift down so character is vertically centered
    instance.group.position.y = -0.45;
    this.previewGroup.add(instance.group);
    this.previewGroup.rotation.y = 0;

    // Play idle animation
    const idleClip = instance.clips.get("Idle");
    if (idleClip) {
      instance.mixer.clipAction(idleClip).play();
    }
  }

  private showCreatePreview() {
    while (this.previewGroup.children.length > 0) {
      this.previewGroup.remove(this.previewGroup.children[0]);
    }
    this.previewCharacter = null;

    if (!this.charAssets.isReady() || !this.selectedClass) return;

    const instance = this.charAssets.buildCharacter({
      wogClass: this.selectedClass,
      isFemale: false,
      skinColor: 0xd4a574,
      hairColor: 0x4a3728,
      eyeColor: 0x6b3a1f,
      outfitColor: CLASS_OUTFIT_COLOR[this.selectedClass] ?? 0x666688,
      scale: 0.5,
    });

    if (!instance) return;

    this.previewCharacter = instance;
    instance.group.position.y = -0.45;
    this.previewGroup.add(instance.group);
    this.previewGroup.rotation.y = 0;

    const idleClip = instance.clips.get("Idle");
    if (idleClip) {
      instance.mixer.clipAction(idleClip).play();
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  async show(walletAddress: string) {
    this.walletAddress = walletAddress;
    this.root.style.display = "";
    this.setStatus("Loading characters...");
    this.listContainer.innerHTML = "";
    this.createContainer.innerHTML = "";
    this.currentIndex = 0;

    // Size the preview canvas now that the container is visible
    requestAnimationFrame(() => {
      this.resizePreview();
      this.startPreviewLoop();
    });

    const token = await getAuthToken(walletAddress);
    if (!token) {
      this.setStatus("Authentication failed. Go back and sign in again.");
      return;
    }

    const [charData, classes, races] = await Promise.all([
      fetchCharacters(walletAddress, token),
      fetchClasses(),
      fetchRaces(),
    ]);

    this.classes = classes;
    this.races = races;
    this.liveEntity = charData?.liveEntity ?? null;
    this.deployedCharacterName = charData?.deployedCharacterName ?? null;
    this.characters = charData?.characters ?? [];

    if (this.characters.length === 0) {
      this.showView("create");
      this.setStatus("No characters found. Create your first hero.");
    } else {
      this.showView("list");
      this.setStatus(`${this.characters.length} character${this.characters.length > 1 ? "s" : ""} found. Use arrows to browse.`);
    }
  }

  hide() {
    this.root.style.display = "none";
    this.stopPreviewLoop();
  }

  isActive(): boolean {
    return this.root.style.display !== "none";
  }

  // ── Navigation ─────────────────────────────────────────────────────

  private cycleCharacter(dir: number) {
    if (this.characters.length === 0) return;
    this.currentIndex = (this.currentIndex + dir + this.characters.length) % this.characters.length;
    this.showCharacterPreview(this.characters[this.currentIndex]);
    this.updateInfoBar();
    this.updateListHighlight();
  }

  // ── Views ──────────────────────────────────────────────────────────

  private currentView(): View {
    return this.createContainer.style.display !== "none" ? "create" : "list";
  }

  private showView(view: View) {
    this.listContainer.style.display = view === "list" ? "" : "none";
    this.createContainer.style.display = view === "create" ? "" : "none";

    const header = this.panel.querySelector(".cs-header h1") as HTMLHeadingElement;
    const backBtn = this.panel.querySelector("[data-action='back']") as HTMLButtonElement;
    const arrows = this.panel.querySelectorAll<HTMLElement>(".cs-arrow");
    const infoBar = this.panel.querySelector(".cs-char-info-bar") as HTMLDivElement;

    if (view === "list") {
      header.textContent = "Select Character";
      backBtn.textContent = "Back";
      arrows.forEach((a) => (a.style.display = this.characters.length > 1 ? "" : "none"));
      infoBar.style.display = "";
      this.renderList();
      if (this.characters.length > 0) {
        this.currentIndex = Math.min(this.currentIndex, this.characters.length - 1);
        this.showCharacterPreview(this.characters[this.currentIndex]);
        this.updateInfoBar();
      }
    } else {
      header.textContent = "Create Character";
      backBtn.textContent = this.characters.length > 0 ? "Cancel" : "Back";
      arrows.forEach((a) => (a.style.display = "none"));
      infoBar.style.display = "none";
      this.renderCreateForm();
      this.showCreatePreview();
    }
  }

  // ── Info bar (below 3D preview) ────────────────────────────────────

  private updateInfoBar() {
    const bar = this.panel.querySelector(".cs-char-info-bar") as HTMLDivElement;
    if (this.characters.length === 0) { bar.innerHTML = ""; return; }

    const char = this.characters[this.currentIndex];
    const isLive = this.isCharacterLive(char);
    const level = isLive ? this.liveEntity!.level : (char.properties.level ?? 1);
    const race = char.properties.race ?? "unknown";
    const cls = char.properties.class ?? "unknown";
    const zone = isLive ? this.liveEntity!.zoneId.replace(/-/g, " ") : "";

    bar.innerHTML = `
      <div class="cs-info-name">
        ${this.esc(char.name)}
        ${isLive ? '<span class="cs-live-badge">LIVE</span>' : ""}
      </div>
      <div class="cs-info-meta">
        Lv ${level} &middot; ${this.capitalize(race)} ${this.capitalize(cls)}
        ${zone ? ` &middot; ${this.capitalize(zone)}` : ""}
      </div>
      <div class="cs-info-actions">
        <button type="button" class="cs-btn cs-btn-primary" data-action="play-char">
          ${isLive ? "Reconnect" : "Play"}
        </button>
      </div>
    `;

    bar.querySelector("[data-action='play-char']")!.addEventListener("click", () => {
      if (isLive) {
        void this.reconnect(char);
      } else {
        void this.spawnExisting(char);
      }
    });
  }

  private isCharacterLive(char: CharacterListEntry): boolean {
    if (!this.liveEntity) return false;
    const liveTokenId = this.liveEntity.characterTokenId;
    const charTokenId = char.characterTokenId ?? null;
    if (liveTokenId && charTokenId) {
      return liveTokenId === charTokenId;
    }
    const deployedBase = this.deployedCharacterName?.trim().toLowerCase() ?? null;
    if (!deployedBase) return false;
    const charBase = char.name.replace(/\s+the\s+\w+$/i, "").trim().toLowerCase();
    return charBase === deployedBase;
  }

  // ── Character list (compact, below info bar) ───────────────────────

  private renderList() {
    this.listContainer.innerHTML = "";

    // Dot indicators for each character
    if (this.characters.length > 1) {
      const dots = document.createElement("div");
      dots.className = "cs-dots";
      for (let i = 0; i < this.characters.length; i++) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = `cs-dot ${i === this.currentIndex ? "active" : ""}`;
        dot.dataset.idx = String(i);
        dot.addEventListener("click", () => {
          this.currentIndex = i;
          this.showCharacterPreview(this.characters[i]);
          this.updateInfoBar();
          this.updateListHighlight();
        });
        dots.appendChild(dot);
      }
      this.listContainer.appendChild(dots);
    }

    // "Create new" button
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "cs-btn cs-btn-secondary cs-btn-create-new";
    createBtn.textContent = "+ Create New Character";
    createBtn.addEventListener("click", () => this.showView("create"));
    this.listContainer.appendChild(createBtn);
  }

  private updateListHighlight() {
    const dots = this.listContainer.querySelectorAll<HTMLElement>(".cs-dot");
    dots.forEach((d, i) => d.classList.toggle("active", i === this.currentIndex));
  }

  // ── Character creation ─────────────────────────────────────────────

  private renderCreateForm() {
    this.selectedClass = this.classes[0]?.id ?? "";
    this.selectedRace = this.races[0]?.id ?? "";

    this.createContainer.innerHTML = `
      <label class="cs-field">
        <span>Character Name</span>
        <input name="charName" type="text" maxlength="24" placeholder="Enter a name..." autocomplete="off" />
      </label>

      <div class="cs-picker-label">Class</div>
      <div class="cs-picker" data-picker="class"></div>

      <div class="cs-picker-label">Race</div>
      <div class="cs-picker" data-picker="race"></div>

      <div class="cs-stats-preview" data-stats></div>

      <button type="button" class="cs-btn cs-btn-primary cs-btn-create" data-action="create-play">
        Create & Play
      </button>
    `;

    this.renderPicker("class", this.classes, this.selectedClass);
    this.renderPicker("race", this.races, this.selectedRace);
    this.renderStatsPreview();

    this.createContainer.querySelector("[data-action='create-play']")!.addEventListener("click", () => {
      void this.handleCreate();
    });
  }

  private renderPicker(type: "class" | "race", items: Array<{ id: string; name: string; description: string }>, selected: string) {
    const container = this.createContainer.querySelector(`[data-picker='${type}']`) as HTMLDivElement;
    container.innerHTML = "";

    for (const item of items) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `cs-pick-btn ${item.id === selected ? "active" : ""}`;
      el.innerHTML = `<strong>${this.capitalize(item.name)}</strong><span>${item.description}</span>`;
      el.addEventListener("click", () => {
        if (type === "class") this.selectedClass = item.id;
        else this.selectedRace = item.id;
        this.renderPicker(type, items, item.id);
        this.renderStatsPreview();
        this.showCreatePreview();
      });
      container.appendChild(el);
    }
  }

  private renderStatsPreview() {
    const statsEl = this.createContainer.querySelector("[data-stats]") as HTMLDivElement;
    const cls = this.classes.find((c) => c.id === this.selectedClass);
    const race = this.races.find((r) => r.id === this.selectedRace);
    if (!cls || !race) { statsEl.innerHTML = ""; return; }

    const lines: string[] = [];
    for (const [key, label] of Object.entries(STAT_LABELS)) {
      const base = cls.baseStats[key] ?? 0;
      const mod = race.statModifiers[key] ?? 1;
      const val = Math.round(base * mod);
      const modStr = mod > 1 ? '<span class="cs-stat-up">+</span>' : mod < 1 ? '<span class="cs-stat-down">-</span>' : "";
      lines.push(`<div class="cs-stat">${label} <strong>${val}</strong>${modStr}</div>`);
    }
    statsEl.innerHTML = `<div class="cs-stats-title">Base Stats (Lv 1)</div><div class="cs-stats-grid">${lines.join("")}</div>`;
  }

  // ── Actions ────────────────────────────────────────────────────────

  private async handleCreate() {
    const nameInput = this.createContainer.querySelector("input[name='charName']") as HTMLInputElement;
    const name = nameInput.value.trim();
    if (!name || name.length < 2) {
      this.setStatus("Name must be at least 2 characters.");
      return;
    }
    if (!this.selectedClass || !this.selectedRace) {
      this.setStatus("Select a class and race.");
      return;
    }

    await this.runBusy("Creating character...", async () => {
      const token = await getAuthToken(this.walletAddress);
      if (!token) throw new Error("Auth token expired. Go back and sign in again.");

      const result = await createCharacter(token, {
        walletAddress: this.walletAddress,
        characterName: name,
        classId: this.selectedClass,
        raceId: this.selectedRace,
      });

      if (!result.ok) throw new Error(result.error || "Character creation failed.");

      this.setStatus("Character created! Spawning...");

      const spawn = await spawnCharacter(token, {
        zoneId: STARTING_ZONE,
        type: "player",
        name,
        walletAddress: this.walletAddress,
        classId: this.selectedClass,
        raceId: this.selectedRace,
      });

      if (!spawn.ok) {
        const reconnected = this.handleExistingLiveSpawn(name, spawn);
        if (reconnected) return;
        throw new Error(spawn.error || "Spawn failed.");
      }

      this.options.onCharacterReady({
        walletAddress: this.walletAddress,
        entityId: spawn.spawned!.id,
        zoneId: spawn.zone || STARTING_ZONE,
        characterName: name,
      });
    });
  }

  private async spawnExisting(char: CharacterListEntry) {
    await this.runBusy(`Deploying ${char.name}...`, async () => {
      const token = await getAuthToken(this.walletAddress);
      if (!token) throw new Error("Auth token expired. Go back and sign in again.");

      const deploy = await deployAgent(token, {
        walletAddress: this.walletAddress,
        characterName: char.name,
        characterTokenId: char.characterTokenId ?? undefined,
        raceId: char.properties.race,
        classId: char.properties.class,
      });

      if (!deploy.ok || !deploy.entityId) {
        throw new Error(deploy.error || "Deploy failed.");
      }

      this.options.onCharacterReady({
        walletAddress: this.walletAddress,
        entityId: deploy.entityId,
        zoneId: deploy.zoneId || STARTING_ZONE,
        characterName: char.name,
        custodialWallet: deploy.custodialWallet ?? null,
      });
    });
  }

  private async reconnect(char: CharacterListEntry) {
    if (!this.liveEntity) return;
    await this.runBusy(`Reconnecting ${char.name}...`, async () => {
      const token = await getAuthToken(this.walletAddress);
      if (!token) throw new Error("Auth token expired. Go back and sign in again.");

      const deploy = await deployAgent(token, {
        walletAddress: this.walletAddress,
        characterName: char.name,
        characterTokenId: char.characterTokenId ?? this.liveEntity?.characterTokenId ?? undefined,
        raceId: char.properties.race,
        classId: char.properties.class,
      });

      if (!deploy.ok || !deploy.entityId) {
        throw new Error(deploy.error || "Reconnect failed.");
      }

      this.options.onCharacterReady({
        walletAddress: this.walletAddress,
        entityId: deploy.entityId,
        zoneId: deploy.zoneId || this.liveEntity!.zoneId,
        characterName: char.name,
        custodialWallet: deploy.custodialWallet ?? null,
      });
    });
  }

  private handleExistingLiveSpawn(
    characterName: string,
    spawn: { ok: boolean; entityId?: string; zoneId?: string; error?: string },
  ): boolean {
    if (spawn.error !== "Wallet already has a live character on this shard" || !spawn.entityId || !spawn.zoneId) {
      return false;
    }

    this.setStatus(`${characterName} is already live. Reconnecting...`);
    this.options.onCharacterReady({
      walletAddress: this.walletAddress,
      entityId: spawn.entityId,
      zoneId: spawn.zoneId,
      characterName,
    });
    return true;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private async runBusy(label: string, fn: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.panel.classList.add("is-busy");
    this.setStatus(label);
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(message || "Something went wrong.");
    } finally {
      this.busy = false;
      this.panel.classList.remove("is-busy");
    }
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  private esc(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── Styles ─────────────────────────────────────────────────────────

  private injectStyles() {
    if (document.getElementById("cs-styles")) return;
    const style = document.createElement("style");
    style.id = "cs-styles";
    style.textContent = `
      #char-select {
        position: fixed;
        inset: 0;
        z-index: 39;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Georgia, "Times New Roman", serif;
      }

      .cs-scrim {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 30%, rgba(255, 221, 164, 0.14), transparent 26%),
          linear-gradient(180deg, rgba(5, 6, 10, 0.12), rgba(5, 6, 10, 0.74));
        backdrop-filter: blur(4px);
      }

      .cs-panel {
        position: relative;
        box-sizing: border-box;
        width: min(520px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        overflow-y: auto;
        overflow-x: hidden;
        padding: 24px 24px 18px;
        border-radius: 30px;
        background: linear-gradient(180deg, rgba(42, 31, 21, 0.94) 0%, rgba(16, 13, 11, 0.97) 100%);
        border: 1px solid rgba(239, 201, 127, 0.42);
        box-shadow: 0 28px 90px rgba(0, 0, 0, 0.58),
          inset 0 1px 0 rgba(255, 244, 215, 0.08);
      }

      .cs-panel * { box-sizing: border-box; max-width: 100%; }

      .cs-panel.is-busy button { pointer-events: none; opacity: 0.78; }

      .cs-header {
        position: relative;
        text-align: center;
        padding-bottom: 12px;
        margin-bottom: 0;
      }

      .cs-header-back {
        position: absolute;
        top: 0;
        left: 0;
      }

      .cs-kicker {
        display: inline-flex;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(239, 201, 127, 0.18);
        background: rgba(255, 248, 227, 0.05);
        color: #efc97f;
        font: 600 11px/1 "Courier New", monospace;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .cs-header h1 {
        margin: 12px 0 0;
        color: #f4ead0;
        font-size: clamp(26px, 4vw, 34px);
        line-height: 1;
        text-transform: uppercase;
      }

      /* ── 3D Preview ── */

      .cs-preview-wrap {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 8px 0 0;
      }

      .cs-preview-viewport {
        width: 100%;
        height: 340px;
        border-radius: 20px;
        overflow: hidden;
        background: radial-gradient(ellipse at 50% 80%, rgba(42, 31, 21, 0.6), transparent 70%);
        cursor: grab;
      }

      .cs-preview-viewport:active { cursor: grabbing; }

      .cs-preview-canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .cs-arrow {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2;
        width: 40px;
        height: 40px;
        border: 1px solid rgba(239, 201, 127, 0.25);
        border-radius: 50%;
        background: rgba(16, 13, 11, 0.7);
        color: #efc97f;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 160ms ease, transform 160ms ease;
        backdrop-filter: blur(4px);
      }

      .cs-arrow:hover {
        background: rgba(239, 201, 127, 0.15);
        transform: translateY(-50%) scale(1.1);
      }

      .cs-arrow-left { left: 8px; }
      .cs-arrow-right { right: 8px; }

      /* ── Info bar ── */

      .cs-char-info-bar {
        text-align: center;
        padding: 12px 0;
        border-bottom: 1px solid rgba(239, 201, 127, 0.1);
        margin-bottom: 12px;
      }

      .cs-info-name {
        color: #f4ead0;
        font-size: 20px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .cs-info-meta {
        color: #8f8067;
        font: 500 12px/1.4 "Courier New", monospace;
        margin-top: 4px;
        text-transform: capitalize;
      }

      .cs-info-actions {
        margin-top: 10px;
      }

      .cs-live-badge {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(127, 214, 190, 0.18);
        border: 1px solid rgba(127, 214, 190, 0.3);
        color: #7fd6be;
        font: 700 9px/1 "Courier New", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      /* ── Dot indicators ── */

      .cs-dots {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .cs-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 1px solid rgba(239, 201, 127, 0.3);
        background: rgba(239, 201, 127, 0.1);
        cursor: pointer;
        padding: 0;
        transition: background 160ms ease, transform 160ms ease;
      }

      .cs-dot.active {
        background: #efc97f;
        transform: scale(1.3);
      }

      .cs-dot:hover { background: rgba(239, 201, 127, 0.4); }

      /* ── Buttons ── */

      .cs-btn {
        border: none;
        border-radius: 14px;
        cursor: pointer;
        font: 700 11px/1 "Courier New", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        transition: transform 160ms ease, box-shadow 160ms ease;
      }

      .cs-btn:hover { transform: translateY(-2px); }

      .cs-btn-primary {
        padding: 13px 20px;
        background: linear-gradient(135deg, #f0cc87, #b57743);
        color: #23170f;
        box-shadow: 0 12px 24px rgba(181, 119, 67, 0.25);
      }

      .cs-btn-secondary {
        padding: 13px 20px;
        background: linear-gradient(135deg, rgba(127, 214, 190, 0.18), rgba(70, 104, 103, 0.44));
        color: #e6fff7;
      }

      .cs-btn-ghost {
        padding: 13px 20px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(239, 201, 127, 0.12);
        color: #d0c0a1;
      }

      .cs-btn-sm { padding: 10px 16px; font-size: 10px; flex-shrink: 0; }

      .cs-btn-create-new {
        width: 100%;
        margin-top: 4px;
      }

      .cs-btn-create {
        width: 100%;
        margin-top: 12px;
        padding: 15px 20px;
        font-size: 12px;
      }

      /* ── Create form ── */

      .cs-field {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 14px;
      }

      .cs-field span {
        color: #efc97f;
        font: 600 11px/1 "Courier New", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .cs-field input {
        width: 100%;
        padding: 13px 16px;
        border-radius: 14px;
        border: 1px solid rgba(239, 201, 127, 0.14);
        background: rgba(14, 11, 10, 0.62);
        color: #f4ead0;
        font: 500 15px/1.2 Georgia, serif;
        outline: none;
        box-sizing: border-box;
      }

      .cs-field input:focus {
        border-color: rgba(127, 214, 190, 0.4);
        box-shadow: 0 0 0 4px rgba(127, 214, 190, 0.08);
      }

      .cs-picker-label {
        color: #efc97f;
        font: 600 11px/1 "Courier New", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 8px;
      }

      .cs-picker {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 8px;
        margin-bottom: 14px;
      }

      .cs-pick-btn {
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(239, 201, 127, 0.1);
        background: rgba(255, 251, 239, 0.03);
        color: #d0c0a1;
        cursor: pointer;
        text-align: left;
        transition: border-color 160ms ease, background 160ms ease;
      }

      .cs-pick-btn strong {
        display: block;
        color: #f4ead0;
        font: 700 12px/1.3 "Courier New", monospace;
        text-transform: capitalize;
      }

      .cs-pick-btn span {
        display: block;
        margin-top: 3px;
        font: 400 10px/1.4 "Courier New", monospace;
        color: #8f8067;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .cs-pick-btn:hover { border-color: rgba(239, 201, 127, 0.3); }

      .cs-pick-btn.active {
        border-color: #efc97f;
        background: rgba(239, 201, 127, 0.1);
      }

      /* ── Stats preview ── */

      .cs-stats-preview { margin-bottom: 4px; }

      .cs-stats-title {
        color: #8f8067;
        font: 600 10px/1 "Courier New", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 8px;
      }

      .cs-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
        gap: 6px;
      }

      .cs-stat {
        padding: 6px 8px;
        border-radius: 8px;
        background: rgba(14, 11, 10, 0.5);
        color: #8f8067;
        font: 600 10px/1.4 "Courier New", monospace;
        text-transform: uppercase;
      }

      .cs-stat strong { color: #f4ead0; margin-left: 4px; }
      .cs-stat-up { color: #7fd6be; margin-left: 2px; }
      .cs-stat-down { color: #ff9a8b; margin-left: 2px; }

      /* ── Status ── */

      .cs-status {
        margin-top: 14px;
        padding: 10px 14px;
        border-radius: 14px;
        background: rgba(8, 9, 12, 0.4);
        border: 1px solid rgba(239, 201, 127, 0.12);
        color: #8f8067;
        font: 600 11px/1.35 "Courier New", monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      @media (max-width: 768px) {
        .cs-panel {
          width: calc(100vw - 16px);
          padding: 20px 14px 14px;
          border-radius: 24px;
        }
        .cs-header {
          padding-top: 38px;
        }
        .cs-preview-viewport { height: 260px; }
        .cs-picker { gap: 6px; }
        .cs-pick-btn { padding: 10px 12px; }
        .cs-stats-grid { gap: 4px; }
        .cs-stat { padding: 5px 6px; font-size: 9px; }
        .cs-header-back { padding: 8px 12px; font-size: 10px; }
      }

      @media (max-width: 380px) {
        .cs-panel { padding: 16px 10px 12px; }
        .cs-preview-viewport { height: 220px; }
      }
    `;
    document.head.appendChild(style);
  }
}
