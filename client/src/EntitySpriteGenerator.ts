import Phaser from "phaser";
import { ENTITY_SPRITE_PALETTES } from "./config.js";

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

// Directions: row index
const DIR_DOWN = 0;
const DIR_LEFT = 1;
const DIR_RIGHT = 2;
const DIR_UP = 3;

// Entity type categories
const HUMANOID_TYPES = [
  "player", "npc", "merchant", "trainer", "profession-trainer",
  "boss", "guild-registrar", "auctioneer",
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
    const pal = ENTITY_SPRITE_PALETTES[type] ?? DEFAULT_PALETTE;
    const canvas = generateHumanoidSheet(pal);
    addCanvasSpriteSheet(scene, key, canvas);
    createAnimations(scene, key);
  }

  // Generic mob sheet
  if (!scene.textures.exists("entity-mob")) {
    const pal = ENTITY_SPRITE_PALETTES["mob"] ?? DEFAULT_PALETTE;
    const canvas = generateMobSheet(pal, "quadruped");
    addCanvasSpriteSheet(scene, "entity-mob", canvas);
    createAnimations(scene, "entity-mob");
  }

  // Static entities (ore-node, flower-node, forge, etc.)
  if (!scene.textures.exists("entity-static")) {
    const canvas = generateStaticSheet();
    addCanvasSpriteSheet(scene, "entity-static", canvas);
  }
}

/** Register a canvas as a spritesheet texture with frame parsing */
function addCanvasSpriteSheet(
  scene: Phaser.Scene,
  key: string,
  canvas: HTMLCanvasElement,
): void {
  const tex = scene.textures.addCanvas(key, canvas);
  if (tex) {
    Phaser.Textures.Parsers.SpriteSheet(
      tex,
      0,
      0, 0,
      canvas.width, canvas.height,
      { frameWidth: SPRITE_PX, frameHeight: SPRITE_PX },
    );
  }
}

/** Get the texture key for an entity type */
export function getEntityTextureKey(entityType: string): string {
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
