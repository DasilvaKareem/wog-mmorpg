import Phaser from "phaser";

/**
 * FloatingTextLayer — renders floating damage numbers, heal numbers,
 * dodge/block/crit text above entities during combat.
 *
 * Numbers float upward and fade out. Crits are larger.
 * Damage = red/orange, Heal = green, Dodge = white italic, Block = grey.
 */

type Pos = { x: number; y: number };

interface FloatConfig {
  text: string;
  color: string;
  fontSize: number;
  /** Extra vertical offset from entity center */
  offsetY: number;
  /** Duration in ms */
  duration: number;
  /** Horizontal scatter (random +-px) */
  scatter: number;
}

// Physical damage (auto-attacks, melee techniques)
const PHYS_DAMAGE_CFG: FloatConfig = {
  text: "", color: "#ff4444", fontSize: 11, offsetY: -14, duration: 1000, scatter: 6,
};
const PHYS_CRIT_CFG: FloatConfig = {
  text: "", color: "#ff8800", fontSize: 16, offsetY: -14, duration: 1400, scatter: 4,
};
// Spell damage (projectile, area, channel techniques)
const SPELL_DAMAGE_CFG: FloatConfig = {
  text: "", color: "#bb9af7", fontSize: 11, offsetY: -14, duration: 1000, scatter: 6,
};
const SPELL_CRIT_CFG: FloatConfig = {
  text: "", color: "#e0aaff", fontSize: 16, offsetY: -14, duration: 1400, scatter: 4,
};
const HEAL_CFG: FloatConfig = {
  text: "", color: "#54f28b", fontSize: 11, offsetY: -14, duration: 1000, scatter: 6,
};
const DODGE_CFG: FloatConfig = {
  text: "DODGE", color: "#cccccc", fontSize: 9, offsetY: -10, duration: 800, scatter: 3,
};
const BLOCK_CFG: FloatConfig = {
  text: "BLOCK", color: "#888888", fontSize: 9, offsetY: -10, duration: 800, scatter: 3,
};

export class FloatingTextLayer {
  private scene: Phaser.Scene;
  private seen = new Set<string>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Show floating combat text for a zone event.
   * @param eventId   Unique event id (dedup)
   * @param pos       Pixel position of the target entity
   * @param data      Event data from server (damage, healing, critical, blocked, dodged)
   * @param type      Event type ("combat" | "ability")
   */
  showCombatText(
    eventId: string,
    pos: Pos,
    data: Record<string, unknown>,
    type: string,
  ): void {
    if (this.seen.has(eventId)) return;
    this.seen.add(eventId);
    this.pruneSeen();

    const damage = data.damage as number | undefined;
    const healing = data.healing as number | undefined;
    const critical = data.critical as boolean | undefined;
    const blocked = data.blocked as boolean | undefined;
    const dodged = data.dodged as boolean | undefined;

    if (dodged) {
      this.spawn(pos, DODGE_CFG);
      return;
    }

    if (damage && damage > 0) {
      // Spell damage: ability events with projectile/area/channel animStyle
      const animStyle = data.animStyle as string | undefined;
      const isSpell = type === "ability" && animStyle != null && animStyle !== "melee";
      const cfg = critical
        ? (isSpell ? SPELL_CRIT_CFG : PHYS_CRIT_CFG)
        : (isSpell ? SPELL_DAMAGE_CFG : PHYS_DAMAGE_CFG);
      const label = critical ? `${damage}!` : `${damage}`;
      this.spawn(pos, { ...cfg, text: label });

      if (blocked) {
        this.spawn(
          { x: pos.x, y: pos.y + 8 },
          { ...BLOCK_CFG, offsetY: -4 },
        );
      }
    }

    if (healing && healing > 0) {
      this.spawn(pos, { ...HEAL_CFG, text: `+${healing}` });
    }
  }

  private spawn(pos: Pos, cfg: FloatConfig): void {
    const scatter = (Math.random() - 0.5) * 2 * cfg.scatter;
    const x = pos.x + scatter;
    const y = pos.y + cfg.offsetY;

    const text = this.scene.add
      .text(x, y, cfg.text, {
        fontSize: `${cfg.fontSize}px`,
        fontFamily: "monospace",
        color: cfg.color,
        stroke: "#000000",
        strokeThickness: 3,
        fontStyle: cfg.color === DODGE_CFG.color ? "italic" : "normal",
      })
      .setOrigin(0.5, 1)
      .setDepth(130);

    this.scene.tweens.add({
      targets: text,
      y: y - 22,
      alpha: 0,
      duration: cfg.duration,
      ease: "Quad.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private pruneSeen(): void {
    // Keep set bounded — clear periodically
    if (this.seen.size > 500) {
      this.seen.clear();
    }
  }
}
