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

function makeArmorMat(matType: ArmorMaterial, quality: string | undefined, opts?: { transparent?: boolean; opacity?: number }): THREE.MeshLambertMaterial {
  const q = quality ?? "common";
  // Blend quality color with material tint
  const qualCol = new THREE.Color(QUALITY_COLORS[q] ?? QUALITY_COLORS.common);
  const tintCol = new THREE.Color(ARMOR_MAT_TINT[matType]);
  qualCol.lerp(tintCol, 0.4); // 40% tint influence

  const emHex = QUALITY_EMISSIVE[q] ?? 0x000000;
  return new THREE.MeshLambertMaterial({
    color: qualCol,
    emissive: emHex,
    emissiveIntensity: emHex ? 0.25 : 0,
    transparent: opts?.transparent ?? false,
    opacity: opts?.opacity ?? 1,
  });
}

function addArmorPieces(
  group: THREE.Group, ent: Entity, cls: { sx: number; sy: number; sz: number; color: number },
  leftArm?: THREE.Group, rightArm?: THREE.Group, leftLeg?: THREE.Mesh, rightLeg?: THREE.Mesh,
) {
  const eq = ent.equipment;
  if (!eq) return;

  // ── Helm ──
  if (eq.helm) {
    const mt = inferArmorMaterial(eq.helm.name ?? "");
    const mat = makeArmorMat(mt, eq.helm.quality);

    if (mt === "plate") {
      // Full plate helm: dome + nasal + crest
      const dome = new THREE.Mesh(helmDomeGeo, mat);
      dome.position.y = 1.58; group.add(dome);
      const nasal = new THREE.Mesh(helmNasalGeo, mat);
      nasal.position.set(0, 1.48, 0.2); group.add(nasal);
      const crest = new THREE.Mesh(helmCrestGeo, mat);
      crest.position.set(0, 1.74, 0); group.add(crest);
    } else if (mt === "chain") {
      // Chain coif: droopy cap covering head and neck
      const coif = new THREE.Mesh(helmCoifGeo, mat);
      coif.position.y = 1.56; group.add(coif);
      // Slight neck drape
      const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 8), mat);
      drape.position.y = 1.38; group.add(drape);
    } else {
      // Leather cap: low-profile skullcap + brim
      const cap = new THREE.Mesh(helmCapGeo, mat);
      cap.position.y = 1.6; group.add(cap);
      const brim = new THREE.Mesh(helmBrimGeo, mat);
      brim.position.y = 1.54; group.add(brim);
    }
  }

  // ── Chest ──
  if (eq.chest) {
    const mt = inferArmorMaterial(eq.chest.name ?? "");
    if (mt === "plate") {
      // Heavy plate: thick shell, opaque
      const mat = makeArmorMat(mt, eq.chest.quality, { transparent: true, opacity: 0.75 });
      const plate = new THREE.Mesh(chestPlateGeo, mat);
      plate.position.y = 0.8;
      plate.scale.set(cls.sx * 1.15, cls.sy * 0.85, cls.sz * 1.1);
      group.add(plate);
      // Plate lines (ridges)
      const ridgeMat = makeArmorMat(mt, eq.chest.quality);
      for (const ry of [0.7, 0.85]) {
        const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.28 * cls.sx, 0.015, 4, 10), ridgeMat);
        ridge.position.y = ry; ridge.rotation.x = Math.PI / 2;
        group.add(ridge);
      }
    } else if (mt === "chain") {
      // Chainmail: slightly thinner, metallic look
      const mat = makeArmorMat(mt, eq.chest.quality, { transparent: true, opacity: 0.6 });
      const shirt = new THREE.Mesh(chestVestGeo, mat);
      shirt.position.y = 0.8;
      shirt.scale.set(cls.sx * 1.1, cls.sy * 0.88, cls.sz * 1.06);
      group.add(shirt);
    } else {
      // Leather vest: snug fit, warm tones
      const mat = makeArmorMat(mt, eq.chest.quality, { transparent: true, opacity: 0.55 });
      const vest = new THREE.Mesh(chestVestGeo, mat);
      vest.position.y = 0.8;
      vest.scale.set(cls.sx * 1.08, cls.sy * 0.82, cls.sz * 1.04);
      group.add(vest);
      // Stitching lines
      const stitchMat = new THREE.MeshLambertMaterial({ color: 0x554422 });
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.3, 0.01), stitchMat);
      stitch.position.set(0, 0.8, 0.27 * cls.sz); group.add(stitch);
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
    for (const dx of [-0.1, 0.1]) {
      if (mt === "plate") {
        const boot = new THREE.Mesh(bootPlateGeo, mat);
        boot.position.set(dx, 0.07, 0.03); group.add(boot);
        const cuff = new THREE.Mesh(bootCuffGeo, mat);
        cuff.position.set(dx, 0.16, 0); group.add(cuff);
      } else {
        const boot = new THREE.Mesh(bootLeatherGeo, mat);
        boot.position.set(dx, 0.09, 0.02); group.add(boot);
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

    if (mt === "plate") {
      // Thick war belt with buckle
      const ring = new THREE.Mesh(beltGeo, mat);
      ring.position.y = 0.52; ring.rotation.x = Math.PI / 2;
      ring.scale.set(cls.sx, cls.sz, 1); group.add(ring);
      const buckle = new THREE.Mesh(beltBuckleGeo, mat);
      buckle.position.set(0, 0.52, 0.27 * cls.sz); group.add(buckle);
    } else {
      // Thin belt with pouches (leather/chain)
      const ring = new THREE.Mesh(beltThinGeo, mat);
      ring.position.y = 0.52; ring.rotation.x = Math.PI / 2;
      ring.scale.set(cls.sx, cls.sz, 1); group.add(ring);
      // Side pouches for leather
      if (mt === "leather") {
        const pouchMat = new THREE.MeshLambertMaterial({ color: 0x6B5533 });
        for (const side of [-1, 1]) {
          const pouch = new THREE.Mesh(beltPouchGeo, pouchMat);
          pouch.position.set(side * 0.22 * cls.sx, 0.48, 0.05); group.add(pouch);
        }
      }
      const buckle = new THREE.Mesh(beltBuckleGeo, mat);
      buckle.position.set(0, 0.52, 0.26 * cls.sz); group.add(buckle);
    }
  }
}

