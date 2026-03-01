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

// ── Particle emitter configs per technique type ───────────────────────
interface EmitterCfg {
  tint: number[];
  count: number;
  speed: { min: number; max: number };
  scale: { start: number; end: number };
  lifespan: number;
  gravityY: number;
}

const EMITTER_CFGS: Record<string, EmitterCfg> = {
  attack:  { tint: [0xf83600, 0xf89800, 0xfacc22], count: 14, speed: { min: 60,  max: 160 }, scale: { start: 0.9, end: 0 }, lifespan: 700, gravityY: 60  },
  healing: { tint: [0x96e0da, 0x00ff88, 0xffffff], count: 10, speed: { min: 30,  max: 90  }, scale: { start: 0.7, end: 0 }, lifespan: 800, gravityY: -40 },
  buff:    { tint: [0xfacc22, 0xffffff, 0xf0d060], count:  8, speed: { min: 20,  max: 70  }, scale: { start: 0.6, end: 0 }, lifespan: 750, gravityY: -30 },
  debuff:  { tint: [0x937ef3, 0x5500aa, 0xdd00ff], count: 10, speed: { min: 40,  max: 110 }, scale: { start: 0.8, end: 0 }, lifespan: 700, gravityY: 50  },
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
      case "melee":     this.playMelee(techType, casterPos, targetPos); break;
      case "projectile":this.playProjectile(techType, casterPos, targetPos); break;
      case "area":      this.playArea(techType, targetPos); break;
      case "channel":   this.playChannel(techType, casterPos, targetPos); break;
      default:          this.burst(techType, targetPos); break;
    }
  }

  // ── Melee: immediate burst at impact ──────────────────────────────
  private playMelee(techType: string, _caster: Pos, target: Pos): void {
    this.burst(techType, target);
  }

  // ── Projectile: dot travels from caster to target, then burst ─────
  private playProjectile(techType: string, src: Pos, dst: Pos): void {
    const color = TYPE_COLOR[techType] ?? 0xffffff;
    const dot = this.scene.add.graphics();
    dot.fillStyle(color, 1);
    dot.fillCircle(0, 0, 4);
    dot.setPosition(src.x, src.y);
    dot.setDepth(95);

    // Short flash at caster first
    const srcFlash = this.scene.add.graphics();
    srcFlash.fillStyle(color, 0.6);
    srcFlash.fillCircle(0, 0, 6);
    srcFlash.setPosition(src.x, src.y);
    srcFlash.setDepth(94);
    this.scene.tweens.add({
      targets: srcFlash, alpha: 0, duration: 200,
      onComplete: () => srcFlash.destroy(),
    });

    const dist  = Math.sqrt((dst.x - src.x) ** 2 + (dst.y - src.y) ** 2);
    const speed = Math.max(180, dist);          // px/s — faster for longer distances
    const dur   = Math.min(500, (dist / speed) * 1000);

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

  // ── Area: expanding ring + burst at center ─────────────────────────
  private playArea(techType: string, center: Pos): void {
    const color = TYPE_COLOR[techType] ?? 0xffffff;

    // Inner burst
    this.burst(techType, center);

    // Expanding ring
    const ring = this.scene.add.arc(center.x, center.y, 10, 0, 360, false);
    ring.setStrokeStyle(2, color, 1);
    ring.setFillStyle();
    ring.setDepth(85);

    // Second, slightly delayed outer ring
    this.scene.time.delayedCall(80, () => {
      const ring2 = this.scene.add.arc(center.x, center.y, 10, 0, 360, false);
      ring2.setStrokeStyle(1.5, color, 0.6);
      ring2.setFillStyle();
      ring2.setDepth(84);
      this.scene.tweens.add({
        targets: ring2, scaleX: 7, scaleY: 7, alpha: 0,
        duration: 500, ease: "Quad.easeOut",
        onComplete: () => ring2.destroy(),
      });
    });

    this.scene.tweens.add({
      targets: ring, scaleX: 5, scaleY: 5, alpha: 0,
      duration: 420, ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  // ── Channel: 3 pulsed bursts at caster, beam line to target ───────
  private playChannel(techType: string, src: Pos, dst: Pos): void {
    const color = TYPE_COLOR[techType] ?? 0xffffff;
    const emitter = this.emitters.get(techType) ?? this.emitters.get("attack")!;

    // Beam line from caster to target (fades out)
    const beam = this.scene.add.graphics();
    beam.lineStyle(2, color, 0.8);
    beam.beginPath();
    beam.moveTo(src.x, src.y);
    beam.lineTo(dst.x, dst.y);
    beam.strokePath();
    beam.setDepth(88);
    this.scene.tweens.add({
      targets: beam, alpha: 0, duration: 600,
      onComplete: () => beam.destroy(),
    });

    // 3 pulsed particle bursts at caster, 150ms apart
    const pulse = (cfg: EmitterCfg) => Math.ceil(cfg.count * 0.5);
    for (let i = 0; i < 3; i++) {
      this.scene.time.delayedCall(i * 150, () => {
        emitter.explode(pulse(EMITTER_CFGS[techType] ?? EMITTER_CFGS.attack), src.x, src.y);
      });
    }

    // Final impact burst at target
    this.scene.time.delayedCall(450, () => this.burst(techType, dst));
  }

  // ── Death: large multi-color burst + fading ring ──────────────────
  playDeath(pos: Pos): void {
    // Big particle burst using attack emitter
    const emitter = this.emitters.get("attack")!;
    emitter.explode(28, pos.x, pos.y);

    // Second burst of debuff (purple) particles for drama
    const debuffEmitter = this.emitters.get("debuff")!;
    this.scene.time.delayedCall(80, () => {
      debuffEmitter.explode(14, pos.x, pos.y);
    });

    // Expanding skull-flash ring
    const ring = this.scene.add.arc(pos.x, pos.y, 6, 0, 360, false);
    ring.setStrokeStyle(3, 0xff2222, 1);
    ring.setFillStyle();
    ring.setDepth(92);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 8, scaleY: 8, alpha: 0,
      duration: 500, ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────
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

  private createTexture(): void {
    if (this.scene.textures.exists(TEXTURE_KEY)) return;
    const rt = this.scene.add.renderTexture(0, 0, 16, 16);
    const circle = this.scene.add.arc(8, 8, 6, 0, 360, false, 0xffffff, 1);
    circle.setDepth(-999);
    rt.draw(circle, 8, 8);
    rt.saveTexture(TEXTURE_KEY);
    circle.destroy();
    rt.destroy();
  }

  private buildEmitter(cfg: EmitterCfg): Phaser.GameObjects.Particles.ParticleEmitter {
    const emitter = this.scene.add.particles(0, 0, TEXTURE_KEY, {
      speed: cfg.speed,
      scale: cfg.scale,
      lifespan: cfg.lifespan,
      blendMode: Phaser.BlendModes.ADD,
      tint: cfg.tint,
      gravityY: cfg.gravityY,
      quantity: cfg.count,
      emitting: false,
    });
    emitter.setDepth(90);
    return emitter;
  }
}
