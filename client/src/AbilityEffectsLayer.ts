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
  private lastFlashTs = 0;
  private onHitFreeze?: (entityId: string, durationMs: number) => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.createTexture();
  }

  setCoordScale(scale: number): void {
    this.coordScale = scale;
  }

  /** Wire up hit-freeze: parent pauses/resumes the target sprite's animation */
  setHitFreezeHandler(handler: (entityId: string, durationMs: number) => void): void {
    this.onHitFreeze = handler;
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

    // ── Hit-freeze: pause target sprite briefly on attack impacts ────
    if (this.onHitFreeze && event.targetId && (techType === "attack" || techType === "debuff")) {
      this.onHitFreeze(event.targetId, 50);
    }

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
      case "warrior_shield_wall": {
        // Steel plate arcs rising around caster
        for (let i = 0; i < 4; i++) {
          const a = (Math.PI * 2 * i) / 4;
          this.scene.time.delayedCall(i * 60, () => {
            const plate = this.scene.add.graphics();
            plate.setDepth(92);
            plate.setBlendMode(Phaser.BlendModes.ADD);
            plate.lineStyle(2.5, sig.accent, 0.85);
            plate.beginPath();
            plate.arc(src.x, src.y, 8, a - 0.4, a + 0.4, false);
            plate.strokePath();
            plate.lineStyle(5, sig.primary, 0.25);
            plate.beginPath();
            plate.arc(src.x, src.y, 8, a - 0.3, a + 0.3, false);
            plate.strokePath();
            this.scene.tweens.add({
              targets: plate, scaleX: 2.5, scaleY: 2.5, alpha: 0, y: -4,
              duration: 450, ease: "Sine.easeOut",
              onComplete: () => plate.destroy(),
            });
          });
        }
        this.burst(sig, "buff", src);
        return true;
      }
      case "warrior_battle_rage":
      case "warrior_battle_rage_r2": {
        // Rage flames erupting upward
        const flames = this.scene.add.particles(0, 0, TEX_SPARK, {
          x: src.x, y: src.y,
          speed: { min: 15, max: 35 },
          angle: { min: 245, max: 295 },
          scale: { start: 0.5, end: 0 },
          lifespan: 400,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.secondary, 0xff2200],
          alpha: { start: 0.9, end: 0 },
          emitting: false,
        });
        flames.setDepth(90);
        flames.explode(8, src.x, src.y);
        this.scene.time.delayedCall(500, () => flames.destroy());
        this.fxShockwave(src, sig, 2);
        this.burst(sig, "buff", src);
        this.fxScreenShake(3, 100);
        return true;
      }

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
      case "mage_slow": {
        // Ice crystals forming in hex around target
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6;
          this.scene.time.delayedCall(i * 40, () => {
            const crystal = this.scene.add.graphics();
            crystal.setDepth(92);
            crystal.setBlendMode(Phaser.BlendModes.ADD);
            crystal.lineStyle(1.5, sig.accent, 0.9);
            const cx = dst.x + Math.cos(a) * 8;
            const cy = dst.y + Math.sin(a) * 8;
            crystal.beginPath();
            crystal.moveTo(cx, cy - 4); crystal.lineTo(cx + 2, cy);
            crystal.lineTo(cx, cy + 4); crystal.lineTo(cx - 2, cy);
            crystal.closePath(); crystal.strokePath();
            this.scene.tweens.add({
              targets: crystal, alpha: 0, scaleX: 1.5, scaleY: 1.5,
              duration: 400, delay: 100,
              onComplete: () => crystal.destroy(),
            });
          });
        }
        const iceRing = this.scene.add.arc(dst.x, dst.y, 6, 0, 360, false);
        iceRing.setStrokeStyle(1.5, sig.primary, 0.8);
        iceRing.setFillStyle(); iceRing.setDepth(91);
        iceRing.setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({
          targets: iceRing, scaleX: 3, scaleY: 3, alpha: 0,
          duration: 500, ease: "Sine.easeOut",
          onComplete: () => iceRing.destroy(),
        });
        this.burst(sig, "debuff", dst);
        return true;
      }

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
      case "monk_disable": {
        // Stun bolt zigzag + hex lock
        const bolt = this.scene.add.graphics();
        bolt.setDepth(93); bolt.setBlendMode(Phaser.BlendModes.ADD);
        bolt.lineStyle(2, sig.accent, 0.9);
        bolt.beginPath();
        bolt.moveTo(dst.x - 3, dst.y - 8); bolt.lineTo(dst.x + 2, dst.y - 3);
        bolt.lineTo(dst.x - 2, dst.y + 3); bolt.lineTo(dst.x + 3, dst.y + 8);
        bolt.strokePath();
        bolt.lineStyle(4, sig.primary, 0.3);
        bolt.beginPath();
        bolt.moveTo(dst.x - 3, dst.y - 8); bolt.lineTo(dst.x + 2, dst.y - 3);
        bolt.lineTo(dst.x - 2, dst.y + 3); bolt.lineTo(dst.x + 3, dst.y + 8);
        bolt.strokePath();
        this.scene.tweens.add({
          targets: bolt, scaleX: 2, scaleY: 2, alpha: 0,
          duration: 200, ease: "Quad.easeOut",
          onComplete: () => bolt.destroy(),
        });
        // Hex lock ring
        const lock = this.scene.add.graphics();
        lock.setDepth(92); lock.setBlendMode(Phaser.BlendModes.ADD);
        lock.lineStyle(1.5, sig.primary, 0.8);
        const hexPts: Phaser.Geom.Point[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6;
          hexPts.push(new Phaser.Geom.Point(dst.x + Math.cos(a) * 7, dst.y + Math.sin(a) * 7));
        }
        lock.strokePoints(hexPts, true);
        this.scene.tweens.add({
          targets: lock, alpha: 0, scaleX: 2, scaleY: 2, angle: 30,
          duration: 350, ease: "Quad.easeOut",
          onComplete: () => lock.destroy(),
        });
        this.burst(sig, "debuff", dst);
        return true;
      }

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
      case "rogue_stealth": {
        // Inward-converging spiral motes → implosion vanish
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6;
          const mote = this.scene.add.arc(
            src.x + Math.cos(a) * 16, src.y + Math.sin(a) * 16,
            1.5, 0, 360, false, sig.accent, 0.8,
          );
          mote.setDepth(92); mote.setBlendMode(Phaser.BlendModes.ADD);
          this.scene.tweens.add({
            targets: mote, x: src.x, y: src.y,
            scaleX: 0.2, scaleY: 0.2, alpha: 0,
            duration: 350, ease: "Quad.easeIn", delay: i * 35,
            onComplete: () => mote.destroy(),
          });
        }
        // Implosion flash — shrinks inward
        this.scene.time.delayedCall(260, () => {
          const flash = this.scene.add.arc(src.x, src.y, 8, 0, 360, false, sig.primary, 0.6);
          flash.setDepth(91); flash.setBlendMode(Phaser.BlendModes.ADD);
          this.scene.tweens.add({
            targets: flash, scaleX: 0, scaleY: 0, alpha: 0,
            duration: 150, ease: "Quad.easeIn",
            onComplete: () => flash.destroy(),
          });
        });
        return true;
      }
      case "rogue_evasion": {
        // Flickering afterimage ghosts + speed lines
        for (let i = 0; i < 4; i++) {
          const ox = (Math.random() - 0.5) * 14;
          const oy = (Math.random() - 0.5) * 8;
          const ghost = this.scene.add.arc(
            src.x + ox, src.y + oy,
            3, 0, 360, false, sig.accent, 0.5 - i * 0.08,
          );
          ghost.setDepth(90); ghost.setBlendMode(Phaser.BlendModes.ADD);
          this.scene.tweens.add({
            targets: ghost,
            x: src.x + ox + (Math.random() - 0.5) * 10,
            alpha: 0, scaleX: 0.4, scaleY: 1.6,
            duration: 250, delay: i * 40, ease: "Quad.easeOut",
            onComplete: () => ghost.destroy(),
          });
        }
        for (let i = 0; i < 3; i++) {
          const line = this.scene.add.graphics();
          line.setDepth(91); line.setBlendMode(Phaser.BlendModes.ADD);
          line.lineStyle(1, sig.primary, 0.6);
          line.beginPath();
          line.moveTo(src.x - 8 + i * 4, src.y - 6);
          line.lineTo(src.x - 8 + i * 4 + 6, src.y + 6);
          line.strokePath();
          this.scene.tweens.add({
            targets: line, alpha: 0, x: 5,
            duration: 200, delay: i * 30,
            onComplete: () => line.destroy(),
          });
        }
        this.burst(sig, "buff", src);
        return true;
      }

      // ── RANGER ─────────────────────────────────────────────────────
      case "ranger_aimed_shot":
        this.fxSniperShot(src, dst, sig);
        return true;
      case "ranger_multi_shot":
        this.fxMultiShot(src, dst, sig);
        return true;
      case "ranger_hunters_mark":
      case "ranger_hunters_mark_r2": {
        // Targeting reticle: crosshair + circle snap onto target
        const reticle = this.scene.add.graphics();
        reticle.setDepth(92); reticle.setBlendMode(Phaser.BlendModes.ADD);
        reticle.lineStyle(1, sig.accent, 0.85);
        reticle.beginPath();
        reticle.moveTo(dst.x - 10, dst.y); reticle.lineTo(dst.x + 10, dst.y);
        reticle.moveTo(dst.x, dst.y - 10); reticle.lineTo(dst.x, dst.y + 10);
        reticle.strokePath();
        reticle.strokeCircle(dst.x, dst.y, 6);
        reticle.setAlpha(0);
        this.scene.tweens.add({
          targets: reticle, alpha: 1,
          duration: 120,
          onComplete: () => {
            this.scene.tweens.add({
              targets: reticle, alpha: 0, scaleX: 0.5, scaleY: 0.5,
              duration: 250, delay: 150,
              onComplete: () => reticle.destroy(),
            });
          },
        });
        this.burst(sig, "debuff", dst);
        return true;
      }

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
      case "warlock_curse_of_weakness": {
        // Sickly yellow hex seal forming on target
        const hex = this.scene.add.graphics();
        hex.setDepth(92); hex.setBlendMode(Phaser.BlendModes.ADD);
        hex.lineStyle(1.5, sig.primary, 0.9);
        const hexPts2: Phaser.Geom.Point[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6;
          hexPts2.push(new Phaser.Geom.Point(dst.x + Math.cos(a) * 8, dst.y + Math.sin(a) * 8));
        }
        hex.strokePoints(hexPts2, true);
        hex.setAlpha(0);
        this.scene.tweens.add({
          targets: hex, alpha: 1, angle: 30,
          duration: 200, ease: "Quad.easeOut",
          onComplete: () => {
            this.scene.tweens.add({
              targets: hex, alpha: 0, scaleX: 2, scaleY: 2,
              duration: 400, ease: "Sine.easeOut",
              onComplete: () => hex.destroy(),
            });
          },
        });
        // Sickly descending particles
        const sick = this.scene.add.particles(0, 0, TEX_SOFT, {
          x: dst.x, y: dst.y - 10,
          speed: { min: 4, max: 12 },
          angle: { min: 70, max: 110 },
          scale: { start: 0.4, end: 0.1 },
          lifespan: 500,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.secondary],
          alpha: { start: 0.7, end: 0 },
          gravityY: 15,
          emitting: false,
        });
        sick.setDepth(90);
        sick.explode(6, dst.x, dst.y - 8);
        this.scene.time.delayedCall(600, () => sick.destroy());
        this.burst(sig, "debuff", dst);
        return true;
      }

      // ── WARRIOR R2/R3 + NEW ──────────────────────────────────────────
      case "warrior_heroic_strike_r2":
        this.fxSlashArc(dst, sig, 1.4);
        this.burst(sig, techType, dst);
        this.fxScreenShake(5, 160);
        return true;
      case "warrior_heroic_strike_r3":
        this.fxSlashArc(dst, sig, 2.0);
        this.fxSlashArc(dst, sig, 2.0, -1);
        this.fxShockwave(dst, sig, 2);
        this.burst(sig, techType, dst);
        this.fxScreenShake(7, 220);
        return true;
      case "warrior_cleave_r2":
        this.fxSlashArc(dst, sig, 2.2);
        this.fxSlashArc(dst, sig, 2.2, -1);
        this.fxShockwave(dst, sig, 2);
        this.burst(sig, techType, dst);
        this.fxScreenShake(5, 180);
        return true;
      case "warrior_rallying_cry":
        this.fxShockwave(src, sig, 4);
        this.burst(sig, "buff", src);
        this.fxScreenShake(3, 120);
        return true;
      case "warrior_rending_strike": {
        this.fxSlashArc(dst, sig, 1.2);
        // Blood drip particles
        const bloodDrip = this.scene.add.particles(0, 0, TEX_DOT, {
          x: dst.x, y: dst.y,
          speed: { min: 8, max: 25 },
          angle: { min: 200, max: 340 },
          scale: { start: 0.3, end: 0.05 },
          lifespan: 600,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.secondary, 0xcc0000],
          alpha: { start: 0.9, end: 0 },
          gravityY: 50,
          emitting: false,
        });
        bloodDrip.setDepth(90);
        bloodDrip.explode(8, dst.x, dst.y);
        this.scene.time.delayedCall(700, () => bloodDrip.destroy());
        this.burst(sig, techType, dst);
        this.fxScreenShake(4, 130);
        return true;
      }

      // ── PALADIN R2/R3 + NEW ──────────────────────────────────────────
      case "paladin_holy_smite_r2":
        this.fxHolySmite(dst, sig);
        this.fxScreenShake(4, 130);
        return true;
      case "paladin_holy_smite_r3":
        this.fxHolySmite(dst, sig);
        this.fxShockwave(dst, sig, 2);
        this.fxScreenShake(6, 180);
        return true;
      case "paladin_judgment":
        this.playProjectile(sig, techType, src, dst);
        this.scene.time.delayedCall(250, () => {
          this.fxHolySmite(dst, sig);
          this.fxShockwave(dst, sig, 2);
        });
        return true;
      case "paladin_aura_of_resolve":
        // Expanding shield rings rising upward
        for (let i = 0; i < 4; i++) {
          this.scene.time.delayedCall(i * 150, () => {
            const ring = this.scene.add.arc(src.x, src.y - i * 4, 6, 0, 360, false);
            ring.setStrokeStyle(1.5, sig.primary, 0.7 - i * 0.12);
            ring.setFillStyle();
            ring.setDepth(92);
            ring.setBlendMode(Phaser.BlendModes.ADD);
            this.scene.tweens.add({
              targets: ring,
              scaleX: 3 + i, scaleY: 3 + i, alpha: 0, y: src.y - i * 4 - 10,
              duration: 500, ease: "Sine.easeOut",
              onComplete: () => ring.destroy(),
            });
          });
        }
        this.burst(sig, "buff", src);
        return true;

      // ── ROGUE R2/R3 + NEW ────────────────────────────────────────────
      case "rogue_backstab_r2":
        this.fxBackstab(src, dst, sig);
        this.fxScreenShake(3, 80);
        return true;
      case "rogue_backstab_r3":
        this.fxBackstab(src, dst, sig);
        this.fxShockwave(dst, sig, 1);
        this.fxScreenShake(5, 140);
        return true;
      case "rogue_smoke_bomb": {
        // Dark cloud expanding with lingering particles
        const cloud = this.scene.add.particles(0, 0, TEX_SOFT, {
          x: dst.x, y: dst.y,
          speed: { min: 10, max: 40 },
          scale: { start: 0.8, end: 0.2 },
          lifespan: 900,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.secondary, 0x444444],
          alpha: { start: 0.6, end: 0 },
          frequency: 40,
        });
        cloud.setDepth(90);
        this.scene.time.delayedCall(600, () => {
          cloud.stop();
          this.scene.time.delayedCall(1000, () => cloud.destroy());
        });
        this.fxShockwave(dst, sig, 2);
        this.burst(sig, "debuff", dst);
        return true;
      }
      case "rogue_blade_flurry":
        // Rapid 3-slash arcs in sequence
        for (let i = 0; i < 3; i++) {
          this.scene.time.delayedCall(i * 80, () => {
            this.fxSlashArc(dst, sig, 1.0 + i * 0.2, i % 2 === 0 ? 1 : -1);
          });
        }
        this.burst(sig, techType, dst);
        this.fxScreenShake(4, 150);
        return true;
      case "rogue_poison_blade_r2": {
        this.fxPoisonSplash(dst, sig);
        // Extra acid drip trail
        for (let i = 0; i < 4; i++) {
          this.scene.time.delayedCall(i * 80, () => {
            const drop = this.scene.add.arc(
              dst.x + (Math.random() - 0.5) * 10, dst.y + 2 + i * 2,
              1.5, 0, 360, false, sig.primary, 0.7,
            );
            drop.setDepth(89); drop.setBlendMode(Phaser.BlendModes.ADD);
            this.scene.tweens.add({
              targets: drop, y: drop.y + 6, alpha: 0, scaleX: 0.3, scaleY: 0.3,
              duration: 400, ease: "Quad.easeIn",
              onComplete: () => drop.destroy(),
            });
          });
        }
        this.fxScreenShake(3, 80);
        return true;
      }
      case "rogue_shadow_strike_r2": {
        this.fxShadowStrike(src, dst, sig);
        // Afterimage echoes at destination
        this.scene.time.delayedCall(120, () => {
          for (let i = 0; i < 3; i++) {
            const ghost = this.scene.add.arc(
              dst.x + (i - 1) * 5, dst.y,
              3, 0, 360, false, sig.accent, 0.4 - i * 0.1,
            );
            ghost.setDepth(89); ghost.setBlendMode(Phaser.BlendModes.ADD);
            this.scene.tweens.add({
              targets: ghost, alpha: 0, scaleX: 0.3, scaleY: 1.5,
              duration: 200, delay: i * 30,
              onComplete: () => ghost.destroy(),
            });
          }
        });
        this.fxScreenShake(5, 120);
        return true;
      }

      // ── RANGER R2/R3 + NEW ───────────────────────────────────────────
      case "ranger_aimed_shot_r2":
        this.fxSniperShot(src, dst, sig);
        this.fxScreenShake(3, 100);
        return true;
      case "ranger_aimed_shot_r3":
        this.fxSniperShot(src, dst, sig);
        this.fxShockwave(dst, sig, 2);
        this.fxScreenShake(5, 150);
        return true;
      case "ranger_entangling_roots": {
        // Vines spiraling up from ground + green particles
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI * 2 * i) / 6;
          const vineX = dst.x + Math.cos(angle) * 8;
          const vineY = dst.y + Math.sin(angle) * 8;
          const vine = this.scene.add.graphics();
          vine.setDepth(91);
          vine.setBlendMode(Phaser.BlendModes.ADD);
          vine.lineStyle(1.5, sig.primary, 0.8);
          vine.beginPath();
          vine.moveTo(vineX, vineY + 6);
          vine.lineTo(vineX + Math.cos(angle) * 3, vineY - 4);
          vine.lineTo(vineX, vineY - 10);
          vine.strokePath();
          vine.setAlpha(0);
          this.scene.tweens.add({
            targets: vine,
            alpha: 1,
            duration: 150,
            delay: i * 60,
            onComplete: () => {
              this.scene.tweens.add({
                targets: vine,
                alpha: 0,
                duration: 500, delay: 300,
                onComplete: () => vine.destroy(),
              });
            },
          });
        }
        const rootParticles = this.scene.add.particles(0, 0, TEX_SOFT, {
          x: dst.x, y: dst.y,
          speed: { min: 6, max: 18 },
          angle: { min: 230, max: 310 },
          scale: { start: 0.35, end: 0 },
          lifespan: 650,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.secondary, sig.accent],
          alpha: { start: 0.7, end: 0 },
          emitting: false,
        });
        rootParticles.setDepth(90);
        rootParticles.explode(10, dst.x, dst.y);
        this.scene.time.delayedCall(750, () => rootParticles.destroy());
        this.burst(sig, "debuff", dst);
        return true;
      }
      case "ranger_volley": {
        // Rain of arrow lines falling from above + impacts
        for (let i = 0; i < 8; i++) {
          const offsetX = (Math.random() - 0.5) * 30;
          const offsetY = (Math.random() - 0.5) * 20;
          const tx = dst.x + offsetX;
          const ty = dst.y + offsetY;
          this.scene.time.delayedCall(i * 50, () => {
            const arrow = this.scene.add.graphics();
            arrow.setDepth(94);
            arrow.setBlendMode(Phaser.BlendModes.ADD);
            arrow.lineStyle(1.2, sig.accent, 0.9);
            arrow.beginPath();
            arrow.moveTo(tx, ty - 30);
            arrow.lineTo(tx, ty - 22);
            arrow.strokePath();
            this.scene.tweens.add({
              targets: arrow,
              y: 30,
              duration: 150, ease: "Quad.easeIn",
              onComplete: () => {
                arrow.destroy();
                this.burst(sig, techType, { x: tx, y: ty });
              },
            });
          });
        }
        this.fxScreenShake(4, 200);
        return true;
      }

      // ── MAGE R2/R3 + NEW ─────────────────────────────────────────────
      case "mage_fireball_r2":
        this.playProjectile(sig, techType, src, dst);
        this.fxScreenShake(5, 150);
        return true;
      case "mage_fireball_r3": {
        this.playProjectile(sig, techType, src, dst);
        this.fxScreenShake(7, 200);
        // Ground fire embers on impact
        this.scene.time.delayedCall(350, () => {
          const embers = this.scene.add.particles(0, 0, TEX_SPARK, {
            x: dst.x, y: dst.y,
            speed: { min: 8, max: 30 },
            scale: { start: 0.35, end: 0 },
            lifespan: 700,
            blendMode: Phaser.BlendModes.ADD,
            tint: [sig.primary, sig.secondary, 0xff4400],
            alpha: { start: 0.8, end: 0 },
            gravityY: 25,
            emitting: false,
          });
          embers.setDepth(89);
          embers.explode(14, dst.x, dst.y);
          this.scene.time.delayedCall(800, () => embers.destroy());
        });
        return true;
      }
      case "mage_frost_nova": {
        // Ice crystal shards expanding + frozen rings
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 * i) / 8;
          const shard = this.scene.add.graphics();
          shard.setDepth(93);
          shard.setBlendMode(Phaser.BlendModes.ADD);
          shard.lineStyle(1.5, sig.accent, 0.9);
          shard.beginPath();
          shard.moveTo(src.x, src.y);
          shard.lineTo(src.x + Math.cos(angle) * 6, src.y + Math.sin(angle) * 6);
          shard.strokePath();
          this.scene.tweens.add({
            targets: shard,
            x: Math.cos(angle) * 20, y: Math.sin(angle) * 20, alpha: 0,
            duration: 300, ease: "Quad.easeOut",
            delay: i * 25,
            onComplete: () => shard.destroy(),
          });
        }
        this.fxShockwave(src, sig, 3);
        this.burst(sig, techType, src);
        this.fxScreenShake(5, 160);
        return true;
      }
      case "mage_mana_shield":
        // Arcane ward circles forming around caster
        for (let i = 0; i < 3; i++) {
          this.scene.time.delayedCall(i * 120, () => {
            const ward = this.scene.add.arc(src.x, src.y, 6 + i * 3, 0, 360, false);
            ward.setStrokeStyle(1.5, i === 0 ? sig.accent : sig.primary, 0.7 - i * 0.15);
            ward.setFillStyle();
            ward.setDepth(92);
            ward.setBlendMode(Phaser.BlendModes.ADD);
            this.scene.tweens.add({
              targets: ward,
              scaleX: 2.5, scaleY: 2.5, alpha: 0,
              duration: 600, ease: "Sine.easeOut",
              onComplete: () => ward.destroy(),
            });
          });
        }
        this.burst(sig, "buff", src);
        return true;

      // ── CLERIC R2/R3 + NEW ───────────────────────────────────────────
      case "cleric_holy_light_r2":
        this.fxHolyLight(dst, sig);
        this.burst(sig, "healing", dst);
        return true;
      case "cleric_holy_light_r3": {
        this.fxHolyLight(dst, sig);
        // Extra golden sparks
        const holySpks = this.scene.add.particles(0, 0, TEX_SPARK, {
          x: dst.x, y: dst.y,
          speed: { min: 10, max: 30 },
          scale: { start: 0.3, end: 0 },
          lifespan: 500,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.accent, 0xffd700],
          alpha: { start: 0.9, end: 0 },
          emitting: false,
        });
        holySpks.setDepth(91);
        holySpks.explode(12, dst.x, dst.y);
        this.scene.time.delayedCall(600, () => holySpks.destroy());
        this.burst(sig, "healing", dst);
        return true;
      }
      case "cleric_holy_nova":
        // Golden meteor impact from above + healing ring
        this.fxMeteor(dst, sig);
        this.scene.time.delayedCall(280, () => {
          const healRing = this.scene.add.arc(dst.x, dst.y, 4, 0, 360, false);
          healRing.setStrokeStyle(2, sig.accent, 0.8);
          healRing.setFillStyle();
          healRing.setDepth(91);
          healRing.setBlendMode(Phaser.BlendModes.ADD);
          this.scene.tweens.add({
            targets: healRing,
            scaleX: 6, scaleY: 6, alpha: 0,
            duration: 500, ease: "Quad.easeOut",
            onComplete: () => healRing.destroy(),
          });
        });
        return true;
      case "cleric_spirit_of_redemption": {
        // Ascending spirit particles + golden aura
        const spiritEmitter = this.scene.add.particles(0, 0, TEX_SOFT, {
          x: src.x, y: src.y,
          speed: { min: 5, max: 15 },
          angle: { min: 250, max: 290 },
          scale: { start: 0.5, end: 0.1 },
          lifespan: 1000,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.accent, 0xffd700],
          alpha: { start: 0.8, end: 0 },
          frequency: 50,
        });
        spiritEmitter.setDepth(91);
        // Golden aura ring
        const aura = this.scene.add.arc(src.x, src.y, 8, 0, 360, false, sig.accent, 0.25);
        aura.setDepth(88);
        aura.setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({
          targets: aura,
          scaleX: 3, scaleY: 3, alpha: 0,
          duration: 1200, ease: "Sine.easeOut",
          onComplete: () => aura.destroy(),
        });
        this.scene.time.delayedCall(1000, () => {
          spiritEmitter.stop();
          this.scene.time.delayedCall(1100, () => spiritEmitter.destroy());
        });
        this.burst(sig, "healing", src);
        return true;
      }

      // ── WARLOCK R2/R3 + NEW ──────────────────────────────────────────
      case "warlock_shadow_bolt_r2":
        this.fxShadowBolt(src, dst, sig);
        this.fxScreenShake(4, 100);
        return true;
      case "warlock_shadow_bolt_r3":
        this.fxShadowBolt(src, dst, sig);
        this.fxShockwave(dst, sig, 2);
        this.fxScreenShake(6, 160);
        return true;
      case "warlock_howl_of_terror": {
        // Dark expanding shockwaves + fear particles
        this.fxShockwave(src, sig, 4);
        const fearParts = this.scene.add.particles(0, 0, TEX_SPARK, {
          x: src.x, y: src.y,
          speed: { min: 20, max: 50 },
          scale: { start: 0.4, end: 0 },
          lifespan: 500,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.secondary, 0x220000],
          alpha: { start: 0.8, end: 0 },
          emitting: false,
        });
        fearParts.setDepth(90);
        fearParts.explode(12, src.x, src.y);
        this.scene.time.delayedCall(600, () => fearParts.destroy());
        this.burst(sig, "debuff", src);
        this.fxScreenShake(6, 200);
        return true;
      }
      case "warlock_siphon_soul": {
        // Tether beam + soul orbs flowing to caster
        const tether = this.scene.add.graphics();
        tether.setDepth(88);
        tether.setBlendMode(Phaser.BlendModes.ADD);
        tether.lineStyle(2.5, sig.primary, 0.4);
        tether.beginPath();
        tether.moveTo(src.x, src.y);
        tether.lineTo(dst.x, dst.y);
        tether.strokePath();
        this.scene.tweens.add({
          targets: tether,
          alpha: 0,
          duration: 800,
          onComplete: () => tether.destroy(),
        });
        // Soul orbs from target to caster
        for (let i = 0; i < 6; i++) {
          this.scene.time.delayedCall(i * 110, () => {
            const soul = this.scene.add.arc(dst.x, dst.y, 2, 0, 360, false, i % 2 === 0 ? sig.accent : sig.secondary, 0.85);
            soul.setDepth(93);
            soul.setBlendMode(Phaser.BlendModes.ADD);
            this.scene.tweens.add({
              targets: soul,
              x: src.x + (Math.random() - 0.5) * 6,
              y: src.y + (Math.random() - 0.5) * 6,
              scaleX: 0.3, scaleY: 0.3, alpha: 0,
              duration: 400, ease: "Quad.easeIn",
              onComplete: () => soul.destroy(),
            });
          });
        }
        this.burst(sig, techType, dst);
        return true;
      }

      // ── MONK R2/R3 + NEW ─────────────────────────────────────────────
      case "monk_palm_strike_r2":
        this.fxPalmStrike(dst, sig);
        this.fxScreenShake(5, 120);
        return true;
      case "monk_chi_burst_r2":
        this.fxChiBurst(src, dst, sig);
        this.fxScreenShake(5, 120);
        return true;
      case "monk_chi_burst_r3":
        this.fxChiBurst(src, dst, sig);
        this.scene.time.delayedCall(350, () => {
          // Triple ring impact at destination
          for (let i = 0; i < 3; i++) {
            const ring = this.scene.add.arc(dst.x, dst.y, 3, 0, 360, false);
            ring.setStrokeStyle(2 - i * 0.4, i === 0 ? sig.accent : sig.primary, 0.9 - i * 0.2);
            ring.setFillStyle();
            ring.setDepth(92);
            ring.setBlendMode(Phaser.BlendModes.ADD);
            this.scene.tweens.add({
              targets: ring,
              scaleX: 6 + i * 2, scaleY: 6 + i * 2, alpha: 0,
              duration: 350 + i * 80, ease: "Quad.easeOut",
              delay: i * 50,
              onComplete: () => ring.destroy(),
            });
          }
        });
        this.fxScreenShake(7, 180);
        return true;
      case "monk_flying_kick": {
        // Dash trail + impact shockwave + screen shake
        const kickTrail = this.scene.add.graphics();
        kickTrail.setDepth(92);
        kickTrail.setBlendMode(Phaser.BlendModes.ADD);
        kickTrail.lineStyle(3, sig.primary, 0.7);
        kickTrail.beginPath();
        kickTrail.moveTo(src.x, src.y);
        kickTrail.lineTo(dst.x, dst.y);
        kickTrail.strokePath();
        this.scene.tweens.add({
          targets: kickTrail,
          alpha: 0,
          duration: 250,
          onComplete: () => kickTrail.destroy(),
        });
        this.fxShockwave(dst, sig, 2);
        this.burst(sig, techType, dst);
        this.fxScreenShake(6, 160);
        return true;
      }
      case "monk_whirlwind_kick": {
        // Spinning slash arcs in circle + shockwave
        for (let i = 0; i < 4; i++) {
          this.scene.time.delayedCall(i * 70, () => {
            this.fxSlashArc(src, sig, 1.3, i % 2 === 0 ? 1 : -1);
          });
        }
        this.scene.time.delayedCall(280, () => {
          this.fxShockwave(src, sig, 2);
        });
        this.burst(sig, techType, src);
        this.fxScreenShake(5, 150);
        return true;
      }
      case "monk_meditation_r2": {
        // More pulse rings + brighter particles
        const medEmitter = this.scene.add.particles(0, 0, TEX_SOFT, {
          x: src.x, y: src.y,
          speed: { min: 8, max: 22 },
          angle: { min: 240, max: 300 },
          scale: { start: 0.55, end: 0 },
          lifespan: 900,
          blendMode: Phaser.BlendModes.ADD,
          tint: [sig.primary, sig.secondary, sig.accent],
          alpha: { start: 0.8, end: 0 },
          frequency: 45,
        });
        medEmitter.setDepth(90);
        for (let i = 0; i < 6; i++) {
          this.scene.time.delayedCall(i * 200, () => {
            const ring = this.scene.add.arc(src.x, src.y, 4, 0, 360, false);
            ring.setStrokeStyle(1.2, sig.primary, 0.7);
            ring.setFillStyle();
            ring.setDepth(91);
            ring.setBlendMode(Phaser.BlendModes.ADD);
            this.scene.tweens.add({
              targets: ring,
              scaleX: 4, scaleY: 4, alpha: 0,
              duration: 500, ease: "Sine.easeOut",
              onComplete: () => ring.destroy(),
            });
          });
        }
        this.scene.time.delayedCall(1200, () => {
          medEmitter.stop();
          this.scene.time.delayedCall(1000, () => medEmitter.destroy());
        });
        this.burst(sig, "healing", src);
        return true;
      }

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
    const beamWidth = signature.beamPattern === "pulse" ? 5 : signature.beamPattern === "drain" ? 4 : signature.beamPattern === "chain" ? 2 : signature.beamPattern === "wave" ? 4 : 3;
    beam.lineStyle(beamWidth, signature.primary, 0.35);
    beam.beginPath();

    if (signature.beamPattern === "chain") {
      // Zigzag lightning path
      const dx = dst.x - src.x, dy = dst.y - src.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const segs = Math.max(4, Math.floor(d / 12));
      const nx = -dy / d, ny = dx / d; // perpendicular
      beam.moveTo(src.x, src.y);
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const jitter = (i % 2 === 0 ? 1 : -1) * (3 + Math.random() * 4);
        beam.lineTo(src.x + dx * t + nx * jitter, src.y + dy * t + ny * jitter);
      }
      beam.lineTo(dst.x, dst.y);
    } else if (signature.beamPattern === "wave") {
      // Sinusoidal wave path
      const dx = dst.x - src.x, dy = dst.y - src.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const nx = -dy / d, ny = dx / d;
      beam.moveTo(src.x, src.y);
      const waveSegs = Math.max(8, Math.floor(d / 6));
      for (let i = 1; i <= waveSegs; i++) {
        const t = i / waveSegs;
        const wave = Math.sin(t * Math.PI * 3) * 5;
        beam.lineTo(src.x + dx * t + nx * wave, src.y + dy * t + ny * wave);
      }
    } else {
      beam.moveTo(src.x, src.y);
      beam.lineTo(dst.x, dst.y);
    }
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

    // ── Screen flash overlay (rate-limited, no shader) ──────────────
    const now = Date.now();
    if (now - this.lastFlashTs > 200) {
      this.lastFlashTs = now;
      const cam = this.scene.cameras.main;
      const fo = this.scene.add.rectangle(
        cam.width / 2, cam.height / 2, cam.width, cam.height, signature.primary,
      ).setScrollFactor(0).setAlpha(0).setDepth(9999);
      this.scene.tweens.add({
        targets: fo, alpha: 0.15, duration: 50,
        yoyo: true, onComplete: () => fo.destroy(),
      });
    }

    // ── Wave 1: Fast tight ring burst (FGO inner pop) ───────────────
    // High speed + short life = crisp expanding ring
    const w1 = this.buildBurstEmitter({
      ...cfg,
      speed: { min: cfg.speed.max * 1.4, max: cfg.speed.max * 2.5 },
      scale: { start: cfg.scale.start * 0.5, end: 0 },
      lifespan: Math.floor(cfg.lifespan * 0.4),
      alpha: { start: 1, end: 0.15 },
    });
    w1.explode(Math.min(signature.count, 8), pos.x, pos.y);
    this.scene.time.delayedCall(400, () => w1.destroy());

    // ── Wave 2: Slow wide pattern bloom (FGO outer glow) ────────────
    // Particles placed along impactPattern geometry, drift outward
    this.scene.time.delayedCall(40, () => {
      const w2 = this.buildBurstEmitter({
        ...cfg,
        texture: TEX_SOFT,
        speed: { min: cfg.speed.min * 0.4, max: cfg.speed.max * 0.6 },
        scale: { start: cfg.scale.start * 2.2, end: 0 },
        lifespan: Math.floor(cfg.lifespan * 2),
        alpha: { start: 0.5, end: 0 },
      });
      const points = this.getBurstPatternPoints(signature, pos);
      for (const pt of points) {
        w2.emitParticleAt(pt.x, pt.y, 1);
      }
      this.scene.time.delayedCall(1200, () => w2.destroy());
    });

    // ── Shape-specific core flash ───────────────────────────────────
    this.burstCoreFlash(signature, pos);
  }

  /** Emit positions for wave-2 bloom, shaped by impactPattern */
  private getBurstPatternPoints(sig: TechniqueVisual, center: Pos): Pos[] {
    const r = sig.ringRadius * 1.2;
    const count = Math.max(4, Math.floor(sig.count * 0.6));
    const pts: Pos[] = [];

    switch (sig.impactPattern) {
      case "spokes": {
        for (let i = 0; i < count; i++) {
          const a = (Math.PI * 2 * (i % 6)) / 6;
          const d = r * (0.3 + Math.random() * 0.7);
          pts.push({ x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d });
        }
        break;
      }
      case "diamond": {
        const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
        for (let i = 0; i < count; i++) {
          const d = dirs[i % 4];
          const dist = r * (0.4 + Math.random() * 0.6);
          pts.push({ x: center.x + d.x * dist, y: center.y + d.y * dist });
        }
        break;
      }
      case "petals": {
        for (let i = 0; i < count; i++) {
          const base = (Math.PI / 2) * (i % 4);
          const spread = (Math.random() - 0.5) * 0.5;
          const dist = r * (0.4 + Math.random() * 0.6);
          pts.push({ x: center.x + Math.cos(base + spread) * dist, y: center.y + Math.sin(base + spread) * dist });
        }
        break;
      }
      case "ward": {
        for (let i = 0; i < count; i++) {
          if (i % 2 === 0) {
            const a = (Math.PI * 2 * i) / count;
            pts.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
          } else {
            const half = r * 0.8;
            const t = Math.random();
            const edges: Pos[] = [
              { x: center.x - half + t * half * 2, y: center.y - half },
              { x: center.x + half, y: center.y - half + t * half * 2 },
              { x: center.x + half - t * half * 2, y: center.y + half },
              { x: center.x - half, y: center.y + half - t * half * 2 },
            ];
            pts.push(edges[i % 4]);
          }
        }
        break;
      }
      case "slash": {
        // X-shaped diagonal lines
        for (let i = 0; i < count; i++) {
          const diag = i % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
          const sign = i % 4 < 2 ? 1 : -1;
          const dist = r * (0.3 + Math.random() * 0.7);
          pts.push({ x: center.x + Math.cos(diag) * dist * sign, y: center.y + Math.sin(diag) * dist * sign });
        }
        break;
      }
      case "spiral": {
        for (let i = 0; i < count; i++) {
          const t = (Math.PI * 2 * i) / count;
          const dist = r * (0.3 + (i / count) * 0.7);
          pts.push({ x: center.x + Math.cos(t * 1.5) * dist, y: center.y + Math.sin(t * 1.5) * dist });
        }
        break;
      }
      case "hex": {
        for (let i = 0; i < count; i++) {
          const a = (Math.PI * 2 * (i % 6)) / 6;
          const dist = r * (0.4 + Math.random() * 0.6);
          pts.push({ x: center.x + Math.cos(a) * dist, y: center.y + Math.sin(a) * dist });
        }
        break;
      }
      case "scatter": {
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const dist = r * (0.2 + Math.random() * 0.8);
          pts.push({ x: center.x + Math.cos(a) * dist, y: center.y + Math.sin(a) * dist });
        }
        break;
      }
      case "ring":
      default: {
        for (let i = 0; i < count; i++) {
          const a = (Math.PI * 2 * i) / count;
          pts.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
        }
        break;
      }
    }
    return pts;
  }

  /** Core flash shaped by projectileShape — replaces generic circle flash */
  private burstCoreFlash(sig: TechniqueVisual, pos: Pos): void {
    switch (sig.projectileShape) {
      case "shard": {
        const diamond = this.scene.add.graphics();
        diamond.setDepth(91);
        diamond.setBlendMode(Phaser.BlendModes.ADD);
        diamond.fillStyle(sig.accent, 0.85);
        diamond.fillPoints([
          new Phaser.Geom.Point(pos.x, pos.y - 5),
          new Phaser.Geom.Point(pos.x + 3.5, pos.y),
          new Phaser.Geom.Point(pos.x, pos.y + 5),
          new Phaser.Geom.Point(pos.x - 3.5, pos.y),
        ], true);
        this.scene.tweens.add({
          targets: diamond, scaleX: 3, scaleY: 3, alpha: 0,
          duration: 200, ease: "Quad.easeOut",
          onComplete: () => diamond.destroy(),
        });
        break;
      }
      case "needle": {
        const line = this.scene.add.graphics();
        line.setDepth(91);
        line.setBlendMode(Phaser.BlendModes.ADD);
        line.lineStyle(2.5, sig.accent, 0.95);
        line.beginPath();
        line.moveTo(pos.x, pos.y - 7);
        line.lineTo(pos.x, pos.y + 7);
        line.strokePath();
        this.scene.tweens.add({
          targets: line, scaleX: 1.5, scaleY: 2.5, alpha: 0,
          duration: 180, ease: "Quad.easeOut",
          onComplete: () => line.destroy(),
        });
        break;
      }
      case "cross": {
        const cross = this.scene.add.graphics();
        cross.setDepth(91);
        cross.setBlendMode(Phaser.BlendModes.ADD);
        cross.lineStyle(2, sig.accent, 0.9);
        cross.beginPath();
        cross.moveTo(pos.x - 5, pos.y);
        cross.lineTo(pos.x + 5, pos.y);
        cross.moveTo(pos.x, pos.y - 5);
        cross.lineTo(pos.x, pos.y + 5);
        cross.strokePath();
        this.scene.tweens.add({
          targets: cross, scaleX: 2.5, scaleY: 2.5, alpha: 0,
          duration: 220, ease: "Quad.easeOut",
          onComplete: () => cross.destroy(),
        });
        break;
      }
      case "leaf": {
        const leaf = this.scene.add.graphics();
        leaf.setDepth(91);
        leaf.setBlendMode(Phaser.BlendModes.ADD);
        leaf.fillStyle(sig.primary, 0.6);
        leaf.fillEllipse(pos.x, pos.y, 10, 5);
        this.scene.tweens.add({
          targets: leaf, scaleX: 2.5, scaleY: 2, alpha: 0,
          duration: 280, ease: "Sine.easeOut",
          onComplete: () => leaf.destroy(),
        });
        break;
      }
      case "flare": {
        const star = this.scene.add.graphics();
        star.setDepth(91);
        star.setBlendMode(Phaser.BlendModes.ADD);
        star.fillStyle(sig.accent, 0.75);
        star.fillCircle(pos.x, pos.y, 2.5);
        star.lineStyle(1.5, sig.primary, 0.9);
        for (let i = 0; i < 4; i++) {
          const a = (Math.PI / 2) * i + Math.PI / 4;
          star.beginPath();
          star.moveTo(pos.x + Math.cos(a) * 2, pos.y + Math.sin(a) * 2);
          star.lineTo(pos.x + Math.cos(a) * 7, pos.y + Math.sin(a) * 7);
          star.strokePath();
        }
        this.scene.tweens.add({
          targets: star, scaleX: 2.8, scaleY: 2.8, alpha: 0, angle: 45,
          duration: 230, ease: "Quad.easeOut",
          onComplete: () => star.destroy(),
        });
        break;
      }
      case "bolt": {
        // Lightning zigzag flash
        const zap = this.scene.add.graphics();
        zap.setDepth(91);
        zap.setBlendMode(Phaser.BlendModes.ADD);
        zap.lineStyle(2.5, sig.accent, 0.95);
        zap.beginPath();
        zap.moveTo(pos.x - 4, pos.y - 7); zap.lineTo(pos.x + 2, pos.y - 2);
        zap.lineTo(pos.x - 2, pos.y + 2); zap.lineTo(pos.x + 4, pos.y + 7);
        zap.strokePath();
        zap.lineStyle(5, sig.primary, 0.3);
        zap.beginPath();
        zap.moveTo(pos.x - 4, pos.y - 7); zap.lineTo(pos.x + 2, pos.y - 2);
        zap.lineTo(pos.x - 2, pos.y + 2); zap.lineTo(pos.x + 4, pos.y + 7);
        zap.strokePath();
        this.scene.tweens.add({
          targets: zap, scaleX: 2.5, scaleY: 2.5, alpha: 0,
          duration: 180, ease: "Quad.easeOut",
          onComplete: () => zap.destroy(),
        });
        break;
      }
      case "crescent": {
        // Curved blade arc flash
        const arc = this.scene.add.graphics();
        arc.setDepth(91);
        arc.setBlendMode(Phaser.BlendModes.ADD);
        arc.lineStyle(2.5, sig.accent, 0.9);
        arc.beginPath();
        arc.arc(pos.x, pos.y, 6, Phaser.Math.DegToRad(-100), Phaser.Math.DegToRad(100), false);
        arc.strokePath();
        arc.lineStyle(5, sig.primary, 0.35);
        arc.beginPath();
        arc.arc(pos.x, pos.y, 6, Phaser.Math.DegToRad(-80), Phaser.Math.DegToRad(80), false);
        arc.strokePath();
        this.scene.tweens.add({
          targets: arc, scaleX: 2.5, scaleY: 2.5, alpha: 0, angle: 30,
          duration: 220, ease: "Quad.easeOut",
          onComplete: () => arc.destroy(),
        });
        break;
      }
      case "spiral": {
        // Spiraling vortex flash
        const vortex = this.scene.add.graphics();
        vortex.setDepth(91);
        vortex.setBlendMode(Phaser.BlendModes.ADD);
        vortex.lineStyle(1.5, sig.accent, 0.85);
        vortex.beginPath();
        for (let t = 0; t < Math.PI * 2.5; t += 0.25) {
          const r = t * 1.8;
          const px = pos.x + Math.cos(t) * r;
          const py = pos.y + Math.sin(t) * r;
          if (t === 0) vortex.moveTo(px, py); else vortex.lineTo(px, py);
        }
        vortex.strokePath();
        this.scene.tweens.add({
          targets: vortex, scaleX: 2, scaleY: 2, alpha: 0, angle: 90,
          duration: 300, ease: "Quad.easeOut",
          onComplete: () => vortex.destroy(),
        });
        break;
      }
      case "star": {
        // 5-pointed star flash
        const starG = this.scene.add.graphics();
        starG.setDepth(91);
        starG.setBlendMode(Phaser.BlendModes.ADD);
        const outerR = 6, innerR = 2.5;
        const starPts: Phaser.Geom.Point[] = [];
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
          const r = i % 2 === 0 ? outerR : innerR;
          starPts.push(new Phaser.Geom.Point(pos.x + Math.cos(a) * r, pos.y + Math.sin(a) * r));
        }
        starG.fillStyle(sig.accent, 0.8);
        starG.fillPoints(starPts, true);
        starG.fillStyle(sig.primary, 0.5);
        starG.fillCircle(pos.x, pos.y, innerR);
        this.scene.tweens.add({
          targets: starG, scaleX: 3, scaleY: 3, alpha: 0, angle: 36,
          duration: 250, ease: "Quad.easeOut",
          onComplete: () => starG.destroy(),
        });
        break;
      }
      case "orb":
      default: {
        const outer = this.scene.add.arc(pos.x, pos.y, 4, 0, 360, false, sig.primary, 0.5);
        outer.setDepth(91);
        outer.setBlendMode(Phaser.BlendModes.ADD);
        const inner = this.scene.add.arc(pos.x, pos.y, 2, 0, 360, false, sig.accent, 0.9);
        inner.setDepth(92);
        inner.setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({
          targets: outer, scaleX: 4, scaleY: 4, alpha: 0,
          duration: 280, ease: "Quad.easeOut",
          onComplete: () => outer.destroy(),
        });
        this.scene.tweens.add({
          targets: inner, scaleX: 2.5, scaleY: 2.5, alpha: 0,
          duration: 200, ease: "Quad.easeOut",
          onComplete: () => inner.destroy(),
        });
        break;
      }
    }
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
      case "bolt": {
        const r = signature.projectileRadius;
        dot.lineStyle(4, signature.accent, 0.3);
        dot.beginPath(); dot.moveTo(-1, -r - 3); dot.lineTo(2, -r); dot.lineTo(-2, 0); dot.lineTo(1, r); dot.lineTo(-1, r + 3); dot.strokePath();
        dot.lineStyle(2, signature.primary, 0.95);
        dot.beginPath(); dot.moveTo(-1, -r - 3); dot.lineTo(2, -r); dot.lineTo(-2, 0); dot.lineTo(1, r); dot.lineTo(-1, r + 3); dot.strokePath();
        break;
      }
      case "crescent":
        dot.lineStyle(2, signature.primary, 0.95);
        dot.beginPath();
        dot.arc(0, 0, signature.projectileRadius + 2, Phaser.Math.DegToRad(-120), Phaser.Math.DegToRad(120), false);
        dot.strokePath();
        dot.lineStyle(4, signature.accent, 0.3);
        dot.beginPath();
        dot.arc(0, 0, signature.projectileRadius + 2, Phaser.Math.DegToRad(-100), Phaser.Math.DegToRad(100), false);
        dot.strokePath();
        break;
      case "spiral": {
        const sr = signature.projectileRadius;
        dot.lineStyle(1.5, signature.primary, 0.9);
        dot.beginPath();
        for (let t = 0; t < Math.PI * 3; t += 0.3) {
          const rad = t * (sr / 4);
          const sx = Math.cos(t) * rad;
          const sy = Math.sin(t) * rad;
          if (t === 0) dot.moveTo(sx, sy); else dot.lineTo(sx, sy);
        }
        dot.strokePath();
        dot.fillStyle(signature.accent, 0.6);
        dot.fillCircle(0, 0, sr * 0.5);
        break;
      }
      case "star": {
        const rs = signature.projectileRadius + 2;
        const ri = rs * 0.4;
        const pts: Phaser.Geom.Point[] = [];
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
          const rad = i % 2 === 0 ? rs : ri;
          pts.push(new Phaser.Geom.Point(Math.cos(a) * rad, Math.sin(a) * rad));
        }
        dot.fillStyle(signature.accent, 0.5);
        dot.fillPoints(pts, true);
        dot.fillStyle(signature.primary, 0.95);
        dot.fillCircle(0, 0, ri * 0.6);
        break;
      }
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
      case "slash": {
        const s = signature.ringRadius;
        outer.beginPath();
        outer.moveTo(center.x - s, center.y - s); outer.lineTo(center.x + s, center.y + s);
        outer.moveTo(center.x + s, center.y - s); outer.lineTo(center.x - s, center.y + s);
        outer.strokePath();
        break;
      }
      case "spiral": {
        for (let arm = 0; arm < 3; arm++) {
          const base = (Math.PI * 2 * arm) / 3;
          outer.beginPath();
          for (let t = 0; t <= Math.PI * 1.5; t += 0.2) {
            const r = (t / (Math.PI * 1.5)) * (signature.ringRadius + 3);
            const px = center.x + Math.cos(base + t) * r;
            const py = center.y + Math.sin(base + t) * r;
            if (t === 0) outer.moveTo(px, py); else outer.lineTo(px, py);
          }
          outer.strokePath();
        }
        break;
      }
      case "hex": {
        const hexPts: Phaser.Geom.Point[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6;
          hexPts.push(new Phaser.Geom.Point(
            center.x + Math.cos(a) * signature.ringRadius,
            center.y + Math.sin(a) * signature.ringRadius,
          ));
        }
        outer.strokePoints(hexPts, true);
        break;
      }
      case "scatter": {
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.4;
          const r = signature.ringRadius * (0.3 + Math.random() * 0.7);
          outer.fillStyle(signature.primary, 0.7);
          outer.fillCircle(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r, 1.5);
        }
        break;
      }
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
