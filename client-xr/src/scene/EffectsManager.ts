import * as THREE from "three";
import type { ZoneEvent, Entity, ElevationProvider } from "../types.js";
import type { EntityManager } from "./EntityManager.js";
import { CLASS_COLORS } from "./EntityManager.js";

// ── Constants ────────────────────────────────────────────────────────

const PARTICLE_COUNT = 2048;
const PROJECTILE_POOL = 8;
const RING_POOL = 4;
const SHIELD_POOL = 6;
const COORD_SCALE = 1 / 10;

const MOB_COLOR = 0xcc4444;
const BOSS_COLOR = 0xaa33ff;

// ── Helper: pick class/entity color ─────────────────────────────────

function entityColor(ent: Entity | null): number {
  if (!ent) return 0xffffff;
  if (ent.classId && CLASS_COLORS[ent.classId]) return CLASS_COLORS[ent.classId];
  if (ent.type === "boss") return BOSS_COLOR;
  if (ent.type === "mob") return MOB_COLOR;
  return 0xffffff;
}

// ── Active ability animation ────────────────────────────────────────

interface AbilityAnim {
  id: string;
  style: "melee" | "projectile" | "area" | "channel";
  elapsed: number;
  duration: number;
  color: number;
  classId: string;
  casterPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  radius?: number;
  // Pool indices
  projectileIdx?: number;
  ringIdx?: number;
  channelNextBurst: number;
}

// ── Persistent effect aura tracking ─────────────────────────────────

interface AuraState {
  entityId: string;
  effectId: string;
  type: "buff" | "debuff" | "dot" | "hot" | "shield";
  elapsed: number;
  nextEmit: number;
  shieldIdx?: number;
  originalColor?: number;
}

// ── EffectsManager ──────────────────────────────────────────────────

export class EffectsManager {
  readonly group = new THREE.Group();

  private entityMgr: EntityManager;
  private elevationProvider: ElevationProvider | null = null;
  private camera: THREE.Camera | null = null;

  // Particle pool
  private particleGeo: THREE.BufferGeometry;
  private particleMat: THREE.PointsMaterial;
  private particlePoints: THREE.Points;
  private pPositions: Float32Array;
  private pColors: Float32Array;
  private pSizes: Float32Array;
  private pVelocities: Float32Array; // xyz per particle
  private pLifetimes: Float32Array;  // [remaining, max] pairs
  private pAlive: Uint8Array;
  private nextParticle = 0;

  // Projectile orb pool
  private projectiles: THREE.Mesh[] = [];
  private projectileUsed: boolean[] = [];

  // Area ring pool
  private rings: THREE.Mesh[] = [];
  private ringUsed: boolean[] = [];

  // Shield sphere pool
  private shields: THREE.Mesh[] = [];
  private shieldUsed: boolean[] = [];

  // Active animations
  private anims: AbilityAnim[] = [];
  private seenEventIds = new Set<string>();

  // Active-effect auras
  private auras = new Map<string, AuraState>(); // key = entityId:effectId

