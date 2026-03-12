import Phaser from "phaser";
import { ASSET_BASE_URL } from "./config.js";
import {
  BOOTS_LAYER_SCALE,
  CHEST_LAYER_SCALE,
  HELM_LAYER_SCALE,
  LEGS_LAYER_SCALE,
  SHOULDER_LAYER_SCALE,
  WEAPON_LAYER_SCALE,
} from "./layerScales.js";
import type { Entity } from "./types.js";

/**
 * Layered sprite compositor for player characters.
 *
 * Composites multiple transparent PNG layers into a single sprite sheet texture.
 * Layer stack (bottom to top):
 *   1. body (skin tone)
 *   2. eyes (color)
 *   3. hair (style)
 *   4. weapon-behind (up + left direction rows only)
 *   5. chest armor
 *   6. legs armor
 *   7. boots
 *   8. shoulders
 *   9. helm
 *  10. weapon-front (down + right direction rows only)
 *
 * Each layer PNG is 64×88: 4 cols × 4 rows of 16×22 frames.
 * Cols: idle1, idle2, walk1, walk2
 * Rows: down(0), left(1), right(2), up(3)
 */

const PLAYER_FW = 16;
const PLAYER_FH = 22;
const COLS = 4;
const ROWS = 4;
const CANVAS_W = COLS * PLAYER_FW;  // 64
const CANVAS_H = ROWS * PLAYER_FH;  // 88

// Direction row indices (canvas order)
const DIR_DOWN = 0;
const DIR_LEFT = 1;
const DIR_RIGHT = 2;
const DIR_UP = 3;

// ── Appearance defaults ─────────────────────────────────────────────

const DEFAULT_SKIN = "medium";
const DEFAULT_EYES = "brown";
const DEFAULT_HAIR = "short";

// Map onboarding appearance IDs → layer filenames
// (onboarding stores ids like "fair", "tan", "amber"; layers use "pale", "olive", "gold")
const SKIN_MAP: Record<string, string> = {
  fair: "pale", light: "light", medium: "medium", tan: "olive",
  brown: "dark", dark: "dark",
  // direct layer names also accepted
  pale: "pale", olive: "olive",
};

const EYE_MAP: Record<string, string> = {
  brown: "brown", blue: "blue", green: "green", amber: "gold",
  gray: "brown", violet: "red",
  // direct layer names also accepted
  gold: "gold", red: "red",
};

const HAIR_MAP: Record<string, string> = {
  short: "short", long: "long", braided: "long", mohawk: "mohawk",
  bald: "", ponytail: "ponytail", locs: "long", afro: "short",
  cornrows: "short", "bantu-knots": "short", bangs: "long", topknot: "ponytail",
};

// ── Item → visual mapping ───────────────────────────────────────────

/** Map weapon item names to visual weapon type */
function weaponVisual(itemName: string | undefined): string | null {
  if (!itemName) return null;
  const lower = itemName.toLowerCase();
  if (lower.includes("sword") || lower.includes("longsword") || lower.includes("greatsword")) return "sword";
  if (lower.includes("staff") || lower.includes("warstaff")) return "staff";
  if (lower.includes("bow") || lower.includes("longbow")) return "bow";
  if (lower.includes("dagger")) return "dagger";
  if (lower.includes("axe") || lower.includes("battleaxe")) return "axe";
  if (lower.includes("mace")) return "mace";
  // Tools (pickaxe, sickle, knife) — show as dagger
  if (lower.includes("pickaxe") || lower.includes("sickle") || lower.includes("knife")) return "dagger";
  if (lower.includes("shield")) return null; // shields are off-hand, not drawn as weapon layer
  return "sword"; // fallback
}

