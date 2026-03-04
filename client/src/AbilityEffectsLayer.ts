import Phaser from "phaser";
import type { ZoneEvent } from "./types.js";

const COORD_SCALE = 1.6;
const TEXTURE_KEY = "ability-particle-dot";

// ── Colors per technique type ─────────────────────────────────────────
const TYPE_COLOR: Record<string, number> = {
  attack:  0xf89800,
  healing: 0x00ff88,
  buff:    0xfacc22,
  debuff:  0xaa44ff,
};

// ── Particle emitter configs — tuned for subtle, small-sprite visuals ──
interface EmitterCfg {
  tint: number[];
  count: number;
  speed: { min: number; max: number };
  scale: { start: number; end: number };
  lifespan: number;
  gravityY: number;
}

const EMITTER_CFGS: Record<string, EmitterCfg> = {
  attack:  { tint: [0xf89800, 0xfacc22], count: 5, speed: { min: 20, max: 50 }, scale: { start: 0.4, end: 0 }, lifespan: 350, gravityY: 20  },
  healing: { tint: [0x00ff88, 0xccffee], count: 4, speed: { min: 10, max: 30 }, scale: { start: 0.3, end: 0 }, lifespan: 450, gravityY: -15 },
  buff:    { tint: [0xfacc22, 0xf0d060], count: 3, speed: { min: 8,  max: 25 }, scale: { start: 0.3, end: 0 }, lifespan: 400, gravityY: -12 },
  debuff:  { tint: [0xaa44ff, 0x7722cc], count: 4, speed: { min: 15, max: 40 }, scale: { start: 0.35, end: 0 }, lifespan: 350, gravityY: 15  },
};

type Pos = { x: number; y: number };