  constructor(entityMgr: EntityManager) {
    this.entityMgr = entityMgr;
    this.group.name = "effects";

    // ── Particle pool ──────────────────────────────────────────────
    this.pPositions = new Float32Array(PARTICLE_COUNT * 3);
    this.pColors = new Float32Array(PARTICLE_COUNT * 3);
    this.pSizes = new Float32Array(PARTICLE_COUNT);
    this.pVelocities = new Float32Array(PARTICLE_COUNT * 3);
    this.pLifetimes = new Float32Array(PARTICLE_COUNT * 2);
    this.pAlive = new Uint8Array(PARTICLE_COUNT);

    this.particleGeo = new THREE.BufferGeometry();
    this.particleGeo.setAttribute("position", new THREE.BufferAttribute(this.pPositions, 3));
    this.particleGeo.setAttribute("color", new THREE.BufferAttribute(this.pColors, 3));
    this.particleGeo.setAttribute("size", new THREE.BufferAttribute(this.pSizes, 1));

    this.particleMat = new THREE.PointsMaterial({
      size: 0.25,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    this.particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
    this.particlePoints.frustumCulled = false;
    this.group.add(this.particlePoints);

    // ── Projectile orbs (large core + glow halo) ──────────────────
    const orbCoreGeo = new THREE.SphereGeometry(0.35, 12, 8);
    const orbGlowGeo = new THREE.SphereGeometry(0.7, 12, 8);
    for (let i = 0; i < PROJECTILE_POOL; i++) {
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
      const core = new THREE.Mesh(orbCoreGeo, coreMat);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.3,
        side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Mesh(orbGlowGeo, glowMat);
      glow.name = "glow";
      core.add(glow);
      core.visible = false;
      this.group.add(core);
      this.projectiles.push(core);
      this.projectileUsed.push(false);
    }

    // ── Area rings (thicker, more visible) ─────────────────────────
    const ringGeo = new THREE.RingGeometry(0.4, 0.9, 32);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push(mesh);
      this.ringUsed.push(false);
    }

    // ── Shield spheres ─────────────────────────────────────────────
    const shieldGeo = new THREE.SphereGeometry(0.8, 16, 12);
    for (let i = 0; i < SHIELD_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x66bbff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(shieldGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.shields.push(mesh);
      this.shieldUsed.push(false);
    }
  }

  // ── Configuration ───────────────────────────────────────────────

  setElevationProvider(ep: ElevationProvider) { this.elevationProvider = ep; }
  setCamera(c: THREE.Camera) { this.camera = c; }

  // ── Coordinate conversion ───────────────────────────────────────

  private toLocal(sx: number, sz: number): THREE.Vector3 {
    const x = sx * COORD_SCALE;
    const z = sz * COORD_SCALE;
    const y = this.elevationProvider?.getElevationAt(x, z) ?? 0;
    return new THREE.Vector3(x, y, z);
  }

  // ── Particle allocation ─────────────────────────────────────────

  private emitParticle(
    pos: THREE.Vector3, vel: THREE.Vector3,
    color: number, size: number, lifetime: number,
  ): number {
    // Find next free slot (wrap around)
    let idx = this.nextParticle;
    const start = idx;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!this.pAlive[idx]) break;
      idx = (idx + 1) % PARTICLE_COUNT;
      if (idx === start) break; // pool exhausted, overwrite oldest
    }
    this.nextParticle = (idx + 1) % PARTICLE_COUNT;

    const i3 = idx * 3;
    this.pPositions[i3] = pos.x;
    this.pPositions[i3 + 1] = pos.y;
    this.pPositions[i3 + 2] = pos.z;

    this.pVelocities[i3] = vel.x;
    this.pVelocities[i3 + 1] = vel.y;
    this.pVelocities[i3 + 2] = vel.z;

    const c = new THREE.Color(color);
    this.pColors[i3] = c.r;
    this.pColors[i3 + 1] = c.g;
    this.pColors[i3 + 2] = c.b;

    this.pSizes[idx] = size;
    this.pLifetimes[idx * 2] = lifetime;
    this.pLifetimes[idx * 2 + 1] = lifetime;
    this.pAlive[idx] = 1;

    return idx;
  }

