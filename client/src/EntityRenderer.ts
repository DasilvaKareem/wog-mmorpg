import Phaser from "phaser";
import type { Entity } from "./types.js";
import {
  getEntityTextureKey,
  getLayeredTextureKey,
  checkLayeredRecomposite,
  inferDirection,
} from "./EntitySpriteGenerator.js";

/** Tracks which Phaser FX are applied to a sprite for a given effect type */
interface AppliedFx {
  types: Set<string>; // active effect types: "buff" | "debuff" | "dot" | "shield" | "hot"
  glow: Phaser.FX.Glow | null;
  colorMatrix: Phaser.FX.ColorMatrix | null;
  shine: Phaser.FX.Shine | null;
}

interface SpeechBubble {
  bg: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
  tail: Phaser.GameObjects.Triangle;
  timer: Phaser.Time.TimerEvent;
}

interface EntityVisual {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBg: Phaser.GameObjects.Rectangle;
  partyRing: Phaser.GameObjects.Arc | null;
  questMarker: Phaser.GameObjects.Text | null;
  speechBubble: SpeechBubble | null;
  lastX: number;
  lastY: number;
  facing: "down" | "left" | "right" | "up";
  moving: boolean;
  isNpc: boolean;
  hovered: boolean;
  fx: AppliedFx;
  spriteScale: number; // mob/boss scale multiplier
  inViewport: boolean;
  combatUntil: number; // timestamp when combat state expires
  walkUntil: number; // keep locomotion animation alive across polling gaps
  moveTweenVersion: number; // ignore stale tween completions from older move updates
  /** When > Date.now(), updateVisual will NOT override the current animation.
   *  Set by attack/knockback/lunge/gather to prevent idle flickering. */
  animLockUntil: number;
}

const SPRITE_SIZE = 16;
const HP_BAR_W = 24;
const HP_BAR_H = 3;
const TWEEN_DURATION = 950; // ms — nearly fills the 1000ms poll interval for continuous walking
const VISUAL_SEPARATION_RADIUS = 20; // pixels — minimum visual distance between sprites
const COMBAT_LINGER_MS = 5000; // combat state persists after last combat event
const DISABLE_ENTITY_VIEWPORT_CULLING = true; // keep characters renderable even when viewport math is wrong

/** Scale multipliers for mob/boss sprites so they're visually larger */
const MOB_SCALE = 1.4;
const BOSS_SCALE = 1.8;

const HIDE_LABEL_TYPES = new Set([
  "merchant", "trainer", "profession-trainer", "guild-registrar",
  "auctioneer", "arena-master", "quest-giver", "lore-npc", "npc",
  "ore-node", "herb-node", "crop-node",
]);

/** NPC types that can potentially give quests */
const QUEST_NPC_TYPES = new Set([
  "quest-giver", "lore-npc", "merchant", "trainer", "profession-trainer",
]);

/** Quest marker states: available (!), active (?), or ready to turn in (?) */
type QuestMarkerState = "available" | "active" | "ready";

