import * as THREE from "three";
import type { Entity, EntityOrder, VisibleIntent } from "../types.js";
import type { IntentVisibilityMode } from "../hud/IntentModeBadge.js";
import type { EntityManager } from "./EntityManager.js";
import { NO_OUTLINE_LAYER } from "./ToonPipeline.js";

type CombatOrder = Extract<EntityOrder, { action: "attack" | "technique" }>;

interface ResolvedIntent {
  id: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  category: VisibleIntent["category"];
  delivery: VisibleIntent["delivery"];
  state: VisibleIntent["state"];
  techniqueName?: string;
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

const MAX_VISIBLE_INTENTS = 20;
const CURVE_SEGMENTS = 6;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const SOURCE_SCALE = 0.09;
const TARGET_RING_RADIUS = 0.16;
const SHAFT_GEO = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
const MARKER_GEO = new THREE.SphereGeometry(1, 10, 8);
const RING_GEO = new THREE.TorusGeometry(1, 0.18, 6, 20);
const ARROW_GEO = new THREE.ConeGeometry(0.55, 1.2, 8);
const GLYPH_TEXTURES: Record<VisibleIntent["category"], THREE.CanvasTexture> = {
  attack: makeGlyphTexture("!"),
  heal: makeGlyphTexture("+"),
  buff: makeGlyphTexture("^"),
  debuff: makeGlyphTexture("x"),
};

export class IntentLinesManager {
  readonly group = new THREE.Group();

  private visuals: IntentVisual[] = [];
  private intents: ResolvedIntent[] = [];
  private entities: Record<string, Entity> = {};
  private serverIntents: VisibleIntent[] = [];
  private focusEntityId: string | null = null;
  private visibilityMode: IntentVisibilityMode = "minimal";
  private elapsed = 0;
  private primaryIntentLabel: string | null = null;

  constructor(private entityMgr: EntityManager) {
    this.group.name = "intent-lines";
    for (let i = 0; i < MAX_VISIBLE_INTENTS; i++) {
      this.visuals.push(this.createVisual());
    }
  }

  sync(entities: Record<string, Entity>, intents: VisibleIntent[] = []) {
    this.entities = entities;
    this.serverIntents = intents;
    this.rebuild();
  }

  setFocusEntity(entityId: string | null) {
    this.focusEntityId = entityId;
    this.rebuild();
  }

  setVisibilityMode(mode: IntentVisibilityMode) {
    this.visibilityMode = mode;
    this.rebuild();
  }

  cycleVisibilityMode(): IntentVisibilityMode {
    this.visibilityMode = this.visibilityMode === "minimal"
      ? "tactical"
      : this.visibilityMode === "tactical"
        ? "spectator"
        : "minimal";
    this.rebuild();
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

    for (let i = 0; i < this.visuals.length; i++) {
      const visual = this.visuals[i];
      const intent = this.intents[i];
      if (!intent) {
        this.setVisualVisible(visual, false);
        continue;
      }

      const sourcePos = this.getAnchor(intent.sourceId, "source");
      const targetPos = this.getAnchor(intent.targetId, "target");
      if (!sourcePos || !targetPos) {
        this.setVisualVisible(visual, false);
        continue;
      }

      const pulse = 1 + Math.sin(this.elapsed * intent.pulseSpeed) * 0.12;
      const width = intent.width * pulse;
      const opacity = 0.4 + Math.min(intent.priority / 200, 0.35);
      const markerOpacity = Math.min(1, opacity + 0.15);
      const points = getCurvePoints(sourcePos, targetPos, CURVE_SEGMENTS, intent.delivery);

      visual.shaftMaterial.color.setHex(intent.color);
      visual.shaftMaterial.opacity = opacity;
      for (let segmentIdx = 0; segmentIdx < visual.shafts.length; segmentIdx++) {
        const shaft = visual.shafts[segmentIdx];
        this.positionCylinder(shaft, points[segmentIdx], points[segmentIdx + 1], width);
      }

      visual.sourceMarker.position.copy(sourcePos);
      visual.sourceMarker.scale.setScalar(SOURCE_SCALE * pulse);
      visual.sourceMaterial.color.setHex(intent.color);
      visual.sourceMaterial.opacity = markerOpacity;

      const finalDir = new THREE.Vector3().subVectors(points[points.length - 1], points[points.length - 2]).normalize();

      visual.targetRing.position.copy(targetPos);
      visual.targetRing.scale.setScalar(TARGET_RING_RADIUS * pulse);
      visual.targetRing.quaternion.setFromUnitVectors(Z_AXIS, finalDir);
      visual.ringMaterial.color.setHex(intent.color);
      visual.ringMaterial.opacity = markerOpacity;

      visual.arrowhead.position.copy(targetPos).addScaledVector(finalDir, -0.12);
      visual.arrowhead.scale.setScalar(0.12 + width * 0.9);
      visual.arrowhead.quaternion.setFromUnitVectors(Y_AXIS, finalDir);
      visual.arrowMaterial.color.setHex(intent.color);
      visual.arrowMaterial.opacity = markerOpacity;

      visual.glyph.position.copy(targetPos);
      visual.glyph.position.y += 0.32;
      visual.glyph.scale.set(0.42 * pulse, 0.42 * pulse, 1);
      visual.glyphMaterial.map = GLYPH_TEXTURES[intent.category];
      visual.glyphMaterial.color.setHex(intent.color);
      visual.glyphMaterial.opacity = markerOpacity;

      this.setVisualVisible(visual, true);
    }
  }

