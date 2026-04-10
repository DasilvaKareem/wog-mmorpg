import * as THREE from "three";
import type { Entity, VisibleIntent } from "../types.js";
import type { IntentVisibilityMode } from "../hud/IntentModeBadge.js";
import type { EntityManager } from "./EntityManager.js";
import { NO_OUTLINE_LAYER } from "./ToonPipeline.js";
import type { ZoneEvent } from "../types.js";

/**
 * Action lines driven by zone events (combat, ability, technique-start).
 * Lines appear when an action happens and fade out when the action duration expires.
 * Colors: red=attack, purple=debuff, green=heal/buff, blue=buff.
 */

interface ActionLine {
  id: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  category: "attack" | "heal" | "buff" | "debuff";
  delivery: "melee" | "projectile" | "area" | "channel" | "instant";
  techniqueName?: string;
  createdAt: number;
  duration: number;
  color: number;
  width: number;
  pulseSpeed: number;
  priority: number;
}

interface IntentVisual {
  shafts: THREE.Mesh[];
  shaftMaterial: THREE.MeshBasicMaterial;
  sourceMarker: THREE.Mesh;
  sourceMaterial: THREE.MeshBasicMaterial;
  targetRing: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  arrowhead: THREE.Mesh;
  arrowMaterial: THREE.MeshBasicMaterial;
  glyph: THREE.Sprite;
  glyphMaterial: THREE.SpriteMaterial;
}

const MAX_VISIBLE_LINES = 20;
const CURVE_SEGMENTS = 6;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const SOURCE_SCALE = 0.09;
const TARGET_RING_RADIUS = 0.16;
const SHAFT_GEO = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
const MARKER_GEO = new THREE.SphereGeometry(1, 10, 8);
const RING_GEO = new THREE.TorusGeometry(1, 0.18, 6, 20);
const ARROW_GEO = new THREE.ConeGeometry(0.55, 1.2, 8);
const GLYPH_TEXTURES: Record<string, THREE.CanvasTexture> = {
  attack: makeGlyphTexture("!"),
  heal: makeGlyphTexture("+"),
  buff: makeGlyphTexture("^"),
  debuff: makeGlyphTexture("x"),
};

/** Default line duration for combat actions (seconds) */
const DEFAULT_DURATION = 0.8;
/** Fade-out starts this many seconds before expiry */
const FADE_LEAD = 0.3;

export class IntentLinesManager {
  readonly group = new THREE.Group();

  private visuals: IntentVisual[] = [];
  private activeLines: ActionLine[] = [];
  private focusEntityId: string | null = null;
  private visibilityMode: IntentVisibilityMode = "minimal";
  private elapsed = 0;
  private primaryIntentLabel: string | null = null;

  constructor(private entityMgr: EntityManager) {
    this.group.name = "intent-lines";
    for (let i = 0; i < MAX_VISIBLE_LINES; i++) {
      this.visuals.push(this.createVisual());
    }
  }

  /** Still called by main.ts for entity data — kept for anchor lookups */
  sync(_entities: Record<string, Entity>, _intents: VisibleIntent[] = []) {
    // Entity data accessed via entityMgr; intents no longer drive lines
  }

  /** Process zone events to create action lines */
  processEvents(events: ZoneEvent[]) {
    const now = performance.now();

    for (const ev of events) {
      if (ev.type === "combat" && ev.entityId && ev.targetId) {
        this.addLine(ev.entityId, ev.targetId, "attack",
          (ev.data?.animStyle as string) ?? "melee", undefined, DEFAULT_DURATION, now);
      }

      if (ev.type === "ability" && ev.entityId && ev.targetId) {
        const category = classifyAbilityCategory(ev.data?.techniqueType as string, ev.data?.techniqueId as string);
        const delivery = (ev.data?.animStyle as string) ?? "instant";
        const techniqueName = ev.data?.techniqueName as string | undefined;
        this.addLine(ev.entityId, ev.targetId, category, delivery, techniqueName, DEFAULT_DURATION, now);
      }

      if (ev.type === "technique-start" && ev.entityId && ev.targetId) {
        const category = classifyAbilityCategory(ev.data?.techniqueType as string, ev.data?.techniqueId as string);
        const delivery = (ev.data?.animStyle as string) ?? "instant";
        const techniqueName = ev.data?.techniqueName as string | undefined;
        const windupTicks = (ev.data?.windupTicks as number) ?? 2;
        this.addLine(ev.entityId, ev.targetId, category, delivery, techniqueName, windupTicks * 1.0 + 0.5, now);
      }
    }
  }