/** Map armor item names to visual tier */
function armorVisual(itemName: string | undefined, slot: string): string | null {
  if (!itemName) return null;
  const lower = itemName.toLowerCase();

  if (slot === "chest") {
    if (lower.includes("plate") || lower.includes("chainmail")) return "chain";
    if (lower.includes("reinforced") || lower.includes("hide")) return "leather";
    if (lower.includes("leather") || lower.includes("tanned")) return "leather";
    if (lower.includes("telluron")) return "plate";
    return "cloth";
  }

  if (slot === "legs") {
    if (lower.includes("greave") || lower.includes("iron") || lower.includes("samaronic")) return "chain";
    if (lower.includes("leather") || lower.includes("hide") || lower.includes("tanned")) return "leather";
    if (lower.includes("plate")) return "plate";
    return "cloth";
  }

  if (slot === "boots") {
    if (lower.includes("steel") || lower.includes("sabaton")) return "iron";
    if (lower.includes("gold") || lower.includes("barylian")) return "gold";
    if (lower.includes("leather") || lower.includes("hide") || lower.includes("tanned")) return "leather";
    return "cloth";
  }

  if (slot === "helm") {
    if (lower.includes("iron") || lower.includes("steel")) return "iron";
    if (lower.includes("plate") || lower.includes("war") || lower.includes("prasic")) return "plate";
    if (lower.includes("crown")) return "crown";
    if (lower.includes("leather") || lower.includes("hide") || lower.includes("tanned")) return "leather";
    return "leather";
  }

  if (slot === "shoulders") {
    if (lower.includes("steel") || lower.includes("pauldron") || lower.includes("ceric")) return "plate";
    if (lower.includes("iron") || lower.includes("bronze")) return "iron";
    if (lower.includes("leather") || lower.includes("hide") || lower.includes("tanned")) return "leather";
    return "leather";
  }

  return null;
}

// ── Preloader ───────────────────────────────────────────────────────

const SKIN_TONES = ["light", "medium", "dark", "olive", "pale"];
const CLEAN_EYE_COLORS = ["blue", "gold", "red"];
const HAIR_STYLES = ["short", "long", "mohawk", "ponytail"];
const CHEST_TIERS = ["cloth", "leather", "chain", "plate"];
const LEGS_TIERS = ["cloth", "leather", "chain", "plate"];
const BOOT_TIERS = ["cloth", "leather", "iron", "gold"];
const HELM_TIERS = ["leather", "iron", "plate", "crown"];
const SHOULDER_TIERS = ["leather", "iron", "plate"];
const WEAPON_TYPES = ["sword", "staff", "bow", "dagger", "axe", "mace"];

/** Call in scene.preload() to load all layer PNGs */
export function preloadLayerSprites(scene: Phaser.Scene): void {
  // Use CDN in prod, local files in dev
  const base = ASSET_BASE_URL
    ? `${ASSET_BASE_URL}/sprites/layers`
    : "/sprites/layers";

  for (const skin of SKIN_TONES) {
    scene.load.image(`layer-body-${skin}`, `${base}/body/body-${skin}.png`);
  }
  for (const eye of CLEAN_EYE_COLORS) {
    scene.load.image(`layer-eyes-${eye}`, `${base}/eyes/eyes-${eye}.png`);
  }
  for (const hair of HAIR_STYLES) {
    scene.load.image(`layer-hair-${hair}`, `${base}/hair/hair-${hair}.png`);
  }
  for (const tier of CHEST_TIERS) {
    scene.load.image(`layer-chest-${tier}`, `${base}/chest/chest-${tier}.png`);
  }
  for (const tier of LEGS_TIERS) {
    scene.load.image(`layer-legs-${tier}`, `${base}/legs/legs-${tier}.png`);
  }
  for (const tier of BOOT_TIERS) {
    scene.load.image(`layer-boots-${tier}`, `${base}/boots/boots-${tier}.png`);
  }
  for (const tier of HELM_TIERS) {
    scene.load.image(`layer-helm-${tier}`, `${base}/helm/helm-${tier}.png`);
  }
  for (const tier of SHOULDER_TIERS) {
    scene.load.image(`layer-shoulders-${tier}`, `${base}/shoulders/shoulders-${tier}.png`);
  }
  for (const weapon of WEAPON_TYPES) {
    scene.load.image(`layer-weapon-${weapon}`, `${base}/weapons/weapon-${weapon}.png`);
  }
}

// ── Layer key builder ───────────────────────────────────────────────

export interface LayerKeys {
  body: string;
  eyes: string;
  hair: string | null;
  weapon: string | null;
  chest: string | null;
  legs: string | null;
  boots: string | null;
  helm: string | null;
  shoulders: string | null;
}

