/** Client-side tile size in pixels (each server tile renders as this many px) */
export const CLIENT_TILE_PX = 16; // Reduced from 32 to make tiles less visible

export const POLL_INTERVAL = 1000; // ms

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;

export const ENTITY_COLORS: Record<string, number> = {
  player: 0x44ddff,
  mob: 0xe04040,
  npc: 0x4488ff,
  merchant: 0xffcc00,
  trainer: 0x88ff44,
  "profession-trainer": 0x44ff88,
  boss: 0xaa44ff,
};

export const DEFAULT_ENTITY_COLOR = 0xcccccc;

export const CAMERA_SPEED = 8;

/** SNES-style terrain color palettes — { base, dark, light } as 0xRRGGBB */
export interface TilePalette {
  base: number;
  dark: number;
  light: number;
}

export const TERRAIN_PALETTES: Record<string, TilePalette> = {
  grass:  { base: 0x6abe30, dark: 0x4b8929, light: 0x8cd650 },
  dirt:   { base: 0xc8a062, dark: 0xa07840, light: 0xd8b87a },
  forest: { base: 0x3e6a28, dark: 0x284a18, light: 0x4e7a38 },
  water:  { base: 0x306888, dark: 0x204868, light: 0x4888b0 },
  rock:   { base: 0x6b6b6b, dark: 0x505050, light: 0x888888 },
  mud:    { base: 0x7a5c28, dark: 0x5a4018, light: 0x9a7838 },
  stone:  { base: 0x989890, dark: 0x787870, light: 0xb0b0a8 },
};
