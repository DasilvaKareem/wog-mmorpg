import Phaser from "phaser";
import { ENTITY_SPRITE_PALETTES, CLASS_SPRITE_PALETTES, MOB_CATEGORY_PALETTES } from "./config.js";

/**
 * Generates 16x16 sprite sheets for entity types and registers
 * Phaser animations. Each sheet is 64x64: 4 cols x 4 rows.
 *
 * Cols: idle1, idle2, walk1, walk2
 * Rows: down(0), left(1), right(2), up(3)
 */

const SPRITE_PX = 16;
const COLS = 4; // idle1, idle2, walk1, walk2
const ROWS = 4; // down, left, right, up
const SHEET_W = COLS * SPRITE_PX;
const SHEET_H = ROWS * SPRITE_PX;

// Player character sprites use taller frames from real sprite sheets
const PLAYER_FW = 16;
const PLAYER_FH = 22;

// Directions: row index
const DIR_DOWN = 0;
const DIR_LEFT = 1;
const DIR_RIGHT = 2;
const DIR_UP = 3;

// ── Real character sprite sheet configs ──────────────────────────────
// Each skin defines the source frame positions in its PNG.
// Sheet row order: 0=down, 1=right, 2=up, 3=left
// Canvas row order: 0=down, 1=left, 2=right, 3=up
interface CharSheetConfig {
  imageKey: string;
  rows: Array<{ y: number; h: number }>; // [down, right, up, left] in sheet order
  walkX0: number;
  walkSpacing: number;
  walkW: number;
}

const CHAR_SHEETS: Record<string, CharSheetConfig> = {
  a: {
    imageKey: "char-sheet-a",
    rows: [
      { y: 6, h: 22 },   // down
      { y: 38, h: 22 },  // right
      { y: 69, h: 23 },  // up
      { y: 102, h: 22 }, // left
    ],
    walkX0: 0, walkSpacing: 16, walkW: 16,
  },
  b: {
    imageKey: "char-sheet-b",
    rows: [
      { y: 19, h: 92 },  // down
      { y: 149, h: 88 }, // right
      { y: 271, h: 92 }, // up
      { y: 400, h: 89 }, // left
    ],
    walkX0: 0, walkSpacing: 62, walkW: 62,
  },
  c: {
    imageKey: "char-sheet-c",
    rows: [
      { y: 19, h: 92 },  // down
      { y: 149, h: 88 }, // right
      { y: 271, h: 92 }, // up
      { y: 400, h: 89 }, // left
    ],
    walkX0: 0, walkSpacing: 62, walkW: 62,
  },
};

// Map class → character skin
const CLASS_TO_SKIN: Record<string, string> = {
  warrior: "a",
  paladin: "c",
  rogue: "b",
  ranger: "a",
  mage: "a",
  cleric: "a",
  warlock: "b",
  monk: "b",
};

// Entity type categories
const HUMANOID_TYPES = [
  "player", "npc", "merchant", "trainer", "profession-trainer",
  "boss", "guild-registrar", "auctioneer", "arena-master", "quest-giver",
];

const MOB_SHAPES: Record<string, string> = {
  wolf: "quadruped",
  spider: "spider",
  rat: "small",
  snake: "small",
  bear: "quadruped",
  skeleton: "humanoid",
  ghost: "humanoid",
};

const DEFAULT_PALETTE = { body: [180, 180, 180], outline: [80, 80, 80], detail: [255, 255, 255] };

/**
 * Register all entity sprite sheets and animations.
 * Call once from WorldScene.create().
 */