function buildWeaponMesh(weaponType: WeaponType, metalColor: number, emissiveColor: number): THREE.Group {
  const g = new THREE.Group();
  const metalMat = new THREE.MeshLambertMaterial({ color: metalColor, emissive: emissiveColor, emissiveIntensity: emissiveColor ? 0.3 : 0 });
  const handleMat = new THREE.MeshLambertMaterial({ color: 0x664422 });
  const accentMat = new THREE.MeshLambertMaterial({ color: metalColor, emissive: emissiveColor, emissiveIntensity: emissiveColor ? 0.5 : 0 });

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
        new THREE.MeshLambertMaterial({ color: 0x886644 }),
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
const armGeo = new THREE.CapsuleGeometry(0.055, 0.3, 3, 6);
const handGeo = new THREE.SphereGeometry(0.06, 5, 4);
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
  type: "attack" | "damage" | "death" | "heal" | "ability" | "gather" | "craft";
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
  headMesh: THREE.Mesh | null;
  walkPhase: number;        // 0-2PI cycling walk animation
  idleTime: number;         // seconds spent idle (for idle anim progression)
  isMoving: boolean;        // smoothed moving flag for walk anim
  movingSmooth: number;     // 0→1 blend for walk cycle fade in/out
  leftLeg: THREE.Mesh | null;
  rightLeg: THREE.Mesh | null;
  leftArm: THREE.Group | null;
  rightArm: THREE.Group | null;
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

      // ── Walk cycle / Idle animation ──
      const hasLimbs = obj.leftLeg || obj.bodyMesh;
      if (obj.movingSmooth > 0.01 && hasLimbs) {
        // Walking
        obj.idleTime = 0;
        obj.walkPhase += dt * 10;
        const swing = Math.sin(obj.walkPhase) * 0.4 * obj.movingSmooth;

        if (obj.leftLeg && obj.rightLeg) {
          obj.leftLeg.rotation.x = swing;
          obj.rightLeg.rotation.x = -swing;
        }
        if (obj.leftArm && obj.rightArm) {
          obj.leftArm.rotation.x = -swing * 0.7;
          obj.rightArm.rotation.x = swing * 0.7;
        }
        if (obj.bodyMesh) {
          obj.bodyMesh.position.y = 0.8 + Math.abs(Math.sin(obj.walkPhase * 2)) * 0.03 * obj.movingSmooth;
        }
        // Reset head to forward during walk
        if (obj.headMesh) {
          obj.headMesh.rotation.y *= 0.85;
          obj.headMesh.rotation.x *= 0.85;
        }
      } else if (hasLimbs) {
        // Idle — accumulate idle time
        obj.idleTime += dt;
        const it = obj.idleTime;

        // Smoothly return walk pose to rest
        if (obj.leftLeg && obj.rightLeg) {
          obj.leftLeg.rotation.x *= 0.85;
          obj.rightLeg.rotation.x *= 0.85;
        }
        if (obj.leftArm) obj.leftArm.rotation.x *= 0.85;
        if (obj.rightArm) obj.rightArm.rotation.x *= 0.85;

        // ── Breathing: body + scale pulse ──
        if (obj.bodyMesh) {
          const breath = Math.sin(it * 1.8) * 0.015;
          obj.bodyMesh.position.y = 0.8 + breath;
          obj.bodyMesh.scale.z = 1 + Math.sin(it * 1.8) * 0.012; // chest expansion
        }

        // ── Weight shift: subtle side-to-side sway ──
        if (obj.leftLeg && obj.rightLeg) {
          const shift = Math.sin(it * 0.5) * 0.03;
          obj.leftLeg.rotation.z = shift;
          obj.rightLeg.rotation.z = shift;
        }

        // ── Head look-around (slow, periodic) ──
        if (obj.headMesh) {
          // Slow yaw sweep + occasional glance
          const yaw = Math.sin(it * 0.4) * 0.25 + Math.sin(it * 1.1) * 0.1;
          const pitch = Math.sin(it * 0.3 + 0.5) * 0.08;
          obj.headMesh.rotation.y += (yaw - obj.headMesh.rotation.y) * Math.min(3 * dt, 1);
          obj.headMesh.rotation.x += (pitch - obj.headMesh.rotation.x) * Math.min(3 * dt, 1);
        }

        // ── Arm idle fidget (very subtle) ──
        if (obj.leftArm && obj.rightArm) {
          const armSway = Math.sin(it * 0.7) * 0.06;
          obj.leftArm.rotation.z += (armSway - obj.leftArm.rotation.z) * Math.min(4 * dt, 1);
          obj.rightArm.rotation.z += (-armSway - obj.rightArm.rotation.z) * Math.min(4 * dt, 1);
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
    obj.anims.push({ type: "damage", elapsed: 0, duration: 0.5 });

    // Floating damage number
    const ft = makeFloatingText(`-${amount}`, "#ff4444");
    ft.position.set(0, 2.0, 0);
    obj.group.add(ft);
    this.floatingTexts.push({ sprite: ft, elapsed: 0, startY: 2.0 });

    // If attacker nearby, trigger their attack anim
    for (const other of this.entities.values()) {
      if (other === obj) continue;
      if (other.entity.type !== "player" && other.entity.type !== "mob" && other.entity.type !== "boss") continue;
      const dx = other.group.position.x - obj.group.position.x;
      const dz = other.group.position.z - obj.group.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 3 && !other.anims.some(a => a.type === "attack")) {
        other.anims.push({ type: "attack", elapsed: 0, duration: 0.55, data: { targetPos: obj.group.position.clone() } });
        break;
      }
    }
  }

  private triggerHeal(obj: EntityObject, amount: number) {
    obj.anims.push({ type: "heal", elapsed: 0, duration: 0.8 });

    const ft = makeFloatingText(`+${amount}`, "#44ff66");
    ft.position.set(0, 2.0, 0);
    obj.group.add(ft);
    this.floatingTexts.push({ sprite: ft, elapsed: 0, startY: 2.0 });
  }

  private triggerDeath(obj: EntityObject) {
    obj.anims.push({ type: "death", elapsed: 0, duration: 1.5 });
  }

  /** Trigger gather/craft anims from zone events */
  processEvents(events: import("../types.js").ZoneEvent[]) {
    for (const ev of events) {
      // Gathering: loot events with gatherType data
      if (ev.type === "loot" && ev.entityId && ev.data?.gatherType) {
        const obj = this.entities.get(ev.entityId);
        if (obj && !obj.anims.some(a => a.type === "gather")) {
          obj.anims.push({ type: "gather", elapsed: 0, duration: 1.8 });
        }
      }
      // Crafting: loot events at crafting stations (or craft type)
      if (ev.type === "loot" && ev.entityId && ev.data?.craftType) {
        const obj = this.entities.get(ev.entityId);
        if (obj && !obj.anims.some(a => a.type === "craft")) {
          obj.anims.push({ type: "craft", elapsed: 0, duration: 2.0 });
        }
      }
    }
  }

  /** Apply animation at progress t (0-1) */
  private applyAnim(obj: EntityObject, anim: ActiveAnim, t: number) {
    switch (anim.type) {
      case "attack": {
        const targetPos = anim.data?.targetPos as THREE.Vector3 | undefined;
        if (!targetPos) break;

        const dx = targetPos.x - obj.group.position.x;
        const dz = targetPos.z - obj.group.position.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const dirX = dx / len;
        const dirZ = dz / len;

        // Face target
        obj.group.rotation.y = Math.atan2(dx, dz);

        // Phase 1 (0-0.2): Wind up — lean back, raise right arm
        // Phase 2 (0.2-0.45): Lunge + slash — burst forward, swing arm down
        // Phase 3 (0.45-0.7): Impact hold — slight bounce, body tense
        // Phase 4 (0.7-1.0): Recovery — return to idle
        if (t < 0.2) {
          const p = t / 0.2;
          if (obj.bodyMesh) {
            obj.bodyMesh.rotation.x = p * 0.3; // lean back
            obj.bodyMesh.position.x = -dirX * p * 0.1;
            obj.bodyMesh.position.z = -dirZ * p * 0.1;
          }
          if (obj.rightArm) obj.rightArm.rotation.x = -p * 1.8; // arm back
          if (obj.leftArm) obj.leftArm.rotation.x = p * 0.3; // brace
        } else if (t < 0.45) {
          const p = (t - 0.2) / 0.25;
          const strike = Math.sin(p * Math.PI * 0.5); // ease-in
          if (obj.bodyMesh) {
            obj.bodyMesh.rotation.x = 0.3 - strike * 0.9; // whip forward
            obj.bodyMesh.position.x = dirX * strike * 0.5;
            obj.bodyMesh.position.z = dirZ * strike * 0.5;
          }
          if (obj.rightArm) obj.rightArm.rotation.x = -1.8 + strike * 2.8; // slash down
          if (obj.leftArm) obj.leftArm.rotation.x = 0.3 - strike * 0.5;
        } else if (t < 0.7) {
          const p = (t - 0.45) / 0.25;
          const bounce = Math.sin(p * Math.PI) * 0.15;
          if (obj.bodyMesh) {
            obj.bodyMesh.rotation.x = -0.6 + bounce;
            obj.bodyMesh.position.x = dirX * (0.5 - p * 0.2);
            obj.bodyMesh.position.z = dirZ * (0.5 - p * 0.2);
          }
          if (obj.rightArm) obj.rightArm.rotation.x = 1.0 - bounce * 2;
        } else {
          const p = (t - 0.7) / 0.3;
          if (obj.bodyMesh) {
            obj.bodyMesh.rotation.x = (-0.6 + 0.15) * (1 - p);
            obj.bodyMesh.position.x = dirX * 0.3 * (1 - p);
            obj.bodyMesh.position.z = dirZ * 0.3 * (1 - p);
          }
          if (obj.rightArm) obj.rightArm.rotation.x = 1.0 * (1 - p);
          if (obj.leftArm) obj.leftArm.rotation.x = -0.2 * (1 - p);
        }
        break;
      }

      case "damage": {
        if (!obj.bodyMesh) break;
        // Phase 1 (0-0.15): Impact — flash white, jolt backward
        // Phase 2 (0.15-0.5): Stagger — shake violently, red tint
        // Phase 3 (0.5-1.0): Recovery — fade back to normal
        const mat = obj.bodyMesh.material as THREE.MeshLambertMaterial;

        if (t < 0.15) {
          const p = t / 0.15;
          // White flash on impact
          if (mat.emissive) {
            mat.emissive.setHex(0xffffff);
            mat.emissiveIntensity = (1 - p) * 1.0;
          }
          // Jolt backward
          obj.bodyMesh.rotation.x = p * 0.4;
          obj.bodyMesh.position.z = -p * 0.15;
        } else if (t < 0.5) {
          const p = (t - 0.15) / 0.35;
          // Violent shake that decays
          const shake = Math.sin(t * Math.PI * 14) * (1 - p) * 0.12;
          obj.bodyMesh.position.x = shake;
          obj.bodyMesh.position.z = -0.15 * (1 - p);
          obj.bodyMesh.rotation.x = 0.4 * (1 - p);
          // Red tint
          if (mat.emissive) {
            mat.emissive.setHex(0xff2200);
            mat.emissiveIntensity = (1 - p) * 0.7;
          }
          // Stagger arms outward
          if (obj.leftArm) obj.leftArm.rotation.x = -0.5 * (1 - p);
          if (obj.rightArm) obj.rightArm.rotation.x = -0.5 * (1 - p);
          if (obj.leftArm) obj.leftArm.rotation.z = -0.3 * (1 - p);
          if (obj.rightArm) obj.rightArm.rotation.z = 0.3 * (1 - p);
        } else {
          const p = (t - 0.5) / 0.5;
          obj.bodyMesh.position.x = 0;
          obj.bodyMesh.position.z = 0;
          obj.bodyMesh.rotation.x = 0;
          if (mat.emissive) {
            mat.emissive.setHex(0xff0000);
            mat.emissiveIntensity = (1 - p) * 0.2;
          }
          if (obj.leftArm) { obj.leftArm.rotation.x = 0; obj.leftArm.rotation.z = 0; }
          if (obj.rightArm) { obj.rightArm.rotation.x = 0; obj.rightArm.rotation.z = 0; }
        }
        break;
      }

      case "heal": {
        if (!obj.bodyMesh) break;
        const mat = obj.bodyMesh.material as THREE.MeshLambertMaterial;
        // Rising glow with arms spread upward
        const pulse = Math.sin(t * Math.PI * 3) * 0.5 + 0.5;
        if (mat.emissive) {
          mat.emissive.setHex(0x44ff66);
          mat.emissiveIntensity = pulse * 0.6;
        }
        // Arms float up gently
        const lift = Math.sin(t * Math.PI) * 0.8;
        if (obj.leftArm) { obj.leftArm.rotation.x = -lift; obj.leftArm.rotation.z = -lift * 0.4; }
        if (obj.rightArm) { obj.rightArm.rotation.x = -lift; obj.rightArm.rotation.z = lift * 0.4; }
        // Slight float
        obj.bodyMesh.position.y = 0.8 + Math.sin(t * Math.PI) * 0.1;
        break;
      }

      case "death": {
        // Phase 1 (0-0.3): Stagger — stumble, arms flail
        // Phase 2 (0.3-0.7): Collapse — fall to knees then sideways
        // Phase 3 (0.7-1.0): Fade out on the ground
        if (t < 0.3) {
          const p = t / 0.3;
          obj.group.rotation.z = p * 0.2;
          if (obj.bodyMesh) obj.bodyMesh.rotation.x = p * 0.3;
          if (obj.leftArm) obj.leftArm.rotation.x = -p * 1.5;
          if (obj.rightArm) obj.rightArm.rotation.x = -p * 1.2;
          // Flash
          obj.group.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.material && (mesh.material as THREE.MeshLambertMaterial).emissive) {
              const m = mesh.material as THREE.MeshLambertMaterial;
              m.emissive.setHex(0xff2200);
              m.emissiveIntensity = (1 - p) * 0.5;
            }
          });
        } else if (t < 0.7) {
          const p = (t - 0.3) / 0.4;
          // Topple sideways
          obj.group.rotation.z = 0.2 + p * (Math.PI / 2 - 0.2);
          obj.group.position.y = -p * 0.6;
          obj.group.scale.setScalar(1 - p * 0.15);
          if (obj.leftArm) obj.leftArm.rotation.x = -1.5 * (1 - p * 0.5);
          if (obj.rightArm) obj.rightArm.rotation.x = -1.2 * (1 - p * 0.5);
          if (obj.leftLeg) obj.leftLeg.rotation.x = p * 0.5;
          if (obj.rightLeg) obj.rightLeg.rotation.x = -p * 0.3;
        } else {
          const p = (t - 0.7) / 0.3;
          // Lying on ground, fade out
          obj.group.rotation.z = Math.PI / 2;
          obj.group.position.y = -0.6;
          obj.group.scale.setScalar(0.85);
          obj.group.traverse((child) => {
            if ((child as THREE.Mesh).material) {
              const mat = (child as THREE.Mesh).material as THREE.Material;
              mat.transparent = true;
              mat.opacity = 1 - p;
            }
          });
        }
        break;
      }

      case "gather": {
        // Bend over, reach down with right arm, pull up
        // Phase 1 (0-0.4): Bend down — torso tilts, arm reaches to ground
        // Phase 2 (0.4-0.7): Hold — small arm wobble (pulling/picking)
        // Phase 3 (0.7-1.0): Stand up — return with item
        if (t < 0.4) {
          const p = t / 0.4;
          const ease = p * p; // ease-in
          if (obj.bodyMesh) obj.bodyMesh.rotation.x = -ease * 1.0;
          if (obj.rightArm) obj.rightArm.rotation.x = ease * 2.2;
          if (obj.leftArm) obj.leftArm.rotation.x = ease * 0.5;
          // Bend knees
          if (obj.leftLeg) obj.leftLeg.rotation.x = ease * 0.4;
          if (obj.rightLeg) obj.rightLeg.rotation.x = ease * 0.4;
        } else if (t < 0.7) {
          const p = (t - 0.4) / 0.3;
          // Hold pose with small arm wobble
          if (obj.bodyMesh) obj.bodyMesh.rotation.x = -1.0;
          if (obj.rightArm) obj.rightArm.rotation.x = 2.2 + Math.sin(p * Math.PI * 4) * 0.15;
          if (obj.leftArm) obj.leftArm.rotation.x = 0.5;
          if (obj.leftLeg) obj.leftLeg.rotation.x = 0.4;
          if (obj.rightLeg) obj.rightLeg.rotation.x = 0.4;
        } else {
          const p = (t - 0.7) / 0.3;
          const ease = 1 - (1 - p) * (1 - p); // ease-out
          if (obj.bodyMesh) obj.bodyMesh.rotation.x = -1.0 * (1 - ease);
          if (obj.rightArm) obj.rightArm.rotation.x = 2.2 * (1 - ease);
          if (obj.leftArm) obj.leftArm.rotation.x = 0.5 * (1 - ease);
          if (obj.leftLeg) obj.leftLeg.rotation.x = 0.4 * (1 - ease);
          if (obj.rightLeg) obj.rightLeg.rotation.x = 0.4 * (1 - ease);
        }
        break;
      }

      case "craft": {
        // Hammering motion: body stays level, right arm swings up/down repeatedly
        const cycle = (t * 4) % 1; // 4 hammer strikes over the duration
        const swing = Math.sin(cycle * Math.PI);
        if (obj.bodyMesh) obj.bodyMesh.rotation.x = -0.15; // slight lean forward
        if (obj.rightArm) obj.rightArm.rotation.x = -1.0 + swing * 1.8; // arm up → down
        if (obj.leftArm) obj.leftArm.rotation.x = 0.3; // brace arm
        // Slight body bounce on each strike
        if (obj.bodyMesh) obj.bodyMesh.position.y = 0.8 + (cycle > 0.4 && cycle < 0.6 ? 0.03 : 0);
        break;
      }
    }
  }

  /** Reset entity after animation completes */
  private resetAnim(obj: EntityObject, anim: ActiveAnim) {
    switch (anim.type) {
      case "attack":
      case "gather":
      case "craft":
        if (obj.bodyMesh) {
          obj.bodyMesh.rotation.x = 0;
          obj.bodyMesh.position.x = 0;
          obj.bodyMesh.position.z = 0;
          obj.bodyMesh.position.y = 0.8;
        }
        if (obj.leftArm) { obj.leftArm.rotation.x = 0; obj.leftArm.rotation.z = 0; }
        if (obj.rightArm) { obj.rightArm.rotation.x = 0; obj.rightArm.rotation.z = 0; }
        if (obj.leftLeg) obj.leftLeg.rotation.x = 0;
        if (obj.rightLeg) obj.rightLeg.rotation.x = 0;
        break;
      case "damage":
      case "heal":
        if (obj.bodyMesh) {
          obj.bodyMesh.position.x = 0;
          obj.bodyMesh.position.z = 0;
          obj.bodyMesh.position.y = 0.8;
          obj.bodyMesh.rotation.x = 0;
          const mat = obj.bodyMesh.material as THREE.MeshLambertMaterial;
          if (mat.emissive) {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
        if (obj.leftArm) { obj.leftArm.rotation.x = 0; obj.leftArm.rotation.z = 0; }
        if (obj.rightArm) { obj.rightArm.rotation.x = 0; obj.rightArm.rotation.z = 0; }
        break;
      case "death":
        // Leave dead
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
    let headMesh: THREE.Mesh | null = null;
    let leftLeg: THREE.Mesh | null = null;
    let rightLeg: THREE.Mesh | null = null;
    let leftArm: THREE.Group | null = null;
    let rightArm: THREE.Group | null = null;

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
      prevHp: ent.hp, anims: [], bodyMesh, headMesh, walkPhase: 0, idleTime: 0,
      isMoving: false, movingSmooth: 0, leftLeg, rightLeg, leftArm, rightArm,
    };
  }

  // ── Hair builder (all 12 styles) ─────────────────────────────────

  private buildHair(group: THREE.Group, style: string, mat: THREE.MeshLambertMaterial, headY: number) {
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

  private buildPlayer(group: THREE.Group, ent: Entity): { body: THREE.Mesh; head: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh; leftArm: THREE.Group; rightArm: THREE.Group } {
    const skinHex = SKIN_COLORS[ent.skinColor ?? "medium"] ?? 0xd4a574;
    const classId = ent.classId ?? "warrior";
    const cls = CLASS_BODY[classId] ?? CLASS_BODY.warrior;
    const isFemale = ent.gender === "female";

    // Gender body modifiers
    const gsx = isFemale ? 0.88 : 1.0;  // narrower shoulders
    const gsy = isFemale ? 0.95 : 1.0;  // slightly shorter torso
    const gsz = isFemale ? 0.92 : 1.0;
    const hipW = isFemale ? 0.12 : 0.1; // wider hip stance

    // Legs (pivot at hip)
    const legMat = new THREE.MeshLambertMaterial({ color: skinHex });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-hipW, 0.35, 0);
    if (isFemale) leftLeg.scale.set(0.9, 1.05, 0.9); // slimmer, slightly longer
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(hipW, 0.35, 0);
    if (isFemale) rightLeg.scale.set(0.9, 1.05, 0.9);
    group.add(rightLeg);

    const bodyMat = new THREE.MeshLambertMaterial({ color: cls.color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    body.scale.set(cls.sx * gsx, cls.sy * gsy, cls.sz * gsz);
    body.castShadow = true;
    group.add(body);

    const headScale = isFemale ? 0.95 : 1.0;
    const head = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: skinHex }));
    head.position.y = isFemale ? 1.46 : 1.5;
    head.scale.setScalar(headScale);
    group.add(head);

    const eyeHex = EYE_COLORS[ent.eyeColor ?? "brown"] ?? 0x6b3a1f;
    const eyeMat = new THREE.MeshBasicMaterial({ color: eyeHex });
    const eyeY = isFemale ? 1.49 : 1.53;
    for (const dx of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(dx * headScale, eyeY, 0.17 * headScale);
      group.add(eye);
    }

    // ── Hair (all 12 styles) ──
    const style = ent.hairStyle ?? "short";
    if (style !== "bald") {
      const hairHex = HAIR_COLORS[style] ?? 0x4a3728;
      const hairMat = new THREE.MeshLambertMaterial({ color: hairHex });
      const headY = isFemale ? 1.46 : 1.5;
      this.buildHair(group, style, hairMat, headY);
    }

    // ── Arms + hands (pivot at shoulder) ──
    const skinMat = new THREE.MeshLambertMaterial({ color: skinHex });
    const shoulderW = 0.3 * cls.sx * gsx;
    const shoulderY = isFemale ? 1.12 : 1.15;
    const armScale = isFemale ? 0.9 : 1.0;

    // Left arm group — pivots at shoulder
    const leftArm = new THREE.Group();
    leftArm.position.set(-shoulderW, shoulderY, 0);
    const lUpperArm = new THREE.Mesh(armGeo, skinMat);
    lUpperArm.position.y = -0.2; lUpperArm.scale.setScalar(armScale);
    leftArm.add(lUpperArm);
    const lHand = new THREE.Mesh(handGeo, skinMat);
    lHand.position.y = -0.42 * armScale; lHand.scale.setScalar(armScale);
    leftArm.add(lHand);
    group.add(leftArm);

    // Right arm group — pivots at shoulder
    const rightArm = new THREE.Group();
    rightArm.position.set(shoulderW, shoulderY, 0);
    const rUpperArm = new THREE.Mesh(armGeo, skinMat);
    rUpperArm.position.y = -0.2; rUpperArm.scale.setScalar(armScale);
    rightArm.add(rUpperArm);
    const rHand = new THREE.Mesh(handGeo, skinMat);
    rHand.position.y = -0.42 * armScale; rHand.scale.setScalar(armScale);
    rightArm.add(rHand);

    // Weapon attaches to right hand
    if (ent.equipment?.weapon) {
      const eq = ent.equipment.weapon;
      const wType = inferWeaponType(eq.name ?? "sword");
      const quality = eq.quality ?? "common";
      const metalHex = QUALITY_COLORS[quality] ?? QUALITY_COLORS.common;
      const emHex = QUALITY_EMISSIVE[quality] ?? 0x000000;
      const wpn = buildWeaponMesh(wType, metalHex, emHex);

      if (wType === "bow") {
        wpn.position.set(0, -0.35, -0.1);
      } else if (wType === "staff") {
        wpn.position.set(0, -0.05, 0); wpn.rotation.z = 0.05;
      } else {
        wpn.position.set(0, -0.3, 0); wpn.rotation.z = -0.15;
      }
      rightArm.add(wpn);
    }
    group.add(rightArm);

    // Shield on left hand for paladin/warrior
    if (classId === "paladin" || classId === "warrior") {
      const s = new THREE.Mesh(shieldGeo, new THREE.MeshLambertMaterial({ color: cls.color }));
      s.position.set(0, -0.32, 0.1);
      leftArm.add(s);
    }

    // Procedural armor pieces
    addArmorPieces(group, ent, cls, leftArm, rightArm, leftLeg, rightLeg);

    return { body, head, leftLeg, rightLeg, leftArm, rightArm };
  }

  // ── Mob ───────────────────────────────────────────────────────────

  private buildMob(group: THREE.Group, ent: Entity): { body: THREE.Mesh; head: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh; leftArm: THREE.Group; rightArm: THREE.Group } {
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

    // Arms + claws
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.35 * s, 1.0 * s, 0);
    const lArm = new THREE.Mesh(armGeo, mat);
    lArm.position.y = -0.18; lArm.scale.setScalar(s);
    leftArm.add(lArm);
    const lClaw = new THREE.Mesh(handGeo, mat);
    lClaw.position.y = -0.38 * s; lClaw.scale.setScalar(s);
    leftArm.add(lClaw);
    group.add(leftArm);

    const rightArm = new THREE.Group();
    rightArm.position.set(0.35 * s, 1.0 * s, 0);
    const rArm = new THREE.Mesh(armGeo, mat);
    rArm.position.y = -0.18; rArm.scale.setScalar(s);
    rightArm.add(rArm);
    const rClaw = new THREE.Mesh(handGeo, mat);
    rClaw.position.y = -0.38 * s; rClaw.scale.setScalar(s);
    rightArm.add(rClaw);
    group.add(rightArm);

    if (isBoss) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.25, 5), new THREE.MeshBasicMaterial({ color: 0xffdd00 }));
      crown.position.y = 1.7 * s; group.add(crown);
    }

    return { body, head, leftLeg, rightLeg, leftArm, rightArm };
  }

  // ── NPC ───────────────────────────────────────────────────────────

  private buildNpc(group: THREE.Group, ent: Entity, color: number): { body: THREE.Mesh; head: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh; leftArm: THREE.Group; rightArm: THREE.Group } {
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
    const skinMat = new THREE.MeshLambertMaterial({ color: skinHex });
    const head = new THREE.Mesh(headGeo, skinMat);
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

    // Arms + hands
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.27, 1.1, 0);
    const lArm = new THREE.Mesh(armGeo, skinMat);
    lArm.position.y = -0.18; leftArm.add(lArm);
    const lHand = new THREE.Mesh(handGeo, skinMat);
    lHand.position.y = -0.38; leftArm.add(lHand);
    group.add(leftArm);

    const rightArm = new THREE.Group();
    rightArm.position.set(0.27, 1.1, 0);
    const rArm = new THREE.Mesh(armGeo, skinMat);
    rArm.position.y = -0.18; rightArm.add(rArm);
    const rHand = new THREE.Mesh(handGeo, skinMat);
    rHand.position.y = -0.38; rightArm.add(rHand);
    group.add(rightArm);

    if (ent.type === "quest-giver") {
      const q = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), new THREE.MeshBasicMaterial({ color: 0xffdd00 }));
      q.position.y = 2.0; group.add(q);
    }
    if (ent.type === "merchant") {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.15), new THREE.MeshLambertMaterial({ color: 0xbb8833 }));
      bag.position.set(0, -0.3, 0); rightArm.add(bag);
    }

    return { body, head, leftLeg, rightLeg, leftArm, rightArm };
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
