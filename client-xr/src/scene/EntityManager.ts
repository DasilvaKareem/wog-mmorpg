import * as THREE from "three";
import type { Entity, ElevationProvider } from "../types.js";
import type { EnvironmentAssets } from "./EnvironmentAssets.js";
import { getGradientMap } from "./ToonPipeline.js";

// ── Appearance color maps (matched to actual server values) ─────────

const SKIN_COLORS: Record<string, number> = {
  pale: 0xfde0c8, fair: 0xf5d0b0, light: 0xf5c8a0, medium: 0xd4a574,
  tan: 0xc49560, olive: 0xb08850, brown: 0x8b5e3c, dark: 0x6b4226,
};

const HAIR_COLORS: Record<string, number> = {
  short: 0x4a3728, long: 0xc4a46e, mohawk: 0xcc2222,
  ponytail: 0x1a1a2e, braided: 0x7a5530, bald: 0x000000,
  locs: 0x2a1a0e, afro: 0x1a0e06, cornrows: 0x1a1008,
  "bantu-knots": 0x1a0e06, bangs: 0x8a6a42, topknot: 0x3a2818,
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

// ── Weapon type inference & procedural generation ────────────────────

type WeaponType = "sword" | "axe" | "staff" | "bow" | "dagger" | "mace" | "pickaxe" | "sickle";

function inferWeaponType(name: string): WeaponType {
  const n = name.toLowerCase();
  if (n.includes("sword") || n.includes("longsword") || n.includes("blade")) return "sword";
  if (n.includes("axe") || n.includes("battleaxe") || n.includes("hatchet")) return "axe";
  if (n.includes("staff") || n.includes("stave") || n.includes("rod") || n.includes("wand")) return "staff";
  if (n.includes("bow") || n.includes("longbow") || n.includes("shortbow")) return "bow";
  if (n.includes("dagger") || n.includes("knife") || n.includes("shiv")) return "dagger";
  if (n.includes("mace") || n.includes("hammer") || n.includes("flail")) return "mace";
  if (n.includes("pickaxe") || n.includes("pick")) return "pickaxe";
  if (n.includes("sickle") || n.includes("scythe")) return "sickle";
  return "sword"; // default
}

const QUALITY_COLORS: Record<string, number> = {
  common: 0xaaaaaa, uncommon: 0x44cc44, rare: 0x4488ff,
  epic: 0xaa44ff, legendary: 0xff8800,
};
const QUALITY_EMISSIVE: Record<string, number> = {
  common: 0x000000, uncommon: 0x000000, rare: 0x112244,
  epic: 0x220044, legendary: 0x442200,
};

// Shared weapon geometries (pre-allocated, reused)
// -- Sword: flat blade + handle
const swordBladeGeo = new THREE.BoxGeometry(0.04, 0.55, 0.14);
const swordGuardGeo = new THREE.BoxGeometry(0.04, 0.04, 0.22);
const swordHandleGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.18, 6);
const swordPommelGeo = new THREE.SphereGeometry(0.035, 5, 4);

// -- Axe: handle + wedge head
const axeHandleGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.65, 6);
const axeHeadGeo = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.12);
  shape.quadraticCurveTo(0.18, -0.08, 0.2, 0.04);
  shape.quadraticCurveTo(0.18, 0.16, 0, 0.12);
  shape.lineTo(0, -0.12);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
  geo.translate(-0.02, 0, -0.02);
  return geo;
})();

// -- Staff: long thin pole + orb on top
const staffPoleGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.95, 6);
const staffOrbGeo = new THREE.SphereGeometry(0.06, 8, 6);

// -- Bow: curved limb (torus arc) + string
const bowLimbGeo = new THREE.TorusGeometry(0.3, 0.02, 6, 12, Math.PI * 0.8);
const bowStringGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.5, 3);

// -- Dagger: short blade + handle
const daggerBladeGeo = new THREE.BoxGeometry(0.03, 0.28, 0.08);
const daggerHandleGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.12, 6);

// -- Mace: handle + spiked head
const maceHandleGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.5, 6);
const maceHeadGeo = new THREE.DodecahedronGeometry(0.09, 0);

// -- Pickaxe: handle + pointed head
const pickHandleGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.55, 6);
const pickHeadGeo = new THREE.ConeGeometry(0.04, 0.25, 4);
const pickBackGeo = new THREE.BoxGeometry(0.04, 0.04, 0.12);

// -- Sickle: handle + curved blade
const sickleHandleGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.3, 6);
const sickleBladeGeo = new THREE.TorusGeometry(0.15, 0.015, 4, 10, Math.PI * 0.6);

// ── Armor material type inference ────────────────────────────────────

type ArmorMaterial = "leather" | "chain" | "plate";

function inferArmorMaterial(name: string): ArmorMaterial {
  const n = name.toLowerCase();
  if (n.includes("leather") || n.includes("hide") || n.includes("tanned") || n.includes("padded") || n.includes("cloth") || n.includes("woven")) return "leather";
  if (n.includes("chain") || n.includes("mail") || n.includes("ring")) return "chain";
  // plate: iron, steel, knight, bronze, war, reinforced (metal implied), exotic names
  return "plate";
}

// Base color tints per armor material (combined with quality color)
const ARMOR_MAT_TINT: Record<ArmorMaterial, number> = {
  leather: 0x8B6B42, // warm brown
  chain: 0x889999, // blue-steel
  plate: 0xBBBBCC, // bright silver
};

// ── Shared armor geometries ─────────────────────────────────────────

// Helm — plate: full dome + nasal + crest; chain: coif cap; leather: skullcap
const helmDomeGeo = new THREE.SphereGeometry(0.23, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.65);
const helmNasalGeo = new THREE.BoxGeometry(0.03, 0.12, 0.06);
const helmCrestGeo = new THREE.BoxGeometry(0.03, 0.08, 0.2);
const helmCoifGeo = new THREE.SphereGeometry(0.24, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
const helmCapGeo = new THREE.SphereGeometry(0.22, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.45);
const helmBrimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.02, 12);

// Chest
const chestPlateGeo = new THREE.CapsuleGeometry(0.28, 0.35, 4, 8);
const chestVestGeo = new THREE.CapsuleGeometry(0.27, 0.32, 3, 6);

// Shoulders
const pauldronPlatGeo = new THREE.SphereGeometry(0.14, 6, 5, 0, Math.PI * 2, 0, Math.PI * 0.6);
const pauldronRimGeo = new THREE.TorusGeometry(0.12, 0.02, 4, 8);
const pauldronPadGeo = new THREE.CapsuleGeometry(0.08, 0.1, 3, 5);

// Legs
const greaveGeo = new THREE.CapsuleGeometry(0.1, 0.3, 3, 6);
const leatherPantsGeo = new THREE.CapsuleGeometry(0.09, 0.32, 3, 6);

// Boots
const bootPlateGeo = new THREE.BoxGeometry(0.12, 0.15, 0.2);
const bootCuffGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.06, 6);
const bootLeatherGeo = new THREE.CapsuleGeometry(0.06, 0.12, 3, 6);

// Gloves
const gauntletGeo = new THREE.BoxGeometry(0.1, 0.12, 0.08);
const gauntletCuffGeo = new THREE.CylinderGeometry(0.06, 0.055, 0.05, 6);
const gloveLeatherGeo = new THREE.SphereGeometry(0.065, 5, 4);

// Belt
const beltGeo = new THREE.TorusGeometry(0.27, 0.03, 4, 12);
const beltBuckleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.04);
const beltThinGeo = new THREE.TorusGeometry(0.26, 0.02, 4, 12);
const beltPouchGeo = new THREE.BoxGeometry(0.06, 0.07, 0.05);