  private addLine(
    sourceId: string, targetId: string,
    category: ActionLine["category"], delivery: string,
    techniqueName: string | undefined, duration: number, now: number,
  ) {
    const source = this.entityMgr.getEntity(sourceId);
    const target = this.entityMgr.getEntity(targetId);
    if (!source || !target) return;

    // Dedupe: if same source→target line already active, refresh it
    const existing = this.activeLines.find((l) => l.sourceId === sourceId && l.targetId === targetId);
    if (existing) {
      existing.createdAt = now;
      existing.duration = Math.max(existing.duration, duration);
      existing.category = category;
      existing.techniqueName = techniqueName;
      const style = getLineStyle(category, delivery);
      existing.color = style.color;
      existing.width = style.width;
      existing.pulseSpeed = style.pulseSpeed;
      return;
    }

    const style = getLineStyle(category, delivery);
    const priority = this.scoreLine(source, target, category);
    if (priority <= 0) return;

    this.activeLines.push({
      id: `${sourceId}:${targetId}:${now}`,
      sourceId,
      sourceName: source.name,
      targetId,
      targetName: target.name,
      category,
      delivery: normalizeDelivery(delivery),
      techniqueName,
      createdAt: now,
      duration,
      color: style.color,
      width: style.width,
      pulseSpeed: style.pulseSpeed,
      priority,
    });

    // Keep sorted by priority
    this.activeLines.sort((a, b) => b.priority - a.priority);
    // Cap active lines
    if (this.activeLines.length > MAX_VISIBLE_LINES) {
      this.activeLines.length = MAX_VISIBLE_LINES;
    }
  }

  setFocusEntity(entityId: string | null) {
    this.focusEntityId = entityId;
  }

  setVisibilityMode(mode: IntentVisibilityMode) {
    this.visibilityMode = mode;
  }

  cycleVisibilityMode(): IntentVisibilityMode {
    this.visibilityMode = this.visibilityMode === "minimal"
      ? "tactical"
      : this.visibilityMode === "tactical"
        ? "spectator"
        : "minimal";
    return this.visibilityMode;
  }

  getVisibilityMode(): IntentVisibilityMode {
    return this.visibilityMode;
  }

  getPrimaryIntentLabel(): string | null {
    return this.primaryIntentLabel;
  }

  update(dt: number) {
    this.elapsed += dt;
    const now = performance.now();

    // Expire old lines
    this.activeLines = this.activeLines.filter((l) => (now - l.createdAt) / 1000 < l.duration);

    // Apply visibility limit
    const limit = getVisibleLimit(this.visibilityMode);
    const visible = this.activeLines.slice(0, limit);
    this.primaryIntentLabel = visible[0] ? formatLabel(visible[0]) : null;

    for (let i = 0; i < this.visuals.length; i++) {
      const visual = this.visuals[i];
      const line = visible[i];
      if (!line) {
        this.setVisualVisible(visual, false);
        continue;
      }

      const sourcePos = this.getAnchor(line.sourceId, "source");
      const targetPos = this.getAnchor(line.targetId, "target");
      if (!sourcePos || !targetPos) {
        this.setVisualVisible(visual, false);
        continue;
      }

      // Age & fade
      const age = (now - line.createdAt) / 1000;
      const remaining = line.duration - age;
      const fadeFactor = remaining < FADE_LEAD ? remaining / FADE_LEAD : 1;

      const pulse = 1 + Math.sin(this.elapsed * line.pulseSpeed) * 0.12;
      const width = line.width * pulse;
      const baseOpacity = 0.4 + Math.min(line.priority / 200, 0.35);
      const opacity = baseOpacity * fadeFactor;
      const markerOpacity = Math.min(1, opacity + 0.15);
      const points = getCurvePoints(sourcePos, targetPos, CURVE_SEGMENTS, line.delivery);

      visual.shaftMaterial.color.setHex(line.color);
      visual.shaftMaterial.opacity = opacity;
      for (let segmentIdx = 0; segmentIdx < visual.shafts.length; segmentIdx++) {
        const shaft = visual.shafts[segmentIdx];
        this.positionCylinder(shaft, points[segmentIdx], points[segmentIdx + 1], width);
      }

      visual.sourceMarker.position.copy(sourcePos);
      visual.sourceMarker.scale.setScalar(SOURCE_SCALE * pulse);
      visual.sourceMaterial.color.setHex(line.color);
      visual.sourceMaterial.opacity = markerOpacity;

      const finalDir = new THREE.Vector3().subVectors(points[points.length - 1], points[points.length - 2]).normalize();

      visual.targetRing.position.copy(targetPos);
      visual.targetRing.scale.setScalar(TARGET_RING_RADIUS * pulse);
      visual.targetRing.quaternion.setFromUnitVectors(Z_AXIS, finalDir);
      visual.ringMaterial.color.setHex(line.color);
      visual.ringMaterial.opacity = markerOpacity;

      visual.arrowhead.position.copy(targetPos).addScaledVector(finalDir, -0.12);
      visual.arrowhead.scale.setScalar(0.12 + width * 0.9);
      visual.arrowhead.quaternion.setFromUnitVectors(Y_AXIS, finalDir);
      visual.arrowMaterial.color.setHex(line.color);
      visual.arrowMaterial.opacity = markerOpacity;

      visual.glyph.position.copy(targetPos);
      visual.glyph.position.y += 0.32;
      visual.glyph.scale.set(0.42 * pulse, 0.42 * pulse, 1);
      visual.glyphMaterial.map = GLYPH_TEXTURES[line.category] ?? GLYPH_TEXTURES.attack;
      visual.glyphMaterial.color.setHex(line.color);
      visual.glyphMaterial.opacity = markerOpacity;

      this.setVisualVisible(visual, true);
    }
  }

