import { randomUUID } from "crypto";
import { getOrCreateZone, type Entity } from "./zoneRuntime.js";
import type { ProfessionType } from "./professions.js";

/**
 * Static NPC definitions that auto-spawn when the shard boots.
 * Each NPC is placed in a specific zone at a fixed position.
 */
interface NpcDef {
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

const NPC_DEFS: NpcDef[] = [
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
    xpReward: 18,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Hungry Wolf",
    x: 490,
    y: 270,
    hp: 65,
    level: 2,
    xpReward: 18,
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
    xpReward: 28,
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
    xpReward: 24,
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
    xpReward: 12,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Giant Rat",
    x: 550,
    y: 70,
    hp: 40,
    level: 1,
    xpReward: 12,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Giant Rat",
    x: 500,
    y: 140,
    hp: 40,
    level: 1,
    xpReward: 12,
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
    xpReward: 16,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Wild Boar",
    x: 440,
    y: 550,
    hp: 55,
    level: 2,
    xpReward: 16,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Wild Boar",
    x: 540,
    y: 480,
    hp: 55,
    level: 2,
    xpReward: 16,
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
    xpReward: 35,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Bandit Scout",
    x: 570,
    y: 280,
    hp: 120,
    level: 4,
    xpReward: 35,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Bandit Scout",
    x: 580,
    y: 440,
    hp: 120,
    level: 4,
    xpReward: 35,
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
    xpReward: 42,
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
    xpReward: 55,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 180,
    y: 70,
    hp: 200,
    level: 6,
    xpReward: 55,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 70,
    y: 180,
    hp: 200,
    level: 6,
    xpReward: 55,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 180,
    y: 180,
    hp: 200,
    level: 6,
    xpReward: 55,
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
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 500,
    y: 160,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 580,
    y: 80,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 400,
    y: 240,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 500,
    y: 320,
    hp: 225,
    level: 7,
    xpReward: 68,
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
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 460,
    y: 500,
    hp: 250,
    level: 8,
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 560,
    y: 420,
    hp: 250,
    level: 8,
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 460,
    y: 580,
    hp: 250,
    level: 8,
    xpReward: 82,
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
    xpReward: 95,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 80,
    y: 470,
    hp: 280,
    level: 9,
    xpReward: 95,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 80,
    y: 580,
    hp: 280,
    level: 9,
    xpReward: 95,
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
    xpReward: 110,
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
];

// Track spawned NPCs for respawning
const spawnedNpcIds = new Map<NpcDef, string>();

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
 * Check for dead mobs and respawn them after delay.
 * Call this periodically (e.g., every 5 seconds).
 */
export function tickMobRespawner(): void {
  for (const [def, entityId] of spawnedNpcIds) {
    // Skip merchants
    if (def.type !== "mob") continue;

    const zone = getOrCreateZone(def.zoneId);
    const entity = zone.entities.get(entityId);

    // If mob is missing (dead), respawn it
    if (!entity) {
      console.log(`[respawn] Respawning ${def.name} in ${def.zoneId}`);
      spawnSingleNpc(def);
    }
  }
}
