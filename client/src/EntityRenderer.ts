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
  lastX: number;
  lastY: number;
  facing: "down" | "left" | "right" | "up";
  moving: boolean;
}

const SPRITE_SIZE = 16;
const HP_BAR_W = 24;
const HP_BAR_H = 3;
const TWEEN_DURATION = 500; // ms — matches poll interval

function hpColor(ratio: number): number {
  if (ratio > 0.6) return 0x54f28b; // green
  if (ratio > 0.3) return 0xff8800; // orange
  return 0xff2222; // red
}

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

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Set coordinate scale (called when terrain loads and we know the ratio) */
  setCoordScale(scale: number): void {
    this.coordScale = scale;
  }

  /** Register a callback for when an entity is clicked. */
  onClick(cb: (entity: Entity) => void): void {
    this.onClickCallback = cb;
  }

  /** Look up a stored entity by id. */
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /** Get the current visual pixel position of an entity (follows tweens). */
  getSpritePosition(id: string): { x: number; y: number } | null {
    const visual = this.visuals.get(id);
    if (!visual || !visual.sprite) return null;
    return { x: visual.sprite.x, y: visual.sprite.y };
  }

  /** Find entity at world position (within radius). */
  getEntityAt(worldX: number, worldY: number, radius: number): Entity | undefined {
    for (const [id, entity] of this.entities) {
      const visual = this.visuals.get(id);
      if (!visual) continue;
      const dx = worldX - visual.sprite.x;
      const dy = worldY - visual.sprite.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= radius * radius) {
        return entity;
      }
    }
    return undefined;
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
      // Return a dummy visual to prevent crashes
      return {
        sprite: null as any,
        label: null as any,
        hpBar: null as any,
        hpFill: null as any,
      };
    }

    const textureKey = getEntityTextureKey(entity.type);

    const sprite = this.scene.add
      .sprite(px, py, textureKey, 0)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });

    sprite.on("pointerdown", () => {
      const ent = this.entities.get(id);
      if (ent && this.onClickCallback) {
        this.onClickCallback(ent);
      }
    });

    // Start idle animation facing down
    const idleAnim = `${textureKey}-idle-down`;
    if (this.scene.anims.exists(idleAnim)) {
      sprite.play(idleAnim);
    }

    const label = this.scene.add
      .text(px, py - 12, entity.name, {
        fontSize: "10px",
        fontFamily: "monospace",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(11);

    const hpBg = this.scene.add
      .rectangle(px, py + 10, HP_BAR_W, HP_BAR_H, 0x333333)
      .setDepth(10);

    const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
    const hpBar = this.scene.add
      .rectangle(
        px - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
        py + 10,
        HP_BAR_W * hpRatio,
        HP_BAR_H,
        hpColor(hpRatio),
      )
      .setDepth(11);

    return {
      sprite,
      label,
      hpBar,
      hpBg,
      lastX: px,
      lastY: py,
      facing: "down",
      moving: false,
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

    const textureKey = getEntityTextureKey(entity.type);

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
          // Labels and HP bars follow sprite
          visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12);
          visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10);
          const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
          visual.hpBar.setPosition(
            visual.sprite.x - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
            visual.sprite.y + 10,
          );
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

  get entityCount(): number {
    return this.visuals.size;
  }
}