/** Derive the layer texture keys from an entity's appearance + equipment */
export function getLayerKeys(entity: Entity): LayerKeys {
  const rawSkin = entity.skinColor ?? DEFAULT_SKIN;
  const rawEyes = entity.eyeColor ?? DEFAULT_EYES;
  const rawHair = entity.hairStyle ?? DEFAULT_HAIR;

  // Map onboarding IDs to layer filenames
  const skinTone = SKIN_MAP[rawSkin] ?? rawSkin;
  const eyeColor = EYE_MAP[rawEyes] ?? rawEyes;
  const hairStyle = HAIR_MAP[rawHair] ?? rawHair;

  const eq = entity.equipment ?? {};
  const weaponName = eq.weapon?.name;
  const chestName = eq.chest?.name;
  const legsName = eq.legs?.name;
  const bootsName = eq.boots?.name;
  const helmName = eq.helm?.name;
  const shouldersName = eq.shoulders?.name;

  const weaponType = weaponVisual(weaponName);

  return {
    body: `layer-body-${skinTone}`,
    eyes: `layer-eyes-${eyeColor}`,
    hair: hairStyle ? `layer-hair-${hairStyle}` : null,
    weapon: weaponType ? `layer-weapon-${weaponType}` : null,
    chest: chestName ? `layer-chest-${armorVisual(chestName, "chest")}` : null,
    legs: legsName ? `layer-legs-${armorVisual(legsName, "legs")}` : null,
    boots: bootsName ? `layer-boots-${armorVisual(bootsName, "boots")}` : null,
    helm: helmName ? `layer-helm-${armorVisual(helmName, "helm")}` : null,
    shoulders: shouldersName ? `layer-shoulders-${armorVisual(shouldersName, "shoulders")}` : null,
  };
}

/** Build a cache key string from layer keys */
export function layerCacheKey(keys: LayerKeys): string {
  return [
    keys.body,
    keys.weapon ?? "no-weapon",
    keys.chest ?? "no-chest",
    keys.legs ?? "no-legs",
    keys.boots ?? "no-boots",
    keys.shoulders ?? "no-shoulders",
  ].join("|");
}

// ── Procedural weapon sprites (animated) ────────────────────────────

const proceduralWeaponsDone = new Set<string>();

/** Weapon pixel-art color palette */
const WC = {
  blade:     "#C0C0C0",
  bladeHi:   "#E0E0E0",
  bladeTrail:"rgba(192,192,192,0.25)",
  handle:    "#6B3410",
  guard:     "#808080",
  wood:      "#B8860B",
  gem:       "#00BFFF",
  gemBright: "#80DFFF",
  gemPurple: "#9060FF",
  gemDark:   "#006090",
  sparkle:   "#FFFFFF",
  bowString: "#D2B48C",
  arrow:     "#D4A574",
  arrowHead: "#A0A0A0",
  maceHead:  "#505050",
  maceLt:    "#707070",
  maceTrail: "rgba(80,80,80,0.25)",
  axeTrail:  "rgba(168,168,168,0.25)",
};

type PxFn = (x: number, y: number, w: number, h: number, color: string) => void;

/**
 * Generate procedural weapon textures for any types not loaded as PNGs.
 * Each weapon has 4 animation frames per direction:
 *   col 0 = idle1 (rest), col 1 = idle2 (breathing),
 *   col 2 = walk1 (swing forward), col 3 = walk2 (swing back)
 */
function ensureProceduralWeapons(scene: Phaser.Scene): void {
  for (const wtype of WEAPON_TYPES) {
    const key = `layer-weapon-${wtype}`;
    if (scene.textures.exists(key) || proceduralWeaponsDone.has(key)) continue;

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const c = canvas.getContext("2d")!;
    c.imageSmoothingEnabled = false;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const fx = col * PLAYER_FW;
        const fy = row * PLAYER_FH;
        const px: PxFn = (x, y, w, h, color) => {
          c.fillStyle = color;
          c.fillRect(fx + x, fy + y, w, h);
        };
        drawWeaponShape(px, wtype, row, col);
      }
    }

    scene.textures.addCanvas(key, canvas);
    proceduralWeaponsDone.add(key);
  }
}

function drawWeaponShape(px: PxFn, type: string, dir: number, col: number): void {
  switch (type) {
    case "sword":  drawSword(px, dir, col); break;
    case "axe":    drawAxe(px, dir, col); break;
    case "staff":  drawStaff(px, dir, col); break;
    case "bow":    drawBow(px, dir, col); break;
    case "dagger": drawDagger(px, dir, col); break;
    case "mace":   drawMace(px, dir, col); break;
  }
}