export class AbilityEffectsLayer {
  private scene: Phaser.Scene;
  private emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private seen = new Map<string, number>();
  private coordScale = COORD_SCALE;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.createTexture();
    for (const [type, cfg] of Object.entries(EMITTER_CFGS)) {
      this.emitters.set(type, this.buildEmitter(cfg));
    }
  }

  setCoordScale(scale: number): void {
    this.coordScale = scale;
  }

  playEffect(event: ZoneEvent, entityPixelPositions: Map<string, Pos>): void {
    if (this.seen.has(event.id)) return;
    this.seen.set(event.id, Date.now());
    this.pruneSeen();

    const data = event.data as Record<string, unknown> | undefined;
    const techType  = (data?.techniqueType as string) ?? "attack";
    const animStyle = (data?.animStyle     as string) ?? "";

    const casterPos = this.resolvePos(
      event.entityId, entityPixelPositions,
      (data?.casterX ?? 0) as number, (data?.casterZ ?? 0) as number,
    );
    const targetPos = this.resolvePos(
      event.targetId ?? event.entityId, entityPixelPositions,
      (data?.targetX ?? data?.casterX ?? 0) as number,
      (data?.targetZ ?? data?.casterZ ?? 0) as number,
    );

    switch (animStyle) {
      case "melee":     this.burst(techType, targetPos); break;
      case "projectile":this.playProjectile(techType, casterPos, targetPos); break;
      case "area":      this.playArea(techType, targetPos); break;
      case "channel":   this.playChannel(techType, casterPos, targetPos); break;
      default:          this.burst(techType, targetPos); break;
    }
  }

  // ── Projectile: small dot travels caster→target, burst on impact ────
  private playProjectile(techType: string, src: Pos, dst: Pos): void {
    const color = TYPE_COLOR[techType] ?? 0xffffff;
    const dot = this.scene.add.graphics();
    dot.fillStyle(color, 0.9);
    dot.fillCircle(0, 0, 2);
    dot.setPosition(src.x, src.y);
    dot.setDepth(95);

    const dist  = Math.sqrt((dst.x - src.x) ** 2 + (dst.y - src.y) ** 2);
    const speed = Math.max(180, dist);
    const dur   = Math.min(400, (dist / speed) * 1000);

    this.scene.tweens.add({
      targets: dot,
      x: dst.x,
      y: dst.y,
      duration: dur,
      ease: "Quad.easeIn",
      onComplete: () => {
        dot.destroy();
        this.burst(techType, dst);
      },
    });
  }

  // ── Area: single thin expanding ring + small burst ──────────────────
  private playArea(techType: string, center: Pos): void {
    const color = TYPE_COLOR[techType] ?? 0xffffff;
    this.burst(techType, center);

    const ring = this.scene.add.arc(center.x, center.y, 6, 0, 360, false);
    ring.setStrokeStyle(1, color, 0.7);
    ring.setFillStyle();
    ring.setDepth(85);
    this.scene.tweens.add({
      targets: ring, scaleX: 4, scaleY: 4, alpha: 0,
      duration: 350, ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  // ── Channel: thin beam line + burst at target ───────────────────────
  private playChannel(techType: string, src: Pos, dst: Pos): void {
    const color = TYPE_COLOR[techType] ?? 0xffffff;

    const beam = this.scene.add.graphics();
    beam.lineStyle(1, color, 0.6);
    beam.beginPath();
    beam.moveTo(src.x, src.y);
    beam.lineTo(dst.x, dst.y);
    beam.strokePath();
    beam.setDepth(88);
    this.scene.tweens.add({
      targets: beam, alpha: 0, duration: 400,
      onComplete: () => beam.destroy(),
    });

    this.scene.time.delayedCall(200, () => this.burst(techType, dst));
  }

  // ── Level up: small gold pop ────────────────────────────────────────
  playLevelUp(pos: Pos): void {
    const emitter = this.emitters.get("buff")!;
    emitter.explode(6, pos.x, pos.y);

    const ring = this.scene.add.arc(pos.x, pos.y, 5, 0, 360, false);
    ring.setStrokeStyle(1, 0xffd700, 0.8);
    ring.setFillStyle();
    ring.setDepth(92);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 4, scaleY: 4, alpha: 0,
      duration: 450, ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  // ── Technique learned: purple sparkle burst ─────────────────────────
  playTechniqueLearned(pos: Pos): void {
    const emitter = this.emitters.get("debuff")!; // purple particles
    emitter.explode(10, pos.x, pos.y);

    const ring = this.scene.add.arc(pos.x, pos.y, 5, 0, 360, false);
    ring.setStrokeStyle(1.5, 0xbb9af7, 0.9);
    ring.setFillStyle();
    ring.setDepth(92);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 5, scaleY: 5, alpha: 0,
      duration: 550, ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  // ── Death: brief red flash ──────────────────────────────────────────
  playDeath(pos: Pos): void {
    const emitter = this.emitters.get("attack")!;
    emitter.explode(8, pos.x, pos.y);

    const ring = this.scene.add.arc(pos.x, pos.y, 4, 0, 360, false);
    ring.setStrokeStyle(1.5, 0xff2222, 0.8);
    ring.setFillStyle();
    ring.setDepth(92);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 5, scaleY: 5, alpha: 0,
      duration: 350, ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  private burst(techType: string, pos: Pos): void {
    const emitter = this.emitters.get(techType) ?? this.emitters.get("attack")!;
    emitter.explode(emitter.quantity as number, pos.x, pos.y);
  }

  private resolvePos(
    entityId: string | undefined,
    positions: Map<string, Pos>,
    worldX: number,
    worldZ: number,
  ): Pos {
    return (entityId ? positions.get(entityId) : undefined)
      ?? { x: worldX * this.coordScale, y: worldZ * this.coordScale };
  }

  private pruneSeen(): void {
    const cutoff = Date.now() - 6000;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }

  /** 8×8 soft dot — smaller texture for subtler particles */
  private createTexture(): void {
    if (this.scene.textures.exists(TEXTURE_KEY)) return;
    const rt = this.scene.add.renderTexture(0, 0, 8, 8);
    const circle = this.scene.add.arc(4, 4, 3, 0, 360, false, 0xffffff, 1);
    circle.setDepth(-999);
    rt.draw(circle, 4, 4);
    rt.saveTexture(TEXTURE_KEY);
    circle.destroy();
    rt.destroy();
  }

  private buildEmitter(cfg: EmitterCfg): Phaser.GameObjects.Particles.ParticleEmitter {
    const emitter = this.scene.add.particles(0, 0, TEXTURE_KEY, {
      speed: cfg.speed,
      scale: cfg.scale,
      lifespan: cfg.lifespan,
      blendMode: Phaser.BlendModes.NORMAL,
      tint: cfg.tint,
      gravityY: cfg.gravityY,
      quantity: cfg.count,
      emitting: false,
    });
    emitter.setDepth(90);
    return emitter;
  }
}