export function registerEntitySprites(scene: Phaser.Scene): void {
  // Generate humanoid sheets
  for (const type of HUMANOID_TYPES) {
    const key = `entity-${type}`;
    if (scene.textures.exists(key)) continue;
    // Use real sprite sheet for generic player type
    if (type === "player") {
      const config = CHAR_SHEETS["a"];
      if (config && scene.textures.exists(config.imageKey)) {
        registerCharacterSpriteSheet(scene, key, config);
        createAnimations(scene, key);
        continue;
      }
    }
    const pal = ENTITY_SPRITE_PALETTES[type] ?? DEFAULT_PALETTE;
    const canvas = generateHumanoidSheet(pal);
    addCanvasSpriteSheet(scene, key, canvas);
    createAnimations(scene, key);
  }

  // Generate per-class player sheets from real sprite PNGs
  for (const [classId] of Object.entries(CLASS_SPRITE_PALETTES)) {
    const key = `entity-player-${classId}`;
    if (scene.textures.exists(key)) continue;
    const skinId = CLASS_TO_SKIN[classId] ?? "a";
    const config = CHAR_SHEETS[skinId];
    if (config && scene.textures.exists(config.imageKey)) {
      registerCharacterSpriteSheet(scene, key, config);
    } else {
      // Fallback to procedural if PNG not loaded
      const pal = CLASS_SPRITE_PALETTES[classId] ?? DEFAULT_PALETTE;
      const canvas = generateHumanoidSheet(pal);
      addCanvasSpriteSheet(scene, key, canvas);
    }
    createAnimations(scene, key);
  }

  // Generic mob sheet (fallback)
  if (!scene.textures.exists("entity-mob")) {
    const pal = ENTITY_SPRITE_PALETTES["mob"] ?? DEFAULT_PALETTE;
    const canvas = generateMobSheet(pal, "quadruped");
    addCanvasSpriteSheet(scene, "entity-mob", canvas);
    createAnimations(scene, "entity-mob");
  }

  // Per-category mob sheets
  for (const [category, catPal] of Object.entries(MOB_CATEGORY_PALETTES)) {
    const key = `entity-mob-${category}`;
    if (scene.textures.exists(key)) continue;
    const pal = { body: catPal.body, outline: catPal.outline, detail: catPal.detail };
    const canvas = catPal.shape === "humanoid"
      ? generateHumanoidSheet(pal)
      : generateMobSheet(pal, "quadruped");
    addCanvasSpriteSheet(scene, key, canvas);
    createAnimations(scene, key);
  }

  // Static entities (ore-node, flower-node, forge, etc.)
  if (!scene.textures.exists("entity-static")) {
    const canvas = generateStaticSheet();
    addCanvasSpriteSheet(scene, "entity-static", canvas);
  }
}

/**
 * Create a player sprite sheet from a real PNG character sheet.
 * Extracts 4 walk frames per direction and composites into the
 * standard 4-col x 4-row layout (idle1, idle2, walk1, walk2 x down, left, right, up).
 */
function registerCharacterSpriteSheet(
  scene: Phaser.Scene,
  textureKey: string,
  config: CharSheetConfig,
): void {
  const srcTex = scene.textures.get(config.imageKey);
  const srcImg = srcTex.getSourceImage() as HTMLImageElement;

  const canvasW = COLS * PLAYER_FW;   // 64
  const canvasH = ROWS * PLAYER_FH;   // 88
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Sheet row order: 0=down, 1=right, 2=up, 3=left
  // Canvas row order: 0=down, 1=left, 2=right, 3=up
  const dirMap: Array<{ sheetRow: number; canvasRow: number }> = [
    { sheetRow: 0, canvasRow: DIR_DOWN },
    { sheetRow: 3, canvasRow: DIR_LEFT },
    { sheetRow: 1, canvasRow: DIR_RIGHT },
    { sheetRow: 2, canvasRow: DIR_UP },
  ];

  // Column mapping: canvas col → source frame index
  // idle1=F0, idle2=F2, walk1=F1, walk2=F3
  const frameOrder = [0, 2, 1, 3];

  for (const { sheetRow, canvasRow } of dirMap) {
    const srcRow = config.rows[sheetRow];
    for (let col = 0; col < COLS; col++) {
      const srcFrame = frameOrder[col];
      const sx = config.walkX0 + srcFrame * config.walkSpacing;
      const sy = srcRow.y;
      const sw = config.walkW;
      const sh = srcRow.h;
      const dx = col * PLAYER_FW;
      const dy = canvasRow * PLAYER_FH;
      ctx.drawImage(srcImg, sx, sy, sw, sh, dx, dy, PLAYER_FW, PLAYER_FH);
    }
  }

  // Strip black background pixels → transparent
  // characterB/C PNGs have opaque black backgrounds instead of alpha
  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 10 && data[i + 1] < 10 && data[i + 2] < 10) {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Register texture with per-frame coordinates (non-square frames)
  const tex = scene.textures.addCanvas(textureKey, canvas);
  if (tex) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const frameIdx = r * COLS + c;
        tex.add(frameIdx, 0, c * PLAYER_FW, r * PLAYER_FH, PLAYER_FW, PLAYER_FH);
      }
    }
  }
}

