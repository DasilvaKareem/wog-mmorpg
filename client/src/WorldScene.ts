import Phaser from "phaser";

import { CAMERA_SPEED, POLL_INTERVAL, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, ZOOM_DEFAULT } from "@/config";
import { EntityRenderer } from "@/EntityRenderer";
import { TilemapRenderer } from "@/TilemapRenderer";
import { fetchZone } from "@/ShardClient";
import { gameBus } from "@/lib/eventBus";
import { registerEntitySprites } from "@/EntitySpriteGenerator";

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

  /** Spectate camera: follows this entity id, null = free cam */
  private followTarget: string | null = null;
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
      }

      // Spectate: click any entity to follow
      this.followTarget = entity.id;
    });

    // Camera + input
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
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
          ZOOM_MIN,
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

    // Tooltip background (hidden by default)
    this.tooltipBg = this.add
      .rectangle(0, 0, 200, 100, 0x000000, 0.85)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(false);

    // Tooltip text (hidden by default)
    this.tooltip = this.add
      .text(0, 0, "", {
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#ffffff",
        lineSpacing: 3,
        padding: { x: 6, y: 4 },
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

    // Follow target entity
    if (this.followTarget) {
      const ent = this.entityRenderer.getEntity(this.followTarget);
      if (ent) {
        const px = ent.x * this.tilemapRenderer.coordScale;
        const py = ent.y * this.tilemapRenderer.coordScale;
        cam.centerOn(px, py);
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

    // Convert screen coords to world coords
    const worldX = (pointer.x / cam.zoom) + cam.scrollX;
    const worldY = (pointer.y / cam.zoom) + cam.scrollY;

    // Find entity under cursor (within 20px radius for smaller sprites)
    const hoveredEntity = this.entityRenderer.getEntityAt(worldX, worldY, 20);

    if (hoveredEntity) {
      const lines = [
        `${hoveredEntity.name}`,
        `Type: ${hoveredEntity.type}`,
        `HP: ${hoveredEntity.hp}/${hoveredEntity.maxHp}`,
      ];

      if (hoveredEntity.level) {
        lines.push(`Level: ${hoveredEntity.level}`);
      }
      if (hoveredEntity.xp !== undefined) {
        lines.push(`XP: ${hoveredEntity.xp}`);
      }
      if (hoveredEntity.type === "merchant") {
        lines.push(``, `Click to shop`);
      }
      if (hoveredEntity.type === "trainer") {
        lines.push(``, `Class Trainer`);
      }
      if (hoveredEntity.type === "profession-trainer") {
        lines.push(``, `Profession Trainer`);
      }

      const text = lines.join("\n");
      this.tooltip.setText(text);

      // Position tooltip near pointer
      const tooltipX = Math.min(pointer.x + 15, cam.width - 220);
      const tooltipY = Math.min(pointer.y + 15, cam.height - 150);

      this.tooltip.setPosition(tooltipX, tooltipY);

      const bounds = this.tooltip.getBounds();
      this.tooltipBg
        .setPosition(tooltipX - 6, tooltipY - 4)
        .setSize(bounds.width + 12, bounds.height + 8);

      this.tooltip.setVisible(true);
      this.tooltipBg.setVisible(true);
    } else {
      this.tooltip.setVisible(false);
      this.tooltipBg.setVisible(false);
    }
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

    // Center and apply default zoom
    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX));
    cam.centerOn(w / 2, h / 2);
  }

  private updateCameraBounds(): void {
    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    const cam = this.cameras.main;

    // Loose bounds — allow panning a half-viewport beyond the terrain edges
    const padX = cam.width;
    const padY = cam.height;
    cam.setBounds(-padX / 2, -padY / 2, w + padX, h + padY);
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