  private scoreLine(source: Entity, target: Entity, category: string): number {
    const isBoss = source.type === "boss";
    const isPlayerRelevant = source.type === "player" || target.type === "player";
    const involvesFocus = this.focusEntityId != null
      && (source.id === this.focusEntityId || target.id === this.focusEntityId);

    if (this.visibilityMode === "minimal") {
      if (this.focusEntityId && !involvesFocus && !isBoss) return 0;
      if (!this.focusEntityId && !isPlayerRelevant && !isBoss) return 0;
    } else if (this.visibilityMode === "tactical") {
      if (!isPlayerRelevant && !isBoss) return 0;
    }

    let score = 0;
    if (target.id === this.focusEntityId) score += 120;
    if (source.id === this.focusEntityId) score += 110;
    if (isBoss) score += 90;
    if (target.type === "player") score += 50;
    if (source.type === "player") score += 35;
    if (category !== "attack") score += 10;
    if (category === "heal") score += 15;
    if (category === "debuff") score += 10;
    return score;
  }

  private getAnchor(entityId: string, endpoint: "source" | "target"): THREE.Vector3 | null {
    const pos = this.entityMgr.getEntityPosition(entityId);
    const entity = this.entityMgr.getEntity(entityId);
    if (!pos || !entity) return null;

    const yOffset = entity.type === "boss"
      ? 1.9
      : entity.type === "mob"
        ? 1.25
        : entity.type === "player"
          ? 1.45
          : 1.2;

    const anchor = pos.clone();
    anchor.y += yOffset;
    if (endpoint === "target" && entityId === this.focusEntityId) {
      anchor.y += 0.08;
    }
    return anchor;
  }