// ─── Sword: swing arc with motion trails ────────────────────────────

function drawSword(px: PxFn, dir: number, col: number): void {
  if (dir === DIR_DOWN || dir === DIR_UP) {
    const x = dir === DIR_DOWN ? 10 : 6;
    const dy = col === 1 ? -1 : 0;           // idle2 raised

    if (col < 2) {
      // Idle frames: straight blade
      px(x, 4 + dy, 1, 1, WC.bladeHi);
      px(x, 5 + dy, 1, 8, WC.blade);
      px(x - 1, 13 + dy, 3, 1, WC.guard);
      px(x, 14 + dy, 1, 4, WC.handle);
    } else if (col === 2) {
      // Walk1: swing right — diagonal blade + trail left
      px(x - 2, 5, 1, 7, WC.bladeTrail);     // motion trail
      px(x + 2, 4, 1, 1, WC.bladeHi);        // tip far right
      px(x + 2, 5, 1, 4, WC.blade);           // upper blade offset
      px(x + 1, 9, 1, 4, WC.blade);           // lower blade
      px(x - 1, 13, 3, 1, WC.guard);
      px(x, 14, 1, 4, WC.handle);
    } else {
      // Walk2: swing left — diagonal blade + trail right
      px(x + 2, 5, 1, 7, WC.bladeTrail);
      px(x - 2, 4, 1, 1, WC.bladeHi);
      px(x - 2, 5, 1, 4, WC.blade);
      px(x - 1, 9, 1, 4, WC.blade);
      px(x - 1, 13, 3, 1, WC.guard);
      px(x, 14, 1, 4, WC.handle);
    }
  } else {
    // LEFT / RIGHT — horizontal blade
    const y = 11;
    const left = dir === DIR_LEFT;
    const dy = col === 1 ? -1 : 0;

    if (col < 2) {
      // Idle frames
      if (left) {
        px(2, y + dy, 1, 1, WC.bladeHi);
        px(3, y + dy, 7, 1, WC.blade);
        px(10, y - 1 + dy, 1, 3, WC.guard);
        px(11, y + dy, 4, 1, WC.handle);
      } else {
        px(14, y + dy, 1, 1, WC.bladeHi);
        px(7, y + dy, 7, 1, WC.blade);
        px(6, y - 1 + dy, 1, 3, WC.guard);
        px(2, y + dy, 4, 1, WC.handle);
      }
    } else {
      // Walk: tip swings up(col2) / down(col3) with trail
      const swing = col === 2 ? -2 : 2;
      if (left) {
        px(2, y - swing, 8, 1, WC.bladeTrail);  // trail opposite
        px(2, y + swing, 1, 1, WC.bladeHi);      // tip swung
        px(3, y + swing, 4, 1, WC.blade);         // front half
        px(7, y, 3, 1, WC.blade);                 // back half level
        px(10, y - 1, 1, 3, WC.guard);
        px(11, y, 4, 1, WC.handle);
      } else {
        px(7, y - swing, 8, 1, WC.bladeTrail);
        px(14, y + swing, 1, 1, WC.bladeHi);
        px(10, y + swing, 4, 1, WC.blade);
        px(7, y, 3, 1, WC.blade);
        px(6, y - 1, 1, 3, WC.guard);
        px(2, y, 4, 1, WC.handle);
      }
    }
  }
}

// ─── Axe: heavy chop with trail ─────────────────────────────────────