const MARKER_CONFIG: Record<QuestMarkerState, { symbol: string; color: string }> = {
  available: { symbol: "!", color: "#ffcc00" },   // yellow !
  active:    { symbol: "?", color: "#6b7a9e" },   // gray ?
  ready:     { symbol: "?", color: "#ffcc00" },   // yellow ?
};

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
  private dying = new Set<string>(); // entities mid-death animation
  private questMarkerStates = new Map<string, QuestMarkerState>(); // entityId → marker state
  private lowPower = false;
  private spritesVisible = true;
  private viewport: Phaser.Geom.Rectangle | null = null;

  /**
   * Scale factor: multiply entity world coords by this to get pixel position.
   * Default 1.6 = CLIENT_TILE_PX(16) / serverTileSize(10).
   */
  private coordScale = 1.6;

  /** Optional elevation query for depth sorting */
  private elevationQuery: ElevationQuery | null = null;
  private movementHoldMs = TWEEN_DURATION + 150;

  constructor(scene: Phaser.Scene, options?: { lowPower?: boolean; movementHoldMs?: number }) {
    this.scene = scene;
    this.lowPower = options?.lowPower ?? false;
    this.movementHoldMs = Math.max(TWEEN_DURATION, options?.movementHoldMs ?? this.movementHoldMs);
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

    // Mark both entities as in combat
    const now = Date.now();
    const combatExpiry = now + COMBAT_LINGER_MS;
    attVisual.combatUntil = combatExpiry;
    tgtVisual.combatUntil = combatExpiry;

    // Lock attacker animation for the full attack sequence (lunge 120 + snapback 180 + buffer)
    attVisual.animLockUntil = now + 600;
    // Lock target briefly so hit flash isn't stomped by idle
    tgtVisual.animLockUntil = now + 300;

    // Swap attacker to armed texture so weapon is visible during attack
    const attEntity = this.entities.get(attackerId);
    if (attEntity) {
      const armedKey = getLayeredTextureKey(this.scene, attEntity, true);
      if (armedKey && attVisual.sprite.texture.key !== armedKey && this.scene.textures.exists(armedKey)) {
        attVisual.sprite.setTexture(armedKey);
      }
    }

    // Face the target and play attack/swipe animation
    const dirToTarget = inferDirection(tx - ax, ty - ay);
    attVisual.facing = dirToTarget;
    const attackAnim = `${attVisual.sprite.texture.key}-attack-${dirToTarget}`;
    if (this.scene.anims.exists(attackAnim)) {
      attVisual.sprite.play(attackAnim);
      attVisual.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (!attVisual.sprite) return;
        attVisual.animLockUntil = 0; // release lock when attack anim finishes
        const curKey = attVisual.sprite.texture.key;
        const idleAnim = `${curKey}-idle-${attVisual.facing}`;
        if (this.scene.anims.exists(idleAnim)) {
          attVisual.sprite.play(idleAnim);
        }
      });
    }

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

  /**
   * Animate an entity being knocked back: fly away from impact point, bounce,
   * flash white, then settle at the new server position.
   */
  triggerKnockback(entityId: string, fromX: number, fromY: number, distance: number): void {
    const visual = this.visuals.get(entityId);
    if (!visual?.sprite) return;

    const sx = visual.sprite.x;
    const sy = visual.sprite.y;

    // Direction vector: pushed AWAY from fromX/fromY
    const dx = sx - fromX;
    const dy = sy - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    // Visual knockback distance (pixels) — scale by coordScale
    const kbPx = distance * this.coordScale;
    const destX = sx + nx * kbPx;
    const destY = sy + ny * kbPx;

    // Mark as in combat + lock animation for knockback sequence (180ms + 150ms bounce)
    const kbNow = Date.now();
    visual.combatUntil = kbNow + COMBAT_LINGER_MS;
    visual.animLockUntil = kbNow + 400;

    // White flash on impact
    visual.sprite.setTint(0xffffff);
    this.scene.time.delayedCall(100, () => visual.sprite?.clearTint());

    // Phase 1: fast launch to knockback destination
    this.scene.tweens.add({
      targets: visual.sprite,
      x: destX,
      y: destY,
      duration: 180,
      ease: "Quad.easeOut",
      onUpdate: () => {
        const s = visual.spriteScale;
        visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12 * s);
        visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10 * s);
        visual.partyRing?.setPosition(visual.sprite.x, visual.sprite.y);
        this.repositionOverlays(visual);
      },
      onComplete: () => {
        // Phase 2: small bounce back (settle)
        this.scene.tweens.add({
          targets: visual.sprite,
          x: destX - nx * kbPx * 0.15,
          y: destY - ny * kbPx * 0.15,
          duration: 150,
          ease: "Bounce.easeOut",
          onUpdate: () => {
            const s = visual.spriteScale;
            visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12 * s);
            visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10 * s);
            visual.partyRing?.setPosition(visual.sprite.x, visual.sprite.y);
            this.repositionOverlays(visual);
          },
        });
      },
    });
  }

  /**
   * Animate a caster lunging toward a target: fast dash forward.
   * The server already moved the entity, so the next poll will snap to the correct position.
   */
  triggerLunge(attackerId: string, targetX: number, targetY: number): void {
    const visual = this.visuals.get(attackerId);
    if (!visual?.sprite) return;

    const sx = visual.sprite.x;
    const sy = visual.sprite.y;

    // Mark as in combat + lock animation for lunge dash
    const lungeNow = Date.now();
    visual.combatUntil = lungeNow + COMBAT_LINGER_MS;
    visual.animLockUntil = lungeNow + 300;

    // Face the target
    const dx = targetX - sx;
    const dy = targetY - sy;
    const dir = inferDirection(dx, dy);
    visual.facing = dir;

    // Swap to armed texture
    const entity = this.entities.get(attackerId);
    if (entity) {
      const armedKey = getLayeredTextureKey(this.scene, entity, true);
      if (armedKey && this.scene.textures.exists(armedKey)) {
        visual.sprite.setTexture(armedKey);
      }
    }

    // Fast dash toward target
    this.scene.tweens.add({
      targets: visual.sprite,
      x: targetX,
      y: targetY,
      duration: 140,
      ease: "Quad.easeIn",
      onUpdate: () => {
        const s = visual.spriteScale;
        visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12 * s);
        visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10 * s);
        visual.partyRing?.setPosition(visual.sprite.x, visual.sprite.y);
        this.repositionOverlays(visual);
      },
    });
  }

  /** Spin, shrink, and fade out a dying entity, then clean it up. */
  triggerDeath(entityId: string): void {
    const visual = this.visuals.get(entityId);
    if (!visual?.sprite || this.dying.has(entityId)) return;

    this.dying.add(entityId);

    const { sprite, label, hpBar, hpBg, partyRing, questMarker } = visual;
    this.destroySpeechBubble(visual);

    // Spin + shrink + fade the sprite
    this.scene.tweens.add({
      targets: sprite,
      angle: 180,
      scaleX: 0,
      scaleY: 0,
      alpha: 0,
      duration: 600,
      ease: "Quad.easeIn",
      onComplete: () => {
        sprite.destroy();
        label.destroy();
        hpBar.destroy();
        hpBg.destroy();
        partyRing?.destroy();
        questMarker?.destroy();
        this.visuals.delete(entityId);
        this.entities.delete(entityId);
        this.dying.delete(entityId);
      },
    });

    // Fade label + HP bar faster
    this.scene.tweens.add({
      targets: [label, hpBar, hpBg],
      alpha: 0,
      duration: 250,
    });
    partyRing?.destroy();
  }

  /** Float a golden "LEVEL UP!" banner above the entity. */
  triggerLevelUp(entityId: string): void {
    const visual = this.visuals.get(entityId);
    if (!visual?.sprite) return;

    const x = visual.sprite.x;
    const y = visual.sprite.y - 16;

    // Golden flash on the sprite
    visual.sprite.setTint(0xffd700);
    this.scene.time.delayedCall(400, () => visual.sprite?.clearTint());

    // Floating "LEVEL UP!" text
    const text = this.scene.add
      .text(x, y, "LEVEL UP!", {
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#ffd700",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(120);

    this.scene.tweens.add({
      targets: text,
      y: y - 28,
      alpha: 0,
      duration: 1400,
      ease: "Quad.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  /** Float a purple "NEW SKILL!" banner + technique name above the entity. */
  triggerTechniqueLearned(entityId: string, techniqueName?: string): void {
    const visual = this.visuals.get(entityId);
    if (!visual?.sprite) return;

    const x = visual.sprite.x;
    const y = visual.sprite.y - 16;

    // Purple flash on the sprite
    visual.sprite.setTint(0xbb9af7);
    this.scene.time.delayedCall(500, () => visual.sprite?.clearTint());

    // Floating "NEW SKILL!" text
    const header = this.scene.add
      .text(x, y, "NEW SKILL!", {
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#bb9af7",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(120);

    this.scene.tweens.add({
      targets: header,
      y: y - 30,
      alpha: 0,
      duration: 1800,
      ease: "Quad.easeOut",
      onComplete: () => header.destroy(),
    });

    // Technique name below the header
    if (techniqueName) {
      const sub = this.scene.add
        .text(x, y + 8, techniqueName, {
          fontSize: "9px",
          fontFamily: "monospace",
          color: "#c792ea",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(120);

      this.scene.tweens.add({
        targets: sub,
        y: y - 18,
        alpha: 0,
        duration: 1800,
        ease: "Quad.easeOut",
        onComplete: () => sub.destroy(),
      });
    }
  }

  /**
   * Play a profession-specific gathering animation on the gatherer entity,
   * plus a depletion flash on the resource node.
   *
   * Mining:    orange tint + downward strike bob + spark particles
   * Herbalism: green tint + gentle crouch bob + leaf particles
   * Farming:   brown tint + dig motion + earth particles
   */
  triggerGather(entityId: string, gatherType: string, nodeId?: string): void {
    const visual = this.visuals.get(entityId);
    if (!visual?.sprite) return;

    const sx = visual.sprite.x;
    const sy = visual.sprite.y;

    // Lock animation for the gather motion so idle doesn't stomp it
    visual.animLockUntil = Date.now() + 500;

    // Per-profession tint + motion
    if (gatherType === "mining") {
      // Orange tint flash
      visual.sprite.setTint(0xffaa33);
      this.scene.time.delayedCall(400, () => visual.sprite?.clearTint());

      // Downward strike bob (pickaxe swing feel)
      this.scene.tweens.add({
        targets: visual.sprite,
        y: sy + 3,
        duration: 100,
        ease: "Quad.easeIn",
        yoyo: true,
        repeat: 1,
        onUpdate: () => {
          const s = visual.spriteScale;
          visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12 * s);
          visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10 * s);
        },
        onComplete: () => {
          visual.sprite.setPosition(sx, sy);
        },
      });

      // Orange spark particles
      this.spawnGatherParticles(sx, sy - 4, 0xffaa33, 0xffdd66, 4);

    } else if (gatherType === "herbalism") {
      // Green tint flash
      visual.sprite.setTint(0x66dd88);
      this.scene.time.delayedCall(350, () => visual.sprite?.clearTint());

      // Gentle crouch bob (plucking motion)
      this.scene.tweens.add({
        targets: visual.sprite,
        y: sy + 2,
        scaleY: visual.spriteScale * 0.92,
        duration: 200,
        ease: "Sine.easeInOut",
        yoyo: true,
        onUpdate: () => {
          const s = visual.spriteScale;
          visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12 * s);
          visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10 * s);
        },
        onComplete: () => {
          visual.sprite.setPosition(sx, sy);
          visual.sprite.setScale(visual.spriteScale);
        },
      });

      // Green leaf particles floating upward
      this.spawnGatherParticles(sx, sy - 6, 0x66dd88, 0x44bb66, 3);

    } else if (gatherType === "farming") {
      // Brown-gold tint flash
      visual.sprite.setTint(0xddbb44);
      this.scene.time.delayedCall(400, () => visual.sprite?.clearTint());

      // Dig motion: tilt + bob
      this.scene.tweens.add({
        targets: visual.sprite,
        y: sy + 4,
        angle: -8,
        duration: 150,
        ease: "Quad.easeIn",
        yoyo: true,
        onUpdate: () => {
          const s = visual.spriteScale;
          visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12 * s);
          visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10 * s);
        },
        onComplete: () => {
          visual.sprite.setPosition(sx, sy);
          visual.sprite.setAngle(0);
        },
      });

      // Brown earth particles
      this.spawnGatherParticles(sx, sy - 2, 0xbb8833, 0xddaa44, 5);
    }

    // Node depletion flash — flash the resource node white then fade back
    if (nodeId) {
      const nodeVisual = this.visuals.get(nodeId);
      if (nodeVisual?.sprite) {
        nodeVisual.sprite.setTint(0xffffff);
        this.scene.tweens.add({
          targets: nodeVisual.sprite,
          alpha: 0.5,
          duration: 150,
          yoyo: true,
          onComplete: () => {
            nodeVisual.sprite?.clearTint();
            nodeVisual.sprite?.setAlpha(1);
          },
        });
      }
    }
  }

  /** Spawn small colored particle dots that float upward and fade. */
  private spawnGatherParticles(
    x: number,
    y: number,
    color1: number,
    color2: number,
    count: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const px = x + (Math.random() - 0.5) * 16;
      const py = y + (Math.random() - 0.5) * 8;
      const color = Math.random() > 0.5 ? color1 : color2;
      const size = 1.5 + Math.random() * 1.5;

      const dot = this.scene.add
        .circle(px, py, size, color)
        .setDepth(125)
        .setAlpha(0.9);

      this.scene.tweens.add({
        targets: dot,
        y: py - 12 - Math.random() * 8,
        x: px + (Math.random() - 0.5) * 10,
        alpha: 0,
        duration: 500 + Math.random() * 400,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy(),
      });
    }
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

    // Remove entities no longer present (skip dying ones — animation cleans them up)
    for (const [id, visual] of this.visuals) {
      if (!incoming.has(id) && !this.dying.has(id)) {
        this.clearEffectFx(visual);
        this.destroySpeechBubble(visual);
        visual.sprite.destroy();
        visual.label.destroy();
        visual.hpBar.destroy();
        visual.hpBg.destroy();
        visual.partyRing?.destroy();
        visual.questMarker?.destroy();
        this.visuals.delete(id);
        this.entities.delete(id);
      }
    }

    // Build pixel positions for all incoming entities
    const positions = new Map<string, { px: number; py: number }>();
    for (const [id, entity] of Object.entries(entities)) {
      positions.set(id, { px: entity.x * this.coordScale, py: entity.y * this.coordScale });
    }

    const ids = Array.from(positions.keys());
    const separationPasses = this.getSeparationPassCount(ids.length);
    if (separationPasses > 0) {
      const SKIP_TYPES = new Set(["ore-node", "herb-node", "nectar-node", "crop-node", "corpse"]);
      for (let pass = 0; pass < separationPasses; pass++) {
        for (let i = 0; i < ids.length; i++) {
          const a = positions.get(ids[i])!;
          const ea = entities[ids[i]];
          if (SKIP_TYPES.has(ea.type)) continue;
          for (let j = i + 1; j < ids.length; j++) {
            const b = positions.get(ids[j])!;
            const eb = entities[ids[j]];
            if (SKIP_TYPES.has(eb.type)) continue;
            const dx = a.px - b.px;
            const dy = a.py - b.py;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < VISUAL_SEPARATION_RADIUS) {
              if (dist > 0.01) {
                const overlap = (VISUAL_SEPARATION_RADIUS - dist) / 2;
                const nx = (dx / dist) * overlap;
                const ny = (dy / dist) * overlap;
                a.px += nx; a.py += ny;
                b.px -= nx; b.py -= ny;
              } else {
                // Exact overlap — offset deterministically by id hash
                const hash = ids[i].charCodeAt(0) - ids[j].charCodeAt(0);
                a.px += hash >= 0 ? VISUAL_SEPARATION_RADIUS / 2 : -VISUAL_SEPARATION_RADIUS / 2;
                b.px += hash >= 0 ? -VISUAL_SEPARATION_RADIUS / 2 : VISUAL_SEPARATION_RADIUS / 2;
              }
            }
          }
        }
      }
    }

    // Add or update entities with separated positions
    for (const [id, entity] of Object.entries(entities)) {
      this.entities.set(id, entity);
      const { px, py } = positions.get(id)!;

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
        questMarker: null,
        speechBubble: null,
        lastX: px,
        lastY: py,
        facing: "down",
        moving: false,
        isNpc: false,
        hovered: false,
        fx: { types: new Set(), glow: null, colorMatrix: null, shine: null },
        spriteScale: 1,
        inViewport: true,
        combatUntil: 0,
        walkUntil: 0,
        moveTweenVersion: 0,
        animLockUntil: 0,
      };
    }

    // Determine initial combat/weapon state
    const initialCombat = (entity.activeEffects?.length ?? 0) > 0;

    // Try layered composite first for players, fall back to class-based
    const layeredKey = getLayeredTextureKey(this.scene, entity, initialCombat);
    const textureKey = layeredKey ?? getEntityTextureKey(entity.type, entity.classId, entity.name);

    // Elevation-aware depth: base 10 + elevation * 2
    const elev = this.elevationQuery ? this.elevationQuery(entity.x, entity.y) : 0;
    const entityDepth = 10 + elev * 2;

    // Scale up mob/boss sprites so they're more visible
    const mobScale = entity.type === "boss" ? BOSS_SCALE
      : entity.type === "mob" ? MOB_SCALE
      : 1;

    const sprite = this.scene.add
      .sprite(px, py, textureKey, 0)
      .setDepth(entityDepth)
      .setScale(mobScale)
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

    // Offset label/HP bar based on sprite scale (larger mobs need more spacing)
    const labelYOff = -12 * mobScale;
    const hpYOff = 10 * mobScale;

    // Name label — colored if in a party, guild tag underneath
    const labelColor = entity.partyId ? colorToHex(partyColor(entity.partyId)) : "#ffffff";
    const levelTag = entity.level != null ? ` Lv.${entity.level}` : "";
    const labelText = entity.guildName
      ? `${entity.name}${levelTag}\n<${entity.guildName}>`
      : `${entity.name}${levelTag}`;
    const label = this.scene.add
      .text(px, py + labelYOff, labelText, {
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
      .rectangle(px, py + hpYOff, HP_BAR_W, HP_BAR_H, 0x333333)
      .setDepth(entityDepth);

    const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
    const hpBar = this.scene.add
      .rectangle(
        px - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
        py + hpYOff,
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

    // Quest marker — state-dependent: ! (available), ? (active/ready)
    let questMarker: Phaser.GameObjects.Text | null = null;
    const markerState = this.questMarkerStates.get(id);
    if (QUEST_NPC_TYPES.has(entity.type) && markerState) {
      const cfg = MARKER_CONFIG[markerState];
      questMarker = this.scene.add
        .text(px, py - 20, cfg.symbol, {
          fontSize: "12px",
          fontFamily: "monospace",
          fontStyle: "bold",
          color: cfg.color,
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(entityDepth + 2);
    }

    // Hide NPC labels and HP bars by default — shown on hover
    if (isNpc) {
      label.setVisible(false);
      hpBar.setVisible(false);
      hpBg.setVisible(false);
    }

    const visual: EntityVisual = {
      sprite,
      label,
      hpBar,
      hpBg,
      partyRing,
      questMarker,
      speechBubble: null,
      lastX: px,
      lastY: py,
      facing: "down",
      moving: false,
      isNpc,
      hovered: false,
      fx: { types: new Set(), glow: null, colorMatrix: null, shine: null },
      spriteScale: mobScale,
      inViewport: true,
      combatUntil: initialCombat ? Date.now() + COMBAT_LINGER_MS : 0,
      walkUntil: 0,
      moveTweenVersion: 0,
      animLockUntil: 0,
    };

    // Apply initial FX for any active effects
    this.syncEffectFx(visual, entity);
    this.refreshVisualVisibility(id, visual);

    return visual;
  }

  private updateVisual(
    visual: EntityVisual,
    px: number,
    py: number,
    entity: Entity,
  ): void {
    const now = Date.now();
    const dx = px - visual.lastX;
    const dy = py - visual.lastY;
    const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    const locomoting = visual.moving || now < visual.walkUntil;

    // Weapon visible only when in combat AND standing idle
    const inCombat = this.isEntityInCombat(visual, entity);
    const showWeapon = inCombat && !moved && !locomoting;

    // Try layered composite, check for recomposite (equipment changes), fall back to class-based
    const currentKey = visual.sprite.texture.key;
    const recompKey = checkLayeredRecomposite(this.scene, entity, currentKey, showWeapon);

    let layeredKey = recompKey;
    if (!layeredKey) {
      if (currentKey.includes("|")) {
        // Already layered — check if weapon state changed (armed ↔ unarmed)
        const wantSuffix = showWeapon ? "|armed" : "|unarmed";
        if (!currentKey.endsWith(wantSuffix)) {
          layeredKey = getLayeredTextureKey(this.scene, entity, showWeapon);
        } else {
          layeredKey = currentKey;
        }
      } else {
        layeredKey = getLayeredTextureKey(this.scene, entity, showWeapon);
      }
    }
    const textureKey = layeredKey ?? getEntityTextureKey(entity.type, entity.classId, entity.name);

    // Swap texture if it changed (skip during anim lock — attack may have set armed texture)
    if (
      visual.sprite.texture.key !== textureKey &&
      this.scene.textures.exists(textureKey) &&
      Date.now() >= visual.animLockUntil
    ) {
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
    visual.questMarker?.setDepth(entityDepth + 2);

    // Update party ring: create/destroy/recolor if partyId changed
    this.syncPartyRing(visual, entity);

    // Update label text (guild name / level may appear/change)
    const levelTag = entity.level != null ? ` Lv.${entity.level}` : "";
    const expectedLabel = entity.guildName
      ? `${entity.name}${levelTag}\n<${entity.guildName}>`
      : `${entity.name}${levelTag}`;
    if (visual.label.text !== expectedLabel) {
      visual.label.setText(expectedLabel);
    }

    const animLocked = now < visual.animLockUntil;

    if (moved) {
      // Determine facing direction
      const dir = inferDirection(dx, dy);
      visual.facing = dir;
      visual.moving = true;
      visual.walkUntil = now + this.movementHoldMs;
      visual.moveTweenVersion += 1;
      const moveTweenVersion = visual.moveTweenVersion;

      // Play walk animation (movement overrides lock — entity physically relocated)
      if (!animLocked) {
        const walkAnim = `${textureKey}-walk-${dir}`;
        if (this.scene.anims.exists(walkAnim) && visual.sprite.anims.getName() !== walkAnim) {
          visual.sprite.play(walkAnim);
        }
      }

      // Tween to new position
      this.scene.tweens.add({
        targets: visual.sprite,
        x: px,
        y: py,
        duration: TWEEN_DURATION,
        ease: "Linear",
        onUpdate: () => {
          // Labels, HP bars, party ring, quest marker, and speech bubble follow sprite
          const s = visual.spriteScale;
          visual.label.setPosition(visual.sprite.x, visual.sprite.y - 12 * s);
          visual.hpBg.setPosition(visual.sprite.x, visual.sprite.y + 10 * s);
          const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
          visual.hpBar.setPosition(
            visual.sprite.x - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
            visual.sprite.y + 10 * s,
          );
          visual.partyRing?.setPosition(visual.sprite.x, visual.sprite.y);
          this.repositionOverlays(visual);
        },
        onComplete: () => {
          if (visual.moveTweenVersion !== moveTweenVersion) return;
          visual.moving = false;
          // Hold walk until we miss the expected next movement update.
          if (Date.now() >= visual.walkUntil && Date.now() >= visual.animLockUntil) {
            const curKey = visual.sprite.texture.key;
            const idleAnim = `${curKey}-idle-${visual.facing}`;
            if (this.scene.anims.exists(idleAnim)) {
              visual.sprite.play(idleAnim);
            }
          }
        },
      });
    } else {
      const s = visual.spriteScale;

      if (!visual.moving) {
        visual.sprite.setPosition(px, py);
        visual.label.setPosition(px, py - 12 * s);
        visual.hpBg.setPosition(px, py + 10 * s);
        visual.partyRing?.setPosition(px, py);
        this.repositionOverlays(visual);
      }

      if (!animLocked && now < visual.walkUntil) {
        const walkAnim = `${textureKey}-walk-${visual.facing}`;
        if (
          this.scene.anims.exists(walkAnim) &&
          visual.sprite.anims.getName() !== walkAnim
        ) {
          visual.sprite.play(walkAnim);
        }
      } else if (!visual.moving && !animLocked) {
        // Not moving and no action animation playing — ensure idle animation
        const idleAnim = `${textureKey}-idle-${visual.facing}`;
        if (
          this.scene.anims.exists(idleAnim) &&
          visual.sprite.anims.getName() !== idleAnim
        ) {
          visual.sprite.play(idleAnim);
        }
      }
    }

    // Update HP bar
    const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
    const sc = visual.spriteScale;
    visual.hpBar
      .setPosition(
        visual.sprite.x - HP_BAR_W / 2 + (HP_BAR_W * hpRatio) / 2,
        visual.sprite.y + 10 * sc,
      )
      .setSize(HP_BAR_W * hpRatio, HP_BAR_H)
      .setFillStyle(hpColor(hpRatio));

    // Sync buff/debuff FX
    this.syncEffectFx(visual, entity);
    this.refreshVisualVisibility(entity.id, visual);

    visual.lastX = px;
    visual.lastY = py;
  }

  /** Sync party ring and label color when partyId changes. */
  private syncPartyRing(visual: EntityVisual, entity: Entity): void {
    if (!this.scene.sys.isActive() || !visual.label?.active) return;
    if (visual.partyRing && !visual.partyRing.active) {
      visual.partyRing = null;
    }

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

  // ─── Buff/Debuff FX Pipeline ──────────────────────────────────────────

  /** Check if an entity is currently in combat (from melee events or active effects). */
  private isEntityInCombat(visual: EntityVisual, entity: Entity): boolean {
    if (Date.now() < visual.combatUntil) return true;
    if (entity.activeEffects && entity.activeEffects.length > 0) return true;
    return false;
  }

  /** Check if the renderer has WebGL FX support */
  private get hasFxSupport(): boolean {
    return !this.lowPower && this.scene.renderer?.type === Phaser.WEBGL;
  }

  private getSeparationPassCount(entityCount: number): number {
    if (entityCount <= 1) return 0;
    if (this.lowPower) {
      return entityCount <= 24 ? 1 : 0;
    }
    if (entityCount <= 48) return 2;
    if (entityCount <= 96) return 1;
    return 0;
  }

  /** Derive the set of active effect types from an entity */
  private getEffectTypes(entity: Entity): Set<string> {
    const types = new Set<string>();
    for (const fx of entity.activeEffects ?? []) {
      types.add(fx.type);
    }
    return types;
  }

  /** Sync Phaser FX on a sprite to match the entity's active effects.
   *  Uses clear-and-reapply when the set of effect types changes. */
  private syncEffectFx(visual: EntityVisual, entity: Entity): void {
    if (!this.hasFxSupport || !visual.sprite?.preFX) return;

    const newTypes = this.getEffectTypes(entity);
    const applied = visual.fx;

    // Quick check: if types haven't changed, nothing to do
    if (setsEqual(newTypes, applied.types)) return;

    // Clear all existing FX and rebuild
    const preFX = visual.sprite.preFX;
    preFX.clear();
    preFX.setPadding(0);
    applied.glow = null;
    applied.colorMatrix = null;
    applied.shine = null;

    if (newTypes.size === 0) {
      applied.types = newTypes;
      return;
    }

    // Glow: shield (cyan) > buff (green-gold) > debuff (purple) — priority order
    const needsGlow = newTypes.has("shield") || newTypes.has("buff") || newTypes.has("debuff");
    if (needsGlow) {
      preFX.setPadding(4);
      if (newTypes.has("shield")) {
        applied.glow = preFX.addGlow(0x44ccff, 3.5, 0, false);
      } else if (newTypes.has("buff")) {
        applied.glow = preFX.addGlow(0x55dd88, 3, 0, false);
      } else {
        applied.glow = preFX.addGlow(0xcc44ff, 3, 0, false);
      }
    }

    // ColorMatrix: dot (green hue shift) and/or debuff (night darkening)
    if (newTypes.has("dot") || newTypes.has("debuff")) {
      applied.colorMatrix = preFX.addColorMatrix();
      if (newTypes.has("dot")) {
        applied.colorMatrix.hue(90, false);
      }
      if (newTypes.has("debuff")) {
        applied.colorMatrix.night(0.15, true);
      }
    }

    // Shine: hot (green shimmer)
    if (newTypes.has("hot")) {
      applied.shine = preFX.addShine(0.3, 0.5, 3, false);
    }

    applied.types = newTypes;
  }

  /** Remove all FX from a visual (called on destroy) */
  private clearEffectFx(visual: EntityVisual): void {
    if (!visual.sprite?.preFX) return;
    if (visual.fx.glow || visual.fx.colorMatrix || visual.fx.shine) {
      visual.sprite.preFX.clear();
    }
    visual.fx.glow = null;
    visual.fx.colorMatrix = null;
    visual.fx.shine = null;
    visual.fx.types.clear();
  }

  // ─── Quest Markers ───────────────────────────────────────────────────

  /** Update quest marker states for NPC entities. Call from scene with computed states. */
  updateQuestMarkers(states: Map<string, QuestMarkerState>): void {
    this.questMarkerStates = states;

    // Update existing markers to reflect new states
    for (const [id, visual] of this.visuals) {
      const entity = this.entities.get(id);
      if (!entity || !QUEST_NPC_TYPES.has(entity.type)) continue;

      const state = states.get(id);
      if (!state) {
        // No quest relevance — remove marker if present
        if (visual.questMarker) {
          visual.questMarker.destroy();
          visual.questMarker = null;
        }
        continue;
      }

      const cfg = MARKER_CONFIG[state];
      if (visual.questMarker) {
        // Update existing marker
        if (visual.questMarker.text !== cfg.symbol) visual.questMarker.setText(cfg.symbol);
        visual.questMarker.setColor(cfg.color);
      } else {
        // Create new marker
        visual.questMarker = this.scene.add
          .text(visual.sprite.x, visual.sprite.y - 20, cfg.symbol, {
            fontSize: "12px",
            fontFamily: "monospace",
            fontStyle: "bold",
            color: cfg.color,
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0.5, 1)
          .setDepth(visual.sprite.depth + 2);
      }
    }
  }

  // ─── Speech Bubbles ──────────────────────────────────────────────────

  /** Show a speech bubble above an entity for a few seconds. */
  showSpeechBubble(entityId: string, message: string, durationMs = 3000): void {
    const visual = this.visuals.get(entityId);
    if (!visual?.sprite) return;

    // Remove existing bubble first
    this.destroySpeechBubble(visual);

    // Truncate long messages
    const displayText = message.length > 40 ? message.slice(0, 37) + "..." : message;

    const sx = visual.sprite.x;
    const sy = visual.sprite.y;
    const bubbleY = sy - 26;

    const text = this.scene.add
      .text(sx, bubbleY - 4, displayText, {
        fontSize: "8px",
        fontFamily: "monospace",
        color: "#f1f5ff",
        wordWrap: { width: 100 },
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setDepth(100);

    const bounds = text.getBounds();
    const padX = 5;
    const padY = 3;
    const bgW = bounds.width + padX * 2;
    const bgH = bounds.height + padY * 2;

    const bg = this.scene.add
      .rectangle(sx, bubbleY - bounds.height / 2 - padY + 1, bgW, bgH, 0x11182b)
      .setStrokeStyle(1, 0x29334d)
      .setOrigin(0.5, 0.5)
      .setDepth(99);

    // Small triangle tail pointing down
    const tail = this.scene.add
      .triangle(sx, bubbleY + 1, -3, 0, 3, 0, 0, 5, 0x11182b)
      .setStrokeStyle(1, 0x29334d)
      .setDepth(99);

    // Fade in
    bg.setAlpha(0);
    text.setAlpha(0);
    tail.setAlpha(0);
    this.scene.tweens.add({
      targets: [bg, text, tail],
      alpha: 1,
      duration: 150,
    });

    const timer = this.scene.time.delayedCall(durationMs, () => {
      // Fade out
      this.scene.tweens.add({
        targets: [bg, text, tail],
        alpha: 0,
        duration: 300,
        onComplete: () => {
          bg.destroy();
          text.destroy();
          tail.destroy();
          if (visual.speechBubble?.timer === timer) {
            visual.speechBubble = null;
          }
        },
      });
    });

    visual.speechBubble = { bg, text, tail, timer };
  }

  private destroySpeechBubble(visual: EntityVisual): void {
    if (!visual.speechBubble) return;
    const { bg, text, tail, timer } = visual.speechBubble;
    timer.destroy();
    bg.destroy();
    text.destroy();
    tail.destroy();
    visual.speechBubble = null;
  }

  /** Reposition quest marker and speech bubble relative to sprite. */
  private repositionOverlays(visual: EntityVisual): void {
    const sx = visual.sprite.x;
    const sy = visual.sprite.y;

    if (visual.questMarker) {
      visual.questMarker.setPosition(sx, sy - 20);
    }

    // Speech bubble follows sprite
    if (visual.speechBubble) {
      const { bg, text, tail } = visual.speechBubble;
      const bubbleY = sy - 26;
      const bounds = text.getBounds();
      text.setPosition(sx, bubbleY - 4);
      bg.setPosition(sx, bubbleY - bounds.height / 2 - 3 + 1);
      tail.setPosition(sx, bubbleY + 1);
    }
  }

  get entityCount(): number {
    return this.visuals.size;
  }

  updateViewport(viewport: Phaser.Geom.Rectangle): void {
    this.viewport = viewport;
    for (const [id, visual] of this.visuals) {
      this.refreshVisualVisibility(id, visual);
    }
  }

  /** Show or hide all entity visuals — used by LOD overview mode */
  setSpritesVisible(visible: boolean): void {
    this.spritesVisible = visible;
    for (const visual of this.visuals.values()) {
      this.refreshVisualVisibility(this.findVisualId(visual), visual);
    }
  }

  private refreshVisualVisibility(id: string | null, visual: EntityVisual): void {
    const entity = id ? this.entities.get(id) : undefined;
    const inViewport = DISABLE_ENTITY_VIEWPORT_CULLING || !this.viewport || this.isInViewport(visual);
    visual.inViewport = inViewport;

    const showSprite = this.spritesVisible && inViewport;
    const showDetails = showSprite && (!visual.isNpc || visual.hovered);
    const showMarker = showSprite && (!this.lowPower || !entity || entity.type === "player" || entity.type === "boss");

    visual.sprite.setVisible(showSprite);
    visual.label.setVisible(showDetails);
    visual.hpBar.setVisible(showDetails);
    visual.hpBg.setVisible(showDetails);
    visual.partyRing?.setVisible(showSprite);
    visual.questMarker?.setVisible(showMarker);
    if (visual.speechBubble) {
      visual.speechBubble.bg.setVisible(showSprite);
      visual.speechBubble.text.setVisible(showSprite);
      visual.speechBubble.tail.setVisible(showSprite);
    }
  }

  private isInViewport(visual: EntityVisual): boolean {
    if (!this.viewport) return true;
    const margin = this.lowPower ? 64 : 96;
    const halfSize = SPRITE_SIZE * visual.spriteScale;
    const left = visual.sprite.x - halfSize;
    const right = visual.sprite.x + halfSize;
    const top = visual.sprite.y - halfSize;
    const bottom = visual.sprite.y + halfSize;

    return !(
      right < this.viewport.x - margin ||
      left > this.viewport.right + margin ||
      bottom < this.viewport.y - margin ||
      top > this.viewport.bottom + margin
    );
  }

  private findVisualId(target: EntityVisual): string | null {
    for (const [id, visual] of this.visuals) {
      if (visual === target) return id;
    }
    return null;
  }
}

// ─── Set Utilities ─────────────────────────────────────────────────────
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