  private createVisual(): IntentVisual {
    const shaftMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const shafts: THREE.Mesh[] = [];
    for (let i = 0; i < CURVE_SEGMENTS; i++) {
      const shaft = new THREE.Mesh(SHAFT_GEO, shaftMaterial);
      shaft.layers.set(NO_OUTLINE_LAYER);
      shaft.visible = false;
      shafts.push(shaft);
      this.group.add(shaft);
    }

    const sourceMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sourceMarker = new THREE.Mesh(MARKER_GEO, sourceMaterial);
    sourceMarker.layers.set(NO_OUTLINE_LAYER);
    sourceMarker.visible = false;
    this.group.add(sourceMarker);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const targetRing = new THREE.Mesh(RING_GEO, ringMaterial);
    targetRing.layers.set(NO_OUTLINE_LAYER);
    targetRing.visible = false;
    this.group.add(targetRing);

    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const arrowhead = new THREE.Mesh(ARROW_GEO, arrowMaterial);
    arrowhead.layers.set(NO_OUTLINE_LAYER);
    arrowhead.visible = false;
    this.group.add(arrowhead);

    const glyphMaterial = new THREE.SpriteMaterial({
      map: GLYPH_TEXTURES.attack, color: 0xffffff,
      transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glyph = new THREE.Sprite(glyphMaterial);
    glyph.layers.set(NO_OUTLINE_LAYER);
    glyph.visible = false;
    this.group.add(glyph);

    return { shafts, shaftMaterial, sourceMarker, sourceMaterial, targetRing, ringMaterial, arrowhead, arrowMaterial, glyph, glyphMaterial };
  }

  private setVisualVisible(visual: IntentVisual, visible: boolean) {
    for (const shaft of visual.shafts) shaft.visible = visible;
    visual.sourceMarker.visible = visible;
    visual.targetRing.visible = visible;
    visual.arrowhead.visible = visible;
    visual.glyph.visible = visible;
  }

  private positionCylinder(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, width: number) {
    const delta = new THREE.Vector3().subVectors(to, from);
    const length = Math.max(delta.length(), 0.1);
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    mesh.position.copy(midpoint);
    mesh.scale.set(width, length, width);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, delta.normalize());
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function classifyAbilityCategory(techniqueType?: string, techniqueId?: string): ActionLine["category"] {
  if (techniqueType === "healing") return "heal";
  if (techniqueType === "buff") return "buff";
  if (techniqueType === "debuff") return "debuff";
  // Fallback: check technique ID patterns
  if (techniqueId) {
    const id = techniqueId.toLowerCase();
    if (/heal|holy_light|renew|lay_on_hands|prayer|redemption/.test(id)) return "heal";
    if (/curse|slow|corruption|weakness|poison|intimidating|rend|siphon|drain/.test(id)) return "debuff";
    if (/shield|armor|blessing|protection|battle_rage|wall|stealth|fortitude|aura/.test(id)) return "buff";
  }
  return "attack";
}

function normalizeDelivery(d: string): ActionLine["delivery"] {
  if (d === "melee" || d === "projectile" || d === "area" || d === "channel" || d === "instant") {
    return d;
  }
  return "instant";
}

function getLineStyle(category: ActionLine["category"], delivery: string) {
  if (category === "attack") {
    const dangerous = delivery === "area" || delivery === "channel";
    return {
      color: dangerous ? 0xff9933 : 0xff5555,
      width: dangerous ? 0.07 : 0.055,
      pulseSpeed: dangerous ? 8 : 6,
    };
  }
  if (category === "heal") return { color: 0x5cff9d, width: 0.05, pulseSpeed: 5 };
  if (category === "buff") return { color: 0x55bbff, width: 0.045, pulseSpeed: 4 };
  // debuff
  return { color: 0xb86eff, width: 0.05, pulseSpeed: 6 };
}

function getCurvePoints(
  from: THREE.Vector3, to: THREE.Vector3,
  segments: number, delivery: ActionLine["delivery"],
): THREE.Vector3[] {
  const control = from.clone().lerp(to, 0.5);
  const distance = from.distanceTo(to);
  const liftMultiplier = delivery === "projectile" ? 0.18
    : delivery === "channel" ? 0.1 : 0.12;
  control.y += Math.min(0.8, Math.max(0.12, distance * liftMultiplier));
  const curve = new THREE.QuadraticBezierCurve3(from, control, to);
  return curve.getPoints(segments);
}

function formatLabel(line: ActionLine): string {
  if (line.techniqueName) {
    return `${line.sourceName} uses ${line.techniqueName} on ${line.targetName}`;
  }
  if (line.category === "heal") return `${line.sourceName} heals ${line.targetName}`;
  if (line.category === "buff") return `${line.sourceName} buffs ${line.targetName}`;
  if (line.category === "debuff") return `${line.sourceName} weakens ${line.targetName}`;
  return `${line.sourceName} attacks ${line.targetName}`;
}

function getVisibleLimit(mode: IntentVisibilityMode): number {
  if (mode === "minimal") return 8;
  if (mode === "tactical") return 12;
  return MAX_VISIBLE_LINES;
}

function makeGlyphTexture(label: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 64px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.strokeText(label, canvas.width / 2, canvas.height / 2 + 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
