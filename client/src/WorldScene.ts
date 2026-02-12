import Phaser from "phaser";

import { CAMERA_SPEED, POLL_INTERVAL, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "@/config";
import { EntityRenderer } from "@/EntityRenderer";
import { TilemapRenderer } from "@/TilemapRenderer";
import { fetchZone } from "@/ShardClient";
import { gameBus } from "@/lib/eventBus";

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

  constructor() {
    super({ key: "WorldScene" });
  }

  create(): void {
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
    });

    // Camera + input
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
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

    // HUD overlay (fixed to camera)
    this.hud = this.add
      .text(12, 12, "", {
        fontSize: "16px",
        fontFamily: "monospace",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
        lineSpacing: 6,
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
        fontSize: "14px",
        fontFamily: "monospace",
        color: "#ffffff",
        lineSpacing: 4,
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
    const cam = this.cameras.main;
    if (this.cursors.left.isDown) cam.scrollX -= CAMERA_SPEED / cam.zoom;
    if (this.cursors.right.isDown) cam.scrollX += CAMERA_SPEED / cam.zoom;
    if (this.cursors.up.isDown) cam.scrollY -= CAMERA_SPEED / cam.zoom;
    if (this.cursors.down.isDown) cam.scrollY += CAMERA_SPEED / cam.zoom;

    this.hud.setText(
      [
        `Zone: ${this.zoneId}`,
        `Tick: ${this.tick}`,
        `Entities: ${this.entityRenderer.entityCount}`,
        `Zoom: ${cam.zoom.toFixed(1)}x`,
        "",
        "Drag/Arrows: pan | Scroll: zoom",
        "Click NPCs to interact | C: characters",
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

    // Find entity under cursor (within 30px radius)
    let hoveredEntity = this.entityRenderer.getEntityAt(worldX, worldY, 30);

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
        .setPosition(tooltipX - 8, tooltipY - 6)
        .setSize(bounds.width + 16, bounds.height + 12);

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

    // Auto-zoom and center on initial load
    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    const cam = this.cameras.main;
    const fitZoom = Math.min(cam.width / w, cam.height / h) * 0.9;
    cam.setZoom(Phaser.Math.Clamp(fitZoom, ZOOM_MIN, ZOOM_MAX));
    cam.centerOn(w / 2, h / 2);
  }

  private updateCameraBounds(): void {
    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    const cam = this.cameras.main;

    // Loose bounds — allow panning a half-viewport beyond the terrain edges
    // so the terrain can always be centered even on large screens
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
