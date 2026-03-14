import * as THREE from "three";
import type { Entity } from "../types.js";
import type { TerrainRenderer } from "./TerrainRenderer.js";

// ── Appearance color maps (matched to actual server values) ─────────

const SKIN_COLORS: Record<string, number> = {
  pale: 0xfde0c8, fair: 0xf5d0b0, light: 0xf5c8a0, medium: 0xd4a574,
  tan: 0xc49560, olive: 0xb08850, brown: 0x8b5e3c, dark: 0x6b4226,
};

const HAIR_COLORS: Record<string, number> = {
  short: 0x4a3728, long: 0xc4a46e, mohawk: 0xcc2222,
  ponytail: 0x1a1a2e, braided: 0x7a5530, bald: 0x000000,
};

const EYE_COLORS: Record<string, number> = {
  brown: 0x6b3a1f, blue: 0x3388dd, green: 0x33aa44, gold: 0xddaa22,
  amber: 0xcc8822, gray: 0x888899, violet: 0x8844cc, red: 0xcc2222,
};

const CLASS_BODY: Record<string, { sx: number; sy: number; sz: number; color: number }> = {
  warrior:  { sx: 1.1, sy: 1.0, sz: 1.1, color: 0xcc3333 },
  paladin:  { sx: 1.1, sy: 1.05, sz: 1.0, color: 0xe6c830 },
  mage:     { sx: 0.85, sy: 1.1, sz: 0.85, color: 0x3366dd },
  cleric:   { sx: 0.9, sy: 1.05, sz: 0.9, color: 0xeeeeff },
  ranger:   { sx: 0.9, sy: 1.05, sz: 0.9, color: 0x33aa44 },
  rogue:    { sx: 0.85, sy: 1.0, sz: 0.85, color: 0x8833bb },
  warlock:  { sx: 0.9, sy: 1.1, sz: 0.9, color: 0x33bb66 },
  monk:     { sx: 0.95, sy: 1.0, sz: 0.95, color: 0xe69628 },
};

export const CLASS_COLORS: Record<string, number> = {
  warrior: 0xcc3333, paladin: 0xe6c830, mage: 0x3366dd, cleric: 0xeeeeff,
  ranger: 0x33aa44, rogue: 0x8833bb, warlock: 0x33bb66, monk: 0xe69628,
};

const ENTITY_STYLE: Record<string, { color: number; style: "humanoid" | "object" | "resource" | "mob" }> = {
  player: { color: 0x44ddff, style: "humanoid" },
  mob: { color: 0xcc4444, style: "mob" }, boss: { color: 0xaa33ff, style: "mob" },
  corpse: { color: 0x555555, style: "object" },
  npc: { color: 0x4488ff, style: "humanoid" }, merchant: { color: 0xffcc00, style: "humanoid" },
  "quest-giver": { color: 0x66bbff, style: "humanoid" }, "guild-registrar": { color: 0xccbb33, style: "humanoid" },
  auctioneer: { color: 0xbb8833, style: "humanoid" }, "arena-master": { color: 0xcc3333, style: "humanoid" },
  "profession-trainer": { color: 0x44cc88, style: "humanoid" }, "crafting-master": { color: 0xcc8844, style: "humanoid" },
  "lore-npc": { color: 0x8888cc, style: "humanoid" }, trainer: { color: 0x88ff44, style: "humanoid" },
  "essence-forge": { color: 0x8866cc, style: "object" },
  "ore-node": { color: 0x999999, style: "resource" }, "flower-node": { color: 0xee66aa, style: "resource" },
  "nectar-node": { color: 0xffdd44, style: "resource" }, "crop-node": { color: 0x88cc44, style: "resource" },
  forge: { color: 0xff6633, style: "object" }, "alchemy-lab": { color: 0x44cc88, style: "object" },
  "enchanting-altar": { color: 0x8844ff, style: "object" }, campfire: { color: 0xff8833, style: "object" },
  "tanning-rack": { color: 0xaa7744, style: "object" }, "jewelers-bench": { color: 0x44cccc, style: "object" },
  "dungeon-gate": { color: 0x884422, style: "object" },
};

