import { randomUUID } from "crypto";
import { getOrCreateZone, getEntity, type Entity } from "./zoneRuntime.js";
import type { ProfessionType } from "../professions/professions.js";
import type { CharacterStats } from "../character/classes.js";
import { statScale } from "../character/leveling.js";
import { getZoneOffset } from "./worldLayout.js";

/**
 * Static NPC definitions that auto-spawn when the shard boots.
 * Each NPC is placed in a specific zone at a fixed position.
 */
export interface NpcDef {
  zoneId: string;
  type: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  shopItems?: number[];
  level?: number;
  xpReward?: number;
  teachesProfession?: ProfessionType;
  teachesClass?: string;
}

// ── Humanoid NPC appearance generation ─────────────────────────────────
// NPCs with these types get random layered-sprite appearances so the
// client renders them with the same compositor used for player characters.

const HUMANOID_NPC_TYPES = new Set([
  "merchant", "quest-giver", "lore-npc", "guild-registrar",
  "auctioneer", "arena-master", "trainer", "profession-trainer",
]);

const NPC_SKINS   = ["fair", "light", "medium", "tan", "brown", "dark"];
const NPC_EYES    = ["brown", "blue", "green", "amber", "gray", "violet"];
const NPC_HAIRS   = ["short", "long", "braided", "mohawk", "ponytail", "bald"];

// Female-presenting NPC names (used to assign gender for hair diversity)
const FEMALE_NAMES = new Set([
  "lysandra", "kira", "willow", "mirelle", "hilda", "elara",
  "seraphina", "velindra", "ashara", "ember", "lunara", "yuki",
  "zephyra", "freya", "althea", "mirabel", "selene", "ivy",
  "aurora", "brielle", "cassandra", "dahlia", "elena", "fiona",
  "gwendolyn", "iris", "jade", "kaela", "lilith", "nadia",
  "ophelia", "petra", "rosalind", "sylvia", "thalia", "una",
  "vivienne", "wren", "xena", "yara", "zara",
]);

/** Simple deterministic hash from NPC name → stable random seed */
function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pick<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

/** Infer gender from NPC name for appearance variety */
function inferGender(name: string): "male" | "female" {
  const lower = name.toLowerCase();
  for (const fem of FEMALE_NAMES) {
    if (lower.includes(fem)) return "female";
  }
  return "male";
}

/** Generate a deterministic random appearance for a humanoid NPC */
function randomNpcAppearance(name: string) {
  const h = nameHash(name);
  const gender = inferGender(name);
  return {
    gender,
    skinColor:  pick(NPC_SKINS, h),
    eyeColor:   pick(NPC_EYES, (h >>> 4)),
    hairStyle:  pick(NPC_HAIRS, (h >>> 8)),
  };
}

// ── Mob combat stats ────────────────────────────────────────────────
// Base stats for mobs (L1). Scaled by statScale(level) like player stats.
// Mobs are individually weaker than players but dangerous in groups.
const MOB_BASE_STATS = { str: 55, def: 40, agi: 30, int: 25, faith: 15, luck: 20 };
const BOSS_STAT_MULT = 1.4; // Bosses hit 40% harder and are 40% tankier

export function computeMobStats(level: number, hp: number, isBoss: boolean): CharacterStats {
  const scale = statScale(level);
  const mult = isBoss ? BOSS_STAT_MULT : 1;
  return {
    str:     Math.round(MOB_BASE_STATS.str * scale * mult),
    def:     Math.round(MOB_BASE_STATS.def * scale * mult),
    hp,      // Keep hand-tuned HP from NPC_DEFS
    agi:     Math.round(MOB_BASE_STATS.agi * scale * mult),
    int:     Math.round(MOB_BASE_STATS.int * scale * mult),
    mp:      0,
    faith:   Math.round(MOB_BASE_STATS.faith * scale * mult),
    luck:    Math.round(MOB_BASE_STATS.luck * scale * mult),
    essence: 0,
  };
}

