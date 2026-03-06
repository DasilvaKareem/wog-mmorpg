import Phaser from "phaser";
import type { ZoneEvent } from "./types.js";
import {
  getTechniqueVisual,
  type TechniqueVisual,
} from "@/lib/techniqueVisuals";

const COORD_SCALE = 1.6;
const TEXTURE_KEY = "ability-particle-dot";

interface BurstCfg {
  tint: number[];
  count: number;
  speed: { min: number; max: number };
  scale: { start: number; end: number };
  lifespan: number;
  gravityY: number;
}

const DEFAULT_BURST_CFG: Record<string, BurstCfg> = {
  attack:  { tint: [0xf89800, 0xfacc22], count: 6, speed: { min: 20, max: 54 }, scale: { start: 0.42, end: 0 }, lifespan: 360, gravityY: 18 },
  healing: { tint: [0x00ff88, 0xccffee], count: 5, speed: { min: 10, max: 30 }, scale: { start: 0.32, end: 0 }, lifespan: 460, gravityY: -15 },
  buff:    { tint: [0xfacc22, 0xfff0a8], count: 4, speed: { min: 8, max: 24 }, scale: { start: 0.3, end: 0 }, lifespan: 420, gravityY: -12 },
  debuff:  { tint: [0xaa44ff, 0x7722cc], count: 5, speed: { min: 15, max: 42 }, scale: { start: 0.35, end: 0 }, lifespan: 360, gravityY: 12 },
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

    switch (animStyle) {
      case "melee": this.burst(signature, techType, targetPos); break;
      case "projectile": this.playProjectile(signature, techType, casterPos, targetPos); break;
      case "area": this.playArea(signature, techType, targetPos); break;
      case "channel": this.playChannel(signature, techType, casterPos, targetPos); break;
      default: this.burst(signature, techType, targetPos); break;
    }
  }

  // ── Projectile: small dot travels caster→target, burst on impact ────
  private playProjectile(signature: TechniqueVisual, techType: string, src: Pos, dst: Pos): void {
    const dot = this.scene.add.graphics();
    this.drawProjectile(dot, signature);
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
        this.burst(signature, techType, dst);
      },
    });
  }

  // ── Area: single thin expanding ring + small burst ──────────────────
  private playArea(signature: TechniqueVisual, techType: string, center: Pos): void {
    this.burst(signature, techType, center);
    this.playImpactPattern(signature, center);
  }

  // ── Channel: thin beam line + burst at target ───────────────────────
  private playChannel(signature: TechniqueVisual, techType: string, src: Pos, dst: Pos): void {
    const beam = this.scene.add.graphics();
    const beamWidth = signature.beamPattern === "pulse" ? 3 : 2;
    const beamAlpha = signature.beamPattern === "drain" ? 0.35 : 0.45;
    beam.lineStyle(beamWidth, signature.primary, beamAlpha);
    beam.beginPath();
    beam.moveTo(src.x, src.y);
    beam.lineTo(dst.x, dst.y);
    beam.strokePath();
    beam.setDepth(88);

    const core = this.scene.add.graphics();
    core.lineStyle(1, signature.accent, 0.9);
    core.beginPath();
    core.moveTo(src.x, src.y);
    core.lineTo(dst.x, dst.y);
    core.strokePath();
    core.setDepth(89);

    if (signature.beamPattern === "drain" || signature.beamPattern === "prayer") {
      const mid = this.scene.add.graphics();
      const markerColor = signature.beamPattern === "drain" ? signature.secondary : signature.accent;
      const midX = (src.x + dst.x) / 2;
      const midY = (src.y + dst.y) / 2;
      if (signature.beamPattern === "drain") {
        mid.fillStyle(markerColor, 0.85);
        mid.fillCircle(midX, midY, 2);
      } else {
        mid.lineStyle(1, markerColor, 0.9);
        mid.beginPath();
        mid.moveTo(midX - 3, midY);
        mid.lineTo(midX + 3, midY);
        mid.moveTo(midX, midY - 3);
        mid.lineTo(midX, midY + 3);
        mid.strokePath();
      }
      mid.setDepth(90);
      this.scene.tweens.add({
        targets: mid,
        alpha: 0,
        duration: 400,
        onComplete: () => mid.destroy(),
      });
    }

    this.scene.tweens.add({
      targets: [beam, core], alpha: 0, duration: 400,
      onComplete: () => {
        beam.destroy();
        core.destroy();
      },
    });

    this.scene.time.delayedCall(200, () => this.burst(signature, techType, dst));
  }

  // ── Level up: small gold pop ────────────────────────────────────────
  playLevelUp(pos: Pos): void {
    const sig: TechniqueVisual = { primary: 0xffd700, secondary: 0xfff0a8, accent: 0xffffff, count: 6, projectileRadius: 2, ringRadius: 5, projectileShape: "flare", impactPattern: "ring", beamPattern: "pulse", uiGlyph: "*" };
    this.burst(sig, "buff", pos);

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

  // ── Death: brief red flash ──────────────────────────────────────────
  playDeath(pos: Pos): void {
    const sig: TechniqueVisual = { primary: 0xff2222, secondary: 0xff8844, accent: 0xffc1a8, count: 8, projectileRadius: 2, ringRadius: 4, projectileShape: "flare", impactPattern: "spokes", beamPattern: "solid", uiGlyph: "*" };
    this.burst(sig, "attack", pos);

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
  private burst(signature: TechniqueVisual, techType: string, pos: Pos): void {
    const emitter = this.buildBurstEmitter(this.getBurstCfg(signature, techType));
    emitter.explode(signature.count, pos.x, pos.y);
    this.scene.time.delayedCall(600, () => emitter.destroy());
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
    return {
      ...base,
      tint: [signature.primary, signature.secondary, signature.accent],
      count: signature.count,
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

    const inner = this.scene.add.arc(center.x, center.y, Math.max(3, signature.ringRadius - 2), 0, 360, false);
    inner.setStrokeStyle(1, signature.accent, 0.65);
    inner.setFillStyle();
    inner.setDepth(84);

    this.scene.tweens.add({
      targets: outer,
      scaleX: 4.2,
      scaleY: 4.2,
      alpha: 0,
      duration: 340,
      ease: "Quad.easeOut",
      onComplete: () => outer.destroy(),
    });
    this.scene.tweens.add({
      targets: inner,
      scaleX: 3.4,
      scaleY: 3.4,
      alpha: 0,
      duration: 280,
      ease: "Quad.easeOut",
      onComplete: () => inner.destroy(),
    });
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

  private buildBurstEmitter(cfg: BurstCfg): Phaser.GameObjects.Particles.ParticleEmitter {
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