function drawAxe(px: PxFn, dir: number, col: number): void {
  if (dir === DIR_DOWN || dir === DIR_UP) {
    const x = dir === DIR_DOWN ? 10 : 6;

    if (col < 2) {
      // Idle: standard + slight raise on col1
      const dy = col === 1 ? -1 : 0;
      px(x, 5 + dy, 1, 4, WC.blade);
      px(x + 1, 4 + dy, 1, 5, WC.blade);
      px(x + 2, 5 + dy, 1, 3, WC.blade);
      px(x, 9 + dy, 1, 8, WC.handle);
    } else if (col === 2) {
      // Walk1: axe raised high (wind-up)
      px(x, 7, 1, 6, WC.axeTrail);             // trail at rest pos
      px(x, 2, 1, 4, WC.blade);
      px(x + 1, 1, 1, 5, WC.blade);
      px(x + 2, 2, 1, 3, WC.blade);
      px(x, 6, 1, 11, WC.handle);
    } else {
      // Walk2: axe chopping down (follow-through)
      px(x, 2, 1, 5, WC.axeTrail);             // trail from raised
      px(x, 8, 1, 4, WC.blade);
      px(x + 1, 7, 1, 5, WC.blade);
      px(x + 2, 8, 1, 3, WC.blade);
      px(x, 12, 1, 6, WC.handle);
    }
  } else {
    const y = 11;
    const left = dir === DIR_LEFT;
    const dy = col === 1 ? -1 : 0;

    if (col < 2) {
      if (left) {
        px(2, y + dy, 4, 1, WC.blade);
        px(2, y - 1 + dy, 3, 1, WC.blade);
        px(2, y + 1 + dy, 3, 1, WC.blade);
        px(6, y + dy, 8, 1, WC.handle);
      } else {
        px(11, y + dy, 4, 1, WC.blade);
        px(12, y - 1 + dy, 3, 1, WC.blade);
        px(12, y + 1 + dy, 3, 1, WC.blade);
        px(2, y + dy, 9, 1, WC.handle);
      }
    } else {
      // Walk: head swings up(col2) / down(col3)
      const swing = col === 2 ? -2 : 2;
      if (left) {
        px(2, y - swing, 4, 1, WC.axeTrail);
        px(2, y + swing, 4, 1, WC.blade);
        px(2, y - 1 + swing, 3, 1, WC.blade);
        px(2, y + 1 + swing, 3, 1, WC.blade);
        px(6, y, 8, 1, WC.handle);
      } else {
        px(11, y - swing, 4, 1, WC.axeTrail);
        px(11, y + swing, 4, 1, WC.blade);
        px(12, y - 1 + swing, 3, 1, WC.blade);
        px(12, y + 1 + swing, 3, 1, WC.blade);
        px(2, y, 9, 1, WC.handle);
      }
    }
  }
}

// ─── Staff: gem pulse + magic sparkles ──────────────────────────────

function drawStaff(px: PxFn, dir: number, col: number): void {
  const x = (dir === DIR_DOWN || dir === DIR_RIGHT) ? 11 : 5;
  // Shaft sway for walk frames
  const sway = col === 2 ? 1 : col === 3 ? -1 : 0;
  const gemX = x + sway;

  // Gem color cycles: normal → bright → purple → normal
  const gemColors = [WC.gem, WC.gemBright, WC.gemPurple, WC.gem];
  const gc = gemColors[col];

  // Gem (diamond shape)
  px(gemX, 2, 1, 1, gc);
  px(gemX - 1, 3, 3, 1, gc);
  px(gemX, 4, 1, 1, gc);
  px(gemX, 3, 1, 1, WC.gemDark);

  // Sparkle pixel on idle2
  if (col === 1) {
    px(gemX + 2, 2, 1, 1, WC.sparkle);
  }
  // Magic particles on walk frames
  if (col === 2) {
    px(gemX - 2, 1, 1, 1, WC.sparkle);
    px(gemX + 1, 5, 1, 1, WC.gemBright);
  }
  if (col === 3) {
    px(gemX + 2, 1, 1, 1, WC.sparkle);
    px(gemX - 1, 5, 1, 1, WC.gemBright);
  }

  // Long shaft (top follows gem, bottom anchored)
  px(gemX, 5, 1, 3, WC.wood);           // upper shaft follows sway
  px(x, 8, 1, 11, WC.wood);             // lower shaft stays anchored
}

// ─── Bow: draw / release cycle with arrow ───────────────────────────