  private rebuild() {
    const intents: ResolvedIntent[] = [];
    const authoritative = this.serverIntents.length > 0
      ? this.serverIntents
      : this.buildFallbackIntents();

    for (const intent of authoritative) {
      const source = this.entities[intent.sourceId];
      const target = this.entities[intent.targetId];
      if (!source || !target) continue;

      const priority = this.scoreIntent(source, target, intent);
      if (priority <= 0) continue;

      const style = getIntentStyle(
        intent.category,
        intent.delivery,
        intent.severity === "dangerous",
        intent.state === "casting",
      );
      intents.push({
        id: intent.id,
        sourceId: intent.sourceId,
        sourceName: intent.sourceName,
        targetId: intent.targetId,
        targetName: intent.targetName,
        category: intent.category,
        delivery: intent.delivery,
        state: intent.state,
        techniqueName: intent.techniqueName,
        color: style.color,
        width: style.width,
        pulseSpeed: style.pulseSpeed,
        priority,
      });
    }

    intents.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    this.intents = intents.slice(0, getVisibleLimit(this.visibilityMode));
    this.primaryIntentLabel = this.intents[0] ? formatIntentLabel(this.intents[0]) : null;
  }

  private buildFallbackIntents(): VisibleIntent[] {
    const intents: VisibleIntent[] = [];

    for (const entity of Object.values(this.entities)) {
      const order = entity.order;
      if (!order || order.action === "move") continue;
      const combatOrder: CombatOrder = order;
      const target = this.entities[combatOrder.targetId];
      if (!target) continue;

      const category = classifyCategory(combatOrder);
      const delivery = classifyDelivery(combatOrder);
      intents.push({
        id: `${entity.id}:${combatOrder.action}:${combatOrder.action === "technique" ? combatOrder.techniqueId : combatOrder.targetId}`,
        sourceId: entity.id,
        sourceName: entity.name,
        sourceType: entity.type,
        targetId: target.id,
        targetName: target.name,
        targetType: target.type,
        category,
        delivery,
        state: "queued",
        severity: entity.type === "boss" || (category === "attack" && (delivery === "area" || delivery === "channel"))
          ? "dangerous"
          : "normal",
        ...(combatOrder.action === "technique" && { techniqueName: prettifyTechniqueName(combatOrder.techniqueId) }),
        ...(combatOrder.action === "technique" && { techniqueId: combatOrder.techniqueId }),
      });
    }

    return intents;
  }

