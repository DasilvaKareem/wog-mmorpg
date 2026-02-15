import Phaser from "phaser";

import { CAMERA_SPEED, POLL_INTERVAL, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT, CLIENT_TILE_PX } from "@/config";
import { EntityRenderer } from "@/EntityRenderer";
import { TilemapRenderer } from "@/TilemapRenderer";
import { ChunkStreamManager } from "@/ChunkStreamManager";
import { fetchZone, fetchZoneChunkInfo } from "@/ShardClient";
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
  private chunkManager!: ChunkStreamManager;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private hud!: Phaser.GameObjects.Text;
  private tooltip!: Phaser.GameObjects.Text;
  private tooltipBg!: Phaser.GameObjects.Rectangle;
  private tick = 0;
  private connected = false;
  private terrainLoaded = false;
  private zoneId = "human-meadow";
  private unsubscribeSwitchZone: (() => void) | null = null;

  /** Dynamic min zoom */
  private minZoom = 0.3;

  /** Spectate camera: follows this entity id, null = free cam */
  private followTarget: string | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private escKey!: Phaser.Input.Keyboard.Key;

  /** Chunk streaming mode enabled */
  private chunkStreamingEnabled = false;
  private tileSize = 10;

  constructor() {
    super({ key: "WorldScene" });
  }

  create(): void {
    registerEntitySprites(this);

    this.tilemapRenderer = new TilemapRenderer(this);
    this.entityRenderer = new EntityRenderer(this);
    this.chunkManager = new ChunkStreamManager(this.zoneId, this.tileSize);

    // Wire chunk manager to tilemap renderer
    this.chunkManager.onChunkLoaded = (chunk) => {
      this.tilemapRenderer.addChunk(chunk);
    };
    this.chunkManager.onChunkUnloaded = (cx, cz) => {
      this.tilemapRenderer.removeChunk(cx, cz);
    };

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

      // Spectate: click any entity -> snap camera, then follow
      this.followTarget = entity.id;
      this.isDragging = false;
      const px = entity.x * this.tilemapRenderer.coordScale;
      const py = entity.y * this.tilemapRenderer.coordScale;
      this.cameras.main.centerOn(px, py);
    });

    // Camera + input
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

    this.tooltipBg = this.add
      .rectangle(0, 0, 200, 100, 0x0a0e1a, 0.92)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(200)
      .setStrokeStyle(2, 0x00ff88)
      .setVisible(false);

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

    // Handle window resize
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (this.terrainLoaded && !this.chunkStreamingEnabled) {
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

    // Initial load -- try chunk streaming, fall back to legacy
    void this.initChunkStreaming(this.zoneId);
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
      const spritePos = this.entityRenderer.getSpritePosition(this.followTarget);
      if (spritePos) {
        cam.centerOn(spritePos.x, spritePos.y);
      } else {
        this.followTarget = null;
      }
    }

    // Update chunk streaming based on camera position
    if (this.chunkStreamingEnabled) {
      const cameraCenterX = cam.scrollX + cam.width / (2 * cam.zoom);
      const cameraCenterY = cam.scrollY + cam.height / (2 * cam.zoom);
      const worldX = cameraCenterX / this.tilemapRenderer.coordScale;
      const worldZ = cameraCenterY / this.tilemapRenderer.coordScale;
      this.chunkManager.update(worldX, worldZ);
    }

    // Build HUD text
    const followName = this.followTarget
      ? this.entityRenderer.getEntity(this.followTarget)?.name ?? "?"
      : null;

    const chunkInfo = this.chunkStreamingEnabled
      ? `Chunks: ${this.tilemapRenderer.renderedChunkCount}`
      : "";

    this.hud.setText(
      [
        `Zone: ${this.zoneId}`,
        `Tick: ${this.tick}`,
        `Entities: ${this.entityRenderer.entityCount}`,
        `Zoom: ${cam.zoom.toFixed(1)}x`,
        chunkInfo,
        "",
        followName ? `Following: ${followName} | ESC: free cam` : "Click entity to spectate",
        "Drag/Arrows: pan | Scroll: zoom",
        this.terrainLoaded ? "" : "Loading terrain...",
        this.connected ? "" : "Connecting...",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    this.updateTooltip();
  }

  private updateTooltip(): void {
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
    const hoveredEntity = this.entityRenderer.getEntityAt(worldPoint.x, worldPoint.y, 16);

    if (hoveredEntity) {
      const lines: string[] = [];
      const e = hoveredEntity;

      const typeTag = this.entityTypeTag(e.type);
      lines.push(e.name);
      lines.push(typeTag);

      if (e.raceId || e.classId) {
        const race = e.raceId ? capitalize(e.raceId) : "";
        const cls = e.classId ? capitalize(e.classId) : "";
        lines.push(`${race} ${cls}`.trim());
      }

      lines.push("");

      const hpRatio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
      const hpBarFill = Math.round(hpRatio * 10);
      const hpBar = "#".repeat(hpBarFill) + "-".repeat(10 - hpBarFill);
      lines.push(`HP [${hpBar}] ${e.hp}/${e.maxHp}`);

      if (e.essence !== undefined && e.maxEssence && e.maxEssence > 0) {
        const esRatio = e.essence / e.maxEssence;
        const esFill = Math.round(esRatio * 10);
        const esBar = "*".repeat(esFill) + "-".repeat(10 - esFill);
        lines.push(`ES [${esBar}] ${e.essence}/${e.maxEssence}`);
      }

      if (e.level) {
        let lvlLine = `Lv.${e.level}`;
        if (e.xp !== undefined) lvlLine += `  XP:${e.xp}`;
        lines.push(lvlLine);
      }

      if (e.effectiveStats) {
        const s = e.effectiveStats;
        lines.push("");
        lines.push(`STR ${pad(s.str)} DEF ${pad(s.def)}`);
        lines.push(`INT ${pad(s.int)} AGI ${pad(s.agi)}`);
        lines.push(`FAI ${pad(s.faith)} LCK ${pad(s.luck)}`);
      }

      if (e.equipment) {
        const equipped = Object.keys(e.equipment).filter(
          (slot) => e.equipment![slot as keyof typeof e.equipment] != null
        );
        if (equipped.length > 0) {
          lines.push("");
          lines.push(`Gear: ${equipped.length} items`);
        }
      }

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

      if (e.type === "player") {
        lines.push("", "[Click] Spectate");
      }

      const text = lines.join("\n");
      this.tooltip.setText(text);

      const tooltipX = Math.min(pointer.x + 15, cam.width - 220);
      const tooltipY = Math.min(pointer.y + 15, cam.height - 200);

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

    if (this.chunkStreamingEnabled) {
      this.chunkManager.setZone(zoneId);
      // Force chunk reload at zone center
      void this.reloadChunksForZone(zoneId);
    } else {
      void this.loadZoneTerrain(zoneId);
    }

    void this.pollZone();
  }

  private async reloadChunksForZone(zoneId: string): Promise<void> {
    const info = await fetchZoneChunkInfo(zoneId);
    if (!info || zoneId !== this.zoneId) return;

    const zonePixelW = info.width * CLIENT_TILE_PX;
    const zonePixelH = info.height * CLIENT_TILE_PX;
    const cam = this.cameras.main;
    cam.centerOn(zonePixelW / 2, zonePixelH / 2);

    const worldCenterX = (info.width * info.tileSize) / 2;
    const worldCenterZ = (info.height * info.tileSize) / 2;
    this.chunkManager.update(worldCenterX, worldCenterZ);
    this.terrainLoaded = true;
  }

  /** Initialize chunk streaming for a zone */
  private async initChunkStreaming(zoneId: string): Promise<void> {
    const zoneInfo = await fetchZoneChunkInfo(zoneId);

    if (!zoneInfo) {
      console.log("[WorldScene] Chunk API unavailable, using legacy zone loading");
      void this.loadZoneTerrain(zoneId);
      return;
    }

    this.tileSize = zoneInfo.tileSize;
    this.chunkStreamingEnabled = true;

    this.tilemapRenderer.initChunkMode(zoneInfo.tileSize);
    this.entityRenderer.setCoordScale(this.tilemapRenderer.coordScale);

    this.chunkManager = new ChunkStreamManager(zoneId, zoneInfo.tileSize);
    this.chunkManager.onChunkLoaded = (chunk) => {
      this.tilemapRenderer.addChunk(chunk);
    };
    this.chunkManager.onChunkUnloaded = (cx, cz) => {
      this.tilemapRenderer.removeChunk(cx, cz);
    };

    // No camera bounds in chunk mode -- seamless scrolling
    this.cameras.main.removeBounds();
    this.minZoom = 0.3;

    // Center camera on zone
    const zonePixelW = zoneInfo.width * CLIENT_TILE_PX;
    const zonePixelH = zoneInfo.height * CLIENT_TILE_PX;
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(ZOOM_DEFAULT, this.minZoom, ZOOM_MAX));
    cam.centerOn(zonePixelW / 2, zonePixelH / 2);

    // Initial chunk load
    const worldCenterX = (zoneInfo.width * zoneInfo.tileSize) / 2;
    const worldCenterZ = (zoneInfo.height * zoneInfo.tileSize) / 2;
    this.chunkManager.update(worldCenterX, worldCenterZ);

    this.terrainLoaded = true;
    console.log(`[WorldScene] Chunk streaming: ${zoneInfo.chunksX}x${zoneInfo.chunksZ} chunks`);
  }

  private async loadZoneTerrain(zoneId: string): Promise<void> {
    await this.tilemapRenderer.loadZone(zoneId);
    if (zoneId !== this.zoneId) return;

    this.terrainLoaded = true;
    this.entityRenderer.setCoordScale(this.tilemapRenderer.coordScale);
    this.updateCameraBounds();

    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(ZOOM_DEFAULT, this.minZoom, ZOOM_MAX));
    cam.centerOn(w / 2, h / 2);
  }

  private updateCameraBounds(): void {
    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    if (w <= 0 || h <= 0) return;

    const cam = this.cameras.main;
    this.minZoom = Math.max(cam.width / w, cam.height / h);

    if (cam.zoom < this.minZoom) {
      cam.setZoom(this.minZoom);
    }

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