/** Register a canvas as a spritesheet texture with manually defined frames */
function addCanvasSpriteSheet(
  scene: Phaser.Scene,
  key: string,
  canvas: HTMLCanvasElement,
): void {
  const tex = scene.textures.addCanvas(key, canvas);
  if (tex) {
    const cols = canvas.width / SPRITE_PX;
    const rows = canvas.height / SPRITE_PX;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const frameIdx = r * cols + c;
        tex.add(frameIdx, 0, c * SPRITE_PX, r * SPRITE_PX, SPRITE_PX, SPRITE_PX);
      }
    }
  }
}

/** Infer mob category from entity name by keyword matching */
export function inferMobCategory(name: string): string | null {
  const lower = name.toLowerCase();
  // Check each category keyword against the mob name
  for (const category of Object.keys(MOB_CATEGORY_PALETTES)) {
    if (lower.includes(category)) return category;
  }
  return null;
}

/** Get the texture key for an entity type, with optional class/name-specific variant */
export function getEntityTextureKey(entityType: string, classId?: string, entityName?: string): string {
  if (entityType === "player" && classId && CLASS_SPRITE_PALETTES[classId]) {
    return `entity-player-${classId}`;
  }
  if (entityType === "mob" && entityName) {
    const category = inferMobCategory(entityName);
    if (category) return `entity-mob-${category}`;
    return "entity-mob";
  }
  if (HUMANOID_TYPES.includes(entityType)) return `entity-${entityType}`;
  if (entityType === "mob") return "entity-mob";
  // Static types
  return "entity-static";
}

/** Get the starting frame for a direction */
export function directionFrame(dir: "down" | "left" | "right" | "up"): number {
  switch (dir) {
    case "down": return DIR_DOWN * COLS;
    case "left": return DIR_LEFT * COLS;
    case "right": return DIR_RIGHT * COLS;
    case "up": return DIR_UP * COLS;
  }
}

/** Infer direction from movement delta */
export function inferDirection(dx: number, dy: number): "down" | "left" | "right" | "up" {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}

// ── Animation registration ───────────────────────────────────────────

function createAnimations(scene: Phaser.Scene, key: string): void {
  const dirs = ["down", "left", "right", "up"];
  for (let d = 0; d < 4; d++) {
    const dir = dirs[d];
    const base = d * COLS;

    // Idle animation: 2 frames at 2fps
    const idleKey = `${key}-idle-${dir}`;
    if (!scene.anims.exists(idleKey)) {
      scene.anims.create({
        key: idleKey,
        frames: [{ key, frame: base }, { key, frame: base + 1 }],
        frameRate: 2,
        repeat: -1,
      });
    }

    // Walk animation: 2 frames at 6fps
    const walkKey = `${key}-walk-${dir}`;
    if (!scene.anims.exists(walkKey)) {
      scene.anims.create({
        key: walkKey,
        frames: [{ key, frame: base + 2 }, { key, frame: base + 3 }],
        frameRate: 6,
        repeat: -1,
      });
    }
  }
}

// ── Sheet generation ─────────────────────────────────────────────────

type Pal = { body: number[]; outline: number[]; detail: number[] };