function drawBow(px: PxFn, dir: number, col: number): void {
  const bx = (dir === DIR_DOWN || dir === DIR_RIGHT) ? 10 : 6;
  const cd = (dir === DIR_DOWN || dir === DIR_RIGHT) ? 1 : -1;

  // String pull: idle=0, idle2=1px, walk1=2px (full draw), walk2=0 (release)
  const pull = col === 0 ? 0 : col === 1 ? 1 : col === 2 ? 2 : 0;
  const stringX = bx - cd * pull;

  // String
  px(stringX, 5, 1, 7, WC.bowString);

  // Arrow visible when string is pulled (col 1 and 2)
  if (pull > 0) {
    // Arrow shaft from string toward limb
    const arrowLen = 3 + pull;
    const arrowX = cd > 0
      ? stringX + 1                       // arrow points right
      : stringX - arrowLen;                // arrow points left
    px(arrowX, 8, arrowLen, 1, WC.arrow);
    // Arrowhead
    const headX = cd > 0 ? arrowX + arrowLen : arrowX;
    px(headX, 7, 1, 1, WC.arrowHead);
    px(headX, 9, 1, 1, WC.arrowHead);
  }

  // Curved limb
  px(bx, 4, 1, 1, WC.wood);
  px(bx + cd, 5, 1, 1, WC.wood);
  px(bx + cd * 2, 6, 1, 5, WC.wood);
  px(bx + cd, 11, 1, 1, WC.wood);
  px(bx, 12, 1, 1, WC.wood);

  // Release snap: walk2 shows string overshoot (vibration)
  if (col === 3) {
    px(bx + cd, 7, 1, 1, WC.bowString);  // string vibration pixel
    px(bx + cd, 9, 1, 1, WC.bowString);
  }
}

// ─── Dagger: quick jab ──────────────────────────────────────────────

function drawDagger(px: PxFn, dir: number, col: number): void {
  if (dir === DIR_DOWN || dir === DIR_UP) {
    const x = dir === DIR_DOWN ? 10 : 6;
    const dy = col === 1 ? -1 : 0;

    if (col < 2) {
      // Idle
      px(x, 9 + dy, 1, 1, WC.bladeHi);
      px(x, 10 + dy, 1, 3, WC.blade);
      px(x - 1, 13 + dy, 3, 1, WC.guard);
      px(x, 14 + dy, 1, 3, WC.handle);
    } else if (col === 2) {
      // Walk1: thrust up (blade extended 2px)
      px(x, 14, 1, 6, WC.bladeTrail);         // trail at rest
      px(x, 7, 1, 1, WC.bladeHi);
      px(x, 8, 1, 3, WC.blade);
      px(x - 1, 11, 3, 1, WC.guard);
      px(x, 12, 1, 3, WC.handle);
    } else {
      // Walk2: pulled back
      px(x, 7, 1, 3, WC.bladeTrail);          // trail from thrust
      px(x, 11, 1, 1, WC.bladeHi);
      px(x, 12, 1, 3, WC.blade);
      px(x - 1, 15, 3, 1, WC.guard);
      px(x, 16, 1, 3, WC.handle);
    }
  } else {
    const y = 12;
    const left = dir === DIR_LEFT;
    const dy = col === 1 ? -1 : 0;

    if (col < 2) {
      if (left) {
        px(6, y + dy, 1, 1, WC.bladeHi);
        px(7, y + dy, 3, 1, WC.blade);
        px(10, y - 1 + dy, 1, 3, WC.guard);
        px(11, y + dy, 3, 1, WC.handle);
      } else {
        px(10, y + dy, 1, 1, WC.bladeHi);
        px(7, y + dy, 3, 1, WC.blade);
        px(6, y - 1 + dy, 1, 3, WC.guard);
        px(3, y + dy, 3, 1, WC.handle);
      }
    } else if (col === 2) {
      // Walk1: thrust forward
      if (left) {
        px(8, y, 3, 1, WC.bladeTrail);
        px(4, y, 1, 1, WC.bladeHi);
        px(5, y, 3, 1, WC.blade);
        px(8, y - 1, 1, 3, WC.guard);
        px(9, y, 3, 1, WC.handle);
      } else {
        px(6, y, 3, 1, WC.bladeTrail);
        px(12, y, 1, 1, WC.bladeHi);
        px(9, y, 3, 1, WC.blade);
        px(8, y - 1, 1, 3, WC.guard);
        px(5, y, 3, 1, WC.handle);
      }
    } else {
      // Walk2: pulled back
      if (left) {
        px(5, y, 3, 1, WC.bladeTrail);
        px(8, y, 1, 1, WC.bladeHi);
        px(9, y, 3, 1, WC.blade);
        px(12, y - 1, 1, 3, WC.guard);
        px(13, y, 2, 1, WC.handle);
      } else {
        px(9, y, 3, 1, WC.bladeTrail);
        px(8, y, 1, 1, WC.bladeHi);
        px(5, y, 3, 1, WC.blade);
        px(4, y - 1, 1, 3, WC.guard);
        px(1, y, 3, 1, WC.handle);
      }
    }
  }
}