  private scoreIntent(source: Entity, target: Entity, intent: Pick<VisibleIntent, "category" | "severity">): number {
    const isBoss = source.type === "boss" || intent.severity === "dangerous";
    const isPlayerRelevant = source.type === "player" || target.type === "player";
    const involvesFocus = this.focusEntityId != null
      && (source.id === this.focusEntityId || target.id === this.focusEntityId);

    if (this.visibilityMode === "minimal") {
      if (this.focusEntityId && !involvesFocus && !isBoss) {
        return 0;
      }
      if (!this.focusEntityId && !isPlayerRelevant && !isBoss) {
        return 0;
      }
    } else if (this.visibilityMode === "tactical") {
      if (!isPlayerRelevant && !isBoss && intent.severity !== "dangerous") {
        return 0;
      }
    }

    let score = 0;
    if (target.id === this.focusEntityId) score += 120;
    if (source.id === this.focusEntityId) score += 110;
    if (isBoss) score += 90;
    if (target.type === "player") score += 50;
    if (source.type === "player") score += 35;
    if (intent.category !== "attack") score += 10;

    if (intent.category === "heal") score += 15;
    if (intent.category === "debuff") score += 10;

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
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sourceMarker = new THREE.Mesh(MARKER_GEO, sourceMaterial);
    sourceMarker.layers.set(NO_OUTLINE_LAYER);
    sourceMarker.visible = false;
    this.group.add(sourceMarker);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const targetRing = new THREE.Mesh(RING_GEO, ringMaterial);
    targetRing.layers.set(NO_OUTLINE_LAYER);
    targetRing.visible = false;
    this.group.add(targetRing);

    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arrowhead = new THREE.Mesh(ARROW_GEO, arrowMaterial);
    arrowhead.layers.set(NO_OUTLINE_LAYER);
    arrowhead.visible = false;
    this.group.add(arrowhead);

    const glyphMaterial = new THREE.SpriteMaterial({
      map: GLYPH_TEXTURES.attack,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glyph = new THREE.Sprite(glyphMaterial);
    glyph.layers.set(NO_OUTLINE_LAYER);
    glyph.visible = false;
    this.group.add(glyph);

    return {
      shafts,
      shaftMaterial,
      sourceMarker,
      sourceMaterial,
      targetRing,
      ringMaterial,
      arrowhead,
      arrowMaterial,
      glyph,
      glyphMaterial,
    };
  }

  private setVisualVisible(visual: IntentVisual, visible: boolean) {
    for (const shaft of visual.shafts) {
      shaft.visible = visible;
    }
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

function getCurvePoints(
  from: THREE.Vector3,
  to: THREE.Vector3,
  segments: number,
  delivery: VisibleIntent["delivery"],
): THREE.Vector3[] {
  const control = from.clone().lerp(to, 0.5);
  const distance = from.distanceTo(to);
  const liftMultiplier = delivery === "projectile"
    ? 0.18
    : delivery === "channel"
      ? 0.1
      : 0.12;
  control.y += Math.min(0.8, Math.max(0.12, distance * liftMultiplier));

  const curve = new THREE.QuadraticBezierCurve3(from, control, to);
  return curve.getPoints(segments);
}

function classifyCategory(order: CombatOrder): VisibleIntent["category"] {
  if (order.action === "attack") return "attack";

  const id = order.techniqueId.toLowerCase();

  if (matchesAny(id, [
    "holy_light", "renew", "lay_on_hands", "meditation", "healing", "heal_",
    "_heal", "redemption", "prayer",
  ])) {
    return "heal";
  }

  if (matchesAny(id, [
    "curse", "slow", "corruption", "weakness", "mark", "disable", "roots",
    "poison", "howl", "judgment", "intimidating", "rend", "siphon", "drain",
  ])) {
    return "debuff";
  }

  if (matchesAny(id, [
    "shield", "armor", "blessing", "protection", "battle_rage", "wall",
    "stealth", "evasion", "fortitude", "resolve", "focus", "aura", "might",
    "inner_focus", "natures_blessing",
  ])) {
    return "buff";
  }

  return "attack";
}

function classifyDelivery(order: CombatOrder): VisibleIntent["delivery"] {
  if (order.action === "attack") return "melee";

  const id = order.techniqueId.toLowerCase();
  if (matchesAny(id, ["volley", "nova", "flamestrike", "consecration", "roots", "howl"])) {
    return "area";
  }
  if (matchesAny(id, ["drain_life", "siphon_soul", "meditation"])) {
    return "channel";
  }
  if (matchesAny(id, ["shot", "bolt", "missiles", "fireball", "light", "smite", "burst", "mark", "renew"])) {
    return "projectile";
  }
  return "instant";
}

function getIntentStyle(
  category: VisibleIntent["category"],
  delivery: VisibleIntent["delivery"],
  isBoss: boolean,
  isCasting: boolean,
) {
  if (category === "attack") {
    const dangerous = isBoss || delivery === "area" || delivery === "channel";
    return {
      color: dangerous ? 0xff9933 : 0xff5555,
      width: (dangerous ? 0.07 : 0.055) + (isCasting ? 0.012 : 0),
      pulseSpeed: (dangerous ? 8 : 6) + (isCasting ? 2 : 0),
    };
  }
  if (category === "heal") {
    return { color: 0x5cff9d, width: 0.05 + (isCasting ? 0.01 : 0), pulseSpeed: 5 + (isCasting ? 2 : 0) };
  }
  if (category === "buff") {
    return { color: 0x55bbff, width: 0.045 + (isCasting ? 0.008 : 0), pulseSpeed: 4 + (isCasting ? 2 : 0) };
  }
  return { color: 0xb86eff, width: 0.05 + (isCasting ? 0.01 : 0), pulseSpeed: 6 + (isCasting ? 2 : 0) };
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function formatIntentLabel(intent: Pick<ResolvedIntent, "sourceName" | "targetName" | "category" | "techniqueName" | "state">): string {
  if (intent.techniqueName) {
    return intent.state === "casting"
      ? `${intent.sourceName} is casting ${intent.techniqueName} on ${intent.targetName}`
      : `${intent.sourceName} is using ${intent.techniqueName} on ${intent.targetName}`;
  }
  if (intent.category === "heal") {
    return intent.state === "casting"
      ? `${intent.sourceName} is preparing to heal ${intent.targetName}`
      : `${intent.sourceName} is healing ${intent.targetName}`;
  }
  if (intent.category === "buff") {
    return intent.state === "casting"
      ? `${intent.sourceName} is preparing a buff for ${intent.targetName}`
      : `${intent.sourceName} is buffing ${intent.targetName}`;
  }
  if (intent.category === "debuff") {
    return intent.state === "casting"
      ? `${intent.sourceName} is preparing to weaken ${intent.targetName}`
      : `${intent.sourceName} is weakening ${intent.targetName}`;
  }
  return intent.state === "casting"
    ? `${intent.sourceName} is lining up ${intent.targetName}`
    : `${intent.sourceName} is targeting ${intent.targetName}`;
}

function getVisibleLimit(mode: IntentVisibilityMode): number {
  if (mode === "minimal") return 8;
  if (mode === "tactical") return 12;
  return MAX_VISIBLE_INTENTS;
}

function prettifyTechniqueName(techniqueId: string): string {
  return techniqueId
    .replace(/_r\d+$/i, "")
    .split("_")
    .slice(1)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
