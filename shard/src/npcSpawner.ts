import { randomUUID } from "crypto";
import { getOrCreateZone, type Entity } from "./zoneRuntime.js";
import type { ProfessionType } from "./professions.js";

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
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Sister Elara - Paladin Trainer",
    x: 200,
    y: 80,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Shade Whisper - Rogue Trainer",
    x: 340,
    y: 80,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Sylvan Swiftarrow - Ranger Trainer",
    x: 480,
    y: 80,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Archmage Aldric - Mage Trainer",
    x: 60,
    y: 160,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Father Benedict - Cleric Trainer",
    x: 200,
    y: 160,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Malakai Darkbane - Warlock Trainer",
    x: 340,
    y: 160,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Master Li Chen - Monk Trainer",
    x: 480,
    y: 160,
    hp: 999,
  },

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

  const entity: Entity = {
    id: randomUUID(),
    type: def.type,
    name: def.name,
    x: def.x,
    y: def.y,
    hp: def.hp,
    maxHp: def.hp,
    createdAt: Date.now(),
    shopItems: def.shopItems,
    ...(def.level != null && { level: def.level }),
    ...(def.xpReward != null && { xpReward: def.xpReward }),
    ...(def.teachesProfession != null && { teachesProfession: def.teachesProfession }),
  };

  zone.entities.set(entity.id, entity);
  spawnedNpcIds.set(def, entity.id);
  npcIdsByName.set(def.name, entity.id);

  const professionInfo = def.teachesProfession ? ` (teaches ${def.teachesProfession})` : "";
  console.log(
    `[npc] Spawned ${def.type} "${def.name}" in ${def.zoneId} at (${def.x}, ${def.y})${professionInfo}`
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

    const zone = getOrCreateZone(def.zoneId);
    const entity = zone.entities.get(entityId);

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