function makeArmorMat(matType: ArmorMaterial, quality: string | undefined, opts?: { transparent?: boolean; opacity?: number }): THREE.MeshToonMaterial {
  const q = quality ?? "common";
  // Blend quality color with material tint
  const qualCol = new THREE.Color(QUALITY_COLORS[q] ?? QUALITY_COLORS.common);
  const tintCol = new THREE.Color(ARMOR_MAT_TINT[matType]);
  qualCol.lerp(tintCol, 0.4); // 40% tint influence

  const emHex = QUALITY_EMISSIVE[q] ?? 0x000000;
  return new THREE.MeshToonMaterial({
    color: qualCol,
    emissive: emHex,
    emissiveIntensity: emHex ? 0.25 : 0,
    transparent: opts?.transparent ?? false,
    opacity: opts?.opacity ?? 1,
    gradientMap: getGradientMap(),
  });
}

function addArmorPieces(
  group: THREE.Group, ent: Entity, cls: { sx: number; sy: number; sz: number; color: number },
  leftArm?: THREE.Group, rightArm?: THREE.Group, leftLeg?: THREE.Mesh, rightLeg?: THREE.Mesh,
  rig?: CharacterRig | null,
) {
  const eq = ent.equipment;
  if (!eq) return;

  // ── Helm — attach to head bone so it follows head animation ──
  if (eq.helm) {
    const mt = inferArmorMaterial(eq.helm.name ?? "");
    const mat = makeArmorMat(mt, eq.helm.quality);
    const helmTarget = rig?.head ?? group;

    if (mt === "plate") {
      // Full plate helm: dome + nasal + crest (relative to head bone center)
      const dome = new THREE.Mesh(helmDomeGeo, mat);
      dome.position.y = 0.08; helmTarget.add(dome);
      const nasal = new THREE.Mesh(helmNasalGeo, mat);
      nasal.position.set(0, -0.02, 0.2); helmTarget.add(nasal);
      const crest = new THREE.Mesh(helmCrestGeo, mat);
      crest.position.set(0, 0.22, 0); helmTarget.add(crest);
    } else if (mt === "chain") {
      // Chain coif
      const coif = new THREE.Mesh(helmCoifGeo, mat);
      coif.position.y = 0.06; helmTarget.add(coif);
      const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 8), mat);
      drape.position.y = -0.12; helmTarget.add(drape);
    } else {
      // Leather cap: low-profile skullcap + brim
      const cap = new THREE.Mesh(helmCapGeo, mat);
      cap.position.y = 0.1; helmTarget.add(cap);
      const brim = new THREE.Mesh(helmBrimGeo, mat);
      brim.position.y = 0.04; helmTarget.add(brim);
    }
  }

  // ── Chest — attach to chest bone ──
  if (eq.chest) {
    const mt = inferArmorMaterial(eq.chest.name ?? "");
    const chestTarget = rig?.chest ?? group;
    const chestOffY = rig ? 0 : 0.8; // bone-relative vs absolute fallback
    if (mt === "plate") {
      const mat = makeArmorMat(mt, eq.chest.quality, { transparent: true, opacity: 0.75 });
      const plate = new THREE.Mesh(chestPlateGeo, mat);
      plate.position.y = chestOffY;
      plate.scale.set(cls.sx * 1.15, cls.sy * 0.85, cls.sz * 1.1);
      chestTarget.add(plate);
      const ridgeMat = makeArmorMat(mt, eq.chest.quality);
      for (const ry of [-0.1, 0.05]) {
        const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.28 * cls.sx, 0.015, 4, 10), ridgeMat);
        ridge.position.y = chestOffY + ry; ridge.rotation.x = Math.PI / 2;
        chestTarget.add(ridge);
      }
    } else if (mt === "chain") {
      const mat = makeArmorMat(mt, eq.chest.quality, { transparent: true, opacity: 0.6 });
      const shirt = new THREE.Mesh(chestVestGeo, mat);
      shirt.position.y = chestOffY;
      shirt.scale.set(cls.sx * 1.1, cls.sy * 0.88, cls.sz * 1.06);
      chestTarget.add(shirt);
    } else {
      const mat = makeArmorMat(mt, eq.chest.quality, { transparent: true, opacity: 0.55 });
      const vest = new THREE.Mesh(chestVestGeo, mat);
      vest.position.y = chestOffY;
      vest.scale.set(cls.sx * 1.08, cls.sy * 0.82, cls.sz * 1.04);
      chestTarget.add(vest);
      const stitchMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: 0x554422 });
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.3, 0.01), stitchMat);
      stitch.position.set(0, chestOffY, 0.27 * cls.sz); chestTarget.add(stitch);
    }
  }

  // ── Shoulders — attach to arm groups so they swing with arms ──
  if (eq.shoulders) {
    const mt = inferArmorMaterial(eq.shoulders.name ?? "");
    const mat = makeArmorMat(mt, eq.shoulders.quality);
    const arms = [leftArm, rightArm];

    for (let i = 0; i < 2; i++) {
      const arm = arms[i];
      if (mt === "plate") {
        const pad = new THREE.Mesh(pauldronPlatGeo, mat);
        pad.scale.set(1, 0.8, 1);
        const rim = new THREE.Mesh(pauldronRimGeo, mat);
        rim.rotation.x = Math.PI / 2;
        if (arm) { pad.position.set(0, 0.05, 0); arm.add(pad); rim.position.set(0, -0.02, 0); arm.add(rim); }
        else { const dx = i === 0 ? -0.33 : 0.33; pad.position.set(dx, 1.2, 0); group.add(pad); rim.position.set(dx, 1.14, 0); group.add(rim); }
      } else if (mt === "chain") {
        const pad = new THREE.Mesh(pauldronPlatGeo, mat);
        pad.scale.set(0.8, 0.7, 0.8);
        if (arm) { pad.position.set(0, 0.03, 0); arm.add(pad); }
        else { pad.position.set((i === 0 ? -0.3 : 0.3), 1.18, 0); group.add(pad); }
      } else {
        const pad = new THREE.Mesh(pauldronPadGeo, mat);
        if (arm) { pad.position.set(0, 0.02, 0); arm.add(pad); }
        else { const dx = i === 0 ? -1 : 1; pad.position.set(dx * 0.28, 1.18, 0); pad.rotation.z = dx * 0.4; group.add(pad); }
      }
    }
  }

  // ── Legs — child of leg meshes so they swing with walk ──
  if (eq.legs) {
    const mt = inferArmorMaterial(eq.legs.name ?? "");
    const legRefs = [leftLeg, rightLeg];
    for (let i = 0; i < 2; i++) {
      const leg = legRefs[i];
      if (mt === "plate") {
        const mat = makeArmorMat(mt, eq.legs.quality, { transparent: true, opacity: 0.75 });
        const greave = new THREE.Mesh(greaveGeo, mat);
        const kneeMat = makeArmorMat(mt, eq.legs.quality);
        const knee = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), kneeMat);
        if (leg) { greave.position.set(0, 0, 0.02); leg.add(greave); knee.position.set(0, 0.1, 0.08); leg.add(knee); }
        else { const dx = i === 0 ? -0.1 : 0.1; greave.position.set(dx, 0.35, 0.02); group.add(greave); knee.position.set(dx, 0.45, 0.1); group.add(knee); }
      } else {
        const mat = makeArmorMat(mt, eq.legs.quality, { transparent: true, opacity: 0.65 });
        const pant = new THREE.Mesh(leatherPantsGeo, mat);
        if (leg) { pant.position.set(0, 0, 0.01); leg.add(pant); }
        else { const dx = i === 0 ? -0.1 : 0.1; pant.position.set(dx, 0.35, 0.01); group.add(pant); }
      }
    }
  }

  // ── Boots ──
  if (eq.boots) {
    const mt = inferArmorMaterial(eq.boots.name ?? "");
    const mat = makeArmorMat(mt, eq.boots.quality);
    const footBones = rig ? [rig.lFoot, rig.rFoot] : [null, null];
    for (let i = 0; i < 2; i++) {
      const foot = footBones[i];
      const dx = i === 0 ? -0.1 : 0.1;
      if (mt === "plate") {
        const boot = new THREE.Mesh(bootPlateGeo, mat);
        const cuff = new THREE.Mesh(bootCuffGeo, mat);
        if (foot) {
          boot.position.set(0, 0.03, 0.03); foot.add(boot);
          cuff.position.set(0, 0.1, 0); foot.add(cuff);
        } else {
          boot.position.set(dx, 0.07, 0.03); group.add(boot);
          cuff.position.set(dx, 0.16, 0); group.add(cuff);
        }
      } else {
        const boot = new THREE.Mesh(bootLeatherGeo, mat);
        if (foot) {
          boot.position.set(0, 0.04, 0.02); foot.add(boot);
        } else {
          boot.position.set(dx, 0.09, 0.02); group.add(boot);
        }
      }
    }
  }

  // ── Gloves — child of arm groups so they swing with arms ──
  if (eq.gloves) {
    const mt = inferArmorMaterial(eq.gloves.name ?? "");
    const mat = makeArmorMat(mt, eq.gloves.quality);
    const armRefs = [leftArm, rightArm];
    for (let i = 0; i < 2; i++) {
      const arm = armRefs[i];
      const dx = i === 0 ? -1 : 1;
      if (mt === "plate") {
        const gaunt = new THREE.Mesh(gauntletGeo, mat);
        const cuff = new THREE.Mesh(gauntletCuffGeo, mat);
        if (arm) { gaunt.position.set(0, -0.38, 0); arm.add(gaunt); cuff.position.set(0, -0.3, 0); arm.add(cuff); }
        else { gaunt.position.set(dx * 0.38, 0.62, 0); group.add(gaunt); cuff.position.set(dx * 0.38, 0.7, 0); group.add(cuff); }
      } else {
        const glove = new THREE.Mesh(gloveLeatherGeo, mat);
        if (arm) { glove.position.set(0, -0.4, 0); arm.add(glove); }
        else { glove.position.set(dx * 0.38, 0.62, 0); group.add(glove); }
      }
    }
  }

  // ── Belt ──
  if (eq.belt) {
    const mt = inferArmorMaterial(eq.belt.name ?? "");
    const mat = makeArmorMat(mt, eq.belt.quality);

    const beltTarget = rig?.hip ?? group;
    const beltOffY = rig ? 0.08 : 0.52;
    if (mt === "plate") {
      const ring = new THREE.Mesh(beltGeo, mat);
      ring.position.y = beltOffY; ring.rotation.x = Math.PI / 2;
      ring.scale.set(cls.sx, cls.sz, 1); beltTarget.add(ring);
      const buckle = new THREE.Mesh(beltBuckleGeo, mat);
      buckle.position.set(0, beltOffY, 0.27 * cls.sz); beltTarget.add(buckle);
    } else {
      const ring = new THREE.Mesh(beltThinGeo, mat);
      ring.position.y = beltOffY; ring.rotation.x = Math.PI / 2;
      ring.scale.set(cls.sx, cls.sz, 1); beltTarget.add(ring);
      if (mt === "leather") {
        const pouchMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: 0x6B5533 });
        for (const side of [-1, 1]) {
          const pouch = new THREE.Mesh(beltPouchGeo, pouchMat);
          pouch.position.set(side * 0.22 * cls.sx, beltOffY - 0.04, 0.05); beltTarget.add(pouch);
        }
      }
      const buckle = new THREE.Mesh(beltBuckleGeo, mat);
      buckle.position.set(0, beltOffY, 0.26 * cls.sz); beltTarget.add(buckle);
    }
  }
}

