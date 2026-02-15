import Phaser from "phaser";

import { CAMERA_SPEED, POLL_INTERVAL, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT } from "@/config";
import { EntityRenderer } from "@/EntityRenderer";
import { TilemapRenderer } from "@/TilemapRenderer";
import { fetchZone } from "@/ShardClient";
import { gameBus } from "@/lib/eventBus";
import { registerEntitySprites } from "@/EntitySpriteGenerator";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pad(n: number): string {
  return String(n).padStart(3, " ");
}

export class WorldScene extends Phaser.Scene {
  private entityRenderer!: EntityRenderer;
  private tilemapRenderer!: TilemapRenderer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private hud!: Phaser.GameObjects.Text;
  private tooltip!: Phaser.GameObjects.Text;
  private tooltipBg!: Phaser.GameObjects.Rectangle;
  private tick = 0;
  private connected = false;
  private terrainLoaded = false;
  private zoneId = "human-meadow";
  private unsubscribeSwitchZone: (() => void) | null = null;

  /** Dynamic min zoom — ensures the map always fills the viewport */
  private minZoom = 0.5;

  /** Spectate camera: follows this entity id, null = free cam */
  private followTarget: string | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private escKey!: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: "WorldScene" });
  }

  create(): void {
    // Register all entity sprite sheets and animations
    registerEntitySprites(this);

    this.tilemapRenderer = new TilemapRenderer(this);
    this.entityRenderer = new EntityRenderer(this);

    this.entityRenderer.onClick((entity) => {
      if (entity.type === "merchant" && entity.shopItems) {
        gameBus.emit("merchantClick", entity);
      } else if (entity.type === "guild-registrar") {
        gameBus.emit("guildRegistrarClick", entity);
      } else if (entity.type === "auctioneer") {
        gameBus.emit("auctioneerClick", entity);
      } else if (entity.type === "arena-master") {
        gameBus.emit("arenaMasterClick", entity);
      }

      // Spectate: click any entity → snap camera immediately, then follow
      this.followTarget = entity.id;
      this.isDragging = false;
      const px = entity.x * this.tilemapRenderer.coordScale;
      const py = entity.y * this.tilemapRenderer.coordScale;
      this.cameras.main.centerOn(px, py);
    });

    // Camera + input — only treat as drag after moving 4+ pixels
    this.input.on("pointerdown", () => {
      this.isDragging = false;
      this.dragStartX = this.input.activePointer.x;
      this.dragStartY = this.input.activePointer.y;
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      const movedX = Math.abs(pointer.x - this.dragStartX);
      const movedY = Math.abs(pointer.y - this.dragStartY);
      if (!this.isDragging && movedX < 4 && movedY < 4) return;
      this.isDragging = true;
      // Dragging releases spectate
      this.followTarget = null;
      const cam = this.cameras.main;
      cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
      cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
    });

    this.input.on(
      "wheel",
      (
        _pointer: Phaser.Input.Pointer,
        _gameObjects: Phaser.GameObjects.GameObject[],
        _dx: number,
        dy: number,
      ) => {
        const cam = this.cameras.main;
        const nextZoom = Phaser.Math.Clamp(
          cam.zoom - Math.sign(dy) * ZOOM_STEP,
          this.minZoom,
          ZOOM_MAX,
        );
        cam.setZoom(nextZoom);
      },
    );

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // HUD overlay (fixed to camera)
    this.hud = this.add
      .text(12, 12, "", {
        fontSize: "12px",
        fontFamily: "monospace",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
        lineSpacing: 4,
      })
      .setScrollFactor(0)
      .setDepth(100);

    // Tooltip background (hidden by default) — 8-bit dark box with green border
    this.tooltipBg = this.add
      .rectangle(0, 0, 200, 100, 0x0a0e1a, 0.92)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(200)
      .setStrokeStyle(2, 0x00ff88)
      .setVisible(false);

    // Tooltip text (hidden by default)
    this.tooltip = this.add
      .text(0, 0, "", {
        fontSize: "10px",
        fontFamily: "monospace",
        color: "#e0e8ff",
        lineSpacing: 2,
        padding: { x: 8, y: 6 },
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(201)
      .setVisible(false);

    // Handle window resize - update camera bounds
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (this.terrainLoaded) {
        this.updateCameraBounds();
      }
    });

    // Event bus
    this.unsubscribeSwitchZone = gameBus.on("switchZone", ({ zoneId }) => {
      this.switchZone(zoneId);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeSwitchZone?.();
      this.unsubscribeSwitchZone = null;
    });

    gameBus.emit("zoneChanged", { zoneId: this.zoneId });

    // Initial load
    void this.loadZoneTerrain(this.zoneId);
    void this.pollZone();
    this.time.addEvent({
      delay: POLL_INTERVAL,
      callback: this.pollZone,
      callbackScope: this,
      loop: true,
    });
  }

  update(): void {
    // ESC releases spectate
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.followTarget = null;
    }

    const cam = this.cameras.main;

    // Arrow key pan (releases spectate)
    if (this.cursors.left.isDown || this.cursors.right.isDown ||
        this.cursors.up.isDown || this.cursors.down.isDown) {
      this.followTarget = null;
    }

    if (this.followTarget === null) {
      if (this.cursors.left.isDown) cam.scrollX -= CAMERA_SPEED / cam.zoom;
      if (this.cursors.right.isDown) cam.scrollX += CAMERA_SPEED / cam.zoom;
      if (this.cursors.up.isDown) cam.scrollY -= CAMERA_SPEED / cam.zoom;
      if (this.cursors.down.isDown) cam.scrollY += CAMERA_SPEED / cam.zoom;
    }

    // Follow target entity — use sprite's current visual position (smooth during tweens)
    if (this.followTarget) {
      const spritePos = this.entityRenderer.getSpritePosition(this.followTarget);
      if (spritePos) {
        cam.centerOn(spritePos.x, spritePos.y);
      } else {
        // Entity left zone — release
        this.followTarget = null;
      }
    }

    // Build HUD text
    const followName = this.followTarget
      ? this.entityRenderer.getEntity(this.followTarget)?.name ?? "?"
      : null;

    this.hud.setText(
      [
        `Zone: ${this.zoneId}`,
        `Tick: ${this.tick}`,
        `Entities: ${this.entityRenderer.entityCount}`,
        `Zoom: ${cam.zoom.toFixed(1)}x`,
        "",
        followName ? `Following: ${followName} | ESC: free cam` : "Click entity to spectate",
        "Drag/Arrows: pan | Scroll: zoom",
        this.terrainLoaded ? "" : "Loading terrain...",
        this.connected ? "" : "Connecting...",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    // Update hover tooltip
    this.updateTooltip();
  }

  private updateTooltip(): void {
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;

    // Use Phaser's built-in screen-to-world conversion (handles zoom, scroll, viewport)
    const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);

    // Find entity under cursor (within 16px world-space radius)
    const hoveredEntity = this.entityRenderer.getEntityAt(worldPoint.x, worldPoint.y, 16);

    if (hoveredEntity) {
      const lines: string[] = [];
      const e = hoveredEntity;

      // ── Header: name + type tag ──
      const typeTag = this.entityTypeTag(e.type);
      lines.push(e.name);
      lines.push(typeTag);

      // ── Race / Class (players + agents) ──
      if (e.raceId || e.classId) {
        const race = e.raceId ? capitalize(e.raceId) : "";
        const cls = e.classId ? capitalize(e.classId) : "";
        lines.push(`${race} ${cls}`.trim());
      }

      lines.push(""); // separator

      // ── HP bar (text-art) ──
      const hpRatio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
      const hpBarFill = Math.round(hpRatio * 10);
      const hpBar = "#".repeat(hpBarFill) + "-".repeat(10 - hpBarFill);
      lines.push(`HP [${hpBar}] ${e.hp}/${e.maxHp}`);

      // ── Essence bar (if present) ──
      if (e.essence !== undefined && e.maxEssence && e.maxEssence > 0) {
        const esRatio = e.essence / e.maxEssence;
        const esFill = Math.round(esRatio * 10);
        const esBar = "*".repeat(esFill) + "-".repeat(10 - esFill);
        lines.push(`ES [${esBar}] ${e.essence}/${e.maxEssence}`);
      }

      // ── Level + XP ──
      if (e.level) {
        let lvlLine = `Lv.${e.level}`;
        if (e.xp !== undefined) lvlLine += `  XP:${e.xp}`;
        lines.push(lvlLine);
      }

      // ── Stats (if available) ──
      if (e.effectiveStats) {
        const s = e.effectiveStats;
        lines.push("");
        lines.push(`STR ${pad(s.str)} DEF ${pad(s.def)}`);
        lines.push(`INT ${pad(s.int)} AGI ${pad(s.agi)}`);
        lines.push(`FAI ${pad(s.faith)} LCK ${pad(s.luck)}`);
      }

      // ── Equipment summary ──
      if (e.equipment) {
        const equipped = Object.keys(e.equipment).filter(
          (slot) => e.equipment![slot as keyof typeof e.equipment] != null
        );
        if (equipped.length > 0) {
          lines.push("");
          lines.push(`Gear: ${equipped.length} items`);
        }
      }

      // ── Party membership ──
      if (e.partyId) {
        const partyMembers: string[] = [];
        for (const [, other] of this.entityRenderer.getEntities()) {
          if (other.partyId === e.partyId && other.id !== e.id) {
            partyMembers.push(other.name);
          }
        }
        lines.push("");
        lines.push("[PARTY]");
        if (partyMembers.length > 0) {
          lines.push(`With: ${partyMembers.join(", ")}`);
        }
      }

      // ── NPC-specific hints ──
      if (e.type === "merchant") {
        lines.push("", "[Click] Browse shop");
      } else if (e.type === "trainer") {
        lines.push("", "[Click] Train skills");
      } else if (e.type === "profession-trainer") {
        lines.push("", "[Click] Learn profession");
      } else if (e.type === "guild-registrar") {
        lines.push("", "[Click] Guild hall");
      } else if (e.type === "auctioneer") {
        lines.push("", "[Click] Auction house");
      } else if (e.type === "arena-master") {
        lines.push("", "[Click] PvP Coliseum");
      } else if (e.type === "mob" || e.type === "boss") {
        if (e.xpReward) lines.push(`XP reward: ${e.xpReward}`);
      }

      // ── Spectate hint for players ──
      if (e.type === "player") {
        lines.push("", "[Click] Spectate");
      }

      const text = lines.join("\n");
      this.tooltip.setText(text);

      // Measure actual tooltip size before positioning
      const bounds = this.tooltip.getBounds();
      const tw = bounds.width + 12; // include bg padding
      const th = bounds.height + 8;
      const gap = 10;

      // Flip to left/above cursor when tooltip would overflow screen edge
      const tooltipX = pointer.x + gap + tw > cam.width
        ? pointer.x - gap - tw + 6
        : pointer.x + gap;
      const tooltipY = pointer.y + gap + th > cam.height
        ? pointer.y - gap - th + 4
        : pointer.y + gap;

      this.tooltip.setPosition(tooltipX, tooltipY);
      this.tooltipBg
        .setPosition(tooltipX - 6, tooltipY - 4)
        .setSize(tw, th);

      this.tooltip.setVisible(true);
      this.tooltipBg.setVisible(true);
    } else {
      this.tooltip.setVisible(false);
      this.tooltipBg.setVisible(false);
    }
  }

  private entityTypeTag(type: string): string {
    const tags: Record<string, string> = {
      player: "[PLAYER]",
      mob: "[MOB]",
      boss: "[BOSS]",
      merchant: "[MERCHANT]",
      trainer: "[TRAINER]",
      "profession-trainer": "[PROF TRAINER]",
      "guild-registrar": "[GUILD]",
      auctioneer: "[AUCTIONEER]",
      "arena-master": "[ARENA]",
      "ore-node": "[ORE]",
      "herb-node": "[HERB]",
    };
    return tags[type] ?? `[${type.toUpperCase()}]`;
  }

  switchZone(zoneId: string): void {
    if (zoneId === this.zoneId) return;
    this.zoneId = zoneId;
    this.terrainLoaded = false;
    this.followTarget = null;
    this.entityRenderer.update({});
    this.connected = false;
    gameBus.emit("zoneChanged", { zoneId });
    void this.loadZoneTerrain(zoneId);
    void this.pollZone();
  }

  private async loadZoneTerrain(zoneId: string): Promise<void> {
    await this.tilemapRenderer.loadZone(zoneId);
    // Zone may have changed while loading
    if (zoneId !== this.zoneId) return;

    this.terrainLoaded = true;
    this.entityRenderer.setCoordScale(this.tilemapRenderer.coordScale);
    this.updateCameraBounds();

    // Center and apply default zoom (never below minZoom)
    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(ZOOM_DEFAULT, this.minZoom, ZOOM_MAX));
    cam.centerOn(w / 2, h / 2);
  }

  private updateCameraBounds(): void {
    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    if (w <= 0 || h <= 0) return;

    const cam = this.cameras.main;

    // Calculate min zoom so the map always fills the viewport entirely
    this.minZoom = Math.max(cam.width / w, cam.height / h);

    // Clamp current zoom if it's now below the new minimum
    if (cam.zoom < this.minZoom) {
      cam.setZoom(this.minZoom);
    }

    // Tight bounds — map edges exactly, no black space visible
    cam.setBounds(0, 0, w, h);
  }

  private async pollZone(): Promise<void> {
    const data = await fetchZone(this.zoneId);
    if (!data) {
      this.connected = false;
      return;
    }

    this.connected = true;
    this.tick = data.tick;
    this.entityRenderer.update(data.entities);
  }
}