const COORD_SCALE = 1 / 10;

// ── Shared geometries ──────────────────────────────────────────────

const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.6, 4, 8);
const headGeo = new THREE.SphereGeometry(0.2, 8, 6);
const eyeGeo = new THREE.SphereGeometry(0.04, 4, 4);
const hairShortGeo = new THREE.SphereGeometry(0.22, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.6);
const hairLongGeo = new THREE.CapsuleGeometry(0.15, 0.3, 4, 6);
const hairMohawkGeo = new THREE.BoxGeometry(0.06, 0.25, 0.3);
const hairBraidedGeo = new THREE.CylinderGeometry(0.06, 0.04, 0.5, 5);
const weaponGeo = new THREE.BoxGeometry(0.08, 0.7, 0.08);
const shieldGeo = new THREE.BoxGeometry(0.04, 0.35, 0.25);
const mobBodyGeo = new THREE.CapsuleGeometry(0.3, 0.5, 4, 8);
const npcBodyGeo = new THREE.CapsuleGeometry(0.22, 0.65, 4, 8);
const oreGeo = new THREE.DodecahedronGeometry(0.35, 0);
const flowerGeo = new THREE.ConeGeometry(0.2, 0.5, 5);
const stationGeo = new THREE.BoxGeometry(0.6, 0.5, 0.6);
const gateGeo = new THREE.BoxGeometry(0.8, 1.8, 0.3);
const legGeo = new THREE.CapsuleGeometry(0.08, 0.35, 3, 6);
const hpBarBgGeo = new THREE.PlaneGeometry(0.6, 0.06);
const hpBarFgGeo = new THREE.PlaneGeometry(0.58, 0.04);

function makeLabel(text: string, color = "#ffffff"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 28px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#000000";
  ctx.fillText(text, 129, 39);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 38);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2, 0.5, 1);
  return sprite;
}

// ── Floating combat text ────────────────────────────────────────────

function makeFloatingText(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 36px monospace";
  ctx.textAlign = "center";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 4;
  ctx.strokeText(text, 64, 44);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 44);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 0.6, 1);
  return sprite;
}

// ── Animation types ─────────────────────────────────────────────────

interface ActiveAnim {
  type: "attack" | "damage" | "death" | "heal" | "ability";
  elapsed: number;
  duration: number;
  data?: any;
}

interface FloatingText {
  sprite: THREE.Sprite;
  elapsed: number;
  startY: number;
}

// ── Entity object tracking ──────────────────────────────────────────

interface EntityObject {
  group: THREE.Group;
  targetX: number;
  targetZ: number;
  prevTargetX: number;  // previous tick's target (for velocity estimation)
  prevTargetZ: number;
  prevX: number;
  prevZ: number;
  targetYaw: number;
  hpBarFg: THREE.Mesh | null;
  hpBarBg: THREE.Mesh | null;
  entity: Entity;
  prevHp: number;
  anims: ActiveAnim[];
  bodyMesh: THREE.Mesh | null;
  walkPhase: number;        // 0-2PI cycling walk animation
  isMoving: boolean;        // smoothed moving flag for walk anim
  movingSmooth: number;     // 0→1 blend for walk cycle fade in/out
  leftLeg: THREE.Mesh | null;
  rightLeg: THREE.Mesh | null;
}

export class EntityManager {
  readonly group = new THREE.Group();
  private entities = new Map<string, EntityObject>();
  private floatingTexts: FloatingText[] = [];
  private zoneOffsetX = 0;
  private zoneOffsetZ = 0;
  private terrainRef: TerrainRenderer | null = null;

  constructor() {
    this.group.name = "entities";
  }

  /** Link to terrain so entities can sample elevation */
  setTerrain(t: TerrainRenderer) {
    this.terrainRef = t;
  }

  /** Set zone world-space offset (from /world/layout) */
  setZoneOffset(x: number, z: number) {
    this.zoneOffsetX = x;
    this.zoneOffsetZ = z;
  }