function buildWeaponMesh(weaponType: WeaponType, metalColor: number, emissiveColor: number): THREE.Group {
  const g = new THREE.Group();
  const metalMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: metalColor, emissive: emissiveColor, emissiveIntensity: emissiveColor ? 0.3 : 0 });
  const handleMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: 0x664422 });
  const accentMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: metalColor, emissive: emissiveColor, emissiveIntensity: emissiveColor ? 0.5 : 0 });

  switch (weaponType) {
    case "sword": {
      const blade = new THREE.Mesh(swordBladeGeo, metalMat);
      blade.position.y = 0.32; blade.castShadow = true; g.add(blade);
      // Taper the blade tip by scaling top verts isn't trivial with box — use a subtle rotation
      const guard = new THREE.Mesh(swordGuardGeo, accentMat);
      guard.position.y = 0.04; g.add(guard);
      const handle = new THREE.Mesh(swordHandleGeo, handleMat);
      handle.position.y = -0.07; g.add(handle);
      const pommel = new THREE.Mesh(swordPommelGeo, accentMat);
      pommel.position.y = -0.17; g.add(pommel);
      break;
    }
    case "axe": {
      const handle = new THREE.Mesh(axeHandleGeo, handleMat);
      handle.castShadow = true; g.add(handle);
      const head = new THREE.Mesh(axeHeadGeo, metalMat);
      head.position.set(0.02, 0.22, 0); head.castShadow = true; g.add(head);
      break;
    }
    case "staff": {
      const pole = new THREE.Mesh(staffPoleGeo, handleMat);
      pole.castShadow = true; g.add(pole);
      const orb = new THREE.Mesh(staffOrbGeo, accentMat);
      orb.position.y = 0.52; g.add(orb);
      // Small ring below orb
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.045, 0.01, 6, 10),
        metalMat,
      );
      ring.position.y = 0.44; ring.rotation.x = Math.PI / 2; g.add(ring);
      break;
    }
    case "bow": {
      const limb = new THREE.Mesh(bowLimbGeo, handleMat);
      limb.rotation.z = Math.PI / 2; limb.position.y = 0.05;
      limb.castShadow = true; g.add(limb);
      const string = new THREE.Mesh(bowStringGeo, new THREE.MeshBasicMaterial({ color: 0xccccaa }));
      string.position.set(-0.18, 0.05, 0); g.add(string);
      // Arrow nocked
      const arrowShaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.45, 4),
        new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: 0x886644 }),
      );
      arrowShaft.position.set(-0.16, 0.05, 0); arrowShaft.rotation.z = Math.PI / 2; g.add(arrowShaft);
      const arrowHead = new THREE.Mesh(
        new THREE.ConeGeometry(0.02, 0.06, 4),
        metalMat,
      );
      arrowHead.position.set(-0.4, 0.05, 0); arrowHead.rotation.z = -Math.PI / 2; g.add(arrowHead);
      break;
    }
    case "dagger": {
      const blade = new THREE.Mesh(daggerBladeGeo, metalMat);
      blade.position.y = 0.18; blade.castShadow = true; g.add(blade);
      const guard = new THREE.Mesh(swordGuardGeo, accentMat);
      guard.position.y = 0.03; guard.scale.set(1, 1, 0.6); g.add(guard);
      const handle = new THREE.Mesh(daggerHandleGeo, handleMat);
      handle.position.y = -0.04; g.add(handle);
      break;
    }
    case "mace": {
      const handle = new THREE.Mesh(maceHandleGeo, handleMat);
      handle.castShadow = true; g.add(handle);
      const head = new THREE.Mesh(maceHeadGeo, metalMat);
      head.position.y = 0.3; head.castShadow = true; g.add(head);
      break;
    }
    case "pickaxe": {
      const handle = new THREE.Mesh(pickHandleGeo, handleMat);
      handle.castShadow = true; g.add(handle);
      // Point
      const point = new THREE.Mesh(pickHeadGeo, metalMat);
      point.position.set(0.12, 0.25, 0); point.rotation.z = -Math.PI / 2;
      point.castShadow = true; g.add(point);
      // Back flat
      const back = new THREE.Mesh(pickBackGeo, metalMat);
      back.position.set(-0.06, 0.25, 0); g.add(back);
      break;
    }
    case "sickle": {
      const handle = new THREE.Mesh(sickleHandleGeo, handleMat);
      handle.castShadow = true; g.add(handle);
      const blade = new THREE.Mesh(sickleBladeGeo, metalMat);
      blade.position.set(0, 0.2, 0); blade.rotation.z = -Math.PI * 0.3;
      blade.castShadow = true; g.add(blade);
      break;
    }
  }

  return g;
}

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
// New hair styles
const hairAfroGeo = new THREE.SphereGeometry(0.32, 8, 6);
const hairLocGeo = new THREE.CylinderGeometry(0.03, 0.025, 0.45, 5);
const hairCornrowGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4);
const hairKnotGeo = new THREE.SphereGeometry(0.07, 5, 4);
const hairBangsGeo = new THREE.BoxGeometry(0.38, 0.08, 0.15);
const hairTopknotGeo = new THREE.CylinderGeometry(0.04, 0.08, 0.2, 6);
const hairTopknotBunGeo = new THREE.SphereGeometry(0.08, 6, 5);
const shieldGeo = new THREE.BoxGeometry(0.04, 0.35, 0.25);
const mobBodyGeo = new THREE.CapsuleGeometry(0.3, 0.5, 4, 8);
const npcBodyGeo = new THREE.CapsuleGeometry(0.22, 0.65, 4, 8);
const oreGeo = new THREE.DodecahedronGeometry(0.35, 0);
const flowerGeo = new THREE.ConeGeometry(0.2, 0.5, 5);
const stationGeo = new THREE.BoxGeometry(0.6, 0.5, 0.6);
const gateGeo = new THREE.BoxGeometry(0.8, 1.8, 0.3);
const legGeo = new THREE.CapsuleGeometry(0.08, 0.35, 3, 6);
const thighGeo = new THREE.CapsuleGeometry(0.09, 0.15, 3, 6);
const armGeo = new THREE.CapsuleGeometry(0.055, 0.3, 3, 6);
const shoulderJointGeo = new THREE.SphereGeometry(0.07, 5, 4);
const handGeo = new THREE.SphereGeometry(0.06, 5, 4);
const hpBarBgGeo = new THREE.PlaneGeometry(0.6, 0.06);
const hpBarFgGeo = new THREE.PlaneGeometry(0.58, 0.04);

