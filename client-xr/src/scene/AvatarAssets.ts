import * as THREE from "three";
import type { Entity } from "../types.js";
import { getGradientMap } from "./ToonPipeline.js";

const SKIN_COLORS: Record<string, number> = {
  pale: 0xfde0c8, fair: 0xf5d0b0, light: 0xf5c8a0, medium: 0xd4a574,
  tan: 0xc49560, olive: 0xb08850, brown: 0x8b5e3c, dark: 0x6b4226,
};

// Hair color palette — independent of style. Derived from entity name hash.
const HAIR_COLOR_PALETTE = [
  0x1a1008,  // near-black
  0x2a1a0e,  // very dark brown
  0x4a3728,  // dark brown
  0x6b4c30,  // medium brown
  0x8b6b42,  // light brown
  0xa88550,  // sandy brown
  0xc4a46e,  // dirty blonde
  0xd4b87a,  // golden blonde
  0xe8d4a0,  // platinum blonde
  0x7a3520,  // auburn
  0xaa4422,  // copper red
  0xcc2222,  // bright red
  0x1a1a2e,  // blue-black
  0x3a2818,  // warm black
  0xf0e0c0,  // silver/white
];

/** Deterministic hair color from entity name — same name always gives same color */
function hashHairColor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return HAIR_COLOR_PALETTE[Math.abs(h) % HAIR_COLOR_PALETTE.length];
}

// Legacy fallback only
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

export interface ClassBody {
  sx: number;
  sy: number;
  sz: number;
  color: number;
}

const CLASS_BODY: Record<string, ClassBody> = {
  warrior: { sx: 1.1, sy: 1.0, sz: 1.1, color: 0xcc3333 },
  paladin: { sx: 1.1, sy: 1.05, sz: 1.0, color: 0xe6c830 },
  mage: { sx: 0.85, sy: 1.1, sz: 0.85, color: 0x3366dd },
  cleric: { sx: 0.9, sy: 1.05, sz: 0.9, color: 0xeeeeff },
  ranger: { sx: 0.9, sy: 1.05, sz: 0.9, color: 0x33aa44 },
  rogue: { sx: 0.85, sy: 1.0, sz: 0.85, color: 0x8833bb },
  warlock: { sx: 0.9, sy: 1.1, sz: 0.9, color: 0x33bb66 },
  monk: { sx: 0.95, sy: 1.0, sz: 0.95, color: 0xe69628 },
};

export interface AvatarMorphology {
  raceScale: number;
  raceWidthX: number;
  raceWidthZ: number;
  bodyScale: { x: number; y: number; z: number };
  armScale: number;
  headScale: number;
}

export interface AvatarColors {
  skinHex: number;
  hairHex: number;
  eyeHex: number;
  bodyHex: number;
}

export interface AvatarFeatures {
  race: string;
  isFemale: boolean;
  isElf: boolean;
  isDwarf: boolean;
  hairStyle: string;
}

export interface AvatarDefinition {
  key: string;
  classBody: ClassBody;
  morphology: AvatarMorphology;
  colors: AvatarColors;
  features: AvatarFeatures;
}

export class AvatarAssets {
  private cache = new Map<string, AvatarDefinition>();

  resolvePlayer(ent: Entity): AvatarDefinition {
    const race = (ent.raceId ?? "human").toLowerCase();
    const gender = ent.gender ?? "male";
    const classId = ent.classId ?? "warrior";
    const hairStyle = ent.hairStyle ?? "short";
    const cacheKey = [
      "player",
      race,
      gender,
      classId,
      ent.skinColor ?? "medium",
      hairStyle,
      ent.eyeColor ?? "brown",
    ].join(":");
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const isFemale = gender === "female";
    const isElf = race === "elf";
    const isDwarf = race === "dwarf";
    const classBody = CLASS_BODY[classId] ?? CLASS_BODY.warrior;

    const isBeastkin = race === "beastkin";
    const raceScale = isDwarf ? 0.78 : isElf ? 1.12 : isBeastkin ? 1.05 : 1.0;
    const raceWidthX = isDwarf ? 1.25 : isElf ? 0.9 : isBeastkin ? 1.08 : 1.0;
    const raceWidthZ = isDwarf ? 1.15 : isElf ? 0.9 : isBeastkin ? 1.05 : 1.0;
    // Female chest is narrower (hourglass top), male is broader (V-shape top)
    const bodyScale = {
      x: classBody.sx * (isFemale ? 0.82 : 1.0) * raceWidthX,
      y: classBody.sy * (isFemale ? 0.92 : 1.0) * raceScale,
      z: classBody.sz * (isFemale ? 0.88 : 1.0) * raceWidthZ,
    };

    const avatar: AvatarDefinition = {
      key: cacheKey,
      classBody,
      morphology: {
        raceScale,
        raceWidthX,
        raceWidthZ,
        bodyScale,
        armScale: (isFemale ? 0.88 : 1.0) * raceScale,
        // Female head slightly larger relative to body (reads as more expressive)
        headScale: isFemale ? 1.0 : isDwarf ? 1.05 : 1.0,
      },
      colors: {
        skinHex: SKIN_COLORS[ent.skinColor ?? "medium"] ?? 0xd4a574,
        hairHex: hashHairColor(ent.name ?? hairStyle), // unique per character name
        eyeHex: EYE_COLORS[ent.eyeColor ?? "brown"] ?? 0x6b3a1f,
        bodyHex: classBody.color,
      },
      features: {
        race,
        isFemale,
        isElf,
        isDwarf,
        hairStyle,
      },
    };

    this.cache.set(cacheKey, avatar);
    return avatar;
  }

  resolveNpc(ent: Entity, color: number): AvatarDefinition {
    const race = (ent.raceId ?? "human").toLowerCase();
    const gender = ent.gender ?? "male";
    const hairStyle = ent.hairStyle ?? "short";
    const cacheKey = [
      "npc",
      ent.type,
      race,
      gender,
      color.toString(16),
      ent.skinColor ?? "default",
      hairStyle,
      ent.eyeColor ?? "default",
    ].join(":");
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const avatar: AvatarDefinition = {
      key: cacheKey,
      classBody: { sx: 1, sy: 1, sz: 1, color },
      morphology: {
        raceScale: 1,
        raceWidthX: 1,
        raceWidthZ: 1,
        bodyScale: { x: 1, y: 1, z: 1 },
        armScale: 1,
        headScale: 1,
      },
      colors: {
        skinHex: ent.skinColor ? (SKIN_COLORS[ent.skinColor] ?? color) : color,
        hairHex: hashHairColor(ent.name ?? hairStyle),
        eyeHex: ent.eyeColor ? (EYE_COLORS[ent.eyeColor] ?? 0x333333) : 0x333333,
        bodyHex: color,
      },
      features: {
        race,
        isFemale: gender === "female",
        isElf: race === "elf",
        isDwarf: race === "dwarf",
        hairStyle,
      },
    };

    this.cache.set(cacheKey, avatar);
    return avatar;
  }

  makeToonMaterial(color: number, opts?: { transparent?: boolean; opacity?: number }): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({
      color,
      gradientMap: getGradientMap(),
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
    });
  }
}
