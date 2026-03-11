import Phaser from "phaser";
import type { ZoneEvent } from "./types.js";
import {
  getTechniqueVisual,
  type TechniqueVisual,
} from "@/lib/techniqueVisuals";

const COORD_SCALE = 1.6;
const TEX_DOT = "ability-particle-dot";
const TEX_SOFT = "ability-particle-soft";
const TEX_SPARK = "ability-particle-spark";

interface BurstCfg {
  tint: number[];
  count: number;
  speed: { min: number; max: number };
  scale: { start: number; end: number };
  lifespan: number;
  gravityY: number;
  blendMode: number;
  texture: string;
  alpha: { start: number; end: number };
}

const DEFAULT_BURST_CFG: Record<string, BurstCfg> = {
  attack:  { tint: [0xff5533, 0xffaa22], count: 10, speed: { min: 30, max: 70 }, scale: { start: 0.6, end: 0 }, lifespan: 420, gravityY: 20, blendMode: Phaser.BlendModes.ADD, texture: TEX_SPARK, alpha: { start: 1, end: 0 } },
  healing: { tint: [0x00ff88, 0x88ffcc], count: 8, speed: { min: 12, max: 36 }, scale: { start: 0.5, end: 0.1 }, lifespan: 550, gravityY: -20, blendMode: Phaser.BlendModes.ADD, texture: TEX_SOFT, alpha: { start: 0.9, end: 0 } },
  buff:    { tint: [0x66ccff, 0xaaeeff], count: 7, speed: { min: 10, max: 28 }, scale: { start: 0.45, end: 0.1 }, lifespan: 500, gravityY: -16, blendMode: Phaser.BlendModes.ADD, texture: TEX_SOFT, alpha: { start: 0.85, end: 0 } },
  debuff:  { tint: [0xcc33ff, 0x7722cc], count: 9, speed: { min: 18, max: 52 }, scale: { start: 0.55, end: 0 }, lifespan: 400, gravityY: 14, blendMode: Phaser.BlendModes.ADD, texture: TEX_SPARK, alpha: { start: 1, end: 0 } },
};

type Pos = { x: number; y: number };