function makeLabel(text: string, color = "#ffffff"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontSize = 28;
  ctx.font = `bold ${fontSize}px monospace`;
  const measured = ctx.measureText(text);
  const padding = 20;
  canvas.width = Math.max(256, Math.ceil(measured.width) + padding * 2);
  canvas.height = 64;
  // Re-set font after resize (canvas reset clears it)
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#000000";
  ctx.fillText(text, canvas.width / 2 + 1, 39);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, 38);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(aspect * 0.5, 0.5, 1);
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

import { CharacterRig } from "./CharacterRig.js";
import { AnimationLibrary } from "./AnimationLibrary.js";

// ── Animation types ─────────────────────────────────────────────────

type AnimName = "walk" | "idle" | "attack"
  | "heroicstrike" | "cleave" | "shieldwall" | "battlerage" | "intimidatingshout" | "rallyingcry" | "rendingstrike"
  | "spellcast" | "darkcast" | "holycast"
  | "damage" | "heal" | "death" | "gather" | "craft";

/** Map technique IDs to specific animation clips (ranked versions share base clip) */
const TECHNIQUE_ANIM: Record<string, AnimName> = {
  warrior_heroic_strike: "heroicstrike",
  warrior_heroic_strike_r2: "heroicstrike",
  warrior_heroic_strike_r3: "heroicstrike",
  warrior_cleave: "cleave",
  warrior_cleave_r2: "cleave",
  warrior_shield_wall: "shieldwall",
  warrior_battle_rage: "battlerage",
  warrior_battle_rage_r2: "battlerage",
  warrior_intimidating_shout: "intimidatingshout",
  warrior_rallying_cry: "rallyingcry",
  warrior_rending_strike: "rendingstrike",
};

/** Pick the right attack animation clip based on class (fallback when no technique ID) */
function attackAnimForClass(classId: string | undefined): AnimName {
  switch (classId) {
    case "mage": return "spellcast";
    case "warlock": return "darkcast";
    case "cleric": return "holycast";
    default: return "attack";
  }
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
  prevTargetX: number;
  prevTargetZ: number;
  prevX: number;
  prevZ: number;
  targetYaw: number;
  hpBarFg: THREE.Mesh | null;
  hpBarBg: THREE.Mesh | null;
  entity: Entity;
  prevHp: number;
  bodyMesh: THREE.Mesh | null;
  headMesh: THREE.Mesh | null;
  isMoving: boolean;
  movingSmooth: number;
  // Rig + animation
  rig: CharacterRig | null;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  currentAnim: AnimName | null;
  /** Bones needed for old-style references (armor attach, etc.) */
  leftLeg: THREE.Mesh | null;
  rightLeg: THREE.Mesh | null;
  leftArm: THREE.Group | null;   // kept as alias → rig L_Shoulder bone
  rightArm: THREE.Group | null;  // kept as alias → rig R_Shoulder bone
  /** True if this entity uses a GLB model instead of the procedural rig */
  hasGlbModel: boolean;
  /** Timer for simple GLB attack animation (lunge + pulse) */
  glbAttackTimer: number;
}

export class EntityManager {
  readonly group = new THREE.Group();
  private entities = new Map<string, EntityObject>();
  private floatingTexts: FloatingText[] = [];
  private elevationProvider: ElevationProvider | null = null;
  private envAssets: EnvironmentAssets | null = null;

  constructor() {
    this.group.name = "entities";
  }

  /** Link to environment assets for GLB ore/resource models */
  setEnvironmentAssets(assets: EnvironmentAssets) {
    this.envAssets = assets;
  }

  /** Link to an elevation provider (WorldManager or TerrainRenderer) */
  setElevationProvider(ep: ElevationProvider) {
    this.elevationProvider = ep;
  }

  /** Convert server world coords to 3D world coords */
  private toLocal(serverX: number, serverY: number): { x: number; z: number } {
    return {
      x: serverX * COORD_SCALE,
      z: serverY * COORD_SCALE,
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
          g.position.x = obj.targetX;
          g.position.z = obj.targetZ;
        } else {
          const f = step / dist;
          g.position.x += toX * f;
          g.position.z += toZ * f;
        }
      }

      // Sample terrain elevation so entities sit on the ground
      if (this.elevationProvider) {
        const targetY = this.elevationProvider.getElevationAt(g.position.x, g.position.z);
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

      // Only update yaw if actually moving
      if (moveDist > 0.001) {
        obj.targetYaw = Math.atan2(dx, dz);
      }

      // Smooth yaw rotation (shortest path) — skip during combat/cast/death anims
      const curAnim = obj.currentAnim;
      const freeYaw = curAnim === null || curAnim === "walk" || curAnim === "idle" || curAnim === "gather" || curAnim === "craft";
      if (freeYaw) {
        let yawDiff = obj.targetYaw - g.rotation.y;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        g.rotation.y += yawDiff * Math.min(10 * dt, 1);
      }

      // ── Animation blending via mixer ──
      if (obj.mixer && obj.rig) {
        // Pick the right locomotion animation
        const isOneShot = curAnim && curAnim !== "walk" && curAnim !== "idle";
        if (!isOneShot) {
          const wantAnim: AnimName = obj.movingSmooth > 0.1 ? "walk" : "idle";
          if (curAnim !== wantAnim) {
            this.playAnimation(obj, wantAnim, true);
          }
        }
        obj.mixer.update(dt);
      }

      // ── GLB mob attack animation (lunge + scale pulse) ──
      if (obj.hasGlbModel && obj.glbAttackTimer > 0) {
        obj.glbAttackTimer -= dt;
        const t = Math.max(0, obj.glbAttackTimer);
        const total = 0.4; // duration
        const progress = 1 - t / total;
        // Quick lunge forward then snap back
        const lunge = progress < 0.4 ? progress / 0.4 : 1 - (progress - 0.4) / 0.6;
        const glbChild = g.getObjectByName("glb_mob");
        if (glbChild) {
          // Lunge forward in facing direction
          glbChild.position.z = lunge * 0.5;
          // Scale pulse
          const pulse = 1 + Math.sin(progress * Math.PI) * 0.15;
          glbChild.scale.setScalar(pulse);
        }
        if (obj.glbAttackTimer <= 0) {
          // Reset
          if (glbChild) {
            glbChild.position.z = 0;
            glbChild.scale.setScalar(1);
          }
        }
      }

      // Billboard HP bars toward camera
      if (camera && obj.hpBarBg) {
        obj.hpBarBg.lookAt(camera.position);
        obj.hpBarFg!.lookAt(camera.position);
      }
    }

