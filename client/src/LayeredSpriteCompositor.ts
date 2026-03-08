import Phaser from "phaser";
import { ASSET_BASE_URL } from "./config.js";
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
const EYE_COLORS = ["blue", "green", "brown", "red", "gold"];
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
  for (const eye of EYE_COLORS) {
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
  hair: string;
  weapon: string | null;
  chest: string | null;
  legs: string | null;
  boots: string | null;
  helm: string | null;
  shoulders: string | null;
}

/** Derive the layer texture keys from an entity's appearance + equipment */
export function getLayerKeys(entity: Entity): LayerKeys {
  const skinTone = entity.skinColor ?? DEFAULT_SKIN;
  const eyeColor = entity.eyeColor ?? DEFAULT_EYES;
  const hairStyle = entity.hairStyle ?? DEFAULT_HAIR;

  // Equipment visual lookups — we only have item name from the tokenId reference
  // For now, use a name-based heuristic via the entity's equipment data
  const eq = entity.equipment ?? {};

  // We need item names. The equipment object stores tokenId + durability.
  // The client doesn't have the full item catalog, so we'll add a lightweight
  // name field. For now, derive from what data is available or use defaults.
  const weaponName = (eq.weapon as any)?.name as string | undefined;
  const chestName = (eq.chest as any)?.name as string | undefined;
  const legsName = (eq.legs as any)?.name as string | undefined;
  const bootsName = (eq.boots as any)?.name as string | undefined;
  const helmName = (eq.helm as any)?.name as string | undefined;
  const shouldersName = (eq.shoulders as any)?.name as string | undefined;

  const weaponType = weaponVisual(weaponName);

  return {
    body: `layer-body-${skinTone}`,
    eyes: `layer-eyes-${eyeColor}`,
    hair: `layer-hair-${hairStyle}`,
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
    keys.eyes,
    keys.hair,
    keys.weapon ?? "no-weapon",
    keys.chest ?? "no-chest",
    keys.legs ?? "no-legs",
    keys.boots ?? "no-boots",
    keys.helm ?? "no-helm",
    keys.shoulders ?? "no-shoulders",
  ].join("|");
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

  // Composite all layers
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const drawLayer = (textureKey: string) => {
    if (!scene.textures.exists(textureKey)) return;
    const img = scene.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    ctx.drawImage(img, 0, 0);
  };

  const drawWeaponBehind = (textureKey: string) => {
    if (!scene.textures.exists(textureKey)) return;
    const img = scene.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    // Clip to up + left rows only (weapon behind body)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, DIR_LEFT * PLAYER_FH, CANVAS_W, PLAYER_FH);   // left row
    ctx.rect(0, DIR_UP * PLAYER_FH, CANVAS_W, PLAYER_FH);     // up row
    ctx.clip();
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };

  const drawWeaponFront = (textureKey: string) => {
    if (!scene.textures.exists(textureKey)) return;
    const img = scene.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    // Clip to down + right rows only (weapon in front of body)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, DIR_DOWN * PLAYER_FH, CANVAS_W, PLAYER_FH);   // down row
    ctx.rect(0, DIR_RIGHT * PLAYER_FH, CANVAS_W, PLAYER_FH);  // right row
    ctx.clip();
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };

  // Layer 1-3: base appearance
  drawLayer(keys.body);
  drawLayer(keys.eyes);
  drawLayer(keys.hair);

  // Layer 4: weapon behind body
  if (keys.weapon) drawWeaponBehind(keys.weapon);

  // Layer 5-9: equipment
  if (keys.chest) drawLayer(keys.chest);
  if (keys.legs) drawLayer(keys.legs);
  if (keys.boots) drawLayer(keys.boots);
  if (keys.shoulders) drawLayer(keys.shoulders);
  if (keys.helm) drawLayer(keys.helm);

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
