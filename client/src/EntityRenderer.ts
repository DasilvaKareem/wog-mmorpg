import Phaser from "phaser";
import type { Entity } from "./types.js";
import {
  getEntityTextureKey,
  inferDirection,
} from "./EntitySpriteGenerator.js";

interface EntityVisual {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBg: Phaser.GameObjects.Rectangle;
  partyRing: Phaser.GameObjects.Arc | null;
  lastX: number;
  lastY: number;
  facing: "down" | "left" | "right" | "up";
  moving: boolean;
  isNpc: boolean;
  hovered: boolean;
}

const SPRITE_SIZE = 16;
const HP_BAR_W = 24;
const HP_BAR_H = 3;
const TWEEN_DURATION = 500; // ms — matches poll interval

const HIDE_LABEL_TYPES = new Set([
  "merchant", "trainer", "profession-trainer", "guild-registrar",
  "auctioneer", "arena-master", "quest-giver", "lore-npc", "npc",
  "ore-node", "herb-node",
]);

const PARTY_COLORS = [
  0x54f28b, 0xffcc00, 0x9ab9ff, 0xff8800,
  0xff4d6d, 0xcc66ff, 0x66ffcc, 0xff66aa,
];

function hpColor(ratio: number): number {
  if (ratio > 0.6) return 0x54f28b; // green
  if (ratio > 0.3) return 0xff8800; // orange
  return 0xff2222; // red
}

function partyColor(partyId: string): number {
  let hash = 0;
  for (let i = 0; i < partyId.length; i++) {
    hash = ((hash << 5) - hash + partyId.charCodeAt(i)) | 0;
  }
  return PARTY_COLORS[Math.abs(hash) % PARTY_COLORS.length];
}

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Callback to query elevation at a world position */
type ElevationQuery = (worldX: number, worldZ: number) => number;

export class EntityRenderer {
  private scene: Phaser.Scene;
  private visuals = new Map<string, EntityVisual>();
  private entities = new Map<string, Entity>();
  private onClickCallback: ((entity: Entity) => void) | null = null;

  /**
   * Scale factor: multiply entity world coords by this to get pixel position.
   * Default 1.6 = CLIENT_TILE_PX(16) / serverTileSize(10).
   */
  private coordScale = 1.6;

  /** Optional elevation query for depth sorting */
  private elevationQuery: ElevationQuery | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Set coordinate scale (called when terrain loads and we know the ratio) */
  setCoordScale(scale: number): void {
    this.coordScale = scale;
  }

  /** Set elevation query for depth sorting (called once when tilemap renderer is ready) */
  setElevationQuery(query: ElevationQuery): void {
    this.elevationQuery = query;
  }

  /** Register a callback for when an entity is clicked. */
  onClick(cb: (entity: Entity) => void): void {
    this.onClickCallback = cb;
  }

  /** Look up a stored entity by id. */
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /** Iterate all tracked entities (used by tooltip to show party members). */
  getEntities(): Map<string, Entity> {
    return this.entities;
  }

  /** Get the current visual pixel position of an entity (follows tweens). */
  getSpritePosition(id: string): { x: number; y: number } | null {
    const visual = this.visuals.get(id);
    if (!visual || !visual.sprite) return null;
    return { x: visual.sprite.x, y: visual.sprite.y };
  }

  /**
   * Play a melee attack animation: lunge the attacker toward the target then
   * snap back, and flash the target red.  Safe to call at any time — if either
   * entity is not tracked (e.g. just despawned) the call is a no-op.
   */
  triggerMeleeAttack(attackerId: string, targetId: string): void {
    const attVisual = this.visuals.get(attackerId);
    const tgtVisual = this.visuals.get(targetId);
    if (!attVisual?.sprite || !tgtVisual?.sprite) return;

    const ax = attVisual.sprite.x;
    const ay = attVisual.sprite.y;
    const tx = tgtVisual.sprite.x;
    const ty = tgtVisual.sprite.y;

    // Direction vector attacker → target, capped at 8px
    const dist = Math.sqrt((tx - ax) ** 2 + (ty - ay) ** 2) || 1;
    const lunge = Math.min(8, dist * 0.4);
    const nx = (tx - ax) / dist;
    const ny = (ty - ay) / dist;

    // Lunge forward
    this.scene.tweens.add({
      targets: attVisual.sprite,
      x: ax + nx * lunge,
      y: ay + ny * lunge,
      duration: 120,
      ease: "Quad.easeOut",
      onComplete: () => {
        // Snap back
        this.scene.tweens.add({
          targets: attVisual.sprite,
          x: ax,
          y: ay,
          duration: 180,
          ease: "Quad.easeIn",
        });
      },
    });

    // Hit flash: tint target red then restore
    tgtVisual.sprite.setTint(0xff3333);
    this.scene.time.delayedCall(150, () => {
      tgtVisual.sprite?.clearTint();
    });
  }