// ─── Mace: heavy overhead swing ─────────────────────────────────────

function drawMace(px: PxFn, dir: number, col: number): void {
  if (dir === DIR_DOWN || dir === DIR_UP) {
    const x = dir === DIR_DOWN ? 10 : 6;

    if (col < 2) {
      const dy = col === 1 ? -1 : 0;
      px(x - 1, 5 + dy, 3, 3, WC.maceHead);
      px(x - 1, 5 + dy, 1, 1, WC.maceLt);
      px(x + 1, 7 + dy, 1, 1, WC.maceLt);
      px(x, 8 + dy, 1, 9, WC.handle);
    } else if (col === 2) {
      // Walk1: mace raised high
      px(x - 1, 5, 3, 3, WC.maceTrail);        // ghost at rest
      px(x - 1, 2, 3, 3, WC.maceHead);          // head raised 3px
      px(x - 1, 2, 1, 1, WC.maceLt);
      px(x + 1, 4, 1, 1, WC.maceLt);
      px(x, 5, 1, 12, WC.handle);
    } else {
      // Walk2: mace slammed down
      px(x - 1, 2, 3, 3, WC.maceTrail);         // ghost from raised
      px(x - 1, 7, 3, 3, WC.maceHead);           // head lowered 2px
      px(x - 1, 7, 1, 1, WC.maceLt);
      px(x + 1, 9, 1, 1, WC.maceLt);
      px(x, 10, 1, 7, WC.handle);
      px(x - 1, 10, 3, 1, WC.maceTrail);         // impact line
    }
  } else {
    const y = 11;
    const left = dir === DIR_LEFT;
    const dy = col === 1 ? -1 : 0;

    if (col < 2) {
      if (left) {
        px(2, y - 1 + dy, 3, 3, WC.maceHead);
        px(2, y - 1 + dy, 1, 1, WC.maceLt);
        px(5, y + dy, 9, 1, WC.handle);
      } else {
        px(12, y - 1 + dy, 3, 3, WC.maceHead);
        px(12, y - 1 + dy, 1, 1, WC.maceLt);
        px(2, y + dy, 10, 1, WC.handle);
      }
    } else {
      const swing = col === 2 ? -2 : 2;
      if (left) {
        px(2, y - 1 - swing, 3, 3, WC.maceTrail);  // ghost
        px(2, y - 1 + swing, 3, 3, WC.maceHead);
        px(2, y - 1 + swing, 1, 1, WC.maceLt);
        px(5, y, 9, 1, WC.handle);
        if (col === 3) px(2, y + swing + 2, 3, 1, WC.maceTrail);  // impact
      } else {
        px(12, y - 1 - swing, 3, 3, WC.maceTrail);
        px(12, y - 1 + swing, 3, 3, WC.maceHead);
        px(12, y - 1 + swing, 1, 1, WC.maceLt);
        px(2, y, 10, 1, WC.handle);
        if (col === 3) px(12, y + swing + 2, 3, 1, WC.maceTrail);
      }
    }
  }
}

// ── Compositor ──────────────────────────────────────────────────────

/** Texture cache — tracks which composite textures have been created */
const composited = new Set<string>();

/**
 * Get or create a composited layered texture for a player entity.
 * Returns the texture key to use for the sprite.
 * Falls back to null if layer PNGs aren't loaded yet.
 */
