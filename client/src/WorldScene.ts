import Phaser from "phaser";

import { CAMERA_SPEED, POLL_INTERVAL, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT, CLIENT_TILE_PX } from "@/config";
import { EntityRenderer } from "@/EntityRenderer";
import { TilemapRenderer } from "@/TilemapRenderer";
import { ChunkStreamManager } from "@/ChunkStreamManager";
import { WorldLayoutManager } from "@/WorldLayoutManager";
import { fetchZone, fetchZoneChunkInfo } from "@/ShardClient";
import type { Entity } from "@/types";
import { gameBus } from "@/lib/eventBus";
import { registerEntitySprites } from "@/EntitySpriteGenerator";
import { preloadOverworld } from "@/OverworldAtlas";

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
  private worldLayout!: WorldLayoutManager;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private hud!: Phaser.GameObjects.Text;
  private tooltip!: Phaser.GameObjects.Text;
  private tooltipBg!: Phaser.GameObjects.Rectangle;
  private tick = 0;
  private connected = false;
  private terrainLoaded = false;
  private currentZoneLabel = "";
  private unsubscribeSwitchZone: (() => void) | null = null;

  /** Dynamic min zoom */
  private minZoom = 0.3;

  /** Spectate camera: follows this entity id, null = free cam */
  private followTarget: string | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private escKey!: Phaser.Input.Keyboard.Key;

  /** Tooltip stickiness: keep showing same entity until cursor moves far away */
  private tooltipEntityId: string | null = null;

  /** Multi-zone streaming active */
  private chunkStreamingEnabled = false;

  constructor() {
    super({ key: "WorldScene" });
  }

  preload(): void {
    preloadOverworld(this);
    // Character sprite sheets (3 skins)
    this.load.image("char-sheet-a", "/sprites/character.png");
    this.load.image("char-sheet-b", "/sprites/characterB.png");
    this.load.image("char-sheet-c", "/sprites/characterC.png");
  }

  create(): void {
    registerEntitySprites(this);

    this.worldLayout = new WorldLayoutManager();
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

      // Inspect: open inspect panel for players, mobs, and bosses
      if (entity.type === "player" || entity.type === "mob" || entity.type === "boss") {
        gameBus.emit("entityInspect", { entityId: entity.id, zoneId: this.currentZoneLabel });
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

    // Handle zone switching from ZoneSelector — scroll camera to zone center
    this.unsubscribeSwitchZone = gameBus.on("switchZone", ({ zoneId }) => {
      this.scrollToZone(zoneId);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeSwitchZone?.();
      this.unsubscribeSwitchZone = null;
    });

    // Initialize seamless world
    void this.initSeamlessWorld();

    // Start multi-zone entity polling
    void this.pollAllZones();
    this.time.addEvent({
      delay: POLL_INTERVAL,
      callback: this.pollAllZones,
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
    if (this.chunkStreamingEnabled && this.chunkManager) {
      const cameraCenterX = cam.scrollX + cam.width / (2 * cam.zoom);
      const cameraCenterY = cam.scrollY + cam.height / (2 * cam.zoom);
      // Convert pixel coords to world game units
      const worldX = cameraCenterX / this.tilemapRenderer.coordScale;
      const worldZ = cameraCenterY / this.tilemapRenderer.coordScale;
      this.chunkManager.update(worldX, worldZ);

      // Update zone label based on camera center
      const zoneId = this.worldLayout.pixelToZone(cameraCenterX, cameraCenterY);
      this.currentZoneLabel = zoneId ?? "wilderness";
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
        `Zone: ${this.currentZoneLabel}`,
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
    // Hide tooltip while dragging the camera
    if (this.isDragging) {
      this.tooltip.setVisible(false);
      this.tooltipBg.setVisible(false);
      this.tooltipEntityId = null;
      return;
    }

    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);

    // Zoom-compensated radius: 16 world pixels at zoom 1, scales up when zoomed out
    // so entities are always easy to hover. Min 16, max 64 world pixels.
    const baseRadius = 16;
    const zoomRadius = Math.min(64, Math.max(baseRadius, baseRadius / cam.zoom));

    // If we're already showing a tooltip for an entity, use a larger sticky radius
    // to prevent flicker at entity edges
    const stickyRadius = zoomRadius * 1.5;
    let hoveredEntity: Entity | undefined;

    if (this.tooltipEntityId) {
      // Check if we're still close to the sticky entity
      const stickyEntity = this.entityRenderer.getEntity(this.tooltipEntityId);
      if (stickyEntity) {
        const spritePos = this.entityRenderer.getSpritePosition(this.tooltipEntityId);
        if (spritePos) {
          const dx = worldPoint.x - spritePos.x;
          const dy = worldPoint.y - spritePos.y;
          if (dx * dx + dy * dy <= stickyRadius * stickyRadius) {
            hoveredEntity = stickyEntity;
          }
        }
      }
    }

    // If sticky check failed, do a normal closest-entity search
    if (!hoveredEntity) {
      hoveredEntity = this.entityRenderer.getEntityAt(worldPoint.x, worldPoint.y, zoomRadius);
    }

    if (hoveredEntity) {
      this.tooltipEntityId = hoveredEntity.id;
      const text = this.buildTooltipText(hoveredEntity);
      this.tooltip.setText(text);

      // Measure actual tooltip size before positioning
      const bounds = this.tooltip.getBounds();
      const tw = bounds.width + 12;
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
      this.tooltipEntityId = null;
      this.tooltip.setVisible(false);
      this.tooltipBg.setVisible(false);
    }
  }

  /** Build tooltip text for an entity — consolidated, all info in one place. */
  private buildTooltipText(e: Entity): string {
    const lines: string[] = [];

    // Header: name + type tag
    lines.push(e.name);
    lines.push(this.entityTypeTag(e.type));

    // Race / class
    if (e.raceId || e.classId) {
      const race = e.raceId ? capitalize(e.raceId) : "";
      const cls = e.classId ? capitalize(e.classId) : "";
      lines.push(`${race} ${cls}`.trim());
    }

    lines.push("");

    // HP bar
    const hpRatio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    const hpBarFill = Math.round(hpRatio * 10);
    const hpBar = "#".repeat(hpBarFill) + "-".repeat(10 - hpBarFill);
    lines.push(`HP [${hpBar}] ${e.hp}/${e.maxHp}`);

    // Essence bar
    if (e.essence !== undefined && e.maxEssence && e.maxEssence > 0) {
      const esRatio = e.essence / e.maxEssence;
      const esFill = Math.round(esRatio * 10);
      const esBar = "*".repeat(esFill) + "-".repeat(10 - esFill);
      lines.push(`ES [${esBar}] ${e.essence}/${e.maxEssence}`);
    }

    // Level + XP
    if (e.level) {
      let lvlLine = `Lv.${e.level}`;
      if (e.xp !== undefined) lvlLine += `  XP:${e.xp}`;
      lines.push(lvlLine);
    }

    // Stats
    if (e.effectiveStats) {
      const s = e.effectiveStats;
      lines.push("");
      lines.push(`STR ${pad(s.str)} DEF ${pad(s.def)}`);
      lines.push(`INT ${pad(s.int)} AGI ${pad(s.agi)}`);
      lines.push(`FAI ${pad(s.faith)} LCK ${pad(s.luck)}`);
    }

    // Equipment summary
    if (e.equipment) {
      const equipped = Object.keys(e.equipment).filter(
        (slot) => e.equipment![slot as keyof typeof e.equipment] != null,
      );
      if (equipped.length > 0) {
        lines.push("");
        lines.push(`Gear: ${equipped.length} items`);
      }
    }

    // Party members
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

    // NPC interaction hints
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
      lines.push("");
      if (e.xpReward) lines.push(`XP reward: ${e.xpReward}`);
      lines.push("[Click] Inspect");
    } else if (e.type === "player") {
      lines.push("", "[Click] Inspect & Spectate");
    }

    return lines.join("\n");
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

  /** Scroll camera to a zone's center (called by ZoneSelector) */
  private scrollToZone(zoneId: string): void {
    if (!this.worldLayout.loaded) return;
    const center = this.worldLayout.getZonePixelCenter(zoneId);
    this.cameras.main.centerOn(center.x, center.z);
    this.followTarget = null;
    this.currentZoneLabel = zoneId;
    gameBus.emit("zoneChanged", { zoneId });
  }

  /** Initialize seamless multi-zone world */
  private async initSeamlessWorld(): Promise<void> {
    // Fetch world layout
    const loaded = await this.worldLayout.load();
    if (!loaded || !this.worldLayout.data) {
      console.warn("[WorldScene] World layout unavailable, falling back to legacy");
      void this.initLegacyFallback();
      return;
    }

    const layoutData = this.worldLayout.data;

    // Probe one zone for chunk info (tileSize)
    const firstZoneId = this.worldLayout.getZoneIds()[0];
    const zoneInfo = firstZoneId ? await fetchZoneChunkInfo(firstZoneId) : null;

    if (!zoneInfo) {
      console.warn("[WorldScene] Chunk API unavailable, falling back to legacy");
      void this.initLegacyFallback();
      return;
    }

    this.chunkStreamingEnabled = true;

    // Init tilemap renderer in chunk mode
    this.tilemapRenderer.setWorldLayout(this.worldLayout);
    this.tilemapRenderer.initChunkMode(zoneInfo.tileSize);
    this.entityRenderer.setCoordScale(this.tilemapRenderer.coordScale);
    this.entityRenderer.setElevationQuery((wx, wz) =>
      this.tilemapRenderer.getElevationAt(wx, wz)
    );

    // Create multi-zone chunk manager
    this.chunkManager = new ChunkStreamManager(layoutData, zoneInfo.tileSize);
    this.chunkManager.onChunkLoaded = (chunk) => {
      this.tilemapRenderer.addChunk(chunk);
    };
    this.chunkManager.onChunkUnloaded = (key) => {
      this.tilemapRenderer.removeChunk(key);
    };

    // No camera bounds — seamless scrolling
    this.cameras.main.removeBounds();
    this.minZoom = 0.15;

    // Center camera on world center
    const worldCenter = this.worldLayout.getWorldPixelCenter();
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(ZOOM_DEFAULT, this.minZoom, ZOOM_MAX));
    cam.centerOn(worldCenter.x, worldCenter.z);

    // Initial chunk load at world center
    const worldCenterGameX = layoutData.totalSize.width / 2;
    const worldCenterGameZ = layoutData.totalSize.height / 2;
    this.chunkManager.update(worldCenterGameX, worldCenterGameZ);

    this.terrainLoaded = true;
    this.currentZoneLabel = this.worldLayout.pixelToZone(worldCenter.x, worldCenter.z) ?? "world";

    gameBus.emit("zoneChanged", { zoneId: this.currentZoneLabel });
    console.log(
      `[WorldScene] Seamless world initialized: ${this.worldLayout.getZoneIds().length} zones`
    );
  }

  /** Fallback to legacy single-zone loading if world layout unavailable */
  private async initLegacyFallback(): Promise<void> {
    const zoneId = "village-square";
    this.currentZoneLabel = zoneId;
    gameBus.emit("zoneChanged", { zoneId });

    await this.tilemapRenderer.loadZone(zoneId);
    this.terrainLoaded = true;
    this.entityRenderer.setCoordScale(this.tilemapRenderer.coordScale);
    this.entityRenderer.setElevationQuery((wx, wz) =>
      this.tilemapRenderer.getElevationAt(wx, wz)
    );

    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    const cam = this.cameras.main;
    this.minZoom = Math.max(cam.width / w, cam.height / h);
    cam.setZoom(Phaser.Math.Clamp(ZOOM_DEFAULT, this.minZoom, ZOOM_MAX));
    cam.setBounds(0, 0, w, h);
    cam.centerOn(w / 2, h / 2);
  }

  /** Poll all zones for entities, offset to world coordinates */
  private async pollAllZones(): Promise<void> {
    if (!this.worldLayout.loaded) {
      // Fallback: poll single zone
      const data = await fetchZone(this.currentZoneLabel || "village-square");
      if (data) {
        this.connected = true;
        this.tick = data.tick;
        this.entityRenderer.update(data.entities);
      } else {
        this.connected = false;
      }
      return;
    }

    const zoneIds = this.worldLayout.getZoneIds();
    const allEntities: Record<string, Entity> = {};
    let anyConnected = false;
    let maxTick = 0;

    // Fetch all zones in parallel
    const results = await Promise.all(
      zoneIds.map(async (zoneId) => {
        const data = await fetchZone(zoneId);
        return { zoneId, data };
      })
    );

    for (const { zoneId, data } of results) {
      if (!data) continue;
      anyConnected = true;
      if (data.tick > maxTick) maxTick = data.tick;

      const zone = this.worldLayout.getZone(zoneId);
      if (!zone) continue;

      // Offset entity positions from zone-local to world coordinates
      for (const [id, entity] of Object.entries(data.entities)) {
        allEntities[id] = {
          ...entity,
          x: entity.x + zone.offset.x,
          y: entity.y + zone.offset.z,
        };
      }
    }

    this.connected = anyConnected;
    this.tick = maxTick;
    this.entityRenderer.update(allEntities);
  }
}