export const NPC_DEFS: NpcDef[] = [
  // === VILLAGE-SQUARE ZONE ===

  // Quest Giver - top-left corner
  {
    zoneId: "village-square",
    type: "quest-giver",
    name: "Guard Captain Marcus",
    x: 50,
    y: 40,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "lore-npc",
    name: "Scout Kaela",
    x: 110,
    y: 108,
    hp: 999,
  },

  // Merchants - central services area
  {
    zoneId: "village-square",
    type: "merchant",
    name: "Grimwald the Trader",
    x: 180,
    y: 260,
    hp: 999,
    // Sells potions, starter weapons, starter armor, Stone Pickaxe, Basic Sickle, Rusty Skinning Knife
    shopItems: [0, 1, 2, 4, 6, 7, 8, 10, 12, 13, 14, 15, 16, 27, 41, 76],
  },
  {
    zoneId: "village-square",
    type: "merchant",
    name: "Bron the Blacksmith",
    x: 320,
    y: 260,
    hp: 999,
    // Sells advanced weapons, heavy armor, pickaxes, sickles, skinning knives, disenchanting scroll
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Auctioneer
  // Blacksmiths (wild-meadow + dark-forest — repair gear)
  {
    zoneId: "wild-meadow",
    type: "merchant",
    name: "Forge Master Kira - Blacksmith",
    x: 160,
    y: 60,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },
  {
    zoneId: "dark-forest",
    type: "merchant",
    name: "Dark Iron Halvek - Blacksmith",
    x: 160,
    y: 60,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  {
    zoneId: "village-square",
    type: "auctioneer",
    name: "Lysandra the Auctioneer",
    x: 180,
    y: 340,
    hp: 999,
  },

  // Profession Trainers - two rows, 120px spacing
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Grizzled Miner Torvik",
    x: 100,
    y: 420,
    hp: 999,
    teachesProfession: "mining",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Master Smith Durgan",
    x: 230,
    y: 420,
    hp: 999,
    teachesProfession: "blacksmithing",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Herbalist Willow",
    x: 360,
    y: 420,
    hp: 999,
    teachesProfession: "herbalism",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Alchemist Mirelle",
    x: 490,
    y: 420,
    hp: 999,
    teachesProfession: "alchemy",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Huntsman Greaves",
    x: 100,
    y: 500,
    hp: 999,
    teachesProfession: "skinning",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Chef Gastron",
    x: 230,
    y: 500,
    hp: 999,
    teachesProfession: "cooking",
  },

  // Crafting Stations - one row, 100px spacing
  {
    zoneId: "village-square",
    type: "forge",
    name: "Ancient Forge",
    x: 80,
    y: 580,
    hp: 9999,
  },
  {
    zoneId: "village-square",
    type: "alchemy-lab",
    name: "Mystical Cauldron",
    x: 280,
    y: 580,
    hp: 9999,
  },
  {
    zoneId: "village-square",
    type: "enchanting-altar",
    name: "Enchanter's Altar",
    x: 180,
    y: 580,
    hp: 9999,
  },
  {
    zoneId: "village-square",
    type: "campfire",
    name: "Cooking Campfire",
    x: 380,
    y: 580,
    hp: 9999,
  },

  // Leatherworking & Jewelcrafting Stations
  {
    zoneId: "village-square",
    type: "tanning-rack",
    name: "Sturdy Tanning Rack",
    x: 480,
    y: 580,
    hp: 9999,
  },
  {
    zoneId: "village-square",
    type: "jewelers-bench",
    name: "Jeweler's Workbench",
    x: 580,
    y: 580,
    hp: 9999,
  },

  // Leatherworking & Jewelcrafting Trainers
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Tanner Hilda",
    x: 360,
    y: 500,
    hp: 999,
    teachesProfession: "leatherworking",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Gemcutter Orik",
    x: 490,
    y: 500,
    hp: 999,
    teachesProfession: "jewelcrafting",
  },

  // Class Trainers - two rows, 90px spacing
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Thrain Ironforge - Warrior Trainer",
    x: 60,
    y: 80,
    hp: 999,
    teachesClass: "warrior",
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Sister Elara - Paladin Trainer",
    x: 200,
    y: 80,
    hp: 999,
    teachesClass: "paladin",
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Shade Whisper - Rogue Trainer",
    x: 340,
    y: 80,
    hp: 999,
    teachesClass: "rogue",
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Sylvan Swiftarrow - Ranger Trainer",
    x: 480,
    y: 80,
    hp: 999,
    teachesClass: "ranger",
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Archmage Aldric - Mage Trainer",
    x: 60,
    y: 160,
    hp: 999,
    teachesClass: "mage",
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Father Benedict - Cleric Trainer",
    x: 200,
    y: 160,
    hp: 999,
    teachesClass: "cleric",
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Malakai Darkbane - Warlock Trainer",
    x: 340,
    y: 160,
    hp: 999,
    teachesClass: "warlock",
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Master Li Chen - Monk Trainer",
    x: 480,
    y: 160,
    hp: 999,
    teachesClass: "monk",
  },

  // ── Mid-Level Class Trainers (4 zones × 8 classes = 32 trainers) ──

  // Dark-Forest trainers (L14 R2 + L16 new abilities)
  { zoneId: "dark-forest", type: "trainer", name: "Warblade Dorath - Warrior Trainer",
    x: 60, y: 400, hp: 999, teachesClass: "warrior" },
  { zoneId: "dark-forest", type: "trainer", name: "Crusader Alwyn - Paladin Trainer",
    x: 200, y: 400, hp: 999, teachesClass: "paladin" },
  { zoneId: "dark-forest", type: "trainer", name: "Shadow Vex - Rogue Trainer",
    x: 340, y: 400, hp: 999, teachesClass: "rogue" },
  { zoneId: "dark-forest", type: "trainer", name: "Huntsman Theron - Ranger Trainer",
    x: 480, y: 400, hp: 999, teachesClass: "ranger" },
  { zoneId: "dark-forest", type: "trainer", name: "Arcanist Vespera - Mage Trainer",
    x: 60, y: 460, hp: 999, teachesClass: "mage" },
  { zoneId: "dark-forest", type: "trainer", name: "Sister Cordelia - Cleric Trainer",
    x: 200, y: 460, hp: 999, teachesClass: "cleric" },
  { zoneId: "dark-forest", type: "trainer", name: "Hexer Grimthorn - Warlock Trainer",
    x: 340, y: 460, hp: 999, teachesClass: "warlock" },
  { zoneId: "dark-forest", type: "trainer", name: "Brother Zheng - Monk Trainer",
    x: 480, y: 460, hp: 999, teachesClass: "monk" },

  // Auroral-Plains trainers (L18 R2)
  { zoneId: "auroral-plains", type: "trainer", name: "Stormborn Kellan - Warrior Trainer",
    x: 60, y: 300, hp: 999, teachesClass: "warrior" },
  { zoneId: "auroral-plains", type: "trainer", name: "Dawn Knight Seraphina - Paladin Trainer",
    x: 200, y: 300, hp: 999, teachesClass: "paladin" },
  { zoneId: "auroral-plains", type: "trainer", name: "Windshade Ren - Rogue Trainer",
    x: 340, y: 300, hp: 999, teachesClass: "rogue" },
  { zoneId: "auroral-plains", type: "trainer", name: "Sky Hunter Faelen - Ranger Trainer",
    x: 480, y: 300, hp: 999, teachesClass: "ranger" },
  { zoneId: "auroral-plains", type: "trainer", name: "Auroriel - Mage Trainer",
    x: 60, y: 360, hp: 999, teachesClass: "mage" },
  { zoneId: "auroral-plains", type: "trainer", name: "Lightweaver Brielle - Cleric Trainer",
    x: 200, y: 360, hp: 999, teachesClass: "cleric" },
  { zoneId: "auroral-plains", type: "trainer", name: "Void Caller Ashara - Warlock Trainer",
    x: 340, y: 360, hp: 999, teachesClass: "warlock" },
  { zoneId: "auroral-plains", type: "trainer", name: "Windwalker Mei - Monk Trainer",
    x: 480, y: 360, hp: 999, teachesClass: "monk" },

  // Emerald-Woods trainers (L20 R2 + L22 new abilities)
  { zoneId: "emerald-woods", type: "trainer", name: "Verdant Sentinel Brann - Warrior Trainer",
    x: 60, y: 340, hp: 999, teachesClass: "warrior" },
  { zoneId: "emerald-woods", type: "trainer", name: "Greenward Paladin Aldric - Paladin Trainer",
    x: 200, y: 340, hp: 999, teachesClass: "paladin" },
  { zoneId: "emerald-woods", type: "trainer", name: "Thorn Stalker Ivy - Rogue Trainer",
    x: 340, y: 340, hp: 999, teachesClass: "rogue" },
  { zoneId: "emerald-woods", type: "trainer", name: "Wildbow Cassandra - Ranger Trainer",
    x: 480, y: 340, hp: 999, teachesClass: "ranger" },
  { zoneId: "emerald-woods", type: "trainer", name: "Sage Mirelle - Mage Trainer",
    x: 60, y: 400, hp: 999, teachesClass: "mage" },
  { zoneId: "emerald-woods", type: "trainer", name: "Grove Priestess Dahlia - Cleric Trainer",
    x: 200, y: 400, hp: 999, teachesClass: "cleric" },
  { zoneId: "emerald-woods", type: "trainer", name: "Root Weaver Nadia - Warlock Trainer",
    x: 340, y: 400, hp: 999, teachesClass: "warlock" },
  { zoneId: "emerald-woods", type: "trainer", name: "Forest Hermit Koji - Monk Trainer",
    x: 480, y: 400, hp: 999, teachesClass: "monk" },

  // Viridian-Range trainers (L24 R3)
  { zoneId: "viridian-range", type: "trainer", name: "Ironpeak Commander Voss - Warrior Trainer",
    x: 60, y: 300, hp: 999, teachesClass: "warrior" },
  { zoneId: "viridian-range", type: "trainer", name: "Mountain Templar Gideon - Paladin Trainer",
    x: 200, y: 300, hp: 999, teachesClass: "paladin" },
  { zoneId: "viridian-range", type: "trainer", name: "Summit Blade Petra - Rogue Trainer",
    x: 340, y: 300, hp: 999, teachesClass: "rogue" },
  { zoneId: "viridian-range", type: "trainer", name: "Eagle Eye Kaius - Ranger Trainer",
    x: 480, y: 300, hp: 999, teachesClass: "ranger" },
  { zoneId: "viridian-range", type: "trainer", name: "Arcanum Elder Thessara - Mage Trainer",
    x: 60, y: 360, hp: 999, teachesClass: "mage" },
  { zoneId: "viridian-range", type: "trainer", name: "High Priestess Ophelia - Cleric Trainer",
    x: 200, y: 360, hp: 999, teachesClass: "cleric" },
  { zoneId: "viridian-range", type: "trainer", name: "Abyss Speaker Cael - Warlock Trainer",
    x: 340, y: 360, hp: 999, teachesClass: "warlock" },
  { zoneId: "viridian-range", type: "trainer", name: "Peak Ascetic Tenzen - Monk Trainer",
    x: 480, y: 360, hp: 999, teachesClass: "monk" },

  // Auctioneers in other zones
  {
    zoneId: "wild-meadow",
    type: "auctioneer",
    name: "Tormund the Broker",
    x: 320,
    y: 60,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "auctioneer",
    name: "Shadowbid Velara",
    x: 320,
    y: 60,
    hp: 999,
  },

  // Arena Masters - PvP Coliseum
  {
    zoneId: "village-square",
    type: "arena-master",
    name: "Gladiator Varro",
    x: 460,
    y: 260,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "arena-master",
    name: "Pit Fighter Kael",
    x: 480,
    y: 60,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "arena-master",
    name: "Shadow Champion Nyx",
    x: 480,
    y: 60,
    hp: 999,
  },

  // ── Lore NPCs — Arcadian History & Essence Scholars ──────────────
  // Chain 1: The Essence Awakening (Scholar Elowen → Druid Caelum → Arcanist Voss)
  {
    zoneId: "village-square",
    type: "lore-npc",
    name: "Scholar Elowen",
    x: 50,
    y: 400,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "lore-npc",
    name: "Druid Caelum",
    x: 160,
    y: 140,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "lore-npc",
    name: "Arcanist Voss",
    x: 320,
    y: 140,
    hp: 999,
  },
  // Chain 2: Whispers of the Auroral Plains (Elder Mirael)
  {
    zoneId: "village-square",
    type: "lore-npc",
    name: "Elder Mirael",
    x: 50,
    y: 240,
    hp: 999,
  },
  // Chain 3: Guardians of the Emerald Woods (Warden Sylvara)
  {
    zoneId: "wild-meadow",
    type: "lore-npc",
    name: "Warden Sylvara",
    x: 480,
    y: 140,
    hp: 999,
  },
  // Chain 4: Secrets of the Gemloch Depths (Stonekeeper Durgan)
  {
    zoneId: "dark-forest",
    type: "lore-npc",
    name: "Stonekeeper Durgan",
    x: 480,
    y: 140,
    hp: 999,
  },
  // Chain 5: The Fall and Rise of Arcadia (Chronicler Orin → Sage Thessaly → Remnant Keeper Nyx)
  {
    zoneId: "village-square",
    type: "lore-npc",
    name: "Chronicler Orin",
    x: 50,
    y: 320,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "lore-npc",
    name: "Sage Thessaly",
    x: 560,
    y: 220,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "lore-npc",
    name: "Remnant Keeper Nyx",
    x: 160,
    y: 220,
    hp: 999,
  },

  // Essence Forge NPCs — unlock unique techniques at L15/L30
  {
    zoneId: "village-square",
    type: "essence-forge",
    name: "Essence Weaver Lyanna",
    x: 560,
    y: 160,
    hp: 9999,
  },
  {
    zoneId: "wild-meadow",
    type: "essence-forge",
    name: "Essence Shaper Korvus",
    x: 320,
    y: 320,
    hp: 9999,
  },
  {
    zoneId: "dark-forest",
    type: "essence-forge",
    name: "Essence Oracle Morrigan",
    x: 160,
    y: 320,
    hp: 9999,
  },

  // Guild Registrars
  {
    zoneId: "village-square",
    type: "guild-registrar",
    name: "Guildmaster Theron",
    x: 320,
    y: 340,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "guild-registrar",
    name: "Warden Grimjaw",
    x: 160,
    y: 60,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "guild-registrar",
    name: "Covenant Keeper Noir",
    x: 160,
    y: 60,
    hp: 999,
  },

  // === VILLAGE-SQUARE MOBS (spread across eastern half) ===

  // Hungry Wolves (L2) - east-center
  {
    zoneId: "village-square",
    type: "mob",
    name: "Hungry Wolf",
    x: 400,
    y: 200,
    hp: 65,
    level: 2,
    xpReward: 54,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Hungry Wolf",
    x: 490,
    y: 270,
    hp: 65,
    level: 2,
    xpReward: 54,
  },

  // Goblin Raider (L3) - east
  {
    zoneId: "village-square",
    type: "mob",
    name: "Goblin Raider",
    x: 570,
    y: 190,
    hp: 90,
    level: 3,
    xpReward: 84,
  },

  // Mire Slime (L3) - east
  {
    zoneId: "village-square",
    type: "mob",
    name: "Mire Slime",
    x: 570,
    y: 380,
    hp: 110,
    level: 3,
    xpReward: 72,
  },

  // Giant Rats (L1) - northeast area
  {
    zoneId: "village-square",
    type: "mob",
    name: "Giant Rat",
    x: 460,
    y: 70,
    hp: 40,
    level: 1,
    xpReward: 36,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Giant Rat",
    x: 550,
    y: 70,
    hp: 40,
    level: 1,
    xpReward: 36,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Giant Rat",
    x: 500,
    y: 140,
    hp: 40,
    level: 1,
    xpReward: 36,
  },

  // Wild Boars (L2) - south-center
  {
    zoneId: "village-square",
    type: "mob",
    name: "Wild Boar",
    x: 340,
    y: 480,
    hp: 55,
    level: 2,
    xpReward: 48,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Wild Boar",
    x: 440,
    y: 550,
    hp: 55,
    level: 2,
    xpReward: 48,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Wild Boar",
    x: 540,
    y: 480,
    hp: 55,
    level: 2,
    xpReward: 48,
  },

  // Bandit Scouts (L4) - east-center
  {
    zoneId: "village-square",
    type: "mob",
    name: "Bandit Scout",
    x: 460,
    y: 340,
    hp: 120,
    level: 4,
    xpReward: 105,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Bandit Scout",
    x: 570,
    y: 280,
    hp: 120,
    level: 4,
    xpReward: 105,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Bandit Scout",
    x: 580,
    y: 440,
    hp: 120,
    level: 4,
    xpReward: 105,
  },

  // Diseased Wolf (L5) - far southeast
  {
    zoneId: "village-square",
    type: "mob",
    name: "Diseased Wolf",
    x: 580,
    y: 550,
    hp: 180,
    level: 5,
    xpReward: 126,
  },

  // === WILD MEADOW ZONE (Mid-Level, 5-10) ===

  // Quest Giver - north-center
  {
    zoneId: "wild-meadow",
    type: "quest-giver",
    name: "Ranger Thornwood",
    x: 320,
    y: 140,
    hp: 999,
  },

  // Level 6 Mobs - Forest Bears (northwest quadrant, ~100px spacing)
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 70,
    y: 70,
    hp: 200,
    level: 6,
    xpReward: 138,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 180,
    y: 70,
    hp: 200,
    level: 6,
    xpReward: 138,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 70,
    y: 180,
    hp: 200,
    level: 6,
    xpReward: 138,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 180,
    y: 180,
    hp: 200,
    level: 6,
    xpReward: 138,
  },

  // Level 7 Mobs - Venom Spiders (northeast quadrant, ~90px spacing)
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 400,
    y: 80,
    hp: 225,
    level: 7,
    xpReward: 170,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 500,
    y: 160,
    hp: 225,
    level: 7,
    xpReward: 170,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 580,
    y: 80,
    hp: 225,
    level: 7,
    xpReward: 170,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 400,
    y: 240,
    hp: 225,
    level: 7,
    xpReward: 170,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 500,
    y: 320,
    hp: 225,
    level: 7,
    xpReward: 170,
  },

  // Level 8 Mobs - Rogue Bandits (south-center, ~100px spacing)
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 350,
    y: 420,
    hp: 250,
    level: 8,
    xpReward: 205,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 460,
    y: 500,
    hp: 250,
    level: 8,
    xpReward: 205,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 560,
    y: 420,
    hp: 250,
    level: 8,
    xpReward: 205,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 460,
    y: 580,
    hp: 250,
    level: 8,
    xpReward: 205,
  },

  // Level 9 Mobs - Corrupted Ents (southwest, ~100px spacing)
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 80,
    y: 350,
    hp: 280,
    level: 9,
    xpReward: 238,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 80,
    y: 470,
    hp: 280,
    level: 9,
    xpReward: 238,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 80,
    y: 580,
    hp: 280,
    level: 9,
    xpReward: 238,
  },

  // Level 10 Elite - Dire Wolf (center-south, isolated)
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Dire Wolf",
    x: 300,
    y: 560,
    hp: 350,
    level: 10,
    xpReward: 275,
  },

  // === DARK FOREST ZONE (High-Level, 10-15) ===

  // Quest Giver
  {
    zoneId: "dark-forest",
    type: "quest-giver",
    name: "Priestess Selene",
    x: 160,
    y: 60,
    hp: 999,
  },

  // Level 11 Mobs - Shadow Wolves (west side, ~100px spacing)
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 70,
    y: 200,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 180,
    y: 280,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 70,
    y: 360,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 180,
    y: 440,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 70,
    y: 520,
    hp: 380,
    level: 11,
    xpReward: 125,
  },

  // Level 12 Mobs - Dark Cultists (center-north, ~100px spacing)
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 340,
    y: 200,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 450,
    y: 280,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 560,
    y: 200,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 450,
    y: 370,
    hp: 410,
    level: 12,
    xpReward: 145,
  },

  // Level 13 Mobs - Undead Knights (east side, ~100px spacing)
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 400,
    y: 480,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 510,
    y: 560,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 580,
    y: 460,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 510,
    y: 380,
    hp: 445,
    level: 13,
    xpReward: 165,
  },

  // Level 14 Mobs - Forest Trolls (southwest, ~100px spacing)
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 100,
    y: 580,
    hp: 480,
    level: 14,
    xpReward: 190,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 220,
    y: 500,
    hp: 480,
    level: 14,
    xpReward: 190,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 340,
    y: 580,
    hp: 480,
    level: 14,
    xpReward: 190,
  },

  // Level 15 Mobs - Ancient Golems (center-south, ~120px spacing)
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Ancient Golem",
    x: 300,
    y: 420,
    hp: 520,
    level: 15,
    xpReward: 220,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Ancient Golem",
    x: 200,
    y: 360,
    hp: 520,
    level: 15,
    xpReward: 220,
  },

  // Level 16 Boss - Necromancer (central, isolated)
  {
    zoneId: "dark-forest",
    type: "boss",
    name: "Necromancer Valdris",
    x: 320,
    y: 320,
    hp: 800,
    level: 16,
    xpReward: 300,
  },

  // === AURORAL PLAINS ZONE (L15-20) ===

  // Quest Giver
  {
    zoneId: "auroral-plains",
    type: "quest-giver",
    name: "Windcaller Aelara",
    x: 200,
    y: 180,
    hp: 999,
  },

  // Merchant
  {
    zoneId: "auroral-plains",
    type: "merchant",
    name: "Auroral Trader Fenwick",
    x: 220,
    y: 420,
    hp: 999,
    shopItems: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 28, 29, 42, 43, 77, 78, 115],
  },

  // Blacksmith
  {
    zoneId: "auroral-plains",
    type: "merchant",
    name: "Auroral Anvil Blacksmith",
    x: 220,
    y: 420,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Auctioneer
  {
    zoneId: "auroral-plains",
    type: "auctioneer",
    name: "Skymarket Orielle",
    x: 260,
    y: 420,
    hp: 999,
  },

  // Guild Registrar
  {
    zoneId: "auroral-plains",
    type: "guild-registrar",
    name: "Windsworn Registrar Hale",
    x: 300,
    y: 420,
    hp: 999,
  },

  // Lore NPC
  {
    zoneId: "auroral-plains",
    type: "lore-npc",
    name: "Aurora Sage Lysander",
    x: 480,
    y: 140,
    hp: 999,
  },

  // Crafting Stations
  {
    zoneId: "auroral-plains",
    type: "forge",
    name: "Windswept Anvil",
    x: 140,
    y: 520,
    hp: 9999,
  },
  {
    zoneId: "auroral-plains",
    type: "alchemy-lab",
    name: "Plains Alchemist Table",
    x: 240,
    y: 520,
    hp: 9999,
  },

  // Arena Master
  {
    zoneId: "auroral-plains",
    type: "arena-master",
    name: "Stormduelist Kiran",
    x: 400,
    y: 420,
    hp: 999,
  },

  // Mobs - Plains Stalker (L15) x3
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Plains Stalker",
    x: 100,
    y: 100,
    hp: 500,
    level: 15,
    xpReward: 220,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Plains Stalker",
    x: 200,
    y: 80,
    hp: 500,
    level: 15,
    xpReward: 220,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Plains Stalker",
    x: 300,
    y: 120,
    hp: 500,
    level: 15,
    xpReward: 220,
  },

  // Aurora Wisp (L16) x3
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Aurora Wisp",
    x: 400,
    y: 100,
    hp: 540,
    level: 16,
    xpReward: 245,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Aurora Wisp",
    x: 500,
    y: 180,
    hp: 540,
    level: 16,
    xpReward: 245,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Aurora Wisp",
    x: 560,
    y: 100,
    hp: 540,
    level: 16,
    xpReward: 245,
  },

  // Windborne Harpy (L17) x3
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Windborne Harpy",
    x: 350,
    y: 220,
    hp: 580,
    level: 17,
    xpReward: 270,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Windborne Harpy",
    x: 450,
    y: 300,
    hp: 580,
    level: 17,
    xpReward: 270,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Windborne Harpy",
    x: 550,
    y: 250,
    hp: 580,
    level: 17,
    xpReward: 270,
  },

  // Essence Wraith (L18) x3
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Essence Wraith",
    x: 100,
    y: 300,
    hp: 620,
    level: 18,
    xpReward: 295,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Essence Wraith",
    x: 150,
    y: 400,
    hp: 620,
    level: 18,
    xpReward: 295,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Essence Wraith",
    x: 80,
    y: 500,
    hp: 620,
    level: 18,
    xpReward: 295,
  },

  // Storm Elemental (L19) x2
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Storm Elemental",
    x: 500,
    y: 480,
    hp: 660,
    level: 19,
    xpReward: 320,
  },
  {
    zoneId: "auroral-plains",
    type: "mob",
    name: "Storm Elemental",
    x: 560,
    y: 400,
    hp: 660,
    level: 19,
    xpReward: 320,
  },

  // Skyward Drake (Boss L20)
  {
    zoneId: "auroral-plains",
    type: "boss",
    name: "Skyward Drake",
    x: 500,
    y: 450,
    hp: 1200,
    level: 20,
    xpReward: 500,
  },

  // === EMERALD WOODS ZONE (L20-25) ===

  // Quest Giver
  {
    zoneId: "emerald-woods",
    type: "quest-giver",
    name: "Verdant Warden Sylva",
    x: 320,
    y: 280,
    hp: 999,
  },

  // Merchant
  {
    zoneId: "emerald-woods",
    type: "merchant",
    name: "Grom Artisan Borik",
    x: 200,
    y: 470,
    hp: 999,
    shopItems: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Blacksmith
  {
    zoneId: "emerald-woods",
    type: "merchant",
    name: "Grom Forge Blacksmith",
    x: 220,
    y: 420,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Auctioneer
  {
    zoneId: "emerald-woods",
    type: "auctioneer",
    name: "Greenmarket Talia",
    x: 250,
    y: 470,
    hp: 999,
  },

  // Guild Registrar
  {
    zoneId: "emerald-woods",
    type: "guild-registrar",
    name: "Emerald Oath Warden",
    x: 300,
    y: 470,
    hp: 999,
  },

  // Lore NPC
  {
    zoneId: "emerald-woods",
    type: "lore-npc",
    name: "Selerion Archivist Maelis",
    x: 420,
    y: 220,
    hp: 999,
  },

  // Crafting Stations
  {
    zoneId: "emerald-woods",
    type: "forge",
    name: "Grom Workshop Forge",
    x: 160,
    y: 550,
    hp: 9999,
  },
  {
    zoneId: "emerald-woods",
    type: "alchemy-lab",
    name: "Forest Apothecary",
    x: 260,
    y: 550,
    hp: 9999,
  },

  // Arena Master
  {
    zoneId: "emerald-woods",
    type: "arena-master",
    name: "Wildwood Champion Thorne",
    x: 400,
    y: 470,
    hp: 999,
  },

  // Mobs - Thorned Treant (L20) x3
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Thorned Treant",
    x: 480,
    y: 380,
    hp: 750,
    level: 20,
    xpReward: 350,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Thorned Treant",
    x: 520,
    y: 450,
    hp: 750,
    level: 20,
    xpReward: 350,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Thorned Treant",
    x: 560,
    y: 380,
    hp: 750,
    level: 20,
    xpReward: 350,
  },

  // Emerald Serpent (L21) x3
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Emerald Serpent",
    x: 130,
    y: 130,
    hp: 800,
    level: 21,
    xpReward: 380,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Emerald Serpent",
    x: 180,
    y: 200,
    hp: 800,
    level: 21,
    xpReward: 380,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Emerald Serpent",
    x: 100,
    y: 250,
    hp: 800,
    level: 21,
    xpReward: 380,
  },

  // Feral Worg (L22) x3
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Feral Worg",
    x: 400,
    y: 550,
    hp: 850,
    level: 22,
    xpReward: 410,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Feral Worg",
    x: 500,
    y: 580,
    hp: 850,
    level: 22,
    xpReward: 410,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Feral Worg",
    x: 580,
    y: 520,
    hp: 850,
    level: 22,
    xpReward: 410,
  },

  // Selerion Specter (L23) x3
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Selerion Specter",
    x: 450,
    y: 100,
    hp: 900,
    level: 23,
    xpReward: 440,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Selerion Specter",
    x: 550,
    y: 80,
    hp: 900,
    level: 23,
    xpReward: 440,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Selerion Specter",
    x: 500,
    y: 200,
    hp: 900,
    level: 23,
    xpReward: 440,
  },

  // Ancient Guardian (L24) x2
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Ancient Guardian",
    x: 560,
    y: 160,
    hp: 950,
    level: 24,
    xpReward: 470,
  },
  {
    zoneId: "emerald-woods",
    type: "mob",
    name: "Ancient Guardian",
    x: 580,
    y: 280,
    hp: 950,
    level: 24,
    xpReward: 470,
  },

  // Grom Sentinel (Boss L25)
  {
    zoneId: "emerald-woods",
    type: "boss",
    name: "Grom Sentinel",
    x: 550,
    y: 150,
    hp: 1800,
    level: 25,
    xpReward: 750,
  },

  // === VIRIDIAN RANGE ZONE (L25-30) ===

  // Quest Giver
  {
    zoneId: "viridian-range",
    type: "quest-giver",
    name: "Gemloch Overseer Barak",
    x: 320,
    y: 220,
    hp: 999,
  },

  // Merchant
  {
    zoneId: "viridian-range",
    type: "merchant",
    name: "Mountain Provisioner Hilda",
    x: 170,
    y: 420,
    hp: 999,
    shopItems: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Blacksmith
  {
    zoneId: "viridian-range",
    type: "merchant",
    name: "Mountain Blacksmith Gorath",
    x: 220,
    y: 420,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Auctioneer
  {
    zoneId: "viridian-range",
    type: "auctioneer",
    name: "Summit Broker Grimaldi",
    x: 220,
    y: 420,
    hp: 999,
  },

  // Guild Registrar
  {
    zoneId: "viridian-range",
    type: "guild-registrar",
    name: "Peak Warden Registrar",
    x: 270,
    y: 420,
    hp: 999,
  },

  // Lore NPC
  {
    zoneId: "viridian-range",
    type: "lore-npc",
    name: "Gemloch Historian Petra",
    x: 280,
    y: 180,
    hp: 999,
  },

  // Crafting Stations
  {
    zoneId: "viridian-range",
    type: "forge",
    name: "Mountain Forge",
    x: 120,
    y: 520,
    hp: 9999,
  },
  {
    zoneId: "viridian-range",
    type: "alchemy-lab",
    name: "Alpine Alchemy Station",
    x: 220,
    y: 520,
    hp: 9999,
  },

  // Arena Master
  {
    zoneId: "viridian-range",
    type: "arena-master",
    name: "Cragfist Arena Master",
    x: 370,
    y: 420,
    hp: 999,
  },

  // Mobs - Mountain Yeti (L25) x3
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Mountain Yeti",
    x: 80,
    y: 120,
    hp: 1050,
    level: 25,
    xpReward: 500,
  },
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Mountain Yeti",
    x: 140,
    y: 200,
    hp: 1050,
    level: 25,
    xpReward: 500,
  },
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Mountain Yeti",
    x: 80,
    y: 280,
    hp: 1050,
    level: 25,
    xpReward: 500,
  },

  // Rock Basilisk (L26) x3
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Rock Basilisk",
    x: 400,
    y: 100,
    hp: 1100,
    level: 26,
    xpReward: 530,
  },
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Rock Basilisk",
    x: 500,
    y: 180,
    hp: 1100,
    level: 26,
    xpReward: 530,
  },
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Rock Basilisk",
    x: 560,
    y: 100,
    hp: 1100,
    level: 26,
    xpReward: 530,
  },

  // Storm Condor (L27) x3
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Storm Condor",
    x: 420,
    y: 280,
    hp: 1150,
    level: 27,
    xpReward: 560,
  },
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Storm Condor",
    x: 500,
    y: 350,
    hp: 1150,
    level: 27,
    xpReward: 560,
  },
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Storm Condor",
    x: 480,
    y: 420,
    hp: 1150,
    level: 27,
    xpReward: 560,
  },

  // Gemloch Golem (L28) x2
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Gemloch Golem",
    x: 350,
    y: 150,
    hp: 1200,
    level: 28,
    xpReward: 590,
  },
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Gemloch Golem",
    x: 300,
    y: 300,
    hp: 1200,
    level: 28,
    xpReward: 590,
  },

  // Frost Giant (L29) x2
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Frost Giant",
    x: 520,
    y: 520,
    hp: 1300,
    level: 29,
    xpReward: 620,
  },
  {
    zoneId: "viridian-range",
    type: "mob",
    name: "Frost Giant",
    x: 560,
    y: 450,
    hp: 1300,
    level: 29,
    xpReward: 620,
  },

  // Avalanche Titan (Boss L30)
  {
    zoneId: "viridian-range",
    type: "boss",
    name: "Avalanche Titan",
    x: 500,
    y: 500,
    hp: 2500,
    level: 30,
    xpReward: 1000,
  },

  // === MOONDANCER GLADE ZONE (L30-35) ===

  // Quest Giver
  {
    zoneId: "moondancer-glade",
    type: "quest-giver",
    name: "Elder Druid Moonwhisper",
    x: 170,
    y: 220,
    hp: 999,
  },

  // Merchant
  {
    zoneId: "moondancer-glade",
    type: "merchant",
    name: "Moonweaver Merchant Liora",
    x: 180,
    y: 100,
    hp: 999,
    shopItems: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Blacksmith
  {
    zoneId: "moondancer-glade",
    type: "merchant",
    name: "Moonlit Blacksmith Elara",
    x: 220,
    y: 420,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Auctioneer
  {
    zoneId: "moondancer-glade",
    type: "auctioneer",
    name: "Lunar Auctioneer Faelan",
    x: 260,
    y: 100,
    hp: 999,
  },

  // Guild Registrar
  {
    zoneId: "moondancer-glade",
    type: "guild-registrar",
    name: "Grove Keeper Registrar",
    x: 340,
    y: 100,
    hp: 999,
  },

  // Lore NPC
  {
    zoneId: "moondancer-glade",
    type: "lore-npc",
    name: "Ritual Keeper Seluna",
    x: 340,
    y: 340,
    hp: 999,
  },

  // Crafting Stations
  {
    zoneId: "moondancer-glade",
    type: "forge",
    name: "Moonlit Anvil",
    x: 100,
    y: 560,
    hp: 9999,
  },
  {
    zoneId: "moondancer-glade",
    type: "alchemy-lab",
    name: "Druidic Brewing Stand",
    x: 200,
    y: 560,
    hp: 9999,
  },

  // Arena Master
  {
    zoneId: "moondancer-glade",
    type: "arena-master",
    name: "Moonblade Duelist Sera",
    x: 420,
    y: 100,
    hp: 999,
  },

  // Mobs - Moon Stalker (L30) x3
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Moon Stalker",
    x: 80,
    y: 430,
    hp: 1400,
    level: 30,
    xpReward: 650,
  },
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Moon Stalker",
    x: 120,
    y: 520,
    hp: 1400,
    level: 30,
    xpReward: 650,
  },
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Moon Stalker",
    x: 160,
    y: 450,
    hp: 1400,
    level: 30,
    xpReward: 650,
  },

  // Fae Guardian (L31) x3
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Fae Guardian",
    x: 300,
    y: 500,
    hp: 1450,
    level: 31,
    xpReward: 680,
  },
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Fae Guardian",
    x: 350,
    y: 580,
    hp: 1450,
    level: 31,
    xpReward: 680,
  },
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Fae Guardian",
    x: 250,
    y: 580,
    hp: 1450,
    level: 31,
    xpReward: 680,
  },

  // Twilight Dryad (L32) x3
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Twilight Dryad",
    x: 380,
    y: 430,
    hp: 1500,
    level: 32,
    xpReward: 710,
  },
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Twilight Dryad",
    x: 430,
    y: 500,
    hp: 1500,
    level: 32,
    xpReward: 710,
  },
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Twilight Dryad",
    x: 460,
    y: 430,
    hp: 1500,
    level: 32,
    xpReward: 710,
  },

  // Shadow Druid (L33) x2
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Shadow Druid",
    x: 520,
    y: 400,
    hp: 1550,
    level: 33,
    xpReward: 740,
  },
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Shadow Druid",
    x: 560,
    y: 480,
    hp: 1550,
    level: 33,
    xpReward: 740,
  },

  // Lunar Wraith (L34) x2
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Lunar Wraith",
    x: 500,
    y: 280,
    hp: 1600,
    level: 34,
    xpReward: 770,
  },
  {
    zoneId: "moondancer-glade",
    type: "mob",
    name: "Lunar Wraith",
    x: 550,
    y: 200,
    hp: 1600,
    level: 34,
    xpReward: 770,
  },

  // Moondancer Archdruid (Boss L35)
  {
    zoneId: "moondancer-glade",
    type: "boss",
    name: "Moondancer Archdruid",
    x: 500,
    y: 250,
    hp: 3200,
    level: 35,
    xpReward: 1300,
  },

  // === FELSROCK CITADEL ZONE (L35-40) ===

  // Quest Giver
  {
    zoneId: "felsrock-citadel",
    type: "quest-giver",
    name: "Forgeguard Captain Haldor",
    x: 280,
    y: 370,
    hp: 999,
  },

  // Merchant
  {
    zoneId: "felsrock-citadel",
    type: "merchant",
    name: "Citadel Quartermaster Ingrid",
    x: 220,
    y: 370,
    hp: 999,
    shopItems: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Blacksmith
  {
    zoneId: "felsrock-citadel",
    type: "merchant",
    name: "Citadel Blacksmith Thordak",
    x: 220,
    y: 420,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Auctioneer
  {
    zoneId: "felsrock-citadel",
    type: "auctioneer",
    name: "Deep Auction Master Korrin",
    x: 340,
    y: 370,
    hp: 999,
  },

  // Guild Registrar
  {
    zoneId: "felsrock-citadel",
    type: "guild-registrar",
    name: "Ironpact Registrar",
    x: 400,
    y: 370,
    hp: 999,
  },

  // Lore NPC
  {
    zoneId: "felsrock-citadel",
    type: "lore-npc",
    name: "Essence Scholar Runara",
    x: 220,
    y: 420,
    hp: 999,
  },

  // Crafting Stations
  {
    zoneId: "felsrock-citadel",
    type: "forge",
    name: "The Great Forge",
    x: 280,
    y: 200,
    hp: 9999,
  },
  {
    zoneId: "felsrock-citadel",
    type: "alchemy-lab",
    name: "Essence Foundry Lab",
    x: 220,
    y: 420,
    hp: 9999,
  },
  {
    zoneId: "felsrock-citadel",
    type: "enchanting-altar",
    name: "Runic Enchanting Altar",
    x: 320,
    y: 200,
    hp: 9999,
  },

  // Arena Master
  {
    zoneId: "felsrock-citadel",
    type: "arena-master",
    name: "Ironclad Champion Volgar",
    x: 460,
    y: 370,
    hp: 999,
  },

  // Mobs - Iron Automaton (L35) x3
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Iron Automaton",
    x: 130,
    y: 130,
    hp: 1800,
    level: 35,
    xpReward: 800,
  },
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Iron Automaton",
    x: 180,
    y: 200,
    hp: 1800,
    level: 35,
    xpReward: 800,
  },
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Iron Automaton",
    x: 100,
    y: 250,
    hp: 1800,
    level: 35,
    xpReward: 800,
  },

  // Molten Forgebound (L36) x3
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Molten Forgebound",
    x: 400,
    y: 520,
    hp: 1900,
    level: 36,
    xpReward: 840,
  },
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Molten Forgebound",
    x: 460,
    y: 580,
    hp: 1900,
    level: 36,
    xpReward: 840,
  },
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Molten Forgebound",
    x: 520,
    y: 520,
    hp: 1900,
    level: 36,
    xpReward: 840,
  },

  // Deep Dweller (L37) x3
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Deep Dweller",
    x: 480,
    y: 430,
    hp: 2000,
    level: 37,
    xpReward: 880,
  },
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Deep Dweller",
    x: 540,
    y: 480,
    hp: 2000,
    level: 37,
    xpReward: 880,
  },
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Deep Dweller",
    x: 560,
    y: 400,
    hp: 2000,
    level: 37,
    xpReward: 880,
  },

  // Rune Golem (L38) x2
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Rune Golem",
    x: 200,
    y: 100,
    hp: 2100,
    level: 38,
    xpReward: 920,
  },
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Rune Golem",
    x: 350,
    y: 100,
    hp: 2100,
    level: 38,
    xpReward: 920,
  },

  // Corrupted Dwarf King (L39) x2
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Corrupted Dwarf King",
    x: 420,
    y: 120,
    hp: 2200,
    level: 39,
    xpReward: 960,
  },
  {
    zoneId: "felsrock-citadel",
    type: "mob",
    name: "Corrupted Dwarf King",
    x: 500,
    y: 80,
    hp: 2200,
    level: 39,
    xpReward: 960,
  },

  // Forgemaster Infernal (Boss L40)
  {
    zoneId: "felsrock-citadel",
    type: "boss",
    name: "Forgemaster Infernal",
    x: 450,
    y: 100,
    hp: 4000,
    level: 40,
    xpReward: 1600,
  },

  // === LAKE LUMINA ZONE (L40-45) ===

  // Quest Giver
  {
    zoneId: "lake-lumina",
    type: "quest-giver",
    name: "Lumen Priestess Aurelia",
    x: 280,
    y: 320,
    hp: 999,
  },

  // Merchant
  {
    zoneId: "lake-lumina",
    type: "merchant",
    name: "Solaris Outfitter Caius",
    x: 350,
    y: 220,
    hp: 999,
    shopItems: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Blacksmith
  {
    zoneId: "lake-lumina",
    type: "merchant",
    name: "Lumina Shores Blacksmith",
    x: 220,
    y: 420,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Auctioneer
  {
    zoneId: "lake-lumina",
    type: "auctioneer",
    name: "Crystal Shore Auctioneer Lyris",
    x: 450,
    y: 220,
    hp: 999,
  },

  // Guild Registrar
  {
    zoneId: "lake-lumina",
    type: "guild-registrar",
    name: "Lumen Covenant Registrar",
    x: 550,
    y: 220,
    hp: 999,
  },

  // Lore NPC
  {
    zoneId: "lake-lumina",
    type: "lore-npc",
    name: "Sunken Temple Scholar Mira",
    x: 280,
    y: 480,
    hp: 999,
  },

  // Crafting Stations
  {
    zoneId: "lake-lumina",
    type: "forge",
    name: "Lumen Forge",
    x: 100,
    y: 100,
    hp: 9999,
  },
  {
    zoneId: "lake-lumina",
    type: "alchemy-lab",
    name: "Crystal Alchemy Basin",
    x: 200,
    y: 100,
    hp: 9999,
  },

  // Arena Master
  {
    zoneId: "lake-lumina",
    type: "arena-master",
    name: "Tideblade Gladiator Nereus",
    x: 500,
    y: 100,
    hp: 999,
  },

  // Mobs - Luminous Wraith (L40) x3
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Luminous Wraith",
    x: 130,
    y: 430,
    hp: 2400,
    level: 40,
    xpReward: 1000,
  },
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Luminous Wraith",
    x: 180,
    y: 500,
    hp: 2400,
    level: 40,
    xpReward: 1000,
  },
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Luminous Wraith",
    x: 100,
    y: 520,
    hp: 2400,
    level: 40,
    xpReward: 1000,
  },

  // Crystal Golem (L41) x3
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Crystal Golem",
    x: 480,
    y: 380,
    hp: 2550,
    level: 41,
    xpReward: 1050,
  },
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Crystal Golem",
    x: 540,
    y: 430,
    hp: 2550,
    level: 41,
    xpReward: 1050,
  },
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Crystal Golem",
    x: 520,
    y: 500,
    hp: 2550,
    level: 41,
    xpReward: 1050,
  },

  // Drowned Knight (L42) x3
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Drowned Knight",
    x: 350,
    y: 480,
    hp: 2700,
    level: 42,
    xpReward: 1100,
  },
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Drowned Knight",
    x: 400,
    y: 550,
    hp: 2700,
    level: 42,
    xpReward: 1100,
  },
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Drowned Knight",
    x: 300,
    y: 560,
    hp: 2700,
    level: 42,
    xpReward: 1100,
  },

  // Lumen Serpent (L43) x2
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Lumen Serpent",
    x: 200,
    y: 560,
    hp: 2850,
    level: 43,
    xpReward: 1150,
  },
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Lumen Serpent",
    x: 100,
    y: 580,
    hp: 2850,
    level: 43,
    xpReward: 1150,
  },

  // Sunken Horror (L44) x2
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Sunken Horror",
    x: 430,
    y: 560,
    hp: 3000,
    level: 44,
    xpReward: 1200,
  },
  {
    zoneId: "lake-lumina",
    type: "mob",
    name: "Sunken Horror",
    x: 500,
    y: 580,
    hp: 3000,
    level: 44,
    xpReward: 1200,
  },

  // Solaris Warden (Boss L45)
  {
    zoneId: "lake-lumina",
    type: "boss",
    name: "Solaris Warden",
    x: 450,
    y: 550,
    hp: 5000,
    level: 45,
    xpReward: 2000,
  },

  // === AZURSHARD CHASM ZONE (L45-50) ===

  // Quest Giver
  {
    zoneId: "azurshard-chasm",
    type: "quest-giver",
    name: "Dragonkin Watcher Azael",
    x: 220,
    y: 420,
    hp: 999,
  },

  // Merchant
  {
    zoneId: "azurshard-chasm",
    type: "merchant",
    name: "Chasm Depths Trader Vexis",
    x: 160,
    y: 340,
    hp: 999,
    shopItems: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Blacksmith
  {
    zoneId: "azurshard-chasm",
    type: "merchant",
    name: "Chasm Depths Blacksmith",
    x: 220,
    y: 420,
    hp: 999,
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },

  // Auctioneer
  {
    zoneId: "azurshard-chasm",
    type: "auctioneer",
    name: "Azure Vault Auctioneer Nethys",
    x: 260,
    y: 340,
    hp: 999,
  },

  // Guild Registrar
  {
    zoneId: "azurshard-chasm",
    type: "guild-registrar",
    name: "Dragonsworn Registrar",
    x: 360,
    y: 340,
    hp: 999,
  },

  // Lore NPC
  {
    zoneId: "azurshard-chasm",
    type: "lore-npc",
    name: "Dragon Sage Zephyria",
    x: 320,
    y: 170,
    hp: 999,
  },

  // Crafting Stations
  {
    zoneId: "azurshard-chasm",
    type: "forge",
    name: "Dragonfire Forge",
    x: 100,
    y: 500,
    hp: 9999,
  },
  {
    zoneId: "azurshard-chasm",
    type: "alchemy-lab",
    name: "Azure Essence Lab",
    x: 200,
    y: 500,
    hp: 9999,
  },
  {
    zoneId: "azurshard-chasm",
    type: "enchanting-altar",
    name: "Nexus Enchanting Altar",
    x: 300,
    y: 500,
    hp: 9999,
  },

  // Arena Master
  {
    zoneId: "azurshard-chasm",
    type: "arena-master",
    name: "Draconic Arena Lord Vyraxis",
    x: 460,
    y: 340,
    hp: 999,
  },

  // Mobs - Azure Dragonkin (L45) x3
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Azure Dragonkin",
    x: 130,
    y: 130,
    hp: 3200,
    level: 45,
    xpReward: 1300,
  },
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Azure Dragonkin",
    x: 200,
    y: 200,
    hp: 3200,
    level: 45,
    xpReward: 1300,
  },
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Azure Dragonkin",
    x: 100,
    y: 250,
    hp: 3200,
    level: 45,
    xpReward: 1300,
  },

  // Void Weaver (L46) x3
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Void Weaver",
    x: 380,
    y: 430,
    hp: 3400,
    level: 46,
    xpReward: 1400,
  },
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Void Weaver",
    x: 430,
    y: 500,
    hp: 3400,
    level: 46,
    xpReward: 1400,
  },
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Void Weaver",
    x: 460,
    y: 430,
    hp: 3400,
    level: 46,
    xpReward: 1400,
  },

  // Shard Sentinel (L47) x3
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Shard Sentinel",
    x: 500,
    y: 120,
    hp: 3600,
    level: 47,
    xpReward: 1500,
  },
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Shard Sentinel",
    x: 560,
    y: 200,
    hp: 3600,
    level: 47,
    xpReward: 1500,
  },
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Shard Sentinel",
    x: 580,
    y: 300,
    hp: 3600,
    level: 47,
    xpReward: 1500,
  },

  // Chasm Wyrm (L48) x2
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Chasm Wyrm",
    x: 520,
    y: 400,
    hp: 3800,
    level: 48,
    xpReward: 1600,
  },
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Chasm Wyrm",
    x: 560,
    y: 500,
    hp: 3800,
    level: 48,
    xpReward: 1600,
  },

  // Essence Devourer (L49) x2
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Essence Devourer",
    x: 480,
    y: 250,
    hp: 4000,
    level: 49,
    xpReward: 1700,
  },
  {
    zoneId: "azurshard-chasm",
    type: "mob",
    name: "Essence Devourer",
    x: 550,
    y: 150,
    hp: 4000,
    level: 49,
    xpReward: 1700,
  },

  // Azurshard Dragon (Boss L50)
  {
    zoneId: "azurshard-chasm",
    type: "boss",
    name: "Azurshard Dragon",
    x: 500,
    y: 300,
    hp: 7000,
    level: 50,
    xpReward: 3500,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ═══ FARMLAND ZONES ════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════

  // === SUNFLOWER-FIELDS ZONE (L1-5) ===

  // Plot Registrar
  {
    zoneId: "sunflower-fields",
    type: "merchant",
    name: "Plot Registrar Helga",
    x: 100,
    y: 100,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "sunflower-fields",
    type: "merchant",
    name: "Farmer Cedric",
    x: 200,
    y: 100,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "sunflower-fields",
    type: "quest-giver",
    name: "Farmhand Amos",
    x: 300,
    y: 100,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "sunflower-fields",
    type: "profession-trainer",
    name: "Old Grower Silas",
    x: 400,
    y: 100,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "sunflower-fields",
    type: "forge",
    name: "Farmer's Forge",
    x: 500,
    y: 100,
    hp: 9999,
  },
  {
    zoneId: "sunflower-fields",
    type: "campfire",
    name: "Farm Campfire",
    x: 560,
    y: 100,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Wild Chicken",
    x: 120,
    y: 250,
    hp: 30,
    level: 1,
    xpReward: 8,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Field Mouse",
    x: 230,
    y: 280,
    hp: 40,
    level: 2,
    xpReward: 10,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Scarecrow",
    x: 350,
    y: 300,
    hp: 60,
    level: 3,
    xpReward: 15,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Sunflower Golem",
    x: 460,
    y: 320,
    hp: 80,
    level: 4,
    xpReward: 20,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Barn Owl",
    x: 150,
    y: 400,
    hp: 55,
    level: 3,
    xpReward: 14,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Stray Dog",
    x: 270,
    y: 420,
    hp: 45,
    level: 2,
    xpReward: 11,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Garden Spider",
    x: 380,
    y: 380,
    hp: 25,
    level: 1,
    xpReward: 7,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Crop Beetle",
    x: 500,
    y: 450,
    hp: 35,
    level: 2,
    xpReward: 9,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Hay Elemental",
    x: 180,
    y: 530,
    hp: 100,
    level: 5,
    xpReward: 25,
  },
  {
    zoneId: "sunflower-fields",
    type: "mob",
    name: "Angry Rooster",
    x: 400,
    y: 550,
    hp: 50,
    level: 3,
    xpReward: 13,
  },

  // === HARVEST-HOLLOW ZONE (L5-10) ===

  // Plot Registrar
  {
    zoneId: "harvest-hollow",
    type: "merchant",
    name: "Plot Registrar Barnaby",
    x: 110,
    y: 80,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "harvest-hollow",
    type: "merchant",
    name: "Harvest Merchant Roslyn",
    x: 220,
    y: 80,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "harvest-hollow",
    type: "quest-giver",
    name: "Hollow Keeper Merritt",
    x: 330,
    y: 80,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "harvest-hollow",
    type: "profession-trainer",
    name: "Greenthumb Iris",
    x: 440,
    y: 80,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "harvest-hollow",
    type: "forge",
    name: "Farmer's Forge",
    x: 530,
    y: 80,
    hp: 9999,
  },
  {
    zoneId: "harvest-hollow",
    type: "campfire",
    name: "Farm Campfire",
    x: 590,
    y: 80,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Harvest Scarecrow",
    x: 100,
    y: 220,
    hp: 100,
    level: 5,
    xpReward: 25,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Vine Lurker",
    x: 250,
    y: 240,
    hp: 120,
    level: 6,
    xpReward: 30,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Corn Stalker",
    x: 370,
    y: 260,
    hp: 140,
    level: 7,
    xpReward: 35,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Burrow Rat",
    x: 480,
    y: 230,
    hp: 90,
    level: 5,
    xpReward: 22,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Mud Golem",
    x: 150,
    y: 370,
    hp: 160,
    level: 8,
    xpReward: 40,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Irrigation Sprite",
    x: 290,
    y: 390,
    hp: 110,
    level: 6,
    xpReward: 28,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Root Worm",
    x: 420,
    y: 380,
    hp: 130,
    level: 7,
    xpReward: 33,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Grain Weevil",
    x: 540,
    y: 350,
    hp: 85,
    level: 5,
    xpReward: 20,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Windmill Bat",
    x: 200,
    y: 500,
    hp: 100,
    level: 6,
    xpReward: 26,
  },
  {
    zoneId: "harvest-hollow",
    type: "mob",
    name: "Terraced Beetle",
    x: 400,
    y: 520,
    hp: 150,
    level: 8,
    xpReward: 38,
  },

  // === WILLOWFEN-PASTURES ZONE (L3-8) ===

  // Plot Registrar
  {
    zoneId: "willowfen-pastures",
    type: "merchant",
    name: "Plot Registrar Wendell",
    x: 90,
    y: 90,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "willowfen-pastures",
    type: "merchant",
    name: "Fen Trader Ondine",
    x: 210,
    y: 90,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "willowfen-pastures",
    type: "quest-giver",
    name: "Marshwarden Petra",
    x: 330,
    y: 90,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "willowfen-pastures",
    type: "profession-trainer",
    name: "Bogroot Cultivator Moss",
    x: 450,
    y: 90,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "willowfen-pastures",
    type: "forge",
    name: "Farmer's Forge",
    x: 540,
    y: 90,
    hp: 9999,
  },
  {
    zoneId: "willowfen-pastures",
    type: "campfire",
    name: "Farm Campfire",
    x: 590,
    y: 90,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Marsh Frog",
    x: 130,
    y: 230,
    hp: 55,
    level: 3,
    xpReward: 14,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Reed Snake",
    x: 260,
    y: 250,
    hp: 70,
    level: 4,
    xpReward: 18,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Bog Crawler",
    x: 390,
    y: 270,
    hp: 90,
    level: 5,
    xpReward: 22,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Willow Wisp",
    x: 510,
    y: 240,
    hp: 110,
    level: 6,
    xpReward: 28,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Canal Crab",
    x: 140,
    y: 380,
    hp: 65,
    level: 4,
    xpReward: 16,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Misty Heron",
    x: 280,
    y: 400,
    hp: 85,
    level: 5,
    xpReward: 20,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Swamp Rat",
    x: 410,
    y: 390,
    hp: 50,
    level: 3,
    xpReward: 12,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Mudfish",
    x: 530,
    y: 370,
    hp: 60,
    level: 4,
    xpReward: 15,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Fenland Spider",
    x: 190,
    y: 520,
    hp: 105,
    level: 6,
    xpReward: 26,
  },
  {
    zoneId: "willowfen-pastures",
    type: "mob",
    name: "Peat Golem",
    x: 380,
    y: 540,
    hp: 135,
    level: 7,
    xpReward: 34,
  },

  // === BRAMBLEWOOD-HOMESTEAD ZONE (L8-14) ===

  // Plot Registrar
  {
    zoneId: "bramblewood-homestead",
    type: "merchant",
    name: "Plot Registrar Thornton",
    x: 100,
    y: 70,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "bramblewood-homestead",
    type: "merchant",
    name: "Briar Merchant Eldon",
    x: 230,
    y: 70,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "bramblewood-homestead",
    type: "quest-giver",
    name: "Homestead Warden Garrick",
    x: 360,
    y: 70,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "bramblewood-homestead",
    type: "profession-trainer",
    name: "Thorn Cultivator Brenna",
    x: 480,
    y: 70,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "bramblewood-homestead",
    type: "forge",
    name: "Farmer's Forge",
    x: 550,
    y: 70,
    hp: 9999,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "campfire",
    name: "Farm Campfire",
    x: 600,
    y: 70,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Thorn Sprite",
    x: 120,
    y: 210,
    hp: 150,
    level: 8,
    xpReward: 38,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Bramble Wolf",
    x: 280,
    y: 230,
    hp: 200,
    level: 10,
    xpReward: 50,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Mushroom Crawler",
    x: 420,
    y: 250,
    hp: 170,
    level: 9,
    xpReward: 43,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Hedgerow Bear",
    x: 540,
    y: 220,
    hp: 260,
    level: 12,
    xpReward: 65,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Bramble Viper",
    x: 150,
    y: 370,
    hp: 190,
    level: 10,
    xpReward: 48,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Thorned Stag",
    x: 310,
    y: 390,
    hp: 220,
    level: 11,
    xpReward: 55,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Forest Boar",
    x: 460,
    y: 380,
    hp: 165,
    level: 9,
    xpReward: 42,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Root Elemental",
    x: 570,
    y: 360,
    hp: 290,
    level: 13,
    xpReward: 72,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Bark Beetle",
    x: 200,
    y: 510,
    hp: 145,
    level: 8,
    xpReward: 36,
  },
  {
    zoneId: "bramblewood-homestead",
    type: "mob",
    name: "Spore Walker",
    x: 400,
    y: 530,
    hp: 195,
    level: 10,
    xpReward: 49,
  },

  // === GOLDENREACH-GRANGE ZONE (L5-12) ===

  // Plot Registrar
  {
    zoneId: "goldenreach-grange",
    type: "merchant",
    name: "Plot Registrar Aurelia",
    x: 80,
    y: 100,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "goldenreach-grange",
    type: "merchant",
    name: "Prairie Supplier Holt",
    x: 200,
    y: 100,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "goldenreach-grange",
    type: "quest-giver",
    name: "Grange Overseer Cassandra",
    x: 320,
    y: 100,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "goldenreach-grange",
    type: "profession-trainer",
    name: "Golden Harvester Rowan",
    x: 440,
    y: 100,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "goldenreach-grange",
    type: "forge",
    name: "Farmer's Forge",
    x: 530,
    y: 100,
    hp: 9999,
  },
  {
    zoneId: "goldenreach-grange",
    type: "campfire",
    name: "Farm Campfire",
    x: 590,
    y: 100,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Prairie Wolf",
    x: 110,
    y: 240,
    hp: 95,
    level: 5,
    xpReward: 24,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Windmill Golem",
    x: 260,
    y: 260,
    hp: 155,
    level: 8,
    xpReward: 39,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Plateau Hawk",
    x: 390,
    y: 280,
    hp: 110,
    level: 6,
    xpReward: 28,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Dust Devil",
    x: 510,
    y: 250,
    hp: 130,
    level: 7,
    xpReward: 33,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Golden Scarecrow",
    x: 140,
    y: 390,
    hp: 175,
    level: 9,
    xpReward: 44,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Grain Thief",
    x: 280,
    y: 410,
    hp: 105,
    level: 6,
    xpReward: 27,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Sun Scorpion",
    x: 420,
    y: 400,
    hp: 125,
    level: 7,
    xpReward: 31,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Field Wraith",
    x: 550,
    y: 380,
    hp: 200,
    level: 10,
    xpReward: 50,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Harvest Spider",
    x: 170,
    y: 530,
    hp: 150,
    level: 8,
    xpReward: 38,
  },
  {
    zoneId: "goldenreach-grange",
    type: "mob",
    name: "Ranch Hand Skeleton",
    x: 380,
    y: 550,
    hp: 230,
    level: 11,
    xpReward: 58,
  },

  // === DEWVEIL-ORCHARD ZONE (L10-18) ===

  // Plot Registrar
  {
    zoneId: "dewveil-orchard",
    type: "merchant",
    name: "Plot Registrar Liora",
    x: 100,
    y: 80,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "dewveil-orchard",
    type: "merchant",
    name: "Orchard Trader Finch",
    x: 230,
    y: 80,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "dewveil-orchard",
    type: "quest-giver",
    name: "Grove Warden Sylvia",
    x: 360,
    y: 80,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "dewveil-orchard",
    type: "profession-trainer",
    name: "Orchardist Bramwell",
    x: 480,
    y: 80,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "dewveil-orchard",
    type: "forge",
    name: "Farmer's Forge",
    x: 550,
    y: 80,
    hp: 9999,
  },
  {
    zoneId: "dewveil-orchard",
    type: "campfire",
    name: "Farm Campfire",
    x: 600,
    y: 80,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Orchard Sprite",
    x: 120,
    y: 220,
    hp: 200,
    level: 10,
    xpReward: 50,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Vine Strangler",
    x: 270,
    y: 250,
    hp: 250,
    level: 12,
    xpReward: 63,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Fruit Bat Swarm",
    x: 400,
    y: 230,
    hp: 220,
    level: 11,
    xpReward: 55,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Trellis Golem",
    x: 530,
    y: 260,
    hp: 300,
    level: 14,
    xpReward: 75,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Dew Spider",
    x: 150,
    y: 380,
    hp: 280,
    level: 13,
    xpReward: 70,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Apple Treant",
    x: 310,
    y: 400,
    hp: 340,
    level: 15,
    xpReward: 85,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Orchard Wasp",
    x: 450,
    y: 390,
    hp: 210,
    level: 11,
    xpReward: 53,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Grape Crawler",
    x: 570,
    y: 370,
    hp: 240,
    level: 12,
    xpReward: 60,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Root Horror",
    x: 200,
    y: 520,
    hp: 370,
    level: 16,
    xpReward: 93,
  },
  {
    zoneId: "dewveil-orchard",
    type: "mob",
    name: "Blossom Wisp",
    x: 420,
    y: 540,
    hp: 195,
    level: 10,
    xpReward: 49,
  },

  // === THORNWALL-RANCH ZONE (L10-18) ===

  // Plot Registrar
  {
    zoneId: "thornwall-ranch",
    type: "merchant",
    name: "Plot Registrar Dusty",
    x: 90,
    y: 90,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "thornwall-ranch",
    type: "merchant",
    name: "Ranch Supplier Callista",
    x: 220,
    y: 90,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "thornwall-ranch",
    type: "quest-giver",
    name: "Fence Master Drake",
    x: 350,
    y: 90,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "thornwall-ranch",
    type: "profession-trainer",
    name: "Drylands Grower Sage",
    x: 470,
    y: 90,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "thornwall-ranch",
    type: "forge",
    name: "Farmer's Forge",
    x: 540,
    y: 90,
    hp: 9999,
  },
  {
    zoneId: "thornwall-ranch",
    type: "campfire",
    name: "Farm Campfire",
    x: 595,
    y: 90,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Cactus Elemental",
    x: 130,
    y: 230,
    hp: 200,
    level: 10,
    xpReward: 50,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Rock Scorpion",
    x: 270,
    y: 250,
    hp: 250,
    level: 12,
    xpReward: 63,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Fence Rattler",
    x: 400,
    y: 240,
    hp: 215,
    level: 11,
    xpReward: 54,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Mesa Lion",
    x: 530,
    y: 270,
    hp: 310,
    level: 14,
    xpReward: 78,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Dust Wraith",
    x: 140,
    y: 390,
    hp: 275,
    level: 13,
    xpReward: 69,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Ranch Zombie",
    x: 300,
    y: 410,
    hp: 350,
    level: 15,
    xpReward: 88,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Thorn Beetle",
    x: 450,
    y: 400,
    hp: 210,
    level: 11,
    xpReward: 53,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Barbed Viper",
    x: 570,
    y: 380,
    hp: 245,
    level: 12,
    xpReward: 61,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Stone Golem",
    x: 190,
    y: 530,
    hp: 380,
    level: 16,
    xpReward: 95,
  },
  {
    zoneId: "thornwall-ranch",
    type: "mob",
    name: "Prairie Ghost",
    x: 410,
    y: 550,
    hp: 190,
    level: 10,
    xpReward: 48,
  },

  // === MOONPETAL-GARDENS ZONE (L15-25) ===

  // Plot Registrar
  {
    zoneId: "moonpetal-gardens",
    type: "merchant",
    name: "Plot Registrar Selene",
    x: 100,
    y: 80,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "moonpetal-gardens",
    type: "merchant",
    name: "Moonlit Merchant Faye",
    x: 230,
    y: 80,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "moonpetal-gardens",
    type: "quest-giver",
    name: "Garden Keeper Lunara",
    x: 360,
    y: 80,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "moonpetal-gardens",
    type: "profession-trainer",
    name: "Nightbloom Tender Thalia",
    x: 480,
    y: 80,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "moonpetal-gardens",
    type: "forge",
    name: "Farmer's Forge",
    x: 550,
    y: 80,
    hp: 9999,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "campfire",
    name: "Farm Campfire",
    x: 600,
    y: 80,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Moonpetal Sprite",
    x: 120,
    y: 220,
    hp: 340,
    level: 15,
    xpReward: 85,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Lunar Moth",
    x: 270,
    y: 240,
    hp: 390,
    level: 17,
    xpReward: 98,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Nightbloom Vine",
    x: 400,
    y: 260,
    hp: 410,
    level: 18,
    xpReward: 103,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Glowing Slug",
    x: 530,
    y: 230,
    hp: 360,
    level: 16,
    xpReward: 90,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Moonlit Fox",
    x: 140,
    y: 380,
    hp: 385,
    level: 17,
    xpReward: 96,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Garden Phantom",
    x: 310,
    y: 400,
    hp: 450,
    level: 20,
    xpReward: 113,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Petal Golem",
    x: 460,
    y: 390,
    hp: 430,
    level: 19,
    xpReward: 108,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Luminous Beetle",
    x: 570,
    y: 370,
    hp: 355,
    level: 16,
    xpReward: 89,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Silver Toad",
    x: 200,
    y: 520,
    hp: 400,
    level: 18,
    xpReward: 100,
  },
  {
    zoneId: "moonpetal-gardens",
    type: "mob",
    name: "Enchanted Scarecrow",
    x: 420,
    y: 540,
    hp: 500,
    level: 22,
    xpReward: 125,
  },

  // === IRONROOT-FARMSTEAD ZONE (L20-30) ===

  // Plot Registrar
  {
    zoneId: "ironroot-farmstead",
    type: "merchant",
    name: "Plot Registrar Magnus",
    x: 90,
    y: 90,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "ironroot-farmstead",
    type: "merchant",
    name: "Ironhill Supplier Greta",
    x: 220,
    y: 90,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "ironroot-farmstead",
    type: "quest-giver",
    name: "Farmstead Captain Aldric",
    x: 350,
    y: 90,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "ironroot-farmstead",
    type: "profession-trainer",
    name: "Stonefield Tiller Ingrid",
    x: 470,
    y: 90,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "ironroot-farmstead",
    type: "forge",
    name: "Farmer's Forge",
    x: 540,
    y: 90,
    hp: 9999,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "campfire",
    name: "Farm Campfire",
    x: 595,
    y: 90,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Iron Root Golem",
    x: 130,
    y: 230,
    hp: 450,
    level: 20,
    xpReward: 113,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Highland Wolf",
    x: 270,
    y: 250,
    hp: 500,
    level: 22,
    xpReward: 125,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Stone Terrace Guard",
    x: 410,
    y: 270,
    hp: 560,
    level: 24,
    xpReward: 140,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Fortified Scarecrow",
    x: 540,
    y: 240,
    hp: 475,
    level: 21,
    xpReward: 119,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Mountain Boar",
    x: 150,
    y: 390,
    hp: 530,
    level: 23,
    xpReward: 133,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Rock Crawler",
    x: 300,
    y: 410,
    hp: 590,
    level: 25,
    xpReward: 148,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Iron Beetle",
    x: 450,
    y: 400,
    hp: 495,
    level: 22,
    xpReward: 124,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Terrace Viper",
    x: 580,
    y: 380,
    hp: 555,
    level: 24,
    xpReward: 139,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Highland Eagle",
    x: 190,
    y: 530,
    hp: 620,
    level: 26,
    xpReward: 155,
  },
  {
    zoneId: "ironroot-farmstead",
    type: "mob",
    name: "Stone Sentinel",
    x: 420,
    y: 550,
    hp: 680,
    level: 28,
    xpReward: 170,
  },

  // === CRYSTALBLOOM-TERRACE ZONE (L25-35) ===

  // Plot Registrar
  {
    zoneId: "crystalbloom-terrace",
    type: "merchant",
    name: "Plot Registrar Opaline",
    x: 100,
    y: 80,
    hp: 999,
    shopItems: [190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 220, 221, 222, 223],
  },
  // Merchant
  {
    zoneId: "crystalbloom-terrace",
    type: "merchant",
    name: "Terrace Merchant Jasper",
    x: 230,
    y: 80,
    hp: 999,
    shopItems: [0, 1, 2, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199],
  },
  // Quest Giver
  {
    zoneId: "crystalbloom-terrace",
    type: "quest-giver",
    name: "Crystal Guardian Isolde",
    x: 360,
    y: 80,
    hp: 999,
  },
  // Farming Trainer
  {
    zoneId: "crystalbloom-terrace",
    type: "profession-trainer",
    name: "Prismatic Gardener Quill",
    x: 480,
    y: 80,
    hp: 999,
    teachesProfession: "herbalism",
  },
  // Crafting Stations
  {
    zoneId: "crystalbloom-terrace",
    type: "forge",
    name: "Farmer's Forge",
    x: 550,
    y: 80,
    hp: 9999,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "campfire",
    name: "Farm Campfire",
    x: 600,
    y: 80,
    hp: 9999,
  },

  // Mobs
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Crystal Sprite",
    x: 120,
    y: 220,
    hp: 590,
    level: 25,
    xpReward: 148,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Prismatic Moth",
    x: 270,
    y: 240,
    hp: 640,
    level: 27,
    xpReward: 160,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Bloom Golem",
    x: 400,
    y: 260,
    hp: 670,
    level: 28,
    xpReward: 168,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Lakeside Serpent",
    x: 530,
    y: 230,
    hp: 610,
    level: 26,
    xpReward: 153,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Terrace Guardian",
    x: 150,
    y: 390,
    hp: 730,
    level: 30,
    xpReward: 183,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Crystal Crawler",
    x: 310,
    y: 400,
    hp: 635,
    level: 27,
    xpReward: 159,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Greenhouse Phantom",
    x: 460,
    y: 390,
    hp: 700,
    level: 29,
    xpReward: 175,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Prismatic Beetle",
    x: 570,
    y: 370,
    hp: 605,
    level: 26,
    xpReward: 151,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Bloom Wisp",
    x: 200,
    y: 520,
    hp: 585,
    level: 25,
    xpReward: 146,
  },
  {
    zoneId: "crystalbloom-terrace",
    type: "mob",
    name: "Crystal Sentinel",
    x: 420,
    y: 540,
    hp: 790,
    level: 32,
    xpReward: 198,
  },
];