  /** Convert server world coords to zone-local 3D coords */
  private toLocal(serverX: number, serverY: number): { x: number; z: number } {
    return {
      x: (serverX - this.zoneOffsetX) * COORD_SCALE,
      z: (serverY - this.zoneOffsetZ) * COORD_SCALE,
    };
  }

  /** Sync scene with latest zone entity data */
  sync(entities: Record<string, Entity>) {
    const seen = new Set<string>();

    for (const [id, ent] of Object.entries(entities)) {
      seen.add(id);
      const existing = this.entities.get(id);
      const pos = this.toLocal(ent.x, ent.y);

      if (existing) {
        existing.prevTargetX = existing.targetX;
        existing.prevTargetZ = existing.targetZ;
        existing.targetX = pos.x;
        existing.targetZ = pos.z;

        // Detect HP changes → trigger animations
        const hpDelta = ent.hp - existing.prevHp;
        if (hpDelta < 0 && existing.prevHp > 0) {
          // Took damage
          this.triggerDamage(existing, -hpDelta);
        } else if (hpDelta > 0) {
          // Healed
          this.triggerHeal(existing, hpDelta);
        }

        // Death detection
        if (ent.hp <= 0 && existing.prevHp > 0) {
          this.triggerDeath(existing);
        }

        existing.prevHp = ent.hp;
        existing.entity = ent;

        // Update HP bar
        if (existing.hpBarFg && ent.maxHp > 0) {
          const hpRatio = Math.max(0, ent.hp / ent.maxHp);
          existing.hpBarFg.scale.x = Math.max(0.01, hpRatio);
          (existing.hpBarFg.material as THREE.MeshBasicMaterial).color.setHex(
            hpRatio > 0.5 ? 0x44cc44 : hpRatio > 0.25 ? 0xcccc44 : 0xcc4444
          );
        }
      } else {
        const obj = this.createEntity(ent);
        this.entities.set(id, obj);
        this.group.add(obj.group);
      }
    }

    for (const [id, obj] of this.entities) {
      if (!seen.has(id)) {
        this.group.remove(obj.group);
        this.entities.delete(id);
      }
    }
  }

