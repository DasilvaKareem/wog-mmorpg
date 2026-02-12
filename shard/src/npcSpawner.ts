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
    zoneId: "human-meadow",
    type: "quest-giver",
    name: "Guard Captain Marcus",
    x: 150,
    y: 150,
    hp: 999,
  },
  {
    zoneId: "human-meadow",
    type: "merchant",
    name: "Grimwald the Trader",
    x: 180,
    y: 420,
    hp: 999,
    // Sells potions, starter weapons, starter armor, Stone Pickaxe, Basic Sickle, Rusty Skinning Knife
    shopItems: [0, 1, 2, 4, 6, 7, 8, 10, 12, 13, 14, 15, 16, 27, 41, 76],
  },
  {
    zoneId: "human-meadow",
    type: "merchant",
    name: "Bron the Blacksmith",
    x: 220,
    y: 420,
    hp: 999,
    // Sells advanced weapons, heavy armor, pickaxes, sickles, and skinning knives
    shopItems: [3, 5, 9, 17, 18, 19, 20, 21, 28, 29, 30, 42, 43, 44, 77, 78, 79],
  },
  // Auctioneer - Regional Auction House
  {
    zoneId: "human-meadow",
    type: "auctioneer",
    name: "Lysandra the Auctioneer",
    x: 200,
    y: 380,
    hp: 999,
  },
  // Profession Trainers
  {
    zoneId: "human-meadow",
    type: "profession-trainer",
    name: "Grizzled Miner Torvik",
    x: 260,
    y: 420,
    hp: 999,
    teachesProfession: "mining",
  },
  {
    zoneId: "human-meadow",
    type: "profession-trainer",
    name: "Master Smith Durgan",
    x: 300,
    y: 420,
    hp: 999,
    teachesProfession: "blacksmithing",
  },
  {
    zoneId: "human-meadow",
    type: "profession-trainer",
    name: "Herbalist Willow",
    x: 340,
    y: 420,
    hp: 999,
    teachesProfession: "herbalism",
  },
  {
    zoneId: "human-meadow",
    type: "profession-trainer",
    name: "Alchemist Mirelle",
    x: 380,
    y: 420,
    hp: 999,
    teachesProfession: "alchemy",
  },
  {
    zoneId: "human-meadow",
    type: "profession-trainer",
    name: "Huntsman Greaves",
    x: 420,
    y: 420,
    hp: 999,
    teachesProfession: "skinning",
  },
  // Crafting Stations
  {
    zoneId: "human-meadow",
    type: "forge",
    name: "Ancient Forge",
    x: 280,
    y: 460,
    hp: 9999,
  },
  {
    zoneId: "human-meadow",
    type: "alchemy-lab",
    name: "Mystical Cauldron",
    x: 360,
    y: 460,
    hp: 9999,
  },
  {
    zoneId: "human-meadow",
    type: "enchanting-altar",
    name: "Enchanter's Altar",
    x: 320,
    y: 460,
    hp: 9999,
  },
  // Class Trainers
  {
    zoneId: "human-meadow",
    type: "trainer",
    name: "Thrain Ironforge - Warrior Trainer",
    x: 100,
    y: 200,
    hp: 999,
  },
  {
    zoneId: "human-meadow",
    type: "trainer",
    name: "Sister Elara - Paladin Trainer",
    x: 140,
    y: 200,
    hp: 999,
  },
  {
    zoneId: "human-meadow",
    type: "trainer",
    name: "Shade Whisper - Rogue Trainer",
    x: 180,
    y: 200,
    hp: 999,
  },
  {
    zoneId: "human-meadow",
    type: "trainer",
    name: "Sylvan Swiftarrow - Ranger Trainer",
    x: 220,
    y: 200,
    hp: 999,
  },
  {
    zoneId: "human-meadow",
    type: "trainer",
    name: "Archmage Aldric - Mage Trainer",
    x: 260,
    y: 200,
    hp: 999,
  },
  {
    zoneId: "human-meadow",
    type: "trainer",
    name: "Father Benedict - Cleric Trainer",
    x: 100,
    y: 240,
    hp: 999,
  },
  {
    zoneId: "human-meadow",
    type: "trainer",
    name: "Malakai Darkbane - Warlock Trainer",
    x: 140,
    y: 240,
    hp: 999,
  },
  {
    zoneId: "human-meadow",
    type: "trainer",
    name: "Master Li Chen - Monk Trainer",
    x: 180,
    y: 240,
    hp: 999,
  },
  // Auctioneers in other zones
  {
    zoneId: "wild-meadow",
    type: "auctioneer",
    name: "Tormund the Broker",
    x: 250,
    y: 250,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "auctioneer",
    name: "Shadowbid Velara",
    x: 300,
    y: 300,
    hp: 999,
  },
  // Guild Registrars
  {
    zoneId: "human-meadow",
    type: "guild-registrar",
    name: "Guildmaster Theron",
    x: 240,
    y: 380,
    hp: 999,
  },
  {
    zoneId: "wild-meadow",
    type: "guild-registrar",
    name: "Warden Grimjaw",
    x: 290,
    y: 250,
    hp: 999,
  },
  {
    zoneId: "dark-forest",
    type: "guild-registrar",
    name: "Covenant Keeper Noir",
    x: 340,
    y: 300,
    hp: 999,
  },
  // Mobs
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Hungry Wolf",
    x: 520,
    y: 360,
    hp: 65,
    level: 2,
    xpReward: 18,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Hungry Wolf",
    x: 560,
    y: 390,
    hp: 65,
    level: 2,
    xpReward: 18,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Goblin Raider",
    x: 680,
    y: 300,
    hp: 90,
    level: 3,
    xpReward: 28,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Mire Slime",
    x: 740,
    y: 540,
    hp: 110,
    level: 3,
    xpReward: 24,
  },
  // New Phase 2 Mobs
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Giant Rat",
    x: 200,
    y: 300,
    hp: 40,
    level: 1,
    xpReward: 12,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Giant Rat",
    x: 240,
    y: 320,
    hp: 40,
    level: 1,
    xpReward: 12,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Giant Rat",
    x: 280,
    y: 340,
    hp: 40,
    level: 1,
    xpReward: 12,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Wild Boar",
    x: 420,
    y: 500,
    hp: 55,
    level: 2,
    xpReward: 16,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Wild Boar",
    x: 460,
    y: 520,
    hp: 55,
    level: 2,
    xpReward: 16,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Wild Boar",
    x: 500,
    y: 540,
    hp: 55,
    level: 2,
    xpReward: 16,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Bandit Scout",
    x: 800,
    y: 400,
    hp: 120,
    level: 4,
    xpReward: 35,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Bandit Scout",
    x: 840,
    y: 440,
    hp: 120,
    level: 4,
    xpReward: 35,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Bandit Scout",
    x: 780,
    y: 380,
    hp: 120,
    level: 4,
    xpReward: 35,
  },
  {
    zoneId: "human-meadow",
    type: "mob",
    name: "Diseased Wolf",
    x: 900,
    y: 600,
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
    x: 250,
    y: 250,
    hp: 999,
  },

  // Level 6 Mobs - Forest Bears
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 150,
    y: 150,
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
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 200,
    y: 160,
    hp: 200,
    level: 6,
    xpReward: 55,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Forest Bear",
    x: 220,
    y: 190,
    hp: 200,
    level: 6,
    xpReward: 55,
  },

  // Level 7 Mobs - Venom Spiders
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 350,
    y: 200,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 380,
    y: 220,
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
    x: 420,
    y: 260,
    hp: 225,
    level: 7,
    xpReward: 68,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Venom Spider",
    x: 440,
    y: 280,
    hp: 225,
    level: 7,
    xpReward: 68,
  },

  // Level 8 Mobs - Rogue Bandits
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 300,
    y: 350,
    hp: 250,
    level: 8,
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 320,
    y: 370,
    hp: 250,
    level: 8,
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 340,
    y: 390,
    hp: 250,
    level: 8,
    xpReward: 82,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Rogue Bandit",
    x: 360,
    y: 410,
    hp: 250,
    level: 8,
    xpReward: 82,
  },

  // Level 9 Mobs - Corrupted Ents
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 200,
    y: 400,
    hp: 280,
    level: 9,
    xpReward: 95,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 230,
    y: 420,
    hp: 280,
    level: 9,
    xpReward: 95,
  },
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Corrupted Ent",
    x: 260,
    y: 440,
    hp: 280,
    level: 9,
    xpReward: 95,
  },

  // Level 10 Elite - Dire Wolf
  {
    zoneId: "wild-meadow",
    type: "mob",
    name: "Dire Wolf",
    x: 450,
    y: 450,
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
    x: 300,
    y: 300,
    hp: 999,
  },

  // Level 11 Mobs - Shadow Wolves
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 200,
    y: 200,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 220,
    y: 220,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 240,
    y: 240,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 260,
    y: 260,
    hp: 380,
    level: 11,
    xpReward: 125,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Shadow Wolf",
    x: 280,
    y: 280,
    hp: 380,
    level: 11,
    xpReward: 125,
  },

  // Level 12 Mobs - Dark Cultists
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 350,
    y: 200,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 370,
    y: 220,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 390,
    y: 240,
    hp: 410,
    level: 12,
    xpReward: 145,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Dark Cultist",
    x: 410,
    y: 260,
    hp: 410,
    level: 12,
    xpReward: 145,
  },

  // Level 13 Mobs - Undead Knights
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 450,
    y: 350,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 470,
    y: 370,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 490,
    y: 390,
    hp: 445,
    level: 13,
    xpReward: 165,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Undead Knight",
    x: 510,
    y: 410,
    hp: 445,
    level: 13,
    xpReward: 165,
  },

  // Level 14 Mobs - Forest Trolls
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 200,
    y: 450,
    hp: 480,
    level: 14,
    xpReward: 190,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 230,
    y: 470,
    hp: 480,
    level: 14,
    xpReward: 190,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Forest Troll",
    x: 260,
    y: 490,
    hp: 480,
    level: 14,
    xpReward: 190,
  },

  // Level 15 Mobs - Ancient Golems
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Ancient Golem",
    x: 400,
    y: 500,
    hp: 520,
    level: 15,
    xpReward: 220,
  },
  {
    zoneId: "dark-forest",
    type: "mob",
    name: "Ancient Golem",
    x: 430,
    y: 520,
    hp: 520,
    level: 15,
    xpReward: 220,
  },

  // Level 16 Boss - Necromancer
  {
    zoneId: "dark-forest",
    type: "boss",
    name: "Necromancer Valdris",
    x: 300,
    y: 550,
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
