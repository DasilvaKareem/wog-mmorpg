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
  // Quest Giver - Offers kill quests
  {
    zoneId: "village-square",
    type: "quest-giver",
    name: "Guard Captain Marcus",
    x: 96,
    y: 96,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "merchant",
    name: "Grimwald the Trader",
    x: 115,
    y: 269,
    hp: 999,
    // Sells potions, starter weapons, starter armor, Stone Pickaxe, Basic Sickle, Rusty Skinning Knife
    shopItems: [0, 1, 2, 4, 6, 7, 8, 10, 12, 13, 14, 15, 16, 27, 41, 76],
  },
  {
    zoneId: "village-square",
    type: "merchant",
    name: "Bron the Blacksmith",
    x: 141,
    y: 269,
    hp: 999,
    // Sells advanced weapons, heavy armor, pickaxes, sickles, skinning knives, disenchanting scroll
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79, 115],
  },
  // Auctioneer - Regional Auction House
  {
    zoneId: "village-square",
    type: "auctioneer",
    name: "Lysandra the Auctioneer",
    x: 128,
    y: 243,
    hp: 999,
  },
  // Profession Trainers
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Grizzled Miner Torvik",
    x: 166,
    y: 269,
    hp: 999,
    teachesProfession: "mining",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Master Smith Durgan",
    x: 192,
    y: 269,
    hp: 999,
    teachesProfession: "blacksmithing",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Herbalist Willow",
    x: 218,
    y: 269,
    hp: 999,
    teachesProfession: "herbalism",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Alchemist Mirelle",
    x: 243,
    y: 269,
    hp: 999,
    teachesProfession: "alchemy",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Huntsman Greaves",
    x: 269,
    y: 269,
    hp: 999,
    teachesProfession: "skinning",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Chef Gastron",
    x: 294,
    y: 269,
    hp: 999,
    teachesProfession: "cooking",
  },
  // Crafting Stations
  {
    zoneId: "village-square",
    type: "forge",
    name: "Ancient Forge",
    x: 179,
    y: 294,
    hp: 9999,
  },
  {
    zoneId: "village-square",
    type: "alchemy-lab",
    name: "Mystical Cauldron",
    x: 230,
    y: 294,
    hp: 9999,
  },
  {
    zoneId: "village-square",
    type: "enchanting-altar",
    name: "Enchanter's Altar",
    x: 205,
    y: 294,
    hp: 9999,
  },
  {
    zoneId: "village-square",
    type: "campfire",
    name: "Cooking Campfire",
    x: 256,
    y: 294,
    hp: 9999,
  },
  // Leatherworking & Jewelcrafting Stations
  {
    zoneId: "village-square",
    type: "tanning-rack",
    name: "Sturdy Tanning Rack",
    x: 282,
    y: 294,
    hp: 9999,
  },
  {
    zoneId: "village-square",
    type: "jewelers-bench",
    name: "Jeweler's Workbench",
    x: 307,
    y: 294,
    hp: 9999,
  },
  // Leatherworking & Jewelcrafting Trainers
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Tanner Hilda",
    x: 320,
    y: 269,
    hp: 999,
    teachesProfession: "leatherworking",
  },
  {
    zoneId: "village-square",
    type: "profession-trainer",
    name: "Gemcutter Orik",
    x: 346,
    y: 269,
    hp: 999,
    teachesProfession: "jewelcrafting",
  },
  // Class Trainers
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Thrain Ironforge - Warrior Trainer",
    x: 64,
    y: 128,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Sister Elara - Paladin Trainer",
    x: 90,
    y: 128,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Shade Whisper - Rogue Trainer",
    x: 115,
    y: 128,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Sylvan Swiftarrow - Ranger Trainer",
    x: 141,
    y: 128,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Archmage Aldric - Mage Trainer",
    x: 166,
    y: 128,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Father Benedict - Cleric Trainer",
    x: 64,
    y: 154,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Malakai Darkbane - Warlock Trainer",
    x: 90,
    y: 154,
    hp: 999,
  },
  {
    zoneId: "village-square",
    type: "trainer",
    name: "Master Li Chen - Monk Trainer",
    x: 115,
    y: 154,
    hp: 999,
  },
  // Auctioneers in other zones
  {
    zoneId: "wild-meadow",
    type: "auctioneer",
    name: "Tormund the Broker",
    x: 175,
    y: 175,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "auctioneer",
    name: "Shadowbid Velara",
    x: 200,
    y: 200,
    hp: 999,
  },
  // Arena Masters - PvP Coliseum
  {
    zoneId: "village-square",
    type: "arena-master",
    name: "Gladiator Varro",
    x: 179,
    y: 243,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "arena-master",
    name: "Pit Fighter Kael",
    x: 147,
    y: 175,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "arena-master",
    name: "Shadow Champion Nyx",
    x: 173,
    y: 200,
    hp: 999,
  },
  // ── Lore NPCs — Arcadian History & Essence Scholars ──────────────
  // Chain 1: The Essence Awakening (Scholar Elowen → Druid Caelum → Arcanist Voss)
  {
    zoneId: "village-square",
    type: "lore-npc",
    name: "Scholar Elowen",
    x: 77,
    y: 243,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "lore-npc",
    name: "Druid Caelum",
    x: 126,
    y: 126,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "lore-npc",
    name: "Arcanist Voss",
    x: 133,
    y: 167,
    hp: 999,
  },
  // Chain 2: Whispers of the Auroral Plains (Elder Mirael)
  {
    zoneId: "village-square",
    type: "lore-npc",
    name: "Elder Mirael",
    x: 51,
    y: 192,
    hp: 999,
  },
  // Chain 3: Guardians of the Emerald Woods (Warden Sylvara)
  {
    zoneId: "wild-meadow",
    type: "lore-npc",
    name: "Warden Sylvara",
    x: 224,
    y: 126,
    hp: 999,
  },
  // Chain 4: Secrets of the Gemloch Depths (Stonekeeper Durgan)
  {
    zoneId: "dark-forest",
    type: "lore-npc",
    name: "Stonekeeper Durgan",
    x: 233,
    y: 133,
    hp: 999,
  },
  // Chain 5: The Fall and Rise of Arcadia (Chronicler Orin → Sage Thessaly → Remnant Keeper Nyx)
  {
    zoneId: "village-square",
    type: "lore-npc",
    name: "Chronicler Orin",
    x: 38,
    y: 218,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "lore-npc",
    name: "Sage Thessaly",
    x: 280,
    y: 210,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "lore-npc",
    name: "Remnant Keeper Nyx",
    x: 267,
    y: 233,
    hp: 999,
  },
  // Guild Registrars
  {
    zoneId: "village-square",
    type: "guild-registrar",
    name: "Guildmaster Theron",
    x: 154,
    y: 243,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "guild-registrar",
    name: "Warden Grimjaw",
    x: 203,
    y: 175,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "guild-registrar",
    name: "Covenant Keeper Noir",
    x: 227,
    y: 200,
    hp: 999,
  },
  // Mobs
  {
    zoneId: "village-square",
    type: "mob",
    name: "Hungry Wolf",
    x: 333,
    y: 230,
    hp: 65,
    level: 2,
    xpReward: 18,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Hungry Wolf",
    x: 358,
    y: 250,
    hp: 65,
    level: 2,
    xpReward: 18,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Goblin Raider",
    x: 435,
    y: 192,
    hp: 90,
    level: 3,
    xpReward: 28,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Mire Slime",
    x: 474,
    y: 346,
    hp: 110,
    level: 3,
    xpReward: 24,
  },
  // New Phase 2 Mobs
  {
    zoneId: "village-square",
    type: "mob",
    name: "Giant Rat",
    x: 128,
    y: 192,
    hp: 40,
    level: 1,
    xpReward: 12,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Giant Rat",
    x: 154,
    y: 205,
    hp: 40,
    level: 1,
    xpReward: 12,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Giant Rat",
    x: 179,
    y: 218,
    hp: 40,
    level: 1,
    xpReward: 12,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Wild Boar",
    x: 269,
    y: 320,
    hp: 55,
    level: 2,
    xpReward: 16,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Wild Boar",
    x: 294,
    y: 333,
    hp: 55,
    level: 2,
    xpReward: 16,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Wild Boar",
    x: 320,
    y: 346,
    hp: 55,
    level: 2,
    xpReward: 16,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Bandit Scout",
    x: 512,
    y: 256,
    hp: 120,
    level: 4,
    xpReward: 35,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Bandit Scout",
    x: 538,
    y: 282,
    hp: 120,
    level: 4,
    xpReward: 35,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Bandit Scout",
    x: 499,
    y: 243,
    hp: 120,
    level: 4,
    xpReward: 35,
  },
  {
    zoneId: "village-square",
    type: "mob",
    name: "Diseased Wolf",
    x: 576,
    y: 384,
    hp: 180,
    level: 5,
    xpReward: 42,
  },

  // === WILD MEADOW ZONE (Mid-Level, 5-10) ===

  // Quest Giver
  {
    zoneId: "wild-meadow",
    type: "quest-giver",
    name: "Ranger Thornwood",
    x: 175,
    y: 175,
    hp: 999,
  },

  // Level 6 Mobs - Forest Bears
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 105,
    y: 105,
    hp: 200,
    level: 6,
    xpReward: 55,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 126,
    y: 126,
    hp: 200,
    level: 6,
    xpReward: 55,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 140,
    y: 112,
    hp: 200,
    level: 6,
    xpReward: 55,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 154,
    y: 133,
    hp: 200,
    level: 6,
    xpReward: 55,
  },

  // Level 7 Mobs - Venom Spiders
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 245,
    y: 140,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 266,
    y: 154,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 280,
    y: 168,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 294,
    y: 182,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 308,
    y: 196,
    hp: 225,
    level: 7,
    xpReward: 68,
  },

  // Level 8 Mobs - Rogue Bandits
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 210,
    y: 245,
    hp: 250,
    level: 8,
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 224,
    y: 259,
    hp: 250,
    level: 8,
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 238,
    y: 273,
    hp: 250,
    level: 8,
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 252,
    y: 287,
    hp: 250,
    level: 8,
    xpReward: 82,
  },

  // Level 9 Mobs - Corrupted Ents
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 140,
    y: 280,
    hp: 280,
    level: 9,
    xpReward: 95,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 161,
    y: 294,
    hp: 280,
    level: 9,
    xpReward: 95,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 182,
    y: 308,
    hp: 280,
    level: 9,
    xpReward: 95,
  },

  // Level 10 Elite - Dire Wolf
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Dire Wolf",
    x: 315,
    y: 315,
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
    x: 200,
    y: 200,
    hp: 999,
  },

  // Level 11 Mobs - Shadow Wolves
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 133,
    y: 133,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 147,
    y: 147,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 160,
    y: 160,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 173,
    y: 173,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 187,
    y: 187,
    hp: 380,
    level: 11,
    xpReward: 125,
  },

  // Level 12 Mobs - Dark Cultists
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 233,
    y: 133,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 247,
    y: 147,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 260,
    y: 160,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 273,
    y: 173,
    hp: 410,
    level: 12,
    xpReward: 145,
  },

  // Level 13 Mobs - Undead Knights
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 300,
    y: 233,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 313,
    y: 247,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 327,
    y: 260,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 340,
    y: 273,
    hp: 445,
    level: 13,
    xpReward: 165,
  },

  // Level 14 Mobs - Forest Trolls
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 133,
    y: 300,
    hp: 480,
    level: 14,
    xpReward: 190,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 153,
    y: 313,
    hp: 480,
    level: 14,
    xpReward: 190,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 173,
    y: 327,
    hp: 480,
    level: 14,
    xpReward: 190,
  },

  // Level 15 Mobs - Ancient Golems
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Ancient Golem",
    x: 267,
    y: 333,
    hp: 520,
    level: 15,
    xpReward: 220,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Ancient Golem",
    x: 287,
    y: 347,
    hp: 520,
    level: 15,
    xpReward: 220,
  },

  // Level 16 Boss - Necromancer
  {
    zoneId: "dark-forest",
    type: "boss",
    name: "Necromancer Valdris",
    x: 200,
    y: 367,
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