    // ── Entity push-apart (prevent visual overlap) ──
    const entArr = Array.from(this.entities.values());
    const PUSH_RADIUS = 0.6;
    const PUSH_STRENGTH = 3.0;
    for (let i = 0; i < entArr.length; i++) {
      const a = entArr[i];
      for (let j = i + 1; j < entArr.length; j++) {
        const b = entArr[j];
        const dx = a.group.position.x - b.group.position.x;
        const dz = a.group.position.z - b.group.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < PUSH_RADIUS * PUSH_RADIUS && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const overlap = PUSH_RADIUS - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          const push = overlap * PUSH_STRENGTH * dt;
          a.group.position.x += nx * push * 0.5;
          a.group.position.z += nz * push * 0.5;
          b.group.position.x -= nx * push * 0.5;
          b.group.position.z -= nz * push * 0.5;
        }
      }
    }

    // Update floating text
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.elapsed += dt;
      const t = ft.elapsed / 1.2;
      ft.sprite.position.y = ft.startY + t * 2;
      (ft.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
      if (t >= 1) {
        ft.sprite.parent?.remove(ft.sprite);
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  // ── Animation playback helpers ──────────────────────────────────────

  private playAnimation(obj: EntityObject, name: AnimName, loop: boolean, onFinish?: () => void) {
    if (!obj.mixer) return;

    // Get or create the action
    let action = obj.actions.get(name);
    if (!action) {
      const clip = AnimationLibrary.get(name);
      if (!clip) return;
      action = obj.mixer.clipAction(clip);
      obj.actions.set(name, action);
    }

    action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
    action.clampWhenFinished = !loop;

    // Crossfade from current
    const current = obj.currentAnim ? obj.actions.get(obj.currentAnim) : null;
    if (current && current !== action) {
      action.reset();
      action.play();
      current.crossFadeTo(action, 0.15, true);
    } else {
      action.reset();
      action.play();
    }

    obj.currentAnim = name;

    // One-shot: return to idle/walk when done
    if (!loop) {
      const mixer = obj.mixer;
      const handler = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== action) return;
        mixer.removeEventListener("finished", handler);
        onFinish?.();
        // Return to locomotion
        const nextAnim: AnimName = obj.movingSmooth > 0.1 ? "walk" : "idle";
        this.playAnimation(obj, nextAnim, true);
      };
      mixer.addEventListener("finished", handler);
    }
  }

  private playOneShot(obj: EntityObject, name: AnimName, onFinish?: () => void) {
    this.playAnimation(obj, name, false, onFinish);
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
    // GLB mob damage: flash red on all meshes
    if (obj.hasGlbModel) {
      const glbRoot = obj.group.getObjectByName("glb_mob");
      if (glbRoot) {
        glbRoot.traverse((c) => {
          if (c instanceof THREE.Mesh && c.material) {
            const mat = c.material as THREE.MeshStandardMaterial;
            if (mat.emissive) {
              mat.emissive.setHex(0xff2200);
              mat.emissiveIntensity = 0.8;
              const start = performance.now();
              const fade = () => {
                const t = (performance.now() - start) / 400;
                if (t >= 1) { mat.emissive.setHex(0x000000); mat.emissiveIntensity = 0; return; }
                mat.emissiveIntensity = 0.8 * (1 - t);
                requestAnimationFrame(fade);
              };
              requestAnimationFrame(fade);
            }
          }
        });
      }
    }

    this.playOneShot(obj, "damage");

    // Flash body emissive
    if (obj.bodyMesh) {
      const mat = obj.bodyMesh.material as THREE.MeshToonMaterial;
      if (mat.emissive) {
        mat.emissive.setHex(0xff2200);
        mat.emissiveIntensity = 0.7;
        // Fade out over 0.5s
        const startTime = performance.now();
        const fadeEmissive = () => {
          const elapsed = (performance.now() - startTime) / 500;
          if (elapsed >= 1) { mat.emissive.setHex(0x000000); mat.emissiveIntensity = 0; return; }
          mat.emissiveIntensity = 0.7 * (1 - elapsed);
          requestAnimationFrame(fadeEmissive);
        };
        requestAnimationFrame(fadeEmissive);
      }
    }

    // Floating damage number
    const ft = makeFloatingText(`-${amount}`, "#ff4444");
    ft.position.set(0, 2.0, 0);
    obj.group.add(ft);
    this.floatingTexts.push({ sprite: ft, elapsed: 0, startY: 2.0 });

    // If attacker nearby, trigger their attack anim (class-specific)
    for (const other of this.entities.values()) {
      if (other === obj) continue;
      if (other.entity.type !== "player" && other.entity.type !== "mob" && other.entity.type !== "boss") continue;
      const dx = other.group.position.x - obj.group.position.x;
      const dz = other.group.position.z - obj.group.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const atkAnim = attackAnimForClass(other.entity.classId);
      if (dist < 3 && other.currentAnim !== atkAnim) {
        // Face target then attack
        other.targetYaw = Math.atan2(
          obj.group.position.x - other.group.position.x,
          obj.group.position.z - other.group.position.z,
        );
        if (other.hasGlbModel) {
          // GLB mob: simple lunge + pulse attack
          other.glbAttackTimer = 0.4;
        } else {
          this.playOneShot(other, atkAnim);
        }
        break;
      }
    }
  }

  private triggerHeal(obj: EntityObject, amount: number) {
    this.playOneShot(obj, "heal");

    // Green glow
    if (obj.bodyMesh) {
      const mat = obj.bodyMesh.material as THREE.MeshToonMaterial;
      if (mat.emissive) {
        mat.emissive.setHex(0x44ff66);
        mat.emissiveIntensity = 0.6;
        const startTime = performance.now();
        const fadeEmissive = () => {
          const elapsed = (performance.now() - startTime) / 800;
          if (elapsed >= 1) { mat.emissive.setHex(0x000000); mat.emissiveIntensity = 0; return; }
          mat.emissiveIntensity = 0.6 * (1 - elapsed);
          requestAnimationFrame(fadeEmissive);
        };
        requestAnimationFrame(fadeEmissive);
      }
    }

    const ft = makeFloatingText(`+${amount}`, "#44ff66");
    ft.position.set(0, 2.0, 0);
    obj.group.add(ft);
    this.floatingTexts.push({ sprite: ft, elapsed: 0, startY: 2.0 });
  }

  private triggerDeath(obj: EntityObject) {
    this.playOneShot(obj, "death", () => {
      // After death anim: fade out completely then hide (despawn)
      const startTime = performance.now();
      const fadeDuration = 600; // ms
      // Make all materials transparent for fade
      obj.group.traverse((child) => {
        if ((child as THREE.Mesh).material) {
          const mat = (child as THREE.Mesh).material as THREE.Material;
          mat.transparent = true;
        }
      });
      const fadeOut = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / fadeDuration);
        const opacity = 1 - t;
        // Also sink slightly into the ground
        obj.group.position.y -= 0.003;
        obj.group.traverse((child) => {
          if ((child as THREE.Mesh).material) {
            const mat = (child as THREE.Mesh).material as THREE.Material;
            mat.opacity = opacity;
          }
        });
        if (t < 1) {
          requestAnimationFrame(fadeOut);
        } else {
          // Fully despawned — hide until server removes or respawns
          obj.group.visible = false;
        }
      };
      requestAnimationFrame(fadeOut);
    });
  }

  /** Trigger gather/craft anims from zone events */
  processEvents(events: import("../types.js").ZoneEvent[]) {
    for (const ev of events) {
      if (ev.type === "loot" && ev.entityId && ev.data?.gatherType) {
        const obj = this.entities.get(ev.entityId);
        if (obj && obj.currentAnim !== "gather") {
          this.playOneShot(obj, "gather");
        }
      }
      if (ev.type === "loot" && ev.entityId && ev.data?.craftType) {
        const obj = this.entities.get(ev.entityId);
        if (obj && obj.currentAnim !== "craft") {
          this.playOneShot(obj, "craft");
        }
      }
      // Ability events: play technique-specific animation on the caster
      if (ev.type === "ability" && ev.entityId) {
        const obj = this.entities.get(ev.entityId);
        if (!obj) continue;
        const techniqueId = ev.data?.techniqueId as string | undefined;
        if (techniqueId && TECHNIQUE_ANIM[techniqueId]) {
          const anim = TECHNIQUE_ANIM[techniqueId];
          if (obj.currentAnim !== anim) {
            // Face target if available
            if (ev.targetId) {
              const target = this.entities.get(ev.targetId);
              if (target) {
                obj.targetYaw = Math.atan2(
                  target.group.position.x - obj.group.position.x,
                  target.group.position.z - obj.group.position.z,
                );
              }
            }
            this.playOneShot(obj, anim);
          }
        }
      }
    }
  }


  // ── Entity creation ───────────────────────────────────────────────

  private createEntity(ent: Entity): EntityObject {
    const group = new THREE.Group();
    group.userData.entityId = ent.id;

    const pos = this.toLocal(ent.x, ent.y);
    const elev = this.elevationProvider?.getElevationAt(pos.x, pos.z) ?? 0;
    group.position.set(pos.x, elev, pos.z);

    const info = ENTITY_STYLE[ent.type] ?? { color: 0x888888, style: "object" };
    let bodyMesh: THREE.Mesh | null = null;
    let headMesh: THREE.Mesh | null = null;
    let leftLeg: THREE.Mesh | null = null;
    let rightLeg: THREE.Mesh | null = null;
    let leftArm: THREE.Group | null = null;
    let rightArm: THREE.Group | null = null;
    let rig: CharacterRig | null = null;
    let mixer: THREE.AnimationMixer | null = null;

    switch (info.style) {
      case "humanoid": {
        const result = ent.type === "player"
          ? this.buildPlayer(group, ent)
          : this.buildNpc(group, ent, info.color);
        bodyMesh = result.body;
        headMesh = result.head;
        leftLeg = result.leftLeg;
        rightLeg = result.rightLeg;
        leftArm = result.leftArm;
        rightArm = result.rightArm;
        rig = result.rig;
        break;
      }
      case "mob": {
        const result = this.buildMob(group, ent);
        bodyMesh = result.body;
        headMesh = result.head;
        leftLeg = result.leftLeg;
        rightLeg = result.rightLeg;
        leftArm = result.leftArm;
        rightArm = result.rightArm;
        rig = result.rig;
        break;
      }
      case "resource":
        this.buildResource(group, ent, info.color);
        break;
      case "object":
        this.buildObject(group, ent, info.color);
        break;
    }

    // Set up animation mixer if rigged
    if (rig) {
      mixer = new THREE.AnimationMixer(rig.rootBone);
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
      const labelText = ent.level ? `${ent.name} [Lv${ent.level}]` : ent.name;
      const label = makeLabel(labelText, labelColor);
      label.position.y = labelY + 0.3;
      group.add(label);
    } else if (ent.type !== "corpse") {
      const label = makeLabel(ent.name, "#aaaaaa");
      label.position.y = 1.2;
      label.scale.set(1.5, 0.4, 1);
      group.add(label);
    }

    return {
      group, targetX: pos.x, targetZ: pos.z, prevTargetX: pos.x, prevTargetZ: pos.z,
      prevX: pos.x, prevZ: pos.z, targetYaw: 0, hpBarFg, hpBarBg, entity: ent,
      prevHp: ent.hp, bodyMesh, headMesh,
      isMoving: false, movingSmooth: 0,
      rig, mixer, actions: new Map(), currentAnim: null,
      leftLeg, rightLeg, leftArm, rightArm,
      hasGlbModel: !!(group as any)._hasGlbModel,
      glbAttackTimer: 0,
    };
  }

  // ── Hair builder (bone-relative: Y=0 is head center) ─────────────

  private buildHairOnBone(bone: THREE.Bone, style: string, mat: THREE.MeshToonMaterial) {
    // Offsets are relative to head bone (Y=0 at head center)
    this.buildHair(bone, style, mat, 0);
  }

  // ── Hair builder (all 12 styles) ─────────────────────────────────

  private buildHair(group: THREE.Object3D, style: string, mat: THREE.MeshToonMaterial, headY: number) {
    switch (style) {
      case "short": {
        const h = new THREE.Mesh(hairShortGeo, mat);
        h.position.set(0, headY + 0.1, 0);
        group.add(h);
        break;
      }
      case "long": {
        // Full cap + back drape
        const cap = new THREE.Mesh(hairShortGeo, mat);
        cap.position.set(0, headY + 0.1, 0); group.add(cap);
        const drape = new THREE.Mesh(hairLongGeo, mat);
        drape.position.set(0, headY + 0.05, -0.12); group.add(drape);
        break;
      }
      case "mohawk": {
        const h = new THREE.Mesh(hairMohawkGeo, mat);
        h.position.set(0, headY + 0.25, 0);
        group.add(h);
        break;
      }
      case "ponytail": {
        const top = new THREE.Mesh(hairShortGeo, mat);
        top.position.set(0, headY + 0.1, 0); group.add(top);
        const tail = new THREE.Mesh(hairLongGeo, mat);
        tail.position.set(0, headY - 0.15, -0.2); tail.rotation.x = 0.3;
        group.add(tail);
        break;
      }
      case "braided": {
        const top = new THREE.Mesh(hairShortGeo, mat);
        top.position.set(0, headY + 0.1, 0); group.add(top);
        // Two braids hanging down
        for (const dx of [-0.12, 0.12]) {
          const b = new THREE.Mesh(hairBraidedGeo, mat);
          b.position.set(dx, headY - 0.25, -0.1); group.add(b);
        }
        break;
      }
      case "locs": {
        // Many thin cylindrical locs hanging from scalp
        const cap = new THREE.Mesh(hairShortGeo, mat);
        cap.position.set(0, headY + 0.1, 0); cap.scale.set(1, 0.6, 1);
        group.add(cap);
        const angles = [0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9, 5.6];
        for (const a of angles) {
          const loc = new THREE.Mesh(hairLocGeo, mat);
          const r = 0.16;
          loc.position.set(
            Math.sin(a) * r,
            headY - 0.1,
            Math.cos(a) * r - 0.03,
          );
          loc.rotation.x = Math.cos(a) * 0.15;
          loc.rotation.z = Math.sin(a) * 0.15;
          group.add(loc);
        }
        break;
      }
      case "afro": {
        const h = new THREE.Mesh(hairAfroGeo, mat);
        h.position.set(0, headY + 0.08, 0);
        group.add(h);
        break;
      }
      case "cornrows": {
        // Parallel rows running front to back
        for (const dx of [-0.12, -0.06, 0, 0.06, 0.12]) {
          const row = new THREE.Mesh(hairCornrowGeo, mat);
          row.position.set(dx, headY + 0.08, -0.05);
          row.rotation.x = Math.PI / 2 * 0.3; // slight tilt back
          group.add(row);
        }
        // Back nape extension
        for (const dx of [-0.09, -0.03, 0.03, 0.09]) {
          const tail = new THREE.Mesh(hairCornrowGeo, mat);
          tail.position.set(dx, headY - 0.12, -0.15);
          tail.scale.set(1, 0.6, 1);
          group.add(tail);
        }
        break;
      }
      case "bantu-knots": {
        // 5-7 small spherical knots arranged on top of head
        const positions: [number, number, number][] = [
          [0, headY + 0.22, 0],
          [-0.13, headY + 0.15, 0.05],
          [0.13, headY + 0.15, 0.05],
          [-0.1, headY + 0.15, -0.1],
          [0.1, headY + 0.15, -0.1],
          [0, headY + 0.12, -0.14],
        ];
        for (const [kx, ky, kz] of positions) {
          const knot = new THREE.Mesh(hairKnotGeo, mat);
          knot.position.set(kx, ky, kz);
          group.add(knot);
        }
        break;
      }
      case "bangs": {
        // Full cap + front bangs piece
        const cap = new THREE.Mesh(hairShortGeo, mat);
        cap.position.set(0, headY + 0.1, 0); group.add(cap);
        const fringe = new THREE.Mesh(hairBangsGeo, mat);
        fringe.position.set(0, headY + 0.02, 0.16); group.add(fringe);
        // Side drape
        const drape = new THREE.Mesh(hairLongGeo, mat);
        drape.position.set(0, headY + 0.02, -0.1); group.add(drape);
        break;
      }
      case "topknot": {
        // Shaved sides + tied bun on top
        const base = new THREE.Mesh(hairTopknotGeo, mat);
        base.position.set(0, headY + 0.18, 0); group.add(base);
        const bun = new THREE.Mesh(hairTopknotBunGeo, mat);
        bun.position.set(0, headY + 0.3, 0); group.add(bun);
        break;
      }
      default: {
        // Fallback to short
        const h = new THREE.Mesh(hairShortGeo, mat);
        h.position.set(0, headY + 0.1, 0);
        group.add(h);
        break;
      }
    }
  }

  // ── Player ────────────────────────────────────────────────────────

  private buildPlayer(group: THREE.Group, ent: Entity): { body: THREE.Mesh; head: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh; leftArm: THREE.Group; rightArm: THREE.Group; rig: CharacterRig } {
    const skinHex = SKIN_COLORS[ent.skinColor ?? "medium"] ?? 0xd4a574;
    const classId = ent.classId ?? "warrior";
    const cls = CLASS_BODY[classId] ?? CLASS_BODY.warrior;
    const isFemale = ent.gender === "female";

    // Gender body modifiers
    const gsx = isFemale ? 0.88 : 1.0;
    const gsy = isFemale ? 0.95 : 1.0;
    const gsz = isFemale ? 0.92 : 1.0;
    const armScale = isFemale ? 0.9 : 1.0;
    const headScale = isFemale ? 0.95 : 1.0;

    // ── Build skeleton ──
    const rig = new CharacterRig({
      shoulderWidth: 0.3 * cls.sx * gsx,
      hipWidth: isFemale ? 0.12 : 0.1,
      isFemale,
    });
    group.add(rig.rootBone);

    // ── Attach visual meshes to bones ──

    // Body → Chest bone
    const bodyMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: cls.color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.scale.set(cls.sx * gsx, cls.sy * gsy, cls.sz * gsz);
    body.castShadow = true;
    rig.chest.add(body);

    // Head → Head bone
    const head = new THREE.Mesh(headGeo, new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: skinHex }));
    head.scale.setScalar(headScale);
    rig.head.add(head);

    // Eyes → Head bone
    const eyeHex = EYE_COLORS[ent.eyeColor ?? "brown"] ?? 0x6b3a1f;
    const eyeMat = new THREE.MeshBasicMaterial({ color: eyeHex });
    for (const dx of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(dx * headScale, 0.03, 0.17 * headScale);
      rig.head.add(eye);
    }

    // Hair → Head bone
    const style = ent.hairStyle ?? "short";
    if (style !== "bald") {
      const hairHex = HAIR_COLORS[style] ?? 0x4a3728;
      const hairMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: hairHex });
      this.buildHairOnBone(rig.head, style, hairMat);
    }

    // Legs → thigh on hip bones, shin on knee bones
    const legMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: skinHex });
    const lThigh = new THREE.Mesh(thighGeo, legMat);
    lThigh.position.y = -0.10;
    if (isFemale) lThigh.scale.set(0.95, 1.05, 0.95);
    rig.lHip.add(lThigh);
    const rThigh = new THREE.Mesh(thighGeo, legMat);
    rThigh.position.y = -0.10;
    if (isFemale) rThigh.scale.set(0.95, 1.05, 0.95);
    rig.rHip.add(rThigh);
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    if (isFemale) leftLeg.scale.set(0.9, 1.05, 0.9);
    leftLeg.position.y = -0.12;
    rig.lKnee.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    if (isFemale) rightLeg.scale.set(0.9, 1.05, 0.9);
    rightLeg.position.y = -0.12;
    rig.rKnee.add(rightLeg);

    // Arms + hands → shoulder/hand bones
    const skinMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: skinHex });

    // Shoulder joints to bridge chest→arm gap
    const lShoulderJoint = new THREE.Mesh(shoulderJointGeo, skinMat);
    rig.lShoulder.add(lShoulderJoint);
    const rShoulderJoint = new THREE.Mesh(shoulderJointGeo, skinMat);
    rig.rShoulder.add(rShoulderJoint);

    const lUpperArm = new THREE.Mesh(armGeo, skinMat);
    lUpperArm.position.y = -0.15; lUpperArm.scale.setScalar(armScale);
    rig.lArm.add(lUpperArm);
    const lHand = new THREE.Mesh(handGeo, skinMat);
    lHand.scale.setScalar(armScale);
    rig.lHand.add(lHand);

    const rUpperArm = new THREE.Mesh(armGeo, skinMat);
    rUpperArm.position.y = -0.15; rUpperArm.scale.setScalar(armScale);
    rig.rArm.add(rUpperArm);
    const rHand = new THREE.Mesh(handGeo, skinMat);
    rHand.scale.setScalar(armScale);
    rig.rHand.add(rHand);

    // Weapon → right hand bone
    if (ent.equipment?.weapon) {
      const eq = ent.equipment.weapon;
      const wType = inferWeaponType(eq.name ?? "sword");
      const quality = eq.quality ?? "common";
      const metalHex = QUALITY_COLORS[quality] ?? QUALITY_COLORS.common;
      const emHex = QUALITY_EMISSIVE[quality] ?? 0x000000;
      const wpn = buildWeaponMesh(wType, metalHex, emHex);

      if (wType === "bow") {
        wpn.position.set(0, -0.1, -0.1);
      } else if (wType === "staff") {
        wpn.position.set(0, 0.2, 0); wpn.rotation.z = 0.05;
      } else if (wType === "axe") {
        // Axe: grip near bottom of handle, blade faces forward
        wpn.position.set(0, 0.1, 0.05);
        wpn.rotation.set(0.1, 0, -0.1);
      } else if (wType === "mace") {
        wpn.position.set(0, 0.05, 0);
        wpn.rotation.z = -0.1;
      } else if (wType === "pickaxe") {
        wpn.position.set(0, 0.08, 0.05);
        wpn.rotation.set(0.1, 0, -0.1);
      } else if (wType === "dagger") {
        wpn.position.set(0, -0.02, 0);
        wpn.rotation.z = -0.1;
      } else {
        // Sword and others
        wpn.position.set(0, -0.05, 0); wpn.rotation.z = -0.15;
      }
      rig.rHand.add(wpn);
    }

    // Shield on left hand for paladin/warrior
    if (classId === "paladin" || classId === "warrior") {
      const s = new THREE.Mesh(shieldGeo, new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: cls.color }));
      s.position.set(0, -0.05, 0.1);
      rig.lHand.add(s);
    }

    // Alias arm bones as Groups for armor attachment compatibility
    const leftArm = rig.lShoulder as unknown as THREE.Group;
    const rightArm = rig.rShoulder as unknown as THREE.Group;

    // Procedural armor pieces — pass rig so pieces attach to bones
    addArmorPieces(group, ent, cls, leftArm, rightArm, leftLeg, rightLeg, rig);

    return { body, head, leftLeg, rightLeg, leftArm, rightArm, rig };
  }

  // ── Mob ───────────────────────────────────────────────────────────

  private buildMob(group: THREE.Group, ent: Entity): { body: THREE.Mesh; head: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh; leftArm: THREE.Group; rightArm: THREE.Group; rig: CharacterRig } {
    const isBoss = ent.type === "boss";
    const color = isBoss ? 0xaa33ff : 0xcc4444;
    const s = isBoss ? 1.4 : 1.0;

    // Try GLB mob model first
    if (this.envAssets?.isReady()) {
      const assetName = this.envAssets.getAssetForMob(ent.name);
      if (assetName) {
        const model = this.envAssets.place(assetName, 0, 0, 0);
        if (model) {
          model.name = "glb_mob";
          group.add(model);
          // Return dummy rig refs — GLB mobs don't use the bone animation system
          const dummyMesh = new THREE.Mesh();
          const dummyGroup = new THREE.Group();
          const rig = new CharacterRig({ scale: s });
          (group as any)._hasGlbModel = true;
          return { body: dummyMesh, head: dummyMesh, leftLeg: dummyMesh, rightLeg: dummyMesh, leftArm: dummyGroup, rightArm: dummyGroup, rig };
        }
      }
    }

    // Primitive fallback
    const mat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color });

    const rig = new CharacterRig({
      scale: s,
      shoulderWidth: 0.35,
      hipWidth: 0.12,
    });
    group.add(rig.rootBone);

    // Body → Chest
    const body = new THREE.Mesh(mobBodyGeo, mat);
    body.castShadow = true;
    rig.chest.add(body);

    // Head → Head bone
    const head = new THREE.Mesh(headGeo, mat);
    head.scale.setScalar(0.9);
    rig.head.add(head);

    // Eyes → Head bone
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    for (const dx of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(dx, 0.03, 0.15);
      rig.head.add(eye);
    }

    // Legs → thigh on hip bones, shin on knee bones
    const lThigh = new THREE.Mesh(thighGeo, mat);
    lThigh.position.y = -0.10;
    rig.lHip.add(lThigh);
    const rThigh = new THREE.Mesh(thighGeo, mat);
    rThigh.position.y = -0.10;
    rig.rHip.add(rThigh);
    const leftLeg = new THREE.Mesh(legGeo, mat);
    leftLeg.position.y = -0.12;
    rig.lKnee.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, mat);
    rightLeg.position.y = -0.12;
    rig.rKnee.add(rightLeg);

    // Arms + claws → shoulder joint + arm/hand bones
    const lShoulderJoint = new THREE.Mesh(shoulderJointGeo, mat);
    rig.lShoulder.add(lShoulderJoint);
    const rShoulderJoint = new THREE.Mesh(shoulderJointGeo, mat);
    rig.rShoulder.add(rShoulderJoint);
    const lArm = new THREE.Mesh(armGeo, mat);
    lArm.position.y = -0.15;
    rig.lArm.add(lArm);
    const lClaw = new THREE.Mesh(handGeo, mat);
    rig.lHand.add(lClaw);

    const rArm = new THREE.Mesh(armGeo, mat);
    rArm.position.y = -0.15;
    rig.rArm.add(rArm);
    const rClaw = new THREE.Mesh(handGeo, mat);
    rig.rHand.add(rClaw);

    if (isBoss) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.25, 5), new THREE.MeshBasicMaterial({ color: 0xffdd00 }));
      crown.position.y = 0.2;
      rig.head.add(crown);
    }

    const leftArm = rig.lShoulder as unknown as THREE.Group;
    const rightArm = rig.rShoulder as unknown as THREE.Group;

    return { body, head, leftLeg, rightLeg, leftArm, rightArm, rig };
  }

  // ── NPC ───────────────────────────────────────────────────────────

  private buildNpc(group: THREE.Group, ent: Entity, color: number): { body: THREE.Mesh; head: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh; leftArm: THREE.Group; rightArm: THREE.Group; rig: CharacterRig } {
    const mat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color });

    const rig = new CharacterRig({
      shoulderWidth: 0.27,
      hipWidth: 0.09,
    });
    group.add(rig.rootBone);

    // Legs → thigh on hip bones, shin on knee bones
    const legMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: 0x555566 });
    const lThigh = new THREE.Mesh(thighGeo, legMat);
    lThigh.position.y = -0.10;
    rig.lHip.add(lThigh);
    const rThigh = new THREE.Mesh(thighGeo, legMat);
    rThigh.position.y = -0.10;
    rig.rHip.add(rThigh);
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.y = -0.12;
    rig.lKnee.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.y = -0.12;
    rig.rKnee.add(rightLeg);

    // Body → Chest bone
    const body = new THREE.Mesh(npcBodyGeo, mat);
    body.castShadow = true;
    rig.chest.add(body);

    // Head → Head bone
    const skinHex = ent.skinColor ? (SKIN_COLORS[ent.skinColor] ?? color) : color;
    const skinMat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: skinHex });
    const head = new THREE.Mesh(headGeo, skinMat);
    rig.head.add(head);

    if (ent.eyeColor) {
      const eyeHex = EYE_COLORS[ent.eyeColor] ?? 0x333333;
      const eyeMat = new THREE.MeshBasicMaterial({ color: eyeHex });
      for (const dx of [-0.07, 0.07]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(dx, 0.03, 0.16);
        rig.head.add(eye);
      }
    }
    if (ent.hairStyle && ent.hairStyle !== "bald") {
      const h = new THREE.Mesh(hairShortGeo, new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: HAIR_COLORS[ent.hairStyle] ?? 0x4a3728 }));
      h.position.set(0, 0.1, 0);
      rig.head.add(h);
    }

    // Arms + hands → shoulder joint + arm/hand bones
    const lShoulderJoint = new THREE.Mesh(shoulderJointGeo, skinMat);
    rig.lShoulder.add(lShoulderJoint);
    const rShoulderJoint = new THREE.Mesh(shoulderJointGeo, skinMat);
    rig.rShoulder.add(rShoulderJoint);
    const lArm = new THREE.Mesh(armGeo, skinMat);
    lArm.position.y = -0.15;
    rig.lArm.add(lArm);
    const lHand = new THREE.Mesh(handGeo, skinMat);
    rig.lHand.add(lHand);

    const rArm = new THREE.Mesh(armGeo, skinMat);
    rArm.position.y = -0.15;
    rig.rArm.add(rArm);
    const rHand = new THREE.Mesh(handGeo, skinMat);
    rig.rHand.add(rHand);

    if (ent.type === "quest-giver") {
      const q = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), new THREE.MeshBasicMaterial({ color: 0xffdd00 }));
      q.position.y = 2.0; group.add(q);
    }
    if (ent.type === "merchant") {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.15), new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: 0xbb8833 }));
      bag.position.set(0, -0.05, 0);
      rig.rHand.add(bag);
    }

    const leftArm = rig.lShoulder as unknown as THREE.Group;
    const rightArm = rig.rShoulder as unknown as THREE.Group;

    return { body, head, leftLeg, rightLeg, leftArm, rightArm, rig };
  }

  // ── Resource node ─────────────────────────────────────────────────

  private buildResource(group: THREE.Group, ent: Entity, color: number) {
    const mat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color });
    if (ent.type === "ore-node") {
      // Try GLB ore model first
      if (this.envAssets?.isReady()) {
        const ore = this.envAssets.place("rare_ore", 0, 0, 0);
        if (ore) { group.add(ore); return; }
      }
      // Primitive fallback
      const rock = new THREE.Mesh(oreGeo, mat); rock.position.y = 0.35; rock.castShadow = true; group.add(rock);
    } else {
      // flower-node, nectar-node, crop-node — try GLB model
      if (this.envAssets?.isReady()) {
        const plant = this.envAssets.place("flower_patch", 0, 0, 0);
        if (plant) { group.add(plant); return; }
      }
      // Primitive fallback
      const flower = new THREE.Mesh(flowerGeo, mat); flower.position.y = 0.25; group.add(flower);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 4), new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: 0x448833 }));
      stem.position.y = 0; group.add(stem);
    }
  }

  // ── Object (crafting station, dungeon gate, etc.) ─────────────────

  private buildObject(group: THREE.Group, ent: Entity, color: number) {
    const mat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color });
    if (ent.type === "dungeon-gate") {
      const gate = new THREE.Mesh(gateGeo, mat); gate.position.y = 0.9; gate.castShadow = true; group.add(gate);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 12), new THREE.MeshBasicMaterial({ color: 0xff6622, transparent: true, opacity: 0.5 }));
      glow.position.y = 1.4; glow.rotation.x = Math.PI / 2; group.add(glow);
    } else if (ent.type === "campfire") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 6, 8), new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), color: 0x666666 }));
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
    for (const obj of this.entities.values()) {
      obj.mixer?.stopAllAction();
    }
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.entities.clear();
    this.floatingTexts = [];
  }
}