function generateHumanoidSheet(pal: Pal): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SHEET_W, SHEET_H);
  const px = img.data;

  for (let dir = 0; dir < 4; dir++) {
    for (let frame = 0; frame < 4; frame++) {
      drawHumanoid(px, frame, dir, pal);
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function generateMobSheet(pal: Pal, shape: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SHEET_W, SHEET_H);
  const px = img.data;

  for (let dir = 0; dir < 4; dir++) {
    for (let frame = 0; frame < 4; frame++) {
      drawQuadruped(px, frame, dir, pal);
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function generateStaticSheet(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SHEET_W, SHEET_H);
  const px = img.data;

  // Just draw a simple static object in the first frame slot
  const pal = { body: [160, 160, 160], outline: [80, 80, 80], detail: [200, 200, 200] };
  for (let dir = 0; dir < 4; dir++) {
    for (let frame = 0; frame < 4; frame++) {
      drawStaticObject(px, frame, dir, pal);
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ── Pixel drawing ────────────────────────────────────────────────────

function setPixel(
  px: Uint8ClampedArray,
  col: number,
  row: number,
  lx: number,
  ly: number,
  color: number[],
): void {
  const x = col * SPRITE_PX + lx;
  const y = row * SPRITE_PX + ly;
  const idx = (y * SHEET_W + x) * 4;
  px[idx] = color[0];
  px[idx + 1] = color[1];
  px[idx + 2] = color[2];
  px[idx + 3] = 255;
}

function set2x2(
  px: Uint8ClampedArray,
  col: number,
  row: number,
  bx: number,
  by: number,
  color: number[],
): void {
  // bx, by are in 2x2 block coordinates (0-7)
  const x0 = bx * 2;
  const y0 = by * 2;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      setPixel(px, col, row, x0 + dx, y0 + dy, color);
    }
  }
}

/**
 * Draw a humanoid character sprite at the given frame/direction slot.
 * Uses 2x2 pixel blocks for the chunky Pokemon look.
 *
 * 8x8 grid of 2x2 blocks = 16x16 pixels
 * Layout (down-facing):
 *   Row 0-1: head (4 blocks wide centered)
 *   Row 2-4: body (4 blocks wide)
 *   Row 5-6: legs (walk frames shift legs)
 *   Row 7:   feet
 */
function drawHumanoid(
  px: Uint8ClampedArray,
  frame: number,
  dir: number,
  pal: Pal,
): void {
  const col = frame;
  const row = dir;

  const isWalk = frame >= 2;
  const walkPhase = frame % 2; // 0 or 1

  // Head (rows 0-1)
  // Skin color (slightly lighter than body)
  const skin = [
    Math.min(255, pal.detail[0]),
    Math.min(255, pal.detail[1]),
    Math.min(255, pal.detail[2]),
  ];

  // Head outline
  set2x2(px, col, row, 2, 0, pal.outline);
  set2x2(px, col, row, 3, 0, pal.outline);
  set2x2(px, col, row, 4, 0, pal.outline);
  set2x2(px, col, row, 5, 0, pal.outline);

  // Head fill
  set2x2(px, col, row, 3, 0, skin);
  set2x2(px, col, row, 4, 0, skin);
  set2x2(px, col, row, 2, 1, pal.outline);
  set2x2(px, col, row, 3, 1, skin);
  set2x2(px, col, row, 4, 1, skin);
  set2x2(px, col, row, 5, 1, pal.outline);

  // Eyes (direction dependent)
  if (dir === DIR_DOWN) {
    setPixel(px, col, row, 6, 3, [20, 20, 20]);
    setPixel(px, col, row, 9, 3, [20, 20, 20]);
  } else if (dir === DIR_UP) {
    // No eyes visible from back
  } else if (dir === DIR_LEFT) {
    setPixel(px, col, row, 5, 3, [20, 20, 20]);
  } else {
    setPixel(px, col, row, 10, 3, [20, 20, 20]);
  }

  // Body (rows 2-4)
  for (let by = 2; by <= 4; by++) {
    set2x2(px, col, row, 2, by, pal.outline);
    set2x2(px, col, row, 3, by, pal.body);
    set2x2(px, col, row, 4, by, pal.body);
    set2x2(px, col, row, 5, by, pal.outline);
  }

  // Belt / detail line
  set2x2(px, col, row, 3, 4, pal.outline);
  set2x2(px, col, row, 4, 4, pal.outline);

  // Legs (rows 5-6) — walking animation shifts legs
  if (isWalk && walkPhase === 0) {
    // Left leg forward
    set2x2(px, col, row, 2, 5, pal.outline);
    set2x2(px, col, row, 3, 5, pal.body);
    set2x2(px, col, row, 4, 5, pal.body);
    set2x2(px, col, row, 5, 5, pal.outline);
    set2x2(px, col, row, 2, 6, pal.outline);
    set2x2(px, col, row, 3, 6, pal.outline);
    set2x2(px, col, row, 5, 6, pal.body);
    set2x2(px, col, row, 4, 6, pal.outline);
  } else if (isWalk && walkPhase === 1) {
    // Right leg forward
    set2x2(px, col, row, 2, 5, pal.outline);
    set2x2(px, col, row, 3, 5, pal.body);
    set2x2(px, col, row, 4, 5, pal.body);
    set2x2(px, col, row, 5, 5, pal.outline);
    set2x2(px, col, row, 3, 6, pal.body);
    set2x2(px, col, row, 2, 6, pal.outline);
    set2x2(px, col, row, 4, 6, pal.outline);
    set2x2(px, col, row, 5, 6, pal.outline);
  } else {
    // Standing
    set2x2(px, col, row, 2, 5, pal.outline);
    set2x2(px, col, row, 3, 5, pal.body);
    set2x2(px, col, row, 4, 5, pal.body);
    set2x2(px, col, row, 5, 5, pal.outline);
    set2x2(px, col, row, 3, 6, pal.outline);
    set2x2(px, col, row, 4, 6, pal.outline);
  }

  // Feet (row 7)
  set2x2(px, col, row, 3, 7, pal.outline);
  set2x2(px, col, row, 4, 7, pal.outline);
}

/**
 * Draw a quadruped mob (wolf, bear shape).
 * Wider body, 4 legs.
 */
function drawQuadruped(
  px: Uint8ClampedArray,
  frame: number,
  dir: number,
  pal: Pal,
): void {
  const col = frame;
  const row = dir;
  const isWalk = frame >= 2;
  const phase = frame % 2;

  if (dir === DIR_DOWN || dir === DIR_UP) {
    // Front/back view: head on top, body below
    // Head (rows 0-2)
    set2x2(px, col, row, 2, 0, pal.outline);
    set2x2(px, col, row, 3, 0, pal.body);
    set2x2(px, col, row, 4, 0, pal.body);
    set2x2(px, col, row, 5, 0, pal.outline);

    set2x2(px, col, row, 2, 1, pal.body);
    set2x2(px, col, row, 3, 1, pal.body);
    set2x2(px, col, row, 4, 1, pal.body);
    set2x2(px, col, row, 5, 1, pal.body);

    // Eyes
    if (dir === DIR_DOWN) {
      setPixel(px, col, row, 5, 2, [255, 50, 50]);
      setPixel(px, col, row, 10, 2, [255, 50, 50]);
    }

    // Body (rows 2-5)
    for (let by = 2; by <= 5; by++) {
      set2x2(px, col, row, 1, by, pal.outline);
      set2x2(px, col, row, 2, by, pal.body);
      set2x2(px, col, row, 3, by, pal.body);
      set2x2(px, col, row, 4, by, pal.body);
      set2x2(px, col, row, 5, by, pal.body);
      set2x2(px, col, row, 6, by, pal.outline);
    }

    // Legs (rows 6-7)
    const legShift = isWalk ? (phase === 0 ? -1 : 1) : 0;
    set2x2(px, col, row, 2, 6, pal.outline);
    set2x2(px, col, row, 5, 6, pal.outline);
    set2x2(px, col, row, 2, 7, pal.outline);
    set2x2(px, col, row, 5, 7, pal.outline);
  } else {
    // Side view: elongated horizontal body
    // Head (left side for DIR_LEFT, right for DIR_RIGHT)
    const headX = dir === DIR_LEFT ? 1 : 5;
    const tailX = dir === DIR_LEFT ? 7 : 0;

    // Body runs horizontal
    for (let bx = 1; bx <= 6; bx++) {
      set2x2(px, col, row, bx, 2, pal.outline);
      set2x2(px, col, row, bx, 3, pal.body);
      set2x2(px, col, row, bx, 4, pal.body);
      set2x2(px, col, row, bx, 5, pal.outline);
    }

    // Head bump
    set2x2(px, col, row, headX, 1, pal.outline);
    set2x2(px, col, row, headX, 2, pal.body);
    // Eye
    setPixel(px, col, row, headX * 2 + 1, 3, [255, 50, 50]);

    // Tail
    set2x2(px, col, row, tailX, 3, pal.outline);

    // Legs
    const legOff = isWalk && phase === 0 ? 1 : 0;
    set2x2(px, col, row, 2, 6 + legOff, pal.outline);
    set2x2(px, col, row, 5, 6 + (legOff === 0 ? 1 : 0), pal.outline);
    set2x2(px, col, row, 2, 7, pal.outline);
    set2x2(px, col, row, 5, 7, pal.outline);
  }
}

/** Simple static object (ore node, etc.) — no animation, same frame in all slots */
function drawStaticObject(
  px: Uint8ClampedArray,
  frame: number,
  dir: number,
  pal: Pal,
): void {
  const col = frame;
  const row = dir;

  // Simple rounded rectangle
  for (let by = 2; by <= 6; by++) {
    for (let bx = 2; bx <= 5; bx++) {
      const isEdge = by === 2 || by === 6 || bx === 2 || bx === 5;
      set2x2(px, col, row, bx, by, isEdge ? pal.outline : pal.body);
    }
  }
  // Sparkle
  set2x2(px, col, row, 3, 3, pal.detail);
}
