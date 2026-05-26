import * as THREE from "three";
import type { ZoneEvent, Entity, ElevationProvider } from "../types.js";
import type { EntityManager } from "./EntityManager.js";
import { CLASS_COLORS } from "./EntityManager.js";
import { NO_OUTLINE_LAYER } from "./ToonPipeline.js";

// ── Constants ────────────────────────────────────────────────────────

const PARTICLE_COUNT = 2048;
const PROJECTILE_POOL = 8;
const RING_POOL = 4;
const SHIELD_POOL = 6;
const COORD_SCALE = 1 / 10;

const MOB_COLOR = 0xcc4444;
const BOSS_COLOR = 0xaa33ff;

// ── Per-ability VFX colors ──────────────────────────────────────────
const ABILITY_COLORS: Record<string, number> = {
  // Mage
  mage_fireball: 0xff6622, mage_fireball_r2: 0xff6622, mage_fireball_r3: 0xff4400,
  mage_arcane_missiles: 0x8844ff, mage_arcane_missiles_r2: 0x8844ff,
  mage_slow: 0x66bbff,
  mage_flamestrike: 0xff4400, mage_flamestrike_r2: 0xff3300,
  mage_frost_nova: 0x88ddff,
  mage_frost_armor: 0x66ccff,
  mage_mana_shield: 0x4466ff,
  // Warlock
  warlock_shadow_bolt: 0x6622aa, warlock_shadow_bolt_r2: 0x6622aa, warlock_shadow_bolt_r3: 0x5511aa,
  warlock_curse_of_weakness: 0x884488,
  warlock_drain_life: 0x44aa44, warlock_drain_life_r2: 0x44aa44,
  warlock_corruption: 0x663399, warlock_corruption_r2: 0x663399,
  warlock_howl_of_terror: 0x553366,
  warlock_soul_shield: 0x443366,
  warlock_siphon_soul: 0x338844, warlock_siphon_soul_r2: 0x338844,
  // Cleric
  cleric_holy_light: 0xffdd66, cleric_holy_light_r2: 0xffdd66, cleric_holy_light_r3: 0xffcc33,
  cleric_smite: 0xffee88,
  cleric_renew: 0x66ff88, cleric_renew_r2: 0x66ff88,
  cleric_holy_nova: 0xffffaa,
  cleric_divine_protection: 0xffeecc, cleric_divine_protection_r2: 0xffeecc,
  // Paladin
  paladin_holy_smite: 0xffcc44, paladin_holy_smite_r2: 0xffcc44, paladin_holy_smite_r3: 0xffbb22,
  paladin_consecration: 0xffdd44, paladin_consecration_r2: 0xffdd44,
  paladin_judgment: 0xffaa22,
  paladin_lay_on_hands: 0xffee88, paladin_lay_on_hands_r2: 0xffee88,
  paladin_divine_shield: 0xffffff,
  paladin_blessing_of_might: 0xffcc66,
  paladin_aura_of_resolve: 0xffddaa,
  // Warrior
  warrior_heroic_strike: 0xcc3333, warrior_heroic_strike_r2: 0xcc3333, warrior_heroic_strike_r3: 0xff2222,
  warrior_cleave: 0xcc4422, warrior_cleave_r2: 0xcc4422,
  warrior_intimidating_shout: 0xff6644,
  warrior_shield_wall: 0x8899aa,
  warrior_battle_rage: 0xff4422,
  warrior_battle_rage_r2: 0xff4422,
  warrior_rallying_cry: 0xffaa44,
  warrior_rending_strike: 0xcc2222,
  // Rogue
  rogue_backstab: 0x8833bb, rogue_backstab_r2: 0x8833bb, rogue_backstab_r3: 0x7722aa,
  rogue_poison_blade: 0x44bb44, rogue_poison_blade_r2: 0x44bb44,
  rogue_shadow_strike: 0x553388, rogue_shadow_strike_r2: 0x553388,
  rogue_smoke_bomb: 0x555555,
  rogue_blade_flurry: 0xaaaacc,
  // Ranger
  ranger_aimed_shot: 0x33aa44, ranger_aimed_shot_r2: 0x33aa44, ranger_aimed_shot_r3: 0x22bb33,
  ranger_hunters_mark: 0xff6644,
  ranger_quick_shot: 0x44cc55,
  ranger_multi_shot: 0x33aa44, ranger_multi_shot_r2: 0x33aa44,
  ranger_entangling_roots: 0x558833,
  ranger_volley: 0x66bb55,
  // Monk
  monk_palm_strike: 0xe69628, monk_palm_strike_r2: 0xe69628,
  monk_chi_burst: 0x44ddff, monk_chi_burst_r2: 0x44ddff, monk_chi_burst_r3: 0x22ccff,
  monk_disable: 0xccaa44,
  monk_flying_kick: 0xe6a030,
  monk_whirlwind_kick: 0xe6b040,
};

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
    this.particlePoints.layers.set(NO_OUTLINE_LAYER);
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
      core.layers.set(NO_OUTLINE_LAYER);
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
      mesh.layers.set(NO_OUTLINE_LAYER);
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
      mesh.layers.set(NO_OUTLINE_LAYER);
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

  spawnGatherEffect(pos: THREE.Vector3, gatherType: string) {
    if (gatherType === "mining") {
      this.emitBurst(pos, 0x888888, 8, 2.5, 0.08, 0.8);
      this.emitBurst(pos, 0xccbb99, 6, 1.0, 0.15, 1.2);
      this.emitBurst(pos.clone().setY(pos.y + 0.5), 0xffcc33, 4, 4.0, 0.04, 0.3);
    } else if (gatherType === "herbalism") {
      this.emitBurst(pos, 0xee88cc, 10, 1.5, 0.07, 1.5);
      this.emitBurst(pos, 0x44bb66, 6, 1.2, 0.06, 1.2);
      this.emitBurst(pos.clone().setY(pos.y + 0.3), 0xaaffcc, 5, 2.0, 0.04, 0.6);
    } else if (gatherType === "skinning") {
      this.emitBurst(pos, 0xcc9955, 6, 2.0, 0.07, 0.9);
      this.emitBurst(pos, 0xbbaa88, 4, 0.8, 0.12, 1.0);
    } else if (gatherType === "farming") {
      this.emitBurst(pos, 0x88dd44, 8, 1.2, 0.08, 1.2);
      this.emitBurst(pos, 0xffdd55, 5, 0.8, 0.06, 1.0);
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
      // `ability` = technique/spell cast. `combat` = basic auto-attack.
      // Both need VFX — melee swings for warriors, projectile bolts for casters/rangers.
      // Dodged attacks skip the VFX (no projectile to impact).
      if (ev.type !== "ability" && ev.type !== "combat") continue;
      if (ev.type === "combat" && ev.data?.dodged === true) continue;
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

      // Get ability-specific color, fall back to class color
      const casterEnt = ev.entityId ? this.entityMgr.getEntity(ev.entityId) : null;
      const techniqueId = d.techniqueId as string | undefined;
      const color = (techniqueId && ABILITY_COLORS[techniqueId]) ? ABILITY_COLORS[techniqueId] : entityColor(casterEnt);
      const classId = casterEnt?.classId ?? "";
      const radius = (d.radius as number) ?? 3;

      this.spawnAbility(ev.id, animStyle as AbilityAnim["style"], casterPos, targetPos, color, classId, radius);

      if (classId === "warrior" && techniqueId) {
        this.applyWarriorFlair(techniqueId, casterPos, targetPos, ev.id);
      }
      if (classId === "rogue" && techniqueId) {
        this.applyRogueFlair(techniqueId, casterPos, targetPos, ev.id);
      }
      if (classId === "mage" && techniqueId) {
        this.applyMageFlair(techniqueId, casterPos, targetPos, ev.id);
      }
      if (classId === "warlock" && techniqueId) {
        this.applyWarlockFlair(techniqueId, casterPos, targetPos, ev.id);
      }
      if (classId === "paladin" && techniqueId) {
        this.applyPaladinFlair(techniqueId, casterPos, targetPos, ev.id);
      }
      if (classId === "ranger" && techniqueId) {
        this.applyRangerFlair(techniqueId, casterPos, targetPos, ev.id);
      }
      if (classId === "cleric" && techniqueId) {
        this.applyClericFlair(techniqueId, casterPos, targetPos, ev.id);
      }
      if (classId === "monk" && techniqueId) {
        this.applyMonkFlair(techniqueId, casterPos, targetPos, ev.id);
      }
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

  /**
   * Spawn a one-shot expanding ring on the ground at `pos`. Reuses the same
   * pool/lifecycle as a normal `area` ability by enqueuing a synthetic
   * AbilityAnim. Returns silently if the ring pool is exhausted.
   */
  private spawnGroundRing(pos: THREE.Vector3, color: number, radius: number, duration = 0.7): void {
    const anim: AbilityAnim = {
      id: `flair-${Math.random().toString(36).slice(2)}`,
      style: "area",
      elapsed: 0,
      duration,
      color,
      classId: "",
      casterPos: pos.clone(),
      targetPos: pos.clone(),
      radius,
      channelNextBurst: 0,
    };
    this.startArea(anim);
    this.anims.push(anim);
  }

  /**
   * Per-technique VFX flair for warrior abilities. Layered on top of the
   * default `spawnAbility` visuals so each technique reads as visually
   * distinct without authoring new clips. Strips _r2/_r3/_r4 ranks first
   * so all ranks of the same technique share the same flair.
   */
  private applyWarriorFlair(techniqueId: string, casterPos: THREE.Vector3, targetPos: THREE.Vector3, eventId: string): void {
    const id = techniqueId.replace(/_r[234]$/, "");
    const tgtHead = targetPos.clone().setY(targetPos.y + 1.0);
    const casterHead = casterPos.clone().setY(casterPos.y + 1.0);
    const casterFeet = casterPos.clone().setY(casterPos.y + 0.05);

    switch (id) {
      case "warrior_heroic_strike": {
        // Single bright white-gold impact + small ground ring beneath target.
        this.emitBurst(tgtHead, 0xfff2b0, 22, 5.5, 0.28, 0.4);
        this.spawnGroundRing(targetPos.clone().setY(targetPos.y + 0.05), 0xffd060, 2.5, 0.45);
        break;
      }
      case "warrior_rending_strike": {
        // Three crimson claw streaks tearing horizontally through the target,
        // plus a lingering blood-mist below.
        const up = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos).normalize();
        const right = new THREE.Vector3().crossVectors(dir, up).normalize();
        for (let line = 0; line < 3; line++) {
          const yOff = 0.6 + line * 0.35;
          for (let i = 0; i < 8; i++) {
            const u = (i / 7) - 0.5; // -0.5..+0.5
            const pos = targetPos.clone()
              .addScaledVector(right, u * 1.6)
              .add(new THREE.Vector3(0, yOff, 0));
            const vel = right.clone().multiplyScalar(u > 0 ? 2.5 : -2.5)
              .add(new THREE.Vector3(0, -0.3, 0));
            this.emitParticle(pos, vel, 0xb01020, 0.22, 0.55);
          }
        }
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.3 + Math.random() * 0.6;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.15 + Math.random() * 0.3, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, -0.4, 0), 0x551018, 0.18, 0.9);
        }
        break;
      }
      case "warrior_cleave": {
        // 360° fan of sparks at waist height around the CASTER, swept along
        // a quick arc — sells "I am spinning a blade around me".
        const waist = casterPos.clone().setY(casterPos.y + 0.9);
        const count = 24;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const r = 1.6;
          const pos = waist.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 3.5, 0.3, Math.sin(a) * 3.5);
          this.emitParticle(pos, vel, 0xffcc66, 0.16, 0.35);
        }
        this.spawnGroundRing(casterFeet, 0xffaa44, 3.0, 0.5);
        break;
      }
      case "warrior_shield_wall": {
        // Brief blue ring "snap" at caster + a ring of upward-rising motes
        // that read as a wall of shields locking into place. The persistent
        // glow is handled by the active-effect aura system separately.
        this.spawnGroundRing(casterFeet, 0x5dadec, 2.2, 0.55);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const r = 1.1;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.2, Math.sin(a) * r));
          const vel = new THREE.Vector3(0, 2.2, 0);
          this.emitParticle(pos, vel, 0x9fd1ff, 0.22, 0.7);
        }
        break;
      }
      case "warrior_battle_rage": {
        // Red flame wisps boiling up from caster's shoulders + a brief
        // crimson ground flash. Cast-time only; the buff glow lasts.
        this.spawnGroundRing(casterFeet, 0xff3322, 1.6, 0.4);
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.4 + Math.random() * 0.4;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 1.0 + Math.random() * 0.6, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4);
          this.emitParticle(pos, vel, Math.random() < 0.4 ? 0xffaa22 : 0xcc2211, 0.22, 0.7);
        }
        break;
      }
      case "warrior_intimidating_shout": {
        // Dark-red shockwave ring radiating from caster + scattered black
        // motes falling outward (the sound made visible).
        this.spawnGroundRing(casterFeet, 0x661a1a, 4.5, 0.6);
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2 + Math.random() * 0.15;
          const r = 0.6 + Math.random() * 0.6;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 1.1 + Math.random() * 0.4, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 3.5, 0.4, Math.sin(a) * 3.5);
          this.emitParticle(pos, vel, 0x331010, 0.2, 0.55);
        }
        break;
      }
      case "warrior_rallying_cry": {
        // Bright golden upward pillar + small gold ring at caster's feet —
        // the "banner being raised" feel.
        this.spawnGroundRing(casterFeet, 0xffd860, 2.6, 0.5);
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.7;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.2 + Math.random() * 0.4, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, 3.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.4);
          this.emitParticle(pos, vel, 0xfff0a0, 0.24, 0.9);
        }
        break;
      }
      case "warrior_titans_charge": {
        // Motion-line trail from caster to target — particles laid along the
        // path so it reads as a streaking dash, then a heavy impact dust.
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        dir.normalize();
        const steps = Math.min(20, Math.max(6, Math.floor(dist * 1.2)));
        for (let i = 0; i < steps; i++) {
          const u = i / (steps - 1);
          const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 0.6 + Math.random() * 0.4, 0));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4);
          this.emitParticle(pos, vel, 0xdddddd, 0.22, 0.45);
        }
        // Impact dust at target
        this.emitBurst(targetPos.clone().setY(targetPos.y + 0.2), 0xaa9966, 24, 4.2, 0.3, 0.6);
        break;
      }
      case "warrior_earthquake_slam": {
        // Massive ground ring + brown debris erupting upward at the impact.
        this.spawnGroundRing(targetPos.clone().setY(targetPos.y + 0.05), 0x885522, 7.5, 0.85);
        for (let i = 0; i < 28; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.3 + Math.random() * 1.1;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 1.4, 3.5 + Math.random() * 1.8, Math.sin(a) * 1.4);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0x6b4022 : 0x402815, 0.26, 0.85);
        }
        break;
      }
      case "warrior_undying_rage": {
        // Twin red/gold spiraling columns of motes around the caster — the
        // berserker "aura ignition" frame. Persistent glow comes from the buff.
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 4; // double spiral
          const r = 0.7;
          const y = (i / 24) * 1.8;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a + Math.PI / 2) * 0.8, 0.8, Math.sin(a + Math.PI / 2) * 0.8);
          this.emitParticle(pos, vel, i % 2 === 0 ? 0xff2222 : 0xffcc44, 0.24, 0.8);
        }
        this.spawnGroundRing(casterFeet, 0xff5522, 2.4, 0.6);
        break;
      }
      default:
        // No flair for ranks/aliases we don't recognise — fall through silently.
        void eventId;
    }
  }

  /**
   * Per-technique VFX flair for rogue abilities. The rig has no spell, throw
   * or teleport clip — so blinks, smoke bombs and cloaks are sold entirely by
   * particle bursts and ground rings rather than character motion.
   */
  private applyRogueFlair(techniqueId: string, casterPos: THREE.Vector3, targetPos: THREE.Vector3, eventId: string): void {
    const id = techniqueId.replace(/_r[234]$/, "");
    const tgtCore = targetPos.clone().setY(targetPos.y + 1.0);
    const casterCore = casterPos.clone().setY(casterPos.y + 1.0);
    const casterFeet = casterPos.clone().setY(casterPos.y + 0.05);
    const targetFeet = targetPos.clone().setY(targetPos.y + 0.05);

    switch (id) {
      case "rogue_backstab": {
        // Crimson surgical pinpoint at the back of the target + a short
        // arc of dark-red sparks fanning behind impact.
        this.emitBurst(tgtCore, 0xcc1428, 18, 4.0, 0.22, 0.4);
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i / 9) * Math.PI; // upper hemisphere
          const r = 0.6;
          const pos = tgtCore.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
          this.emitParticle(pos, new THREE.Vector3(0, -1.0, 0), 0x550810, 0.18, 0.55);
        }
        break;
      }
      case "rogue_stealth": {
        // Inky purple smoke swirling upward — the "I'm gone" frame. No
        // mesh swap; just particles that read as dissolve.
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2 + Math.random() * 0.2;
          const r = 0.5 + Math.random() * 0.4;
          const y = 0.2 + Math.random() * 1.6;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 0.5, 1.8 + Math.random() * 0.8, Math.sin(a) * 0.5);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0x281238 : 0x4a2070, 0.28, 1.0);
        }
        this.spawnGroundRing(casterFeet, 0x2a1438, 1.8, 0.45);
        break;
      }
      case "rogue_poison_blade": {
        // Green venom drip falling from the target + a sickly cloud
        // hovering low at their feet.
        for (let i = 0; i < 22; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.2 + Math.random() * 0.7;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4 + Math.random() * 1.1, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.4 - Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0x2bd246 : 0x115522, 0.20, 1.1);
        }
        this.spawnGroundRing(targetFeet, 0x1b8a2a, 1.6, 0.6);
        break;
      }
      case "rogue_evasion": {
        // Three faint white afterimages radiating around the caster — the
        // "you can't hit what you can't catch" frame.
        for (let ring = 0; ring < 3; ring++) {
          const phase = ring * (Math.PI * 2 / 3);
          const r = 0.8 + ring * 0.2;
          for (let i = 0; i < 10; i++) {
            const a = phase + (i / 10) * Math.PI * 2;
            const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.6 + ring * 0.3, Math.sin(a) * r));
            this.emitParticle(pos, new THREE.Vector3(0, 0.4, 0), 0xddddff, 0.18, 0.55);
          }
        }
        break;
      }
      case "rogue_shadow_strike": {
        // Dark puff at the caster + violet streak across to the target,
        // then a black/violet strike burst at impact.
        this.emitBurst(casterCore, 0x180820, 16, 3.0, 0.28, 0.35);
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        dir.normalize();
        const steps = Math.min(14, Math.max(5, Math.floor(dist)));
        for (let i = 0; i < steps; i++) {
          const u = i / (steps - 1);
          const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 0.9, 0));
          this.emitParticle(pos, new THREE.Vector3(0, 0.2, 0), 0x5a1e96, 0.22, 0.35);
        }
        this.emitBurst(tgtCore, 0x6c1ab0, 18, 4.0, 0.24, 0.45);
        break;
      }
      case "rogue_smoke_bomb": {
        // Wide gray fog ring + curling smoke columns hanging in the air.
        this.spawnGroundRing(casterFeet, 0x666666, 5.0, 0.8);
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.3 + Math.random() * 1.8;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 1.2, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0x8a8a8a : 0x4a4a4a, 0.34, 1.4);
        }
        break;
      }
      case "rogue_blade_flurry": {
        // Three quick fanned silver slashes in front of the caster. Each
        // slash = an arc of particles offset by 30° clockwise.
        const up = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos).normalize();
        const right = new THREE.Vector3().crossVectors(dir, up).normalize();
        for (let blade = 0; blade < 3; blade++) {
          const tilt = (blade - 1) * 0.4; // -0.4, 0, +0.4 radians
          for (let i = 0; i < 9; i++) {
            const t = (i / 8) - 0.5;
            const offset = new THREE.Vector3()
              .addScaledVector(right, t * 1.2 + tilt * 0.3)
              .addScaledVector(up, Math.cos(t * Math.PI) * 0.6 + 1.0);
            const pos = targetPos.clone().add(offset);
            const vel = right.clone().multiplyScalar(t > 0 ? 2.0 : -2.0);
            this.emitParticle(pos, vel, 0xdde6ff, 0.18, 0.35);
          }
        }
        break;
      }
      case "rogue_shadowstep_ambush": {
        // Caster dissolves into shadow → reforms behind target. Two puffs +
        // a violet streak connecting them, then a strike burst.
        this.emitBurst(casterCore, 0x180828, 22, 4.2, 0.3, 0.45);
        this.emitBurst(tgtCore, 0x180828, 18, 3.5, 0.28, 0.4);
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        dir.normalize();
        const steps = Math.min(18, Math.max(6, Math.floor(dist * 1.2)));
        for (let i = 0; i < steps; i++) {
          const u = i / (steps - 1);
          const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 1.0, 0));
          this.emitParticle(pos, new THREE.Vector3(0, 0.3, 0), 0x6020c0, 0.24, 0.3);
        }
        this.spawnGroundRing(targetFeet, 0x4015a0, 2.0, 0.4);
        break;
      }
      case "rogue_death_mark": {
        // Crimson rune ring rotates at the target's feet + falling motes
        // forming the silhouette of a skull above them.
        this.spawnGroundRing(targetFeet, 0xa00010, 3.2, 0.9);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const r = 0.7;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 1.4 + Math.random() * 0.6, Math.sin(a) * r));
          const vel = new THREE.Vector3(0, -0.5, 0);
          this.emitParticle(pos, vel, 0xff2030, 0.22, 1.0);
        }
        break;
      }
      case "rogue_phantom_strike": {
        // Pale-blue ghost streak across — long-distance phase lunge. The
        // strike burst is desaturated to read as "ethereal".
        this.emitBurst(casterCore, 0xa0d0ff, 18, 3.0, 0.26, 0.4);
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        dir.normalize();
        const steps = Math.min(28, Math.max(10, Math.floor(dist * 0.9)));
        for (let i = 0; i < steps; i++) {
          const u = i / (steps - 1);
          const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 0.9, 0));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.3, (Math.random() - 0.5) * 0.2);
          this.emitParticle(pos, vel, 0xc8e0ff, 0.22, 0.4);
        }
        this.emitBurst(tgtCore, 0xb0d4ff, 22, 4.0, 0.28, 0.5);
        break;
      }
      case "rogue_deathblow": {
        // The killing blow — a single, oversized black-red impact + ground
        // crack ring. Reserved for the heaviest hit in the kit.
        this.emitBurst(tgtCore, 0x18000a, 40, 5.5, 0.42, 0.7);
        this.emitBurst(tgtCore, 0xa00020, 24, 3.5, 0.34, 0.55);
        this.spawnGroundRing(targetFeet, 0x600810, 4.2, 0.85);
        // Crack-line debris around the target
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const r = 0.4 + Math.random() * 0.8;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 1.0, 1.6 + Math.random() * 0.8, Math.sin(a) * 1.0);
          this.emitParticle(pos, vel, 0x2a0a0a, 0.26, 0.8);
        }
        break;
      }
      case "rogue_living_shadow": {
        // Black tendrils erupt from the target — six radial streaks of
        // dark particles climbing upward, plus a low violet pool.
        this.spawnGroundRing(targetFeet, 0x180828, 3.6, 0.9);
        for (let arm = 0; arm < 6; arm++) {
          const a = (arm / 6) * Math.PI * 2;
          for (let i = 0; i < 8; i++) {
            const r = 0.2 + i * 0.18;
            const y = i * 0.22;
            const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1 + y, Math.sin(a) * r));
            const vel = new THREE.Vector3(Math.cos(a) * 0.3, 1.2 + Math.random() * 0.4, Math.sin(a) * 0.3);
            this.emitParticle(pos, vel, i < 3 ? 0x401466 : 0x080010, 0.24, 1.0);
          }
        }
        break;
      }
      case "rogue_tricks_of_the_trade":
      case "rogue_assassins_mark": {
        // Outward burst of party-buff sparkles around caster — green for
        // tricks, red for the mark.
        const color = id === "rogue_assassins_mark" ? 0xd02040 : 0x40e070;
        this.spawnGroundRing(casterFeet, color, 3.0, 0.6);
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2 + Math.random() * 0.15;
          const r = 0.5;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.8, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 3.5, 0.8, Math.sin(a) * 3.5);
          this.emitParticle(pos, vel, color, 0.22, 0.7);
        }
        break;
      }
      case "rogue_shadow_veil": {
        // Falling violet motes drape over caster — a "cloak descending"
        // read. Quiet, slow, atmospheric.
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 1.2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 2.2 + Math.random() * 0.6, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.8 - Math.random() * 0.3, (Math.random() - 0.5) * 0.2);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0x4020a0 : 0x1a0840, 0.24, 1.4);
        }
        break;
      }
      case "rogue_sharpen_blade":
      case "rogue_shadow_infusion": {
        // Directional stream from caster to ally target — white sparks for
        // sharpen, violet motes for shadow infusion.
        const color = id === "rogue_shadow_infusion" ? 0x6c1ab0 : 0xfff0c0;
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(16, Math.max(5, Math.floor(dist * 1.5)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 1.0, 0));
            this.emitParticle(pos, new THREE.Vector3(0, 0.4, 0), color, 0.20, 0.55);
          }
        }
        this.emitBurst(tgtCore, color, 14, 2.8, 0.22, 0.5);
        break;
      }
      default:
        void eventId;
    }
  }

  /**
   * Per-technique VFX flair for mage abilities. Wizard.glb already has
   * Spell1/Spell2 motions, so the body language is decent — flair adds the
   * element (fire / frost / arcane / time) the rig can't possibly show.
   */
  private applyMageFlair(techniqueId: string, casterPos: THREE.Vector3, targetPos: THREE.Vector3, eventId: string): void {
    const id = techniqueId.replace(/_r[234]$/, "");
    const tgtCore = targetPos.clone().setY(targetPos.y + 1.0);
    const casterCore = casterPos.clone().setY(casterPos.y + 1.0);
    const casterFeet = casterPos.clone().setY(casterPos.y + 0.05);
    const targetFeet = targetPos.clone().setY(targetPos.y + 0.05);

    switch (id) {
      case "mage_fireball": {
        // Orange/red trailing embers behind the standard projectile + a
        // bigger fiery impact burst at target.
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.2 + Math.random() * 0.3;
          const pos = casterCore.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * 0.4, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0xff7a1a : 0xffd24a, 0.24, 0.5);
        }
        this.emitBurst(tgtCore, 0xff5a18, 28, 5.0, 0.32, 0.55);
        break;
      }
      case "mage_frost_armor": {
        // Cyan ice shards forming around the caster — hovering, slowly drifting.
        this.spawnGroundRing(casterFeet, 0x8fdcff, 2.0, 0.6);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const r = 0.7;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4 + Math.random() * 1.0, Math.sin(a) * r));
          const vel = new THREE.Vector3(0, 0.4, 0);
          this.emitParticle(pos, vel, 0xbfeaff, 0.24, 1.0);
        }
        break;
      }
      case "mage_arcane_missiles": {
        // Five quick purple bursts at the target, slightly offset so they
        // read as a barrage rather than one big hit.
        for (let m = 0; m < 5; m++) {
          const a = (m / 5) * Math.PI * 2;
          const off = new THREE.Vector3(Math.cos(a) * 0.4, m * 0.18, Math.sin(a) * 0.4);
          this.emitBurst(tgtCore.clone().add(off), 0xc26aff, 10, 3.0, 0.22, 0.4);
        }
        break;
      }
      case "mage_slow": {
        // Slow-rotating teal/purple ring of motes hovering around target.
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const r = 0.9;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.8 + Math.sin(a * 2) * 0.2, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a + Math.PI / 2) * 0.3, 0.1, Math.sin(a + Math.PI / 2) * 0.3);
          this.emitParticle(pos, vel, i % 2 === 0 ? 0x40d0ff : 0xa080ff, 0.20, 1.2);
        }
        break;
      }
      case "mage_flamestrike": {
        // Column of fire rising from the ground at the target — vertical
        // streaks of orange/yellow particles, plus a scorched ring.
        this.spawnGroundRing(targetFeet, 0xff5a18, 4.5, 0.8);
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 1.4;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.3, 4.0 + Math.random() * 2.0, (Math.random() - 0.5) * 0.3);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0xff8a18 : 0xffd848, 0.28, 0.9);
        }
        break;
      }
      case "mage_frost_nova": {
        // Wide cyan expanding ring around the CASTER + radial ice shards
        // shooting outward at ground level.
        this.spawnGroundRing(casterFeet, 0x6cd9ff, 6.0, 0.7);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.4));
          const vel = new THREE.Vector3(Math.cos(a) * 4.5, 0.4, Math.sin(a) * 4.5);
          this.emitParticle(pos, vel, 0xbfeaff, 0.26, 0.7);
        }
        break;
      }
      case "mage_mana_shield": {
        // Pulsing arcane shield bubble snap (the persistent shield is on the
        // active-effect aura system). Cast-frame: cyan ring + upward motes.
        this.spawnGroundRing(casterFeet, 0x6c9aff, 2.4, 0.55);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const r = 1.0;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.2, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 2.0, 0), 0xa0bfff, 0.24, 0.8);
        }
        break;
      }
      case "mage_glacial_prison": {
        // Cyan ice crystals erupting straight up around the target — the
        // "they're locked in ice" frame. Wide ring + tall stalagmites.
        this.spawnGroundRing(targetFeet, 0x6cd9ff, 5.5, 0.9);
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const r = 0.6 + Math.random() * 1.2;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
          const vel = new THREE.Vector3(0, 4.0 + Math.random() * 1.5, 0);
          this.emitParticle(pos, vel, 0xc0eaff, 0.28, 1.0);
        }
        break;
      }
      case "mage_meteor_strike": {
        // Orange streak from high above falling onto target + huge ground
        // impact (large brown+orange ring) + scorched debris.
        const sky = targetPos.clone().add(new THREE.Vector3(0, 14, 0));
        for (let i = 0; i < 16; i++) {
          const u = i / 15;
          const pos = sky.clone().lerp(targetPos.clone().setY(targetPos.y + 0.5), u);
          this.emitParticle(pos, new THREE.Vector3(0, -2.0, 0), Math.random() < 0.5 ? 0xff6020 : 0xffaa30, 0.30, 0.4);
        }
        this.spawnGroundRing(targetFeet, 0xff5a18, 8.0, 1.0);
        this.emitBurst(tgtCore, 0xff7030, 36, 6.0, 0.36, 0.7);
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          const r = 0.6 + Math.random() * 1.2;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 1.5, 2.0 + Math.random() * 1.2, Math.sin(a) * 1.5);
          this.emitParticle(pos, vel, 0x6a3a18, 0.28, 0.9);
        }
        break;
      }
      case "mage_time_warp": {
        // Golden clock-face spirals — particles arranged on a circle at
        // multiple radii, all rotating outward. A "time bending" read.
        for (let ring = 0; ring < 3; ring++) {
          const r = 0.7 + ring * 0.4;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 + ring * 0.4;
            const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.6 + ring * 0.3, Math.sin(a) * r));
            const vel = new THREE.Vector3(Math.cos(a + Math.PI / 2) * 0.6, 0.6, Math.sin(a + Math.PI / 2) * 0.6);
            this.emitParticle(pos, vel, 0xffd460, 0.24, 1.1);
          }
        }
        break;
      }
      case "mage_arcane_cataclysm": {
        // Tear-reality ultimate — massive purple ring + violent radial
        // burst + sky-falling motes around target.
        this.spawnGroundRing(targetFeet, 0xa040ff, 10.0, 1.1);
        this.emitBurst(tgtCore, 0xb060ff, 50, 6.5, 0.40, 0.75);
        for (let i = 0; i < 28; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.5 + Math.random() * 2.0;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 4.0 + Math.random() * 1.5, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, -2.0, (Math.random() - 0.5) * 0.4);
          this.emitParticle(pos, vel, 0xc080ff, 0.30, 1.0);
        }
        break;
      }
      case "mage_absolute_zero": {
        // World-freezing AoE — wide cyan ring + drifting snow-particles
        // falling uniformly within the radius.
        this.spawnGroundRing(targetFeet, 0xa0e8ff, 7.5, 1.0);
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 3.5;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 2.5 + Math.random() * 1.2, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.1, -0.8 - Math.random() * 0.3, (Math.random() - 0.5) * 0.1);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0xeaf6ff : 0x9fd6ff, 0.24, 1.4);
        }
        break;
      }
      case "mage_arcane_brilliance":
      case "mage_temporal_shift":
      case "mage_arcane_empowerment": {
        // Party-buff radiation — pale arcane motes flying outward.
        const color = id === "mage_temporal_shift" ? 0xffd460 : 0xa080ff;
        this.spawnGroundRing(casterFeet, color, 3.5, 0.6);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5));
          const vel = new THREE.Vector3(Math.cos(a) * 3.5, 1.0, Math.sin(a) * 3.5);
          this.emitParticle(pos, vel, color, 0.22, 0.8);
        }
        break;
      }
      case "mage_arcane_infusion":
      case "mage_chrono_blessing": {
        // Stream from caster to ally — purple for arcane, gold for chrono.
        const color = id === "mage_chrono_blessing" ? 0xffd460 : 0xa080ff;
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(16, Math.max(5, Math.floor(dist * 1.5)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 1.1, 0));
            this.emitParticle(pos, new THREE.Vector3(0, 0.4, 0), color, 0.22, 0.55);
          }
        }
        this.emitBurst(tgtCore, color, 14, 2.8, 0.22, 0.55);
        break;
      }
      default:
        void eventId;
    }
  }

  /**
   * Per-technique VFX flair for warlock abilities. Warlock shares Wizard.glb
   * with mage (dark atlas tint), so motions are identical — the flair leans
   * heavily on shadow/blood/soul motifs to differentiate from arcane.
   */
  private applyWarlockFlair(techniqueId: string, casterPos: THREE.Vector3, targetPos: THREE.Vector3, eventId: string): void {
    const id = techniqueId.replace(/_r[234]$/, "");
    const tgtCore = targetPos.clone().setY(targetPos.y + 1.0);
    const casterCore = casterPos.clone().setY(casterPos.y + 1.0);
    const casterFeet = casterPos.clone().setY(casterPos.y + 0.05);
    const targetFeet = targetPos.clone().setY(targetPos.y + 0.05);

    switch (id) {
      case "warlock_shadow_bolt": {
        // Dark trailing wisps behind the projectile + heavy violet/black
        // impact burst at the target.
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2;
          const pos = casterCore.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, Math.random() * 0.3, Math.sin(a) * 0.3));
          this.emitParticle(pos, new THREE.Vector3(0, 0.4, 0), Math.random() < 0.5 ? 0x180826 : 0x4a1a80, 0.26, 0.6);
        }
        this.emitBurst(tgtCore, 0x6620b0, 28, 4.5, 0.32, 0.6);
        break;
      }
      case "warlock_curse_of_weakness": {
        // Sickly green motes draping the target — clinging, falling slowly.
        this.spawnGroundRing(targetFeet, 0x346a18, 2.6, 0.7);
        for (let i = 0; i < 22; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.3 + Math.random() * 0.7;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 1.5 + Math.random() * 0.6, Math.sin(a) * r));
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.6 - Math.random() * 0.3, (Math.random() - 0.5) * 0.2);
          this.emitParticle(pos, vel, 0x6abf26, 0.24, 1.3);
        }
        break;
      }
      case "warlock_drain_life": {
        // Green tether — particles flowing FROM target TO caster, the
        // "siphoning life" read.
        const dir = new THREE.Vector3().subVectors(casterPos, targetPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(18, Math.max(6, Math.floor(dist * 1.3)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = targetPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 1.0, 0));
            const vel = dir.clone().multiplyScalar(0.5);
            this.emitParticle(pos, vel, Math.random() < 0.5 ? 0x48d860 : 0x1a6020, 0.22, 0.5);
          }
        }
        this.emitBurst(casterCore, 0x60ea70, 12, 2.5, 0.22, 0.5);
        break;
      }
      case "warlock_corruption": {
        // Black tendrils sprouting from target's feet — thin vertical
        // streaks of dark + violet motes erupting upward.
        this.spawnGroundRing(targetFeet, 0x301848, 2.4, 0.6);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const r = 0.5;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 0.3, 1.8 + Math.random() * 0.5, Math.sin(a) * 0.3);
          this.emitParticle(pos, vel, i % 2 === 0 ? 0x0a0010 : 0x5020a0, 0.22, 1.0);
        }
        break;
      }
      case "warlock_howl_of_terror": {
        // Dark sonic ring expanding from caster + radial black-purple motes.
        this.spawnGroundRing(casterFeet, 0x300848, 5.5, 0.7);
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2 + Math.random() * 0.1;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 1.2, Math.sin(a) * 0.5));
          const vel = new THREE.Vector3(Math.cos(a) * 4.0, 0.4, Math.sin(a) * 4.0);
          this.emitParticle(pos, vel, Math.random() < 0.5 ? 0x180828 : 0x5a1a80, 0.24, 0.6);
        }
        break;
      }
      case "warlock_soul_shield": {
        // Dark-purple shield snap — purple ground ring + violet motes
        // wrapping the caster. Persistent shield = active-effect aura.
        this.spawnGroundRing(casterFeet, 0x5a1a90, 2.2, 0.5);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const r = 0.9;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 1.1, Math.sin(a) * r));
          const vel = new THREE.Vector3(0, 1.2 + Math.random() * 0.5, 0);
          this.emitParticle(pos, vel, 0x9040d8, 0.24, 0.9);
        }
        break;
      }
      case "warlock_siphon_soul": {
        // Bigger drain — wide green stream + heal burst returning to caster.
        const dir = new THREE.Vector3().subVectors(casterPos, targetPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(24, Math.max(8, Math.floor(dist * 1.5)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            for (let strand = 0; strand < 2; strand++) {
              const lateral = (strand === 0 ? 0.18 : -0.18);
              const pos = targetPos.clone().addScaledVector(dir, dist * u)
                .add(new THREE.Vector3(-dir.z * lateral, 1.0, dir.x * lateral));
              const vel = dir.clone().multiplyScalar(0.6);
              this.emitParticle(pos, vel, 0x48d860, 0.22, 0.5);
            }
          }
        }
        this.emitBurst(casterCore, 0x80ff90, 18, 3.0, 0.26, 0.6);
        break;
      }
      case "warlock_demonic_grasp": {
        // Demonic hands erupting around target — 5 finger-like streaks of
        // dark motes converging on the target then squeezing inward.
        this.spawnGroundRing(targetFeet, 0x2a0820, 2.8, 0.7);
        for (let finger = 0; finger < 5; finger++) {
          const a = (finger / 5) * Math.PI * 2;
          for (let i = 0; i < 6; i++) {
            const r = 1.6 - i * 0.22;
            const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.6 + i * 0.2, Math.sin(a) * r));
            const vel = new THREE.Vector3(-Math.cos(a) * 0.6, 0.4, -Math.sin(a) * 0.6);
            this.emitParticle(pos, vel, 0x401050, 0.24, 0.8);
          }
        }
        break;
      }
      case "warlock_nether_gate": {
        // Portal-ring at the target's feet + dark beam erupting upward +
        // streak from caster to target.
        this.spawnGroundRing(targetFeet, 0x402080, 3.2, 0.9);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const r = 0.9;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
          const vel = new THREE.Vector3(0, 3.2 + Math.random() * 1.0, 0);
          this.emitParticle(pos, vel, i % 2 === 0 ? 0x4020a0 : 0x180830, 0.26, 1.0);
        }
        break;
      }
      case "warlock_soul_rend": {
        // Multi-target AoE — radial green tendrils from caster outward,
        // representing souls being torn loose. Plus caster heal sparks.
        for (let arm = 0; arm < 8; arm++) {
          const a = (arm / 8) * Math.PI * 2;
          for (let i = 0; i < 6; i++) {
            const r = 0.4 + i * 0.4;
            const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.8 + Math.sin(i) * 0.2, Math.sin(a) * r));
            const vel = new THREE.Vector3(Math.cos(a) * 1.0, 0.4, Math.sin(a) * 1.0);
            this.emitParticle(pos, vel, 0x40d040, 0.22, 0.7);
          }
        }
        this.emitBurst(casterCore, 0x80ff90, 12, 2.5, 0.22, 0.45);
        break;
      }
      case "warlock_doom": {
        // Ominous red rune circle at target — slow, heavy, dread.
        this.spawnGroundRing(targetFeet, 0xa0102a, 3.4, 1.1);
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const r = 1.0;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4 + Math.sin(a * 3) * 0.2, Math.sin(a) * r));
          const vel = new THREE.Vector3(0, 0.2, 0);
          this.emitParticle(pos, vel, 0xc02040, 0.26, 1.4);
        }
        break;
      }
      case "warlock_soul_harvest": {
        // Multi-target reap — wide green ring + multiple souls (motes)
        // flowing in toward the caster from all directions.
        this.spawnGroundRing(casterFeet, 0x40a050, 6.5, 1.0);
        for (let arm = 0; arm < 10; arm++) {
          const a = (arm / 10) * Math.PI * 2;
          const startR = 3.5;
          for (let i = 0; i < 8; i++) {
            const r = startR * (1 - i / 7);
            const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 1.0 + i * 0.1, Math.sin(a) * r));
            const vel = new THREE.Vector3(-Math.cos(a) * 0.6, 0.3, -Math.sin(a) * 0.6);
            this.emitParticle(pos, vel, 0x60e070, 0.24, 0.9);
          }
        }
        break;
      }
      case "warlock_dark_pact":
      case "warlock_soul_link":
      case "warlock_demonic_empowerment": {
        // Party-buff outward sparkle — dark-purple/red depending on flavor.
        const color = id === "warlock_demonic_empowerment" ? 0xff4040 : 0x9040c0;
        this.spawnGroundRing(casterFeet, color, 3.5, 0.6);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5));
          const vel = new THREE.Vector3(Math.cos(a) * 3.5, 0.8, Math.sin(a) * 3.5);
          this.emitParticle(pos, vel, color, 0.22, 0.8);
        }
        break;
      }
      case "warlock_dark_empowerment":
      case "warlock_soul_covenant": {
        // Stream from caster to ally — dark violet for empowerment, blood
        // red for covenant.
        const color = id === "warlock_soul_covenant" ? 0xc0204a : 0x9040c0;
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(16, Math.max(5, Math.floor(dist * 1.5)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 1.1, 0));
            this.emitParticle(pos, new THREE.Vector3(0, 0.3, 0), color, 0.22, 0.55);
          }
        }
        this.emitBurst(tgtCore, color, 14, 2.8, 0.22, 0.55);
        break;
      }
      default:
        void eventId;
    }
  }

  /**
   * Per-technique VFX flair for paladin abilities. Paladin shares Warrior.glb
   * — there are NO spell clips, so every holy ability looks identical bone-
   * wise. Flair carries the entire "holy light" identity.
   */
  private applyPaladinFlair(techniqueId: string, casterPos: THREE.Vector3, targetPos: THREE.Vector3, eventId: string): void {
    const id = techniqueId.replace(/_r[234]$/, "");
    const tgtCore = targetPos.clone().setY(targetPos.y + 1.0);
    const casterCore = casterPos.clone().setY(casterPos.y + 1.0);
    const casterFeet = casterPos.clone().setY(casterPos.y + 0.05);
    const targetFeet = targetPos.clone().setY(targetPos.y + 0.05);

    switch (id) {
      case "paladin_holy_smite": {
        // Golden sword imbued with holy light — bright burst at impact + a
        // sun-like vertical pillar of pale gold rising from target.
        this.emitBurst(tgtCore, 0xfff2b0, 24, 4.5, 0.30, 0.5);
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.4;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 3.0, 0), 0xffe87a, 0.24, 0.7);
        }
        break;
      }
      case "paladin_consecration": {
        // Holy ground — wide golden ring at target's feet + slow rising
        // motes filling the consecrated zone.
        this.spawnGroundRing(targetFeet, 0xffd860, 5.0, 0.9);
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 1.8;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 1.8 + Math.random() * 0.5, 0), 0xfff2a0, 0.22, 1.2);
        }
        break;
      }
      case "paladin_judgment": {
        // Vertical lightning-of-light strike from sky onto target.
        const sky = targetPos.clone().add(new THREE.Vector3(0, 10, 0));
        for (let i = 0; i < 14; i++) {
          const u = i / 13;
          const pos = sky.clone().lerp(targetPos.clone().setY(targetPos.y + 0.4), u);
          this.emitParticle(pos, new THREE.Vector3(0, -1.5, 0), 0xfff8c0, 0.30, 0.35);
        }
        this.spawnGroundRing(targetFeet, 0xfff060, 2.4, 0.5);
        break;
      }
      case "paladin_lay_on_hands": {
        // Cupped golden glow at the caster (self-heal) — gentle upward
        // motes + small ring.
        this.spawnGroundRing(casterFeet, 0xfff2a0, 2.0, 0.55);
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.5;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4 + Math.random() * 0.8, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 1.4, 0), 0xfff2a0, 0.22, 1.1);
        }
        break;
      }
      case "paladin_divine_shield":
      case "paladin_divine_bulwark":
      case "paladin_hand_of_god": {
        // Brilliant white-gold shield snap — bigger ring for bulwark/hand
        // since they're tier-4+ ultimates.
        const big = id !== "paladin_divine_shield";
        this.spawnGroundRing(casterFeet, 0xfff0b0, big ? 3.6 : 2.4, 0.7);
        for (let i = 0; i < (big ? 26 : 16); i++) {
          const a = (i / (big ? 26 : 16)) * Math.PI * 2;
          const r = big ? 1.4 : 1.0;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4 + Math.random() * 1.0, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 1.4, 0), 0xfff8c0, 0.24, 0.9);
        }
        break;
      }
      case "paladin_blessing_of_might":
      case "paladin_aura_of_resolve":
      case "paladin_blessing_of_kings":
      case "paladin_aura_of_devotion":
      case "paladin_divine_aegis": {
        // Outward golden sparkle wave for party/aura buffs.
        this.spawnGroundRing(casterFeet, 0xffd860, 3.5, 0.6);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5));
          const vel = new THREE.Vector3(Math.cos(a) * 3.0, 1.0, Math.sin(a) * 3.0);
          this.emitParticle(pos, vel, 0xfff2a0, 0.22, 0.8);
        }
        break;
      }
      case "paladin_hammer_of_justice": {
        // Hammer-of-light slamming onto target — bright vertical pillar +
        // shockwave ring + radial impact.
        const sky = targetPos.clone().add(new THREE.Vector3(0, 6, 0));
        for (let i = 0; i < 14; i++) {
          const u = i / 13;
          const pos = sky.clone().lerp(targetPos.clone().setY(targetPos.y + 0.3), u);
          this.emitParticle(pos, new THREE.Vector3(0, -2.0, 0), 0xfff0a0, 0.32, 0.35);
        }
        this.spawnGroundRing(targetFeet, 0xffe060, 4.5, 0.8);
        this.emitBurst(tgtCore, 0xfff8c0, 26, 4.5, 0.34, 0.55);
        break;
      }
      case "paladin_wings_of_valor": {
        // Golden wings unfurling — two arcs of motes sweeping out laterally
        // from the caster's back, plus an upward shaft of light.
        const up = new THREE.Vector3(0, 1, 0);
        for (let wing = -1; wing <= 1; wing += 2) {
          const side = new THREE.Vector3(wing, 0, 0);
          for (let i = 0; i < 14; i++) {
            const u = i / 13;
            const off = side.clone().multiplyScalar(0.4 + u * 1.6)
              .add(up.clone().multiplyScalar(1.0 + Math.sin(u * Math.PI) * 1.2));
            const pos = casterPos.clone().add(off);
            this.emitParticle(pos, new THREE.Vector3(wing * 0.3, 0.6, 0), 0xfff0a0, 0.26, 1.0);
          }
        }
        this.spawnGroundRing(casterFeet, 0xfff060, 3.2, 0.6);
        break;
      }
      case "paladin_wrath_of_the_righteous": {
        // Divine apocalypse — huge ground ring + radial pillars of light
        // shooting outward.
        this.spawnGroundRing(casterFeet, 0xfff060, 9.0, 1.0);
        for (let pillar = 0; pillar < 8; pillar++) {
          const a = (pillar / 8) * Math.PI * 2;
          for (let i = 0; i < 8; i++) {
            const r = 0.4 + i * 0.5;
            const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
            const vel = new THREE.Vector3(0, 4.0 + Math.random() * 1.0, 0);
            this.emitParticle(pos, vel, 0xfff8c0, 0.28, 0.8);
          }
        }
        break;
      }
      case "paladin_blessing_of_protection":
      case "paladin_blessing_of_sanctuary": {
        // Golden stream to ally + small shield burst at impact.
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(16, Math.max(5, Math.floor(dist * 1.5)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 1.1, 0));
            this.emitParticle(pos, new THREE.Vector3(0, 0.4, 0), 0xfff2a0, 0.22, 0.55);
          }
        }
        this.emitBurst(tgtCore, 0xfff8c0, 16, 2.8, 0.24, 0.6);
        break;
      }
      default:
        void eventId;
    }
  }

  /**
   * Per-technique VFX flair for ranger abilities. Ranger has Bow_Draw and
   * Bow_Shoot, so attack motions are good. The nature/buff side leans on
   * Idle_Weapon (bow held) + VFX to sell "nature magic".
   */
  private applyRangerFlair(techniqueId: string, casterPos: THREE.Vector3, targetPos: THREE.Vector3, eventId: string): void {
    const id = techniqueId.replace(/_r[234]$/, "");
    const tgtCore = targetPos.clone().setY(targetPos.y + 1.0);
    const casterFeet = casterPos.clone().setY(casterPos.y + 0.05);
    const targetFeet = targetPos.clone().setY(targetPos.y + 0.05);

    switch (id) {
      case "ranger_aimed_shot": {
        // Focus-lines snapping inward to the target right before the
        // standard projectile + a sharp impact burst.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const r = 2.2;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 1.0, Math.sin(a) * r));
          const vel = new THREE.Vector3(-Math.cos(a) * 5.5, 0, -Math.sin(a) * 5.5);
          this.emitParticle(pos, vel, 0xeae5d4, 0.22, 0.35);
        }
        this.emitBurst(tgtCore, 0xeae5d4, 20, 4.5, 0.26, 0.45);
        break;
      }
      case "ranger_quick_shot": {
        // Light, fast — a streaking line of white motes from caster to
        // target, then a tiny impact pop.
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(10, Math.max(3, Math.floor(dist * 0.8)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 0.9, 0));
            this.emitParticle(pos, new THREE.Vector3(0, 0.1, 0), 0xf2efdc, 0.18, 0.3);
          }
        }
        this.emitBurst(tgtCore, 0xeae5d4, 10, 2.8, 0.18, 0.35);
        break;
      }
      case "ranger_multi_shot": {
        // Fan of 4 arrows — projectile-line bursts to slightly different
        // positions around the target.
        for (let arrow = 0; arrow < 4; arrow++) {
          const off = new THREE.Vector3((arrow - 1.5) * 0.6, arrow * 0.18, 0);
          this.emitBurst(tgtCore.clone().add(off), 0xeae5d4, 8, 3.0, 0.20, 0.4);
        }
        break;
      }
      case "ranger_volley":
      case "ranger_storm_of_arrows":
      case "ranger_heavens_volley": {
        // Rain of arrows — particles streaking down from the sky over a
        // wide radius around the target. Heavens volley = biggest area.
        const radius = id === "ranger_heavens_volley" ? 4.5 : id === "ranger_storm_of_arrows" ? 3.5 : 2.5;
        const count = id === "ranger_heavens_volley" ? 36 : id === "ranger_storm_of_arrows" ? 28 : 22;
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * radius;
          const ground = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
          const high = ground.clone().setY(ground.y + 6 + Math.random() * 3);
          this.emitParticle(high, new THREE.Vector3(0, -8.0, 0), 0xeae5d4, 0.18, 0.6);
          this.emitParticle(ground, new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4), 0x8a7050, 0.18, 0.5);
        }
        this.spawnGroundRing(targetFeet, 0x8a7050, radius * 1.6, 0.9);
        break;
      }
      case "ranger_hunters_mark": {
        // Red reticle ring around target — slow, persistent feel.
        this.spawnGroundRing(targetFeet, 0xff3030, 2.4, 0.7);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const r = 0.8;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 1.0, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 0, 0), 0xff3030, 0.20, 1.2);
        }
        break;
      }
      case "ranger_entangling_roots": {
        // Green vine-shaped streaks rising around target's feet — eight
        // radial streaks twisting upward.
        this.spawnGroundRing(targetFeet, 0x2a8a30, 2.2, 0.8);
        for (let vine = 0; vine < 8; vine++) {
          const a = (vine / 8) * Math.PI * 2;
          for (let i = 0; i < 6; i++) {
            const r = 0.5 + Math.sin(i) * 0.15;
            const y = i * 0.25;
            const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05 + y, Math.sin(a) * r));
            const vel = new THREE.Vector3(Math.cos(a) * 0.2, 0.5, Math.sin(a) * 0.2);
            this.emitParticle(pos, vel, i % 2 === 0 ? 0x2a8a30 : 0x66c060, 0.24, 1.0);
          }
        }
        break;
      }
      case "ranger_natures_blessing":
      case "ranger_natures_vigil": {
        // Soft green sparkles + small leaf-like ring at target.
        const isParty = id === "ranger_natures_vigil";
        const ringPos = isParty ? casterFeet : targetFeet;
        this.spawnGroundRing(ringPos, 0x66c060, isParty ? 3.5 : 2.0, 0.7);
        for (let i = 0; i < (isParty ? 24 : 16); i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * (isParty ? 1.4 : 0.7);
          const base = isParty ? casterPos : targetPos;
          const pos = base.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 0.8, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.9, (Math.random() - 0.5) * 0.2), 0x88e878, 0.22, 1.0);
        }
        break;
      }
      case "ranger_sky_piercer":
      case "ranger_arrow_of_judgment": {
        // Single massive arrow — glowing trail from caster + huge impact.
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(28, Math.max(8, Math.floor(dist)));
          const color = id === "ranger_arrow_of_judgment" ? 0xfff060 : 0xa0e0ff;
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 1.0, 0));
            this.emitParticle(pos, new THREE.Vector3(0, 0.3, 0), color, 0.26, 0.4);
          }
          this.emitBurst(tgtCore, color, 30, 4.5, 0.32, 0.55);
        }
        break;
      }
      case "ranger_falcon_dive": {
        // Falcon-dive arc — particles tracing an aerial arc from above-
        // caster down onto target. Plus impact burst.
        const start = casterPos.clone().add(new THREE.Vector3(0, 5, 0));
        const ctrl = casterPos.clone().lerp(targetPos, 0.5).add(new THREE.Vector3(0, 8, 0));
        const end = targetPos.clone().add(new THREE.Vector3(0, 0.5, 0));
        const segs = 18;
        for (let i = 0; i < segs; i++) {
          const u = i / (segs - 1);
          // quadratic Bezier on the fly
          const oneMinusU = 1 - u;
          const x = oneMinusU * oneMinusU * start.x + 2 * oneMinusU * u * ctrl.x + u * u * end.x;
          const y = oneMinusU * oneMinusU * start.y + 2 * oneMinusU * u * ctrl.y + u * u * end.y;
          const z = oneMinusU * oneMinusU * start.z + 2 * oneMinusU * u * ctrl.z + u * u * end.z;
          this.emitParticle(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, 0), 0xddeeff, 0.22, 0.5);
        }
        this.emitBurst(tgtCore, 0xa0c0e0, 20, 4.0, 0.28, 0.55);
        break;
      }
      case "ranger_pack_tactics":
      case "ranger_predators_instinct":
      case "ranger_eagle_eye":
      case "ranger_bond_of_the_wild": {
        // Earthy green outward sparkle for nature buffs.
        this.spawnGroundRing(casterFeet, 0x66c060, 3.2, 0.6);
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5));
          const vel = new THREE.Vector3(Math.cos(a) * 3.0, 0.8, Math.sin(a) * 3.0);
          this.emitParticle(pos, vel, 0x88e878, 0.22, 0.75);
        }
        break;
      }
      default:
        void eventId;
    }
  }

  /**
   * Per-technique VFX flair for cleric abilities. Cleric.glb has only Spell1
   * (no Spell2, no Idle_Attacking) — every cast looks identical bone-wise,
   * so VFX is doing 100% of the work to differentiate heals / smites /
   * shields / AoEs.
   */
  private applyClericFlair(techniqueId: string, casterPos: THREE.Vector3, targetPos: THREE.Vector3, eventId: string): void {
    const id = techniqueId.replace(/_r[234]$/, "");
    const tgtCore = targetPos.clone().setY(targetPos.y + 1.0);
    const casterFeet = casterPos.clone().setY(casterPos.y + 0.05);
    const targetFeet = targetPos.clone().setY(targetPos.y + 0.05);

    switch (id) {
      case "cleric_holy_light": {
        // Big golden cross-glow at target — bright burst + slow upward motes.
        this.emitBurst(tgtCore, 0xfff2b0, 22, 3.5, 0.30, 0.55);
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.5;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.5 + Math.random() * 0.6, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 1.4, 0), 0xfff8d0, 0.22, 1.0);
        }
        break;
      }
      case "cleric_smite":
      case "cleric_wrath_of_heaven":
      case "cleric_wrath_of_the_divine": {
        // Vertical lightning-of-light strike. Wrath variants get a much
        // bigger ground ring and impact than basic smite.
        const big = id !== "cleric_smite";
        const sky = targetPos.clone().add(new THREE.Vector3(0, big ? 12 : 8, 0));
        const steps = big ? 18 : 12;
        for (let i = 0; i < steps; i++) {
          const u = i / (steps - 1);
          const pos = sky.clone().lerp(targetPos.clone().setY(targetPos.y + 0.4), u);
          this.emitParticle(pos, new THREE.Vector3(0, -1.5, 0), 0xfffae6, 0.30, 0.35);
        }
        this.spawnGroundRing(targetFeet, 0xfff060, big ? 6.5 : 2.4, big ? 0.95 : 0.5);
        this.emitBurst(tgtCore, 0xfff8c0, big ? 32 : 16, big ? 5.0 : 3.5, 0.30, 0.55);
        break;
      }
      case "cleric_renew":
      case "cleric_greater_renew": {
        // Slow gentle green-gold heal motes rising around target.
        this.spawnGroundRing(targetFeet, 0xa6e87a, 2.2, 0.7);
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.7;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4 + Math.random() * 0.8, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 1.2, 0), Math.random() < 0.5 ? 0xa6e87a : 0xfff2a0, 0.22, 1.2);
        }
        break;
      }
      case "cleric_holy_nova": {
        // Caster-centered AoE — wide gold ring + radial outward sparkle.
        this.spawnGroundRing(casterFeet, 0xfff060, 5.0, 0.8);
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.6, Math.sin(a) * 0.4));
          const vel = new THREE.Vector3(Math.cos(a) * 4.0, 0.6, Math.sin(a) * 4.0);
          this.emitParticle(pos, vel, 0xfff8c0, 0.24, 0.7);
        }
        break;
      }
      case "cleric_divine_protection":
      case "cleric_guardian_angel":
      case "cleric_divine_intervention": {
        // Shield snap + protective wings of light unfurling around target.
        // Bigger and more dramatic for the tier-4/6 variants.
        const big = id !== "cleric_divine_protection";
        this.spawnGroundRing(targetFeet, 0xfff0a0, big ? 3.4 : 2.2, 0.7);
        for (let i = 0; i < (big ? 22 : 14); i++) {
          const a = (i / (big ? 22 : 14)) * Math.PI * 2;
          const r = big ? 1.4 : 1.0;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4 + Math.random() * 1.2, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 1.5, 0), 0xfff8c0, 0.24, 0.9);
        }
        break;
      }
      case "cleric_prayer_of_fortitude":
      case "cleric_spirit_of_redemption":
      case "cleric_blessing_of_light": {
        // Self-buff radiant ring with rising motes.
        this.spawnGroundRing(casterFeet, 0xfff0a0, 2.6, 0.6);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const r = 0.7;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 1.8, 0), 0xfff2a0, 0.22, 1.0);
        }
        break;
      }
      case "cleric_divine_hymn": {
        // Sustained hymn — concentric expanding waves from caster + slowly
        // rising motes in a wide column.
        this.spawnGroundRing(casterFeet, 0xfff060, 4.5, 1.0);
        for (let i = 0; i < 28; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 1.6;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 1.4, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.9, (Math.random() - 0.5) * 0.2), 0xfff8c0, 0.24, 1.3);
        }
        break;
      }
      case "cleric_prayer_of_healing":
      case "cleric_sanctuary":
      case "cleric_divine_chorus": {
        // Party heal/shield — wide gold ring + outward radiant sparkles.
        this.spawnGroundRing(casterFeet, 0xfff060, 4.0, 0.7);
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5));
          const vel = new THREE.Vector3(Math.cos(a) * 3.0, 0.9, Math.sin(a) * 3.0);
          this.emitParticle(pos, vel, 0xfff8d0, 0.22, 0.85);
        }
        break;
      }
      default:
        void eventId;
    }
  }

  /**
   * Per-technique VFX flair for monk abilities. Only Attack and Attack2
   * exist on Monk.glb — flair has to do the heavy lifting for chi/spirit
   * abilities.
   */
  private applyMonkFlair(techniqueId: string, casterPos: THREE.Vector3, targetPos: THREE.Vector3, eventId: string): void {
    const id = techniqueId.replace(/_r[234]$/, "");
    const tgtCore = targetPos.clone().setY(targetPos.y + 1.0);
    const casterCore = casterPos.clone().setY(casterPos.y + 1.0);
    const casterFeet = casterPos.clone().setY(casterPos.y + 0.05);
    const targetFeet = targetPos.clone().setY(targetPos.y + 0.05);

    switch (id) {
      case "monk_palm_strike": {
        // Tight cyan/teal chi pulse at impact — quick, surgical.
        this.emitBurst(tgtCore, 0x40e0d0, 18, 3.5, 0.24, 0.4);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const pos = tgtCore.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0));
          this.emitParticle(pos, new THREE.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5), 0x80f0e0, 0.20, 0.45);
        }
        break;
      }
      case "monk_disable": {
        // Cyan ring around target's feet + slow drifting motes — restraint.
        this.spawnGroundRing(targetFeet, 0x40b0d0, 2.0, 0.7);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const r = 0.8;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.4, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 0.3, 0), 0x80c8e0, 0.22, 1.1);
        }
        break;
      }
      case "monk_chi_burst": {
        // Cyan energy ball detonating at target — bright wide burst.
        this.emitBurst(tgtCore, 0x40e0d0, 32, 5.5, 0.32, 0.6);
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.3 + Math.random() * 0.8;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.5 + Math.random() * 1.0, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(Math.cos(a) * 2.0, 1.2, Math.sin(a) * 2.0), 0x80f0e0, 0.26, 0.7);
        }
        break;
      }
      case "monk_flying_kick": {
        // Streak from caster toward target + impact swoosh of teal motes.
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(14, Math.max(5, Math.floor(dist)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 0.9, 0));
            this.emitParticle(pos, new THREE.Vector3(0, 0.3, 0), 0x80f0e0, 0.22, 0.4);
          }
        }
        this.emitBurst(tgtCore, 0x40e0d0, 20, 4.0, 0.26, 0.5);
        break;
      }
      case "monk_whirlwind_kick": {
        // 360° sweep of teal motes around the CASTER at waist height.
        const waist = casterPos.clone().setY(casterPos.y + 0.9);
        const count = 28;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const r = 1.6;
          const pos = waist.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a) * 3.5, 0.3, Math.sin(a) * 3.5);
          this.emitParticle(pos, vel, 0x60e8d8, 0.20, 0.45);
        }
        this.spawnGroundRing(casterFeet, 0x40b0d0, 3.0, 0.5);
        break;
      }
      case "monk_meditation":
      case "monk_inner_focus":
      case "monk_inner_peace":
      case "monk_perfect_balance": {
        // Self-channel — slow concentric ring + glow column around caster.
        const big = id === "monk_inner_peace" || id === "monk_perfect_balance";
        this.spawnGroundRing(casterFeet, 0x80e8d8, big ? 3.0 : 2.0, big ? 0.9 : 0.7);
        for (let i = 0; i < (big ? 22 : 14); i++) {
          const a = (i / (big ? 22 : 14)) * Math.PI * 2;
          const r = 0.6;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 1.4, Math.sin(a) * r));
          this.emitParticle(pos, new THREE.Vector3(0, 1.0 + Math.random() * 0.4, 0), 0xc0f8ee, 0.22, 1.2);
        }
        break;
      }
      case "monk_hundred_fists": {
        // Rapid flurry — 6 quick small bursts in a tight cluster at target.
        for (let i = 0; i < 6; i++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.7);
          this.emitBurst(tgtCore.clone().add(off), 0x80f0e0, 8, 2.5, 0.20, 0.3);
        }
        break;
      }
      case "monk_dragon_strike": {
        // Heaviest hit — golden-teal dragon's-fang impact + spiral motes.
        this.emitBurst(tgtCore, 0xffd860, 30, 5.0, 0.34, 0.6);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 3;
          const r = 0.4 + (i / 24) * 1.4;
          const y = (i / 24) * 2.0;
          const pos = targetPos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.2 + y, Math.sin(a) * r));
          const vel = new THREE.Vector3(Math.cos(a + Math.PI / 2) * 1.2, 0.6, Math.sin(a + Math.PI / 2) * 1.2);
          this.emitParticle(pos, vel, i % 2 === 0 ? 0xffe080 : 0x40e0d0, 0.26, 0.9);
        }
        break;
      }
      case "monk_one_thousand_palms": {
        // Ultimate — huge cyan/gold explosion + many small bursts in front
        // of the caster filling a cone.
        const up = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos).normalize();
        const right = new THREE.Vector3().crossVectors(dir, up).normalize();
        for (let i = 0; i < 14; i++) {
          const lateral = (Math.random() - 0.5) * 2.0;
          const forward = 0.5 + Math.random() * 3.0;
          const yOff = 0.3 + Math.random() * 1.4;
          const pos = casterPos.clone().addScaledVector(dir, forward).addScaledVector(right, lateral).setY(casterPos.y + yOff);
          this.emitBurst(pos, i % 2 === 0 ? 0xffd860 : 0x80f0e0, 6, 2.5, 0.22, 0.35);
        }
        this.emitBurst(tgtCore, 0xfff060, 30, 5.0, 0.36, 0.65);
        break;
      }
      case "monk_windwalkers_grace":
      case "monk_zen_meditation":
      case "monk_transcendence": {
        // Party buff — teal sparkle wave outward.
        const big = id === "monk_transcendence";
        this.spawnGroundRing(casterFeet, 0x80e8d8, big ? 4.5 : 3.5, 0.7);
        for (let i = 0; i < (big ? 28 : 22); i++) {
          const a = (i / (big ? 28 : 22)) * Math.PI * 2;
          const pos = casterPos.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5));
          const vel = new THREE.Vector3(Math.cos(a) * 3.5, 0.9, Math.sin(a) * 3.5);
          this.emitParticle(pos, vel, 0xc0f8ee, 0.22, 0.85);
        }
        // Re-anchor to silence unused warning when only the party branch runs
        void casterCore;
        break;
      }
      case "monk_chi_attunement":
      case "monk_spirit_bond": {
        // Stream from caster to ally — teal sparkles.
        const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          const steps = Math.min(16, Math.max(5, Math.floor(dist * 1.5)));
          for (let i = 0; i < steps; i++) {
            const u = i / (steps - 1);
            const pos = casterPos.clone().addScaledVector(dir, dist * u).add(new THREE.Vector3(0, 1.1, 0));
            this.emitParticle(pos, new THREE.Vector3(0, 0.4, 0), 0x80f0e0, 0.22, 0.55);
          }
        }
        this.emitBurst(tgtCore, 0xa0f8e8, 14, 2.8, 0.22, 0.55);
        break;
      }
      default:
        void eventId;
    }
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
    aura.nextEmit = 0.12;

    // Effect-specific colors based on buff name
    const n = aura.effectId.toLowerCase();
    let particleColor: number;
    let glowColor: number;

    if (n.includes("frost") || n.includes("ice") || n.includes("mana")) {
      // Frost/mana — icy blue
      const iceColors = [0x66ccff, 0x88ddff, 0x44aaee, 0xaaeeff];
      particleColor = iceColors[Math.floor(Math.random() * iceColors.length)];
      glowColor = 0x44aaff;
    } else if (n.includes("divine") || n.includes("holy") || n.includes("blessing") || n.includes("prayer") || n.includes("aura")) {
      // Holy — golden white
      const holyColors = [0xffeeaa, 0xffffcc, 0xffdd88, 0xffffff];
      particleColor = holyColors[Math.floor(Math.random() * holyColors.length)];
      glowColor = 0xffdd66;
    } else if (n.includes("rage") || n.includes("rallying") || n.includes("might")) {
      // Warrior rage — fiery red/orange
      const rageColors = [0xff4422, 0xff6644, 0xffaa33, 0xff3311];
      particleColor = rageColors[Math.floor(Math.random() * rageColors.length)];
      glowColor = 0xff4422;
    } else if (n.includes("shadow") || n.includes("soul") || n.includes("dark")) {
      // Dark — purple/shadow
      const darkColors = [0x6622aa, 0x8844cc, 0x553399, 0x7733bb];
      particleColor = darkColors[Math.floor(Math.random() * darkColors.length)];
      glowColor = 0x6622aa;
    } else if (n.includes("stealth") || n.includes("evasion") || n.includes("smoke")) {
      // Rogue — faint grey/silver
      const stealthColors = [0x888899, 0xaaaabb, 0x777788, 0x999999];
      particleColor = stealthColors[Math.floor(Math.random() * stealthColors.length)];
      glowColor = 0x888899;
    } else if (n.includes("nature") || n.includes("renew") || n.includes("meditation") || n.includes("inner")) {
      // Nature/monk — green/teal
      const natureColors = [0x44dd66, 0x66ee88, 0x33cc55, 0x88ffaa];
      particleColor = natureColors[Math.floor(Math.random() * natureColors.length)];
      glowColor = 0x44cc66;
    } else {
      // Default — gold/green
      const defaultColors = [0xddcc44, 0x44cc66, 0xeedd55, 0x66dd88];
      particleColor = defaultColors[Math.floor(Math.random() * defaultColors.length)];
      glowColor = 0x44cc44;
    }

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
    this.emitParticle(pos.clone().add(offset), vel, particleColor, 0.12, 0.8);

    // Glow on body
    const body = this.entityMgr.getBodyMesh(aura.entityId);
    if (body) {
      const mat = body.material as THREE.MeshToonMaterial;
      if (mat.emissive) {
        mat.emissive.setHex(glowColor);
        mat.emissiveIntensity = 0.18 + Math.sin(aura.elapsed * 4) * 0.12;
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