export function getOrCreateLayeredTexture(
  scene: Phaser.Scene,
  entity: Entity,
): string | null {
  const keys = getLayerKeys(entity);
  const cacheKey = layerCacheKey(keys);

  // Already composited
  if (composited.has(cacheKey) && scene.textures.exists(cacheKey)) {
    return cacheKey;
  }

  // Check if the base body layer is loaded (minimum requirement)
  if (!scene.textures.exists(keys.body)) {
    return null;
  }

  // Generate procedural weapon textures if PNG layers didn't load
  ensureProceduralWeapons(scene);

  // Composite all layers
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  /**
   * Draw a layer onto the composite canvas.
   * Layer sheets are authored on the same 16x22 frame grid as the body.
   * Native draw (`scale = 1`) preserves that alignment; scaling remains as an
   * escape hatch for future art tweaks.
   */
  const drawLayer = (textureKey: string, opts?: { scale?: number; offsetX?: number; offsetY?: number }) => {
    if (!scene.textures.exists(textureKey)) return;
    const img = scene.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    const s = opts?.scale ?? 1;
    const ox = opts?.offsetX ?? 0;
    const oy = opts?.offsetY ?? 0;

    if (s !== 1) {
      // Scale each frame individually so it stays centered in its cell
      const fw = PLAYER_FW * s;
      const fh = PLAYER_FH * s;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const sx = c * PLAYER_FW;
          const sy = r * PLAYER_FH;
          // Center horizontally, anchor to bottom of cell vertically
          const dx = sx + (PLAYER_FW - fw) / 2 + ox;
          const dy = sy + (PLAYER_FH - fh) + oy;
          ctx.drawImage(img, sx, sy, PLAYER_FW, PLAYER_FH, dx, dy, fw, fh);
        }
      }
    } else {
      ctx.drawImage(img, ox, oy);
    }
  };

  const drawWeaponBehind = (textureKey: string, scale = WEAPON_LAYER_SCALE) => {
    if (!scene.textures.exists(textureKey)) return;
    const img = scene.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    const fw = PLAYER_FW * scale;
    const fh = PLAYER_FH * scale;
    // Only draw up + left rows (weapon behind body)
    for (const r of [DIR_LEFT, DIR_UP]) {
      for (let c = 0; c < COLS; c++) {
        const sx = c * PLAYER_FW;
        const sy = r * PLAYER_FH;
        const dx = sx + (PLAYER_FW - fw) / 2;
        const dy = sy + (PLAYER_FH - fh);
        ctx.drawImage(img, sx, sy, PLAYER_FW, PLAYER_FH, dx, dy, fw, fh);
      }
    }
  };

  const drawWeaponFront = (textureKey: string, scale = WEAPON_LAYER_SCALE) => {
    if (!scene.textures.exists(textureKey)) return;
    const img = scene.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    const fw = PLAYER_FW * scale;
    const fh = PLAYER_FH * scale;
    // Only draw down + right rows (weapon in front of body)
    for (const r of [DIR_DOWN, DIR_RIGHT]) {
      for (let c = 0; c < COLS; c++) {
        const sx = c * PLAYER_FW;
        const sy = r * PLAYER_FH;
        const dx = sx + (PLAYER_FW - fw) / 2;
        const dy = sy + (PLAYER_FH - fh);
        ctx.drawImage(img, sx, sy, PLAYER_FW, PLAYER_FH, dx, dy, fw, fh);
      }
    }
  };

  // Layer 1: base body
  drawLayer(keys.body);

  // Layer 4: weapon behind body
  if (keys.weapon) drawWeaponBehind(keys.weapon);

  // Layer 5-9: equipment
  if (keys.chest) drawLayer(keys.chest, { scale: CHEST_LAYER_SCALE });
  if (keys.legs) drawLayer(keys.legs, { scale: LEGS_LAYER_SCALE });
  if (keys.boots) drawLayer(keys.boots, { scale: BOOTS_LAYER_SCALE });
  if (keys.shoulders) drawLayer(keys.shoulders, { scale: SHOULDER_LAYER_SCALE });
  // Layer 10: weapon in front
  if (keys.weapon) drawWeaponFront(keys.weapon);

  // Register as Phaser texture with per-frame coordinates
  const tex = scene.textures.addCanvas(cacheKey, canvas);
  if (tex) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        tex.add(r * COLS + c, 0, c * PLAYER_FW, r * PLAYER_FH, PLAYER_FW, PLAYER_FH);
      }
    }
  }

  composited.add(cacheKey);
  return cacheKey;
}

/**
 * Check if an entity's current equipment/appearance produces a different
 * texture than what's currently assigned. Used to trigger re-compositing.
 */
export function needsRecomposite(entity: Entity, currentTextureKey: string): boolean {
  const keys = getLayerKeys(entity);
  const cacheKey = layerCacheKey(keys);
  return cacheKey !== currentTextureKey;
}

/** Invalidate a cached composite (e.g., on equipment change). */
export function invalidateComposite(cacheKey: string, scene: Phaser.Scene): void {
  composited.delete(cacheKey);
  if (scene.textures.exists(cacheKey)) {
    scene.textures.remove(cacheKey);
  }
}