export class AbilityEffectsLayer {
  private scene: Phaser.Scene;
  private seen = new Map<string, number>();
  private coordScale = COORD_SCALE;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.createTexture();
  }

  setCoordScale(scale: number): void {
    this.coordScale = scale;
  }

  playEffect(event: ZoneEvent, entityPixelPositions: Map<string, Pos>): void {
    if (this.seen.has(event.id)) return;
    this.seen.set(event.id, Date.now());
    this.pruneSeen();

    const data = event.data as Record<string, unknown> | undefined;
    const techType = (data?.techniqueType as string) ?? "attack";
    const techniqueId = (data?.techniqueId as string) ?? "";
    const animStyle = (data?.animStyle as string) ?? "";
    const signature = getTechniqueVisual(techniqueId, techType);

    const casterPos = this.resolvePos(
      event.entityId, entityPixelPositions,
      (data?.casterX ?? 0) as number, (data?.casterZ ?? 0) as number,
    );
    const targetPos = this.resolvePos(
      event.targetId ?? event.entityId, entityPixelPositions,
      (data?.targetX ?? data?.casterX ?? 0) as number,
      (data?.targetZ ?? data?.casterZ ?? 0) as number,
    );

    // ── Technique-specific overrides with unique Phaser effects ──────
    if (this.playTechniqueOverride(techniqueId, signature, techType, casterPos, targetPos)) {
      return;
    }

    switch (animStyle) {
      case "melee": this.burst(signature, techType, targetPos); break;
      case "projectile": this.playProjectile(signature, techType, casterPos, targetPos); break;
      case "area": this.playArea(signature, techType, targetPos); break;
      case "channel": this.playChannel(signature, techType, casterPos, targetPos); break;
      default: this.burst(signature, techType, targetPos); break;
    }
  }

  // ── Per-technique custom VFX ──────────────────────────────────────

  private playTechniqueOverride(
    id: string, sig: TechniqueVisual, techType: string,
    src: Pos, dst: Pos,
  ): boolean {
    switch (id) {
      // ── WARRIOR ────────────────────────────────────────────────────
      case "warrior_heroic_strike":
        this.fxSlashArc(dst, sig, 1.0);
        this.burst(sig, techType, dst);
        this.fxScreenShake(3, 120);
        return true;
      case "warrior_cleave":
        this.fxSlashArc(dst, sig, 1.6);
        this.fxSlashArc(dst, sig, 1.6, -1);
        this.burst(sig, techType, dst);
        this.fxScreenShake(4, 150);
        return true;
      case "warrior_intimidating_shout":
        this.fxShockwave(src, sig, 3);
        this.burst(sig, techType, src);
        this.fxScreenShake(5, 180);
        return true;

      // ── MAGE ───────────────────────────────────────────────────────
      case "mage_fireball":
        this.playProjectile(sig, techType, src, dst);
        this.fxScreenShake(3, 100);
        return true;
      case "mage_arcane_missiles":
        this.fxArcaneBarrage(src, dst, sig, 5);
        return true;
      case "mage_flamestrike":
        this.fxMeteor(dst, sig);
        return true;

      // ── MONK ───────────────────────────────────────────────────────
      case "monk_palm_strike":
        this.fxPalmStrike(dst, sig);
        return true;
      case "monk_chi_burst":
        this.fxChiBurst(src, dst, sig);
        return true;
      case "monk_meditation":
        this.fxMeditation(src, sig);
        return true;

      // ── ROGUE ──────────────────────────────────────────────────────
      case "rogue_backstab":
        this.fxBackstab(src, dst, sig);
        return true;
      case "rogue_shadow_strike":
        this.fxShadowStrike(src, dst, sig);
        return true;
      case "rogue_poison_blade":
        this.fxPoisonSplash(dst, sig);
        return true;

      // ── RANGER ─────────────────────────────────────────────────────
      case "ranger_aimed_shot":
        this.fxSniperShot(src, dst, sig);
        return true;
      case "ranger_multi_shot":
        this.fxMultiShot(src, dst, sig);
        return true;

      // ── PALADIN ────────────────────────────────────────────────────
      case "paladin_holy_smite":
        this.fxHolySmite(dst, sig);
        return true;
      case "paladin_consecration":
        this.fxConsecration(dst, sig);
        return true;

      // ── CLERIC ─────────────────────────────────────────────────────
      case "cleric_holy_light":
        this.fxHolyLight(dst, sig);
        return true;

      // ── WARLOCK ────────────────────────────────────────────────────
      case "warlock_drain_life":
        this.fxDrainLife(src, dst, sig);
        return true;
      case "warlock_shadow_bolt":
        this.fxShadowBolt(src, dst, sig);
        return true;
      case "warlock_corruption":
        this.fxCorruption(dst, sig);
        return true;

      default:
        return false;
    }
  }

  // ── Reusable FX primitives ────────────────────────────────────────

  /** Camera shake */
  private fxScreenShake(intensity: number, duration: number): void {
    this.scene.cameras.main.shake(duration, intensity * 0.001);
  }

  /** Expanding shockwave rings */
  private fxShockwave(pos: Pos, sig: TechniqueVisual, count: number): void {
    for (let i = 0; i < count; i++) {
      const ring = this.scene.add.arc(pos.x, pos.y, 4, 0, 360, false);
      ring.setStrokeStyle(2 - i * 0.3, sig.primary, 0.8);
      ring.setFillStyle();
      ring.setDepth(92);
      ring.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: ring,
        scaleX: 5 + i * 3, scaleY: 5 + i * 3, alpha: 0,
        duration: 350 + i * 100, ease: "Quad.easeOut",
        delay: i * 60,
        onComplete: () => ring.destroy(),
      });
    }
  }

  /** Melee slash arc — a curved line that sweeps across the target */
  private fxSlashArc(pos: Pos, sig: TechniqueVisual, scale: number, dir = 1): void {
    const arc = this.scene.add.graphics();
    arc.setDepth(93);
    arc.setBlendMode(Phaser.BlendModes.ADD);
    // Outer glow
    arc.lineStyle(3, sig.primary, 0.5);
    arc.beginPath();
    arc.arc(pos.x, pos.y, 10 * scale, Phaser.Math.DegToRad(-60 * dir), Phaser.Math.DegToRad(60 * dir), dir < 0);
    arc.strokePath();
    // Inner bright core
    arc.lineStyle(1.5, sig.accent, 0.95);
    arc.beginPath();
    arc.arc(pos.x, pos.y, 10 * scale, Phaser.Math.DegToRad(-60 * dir), Phaser.Math.DegToRad(60 * dir), dir < 0);
    arc.strokePath();

    this.scene.tweens.add({
      targets: arc,
      scaleX: 1.6, scaleY: 1.6, alpha: 0,
      duration: 250, ease: "Quad.easeOut",
      onComplete: () => arc.destroy(),
    });
  }

  // ── Class-specific compound effects ───────────────────────────────

  /** Monk Palm Strike — rapid concentric impact rings + directional shockline */
  private fxPalmStrike(pos: Pos, sig: TechniqueVisual): void {
    // Impact flash
    const flash = this.scene.add.arc(pos.x, pos.y, 5, 0, 360, false, sig.accent, 0.9);
    flash.setDepth(93);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      scaleX: 4, scaleY: 4, alpha: 0,
      duration: 180, ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // 3 fast concentric rings
    for (let i = 0; i < 3; i++) {
      const ring = this.scene.add.arc(pos.x, pos.y, 3, 0, 360, false);
      ring.setStrokeStyle(1.5, i === 0 ? sig.accent : sig.primary, 0.85 - i * 0.2);
      ring.setFillStyle();
      ring.setDepth(92);
      ring.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: ring,
        scaleX: 3 + i * 1.5, scaleY: 3 + i * 1.5, alpha: 0,
        duration: 200 + i * 60, ease: "Cubic.easeOut",
        delay: i * 40,
        onComplete: () => ring.destroy(),
      });
    }

    // Speed lines radiating from impact
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.3;
      const line = this.scene.add.graphics();
      line.setDepth(91);
      line.setBlendMode(Phaser.BlendModes.ADD);
      line.lineStyle(1, sig.primary, 0.7);
      line.beginPath();
      line.moveTo(pos.x + Math.cos(angle) * 4, pos.y + Math.sin(angle) * 4);
      line.lineTo(pos.x + Math.cos(angle) * 14, pos.y + Math.sin(angle) * 14);
      line.strokePath();
      this.scene.tweens.add({
        targets: line,
        alpha: 0,
        duration: 200,
        delay: 30,
        onComplete: () => line.destroy(),
      });
    }

    this.burst(sig, "attack", pos);
    this.fxScreenShake(3, 80);
  }

  /** Monk Chi Burst — spiraling energy ball */
  private fxChiBurst(src: Pos, dst: Pos, sig: TechniqueVisual): void {
    const dx = dst.x - src.x;
    const dy = dst.y - src.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dur = Math.min(500, Math.max(200, (dist / 180) * 1000));

    // Main orb
    const orb = this.scene.add.arc(src.x, src.y, 4, 0, 360, false, sig.primary, 0.9);
    orb.setDepth(95);
    orb.setBlendMode(Phaser.BlendModes.ADD);

    // Outer halo
    const halo = this.scene.add.arc(src.x, src.y, 7, 0, 360, false, sig.accent, 0.3);
    halo.setDepth(94);
    halo.setBlendMode(Phaser.BlendModes.ADD);

    // Spiral trail
    const trailEmitter = this.scene.add.particles(0, 0, TEX_SOFT, {
      speed: { min: 5, max: 15 },
      scale: { start: 0.4, end: 0 },
      lifespan: 250,
      blendMode: Phaser.BlendModes.ADD,
      tint: [sig.primary, sig.secondary, sig.accent],
      alpha: { start: 0.7, end: 0 },
      frequency: 20,
      follow: orb,
    });
    trailEmitter.setDepth(93);

    this.scene.tweens.add({
      targets: [orb, halo],
      x: dst.x, y: dst.y,
      duration: dur,
      ease: "Sine.easeInOut",
      onComplete: () => {
        orb.destroy();
        halo.destroy();
        trailEmitter.stop();
        this.scene.time.delayedCall(300, () => trailEmitter.destroy());

        // Impact: triple expanding rings
        for (let i = 0; i < 3; i++) {
          const ring = this.scene.add.arc(dst.x, dst.y, 3, 0, 360, false);
          ring.setStrokeStyle(1.5 - i * 0.3, i === 0 ? sig.accent : sig.primary, 0.9 - i * 0.2);
          ring.setFillStyle();
          ring.setDepth(92);
          ring.setBlendMode(Phaser.BlendModes.ADD);
          this.scene.tweens.add({
            targets: ring,
            scaleX: 4 + i * 2, scaleY: 4 + i * 2, alpha: 0,
            duration: 280 + i * 80, ease: "Quad.easeOut",
            delay: i * 50,
            onComplete: () => ring.destroy(),
          });
        }

        this.burst(sig, "attack", dst);
        this.fxScreenShake(4, 100);
      },
    });
  }

  /** Monk Meditation — pulsing aura rings rising upward */
  private fxMeditation(pos: Pos, sig: TechniqueVisual): void {
    // Rising heal particles
    const healEmitter = this.scene.add.particles(0, 0, TEX_SOFT, {
      x: pos.x,
      y: pos.y,
      speed: { min: 8, max: 20 },
      angle: { min: 240, max: 300 },
      scale: { start: 0.5, end: 0 },
      lifespan: 800,
      blendMode: Phaser.BlendModes.ADD,
      tint: [sig.primary, sig.secondary, sig.accent],
      alpha: { start: 0.7, end: 0 },
      frequency: 60,
    });
    healEmitter.setDepth(90);

    // 4 concentric pulse rings
    for (let i = 0; i < 4; i++) {
      this.scene.time.delayedCall(i * 250, () => {
        const ring = this.scene.add.arc(pos.x, pos.y, 4, 0, 360, false);
        ring.setStrokeStyle(1, sig.primary, 0.6);
        ring.setFillStyle();
        ring.setDepth(91);
        ring.setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({
          targets: ring,
          scaleX: 3.5, scaleY: 3.5, alpha: 0,
          duration: 500, ease: "Sine.easeOut",
          onComplete: () => ring.destroy(),
        });
      });
    }

    this.scene.time.delayedCall(1000, () => {
      healEmitter.stop();
      this.scene.time.delayedCall(900, () => healEmitter.destroy());
    });

    this.burst(sig, "healing", pos);
  }

  /** Rogue Backstab — dash line + stab flash */
  private fxBackstab(src: Pos, dst: Pos, sig: TechniqueVisual): void {
    // Dash trail line
    const trail = this.scene.add.graphics();
    trail.setDepth(92);
    trail.setBlendMode(Phaser.BlendModes.ADD);
    trail.lineStyle(2, sig.primary, 0.6);
    trail.beginPath();
    trail.moveTo(src.x, src.y);
    trail.lineTo(dst.x, dst.y);
    trail.strokePath();
    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 200,
      onComplete: () => trail.destroy(),
    });

    // Stab flash — X shape
    const stab = this.scene.add.graphics();
    stab.setDepth(94);
    stab.setBlendMode(Phaser.BlendModes.ADD);
    stab.lineStyle(2, sig.accent, 0.95);
    stab.beginPath();
    stab.moveTo(dst.x - 6, dst.y - 6);
    stab.lineTo(dst.x + 6, dst.y + 6);
    stab.moveTo(dst.x + 6, dst.y - 6);
    stab.lineTo(dst.x - 6, dst.y + 6);
    stab.strokePath();
    this.scene.tweens.add({
      targets: stab,
      scaleX: 2, scaleY: 2, alpha: 0,
      duration: 200, ease: "Quad.easeOut",
      onComplete: () => stab.destroy(),
    });

    this.burst(sig, "attack", dst);
    this.fxScreenShake(2, 60);
  }

  /** Rogue Shadow Strike — teleport poof at src, reappear slash at dst */
  private fxShadowStrike(src: Pos, dst: Pos, sig: TechniqueVisual): void {
    // Vanish poof at source
    const poof = this.scene.add.particles(0, 0, TEX_SOFT, {
      speed: { min: 15, max: 40 },
      scale: { start: 0.6, end: 0 },
      lifespan: 350,
      blendMode: Phaser.BlendModes.ADD,
      tint: [0x222244, 0x4444aa, sig.primary],
      alpha: { start: 0.8, end: 0 },
      emitting: false,
    });
    poof.setDepth(90);
    poof.explode(10, src.x, src.y);
    this.scene.time.delayedCall(400, () => poof.destroy());

    // Delayed reappear at target
    this.scene.time.delayedCall(120, () => {
      this.fxSlashArc(dst, sig, 1.2);
      this.burst(sig, "attack", dst);
      this.fxScreenShake(4, 100);
    });
  }

  /** Rogue Poison — green droplets splashing */
  private fxPoisonSplash(pos: Pos, sig: TechniqueVisual): void {
    const splashEmitter = this.scene.add.particles(0, 0, TEX_DOT, {
      speed: { min: 15, max: 40 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.35, end: 0.1 },
      lifespan: 500,
      blendMode: Phaser.BlendModes.ADD,
      tint: [sig.primary, sig.secondary, 0x33ff33],
      alpha: { start: 0.9, end: 0 },
      gravityY: 40,
      emitting: false,
    });
    splashEmitter.setDepth(90);
    splashEmitter.explode(8, pos.x, pos.y);
    this.scene.time.delayedCall(600, () => splashEmitter.destroy());

    // Drip puddle
    const puddle = this.scene.add.arc(pos.x, pos.y + 4, 6, 0, 360, false, sig.primary, 0.3);
    puddle.setDepth(85);
    puddle.setBlendMode(Phaser.BlendModes.ADD);
    puddle.setScale(1, 0.4);
    this.scene.tweens.add({
      targets: puddle,
      alpha: 0, scaleX: 1.5,
      duration: 600, ease: "Quad.easeOut",
      onComplete: () => puddle.destroy(),
    });

    this.burst(sig, "debuff", pos);
  }

  /** Ranger Aimed Shot — fast thin line + delayed impact */
  private fxSniperShot(src: Pos, dst: Pos, sig: TechniqueVisual): void {
    // Muzzle flash
    const muzzle = this.scene.add.arc(src.x, src.y, 3, 0, 360, false, sig.accent, 0.8);
    muzzle.setDepth(93);
    muzzle.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: muzzle,
      scaleX: 2.5, scaleY: 2.5, alpha: 0,
      duration: 150, ease: "Quad.easeOut",
      onComplete: () => muzzle.destroy(),
    });

    // Instant tracer line
    const tracer = this.scene.add.graphics();
    tracer.setDepth(94);
    tracer.setBlendMode(Phaser.BlendModes.ADD);
    tracer.lineStyle(1, sig.accent, 0.9);
    tracer.beginPath();
    tracer.moveTo(src.x, src.y);
    tracer.lineTo(dst.x, dst.y);
    tracer.strokePath();
    this.scene.tweens.add({
      targets: tracer,
      alpha: 0,
      duration: 180,
      onComplete: () => tracer.destroy(),
    });

    // Delayed impact burst
    this.scene.time.delayedCall(60, () => {
      this.burst(sig, "attack", dst);
      this.fxScreenShake(2, 80);
    });
  }

  /** Ranger Multi-Shot — fan of arrows */
  private fxMultiShot(src: Pos, dst: Pos, sig: TechniqueVisual): void {
    const dx = dst.x - src.x;
    const dy = dst.y - src.y;
    const baseAngle = Math.atan2(dy, dx);
    const spread = 0.35; // radians

    for (let i = 0; i < 4; i++) {
      const angle = baseAngle + (i - 1.5) * spread;
      const dist = 50 + Math.random() * 20;
      const tx = src.x + Math.cos(angle) * dist;
      const ty = src.y + Math.sin(angle) * dist;

      this.scene.time.delayedCall(i * 60, () => {
        const arrow = this.scene.add.graphics();
        arrow.setDepth(94);
        arrow.setBlendMode(Phaser.BlendModes.ADD);
        arrow.lineStyle(1.5, sig.accent, 0.9);
        arrow.beginPath();
        arrow.moveTo(src.x, src.y);
        arrow.lineTo(src.x + Math.cos(angle) * 8, src.y + Math.sin(angle) * 8);
        arrow.strokePath();
        arrow.setPosition(0, 0);

        this.scene.tweens.add({
          targets: arrow,
          x: tx - src.x, y: ty - src.y,
          duration: 200, ease: "Quad.easeIn",
          onComplete: () => {
            arrow.destroy();
            this.burst(sig, "attack", { x: tx, y: ty });
          },
        });
      });
    }

    // Muzzle flash
    const muzzle = this.scene.add.arc(src.x, src.y, 2, 0, 360, false, sig.primary, 0.7);
    muzzle.setDepth(93);
    muzzle.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: muzzle,
      scaleX: 2, scaleY: 2, alpha: 0,
      duration: 200,
      onComplete: () => muzzle.destroy(),
    });
  }

  /** Mage Arcane Missiles — staggered homing bolts */
  private fxArcaneBarrage(src: Pos, dst: Pos, sig: TechniqueVisual, count: number): void {
    for (let i = 0; i < count; i++) {
      this.scene.time.delayedCall(i * 80, () => {
        // Each bolt wobbles slightly
        const wobbleX = (Math.random() - 0.5) * 12;
        const wobbleY = (Math.random() - 0.5) * 12;
        const midX = (src.x + dst.x) / 2 + wobbleX;
        const midY = (src.y + dst.y) / 2 + wobbleY;

        const bolt = this.scene.add.arc(src.x, src.y, 2, 0, 360, false, sig.accent, 0.95);
        bolt.setDepth(95);
        bolt.setBlendMode(Phaser.BlendModes.ADD);

        // Two-part tween: curve through midpoint, then to target
        this.scene.tweens.add({
          targets: bolt,
          x: midX, y: midY,
          duration: 100,
          ease: "Sine.easeOut",
          onComplete: () => {
            this.scene.tweens.add({
              targets: bolt,
              x: dst.x + (Math.random() - 0.5) * 4,
              y: dst.y + (Math.random() - 0.5) * 4,
              duration: 120,
              ease: "Quad.easeIn",
              onComplete: () => {
                bolt.destroy();
                // Small impact per bolt
                const flash = this.scene.add.arc(dst.x, dst.y, 2, 0, 360, false, sig.primary, 0.6);
                flash.setDepth(91);
                flash.setBlendMode(Phaser.BlendModes.ADD);
                this.scene.tweens.add({
                  targets: flash,
                  scaleX: 2, scaleY: 2, alpha: 0,
                  duration: 150,
                  onComplete: () => flash.destroy(),
                });
              },
            });
          },
        });
      });
    }

    // Final burst on last bolt
    this.scene.time.delayedCall(count * 80 + 220, () => {
      this.burst(sig, "attack", dst);
      this.fxScreenShake(3, 100);
    });
  }

  /** Mage Flamestrike — pillar of fire dropping from above */
  private fxMeteor(pos: Pos, sig: TechniqueVisual): void {
    // Falling meteor
    const meteor = this.scene.add.arc(pos.x, pos.y - 50, 5, 0, 360, false, sig.primary, 0.9);
    meteor.setDepth(96);
    meteor.setBlendMode(Phaser.BlendModes.ADD);

    const trail = this.scene.add.particles(0, 0, TEX_SPARK, {
      speed: { min: 5, max: 15 },
      scale: { start: 0.4, end: 0 },
      lifespan: 200,
      blendMode: Phaser.BlendModes.ADD,
      tint: [sig.primary, sig.secondary],
      alpha: { start: 0.8, end: 0 },
      frequency: 20,
      follow: meteor,
    });
    trail.setDepth(95);

    this.scene.tweens.add({
      targets: meteor,
      y: pos.y,
      duration: 250, ease: "Quad.easeIn",
      onComplete: () => {
        meteor.destroy();
        trail.stop();
        this.scene.time.delayedCall(250, () => trail.destroy());

        // Massive impact
        this.fxShockwave(pos, sig, 3);
        this.burst(sig, "attack", pos);
        this.fxScreenShake(6, 200);

        // Ground fire embers
        const embers = this.scene.add.particles(0, 0, TEX_SPARK, {
          x: pos.x, y: pos.y,
          speed: { min: 10, max: 35 },
          scale: { start: 0.4, end: 0 },
          lifespan: 600,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.secondary, 0xff4400],
          alpha: { start: 0.8, end: 0 },
          gravityY: 25,
          emitting: false,
        });
        embers.setDepth(89);
        embers.explode(12, pos.x, pos.y);
        this.scene.time.delayedCall(700, () => embers.destroy());
      },
    });
  }

  /** Paladin Holy Smite — golden cross flash + downward light pillar */
  private fxHolySmite(pos: Pos, sig: TechniqueVisual): void {
    // Cross shape
    const cross = this.scene.add.graphics();
    cross.setDepth(93);
    cross.setBlendMode(Phaser.BlendModes.ADD);
    cross.lineStyle(2.5, sig.accent, 0.95);
    cross.beginPath();
    cross.moveTo(pos.x - 8, pos.y);
    cross.lineTo(pos.x + 8, pos.y);
    cross.moveTo(pos.x, pos.y - 10);
    cross.lineTo(pos.x, pos.y + 6);
    cross.strokePath();
    this.scene.tweens.add({
      targets: cross,
      scaleX: 2.5, scaleY: 2.5, alpha: 0,
      duration: 350, ease: "Quad.easeOut",
      onComplete: () => cross.destroy(),
    });

    // Light pillar from above
    const pillar = this.scene.add.graphics();
    pillar.setDepth(88);
    pillar.setBlendMode(Phaser.BlendModes.ADD);
    pillar.fillStyle(sig.primary, 0.2);
    pillar.fillRect(pos.x - 4, pos.y - 40, 8, 40);
    pillar.fillStyle(sig.accent, 0.5);
    pillar.fillRect(pos.x - 1.5, pos.y - 40, 3, 40);
    this.scene.tweens.add({
      targets: pillar,
      alpha: 0,
      duration: 400, ease: "Quad.easeOut",
      delay: 100,
      onComplete: () => pillar.destroy(),
    });

    this.burst(sig, "attack", pos);
    this.fxScreenShake(3, 100);
  }

  /** Paladin Consecration — expanding holy ground circle */
  private fxConsecration(pos: Pos, sig: TechniqueVisual): void {
    // Ground circle (flat ellipse)
    for (let i = 0; i < 3; i++) {
      this.scene.time.delayedCall(i * 200, () => {
        const ground = this.scene.add.arc(pos.x, pos.y + 2, 8 + i * 4, 0, 360, false, sig.primary, 0.25 - i * 0.06);
        ground.setScale(1, 0.5);
        ground.setDepth(86);
        ground.setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({
          targets: ground,
          scaleX: 2.5, alpha: 0,
          duration: 700, ease: "Sine.easeOut",
          onComplete: () => ground.destroy(),
        });
      });
    }

    // Rising holy sparks
    const sparks = this.scene.add.particles(0, 0, TEX_SPARK, {
      x: pos.x, y: pos.y,
      speed: { min: 8, max: 25 },
      angle: { min: 240, max: 300 },
      scale: { start: 0.3, end: 0 },
      lifespan: 600,
      blendMode: Phaser.BlendModes.ADD,
      tint: [sig.primary, sig.accent, 0xffffff],
      alpha: { start: 0.8, end: 0 },
      frequency: 80,
    });
    sparks.setDepth(87);
    this.scene.time.delayedCall(800, () => {
      sparks.stop();
      this.scene.time.delayedCall(700, () => sparks.destroy());
    });

    this.burst(sig, "debuff", pos);
  }

  /** Cleric Holy Light — descending golden rays + heal pulse */
  private fxHolyLight(pos: Pos, sig: TechniqueVisual): void {
    // 3 descending light rays at slight angles
    for (let i = 0; i < 3; i++) {
      const offsetX = (i - 1) * 6;
      const ray = this.scene.add.graphics();
      ray.setDepth(88);
      ray.setBlendMode(Phaser.BlendModes.ADD);
      ray.lineStyle(2, sig.accent, 0.6 - i * 0.1);
      ray.beginPath();
      ray.moveTo(pos.x + offsetX, pos.y - 35);
      ray.lineTo(pos.x + offsetX * 0.3, pos.y);
      ray.strokePath();
      this.scene.tweens.add({
        targets: ray,
        alpha: 0,
        duration: 500, ease: "Quad.easeOut",
        delay: i * 60,
        onComplete: () => ray.destroy(),
      });
    }

    // Heal pulse ring
    const ring = this.scene.add.arc(pos.x, pos.y, 4, 0, 360, false);
    ring.setStrokeStyle(1.5, sig.primary, 0.8);
    ring.setFillStyle();
    ring.setDepth(91);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 4, scaleY: 4, alpha: 0,
      duration: 400, ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });

    this.burst(sig, "healing", pos);
  }

  /** Warlock Drain Life — reverse stream of red/green particles from target to caster */
  private fxDrainLife(src: Pos, dst: Pos, sig: TechniqueVisual): void {
    // Dark beam
    const beam = this.scene.add.graphics();
    beam.setDepth(88);
    beam.setBlendMode(Phaser.BlendModes.ADD);
    beam.lineStyle(3, sig.primary, 0.3);
    beam.beginPath();
    beam.moveTo(src.x, src.y);
    beam.lineTo(dst.x, dst.y);
    beam.strokePath();

    this.scene.tweens.add({
      targets: beam,
      alpha: 0,
      duration: 600,
      onComplete: () => beam.destroy(),
    });

    // Drain orbs traveling from target to caster
    for (let i = 0; i < 5; i++) {
      this.scene.time.delayedCall(i * 100, () => {
        const orb = this.scene.add.arc(dst.x, dst.y, 2, 0, 360, false, i % 2 === 0 ? 0xff3333 : 0x33ff66, 0.85);
        orb.setDepth(93);
        orb.setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({
          targets: orb,
          x: src.x + (Math.random() - 0.5) * 4,
          y: src.y + (Math.random() - 0.5) * 4,
          scaleX: 0.3, scaleY: 0.3, alpha: 0,
          duration: 350, ease: "Quad.easeIn",
          onComplete: () => orb.destroy(),
        });
      });
    }

    this.burst(sig, "attack", dst);
  }

  /** Warlock Shadow Bolt — dark orb with swirling shadow trail */
  private fxShadowBolt(src: Pos, dst: Pos, sig: TechniqueVisual): void {
    const orb = this.scene.add.arc(src.x, src.y, 3, 0, 360, false, sig.primary, 0.9);
    orb.setDepth(95);
    orb.setBlendMode(Phaser.BlendModes.ADD);

    // Dark swirl trail
    const trail = this.scene.add.particles(0, 0, TEX_SOFT, {
      speed: { min: 8, max: 20 },
      scale: { start: 0.45, end: 0 },
      lifespan: 250,
      blendMode: Phaser.BlendModes.ADD,
      tint: [sig.primary, sig.secondary, 0x220044],
      alpha: { start: 0.7, end: 0 },
      rotate: { min: 0, max: 360 },
      frequency: 25,
      follow: orb,
    });
    trail.setDepth(94);

    const dist = Math.sqrt((dst.x - src.x) ** 2 + (dst.y - src.y) ** 2);
    const dur = Math.min(400, Math.max(180, (dist / 200) * 1000));

    this.scene.tweens.add({
      targets: orb,
      x: dst.x, y: dst.y,
      duration: dur, ease: "Quad.easeIn",
      onComplete: () => {
        orb.destroy();
        trail.stop();
        this.scene.time.delayedCall(300, () => trail.destroy());
        this.burst(sig, "attack", dst);
        this.fxScreenShake(3, 80);
      },
    });
  }

  /** Warlock Corruption — swirling dark motes circling the target */
  private fxCorruption(pos: Pos, sig: TechniqueVisual): void {
    // Orbiting dark motes
    for (let i = 0; i < 5; i++) {
      const angle0 = (Math.PI * 2 * i) / 5;
      const mote = this.scene.add.arc(
        pos.x + Math.cos(angle0) * 10,
        pos.y + Math.sin(angle0) * 10,
        1.5, 0, 360, false, sig.primary, 0.85,
      );
      mote.setDepth(92);
      mote.setBlendMode(Phaser.BlendModes.ADD);

      // Spiral inward
      this.scene.tweens.add({
        targets: mote,
        x: pos.x, y: pos.y,
        scaleX: 0.3, scaleY: 0.3, alpha: 0,
        duration: 500 + i * 60,
        ease: "Sine.easeIn",
        delay: i * 50,
        onComplete: () => mote.destroy(),
      });
    }

    this.burst(sig, "debuff", pos);
  }

  // ── Projectile: small dot travels caster→target, burst on impact ────
  private playProjectile(signature: TechniqueVisual, techType: string, src: Pos, dst: Pos): void {
    const dot = this.scene.add.graphics();
    this.drawProjectile(dot, signature);
    dot.setPosition(src.x, src.y);
    dot.setDepth(95);
    dot.setBlendMode(Phaser.BlendModes.ADD);

    // Trail emitter follows the projectile
    const trailEmitter = this.scene.add.particles(0, 0, TEX_SOFT, {
      speed: { min: 2, max: 8 },
      scale: { start: 0.3, end: 0 },
      lifespan: 200,
      blendMode: Phaser.BlendModes.ADD,
      tint: [signature.primary, signature.secondary],
      alpha: { start: 0.6, end: 0 },
      frequency: 30,
      follow: dot,
    });
    trailEmitter.setDepth(94);

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
        trailEmitter.stop();
        this.scene.time.delayedCall(250, () => trailEmitter.destroy());
        this.burst(signature, techType, dst);
      },
    });
  }

  // ── Area: expanding ring + ground particles + burst ─────────────────
  private playArea(signature: TechniqueVisual, techType: string, center: Pos): void {
    this.burst(signature, techType, center);
    this.playImpactPattern(signature, center);

    // Ground particle spread for AoE
    const aoeEmitter = this.scene.add.particles(0, 0, TEX_SOFT, {
      x: center.x,
      y: center.y,
      speed: { min: 20, max: 50 },
      scale: { start: 0.5, end: 0 },
      lifespan: 500,
      blendMode: Phaser.BlendModes.ADD,
      tint: [signature.primary, signature.secondary],
      alpha: { start: 0.6, end: 0 },
      emitting: false,
    });
    aoeEmitter.setDepth(86);
    aoeEmitter.explode(Math.max(6, signature.count), center.x, center.y);
    this.scene.time.delayedCall(600, () => aoeEmitter.destroy());
  }

  // ── Channel: beam line + burst at target ────────────────────────────
  private playChannel(signature: TechniqueVisual, techType: string, src: Pos, dst: Pos): void {
    // Outer glow beam
    const beam = this.scene.add.graphics();
    const beamWidth = signature.beamPattern === "pulse" ? 5 : signature.beamPattern === "drain" ? 4 : 3;
    beam.lineStyle(beamWidth, signature.primary, 0.35);
    beam.beginPath();
    beam.moveTo(src.x, src.y);
    beam.lineTo(dst.x, dst.y);
    beam.strokePath();
    beam.setDepth(88);
    beam.setBlendMode(Phaser.BlendModes.ADD);

    // Inner bright core
    const core = this.scene.add.graphics();
    core.lineStyle(1.5, signature.accent, 0.95);
    core.beginPath();
    core.moveTo(src.x, src.y);
    core.lineTo(dst.x, dst.y);
    core.strokePath();
    core.setDepth(89);
    core.setBlendMode(Phaser.BlendModes.ADD);

    // Particles along the beam
    const dist = Math.sqrt((dst.x - src.x) ** 2 + (dst.y - src.y) ** 2);
    const steps = Math.max(3, Math.floor(dist / 10));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = src.x + (dst.x - src.x) * t;
      const py = src.y + (dst.y - src.y) * t;
      const dot = this.scene.add.arc(px, py, 1.5, 0, 360, false, signature.secondary, 0.8);
      dot.setDepth(90);
      dot.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: dot,
        alpha: 0, scaleX: 2.5, scaleY: 2.5,
        duration: 300 + i * 40,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy(),
      });
    }

    // Drain/prayer marker at midpoint
    if (signature.beamPattern === "drain" || signature.beamPattern === "prayer") {
      const mid = this.scene.add.graphics();
      const markerColor = signature.beamPattern === "drain" ? signature.secondary : signature.accent;
      const midX = (src.x + dst.x) / 2;
      const midY = (src.y + dst.y) / 2;
      if (signature.beamPattern === "drain") {
        mid.fillStyle(markerColor, 0.85);
        mid.fillCircle(midX, midY, 2.5);
      } else {
        mid.lineStyle(1.5, markerColor, 0.9);
        mid.beginPath();
        mid.moveTo(midX - 4, midY);
        mid.lineTo(midX + 4, midY);
        mid.moveTo(midX, midY - 4);
        mid.lineTo(midX, midY + 4);
        mid.strokePath();
      }
      mid.setDepth(90);
      mid.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: mid,
        alpha: 0,
        duration: 450,
        onComplete: () => mid.destroy(),
      });
    }

    // Flash at source
    const srcFlash = this.scene.add.arc(src.x, src.y, 2, 0, 360, false, signature.accent, 0.6);
    srcFlash.setDepth(91);
    srcFlash.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: srcFlash,
      scaleX: 3, scaleY: 3, alpha: 0,
      duration: 300, ease: "Quad.easeOut",
      onComplete: () => srcFlash.destroy(),
    });

    this.scene.tweens.add({
      targets: [beam, core], alpha: 0, duration: 450,
      onComplete: () => {
        beam.destroy();
        core.destroy();
      },
    });

    this.scene.time.delayedCall(180, () => this.burst(signature, techType, dst));
  }

  // ── Level up: gold burst with rising sparkles ──────────────────────
  playLevelUp(pos: Pos): void {
    const sig: TechniqueVisual = { primary: 0xffd700, secondary: 0xfff0a8, accent: 0xffffff, count: 12, projectileRadius: 2, ringRadius: 5, projectileShape: "flare", impactPattern: "ring", beamPattern: "pulse", uiGlyph: "*" };
    this.burst(sig, "buff", pos);

    // Double ring effect
    for (let i = 0; i < 2; i++) {
      const ring = this.scene.add.arc(pos.x, pos.y, 4, 0, 360, false);
      ring.setStrokeStyle(1.5, i === 0 ? 0xffd700 : 0xffffff, 0.8);
      ring.setFillStyle();
      ring.setDepth(92);
      ring.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: ring,
        scaleX: 5 + i * 2, scaleY: 5 + i * 2, alpha: 0,
        duration: 500 + i * 150, ease: "Quad.easeOut",
        delay: i * 80,
        onComplete: () => ring.destroy(),
      });
    }

    // Rising sparkle column
    const sparkEmitter = this.scene.add.particles(0, 0, TEX_SPARK, {
      x: pos.x,
      y: pos.y,
      speed: { min: 15, max: 40 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.4, end: 0 },
      lifespan: 600,
      blendMode: Phaser.BlendModes.ADD,
      tint: [0xffd700, 0xffffff, 0xffee66],
      alpha: { start: 1, end: 0 },
      frequency: 40,
    });
    sparkEmitter.setDepth(93);
    this.scene.time.delayedCall(500, () => {
      sparkEmitter.stop();
      this.scene.time.delayedCall(700, () => sparkEmitter.destroy());
    });
  }

  // ── Technique learned: purple sparkle burst ─────────────────────────
  playTechniqueLearned(pos: Pos): void {
    const sig: TechniqueVisual = { primary: 0xbb9af7, secondary: 0xc792ea, accent: 0xf1d7ff, count: 10, projectileRadius: 2, ringRadius: 5, projectileShape: "shard", impactPattern: "diamond", beamPattern: "pulse", uiGlyph: "*" };
    this.burst(sig, "debuff", pos);

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

  // ── Death: red burst with skull flash ───────────────────────────────
  playDeath(pos: Pos): void {
    const sig: TechniqueVisual = { primary: 0xff2222, secondary: 0xff6644, accent: 0xffaa88, count: 14, projectileRadius: 2, ringRadius: 4, projectileShape: "flare", impactPattern: "spokes", beamPattern: "solid", uiGlyph: "*" };
    this.burst(sig, "attack", pos);

    // Shockwave ring
    const ring = this.scene.add.arc(pos.x, pos.y, 3, 0, 360, false);
    ring.setStrokeStyle(2, 0xff2222, 0.9);
    ring.setFillStyle();
    ring.setDepth(92);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 6, scaleY: 6, alpha: 0,
      duration: 400, ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });

    // Falling embers
    const emberEmitter = this.scene.add.particles(0, 0, TEX_SPARK, {
      x: pos.x,
      y: pos.y,
      speed: { min: 10, max: 30 },
      angle: { min: 70, max: 110 },
      scale: { start: 0.35, end: 0 },
      lifespan: 500,
      blendMode: Phaser.BlendModes.ADD,
      tint: [0xff2222, 0xff6600, 0xffaa44],
      alpha: { start: 0.9, end: 0 },
      gravityY: 30,
      frequency: 50,
    });
    emberEmitter.setDepth(91);
    this.scene.time.delayedCall(350, () => {
      emberEmitter.stop();
      this.scene.time.delayedCall(600, () => emberEmitter.destroy());
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  private burst(signature: TechniqueVisual, techType: string, pos: Pos): void {
    const cfg = this.getBurstCfg(signature, techType);

    // Primary sharp particles
    const emitter = this.buildBurstEmitter(cfg);
    emitter.explode(signature.count, pos.x, pos.y);
    this.scene.time.delayedCall(700, () => emitter.destroy());

    // Secondary soft glow particles — larger, slower, fewer
    const glowCfg: BurstCfg = {
      ...cfg,
      texture: TEX_SOFT,
      count: Math.max(3, Math.floor(signature.count * 0.5)),
      speed: { min: cfg.speed.min * 0.5, max: cfg.speed.max * 0.6 },
      scale: { start: cfg.scale.start * 1.8, end: 0 },
      lifespan: cfg.lifespan * 1.4,
      alpha: { start: 0.55, end: 0 },
    };
    const glowEmitter = this.buildBurstEmitter(glowCfg);
    glowEmitter.explode(glowCfg.count, pos.x, pos.y);
    this.scene.time.delayedCall(900, () => glowEmitter.destroy());

    // Flash circle at impact point
    const flash = this.scene.add.arc(pos.x, pos.y, 3, 0, 360, false, signature.primary, 0.7);
    flash.setDepth(91);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      scaleX: 3, scaleY: 3, alpha: 0,
      duration: 250, ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });
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

  private getBurstCfg(signature: TechniqueVisual, techType: string): BurstCfg {
    const base = DEFAULT_BURST_CFG[techType] ?? DEFAULT_BURST_CFG.attack;
    // Pick texture: sharp attacks/debuffs use spark, heals/buffs use soft glow
    const texture = (techType === "healing" || techType === "buff") ? TEX_SOFT : TEX_SPARK;
    return {
      ...base,
      texture,
      tint: [signature.primary, signature.secondary, signature.accent],
      count: signature.count + 2,
    };
  }

  private drawProjectile(dot: Phaser.GameObjects.Graphics, signature: TechniqueVisual): void {
    dot.clear();
    switch (signature.projectileShape) {
      case "shard":
        dot.fillStyle(signature.accent, 0.35);
        dot.fillPoints([
          new Phaser.Geom.Point(0, -signature.projectileRadius - 3),
          new Phaser.Geom.Point(signature.projectileRadius + 2, 0),
          new Phaser.Geom.Point(0, signature.projectileRadius + 3),
          new Phaser.Geom.Point(-signature.projectileRadius - 2, 0),
        ], true);
        dot.fillStyle(signature.primary, 0.95);
        dot.fillPoints([
          new Phaser.Geom.Point(0, -signature.projectileRadius - 1),
          new Phaser.Geom.Point(signature.projectileRadius + 1, 0),
          new Phaser.Geom.Point(0, signature.projectileRadius + 1),
          new Phaser.Geom.Point(-signature.projectileRadius - 1, 0),
        ], true);
        break;
      case "needle":
        dot.fillStyle(signature.accent, 0.45);
        dot.fillRect(-1, -signature.projectileRadius - 3, 2, signature.projectileRadius * 2 + 6);
        dot.fillStyle(signature.primary, 0.95);
        dot.fillRect(-1, -signature.projectileRadius - 1, 2, signature.projectileRadius * 2 + 2);
        break;
      case "cross":
        dot.lineStyle(2, signature.primary, 0.95);
        dot.beginPath();
        dot.moveTo(-signature.projectileRadius - 1, 0);
        dot.lineTo(signature.projectileRadius + 1, 0);
        dot.moveTo(0, -signature.projectileRadius - 1);
        dot.lineTo(0, signature.projectileRadius + 1);
        dot.strokePath();
        break;
      case "leaf":
        dot.fillStyle(signature.accent, 0.4);
        dot.fillEllipse(0, 0, signature.projectileRadius * 3, signature.projectileRadius * 2);
        dot.lineStyle(1, signature.secondary, 0.85);
        dot.beginPath();
        dot.moveTo(-signature.projectileRadius, 0);
        dot.lineTo(signature.projectileRadius, 0);
        dot.strokePath();
        break;
      case "flare":
        dot.fillStyle(signature.accent, 0.45);
        dot.fillCircle(0, 0, signature.projectileRadius + 2);
        dot.lineStyle(1, signature.secondary, 0.9);
        dot.beginPath();
        dot.moveTo(-signature.projectileRadius - 2, 0);
        dot.lineTo(signature.projectileRadius + 2, 0);
        dot.moveTo(0, -signature.projectileRadius - 2);
        dot.lineTo(0, signature.projectileRadius + 2);
        dot.strokePath();
        break;
      case "orb":
      default:
        dot.fillStyle(signature.accent, 0.55);
        dot.fillCircle(0, 0, signature.projectileRadius + 2);
        dot.fillStyle(signature.primary, 0.95);
        dot.fillCircle(0, 0, signature.projectileRadius);
        break;
    }
  }

  private playImpactPattern(signature: TechniqueVisual, center: Pos): void {
    const outer = this.scene.add.graphics();
    outer.setDepth(85);
    outer.lineStyle(1.5, signature.primary, 0.82);

    switch (signature.impactPattern) {
      case "spokes":
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI * 2 * i) / 6;
          outer.beginPath();
          outer.moveTo(center.x + Math.cos(angle) * 3, center.y + Math.sin(angle) * 3);
          outer.lineTo(center.x + Math.cos(angle) * (signature.ringRadius + 4), center.y + Math.sin(angle) * (signature.ringRadius + 4));
          outer.strokePath();
        }
        break;
      case "diamond":
        outer.strokePoints([
          new Phaser.Geom.Point(center.x, center.y - signature.ringRadius),
          new Phaser.Geom.Point(center.x + signature.ringRadius, center.y),
          new Phaser.Geom.Point(center.x, center.y + signature.ringRadius),
          new Phaser.Geom.Point(center.x - signature.ringRadius, center.y),
        ], true);
        break;
      case "petals":
        for (let i = 0; i < 4; i++) {
          const angle = (Math.PI / 2) * i;
          outer.strokeEllipse(
            center.x + Math.cos(angle) * (signature.ringRadius / 2),
            center.y + Math.sin(angle) * (signature.ringRadius / 2),
            signature.ringRadius,
            Math.max(4, signature.ringRadius - 2),
          );
        }
        break;
      case "ward":
        outer.strokeCircle(center.x, center.y, signature.ringRadius);
        outer.strokeRect(center.x - signature.ringRadius + 1, center.y - signature.ringRadius + 1, signature.ringRadius * 2 - 2, signature.ringRadius * 2 - 2);
        break;
      case "ring":
      default:
        outer.strokeCircle(center.x, center.y, signature.ringRadius);
        break;
    }

    outer.setBlendMode(Phaser.BlendModes.ADD);

    const inner = this.scene.add.arc(center.x, center.y, Math.max(3, signature.ringRadius - 2), 0, 360, false);
    inner.setStrokeStyle(1.5, signature.accent, 0.75);
    inner.setFillStyle();
    inner.setDepth(84);
    inner.setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: outer,
      scaleX: 4.5,
      scaleY: 4.5,
      alpha: 0,
      duration: 380,
      ease: "Quad.easeOut",
      onComplete: () => outer.destroy(),
    });
    this.scene.tweens.add({
      targets: inner,
      scaleX: 3.8,
      scaleY: 3.8,
      alpha: 0,
      duration: 320,
      ease: "Quad.easeOut",
      onComplete: () => inner.destroy(),
    });
  }

  /** Generate three particle textures: dot, soft glow, spark */
  private createTexture(): void {
    // 8×8 hard dot (projectiles, sharp impacts)
    if (!this.scene.textures.exists(TEX_DOT)) {
      const rt = this.scene.add.renderTexture(0, 0, 8, 8);
      const circle = this.scene.add.arc(4, 4, 3, 0, 360, false, 0xffffff, 1);
      circle.setDepth(-999);
      rt.draw(circle, 4, 4);
      rt.saveTexture(TEX_DOT);
      circle.destroy();
      rt.destroy();
    }

    // 16×16 soft glow (healing, buffs — radial falloff)
    if (!this.scene.textures.exists(TEX_SOFT)) {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d")!;
      const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 16);
      this.scene.textures.addCanvas(TEX_SOFT, canvas);
    }

    // 12×12 spark (attacks, debuffs — 4-point star)
    if (!this.scene.textures.exists(TEX_SPARK)) {
      const canvas = document.createElement("canvas");
      canvas.width = 12;
      canvas.height = 12;
      const ctx = canvas.getContext("2d")!;
      const cx = 6, cy = 6;
      // Horizontal + vertical bright lines
      const gradH = ctx.createLinearGradient(0, cy, 12, cy);
      gradH.addColorStop(0, "rgba(255,255,255,0)");
      gradH.addColorStop(0.4, "rgba(255,255,255,0.8)");
      gradH.addColorStop(0.5, "rgba(255,255,255,1)");
      gradH.addColorStop(0.6, "rgba(255,255,255,0.8)");
      gradH.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradH;
      ctx.fillRect(0, cy - 1, 12, 2);
      const gradV = ctx.createLinearGradient(cx, 0, cx, 12);
      gradV.addColorStop(0, "rgba(255,255,255,0)");
      gradV.addColorStop(0.4, "rgba(255,255,255,0.8)");
      gradV.addColorStop(0.5, "rgba(255,255,255,1)");
      gradV.addColorStop(0.6, "rgba(255,255,255,0.8)");
      gradV.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradV;
      ctx.fillRect(cx - 1, 0, 2, 12);
      // Center glow
      const gradC = ctx.createRadialGradient(cx, cy, 0, cx, cy, 3);
      gradC.addColorStop(0, "rgba(255,255,255,1)");
      gradC.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradC;
      ctx.fillRect(cx - 3, cy - 3, 6, 6);
      this.scene.textures.addCanvas(TEX_SPARK, canvas);
    }
  }

  private buildBurstEmitter(cfg: BurstCfg): Phaser.GameObjects.Particles.ParticleEmitter {
    const emitter = this.scene.add.particles(0, 0, cfg.texture, {
      speed: cfg.speed,
      scale: cfg.scale,
      lifespan: cfg.lifespan,
      blendMode: cfg.blendMode,
      tint: cfg.tint,
      gravityY: cfg.gravityY,
      quantity: cfg.count,
      alpha: cfg.alpha,
      rotate: { min: 0, max: 360 },
      emitting: false,
    });
    emitter.setDepth(90);
    return emitter;
  }
}