  /** Lerp positions, billboard, animate */
  update(dt: number, camera?: THREE.Camera) {
    // Constant-speed move toward target (units/sec, tuned to feel smooth at 1s poll)
    const MOVE_SPEED = 4.0;
    const step = MOVE_SPEED * dt;

    for (const obj of this.entities.values()) {
      const g = obj.group;

      // ── Smooth constant-speed interpolation ──
      const prevPosX = g.position.x;
      const prevPosZ = g.position.z;

      const toX = obj.targetX - g.position.x;
      const toZ = obj.targetZ - g.position.z;
      const dist = Math.sqrt(toX * toX + toZ * toZ);

      if (dist > 0.01) {
        if (dist <= step) {
          // Close enough — snap
          g.position.x = obj.targetX;
          g.position.z = obj.targetZ;
        } else {
          // Move at constant speed toward target
          const f = step / dist;
          g.position.x += toX * f;
          g.position.z += toZ * f;
        }
      }

      // Sample terrain elevation so entities sit on the ground
      if (this.terrainRef) {
        const targetY = this.terrainRef.getElevationAt(g.position.x, g.position.z);
        g.position.y += (targetY - g.position.y) * Math.min(8 * dt, 1);
      }

      // Compute facing direction from actual movement delta
      const dx = g.position.x - prevPosX;
      const dz = g.position.z - prevPosZ;
      const moveDist = Math.sqrt(dx * dx + dz * dz);

      // Track moving state with hysteresis
      obj.isMoving = moveDist > 0.001;
      const targetBlend = obj.isMoving ? 1 : 0;
      obj.movingSmooth += (targetBlend - obj.movingSmooth) * Math.min(8 * dt, 1);

      // Only update yaw if actually moving (threshold avoids jitter when stationary)
      if (moveDist > 0.001) {
        obj.targetYaw = Math.atan2(dx, dz);
      }

      // Smooth yaw rotation (shortest path)
      if (!obj.anims.some(a => a.type === "attack" || a.type === "death")) {
        let yawDiff = obj.targetYaw - g.rotation.y;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        g.rotation.y += yawDiff * Math.min(10 * dt, 1);
      }

      // ── Walk cycle animation ──
      if (obj.movingSmooth > 0.01 && (obj.leftLeg || obj.bodyMesh)) {
        obj.walkPhase += dt * 10; // ~1.6 steps/sec
        const swing = Math.sin(obj.walkPhase) * 0.4 * obj.movingSmooth;

        if (obj.leftLeg && obj.rightLeg) {
          obj.leftLeg.rotation.x = swing;
          obj.rightLeg.rotation.x = -swing;
        }

        // Subtle body bob
        if (obj.bodyMesh) {
          obj.bodyMesh.position.y = 0.8 + Math.abs(Math.sin(obj.walkPhase * 2)) * 0.03 * obj.movingSmooth;
        }
      } else if (obj.leftLeg && obj.rightLeg) {
        // Smoothly return legs to rest
        obj.leftLeg.rotation.x *= 0.85;
        obj.rightLeg.rotation.x *= 0.85;
        if (obj.bodyMesh) {
          obj.bodyMesh.position.y += (0.8 - obj.bodyMesh.position.y) * 0.1;
        }
      }

      // Billboard HP bars toward camera
      if (camera && obj.hpBarBg) {
        obj.hpBarBg.lookAt(camera.position);
        obj.hpBarFg!.lookAt(camera.position);
      }

      // Process animations
      for (let i = obj.anims.length - 1; i >= 0; i--) {
        const anim = obj.anims[i];
        anim.elapsed += dt;
        const t = anim.elapsed / anim.duration;

        if (t >= 1) {
          this.resetAnim(obj, anim);
          obj.anims.splice(i, 1);
          continue;
        }

        this.applyAnim(obj, anim, t);
      }
    }

    // Update floating text
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.elapsed += dt;
      const t = ft.elapsed / 1.2; // 1.2s lifetime
      ft.sprite.position.y = ft.startY + t * 2;
      (ft.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
      if (t >= 1) {
        ft.sprite.parent?.remove(ft.sprite);
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  getEntityAt(intersects: THREE.Intersection[]): Entity | null {
    for (const hit of intersects) {
      let obj = hit.object as THREE.Object3D | null;
      while (obj) {
        if (obj.userData.entityId) {
          return this.entities.get(obj.userData.entityId)?.entity ?? null;
        }
        obj = obj.parent;
      }
    }
    return null;
  }

  // ── Animation triggers ────────────────────────────────────────────

  private triggerDamage(obj: EntityObject, amount: number) {
    obj.anims.push({ type: "damage", elapsed: 0, duration: 0.4 });

    // Floating damage number
    const ft = makeFloatingText(`-${amount}`, "#ff4444");
    ft.position.set(0, 2.0, 0);
    obj.group.add(ft);
    this.floatingTexts.push({ sprite: ft, elapsed: 0, startY: 2.0 });

    // If attacker nearby, trigger their attack anim
    // (We detect this by finding entities close to the damaged one)
    for (const other of this.entities.values()) {
      if (other === obj) continue;
      if (other.entity.type !== "player" && other.entity.type !== "mob" && other.entity.type !== "boss") continue;
      const dx = other.group.position.x - obj.group.position.x;
      const dz = other.group.position.z - obj.group.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 3 && !other.anims.some(a => a.type === "attack")) {
        other.anims.push({ type: "attack", elapsed: 0, duration: 0.35, data: { targetPos: obj.group.position.clone() } });
        break; // Only one attacker animation per damage tick
      }
    }
  }

  private triggerHeal(obj: EntityObject, amount: number) {
    obj.anims.push({ type: "heal", elapsed: 0, duration: 0.6 });

    const ft = makeFloatingText(`+${amount}`, "#44ff66");
    ft.position.set(0, 2.0, 0);
    obj.group.add(ft);
    this.floatingTexts.push({ sprite: ft, elapsed: 0, startY: 2.0 });
  }

  private triggerDeath(obj: EntityObject) {
    obj.anims.push({ type: "death", elapsed: 0, duration: 1.0 });
  }

  /** Apply animation at progress t (0-1) */
  private applyAnim(obj: EntityObject, anim: ActiveAnim, t: number) {
    switch (anim.type) {
      case "attack": {
        // Lunge forward toward target, then snap back
        const lunge = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
        const targetPos = anim.data?.targetPos as THREE.Vector3 | undefined;
        if (targetPos && obj.bodyMesh) {
          const dx = targetPos.x - obj.group.position.x;
          const dz = targetPos.z - obj.group.position.z;
          const len = Math.sqrt(dx * dx + dz * dz) || 1;
          // Lean body forward
          obj.bodyMesh.rotation.x = -lunge * 0.5;
          obj.bodyMesh.position.z = lunge * 0.3 * (dz / len);
          obj.bodyMesh.position.x = lunge * 0.3 * (dx / len);
          // Face target
          obj.group.rotation.y = Math.atan2(dx, dz);
        }
        break;
      }
      case "damage": {
        // Red flash + shake
        if (obj.bodyMesh) {
          const shake = Math.sin(t * Math.PI * 8) * (1 - t) * 0.1;
          obj.bodyMesh.position.x = shake;
          // Red tint
          const mat = obj.bodyMesh.material as THREE.MeshLambertMaterial;
          if (mat.emissive) {
            mat.emissive.setHex(t < 0.5 ? 0xff0000 : 0x000000);
            mat.emissiveIntensity = (1 - t) * 0.8;
          }
        }
        break;
      }
      case "heal": {
        // Green glow pulse
        if (obj.bodyMesh) {
          const mat = obj.bodyMesh.material as THREE.MeshLambertMaterial;
          if (mat.emissive) {
            mat.emissive.setHex(0x44ff66);
            mat.emissiveIntensity = Math.sin(t * Math.PI) * 0.6;
          }
        }
        break;
      }
      case "death": {
        // Shrink + fall over + fade
        obj.group.scale.setScalar(1 - t * 0.5);
        obj.group.rotation.z = t * Math.PI / 3;
        obj.group.position.y = -t * 0.5;
        // Fade all materials
        obj.group.traverse((child) => {
          if ((child as THREE.Mesh).material) {
            const mat = (child as THREE.Mesh).material as THREE.Material;
            mat.transparent = true;
            mat.opacity = 1 - t;
          }
        });
        break;
      }
    }
  }

  /** Reset entity after animation completes */
  private resetAnim(obj: EntityObject, anim: ActiveAnim) {
    switch (anim.type) {
      case "attack":
        if (obj.bodyMesh) {
          obj.bodyMesh.rotation.x = 0;
          obj.bodyMesh.position.x = 0;
          obj.bodyMesh.position.z = 0;
        }
        break;
      case "damage":
      case "heal":
        if (obj.bodyMesh) {
          obj.bodyMesh.position.x = 0;
          const mat = obj.bodyMesh.material as THREE.MeshLambertMaterial;
          if (mat.emissive) {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
        break;
      case "death":
        // Leave dead (entity will be removed by server next poll)
        break;
    }
  }

  // ── Entity creation ───────────────────────────────────────────────

  private createEntity(ent: Entity): EntityObject {
    const group = new THREE.Group();
    group.userData.entityId = ent.id;

    const pos = this.toLocal(ent.x, ent.y);
    const elev = this.terrainRef?.getElevationAt(pos.x, pos.z) ?? 0;
    group.position.set(pos.x, elev, pos.z);

    const info = ENTITY_STYLE[ent.type] ?? { color: 0x888888, style: "object" };
    let bodyMesh: THREE.Mesh | null = null;
    let leftLeg: THREE.Mesh | null = null;
    let rightLeg: THREE.Mesh | null = null;

    switch (info.style) {
      case "humanoid": {
        const result = ent.type === "player"
          ? this.buildPlayer(group, ent)
          : this.buildNpc(group, ent, info.color);
        bodyMesh = result.body;
        leftLeg = result.leftLeg;
        rightLeg = result.rightLeg;
        break;
      }
      case "mob": {
        const result = this.buildMob(group, ent);
        bodyMesh = result.body;
        leftLeg = result.leftLeg;
        rightLeg = result.rightLeg;
        break;
      }
      case "resource":
        this.buildResource(group, ent, info.color);
        break;
      case "object":
        this.buildObject(group, ent, info.color);
        break;
    }

    // HP bar + label
    let hpBarFg: THREE.Mesh | null = null;
    let hpBarBg: THREE.Mesh | null = null;
    if (info.style === "humanoid" || info.style === "mob") {
      const labelY = info.style === "mob" && ent.type === "boss" ? 2.5 : 2.1;

      hpBarBg = new THREE.Mesh(hpBarBgGeo, new THREE.MeshBasicMaterial({ color: 0x333333, depthTest: false }));
      hpBarBg.position.y = labelY;
      group.add(hpBarBg);

      const hpRatio = ent.maxHp > 0 ? Math.max(0, ent.hp / ent.maxHp) : 1;
      hpBarFg = new THREE.Mesh(hpBarFgGeo, new THREE.MeshBasicMaterial({
        color: hpRatio > 0.5 ? 0x44cc44 : hpRatio > 0.25 ? 0xcccc44 : 0xcc4444, depthTest: false,
      }));
      hpBarFg.position.y = labelY;
      hpBarFg.position.z = 0.001;
      hpBarFg.scale.x = Math.max(0.01, hpRatio);
      group.add(hpBarFg);

      const labelColor = ent.type === "player" ? "#44ddff" : ent.type === "mob" ? "#ff6666" : ent.type === "boss" ? "#cc66ff" : "#ffcc44";
      const label = makeLabel(ent.name, labelColor);
      label.position.y = labelY + 0.3;
      group.add(label);
    } else {
      const label = makeLabel(ent.name, "#aaaaaa");
      label.position.y = 1.2;
      label.scale.set(1.5, 0.4, 1);
      group.add(label);
    }

    return {
      group, targetX: pos.x, targetZ: pos.z, prevTargetX: pos.x, prevTargetZ: pos.z,
      prevX: pos.x, prevZ: pos.z, targetYaw: 0, hpBarFg, hpBarBg, entity: ent,
      prevHp: ent.hp, anims: [], bodyMesh, walkPhase: 0, isMoving: false,
      movingSmooth: 0, leftLeg, rightLeg,
    };
  }

  // ── Player ────────────────────────────────────────────────────────

  private buildPlayer(group: THREE.Group, ent: Entity): { body: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh } {
    const skinHex = SKIN_COLORS[ent.skinColor ?? "medium"] ?? 0xd4a574;
    const classId = ent.classId ?? "warrior";
    const cls = CLASS_BODY[classId] ?? CLASS_BODY.warrior;

    // Legs (pivot at hip)
    const legMat = new THREE.MeshLambertMaterial({ color: skinHex });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.1, 0.35, 0);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.1, 0.35, 0);
    group.add(rightLeg);

    const bodyMat = new THREE.MeshLambertMaterial({ color: cls.color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    body.scale.set(cls.sx, cls.sy, cls.sz);
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: skinHex }));
    head.position.y = 1.5;
    group.add(head);

    const eyeHex = EYE_COLORS[ent.eyeColor ?? "brown"] ?? 0x6b3a1f;
    const eyeMat = new THREE.MeshBasicMaterial({ color: eyeHex });
    for (const dx of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(dx, 1.53, 0.17);
      group.add(eye);
    }

    const style = ent.hairStyle ?? "short";
    if (style !== "bald") {
      const hairHex = HAIR_COLORS[style] ?? 0x4a3728;
      const hairMat = new THREE.MeshLambertMaterial({ color: hairHex });
      if (style === "long") {
        const h = new THREE.Mesh(hairLongGeo, hairMat); h.position.set(0, 1.55, -0.12); group.add(h);
      } else if (style === "mohawk") {
        const h = new THREE.Mesh(hairMohawkGeo, hairMat); h.position.set(0, 1.75, 0); group.add(h);
      } else if (style === "ponytail") {
        const top = new THREE.Mesh(hairShortGeo, hairMat); top.position.set(0, 1.6, 0); group.add(top);
        const tail = new THREE.Mesh(hairLongGeo, hairMat); tail.position.set(0, 1.35, -0.2); tail.rotation.x = 0.3; group.add(tail);
      } else if (style === "braided") {
        const top = new THREE.Mesh(hairShortGeo, hairMat); top.position.set(0, 1.6, 0); group.add(top);
        for (const dx of [-0.12, 0.12]) { const b = new THREE.Mesh(hairBraidedGeo, hairMat); b.position.set(dx, 1.25, -0.1); group.add(b); }
      } else {
        const h = new THREE.Mesh(hairShortGeo, hairMat); h.position.set(0, 1.6, 0); group.add(h);
      }
    }

    if (ent.equipment?.weapon) {
      const w = new THREE.Mesh(weaponGeo, new THREE.MeshLambertMaterial({ color: 0xaaaaaa }));
      w.position.set(0.4, 0.9, 0); w.rotation.z = -0.3; w.castShadow = true; group.add(w);
    }
    if (classId === "paladin" || classId === "warrior") {
      const s = new THREE.Mesh(shieldGeo, new THREE.MeshLambertMaterial({ color: cls.color }));
      s.position.set(-0.4, 0.9, 0.1); group.add(s);
    }
    if (ent.equipment?.chest) {
      const shell = new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ color: cls.color, transparent: true, opacity: 0.4 }));
      shell.position.y = 0.8; shell.scale.set(cls.sx * 1.15, cls.sy * 0.85, cls.sz * 1.15); group.add(shell);
    }

    return { body, leftLeg, rightLeg };
  }

  // ── Mob ───────────────────────────────────────────────────────────

  private buildMob(group: THREE.Group, ent: Entity): { body: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh } {
    const isBoss = ent.type === "boss";
    const color = isBoss ? 0xaa33ff : 0xcc4444;
    const s = isBoss ? 1.4 : 1.0;

    const mat = new THREE.MeshLambertMaterial({ color });

    // Legs
    const leftLeg = new THREE.Mesh(legGeo, mat);
    leftLeg.position.set(-0.12 * s, 0.3 * s, 0); leftLeg.scale.setScalar(s);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, mat);
    rightLeg.position.set(0.12 * s, 0.3 * s, 0); rightLeg.scale.setScalar(s);
    group.add(rightLeg);

    const body = new THREE.Mesh(mobBodyGeo, mat);
    body.position.y = 0.7; body.scale.setScalar(s); body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 1.3 * s; head.scale.setScalar(s * 0.9); group.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    for (const dx of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(dx * s, 1.33 * s, 0.15 * s); group.add(eye);
    }

    if (isBoss) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.25, 5), new THREE.MeshBasicMaterial({ color: 0xffdd00 }));
      crown.position.y = 1.7 * s; group.add(crown);
    }

    return { body, leftLeg, rightLeg };
  }

  // ── NPC ───────────────────────────────────────────────────────────

  private buildNpc(group: THREE.Group, ent: Entity, color: number): { body: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh } {
    const mat = new THREE.MeshLambertMaterial({ color });

    // Legs
    const legMat = new THREE.MeshLambertMaterial({ color: 0x555566 });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.09, 0.3, 0);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.09, 0.3, 0);
    group.add(rightLeg);

    const body = new THREE.Mesh(npcBodyGeo, mat);
    body.position.y = 0.75; body.castShadow = true; group.add(body);

    const skinHex = ent.skinColor ? (SKIN_COLORS[ent.skinColor] ?? color) : color;
    const head = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: skinHex }));
    head.position.y = 1.45; group.add(head);

    if (ent.eyeColor) {
      const eyeHex = EYE_COLORS[ent.eyeColor] ?? 0x333333;
      const eyeMat = new THREE.MeshBasicMaterial({ color: eyeHex });
      for (const dx of [-0.07, 0.07]) { const eye = new THREE.Mesh(eyeGeo, eyeMat); eye.position.set(dx, 1.48, 0.16); group.add(eye); }
    }
    if (ent.hairStyle && ent.hairStyle !== "bald") {
      const h = new THREE.Mesh(hairShortGeo, new THREE.MeshLambertMaterial({ color: HAIR_COLORS[ent.hairStyle] ?? 0x4a3728 }));
      h.position.set(0, 1.55, 0); group.add(h);
    }
    if (ent.type === "quest-giver") {
      const q = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), new THREE.MeshBasicMaterial({ color: 0xffdd00 }));
      q.position.y = 2.0; group.add(q);
    }
    if (ent.type === "merchant") {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.15), new THREE.MeshLambertMaterial({ color: 0xbb8833 }));
      bag.position.set(0.3, 0.4, 0); group.add(bag);
    }

    return { body, leftLeg, rightLeg };
  }

  // ── Resource node ─────────────────────────────────────────────────

  private buildResource(group: THREE.Group, ent: Entity, color: number) {
    const mat = new THREE.MeshLambertMaterial({ color });
    if (ent.type === "ore-node") {
      const rock = new THREE.Mesh(oreGeo, mat); rock.position.y = 0.35; rock.castShadow = true; group.add(rock);
    } else {
      const flower = new THREE.Mesh(flowerGeo, mat); flower.position.y = 0.25; group.add(flower);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 4), new THREE.MeshLambertMaterial({ color: 0x448833 }));
      stem.position.y = 0; group.add(stem);
    }
  }

  // ── Object (crafting station, dungeon gate, etc.) ─────────────────

  private buildObject(group: THREE.Group, ent: Entity, color: number) {
    const mat = new THREE.MeshLambertMaterial({ color });
    if (ent.type === "dungeon-gate") {
      const gate = new THREE.Mesh(gateGeo, mat); gate.position.y = 0.9; gate.castShadow = true; group.add(gate);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 12), new THREE.MeshBasicMaterial({ color: 0xff6622, transparent: true, opacity: 0.5 }));
      glow.position.y = 1.4; glow.rotation.x = Math.PI / 2; group.add(glow);
    } else if (ent.type === "campfire") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 6, 8), new THREE.MeshLambertMaterial({ color: 0x666666 }));
      ring.position.y = 0.06; ring.rotation.x = Math.PI / 2; group.add(ring);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 5), new THREE.MeshBasicMaterial({ color: 0xff8833 }));
      flame.position.y = 0.35; group.add(flame);
      const light = new THREE.PointLight(0xff6622, 0.8, 5); light.position.y = 0.5; group.add(light);
    } else if (ent.type === "corpse") {
      const b = new THREE.Mesh(bodyGeo, mat); b.position.y = 0.15; b.rotation.z = Math.PI / 2; group.add(b);
    } else {
      const station = new THREE.Mesh(stationGeo, mat); station.position.y = 0.25; station.castShadow = true; group.add(station);
    }
  }

  /** Get the current 3D position of an entity by id (for camera follow) */
  getEntityPosition(id: string): THREE.Vector3 | null {
    const obj = this.entities.get(id);
    return obj ? obj.group.position : null;
  }

  /** Get entity data by id */
  getEntity(id: string): Entity | null {
    return this.entities.get(id)?.entity ?? null;
  }

  /** Get the body mesh of an entity (for tinting, glow effects) */
  getBodyMesh(entityId: string): THREE.Mesh | null {
    return this.entities.get(entityId)?.bodyMesh ?? null;
  }

  dispose() {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.entities.clear();
    this.floatingTexts = [];
  }
}