// Track spawned NPCs for respawning
const spawnedNpcIds = new Map<NpcDef, string>();

// Respawn delay tracking: NpcDef → timestamp when death was first detected
const pendingRespawns = new Map<NpcDef, number>();
const MOB_RESPAWN_DELAY_MS = 20_000; // 20 seconds

// Track spawned NPCs by name for quest system
const npcIdsByName = new Map<string, string>();

export function getNpcIdByName(name: string): string | undefined {
  return npcIdsByName.get(name);
}

/**
 * Spawn all predefined NPCs into their zones.
 * Call once at shard startup, after registerZoneRuntime.
 */
export function spawnNpcs(): void {
  for (const def of NPC_DEFS) {
    spawnSingleNpc(def);
  }
}

function spawnSingleNpc(def: NpcDef): void {
  const zone = getOrCreateZone(def.zoneId);

  // Offset local coords to world-space
  const offset = getZoneOffset(def.zoneId) ?? { x: 0, z: 0 };
  const worldX = def.x + offset.x;
  const worldY = def.y + offset.z;

  const isCombatant = def.type === "mob" || def.type === "boss";

  // Assign layered-sprite appearance to humanoid NPCs
  const appearance = HUMANOID_NPC_TYPES.has(def.type)
    ? randomNpcAppearance(def.name)
    : undefined;

  const entity: Entity = {
    id: randomUUID(),
    type: def.type,
    name: def.name,
    x: worldX,
    y: worldY,
    hp: def.hp,
    maxHp: def.hp,
    region: def.zoneId,
    createdAt: Date.now(),
    shopItems: def.shopItems,
    ...(def.level != null && { level: def.level }),
    ...(def.xpReward != null && { xpReward: def.xpReward }),
    ...(def.teachesProfession != null && { teachesProfession: def.teachesProfession }),
    ...(def.teachesClass != null && { teachesClass: def.teachesClass }),
    // Store spawn origin for leash/de-aggro (world-space)
    ...(isCombatant && { spawnX: worldX, spawnY: worldY }),
    // Give mobs/bosses real combat stats so they use the stat-based damage formula
    ...(isCombatant && def.level != null && {
      stats: computeMobStats(def.level, def.hp, def.type === "boss"),
    }),
    // Layered-sprite appearance for humanoid NPCs
    ...(appearance && {
      gender: appearance.gender,
      skinColor: appearance.skinColor,
      eyeColor: appearance.eyeColor,
      hairStyle: appearance.hairStyle,
    }),
  };

  // Pre-compute effective stats for mobs so combat uses them immediately
  if (isCombatant && entity.stats) {
    entity.effectiveStats = { ...entity.stats };
  }

  zone.entities.set(entity.id, entity);
  spawnedNpcIds.set(def, entity.id);
  npcIdsByName.set(def.name, entity.id);

  const professionInfo = def.teachesProfession ? ` (teaches ${def.teachesProfession})` : "";
  const classInfo = def.teachesClass ? ` (teaches ${def.teachesClass})` : "";
  console.log(
    `[npc] Spawned ${def.type} "${def.name}" in ${def.zoneId} at world(${worldX}, ${worldY})${professionInfo}${classInfo}`
  );
}

