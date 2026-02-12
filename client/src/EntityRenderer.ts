import Phaser from "phaser";
import type { Entity } from "./types.js";
import { ENTITY_COLORS, DEFAULT_ENTITY_COLOR } from "./config.js";

interface EntityVisual {
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBg: Phaser.GameObjects.Rectangle;
}

const RECT_W = 24;
const RECT_H = 24;
const HP_BAR_W = 40;
const HP_BAR_H = 5;

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
   * Default 3.2 = CLIENT_TILE_PX(32) / serverTileSize(10).
   */
  private coordScale = 3.2;

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

  /** Find entity at world position (within radius). */
  getEntityAt(worldX: number, worldY: number, radius: number): Entity | undefined {
    for (const [id, entity] of this.entities) {
      const px = entity.x * this.coordScale;
      const py = entity.y * this.coordScale;
      const dx = worldX - px;
      const dy = worldY - py;
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
        visual.rect.destroy();
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
      const color = ENTITY_COLORS[entity.type] ?? DEFAULT_ENTITY_COLOR;

      let visual = this.visuals.get(id);
      if (!visual) {
        visual = this.createVisual(id, px, py, color, entity);
        this.visuals.set(id, visual);
      } else {
        this.updateVisual(visual, px, py, color, entity);
      }
    }
  }

  private createVisual(
    id: string,
    px: number,
    py: number,
    color: number,
    entity: Entity,
  ): EntityVisual {
    const isInteractive =
      entity.type === "merchant" ||
      entity.type === "trainer" ||
      entity.type === "profession-trainer";

    const rect = this.scene.add
      .rectangle(px, py, RECT_W, RECT_H, color)
      .setDepth(10)
      .setInteractive({ useHandCursor: isInteractive });

    rect.on("pointerdown", () => {
      const ent = this.entities.get(id);
      if (ent && this.onClickCallback) {
        this.onClickCallback(ent);
      }
    });

    const label = this.scene.add
      .text(px, py - 18, entity.name, {
        fontSize: "14px",
        fontFamily: "monospace",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(11);

    const hpBg = this.scene.add
      .rectangle(px, py + 16, HP_BAR_W, HP_BAR_H, 0x333333)
      .setDepth(10);

    const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
    const hpBar = this.scene.add
      .rectangle(
        px - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
        py + 16,
        HP_BAR_W * hpRatio,
        HP_BAR_H,
        hpColor(hpRatio),
      )
      .setDepth(11);

    return { rect, label, hpBar, hpBg };
  }

  private updateVisual(
    visual: EntityVisual,
    px: number,
    py: number,
    color: number,
    entity: Entity,
  ): void {
    visual.rect.setPosition(px, py).setFillStyle(color);
    visual.label.setPosition(px, py - 18).setText(entity.name);
    visual.hpBg.setPosition(px, py + 16);

    const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
    visual.hpBar
      .setPosition(px - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2, py + 16)
      .setSize(HP_BAR_W * hpRatio, HP_BAR_H)
      .setFillStyle(hpColor(hpRatio));
  }

  get entityCount(): number {
    return this.visuals.size;
  }
}
