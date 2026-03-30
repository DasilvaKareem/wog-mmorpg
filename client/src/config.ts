/** API URL - use environment variable, or empty string for local dev (Vite proxy) */
export const API_URL = import.meta.env.VITE_API_URL || "";

/** Asset CDN base URL — Cloudflare R2 in prod, local fallback in dev */
export const ASSET_BASE_URL = import.meta.env.VITE_ASSET_BASE_URL || "";

/** Client-side tile size in pixels — 16px for Pokemon aesthetic */
export const CLIENT_TILE_PX = 16;

export const POLL_INTERVAL = 1000; // ms

const SKALE_BASE_MAINNET_CHAIN_ID = 1187947933;
const SKALE_BASE_SEPOLIA_CHAIN_ID = 324705682;
const SKALE_BASE_MAINNET_EXPLORER = "https://skale-base-explorer.skalenodes.com";
const SKALE_BASE_SEPOLIA_EXPLORER = "https://base-sepolia-testnet-explorer.skalenodes.com";

export function getSkaleExplorerBaseUrl(chainIdOverride?: string | number | null): string | null {
  const chainIdRaw = String(chainIdOverride ?? import.meta.env.VITE_SKALE_BASE_CHAIN_ID ?? "").trim();
  if (chainIdRaw) {
    const chainId = Number(chainIdRaw);
    if (chainId === SKALE_BASE_MAINNET_CHAIN_ID) return SKALE_BASE_MAINNET_EXPLORER;
    if (chainId === SKALE_BASE_SEPOLIA_CHAIN_ID) return SKALE_BASE_SEPOLIA_EXPLORER;
    if (chainId === 31337) return null;
  }

  const apiUrl = API_URL.toLowerCase();
  if (!apiUrl || apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1")) return null;
  if (apiUrl.includes("sepolia") || apiUrl.includes("testnet")) return SKALE_BASE_SEPOLIA_EXPLORER;
  return SKALE_BASE_MAINNET_EXPLORER;
}

export function getSkaleExplorerTxUrl(
  txHash: string | null | undefined,
  chainIdOverride?: string | number | null
): string | null {
  if (!txHash) return null;
  const baseUrl = getSkaleExplorerBaseUrl(chainIdOverride);
  if (!baseUrl) return null;
  return `${baseUrl}/tx/${txHash}`;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.15;
export const ZOOM_DEFAULT = 2.0;

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

/** Class-specific palettes for player sprites — each class gets a unique color */
export const CLASS_SPRITE_PALETTES: Record<string, { body: number[]; outline: number[]; detail: number[] }> = {
  warrior:  { body: [200, 50, 50],   outline: [120, 25, 25],   detail: [255, 180, 180] },  // crimson
  paladin:  { body: [230, 200, 60],  outline: [140, 120, 20],  detail: [255, 245, 180] },  // gold
  rogue:    { body: [130, 50, 180],  outline: [70, 25, 100],   detail: [200, 170, 230] },  // purple
  ranger:   { body: [50, 160, 60],   outline: [25, 90, 30],    detail: [170, 230, 175] },  // forest green
  mage:     { body: [50, 100, 220],  outline: [25, 50, 130],   detail: [170, 200, 255] },  // arcane blue
  cleric:   { body: [220, 220, 240], outline: [130, 130, 150], detail: [255, 255, 255] },  // silver/white
  warlock:  { body: [60, 180, 100],  outline: [30, 100, 50],   detail: [170, 240, 200] },  // fel green
  monk:     { body: [230, 150, 40],  outline: [140, 85, 15],   detail: [255, 220, 160] },  // saffron orange
};

export const CAMERA_SPEED = 8;

/** Entity sprite palettes — RGB arrays for programmatic sprite generation */
export const ENTITY_SPRITE_PALETTES: Record<string, { body: number[]; outline: number[]; detail: number[] }> = {
  player:              { body: [68, 221, 255],  outline: [30, 100, 140],  detail: [255, 255, 255] },
  mob:                 { body: [224, 64, 64],   outline: [120, 30, 30],   detail: [255, 180, 180] },
  npc:                 { body: [68, 136, 255],  outline: [30, 60, 140],   detail: [200, 220, 255] },
  merchant:            { body: [255, 204, 0],   outline: [140, 100, 0],   detail: [255, 240, 180] },
  trainer:             { body: [136, 255, 68],  outline: [60, 140, 30],   detail: [220, 255, 200] },
  "profession-trainer":{ body: [68, 255, 136],  outline: [30, 140, 60],   detail: [200, 255, 220] },
  boss:                { body: [170, 68, 255],  outline: [80, 30, 140],   detail: [220, 180, 255] },
  "guild-registrar":   { body: [200, 180, 50],  outline: [120, 100, 20],  detail: [255, 240, 150] },
  auctioneer:          { body: [180, 130, 50],  outline: [100, 70, 20],   detail: [240, 210, 150] },
  "arena-master":      { body: [200, 60, 60],   outline: [120, 30, 30],   detail: [255, 160, 160] },
  "quest-giver":       { body: [100, 180, 255], outline: [40, 90, 150],   detail: [200, 230, 255] },
};

/** Mob category palettes — matched by keyword in mob name.
 *  Used as fallback when no PNG sprite sheet exists for this mob. */
export const MOB_CATEGORY_PALETTES: Record<string, { body: number[]; outline: number[]; detail: number[]; shape: "quadruped" | "humanoid" }> = {
  wolf:    { body: [140, 140, 155], outline: [70, 70, 80],    detail: [200, 200, 210], shape: "quadruped" },
  bear:    { body: [140, 90, 50],   outline: [80, 50, 25],    detail: [190, 150, 100], shape: "quadruped" },
  rat:     { body: [160, 130, 90],  outline: [90, 70, 40],    detail: [210, 190, 150], shape: "quadruped" },
  boar:    { body: [130, 80, 70],   outline: [70, 40, 35],    detail: [180, 140, 130], shape: "quadruped" },
  spider:  { body: [80, 50, 100],   outline: [40, 20, 55],    detail: [150, 120, 180], shape: "quadruped" },
  slime:   { body: [80, 200, 80],   outline: [40, 120, 40],   detail: [160, 240, 160], shape: "quadruped" },
  goblin:  { body: [80, 160, 60],   outline: [40, 90, 30],    detail: [150, 220, 130], shape: "humanoid" },
  bandit:  { body: [90, 80, 75],    outline: [50, 45, 40],    detail: [160, 150, 140], shape: "humanoid" },
  cultist: { body: [100, 40, 120],  outline: [55, 20, 65],    detail: [170, 120, 190], shape: "humanoid" },
  undead:  { body: [170, 170, 160], outline: [100, 100, 90],  detail: [220, 220, 210], shape: "humanoid" },
  ent:     { body: [90, 120, 50],   outline: [50, 70, 25],    detail: [150, 180, 100], shape: "quadruped" },
  troll:   { body: [60, 120, 80],   outline: [30, 65, 40],    detail: [130, 190, 150], shape: "humanoid" },
  golem:   { body: [130, 130, 140], outline: [70, 70, 80],    detail: [190, 190, 200], shape: "quadruped" },
  snake:   { body: [80, 140, 60],   outline: [40, 80, 30],    detail: [140, 200, 120], shape: "quadruped" },
};

/**
 * Map from keyword found in mob name → sprite PNG filename (without extension).
 * These are loaded from /sprites/mobs/mob-{id}.png when available.
 * Order matters — first match wins, so more specific keywords come first.
 */
export const MOB_SPRITE_IDS: Array<[keyword: string, spriteId: string]> = [
  // Specific names first (avoid false matches)
  ["necromancer", "necromancer"],
  ["archdruid", "archdruid"],
  ["infernal", "infernal"],
  ["forgemaster", "infernal"],
  ["titan", "titan"],
  ["avalanche", "titan"],
  ["warden", "warden"],
  ["solaris", "warden"],
  ["sentinel", "sentinel"],
  ["grom", "sentinel"],
  ["dragonkin", "dragonkin"],
  ["dragon", "dragon"],
  ["azurshard", "dragon"],
  ["drake", "drake"],
  ["skyward", "drake"],
  ["wyrm", "wyrm"],
  ["chasm", "wyrm"],
  // Citadel
  ["automaton", "automaton"],
  ["forgebound", "forgebound"],
  ["molten", "forgebound"],
  ["dweller", "dweller"],
  ["dwarf", "dwarf"],
  // Lake
  ["luminous", "luminous"],
  ["crystal", "crystal"],
  ["drowned", "drowned"],
  ["lumen", "lumen"],
  ["horror", "horror"],
  ["sunken", "horror"],
  // Chasm
  ["weaver", "weaver"],
  ["void", "weaver"],
  ["shard", "shard"],
  ["devourer", "devourer"],
  // Mountains
  ["yeti", "yeti"],
  ["basilisk", "basilisk"],
  ["condor", "condor"],
  ["giant", "giant"],
  ["frost", "giant"],
  // Glade
  ["fae", "fae"],
  ["dryad", "dryad"],
  ["druid", "druid"],
  ["shadow druid", "druid"],
  // Plains
  ["stalker", "stalker"],
  ["wisp", "wisp"],
  ["aurora", "wisp"],
  ["harpy", "harpy"],
  ["elemental", "elemental"],
  ["storm", "elemental"],
  // Woods
  ["treant", "treant"],
  ["serpent", "serpent"],
  ["worg", "worg"],
  ["specter", "specter"],
  ["guardian", "guardian"],
  // Wraith (generic — after more specific wraith types)
  ["wraith", "wraith"],
  // Base categories
  ["wolf", "wolf"],
  ["bear", "bear"],
  ["rat", "rat"],
  ["boar", "boar"],
  ["spider", "spider"],
  ["slime", "slime"],
  ["goblin", "goblin"],
  ["bandit", "bandit"],
  ["cultist", "cultist"],
  ["undead", "undead"],
  ["ent", "ent"],
  ["troll", "troll"],
  ["golem", "golem"],
  ["snake", "snake"],
];

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