/**
 * Check for dead mobs and respawn them after a cooldown delay.
 * Call this periodically (e.g., every 5 seconds).
 */
export function tickMobRespawner(): void {
  const now = Date.now();

  // Snapshot entries to avoid mutation-during-iteration
  const entries = [...spawnedNpcIds.entries()];

  for (const [def, entityId] of entries) {
    // Only respawn mobs (skip merchants, NPCs, etc.)
    if (def.type !== "mob" && def.type !== "boss") continue;

    const entity = getEntity(entityId);

    if (entity) {
      // Mob is alive — clear any pending respawn timer
      if (pendingRespawns.has(def)) {
        pendingRespawns.delete(def);
      }
      continue;
    }

    // Mob is dead/missing — start or check respawn timer
    if (!pendingRespawns.has(def)) {
      pendingRespawns.set(def, now);
      console.log(`[respawn] ${def.name} in ${def.zoneId} died — respawn in ${MOB_RESPAWN_DELAY_MS / 1000}s`);
      continue;
    }

    const deathTime = pendingRespawns.get(def)!;
    if (now - deathTime >= MOB_RESPAWN_DELAY_MS) {
      console.log(`[respawn] Respawning ${def.name} in ${def.zoneId} (after ${((now - deathTime) / 1000).toFixed(1)}s)`);
      spawnSingleNpc(def);
      pendingRespawns.delete(def);
    }
  }
}
