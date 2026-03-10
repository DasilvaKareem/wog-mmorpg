import Phaser from "phaser";

import { CAMERA_SPEED, POLL_INTERVAL, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT } from "@/config";
import { EntityRenderer } from "@/EntityRenderer";
import { TilemapRenderer } from "@/TilemapRenderer";
import { ChunkStreamManager } from "@/ChunkStreamManager";
import { WorldLayoutManager } from "@/WorldLayoutManager";
import { AbilityEffectsLayer } from "@/AbilityEffectsLayer";
import { FloatingTextLayer } from "@/FloatingTextLayer";
import { fetchZone, fetchZoneChunkInfo } from "@/ShardClient";
import type { Entity } from "@/types";
import { gameBus } from "@/lib/eventBus";
import { registerEntitySprites } from "@/EntitySpriteGenerator";
import { preloadOverworld } from "@/OverworldAtlas";
import { preloadLayerSprites } from "@/LayeredSpriteCompositor";

/** Zoom threshold below which the strategic overview renders instead of tiles */
const OVERVIEW_ENTER = 0.38;
/** Zoom threshold above which tiles resume (hysteresis prevents flicker) */
const OVERVIEW_EXIT = 0.48;

/** Known zone adjacency for overview connection lines */
const ZONE_CONNECTIONS: [string, string][] = [
  ["village-square",  "wild-meadow"],
  ["wild-meadow",     "dark-forest"],
  ["wild-meadow",     "auroral-plains"],
  ["dark-forest",     "auroral-plains"],
  ["dark-forest",     "emerald-woods"],
  ["emerald-woods",   "viridian-range"],
  ["emerald-woods",   "moondancer-glade"],
  ["viridian-range",  "felsrock-citadel"],
  ["moondancer-glade","felsrock-citadel"],
  ["felsrock-citadel","lake-lumina"],
  ["lake-lumina",     "azurshard-chasm"],
];

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
  private abilityLayer!: AbilityEffectsLayer;
  private floatingText!: FloatingTextLayer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private hud!: Phaser.GameObjects.Text;
  private tooltip!: Phaser.GameObjects.Text;
  private tooltipBg!: Phaser.GameObjects.Rectangle;
  private tick = 0;
  private connected = false;
  private terrainLoaded = false;
  private currentZoneLabel = "";
  private unsubscribeSwitchZone: (() => void) | null = null;

  /** Centralized event dedup — every event ID processed at most once.
   *  Stores event ID → timestamp so we can evict only stale entries. */
  private processedEvents = new Map<string, number>();

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
  private lastTooltipUpdateAt = 0;
  private lastHudUpdateAt = 0;

  /** Multi-zone streaming active */
  private chunkStreamingEnabled = false;

  /** Wallet address we're locking the camera to */
  private lockedWalletAddress: string | null = null;
  private unsubscribeLockToPlayer: (() => void) | null = null;
  private unsubscribeFocusEntity: (() => void) | null = null;
  private touchMode = false;
  private mobileMode = false;
  private lastPinchDistance: number | null = null;
  private pollInFlight = false;
  private pollDelayMs = POLL_INTERVAL;

  // LOD overview mode — rendered when zoom drops below OVERVIEW_ENTER
  private overviewMode = false;
  private overviewGraphics: Phaser.GameObjects.Graphics | null = null;
  private overviewDotGraphics: Phaser.GameObjects.Graphics | null = null;
  private overviewLabels: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: "WorldScene" });
  }

  preload(): void {
    preloadOverworld(this);
    // Character sprite sheets (3 skins)
    this.load.image("char-sheet-a", "/sprites/character.png");
    this.load.image("char-sheet-b", "/sprites/characterB.png");
    this.load.image("char-sheet-c", "/sprites/characterC.png");

    // Layered character sprite sheets
    preloadLayerSprites(this);
  }

  create(): void {
    const hasWindow = typeof window !== "undefined";
    const coarsePointer = hasWindow && window.matchMedia("(pointer: coarse)").matches;
    const noHover = hasWindow && window.matchMedia("(hover: none)").matches;
    const smallViewport = hasWindow && window.innerWidth < 1024;
    this.touchMode = coarsePointer || noHover;
    this.mobileMode = this.touchMode || smallViewport;
    this.pollDelayMs = this.mobileMode ? Math.max(POLL_INTERVAL, 2500) : POLL_INTERVAL;

    // Enable second touch pointer for pinch gestures.
    this.input.addPointer(1);

    registerEntitySprites(this);

    this.worldLayout = new WorldLayoutManager();
    this.tilemapRenderer = new TilemapRenderer(this);
    this.entityRenderer = new EntityRenderer(this);
    this.abilityLayer = new AbilityEffectsLayer(this);
    this.floatingText = new FloatingTextLayer(this);

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
        gameBus.emit("entityInspect", { entityId: entity.id, zoneId: entity.zoneId ?? this.currentZoneLabel });
      }

      // NPC info panel for NPCs without dedicated dialogs
      const NPC_INFO_TYPES = new Set([
        "quest-giver", "trainer", "profession-trainer", "lore-npc",
        "crafting-master", "forge", "alchemy-lab", "enchanting-altar",
        "tanning-rack", "jewelers-bench", "campfire", "essence-forge",
      ]);
      if (NPC_INFO_TYPES.has(entity.type)) {
        gameBus.emit("npcInfoClick", entity);
      }

      // Agent go-to: clicking any NPC lets the user send their agent there
      const NPC_TYPES = new Set([
        "merchant", "auctioneer", "guild-registrar", "arena-master",
        "quest-giver", "lore-npc", "crafting-master", "blacksmith", "innkeeper",
      ]); // trainer + profession-trainer handled by NpcInfoDialog (has Learn buttons)
      if (NPC_TYPES.has(entity.type)) {
        gameBus.emit("agentGoToNpc", {
          entityId: entity.id,
          zoneId: entity.zoneId ?? this.currentZoneLabel,
          name: entity.name,
          type: entity.type,
          teachesProfession: (entity as any).teachesProfession,
        });
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
      if (this.touchMode && this.input.pointer1.isDown && this.input.pointer2.isDown) return;
      if (!pointer.isDown) return;
      const movedX = Math.abs(pointer.x - this.dragStartX);
      const movedY = Math.abs(pointer.y - this.dragStartY);
      const dragThreshold = this.touchMode ? 8 : 4;
      if (!this.isDragging && movedX < dragThreshold && movedY < dragThreshold) return;
      this.isDragging = true;
      this.releaseFollow();
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

    if (this.mobileMode) {
      this.hud.setVisible(false);
      this.tooltip.setVisible(false);
      this.tooltipBg.setVisible(false);
    }

    // Handle zone switching from ZoneSelector — scroll camera to zone center
    this.unsubscribeSwitchZone = gameBus.on("switchZone", ({ zoneId }) => {
      this.scrollToZone(zoneId);
    });

    // Lock camera to a player entity by wallet address
    this.unsubscribeLockToPlayer = gameBus.on("lockToPlayer", ({ walletAddress }) => {
      this.lockedWalletAddress = walletAddress.toLowerCase();
      this.lockToPlayerWallet(walletAddress);
    });

    // Pan + lock camera to any entity by its entity ID (e.g. from zone log click)
    this.unsubscribeFocusEntity = gameBus.on("focusEntity", ({ entityId }) => {
      this.lockedWalletAddress = null;
      this.followTarget = entityId;
      this.isDragging = false;
      const spritePos = this.entityRenderer.getSpritePosition(entityId);
      if (spritePos) {
        this.cameras.main.centerOn(spritePos.x, spritePos.y);
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeSwitchZone?.();
      this.unsubscribeSwitchZone = null;
      this.unsubscribeLockToPlayer?.();
      this.unsubscribeLockToPlayer = null;
      this.unsubscribeFocusEntity?.();
      this.unsubscribeFocusEntity = null;
    });

    // Initialize seamless world
    void this.initSeamlessWorld();

    // Start multi-zone entity polling
    void this.pollAllZones();
    this.time.addEvent({
      delay: this.pollDelayMs,
      callback: this.pollAllZones,
      callbackScope: this,
      loop: true,
    });
  }

  /** Release camera tracking entirely (ESC, arrow keys, drag) */
  private releaseFollow(): void {
    this.followTarget = null;
    this.lockedWalletAddress = null;
  }

  update(): void {
    // ESC releases spectate
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.releaseFollow();
    }

    const cam = this.cameras.main;
    const now = this.time.now;

    this.updatePinchZoom();

    // Arrow key pan (releases spectate)
    if (this.cursors.left.isDown || this.cursors.right.isDown ||
        this.cursors.up.isDown || this.cursors.down.isDown) {
      this.releaseFollow();
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
      } else if (!this.lockedWalletAddress) {
        // Only clear follow target if we're not waiting for a wallet-locked entity to spawn
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

    // LOD: switch to/from strategic overview based on zoom level
    if (this.chunkStreamingEnabled) {
      const zoom = cam.zoom;
      if (!this.overviewMode && zoom < OVERVIEW_ENTER) {
        this.enterOverviewMode();
      } else if (this.overviewMode && zoom > OVERVIEW_EXIT) {
        this.exitOverviewMode();
      } else if (this.overviewMode) {
        this.updateOverviewDots();
      }
    }

    if (!this.mobileMode && now - this.lastHudUpdateAt >= 150) {
      const followName = this.followTarget
        ? this.entityRenderer.getEntity(this.followTarget)?.name ?? "?"
        : null;

      this.hud.setText(
        [
          followName ? `Following: ${followName} | ESC: free cam` : "",
          this.terrainLoaded ? "" : "Loading terrain...",
          this.connected ? "" : "Connecting...",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      this.lastHudUpdateAt = now;
    }

    if (!this.touchMode && now - this.lastTooltipUpdateAt >= 120) {
      this.updateTooltip();
      this.lastTooltipUpdateAt = now;
    }
  }

  private updatePinchZoom(): void {
    if (!this.touchMode) return;

    const p1 = this.input.pointer1;
    const p2 = this.input.pointer2;
    if (!p1 || !p2) return;

    if (p1.isDown && p2.isDown) {
      const distance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      if (this.lastPinchDistance !== null) {
        const delta = distance - this.lastPinchDistance;
        if (Math.abs(delta) > 1) {
          const cam = this.cameras.main;
          const nextZoom = Phaser.Math.Clamp(
            cam.zoom + delta * 0.003,
            this.minZoom,
            ZOOM_MAX,
          );
          cam.setZoom(nextZoom);
        }
      }
      this.lastPinchDistance = distance;
      this.isDragging = false;
      return;
    }

    this.lastPinchDistance = null;
  }

  private updateTooltip(): void {
    if (this.touchMode) {
      this.tooltip.setVisible(false);
      this.tooltipBg.setVisible(false);
      this.tooltipEntityId = null;
      return;
    }

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

  /**
   * Lock camera to the entity owned by the given wallet address.
   * Safe to call every poll cycle — silently does nothing if entity not found.
   */
  lockToPlayerWallet(walletAddress: string): void {
    const normalized = walletAddress.toLowerCase();
    for (const [id, entity] of this.entityRenderer.getEntities()) {
      if (entity.walletAddress?.toLowerCase() === normalized) {
        this.followTarget = id;
        this.isDragging = false;
        const spritePos = this.entityRenderer.getSpritePosition(id);
        if (spritePos) {
          this.cameras.main.centerOn(spritePos.x, spritePos.y);
        }
        return;
      }
    }
    // Entity not in current zone yet — no-op (will retry on next poll)
  }

  /** Scroll camera to a zone's center (called by ZoneSelector) */
  private scrollToZone(zoneId: string): void {
    if (!this.worldLayout.loaded) return;
    const center = this.worldLayout.getZonePixelCenter(zoneId);
    this.cameras.main.centerOn(center.x, center.z);
    this.releaseFollow();
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
    this.tilemapRenderer.initChunkMode(zoneInfo.tileSize, { lowPower: this.mobileMode });
    this.entityRenderer.setCoordScale(this.tilemapRenderer.coordScale);
    this.entityRenderer.setElevationQuery((wx, wz) =>
      this.tilemapRenderer.getElevationAt(wx, wz)
    );
    this.abilityLayer.setCoordScale(this.tilemapRenderer.coordScale);

    // Create multi-zone chunk manager
    this.chunkManager = new ChunkStreamManager(
      layoutData,
      zoneInfo.tileSize,
      this.mobileMode ? 1 : 2,
    );
    this.chunkManager.onChunkLoaded = (chunk) => {
      this.tilemapRenderer.addChunk(chunk);
    };
    this.chunkManager.onChunkUnloaded = (key) => {
      this.tilemapRenderer.removeChunk(key);
    };

    // No camera bounds — seamless scrolling
    this.cameras.main.removeBounds();
    this.minZoom = this.mobileMode ? 0.2 : 0.15;

    // Center camera on world center
    const worldCenter = this.worldLayout.getWorldPixelCenter();
    const cam = this.cameras.main;
    const startZoom = this.mobileMode ? 1.7 : ZOOM_DEFAULT;
    cam.setZoom(Phaser.Math.Clamp(startZoom, this.minZoom, ZOOM_MAX));
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
    this.abilityLayer.setCoordScale(this.tilemapRenderer.coordScale);

    const { worldPixelW: w, worldPixelH: h } = this.tilemapRenderer;
    const cam = this.cameras.main;
    this.minZoom = Math.max(cam.width / w, cam.height / h);
    cam.setZoom(Phaser.Math.Clamp(ZOOM_DEFAULT, this.minZoom, ZOOM_MAX));
    cam.setBounds(0, 0, w, h);
    cam.centerOn(w / 2, h / 2);
  }

  // ─── LOD Strategic Overview Mode ─────────────────────────────────────────

  /** Map a zone's level requirement to a fill/stroke color */
  private zoneLevelColor(levelReq: number): number {
    if (levelReq <= 1)  return 0x4CAF50;  // green       — village-square
    if (levelReq <= 5)  return 0x8BC34A;  // light green — wild-meadow
    if (levelReq <= 10) return 0x2E7D32;  // dark green  — dark-forest
    if (levelReq <= 15) return 0x7E57C2;  // purple      — auroral-plains
    if (levelReq <= 20) return 0x00897B;  // teal        — emerald-woods
    if (levelReq <= 25) return 0x1565C0;  // blue        — viridian-range
    if (levelReq <= 30) return 0x6A1B9A;  // deep purple — moondancer-glade
    if (levelReq <= 35) return 0xB71C1C;  // dark red    — felsrock-citadel
    if (levelReq <= 40) return 0x0277BD;  // ocean blue  — lake-lumina
    return 0x4A148C;                       // violet      — azurshard-chasm
  }

  /** Build static zone rectangles and connection lines for the overview */
  private buildOverviewGraphics(): void {
    this.overviewGraphics?.destroy();
    for (const lbl of this.overviewLabels) lbl.destroy();
    this.overviewLabels = [];

    if (!this.worldLayout.loaded) return;

    const g = this.add.graphics();
    g.setDepth(50);
    this.overviewGraphics = g;

    // Connection lines (drawn first, behind zone fills)
    g.lineStyle(2, 0x3a4260, 0.8);
    for (const [a, b] of ZONE_CONNECTIONS) {
      const za = this.worldLayout.getZone(a);
      const zb = this.worldLayout.getZone(b);
      if (!za || !zb) continue;
      const ca = this.worldLayout.getZonePixelCenter(a);
      const cb = this.worldLayout.getZonePixelCenter(b);
      g.beginPath();
      g.moveTo(ca.x, ca.z);
      g.lineTo(cb.x, cb.z);
      g.strokePath();
    }

    // Zone rectangles + labels
    for (const zoneId of this.worldLayout.getZoneIds()) {
      const zone = this.worldLayout.getZone(zoneId);
      if (!zone) continue;

      const offset = this.worldLayout.getZonePixelOffset(zoneId);
      const pixW = zone.size.width * this.tilemapRenderer.coordScale;
      const pixH = zone.size.height * this.tilemapRenderer.coordScale;
      const color = this.zoneLevelColor(zone.levelReq);

      g.fillStyle(color, 0.22);
      g.fillRect(offset.x, offset.z, pixW, pixH);
      g.lineStyle(2, color, 0.75);
      g.strokeRect(offset.x, offset.z, pixW, pixH);

      const center = this.worldLayout.getZonePixelCenter(zoneId);
      const colorHex = `#${color.toString(16).padStart(6, "0")}`;

      // Zone name
      const nameLabel = this.add
        .text(center.x, center.z - 14, zoneId.replace(/-/g, " ").toUpperCase(), {
          fontSize: "13px",
          fontFamily: "monospace",
          color: colorHex,
          stroke: "#000000",
          strokeThickness: 3,
          align: "center",
        })
        .setOrigin(0.5, 0.5)
        .setDepth(51);
      this.overviewLabels.push(nameLabel);

      // Level badge
      const levelLabel = this.add
        .text(center.x, center.z + 8, `L${zone.levelReq}+`, {
          fontSize: "11px",
          fontFamily: "monospace",
          color: "#888888",
          stroke: "#000000",
          strokeThickness: 2,
          align: "center",
        })
        .setOrigin(0.5, 0.5)
        .setDepth(51);
      this.overviewLabels.push(levelLabel);
    }
  }

  /** Redraw entity dots on the overview (called every update frame) */
  private updateOverviewDots(): void {
    if (!this.overviewDotGraphics) return;
    const g = this.overviewDotGraphics;
    g.clear();

    for (const [, entity] of this.entityRenderer.getEntities()) {
      let color: number;
      if (entity.type === "player")     color = 0x54f28b;
      else if (entity.type === "boss")  color = 0xff4444;
      else if (entity.type === "mob")   color = 0xff8800;
      else continue; // skip NPCs, nodes, etc.

      const px = entity.x * this.tilemapRenderer.coordScale;
      const py = entity.y * this.tilemapRenderer.coordScale;
      g.fillStyle(color, 0.9);
      g.fillCircle(px, py, 4);
    }
  }

  private enterOverviewMode(): void {
    if (this.overviewMode) return;
    this.overviewMode = true;
    this.tilemapRenderer.setChunksVisible(false);
    this.entityRenderer.setSpritesVisible(false);
    this.buildOverviewGraphics();
    this.overviewDotGraphics = this.add.graphics().setDepth(52);
    this.updateOverviewDots();
    console.log("[WorldScene] Entered overview mode");
  }

  private exitOverviewMode(): void {
    if (!this.overviewMode) return;
    this.overviewMode = false;
    this.tilemapRenderer.setChunksVisible(true);
    this.entityRenderer.setSpritesVisible(true);
    this.overviewGraphics?.destroy();
    this.overviewGraphics = null;
    this.overviewDotGraphics?.destroy();
    this.overviewDotGraphics = null;
    for (const lbl of this.overviewLabels) lbl.destroy();
    this.overviewLabels = [];
    console.log("[WorldScene] Exited overview mode");
  }

  // ─────────────────────────────────────────────────────────────────────────

  private getPollZoneIds(): string[] {
    if (!this.worldLayout.loaded) {
      return [this.currentZoneLabel || "village-square"];
    }

    const zoneIds = this.worldLayout.getZoneIds();
    if (!this.mobileMode) return zoneIds;

    const cam = this.cameras.main;
    const cameraCenterX = cam.scrollX + cam.width / (2 * cam.zoom);
    const cameraCenterY = cam.scrollY + cam.height / (2 * cam.zoom);

    const nearest = zoneIds
      .map((zoneId) => {
        const center = this.worldLayout.getZonePixelCenter(zoneId);
        const dx = center.x - cameraCenterX;
        const dy = center.z - cameraCenterY;
        return { zoneId, distSq: dx * dx + dy * dy };
      })
      .sort((a, b) => a.distSq - b.distSq);

    const selected = new Set<string>();
    const activeZone = this.worldLayout.pixelToZone(cameraCenterX, cameraCenterY);
    if (activeZone) selected.add(activeZone);
    if (this.currentZoneLabel) selected.add(this.currentZoneLabel);

    if (this.followTarget) {
      const followed = this.entityRenderer.getEntity(this.followTarget);
      if (followed?.zoneId) selected.add(followed.zoneId);
    }

    // Ensure spawn zone is polled when waiting for a wallet-locked entity
    if (this.lockedWalletAddress && !this.followTarget) {
      selected.add("village-square");
    }

    for (const zone of nearest.slice(0, 2)) {
      selected.add(zone.zoneId);
    }

    return Array.from(selected);
  }

  /**
   * Centralized event processor — deduplicates by event ID so each event
   * is dispatched to VFX/animations/floating text exactly once, regardless
   * of how many poll cycles it appears in.
   */
  private processEvents(
    events: import("./types").ZoneEvent[],
    pixelPositions: Map<string, { x: number; y: number }>,
  ): void {
    const now = Date.now();

    // Evict entries older than 6s (server window is 3s, 2x margin)
    if (this.processedEvents.size > 200) {
      const cutoff = now - 6_000;
      for (const [id, ts] of this.processedEvents) {
        if (ts < cutoff) this.processedEvents.delete(id);
      }
    }

    for (const evt of events) {
      if (this.processedEvents.has(evt.id)) continue;
      this.processedEvents.set(evt.id, now);

      const evtData = evt.data as Record<string, unknown> | undefined;

      // Ability VFX (particles)
      if (evt.type === "ability") {
        this.abilityLayer.playEffect(evt, pixelPositions);
      }

      // Death animation
      if (evt.type === "death" && evt.entityId) {
        const pos = pixelPositions.get(evt.entityId);
        if (pos) this.abilityLayer.playDeath(pos);
        this.entityRenderer.triggerDeath(evt.entityId);
      }

      // Level up animation
      if (evt.type === "levelup" && evt.entityId) {
        const pos = pixelPositions.get(evt.entityId);
        if (pos) this.abilityLayer.playLevelUp(pos);
        this.entityRenderer.triggerLevelUp(evt.entityId);
      }

      // Technique learned animation
      if (evt.type === "technique" && evt.entityId) {
        const pos = pixelPositions.get(evt.entityId);
        if (pos) this.abilityLayer.playTechniqueLearned(pos);
        const techName = (evtData)?.techniqueName as string | undefined;
        this.entityRenderer.triggerTechniqueLearned(evt.entityId, techName);
      }

      // Melee lunge animation
      const isMelee = evtData?.animStyle === "melee" || evt.type === "combat";
      if (isMelee && evt.entityId && evt.targetId) {
        this.entityRenderer.triggerMeleeAttack(evt.entityId, evt.targetId);
      }

      // Floating damage/heal numbers
      if ((evt.type === "combat" || evt.type === "ability") && evtData) {
        // Damage on target
        if (evtData.damage || evtData.dodged || evtData.blocked) {
          const pos = pixelPositions.get(evt.targetId ?? evt.entityId ?? "");
          if (pos) this.floatingText.showCombatText(evt.id + ":dmg", pos, evtData, evt.type);
        }
        // Heal on healed entity
        if (evtData.healing) {
          const healId = evt.targetId ?? evt.entityId;
          const pos = pixelPositions.get(healId ?? "");
          if (pos) this.floatingText.showCombatText(evt.id + ":heal", pos, { healing: evtData.healing }, "ability");
        }
      }

      // Speech bubbles for agent dialogue and NPC interactions
      if (evt.entityId) {
        if (evt.type === "chat") {
          // Agent dialogue — strip "Name: " prefix since bubble is above the entity
          const colonIdx = evt.message.indexOf(": ");
          const line = colonIdx > 0 ? evt.message.slice(colonIdx + 2) : evt.message;
          this.entityRenderer.showSpeechBubble(evt.entityId, line, 4000);
        } else if (evt.type === "quest") {
          const label = (evtData?.questTitle as string) ?? evt.message;
          this.entityRenderer.showSpeechBubble(evt.entityId, label, 3500);
        } else if (evt.type === "shop") {
          this.entityRenderer.showSpeechBubble(evt.entityId, evt.message, 2500);
        } else if (evt.type === "trade") {
          this.entityRenderer.showSpeechBubble(evt.entityId, evt.message, 2500);
        } else if (evt.type === "loot") {
          this.entityRenderer.showSpeechBubble(evt.entityId, evt.message, 2000);
        }
      }
    }
  }

  /** Poll all zones for entities, offset to world coordinates */
  private async pollAllZones(): Promise<void> {
    if (this.pollInFlight) return;
    this.pollInFlight = true;

    try {
      if (!this.worldLayout.loaded) {
        // Fallback: poll single zone
        const data = await fetchZone(this.currentZoneLabel || "village-square");
        if (data) {
          this.connected = true;
          this.tick = data.tick;
          this.entityRenderer.update(data.entities);
          const pixelPositions = this.entityRenderer.getPixelPositions();
          this.processEvents(data.recentEvents ?? [], pixelPositions);
        } else {
          this.connected = false;
        }
        return;
      }

      const zoneIds = this.getPollZoneIds();
      const allEntities: Record<string, Entity> = {};
      let anyConnected = false;
      let maxTick = 0;

      // Fetch polled zones in parallel
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
            zoneId,
          };
        }
      }

      this.connected = anyConnected;
      this.tick = maxTick;
      this.entityRenderer.update(allEntities);

      // Play VFX, animations, floating text — centralized dedup
      const pixelPositions = this.entityRenderer.getPixelPositions();
      for (const { data } of results) {
        this.processEvents(data?.recentEvents ?? [], pixelPositions);
      }

      // Re-apply wallet lock after each poll (entity may have just spawned)
      if (this.lockedWalletAddress) {
        this.lockToPlayerWallet(this.lockedWalletAddress);
      }
    } finally {
      this.pollInFlight = false;
    }
  }
}