  private emitBurst(pos: THREE.Vector3, color: number, count: number, speed: number, size: number, lifetime: number) {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI - Math.PI / 2;
      const vel = new THREE.Vector3(
        Math.cos(theta) * Math.cos(phi) * speed,
        Math.sin(phi) * speed + speed * 0.5,
        Math.sin(theta) * Math.cos(phi) * speed,
      );
      this.emitParticle(pos, vel, color, size, lifetime);
    }
  }

  // ── Pool allocation helpers ─────────────────────────────────────

  private allocProjectile(): number {
    for (let i = 0; i < PROJECTILE_POOL; i++) {
      if (!this.projectileUsed[i]) { this.projectileUsed[i] = true; return i; }
    }
    return -1;
  }

  private freeProjectile(idx: number) {
    if (idx >= 0 && idx < PROJECTILE_POOL) {
      this.projectileUsed[idx] = false;
      this.projectiles[idx].visible = false;
    }
  }

  private allocRing(): number {
    for (let i = 0; i < RING_POOL; i++) {
      if (!this.ringUsed[i]) { this.ringUsed[i] = true; return i; }
    }
    return -1;
  }

  private freeRing(idx: number) {
    if (idx >= 0 && idx < RING_POOL) {
      this.ringUsed[idx] = false;
      this.rings[idx].visible = false;
    }
  }

  private allocShield(): number {
    for (let i = 0; i < SHIELD_POOL; i++) {
      if (!this.shieldUsed[i]) { this.shieldUsed[i] = true; return i; }
    }
    return -1;
  }

  private freeShield(idx: number) {
    if (idx >= 0 && idx < SHIELD_POOL) {
      this.shieldUsed[idx] = false;
      this.shields[idx].visible = false;
    }
  }

  // ── Event processing ────────────────────────────────────────────

  processEvents(events: ZoneEvent[]) {
    for (const ev of events) {
      if (ev.type !== "ability") continue;
      if (this.seenEventIds.has(ev.id)) continue;
      this.seenEventIds.add(ev.id);

      const d = ev.data ?? {};
      const animStyle = (d.animStyle as string) ?? "melee";
      const casterX = d.casterX as number | undefined;
      const casterZ = d.casterZ as number | undefined;
      const targetX = d.targetX as number | undefined;
      const targetZ = d.targetZ as number | undefined;

      // Resolve positions: prefer explicit coords, fall back to entity positions
      let casterPos: THREE.Vector3;
      let targetPos: THREE.Vector3;

      if (casterX != null && casterZ != null) {
        casterPos = this.toLocal(casterX, casterZ);
      } else if (ev.entityId) {
        const p = this.entityMgr.getEntityPosition(ev.entityId);
        casterPos = p ? p.clone() : new THREE.Vector3(32, 0, 32);
      } else {
        casterPos = new THREE.Vector3(32, 0, 32);
      }

      if (targetX != null && targetZ != null) {
        targetPos = this.toLocal(targetX, targetZ);
      } else if (ev.targetId) {
        const p = this.entityMgr.getEntityPosition(ev.targetId);
        targetPos = p ? p.clone() : casterPos.clone();
      } else {
        targetPos = casterPos.clone();
      }

      // Get class color and id from caster entity
      const casterEnt = ev.entityId ? this.entityMgr.getEntity(ev.entityId) : null;
      const color = entityColor(casterEnt);
      const classId = casterEnt?.classId ?? "";
      const radius = (d.radius as number) ?? 3;

      this.spawnAbility(ev.id, animStyle as AbilityAnim["style"], casterPos, targetPos, color, classId, radius);
    }

    // Prune old event IDs (keep last 200)
    if (this.seenEventIds.size > 400) {
      const arr = Array.from(this.seenEventIds);
      this.seenEventIds = new Set(arr.slice(arr.length - 200));
    }
  }

  private spawnAbility(
    id: string, style: AbilityAnim["style"],
    casterPos: THREE.Vector3, targetPos: THREE.Vector3,
    color: number, classId: string, radius: number,
  ) {
    const isCaster = classId === "mage" || classId === "warlock" || classId === "cleric";
    const anim: AbilityAnim = {
      id, style, elapsed: 0, color, classId, casterPos, targetPos, radius,
      channelNextBurst: 0,
      duration: style === "melee" ? 0.4
        : style === "projectile" ? (isCaster ? 1.0 : 0.8)
        : style === "area" ? 1.0
        : 3.0,
    };

    switch (style) {
      case "melee":
        this.startMelee(anim);
        break;
      case "projectile":
        this.startProjectile(anim);
        break;
      case "area":
        this.startArea(anim);
        break;
      case "channel":
        // Channel starts clean; particles emitted per-frame
        break;
    }

    this.anims.push(anim);
  }

  // ── Melee start ─────────────────────────────────────────────────

  private startMelee(anim: AbilityAnim) {
    const isCaster = anim.classId === "mage" || anim.classId === "warlock" || anim.classId === "cleric";
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3().subVectors(anim.targetPos, anim.casterPos).normalize();
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();

    // Casters: burst of energy at target; melee: slash arc
    const count = isCaster ? 30 : 18;
    const spread = isCaster ? 1.0 : 0.6;
    const size = isCaster ? 0.4 : 0.2;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * (isCaster ? 2 : 1) - Math.PI / 2;
      const offset = new THREE.Vector3()
        .addScaledVector(right, Math.cos(angle) * spread)
        .addScaledVector(up, Math.sin(angle) * spread + 1.0);

      const pos = anim.targetPos.clone().add(offset);
      const vel = offset.clone().multiplyScalar(isCaster ? 3 : 2);
      this.emitParticle(pos, vel, anim.color, size, isCaster ? 0.5 : 0.35);
    }
  }

  // ── Projectile start ────────────────────────────────────────────

  private startProjectile(anim: AbilityAnim) {
    const idx = this.allocProjectile();
    if (idx < 0) return;
    anim.projectileIdx = idx;

    const mesh = this.projectiles[idx];
    mesh.visible = true;
    mesh.position.copy(anim.casterPos).setY(anim.casterPos.y + 1.0);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(anim.color);

    // Class-specific orb scaling and glow color
    const glow = mesh.getObjectByName("glow") as THREE.Mesh | undefined;
    let orbScale = 1.0;
    if (anim.classId === "mage") {
      orbScale = 1.4;   // big arcane bolt
    } else if (anim.classId === "warlock") {
      orbScale = 1.2;   // dark pulsing orb
    } else if (anim.classId === "cleric") {
      orbScale = 1.3;   // radiant sphere
    }
    mesh.scale.setScalar(orbScale);

    if (glow) {
      const glowMat = glow.material as THREE.MeshBasicMaterial;
      glowMat.color.setHex(anim.color);
      glowMat.opacity = 0.35;
    }

    // Initial burst at caster (cast flash)
    if (anim.classId === "mage" || anim.classId === "warlock" || anim.classId === "cleric") {
      this.emitBurst(
        anim.casterPos.clone().setY(anim.casterPos.y + 1.0),
        anim.color, 15, 2.0, 0.3, 0.4,
      );
    }
  }

  // ── Area start ──────────────────────────────────────────────────

  private startArea(anim: AbilityAnim) {
    const idx = this.allocRing();
    if (idx < 0) return;
    anim.ringIdx = idx;

    const mesh = this.rings[idx];
    mesh.visible = true;
    mesh.position.copy(anim.casterPos).setY(anim.casterPos.y + 0.05);
    mesh.scale.setScalar(0.01);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(anim.color);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;
  }

  // ── Sync active effects (persistent auras) ─────────────────────

  syncActiveEffects(entities: Record<string, Entity>) {
    const activeKeys = new Set<string>();

    for (const [entityId, ent] of Object.entries(entities)) {
      if (!ent.activeEffects) continue;
      for (const fx of ent.activeEffects) {
        const key = `${entityId}:${fx.id}`;
        activeKeys.add(key);

        if (!this.auras.has(key)) {
          const aura: AuraState = {
            entityId,
            effectId: fx.id,
            type: fx.type,
            elapsed: 0,
            nextEmit: 0,
          };

          // Allocate shield sphere
          if (fx.type === "shield") {
            const idx = this.allocShield();
            if (idx >= 0) aura.shieldIdx = idx;
          }

          // Store original body color for debuff tint
          if (fx.type === "debuff") {
            const body = this.entityMgr.getBodyMesh(entityId);
            if (body) {
              const mat = body.material as THREE.MeshLambertMaterial;
              aura.originalColor = mat.color.getHex();
            }
          }

          this.auras.set(key, aura);
        }

        // Update shield HP ratio
        const aura = this.auras.get(key)!;
        if (fx.type === "shield" && aura.shieldIdx != null) {
          const mesh = this.shields[aura.shieldIdx];
          const ratio = (fx.shieldHp ?? 0) / (fx.maxShieldHp ?? 1);
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0.1 + ratio * 0.25;
        }
      }
    }

    // Remove expired auras
    for (const [key, aura] of this.auras) {
      if (!activeKeys.has(key)) {
        this.cleanupAura(aura);
        this.auras.delete(key);
      }
    }
  }

  private cleanupAura(aura: AuraState) {
    if (aura.shieldIdx != null) this.freeShield(aura.shieldIdx);

    // Restore original body color for debuff
    if (aura.type === "debuff" && aura.originalColor != null) {
      const body = this.entityMgr.getBodyMesh(aura.entityId);
      if (body) {
        const mat = body.material as THREE.MeshLambertMaterial;
        mat.color.setHex(aura.originalColor);
        if (mat.emissive) {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    }

    // Clear buff glow
    if (aura.type === "buff") {
      const body = this.entityMgr.getBodyMesh(aura.entityId);
      if (body) {
        const mat = body.material as THREE.MeshLambertMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    }
  }

  // ── Frame update ────────────────────────────────────────────────

  update(dt: number) {
    this.updateParticles(dt);
    this.updateAnims(dt);
    this.updateAuras(dt);
  }

  // ── Particle physics ────────────────────────────────────────────

  private updateParticles(dt: number) {
    let needsUpdate = false;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (!this.pAlive[i]) continue;
      needsUpdate = true;

      this.pLifetimes[i * 2] -= dt;
      if (this.pLifetimes[i * 2] <= 0) {
        this.pAlive[i] = 0;
        // Move off-screen
        const i3 = i * 3;
        this.pPositions[i3 + 1] = -100;
        continue;
      }

      const i3 = i * 3;
      // Apply velocity + gravity
      this.pVelocities[i3 + 1] -= 2.0 * dt; // gravity
      this.pPositions[i3] += this.pVelocities[i3] * dt;
      this.pPositions[i3 + 1] += this.pVelocities[i3 + 1] * dt;
      this.pPositions[i3 + 2] += this.pVelocities[i3 + 2] * dt;

      // Fade size
      const lifeRatio = this.pLifetimes[i * 2] / this.pLifetimes[i * 2 + 1];
      this.pSizes[i] *= 0.98 + lifeRatio * 0.02;
    }

    if (needsUpdate) {
      this.particleGeo.attributes.position.needsUpdate = true;
      this.particleGeo.attributes.color.needsUpdate = true;
      this.particleGeo.attributes.size.needsUpdate = true;
    }
  }

  // ── Ability animation updates ───────────────────────────────────

  private updateAnims(dt: number) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const anim = this.anims[i];
      anim.elapsed += dt;
      const t = anim.elapsed / anim.duration;

      if (t >= 1) {
        this.finishAnim(anim);
        this.anims.splice(i, 1);
        continue;
      }

      // Distance check — skip VFX updates for effects far from camera
      if (this.camera) {
        const mid = anim.casterPos.clone().lerp(anim.targetPos, 0.5);
        if (mid.distanceTo(this.camera.position) > 80) continue;
      }

      switch (anim.style) {
        case "melee": this.updateMelee(anim, t); break;
        case "projectile": this.updateProjectile(anim, t); break;
        case "area": this.updateArea(anim, t); break;
        case "channel": this.updateChannel(anim, t, dt); break;
      }
    }
  }

  private updateMelee(anim: AbilityAnim, t: number) {
    const isCaster = anim.classId === "mage" || anim.classId === "warlock" || anim.classId === "cleric";
    // Impact burst at midpoint
    if (t > 0.3 && t < 0.35) {
      this.emitBurst(
        anim.targetPos.clone().setY(anim.targetPos.y + 0.8),
        anim.color,
        isCaster ? 35 : 12,
        isCaster ? 4.5 : 3,
        isCaster ? 0.35 : 0.15,
        isCaster ? 0.5 : 0.3,
      );
    }
  }

  private updateProjectile(anim: AbilityAnim, t: number) {
    if (anim.projectileIdx == null) return;
    const mesh = this.projectiles[anim.projectileIdx];
    const isCaster = anim.classId === "mage" || anim.classId === "warlock" || anim.classId === "cleric";

    // Lerp: travel over first 60% of duration, then impact
    const travelT = Math.min(t / 0.6, 1);
    const eased = travelT * travelT * (3 - 2 * travelT); // smoothstep

    const from = anim.casterPos.clone().setY(anim.casterPos.y + 1.0);
    const to = anim.targetPos.clone().setY(anim.targetPos.y + 1.0);
    const arcHeight = from.distanceTo(to) * (isCaster ? 0.25 : 0.15);
    const pos = from.clone().lerp(to, eased);
    pos.y += arcHeight * 4 * eased * (1 - eased);

    mesh.position.copy(pos);

    // Base scale from startProjectile; shrink on approach, but less for casters
    const baseScale = isCaster ? (anim.classId === "mage" ? 1.4 : anim.classId === "cleric" ? 1.3 : 1.2) : 1.0;
    mesh.scale.setScalar(baseScale * (1 - t * 0.2));

    // Glow halo pulse for casters
    if (isCaster) {
      const glow = mesh.getObjectByName("glow") as THREE.Mesh | undefined;
      if (glow) {
        const pulse = 1.0 + Math.sin(anim.elapsed * 12) * 0.15;
        glow.scale.setScalar(pulse);
        (glow.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(anim.elapsed * 8) * 0.1;
      }
    }

    // Trail particles — casters get dense, large trails
    if (travelT < 1) {
      const trailCount = isCaster ? 4 : 1;
      const trailSize = isCaster ? 0.28 : 0.1;
      const trailLife = isCaster ? 0.5 : 0.3;

      for (let i = 0; i < trailCount; i++) {
        const spread = isCaster ? 1.0 : 0.5;
        const trailVel = new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
        );
        this.emitParticle(pos.clone(), trailVel, anim.color, trailSize, trailLife);
      }

      // Class-specific trail extras
      if (anim.classId === "mage") {
        // Arcane sparks — bright, fast, outward spiral
        const sparkAngle = anim.elapsed * 10 + Math.random() * Math.PI;
        const sparkVel = new THREE.Vector3(
          Math.cos(sparkAngle) * 2.5,
          1.0 + Math.random(),
          Math.sin(sparkAngle) * 2.5,
        );
        this.emitParticle(pos.clone(), sparkVel, 0x88bbff, 0.2, 0.3);
      } else if (anim.classId === "warlock") {
        // Dark wisps — slower, trailing behind, greenish-black
        const wispVel = new THREE.Vector3(
          (Math.random() - 0.5) * 0.8,
          -0.5 + Math.random() * 0.5,
          (Math.random() - 0.5) * 0.8,
        );
        this.emitParticle(pos.clone(), wispVel, 0x115533, 0.35, 0.6);
        this.emitParticle(pos.clone(), wispVel.clone().multiplyScalar(0.5), 0x22dd66, 0.15, 0.4);
      } else if (anim.classId === "cleric") {
        // Holy motes — gentle upward drift, warm white/gold
        const moteVel = new THREE.Vector3(
          (Math.random() - 0.5) * 0.6,
          1.5 + Math.random(),
          (Math.random() - 0.5) * 0.6,
        );
        const moteColor = Math.random() > 0.5 ? 0xffffcc : 0xffddaa;
        this.emitParticle(pos.clone(), moteVel, moteColor, 0.2, 0.5);
      }
    }

    // Impact burst when travel completes
    if (travelT >= 1 && t < 0.65) {
      const impactPos = anim.targetPos.clone().setY(anim.targetPos.y + 0.8);
      if (isCaster) {
        // Big dramatic impact explosion
        this.emitBurst(impactPos, anim.color, 40, 5.0, 0.4, 0.6);
        // Secondary ring of particles outward at ground level
        for (let i = 0; i < 16; i++) {
          const angle = (i / 16) * Math.PI * 2;
          const ringVel = new THREE.Vector3(
            Math.cos(angle) * 3.5,
            0.5,
            Math.sin(angle) * 3.5,
          );
          this.emitParticle(impactPos.clone(), ringVel, anim.color, 0.3, 0.5);
        }
      } else {
        this.emitBurst(impactPos, anim.color, 20, 3.5, 0.18, 0.4);
      }
      mesh.visible = false;
    }
  }

  private updateArea(anim: AbilityAnim, t: number) {
    if (anim.ringIdx == null) return;
    const mesh = this.rings[anim.ringIdx];
    const isCaster = anim.classId === "mage" || anim.classId === "warlock" || anim.classId === "cleric";

    const radius = (anim.radius ?? 3) * COORD_SCALE;
    const scale = t * radius;
    mesh.scale.setScalar(Math.max(0.01, scale));
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);

    // Edge particles along expanding ring — denser and bigger for casters
    const spawnChance = isCaster ? 0.8 : 0.4;
    const particlesPerFrame = isCaster ? 3 : 1;
    for (let p = 0; p < particlesPerFrame; p++) {
      if (Math.random() > spawnChance) continue;
      const angle = Math.random() * Math.PI * 2;
      const r = scale * 0.65;
      const pos = new THREE.Vector3(
        anim.casterPos.x + Math.cos(angle) * r,
        anim.casterPos.y + 0.1,
        anim.casterPos.z + Math.sin(angle) * r,
      );
      const vel = new THREE.Vector3(
        Math.cos(angle) * (isCaster ? 2.5 : 1.5),
        (isCaster ? 3 : 2) + Math.random(),
        Math.sin(angle) * (isCaster ? 2.5 : 1.5),
      );
      this.emitParticle(pos, vel, anim.color, isCaster ? 0.3 : 0.12, isCaster ? 0.7 : 0.5);
    }

    // Casters: fill area with rising column particles
    if (isCaster && Math.random() < 0.6) {
      const fillAngle = Math.random() * Math.PI * 2;
      const fillR = Math.random() * scale * 0.6;
      const fillPos = new THREE.Vector3(
        anim.casterPos.x + Math.cos(fillAngle) * fillR,
        anim.casterPos.y + 0.05,
        anim.casterPos.z + Math.sin(fillAngle) * fillR,
      );
      const fillVel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        3 + Math.random() * 2,
        (Math.random() - 0.5) * 0.5,
      );
      this.emitParticle(fillPos, fillVel, anim.color, 0.25, 0.6);
    }
  }

  private updateChannel(anim: AbilityAnim, t: number, dt: number) {
    anim.channelNextBurst -= dt;
    const isCaster = anim.classId === "mage" || anim.classId === "warlock" || anim.classId === "cleric";

    // Periodic upward particle bursts at caster — bigger for casters
    if (anim.channelNextBurst <= 0) {
      anim.channelNextBurst = isCaster ? 0.3 : 0.5;
      const burstPos = anim.casterPos.clone().setY(anim.casterPos.y + 1.0);
      const burstCount = isCaster ? 14 : 8;
      for (let i = 0; i < burstCount; i++) {
        const vel = new THREE.Vector3(
          (Math.random() - 0.5) * (isCaster ? 2.5 : 1.5),
          2 + Math.random() * (isCaster ? 3 : 2),
          (Math.random() - 0.5) * (isCaster ? 2.5 : 1.5),
        );
        this.emitParticle(burstPos.clone(), vel, anim.color, isCaster ? 0.3 : 0.15, isCaster ? 0.8 : 0.6);
      }
    }

    // Beam: thick particle stream from target → caster
    // Multiple beam particles per frame for casters to form a visible continuous stream
    const beamCount = isCaster ? 5 : 1;
    for (let b = 0; b < beamCount; b++) {
      const beamT = ((t * 5) + b / beamCount * 0.2) % 1;
      const from = anim.targetPos.clone().setY(anim.targetPos.y + 1.0);
      const to = anim.casterPos.clone().setY(anim.casterPos.y + 1.0);
      const beamPos = from.clone().lerp(to, beamT);
      // Add slight helix wobble for casters
      if (isCaster) {
        const wobbleAngle = beamT * Math.PI * 6 + anim.elapsed * 4;
        beamPos.x += Math.cos(wobbleAngle) * 0.15;
        beamPos.y += Math.sin(wobbleAngle) * 0.15;
      }
      const drift = new THREE.Vector3(
        (Math.random() - 0.5) * (isCaster ? 0.5 : 0.3),
        isCaster ? 0.5 : 0.3,
        (Math.random() - 0.5) * (isCaster ? 0.5 : 0.3),
      );
      this.emitParticle(beamPos, drift, anim.color, isCaster ? 0.3 : 0.1, isCaster ? 0.4 : 0.25);
    }

    // Warlock-specific: dark drain motes spiraling from target to caster
    if (anim.classId === "warlock" && Math.random() < 0.5) {
      const drainT = (anim.elapsed * 2) % 1;
      const drainFrom = anim.targetPos.clone().setY(anim.targetPos.y + 1.0);
      const drainTo = anim.casterPos.clone().setY(anim.casterPos.y + 1.0);
      const drainPos = drainFrom.clone().lerp(drainTo, drainT);
      this.emitParticle(drainPos, new THREE.Vector3(0, -0.5, 0), 0x115533, 0.4, 0.5);
    }

    // Pulsing glow on caster body via emissive
    const casterEnt = this.findEntityNear(anim.casterPos);
    if (casterEnt) {
      const body = this.entityMgr.getBodyMesh(casterEnt);
      if (body) {
        const mat = body.material as THREE.MeshLambertMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(anim.color);
          mat.emissiveIntensity = (isCaster ? 0.5 : 0.3) + Math.sin(anim.elapsed * 6) * 0.25;
        }
      }
    }
  }

  private finishAnim(anim: AbilityAnim) {
    if (anim.projectileIdx != null) this.freeProjectile(anim.projectileIdx);
    if (anim.ringIdx != null) this.freeRing(anim.ringIdx);

    // Clear channel emissive
    if (anim.style === "channel") {
      const casterEnt = this.findEntityNear(anim.casterPos);
      if (casterEnt) {
        const body = this.entityMgr.getBodyMesh(casterEnt);
        if (body) {
          const mat = body.material as THREE.MeshLambertMaterial;
          if (mat.emissive) {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
      }
    }
  }

  // ── Aura (persistent effect) updates ────────────────────────────

  private updateAuras(dt: number) {
    for (const aura of this.auras.values()) {
      aura.elapsed += dt;

      const entPos = this.entityMgr.getEntityPosition(aura.entityId);
      if (!entPos) continue;

      // Distance cull
      if (this.camera && entPos.distanceTo(this.camera.position) > 80) continue;

      switch (aura.type) {
        case "buff": this.updateBuffAura(aura, entPos, dt); break;
        case "debuff": this.updateDebuffAura(aura, entPos); break;
        case "dot": this.updateDotAura(aura, entPos, dt); break;
        case "hot": this.updateHotAura(aura, entPos, dt); break;
        case "shield": this.updateShieldAura(aura, entPos); break;
      }
    }
  }

  private updateBuffAura(aura: AuraState, pos: THREE.Vector3, dt: number) {
    aura.nextEmit -= dt;
    if (aura.nextEmit > 0) return;
    aura.nextEmit = 0.15;

    // Gold/green upward drifting particles
    const colors = [0xddcc44, 0x44cc66, 0xeedd55, 0x66dd88];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 0.6,
      0.5 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.6,
    );
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 0.2,
      0.8 + Math.random() * 0.4,
      (Math.random() - 0.5) * 0.2,
    );
    this.emitParticle(pos.clone().add(offset), vel, color, 0.1, 0.8);

    // Glow on body
    const body = this.entityMgr.getBodyMesh(aura.entityId);
    if (body) {
      const mat = body.material as THREE.MeshLambertMaterial;
      if (mat.emissive) {
        mat.emissive.setHex(0x44cc44);
        mat.emissiveIntensity = 0.15 + Math.sin(aura.elapsed * 4) * 0.1;
      }
    }
  }

  private updateDebuffAura(aura: AuraState, pos: THREE.Vector3) {
    // Red/purple tint on body
    const body = this.entityMgr.getBodyMesh(aura.entityId);
    if (body) {
      const mat = body.material as THREE.MeshLambertMaterial;
      if (mat.emissive) {
        mat.emissive.setHex(0x882244);
        mat.emissiveIntensity = 0.2 + Math.sin(aura.elapsed * 3) * 0.1;
      }
    }

    // Slow drip particles
    if (Math.random() < 0.08) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        0.8 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.4,
      );
      const vel = new THREE.Vector3(0, -1.5, 0);
      this.emitParticle(pos.clone().add(offset), vel, 0x882244, 0.08, 0.6);
    }
  }

  private updateDotAura(aura: AuraState, pos: THREE.Vector3, dt: number) {
    aura.nextEmit -= dt;
    if (aura.nextEmit > 0) return;
    aura.nextEmit = 0.5;

    // Red damage particles dripping down
    for (let i = 0; i < 4; i++) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        1.0 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.5,
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        -1.0 - Math.random() * 0.5,
        (Math.random() - 0.5) * 0.3,
      );
      this.emitParticle(pos.clone().add(offset), vel, 0xcc2222, 0.1, 0.6);
    }
  }

  private updateHotAura(aura: AuraState, pos: THREE.Vector3, dt: number) {
    aura.nextEmit -= dt;
    if (aura.nextEmit > 0) return;
    aura.nextEmit = 1.0;

    // Green spiral particles pulsing upward
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + aura.elapsed * 2;
      const r = 0.35;
      const offset = new THREE.Vector3(
        Math.cos(angle) * r,
        0.3 + (i / 6) * 0.8,
        Math.sin(angle) * r,
      );
      const vel = new THREE.Vector3(
        Math.cos(angle) * 0.3,
        1.2,
        Math.sin(angle) * 0.3,
      );
      this.emitParticle(pos.clone().add(offset), vel, 0x44ee66, 0.1, 0.8);
    }
  }

  private updateShieldAura(aura: AuraState, pos: THREE.Vector3) {
    if (aura.shieldIdx == null) return;
    const mesh = this.shields[aura.shieldIdx];
    mesh.visible = true;
    mesh.position.copy(pos).setY(pos.y + 0.8);

    // Pulse opacity
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const baseOpacity = mat.opacity; // set by syncActiveEffects
    mat.opacity = baseOpacity + Math.sin(aura.elapsed * 4) * 0.05;
  }

  // ── Utility ─────────────────────────────────────────────────────

  /** Find entity id closest to a world position */
  private findEntityNear(pos: THREE.Vector3): string | null {
    let best: string | null = null;
    let bestDist = Infinity;
    // Iterate via public methods — check known entity IDs from anims
    for (const anim of this.anims) {
      for (const evId of this.seenEventIds) {
        // We need to find entities near the position; use entity group children
        break;
      }
      break;
    }
    // Fallback: scan all entity groups in the entityMgr scene group
    const entGroup = this.entityMgr.group;
    for (const child of entGroup.children) {
      const eid = child.userData.entityId as string | undefined;
      if (!eid) continue;
      const d = child.position.distanceTo(pos);
      if (d < bestDist && d < 2) {
        bestDist = d;
        best = eid;
      }
    }
    return best;
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  dispose() {
    // Free all pool resources
    for (let i = 0; i < PROJECTILE_POOL; i++) this.freeProjectile(i);
    for (let i = 0; i < RING_POOL; i++) this.freeRing(i);
    for (let i = 0; i < SHIELD_POOL; i++) this.freeShield(i);

    // Clean up auras (restore tints)
    for (const aura of this.auras.values()) {
      this.cleanupAura(aura);
    }
    this.auras.clear();

    // Kill all particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.pAlive[i] = 0;
      this.pPositions[i * 3 + 1] = -100;
    }
    this.particleGeo.attributes.position.needsUpdate = true;

    // Clear animations
    this.anims.length = 0;
    this.seenEventIds.clear();
  }
}