  /** Snapshot pixel positions for all tracked entities (used by VFX layer). */
  getPixelPositions(): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, visual] of this.visuals) {
      if (visual.sprite) {
        out.set(id, { x: visual.sprite.x, y: visual.sprite.y });
      }
    }
    return out;
  }

  /** Find closest entity at world position (within radius). */
  getEntityAt(worldX: number, worldY: number, radius: number): Entity | undefined {
    let closest: Entity | undefined;
    let closestDistSq = radius * radius;
    for (const [id, entity] of this.entities) {
      const visual = this.visuals.get(id);
      if (!visual || !visual.sprite) continue;
      const dx = worldX - visual.sprite.x;
      const dy = worldY - visual.sprite.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= closestDistSq) {
        closestDistSq = distSq;
        closest = entity;
      }
    }
    return closest;
  }

  update(entities: Record<string, Entity>): void {
    const incoming = new Set(Object.keys(entities));

    // Remove entities no longer present
    for (const [id, visual] of this.visuals) {
      if (!incoming.has(id)) {
        visual.sprite.destroy();
        visual.label.destroy();
        visual.hpBar.destroy();
        visual.hpBg.destroy();
        visual.partyRing?.destroy();
        this.visuals.delete(id);
        this.entities.delete(id);
      }
    }

    // Add or update entities
    for (const [id, entity] of Object.entries(entities)) {
      this.entities.set(id, entity);
      const px = entity.x * this.coordScale;
      const py = entity.y * this.coordScale;

      let visual = this.visuals.get(id);
      if (!visual) {
        visual = this.createVisual(id, px, py, entity);
        this.visuals.set(id, visual);
      } else {
        this.updateVisual(visual, px, py, entity);
      }
    }
  }

  private createVisual(
    id: string,
    px: number,
    py: number,
    entity: Entity,
  ): EntityVisual {
    if (!this.scene || !this.scene.add) {
      console.error("[EntityRenderer] Scene not initialized");
      return {
        sprite: null as any,
        label: null as any,
        hpBar: null as any,
        hpBg: null as any,
        partyRing: null,
        lastX: px,
        lastY: py,
        facing: "down",
        moving: false,
        isNpc: false,
        hovered: false,
      };
    }

    const textureKey = getEntityTextureKey(entity.type, entity.classId, entity.name);

    // Elevation-aware depth: base 10 + elevation * 2
    const elev = this.elevationQuery ? this.elevationQuery(entity.x, entity.y) : 0;
    const entityDepth = 10 + elev * 2;

    const sprite = this.scene.add
      .sprite(px, py, textureKey, 0)
      .setDepth(entityDepth)
      .setInteractive({ useHandCursor: true });

    const isNpc = HIDE_LABEL_TYPES.has(entity.type);

    sprite.on("pointerdown", () => {
      const ent = this.entities.get(id);
      if (ent && this.onClickCallback) {
        this.onClickCallback(ent);
      }
    });

    sprite.on("pointerover", () => {
      const v = this.visuals.get(id);
      if (v && v.isNpc) {
        v.hovered = true;
        v.label.setVisible(true);
        v.hpBar.setVisible(true);
        v.hpBg.setVisible(true);
      }
    });

    sprite.on("pointerout", () => {
      const v = this.visuals.get(id);
      if (v && v.isNpc) {
        v.hovered = false;
        v.label.setVisible(false);
        v.hpBar.setVisible(false);
        v.hpBg.setVisible(false);
      }
    });

    // Start idle animation facing down
    const idleAnim = `${textureKey}-idle-down`;
    if (this.scene.anims.exists(idleAnim)) {
      sprite.play(idleAnim);
    }

    // Name label — colored if in a party, guild tag underneath
    const labelColor = entity.partyId ? colorToHex(partyColor(entity.partyId)) : "#ffffff";
    const labelText = entity.guildName
      ? `${entity.name}\n<${entity.guildName}>`
      : entity.name;
    const label = this.scene.add
      .text(px, py - 12, labelText, {
        fontSize: "10px",
        fontFamily: "monospace",
        color: labelColor,
        stroke: "#000000",
        strokeThickness: 2,
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setDepth(entityDepth + 1);

    const hpBg = this.scene.add
      .rectangle(px, py + 10, HP_BAR_W, HP_BAR_H, 0x333333)
      .setDepth(entityDepth);

    const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
    const hpBar = this.scene.add
      .rectangle(
        px - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
        py + 10,
        HP_BAR_W * hpRatio,
        HP_BAR_H,
        hpColor(hpRatio),
      )
      .setDepth(entityDepth + 1);

    // Party ring — colored circle around sprite
    let partyRing: Phaser.GameObjects.Arc | null = null;
    if (entity.partyId) {
      partyRing = this.scene.add
        .circle(px, py, 12, 0x000000, 0)
        .setStrokeStyle(1.5, partyColor(entity.partyId), 0.8)
        .setDepth(entityDepth - 1);
    }

    // Hide NPC labels and HP bars by default — shown on hover
    if (isNpc) {
      label.setVisible(false);
      hpBar.setVisible(false);
      hpBg.setVisible(false);
    }

    return {
      sprite,
      label,
      hpBar,
      hpBg,
      partyRing,
      lastX: px,
      lastY: py,
      facing: "down",
      moving: false,
      isNpc,
      hovered: false,
    };
  }

  private updateVisual(
    visual: EntityVisual,
    px: number,
    py: number,
    entity: Entity,
  ): void {
    const dx = px - visual.lastX;
    const dy = py - visual.lastY;
    const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;

    const textureKey = getEntityTextureKey(entity.type, entity.classId, entity.name);

    // Swap texture if class info arrived after initial creation
    if (visual.sprite.texture.key !== textureKey && this.scene.textures.exists(textureKey)) {
      visual.sprite.setTexture(textureKey);
      const idleAnim = `${textureKey}-idle-${visual.facing}`;
      if (this.scene.anims.exists(idleAnim)) {
        visual.sprite.play(idleAnim);
      }
    }

    // Update elevation-based depth
    const elev = this.elevationQuery ? this.elevationQuery(entity.x, entity.y) : 0;
    const entityDepth = 10 + elev * 2;
    visual.sprite.setDepth(entityDepth);
    visual.label.setDepth(entityDepth + 1);
    visual.hpBg.setDepth(entityDepth);
    visual.hpBar.setDepth(entityDepth + 1);
    visual.partyRing?.setDepth(entityDepth - 1);

    // Update party ring: create/destroy/recolor if partyId changed
    this.syncPartyRing(visual, entity);

    // Update label text (guild name may appear/change)
    const expectedLabel = entity.guildName
      ? `${entity.name}\n<${entity.guildName}>`
      : entity.name;
    if (visual.label.text !== expectedLabel) {
      visual.label.setText(expectedLabel);
    }

    if (moved) {
      // Determine facing direction
      const dir = inferDirection(dx, dy);
      visual.facing = dir;
      visual.moving = true;

      // Play walk animation
      const walkAnim = `${textureKey}-walk-${dir}`;
      if (this.scene.anims.exists(walkAnim) && visual.sprite.anims.getName() !== walkAnim) {
        visual.sprite.play(walkAnim);
      }

      // Tween to new position
      this.scene.tweens.add({
        targets: visual.sprite,
        x: px,
        y: py,
        duration: TWEEN_DURATION,
        ease: "Linear",
        onUpdate: () => {
          // Labels, HP bars, and party ring follow sprite
          visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12);
          visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10);
          const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
          visual.hpBar.setPosition(
            visual.sprite.x - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
            visual.sprite.y + 10,
          );
          visual.partyRing?.setPosition(visual.sprite.x, visual.sprite.y);
        },
        onComplete: () => {
          visual.moving = false;
          // Switch to idle after movement
          const idleAnim = `${textureKey}-idle-${visual.facing}`;
          if (this.scene.anims.exists(idleAnim)) {
            visual.sprite.play(idleAnim);
          }
        },
      });
    } else if (!visual.moving) {
      // Not moving — ensure idle animation
      const idleAnim = `${textureKey}-idle-${visual.facing}`;
      if (
        this.scene.anims.exists(idleAnim) &&
        visual.sprite.anims.getName() !== idleAnim
      ) {
        visual.sprite.play(idleAnim);
      }

      // Snap position (in case of drift)
      visual.sprite.setPosition(px, py);
      visual.label.setPosition(px, py - 12);
      visual.hpBg.setPosition(px, py + 10);
      visual.partyRing?.setPosition(px, py);
    }

    // Update HP bar
    const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
    visual.hpBar
      .setPosition(
        visual.sprite.x - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
        visual.sprite.y + 10,
      )
      .setSize(HP_BAR_W * hpRatio, HP_BAR_H)
      .setFillStyle(hpColor(hpRatio));

    visual.lastX = px;
    visual.lastY = py;
  }

  /** Sync party ring and label color when partyId changes. */
  private syncPartyRing(visual: EntityVisual, entity: Entity): void {
    if (entity.partyId) {
      const color = partyColor(entity.partyId);
      if (!visual.partyRing) {
        // Joined a party — create ring
        visual.partyRing = this.scene.add
          .circle(visual.sprite.x, visual.sprite.y, 12, 0x000000, 0)
          .setStrokeStyle(1.5, color, 0.8)
          .setDepth(9);
      } else {
        // Already has ring — update color in case party changed
        visual.partyRing.setStrokeStyle(1.5, color, 0.8);
      }
      visual.label.setColor(colorToHex(color));
    } else {
      if (visual.partyRing) {
        // Left party — destroy ring
        visual.partyRing.destroy();
        visual.partyRing = null;
      }
      visual.label.setColor("#ffffff");
    }
  }

  get entityCount(): number {
    return this.visuals.size;
  }

  /** Show or hide all entity visuals — used by LOD overview mode */
  setSpritesVisible(visible: boolean): void {
    for (const visual of this.visuals.values()) {
      visual.sprite.setVisible(visible);
      // NPC labels/HP stay hidden unless hovered
      const showDetails = visible && (!visual.isNpc || visual.hovered);
      visual.label.setVisible(showDetails);
      visual.hpBar.setVisible(showDetails);
      visual.hpBg.setVisible(showDetails);
      visual.partyRing?.setVisible(visible);
    }
  }
}
