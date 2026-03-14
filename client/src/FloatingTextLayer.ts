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

  /**
   * Show floating gather loot text ("+1 Copper Ore", "+2 Wheat", etc.)
   * Color varies by profession: mining=orange, herbalism=green, farming=brown-gold
   */
  showGatherText(
    eventId: string,
    pos: Pos,
    itemName: string,
    gatherType: string,
  ): void {
    if (this.seen.has(eventId)) return;
    this.seen.add(eventId);
    this.pruneSeen();

    const color =
      gatherType === "mining" ? "#ffaa33" :
      gatherType === "herbalism" ? "#66dd88" :
      gatherType === "farming" ? "#ddbb44" :
      "#ffffff";

    this.spawn(pos, {
      text: `+${itemName}`,
      color,
      fontSize: 10,
      offsetY: -18,
      duration: 1400,
      scatter: 4,
    });
  }

  /**
   * Show floating consume VFX — colored "+" signs that spiral upward.
   * Colors: food=orange, potion(hp)=red, potion(mp)=blue, elixir/buff=gold, tonic=purple
   */
  showConsumeText(
    eventId: string,
    pos: Pos,
    data: Record<string, unknown>,
  ): void {
    if (this.seen.has(eventId)) return;
    this.seen.add(eventId);
    this.pruneSeen();

    const consumeType = data.consumeType as string | undefined;
    const hpRestored = data.hpRestored as number | undefined;
    const mpRestored = data.mpRestored as number | undefined;
    const buffName = data.buffName as string | undefined;
    const itemName = (data.itemName as string) ?? "Potion";

    // Pick color + label based on effect type
    let color: string;
    let label: string;
    if (consumeType === "food") {
      color = "#ffaa33";             // orange
      label = hpRestored ? `+${hpRestored} HP` : `+${itemName}`;
    } else if ((mpRestored ?? 0) > 0 && (hpRestored ?? 0) === 0) {
      color = "#55aaff";             // blue — mana potion
      label = `+${mpRestored} MP`;
    } else if ((hpRestored ?? 0) > 0) {
      color = "#ff5555";             // red — health potion
      label = `+${hpRestored} HP`;
    } else if (buffName) {
      color = "#ffd700";             // gold — buff/elixir
      label = `+${buffName}`;
    } else {
      color = "#cc77ff";             // purple — tonic/other
      label = `+${itemName}`;
    }

    // Main floating label
    this.spawn(pos, {
      text: label,
      color,
      fontSize: 12,
      offsetY: -16,
      duration: 1400,
      scatter: 4,
    });

    // Extra sparkle "+" signs that fan outward
    const sparkleCount = 3;
    for (let i = 0; i < sparkleCount; i++) {
      const angle = ((Math.PI * 2) / sparkleCount) * i - Math.PI / 2;
      const radius = 8 + Math.random() * 6;
      const sx = pos.x + Math.cos(angle) * radius;
      const sy = pos.y - 12 + Math.sin(angle) * radius;

      const txt = this.scene.add
        .text(sx, sy, "+", {
          fontSize: "9px",
          fontFamily: "monospace",
          color,
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(131)
        .setAlpha(0.9);

      this.scene.tweens.add({
        targets: txt,
        x: sx + Math.cos(angle) * 14,
        y: sy - 18 + Math.sin(angle) * 6,
        alpha: 0,
        scale: 0.4,
        duration: 900 + Math.random() * 300,
        ease: "Quad.easeOut",
        onComplete: () => txt.destroy(),
      });
    }
  }

  private pruneSeen(): void {
    // Keep set bounded — clear periodically
    if (this.seen.size > 500) {
      this.seen.clear();
    }
  }
}
