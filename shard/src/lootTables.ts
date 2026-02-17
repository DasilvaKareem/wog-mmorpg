/**
 * Loot Tables for Mobs
 *
 * Auto-drops: Minted immediately to killer's wallet when mob dies
 * Skinning-drops: Require skinning profession + knife to harvest from corpse
 */

export interface LootDrop {
  tokenId: bigint;
  minQuantity: number;
  maxQuantity: number;
  chance: number; // 0-1 probability
}

export interface MobLootTable {
  mobName: string;
  copperMin: number;
  copperMax: number;
  autoDrops: LootDrop[]; // Auto-mint on kill
  skinningDrops: LootDrop[]; // Requires skinning profession
}

export const LOOT_TABLES: Record<string, MobLootTable> = {
  // --- Human Meadow Mobs (Starter Zone) ---
  "Hungry Wolf": {
    mobName: "Hungry Wolf",
    copperMin: 8,
    copperMax: 15,
    autoDrops: [
      { tokenId: 1n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Raw Meat
    ],
    skinningDrops: [
      { tokenId: 62n, minQuantity: 1, maxQuantity: 3, chance: 0.8 }, // Scrap Leather
      { tokenId: 65n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Wolf Pelt
      { tokenId: 68n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Small Bone
    ],
  },

  "Giant Rat": {
    mobName: "Giant Rat",
    copperMin: 5,
    copperMax: 10,
    autoDrops: [
      { tokenId: 1n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Raw Meat
    ],
    skinningDrops: [
      { tokenId: 62n, minQuantity: 1, maxQuantity: 2, chance: 0.6 }, // Scrap Leather
      { tokenId: 68n, minQuantity: 1, maxQuantity: 1, chance: 0.4 }, // Small Bone
    ],
  },

  "Wild Boar": {
    mobName: "Wild Boar",
    copperMin: 10,
    copperMax: 18,
    autoDrops: [
      { tokenId: 1n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Raw Meat
    ],
    skinningDrops: [
      { tokenId: 63n, minQuantity: 1, maxQuantity: 3, chance: 0.7 }, // Light Leather
      { tokenId: 69n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Thick Bone
    ],
  },

  "Goblin Raider": {
    mobName: "Goblin Raider",
    copperMin: 12,
    copperMax: 20,
    autoDrops: [
      { tokenId: 22n, minQuantity: 1, maxQuantity: 2, chance: 0.2 }, // Coal Ore
    ],
    skinningDrops: [
      { tokenId: 63n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Light Leather
    ],
  },

  "Bandit Scout": {
    mobName: "Bandit Scout",
    copperMin: 15,
    copperMax: 25,
    autoDrops: [
      { tokenId: 0n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Healing Potion
      { tokenId: 22n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Coal Ore
    ],
    skinningDrops: [
      { tokenId: 63n, minQuantity: 1, maxQuantity: 3, chance: 0.6 }, // Light Leather
    ],
  },

  "Mire Slime": {
    mobName: "Mire Slime",
    copperMin: 8,
    copperMax: 14,
    autoDrops: [
      { tokenId: 31n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Meadow Lily (slime residue)
    ],
    skinningDrops: [], // Slimes can't be skinned
  },

  "Diseased Wolf": {
    mobName: "Diseased Wolf",
    copperMin: 10,
    copperMax: 16,
    autoDrops: [
      { tokenId: 1n, minQuantity: 1, maxQuantity: 1, chance: 0.25 }, // Raw Meat (diseased)
    ],
    skinningDrops: [
      { tokenId: 62n, minQuantity: 1, maxQuantity: 2, chance: 0.7 }, // Scrap Leather
      { tokenId: 68n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Small Bone
    ],
  },

  // --- Wild Meadow Mobs (Mid-Tier) ---
  "Forest Bear": {
    mobName: "Forest Bear",
    copperMin: 20,
    copperMax: 35,
    autoDrops: [
      { tokenId: 1n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Raw Meat
    ],
    skinningDrops: [
      { tokenId: 64n, minQuantity: 2, maxQuantity: 4, chance: 0.8 }, // Medium Leather
      { tokenId: 66n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Bear Hide
      { tokenId: 69n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Thick Bone
    ],
  },

  "Venom Spider": {
    mobName: "Venom Spider",
    copperMin: 18,
    copperMax: 30,
    autoDrops: [
      { tokenId: 38n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Moonflower (venom gland)
    ],
    skinningDrops: [
      { tokenId: 67n, minQuantity: 1, maxQuantity: 3, chance: 0.7 }, // Spider Silk
      { tokenId: 62n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Scrap Leather (chitin)
    ],
  },

  "Rogue Bandit": {
    mobName: "Rogue Bandit",
    copperMin: 25,
    copperMax: 40,
    autoDrops: [
      { tokenId: 0n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Healing Potion
      { tokenId: 23n, minQuantity: 1, maxQuantity: 2, chance: 0.25 }, // Tin Ore
    ],
    skinningDrops: [
      { tokenId: 64n, minQuantity: 1, maxQuantity: 3, chance: 0.6 }, // Medium Leather
    ],
  },

  "Corrupted Ent": {
    mobName: "Corrupted Ent",
    copperMin: 30,
    copperMax: 50,
    autoDrops: [
      { tokenId: 35n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Lavender (corrupted wood)
    ],
    skinningDrops: [
      { tokenId: 69n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Thick Bone (wood)
    ],
  },

  "Dire Wolf": {
    mobName: "Dire Wolf",
    copperMin: 35,
    copperMax: 55,
    autoDrops: [
      { tokenId: 1n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Raw Meat
    ],
    skinningDrops: [
      { tokenId: 64n, minQuantity: 2, maxQuantity: 4, chance: 0.8 }, // Medium Leather
      { tokenId: 65n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Wolf Pelt
      { tokenId: 69n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Thick Bone
    ],
  },

  // --- Dark Forest Mobs (High-Tier) ---
  "Shadow Wolf": {
    mobName: "Shadow Wolf",
    copperMin: 40,
    copperMax: 65,
    autoDrops: [
      { tokenId: 1n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Raw Meat
      { tokenId: 39n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Starbloom (shadow essence)
      { tokenId: 116n, minQuantity: 1, maxQuantity: 1, chance: 0.08 }, // Rough Ruby
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 1, maxQuantity: 2, chance: 0.7 }, // Heavy Leather
      { tokenId: 71n, minQuantity: 1, maxQuantity: 1, chance: 0.4 }, // Shadow Pelt
      { tokenId: 69n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Thick Bone
    ],
  },

  "Dark Cultist": {
    mobName: "Dark Cultist",
    copperMin: 50,
    copperMax: 80,
    autoDrops: [
      { tokenId: 80n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Mana Potion
      { tokenId: 24n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Copper Ore
      { tokenId: 117n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Rough Sapphire
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Heavy Leather (robes)
    ],
  },

  "Undead Knight": {
    mobName: "Undead Knight",
    copperMin: 60,
    copperMax: 95,
    autoDrops: [
      { tokenId: 24n, minQuantity: 1, maxQuantity: 3, chance: 0.4 }, // Copper Ore
      { tokenId: 25n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Silver Ore
      { tokenId: 118n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Rough Emerald
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.05 }, // Flawed Diamond
    ],
    skinningDrops: [
      { tokenId: 72n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Ancient Bone
      { tokenId: 70n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Heavy Leather (armor)
    ],
  },

  "Forest Troll": {
    mobName: "Forest Troll",
    copperMin: 70,
    copperMax: 110,
    autoDrops: [
      { tokenId: 1n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Raw Meat
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.08 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Heavy Leather
      { tokenId: 73n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Troll Hide
      { tokenId: 72n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Ancient Bone
    ],
  },

  "Ancient Golem": {
    mobName: "Ancient Golem",
    copperMin: 80,
    copperMax: 130,
    autoDrops: [
      { tokenId: 25n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Silver Ore
      { tokenId: 26n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Gold Ore
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Flawed Diamond
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.05 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 1, maxQuantity: 3, chance: 0.6 }, // Golem Core
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.8 }, // Ancient Bone (stone)
    ],
  },

  "Necromancer Valdris": {
    mobName: "Necromancer Valdris",
    copperMin: 150,
    copperMax: 250,
    autoDrops: [
      { tokenId: 80n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Mana Potion
      { tokenId: 26n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Gold Ore
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.25 }, // Arcane Crystal
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 75n, minQuantity: 1, maxQuantity: 1, chance: 0.8 }, // Necromancer's Essence (rare)
      { tokenId: 70n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Heavy Leather (robes)
      { tokenId: 72n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Ancient Bone
    ],
  },

  // --- Auroral Plains Mobs (L15-20) ---
  "Plains Stalker": {
    mobName: "Plains Stalker",
    copperMin: 85,
    copperMax: 140,
    autoDrops: [
      { tokenId: 1n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Raw Meat
      { tokenId: 25n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Silver Ore
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 2, maxQuantity: 3, chance: 0.7 }, // Heavy Leather
      { tokenId: 69n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Thick Bone
    ],
  },

  "Aurora Wisp": {
    mobName: "Aurora Wisp",
    copperMin: 90,
    copperMax: 150,
    autoDrops: [
      { tokenId: 39n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Starbloom
      { tokenId: 80n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Mana Potion
    ],
    skinningDrops: [], // Wisps can't be skinned
  },

  "Windborne Harpy": {
    mobName: "Windborne Harpy",
    copperMin: 95,
    copperMax: 155,
    autoDrops: [
      { tokenId: 1n, minQuantity: 1, maxQuantity: 3, chance: 0.5 }, // Raw Meat
      { tokenId: 116n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Rough Ruby
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 1, maxQuantity: 3, chance: 0.7 }, // Heavy Leather
      { tokenId: 67n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Spider Silk (feathers)
    ],
  },

  "Essence Wraith": {
    mobName: "Essence Wraith",
    copperMin: 100,
    copperMax: 160,
    autoDrops: [
      { tokenId: 80n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Mana Potion
      { tokenId: 39n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Starbloom
      { tokenId: 117n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Rough Sapphire
    ],
    skinningDrops: [],
  },

  "Storm Elemental": {
    mobName: "Storm Elemental",
    copperMin: 110,
    copperMax: 175,
    autoDrops: [
      { tokenId: 26n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Gold Ore
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.08 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Golem Core
    ],
  },

  "Skyward Drake": {
    mobName: "Skyward Drake",
    copperMin: 200,
    copperMax: 350,
    autoDrops: [
      { tokenId: 1n, minQuantity: 4, maxQuantity: 6, chance: 0.8 }, // Raw Meat
      { tokenId: 26n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Gold Ore
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Heavy Leather
      { tokenId: 73n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Troll Hide (drake scales)
      { tokenId: 72n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Ancient Bone
    ],
  },

  // --- Emerald Woods Mobs (L20-25) ---
  "Thorned Treant": {
    mobName: "Thorned Treant",
    copperMin: 120,
    copperMax: 200,
    autoDrops: [
      { tokenId: 35n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Lavender (bark)
      { tokenId: 118n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Rough Emerald
    ],
    skinningDrops: [
      { tokenId: 69n, minQuantity: 4, maxQuantity: 7, chance: 0.7 }, // Thick Bone (wood)
    ],
  },

  "Emerald Serpent": {
    mobName: "Emerald Serpent",
    copperMin: 130,
    copperMax: 210,
    autoDrops: [
      { tokenId: 1n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Raw Meat
      { tokenId: 38n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Moonflower (venom)
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Heavy Leather
      { tokenId: 71n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Shadow Pelt (snake skin)
    ],
  },

  "Feral Worg": {
    mobName: "Feral Worg",
    copperMin: 135,
    copperMax: 220,
    autoDrops: [
      { tokenId: 1n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Raw Meat
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 2, maxQuantity: 4, chance: 0.8 }, // Heavy Leather
      { tokenId: 65n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Wolf Pelt
      { tokenId: 69n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Thick Bone
    ],
  },

  "Selerion Specter": {
    mobName: "Selerion Specter",
    copperMin: 140,
    copperMax: 230,
    autoDrops: [
      { tokenId: 80n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Mana Potion
      { tokenId: 39n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Starbloom
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Shadow Opal
    ],
    skinningDrops: [],
  },

  "Grom Sentinel": {
    mobName: "Grom Sentinel",
    copperMin: 280,
    copperMax: 450,
    autoDrops: [
      { tokenId: 26n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Gold Ore
      { tokenId: 40n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Arcane Crystal
      { tokenId: 118n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Rough Emerald
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 2, maxQuantity: 3, chance: 0.7 }, // Golem Core
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.8 }, // Ancient Bone
    ],
  },

  // --- Viridian Range Mobs (L25-30) ---
  "Mountain Yeti": {
    mobName: "Mountain Yeti",
    copperMin: 160,
    copperMax: 260,
    autoDrops: [
      { tokenId: 1n, minQuantity: 3, maxQuantity: 6, chance: 0.7 }, // Raw Meat
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Heavy Leather
      { tokenId: 73n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Troll Hide (yeti fur)
      { tokenId: 69n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Thick Bone
    ],
  },

  "Rock Basilisk": {
    mobName: "Rock Basilisk",
    copperMin: 170,
    copperMax: 275,
    autoDrops: [
      { tokenId: 25n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Silver Ore
      { tokenId: 26n, minQuantity: 1, maxQuantity: 2, chance: 0.25 }, // Gold Ore
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Flawed Diamond
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Heavy Leather (scales)
    ],
  },

  "Storm Condor": {
    mobName: "Storm Condor",
    copperMin: 175,
    copperMax: 285,
    autoDrops: [
      { tokenId: 1n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Raw Meat
      { tokenId: 116n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Rough Ruby
    ],
    skinningDrops: [
      { tokenId: 67n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Spider Silk (feathers)
      { tokenId: 70n, minQuantity: 1, maxQuantity: 3, chance: 0.5 }, // Heavy Leather
    ],
  },

  "Gemloch Golem": {
    mobName: "Gemloch Golem",
    copperMin: 185,
    copperMax: 300,
    autoDrops: [
      { tokenId: 26n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Gold Ore
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Flawed Diamond
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 2, maxQuantity: 3, chance: 0.7 }, // Golem Core
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.7 }, // Ancient Bone
    ],
  },

  "Frost Giant": {
    mobName: "Frost Giant",
    copperMin: 200,
    copperMax: 320,
    autoDrops: [
      { tokenId: 1n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Raw Meat
      { tokenId: 26n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Gold Ore
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 73n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Troll Hide (giant skin)
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.7 }, // Ancient Bone
    ],
  },

  "Avalanche Titan": {
    mobName: "Avalanche Titan",
    copperMin: 350,
    copperMax: 550,
    autoDrops: [
      { tokenId: 26n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Gold Ore
      { tokenId: 40n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Arcane Crystal
      { tokenId: 119n, minQuantity: 1, maxQuantity: 2, chance: 0.25 }, // Flawed Diamond
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Golem Core
      { tokenId: 72n, minQuantity: 6, maxQuantity: 10, chance: 0.8 }, // Ancient Bone
    ],
  },

  // --- Moondancer Glade Mobs (L30-35) ---
  "Moon Stalker": {
    mobName: "Moon Stalker",
    copperMin: 210,
    copperMax: 340,
    autoDrops: [
      { tokenId: 1n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Raw Meat
      { tokenId: 39n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Starbloom
    ],
    skinningDrops: [
      { tokenId: 71n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Shadow Pelt
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Heavy Leather
    ],
  },

  "Fae Guardian": {
    mobName: "Fae Guardian",
    copperMin: 220,
    copperMax: 355,
    autoDrops: [
      { tokenId: 80n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Mana Potion
      { tokenId: 38n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Moonflower
      { tokenId: 117n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Rough Sapphire
    ],
    skinningDrops: [
      { tokenId: 67n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Spider Silk (fae threads)
    ],
  },

  "Twilight Dryad": {
    mobName: "Twilight Dryad",
    copperMin: 230,
    copperMax: 370,
    autoDrops: [
      { tokenId: 35n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Lavender
      { tokenId: 39n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Starbloom
      { tokenId: 118n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Rough Emerald
    ],
    skinningDrops: [
      { tokenId: 69n, minQuantity: 4, maxQuantity: 6, chance: 0.6 }, // Thick Bone (bark)
    ],
  },

  "Shadow Druid": {
    mobName: "Shadow Druid",
    copperMin: 240,
    copperMax: 385,
    autoDrops: [
      { tokenId: 80n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Mana Potion
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.35 }, // Dragon's Breath
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Heavy Leather (robes)
    ],
  },

  "Lunar Wraith": {
    mobName: "Lunar Wraith",
    copperMin: 250,
    copperMax: 400,
    autoDrops: [
      { tokenId: 39n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Starbloom
      { tokenId: 80n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Mana Potion
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Arcane Crystal
    ],
    skinningDrops: [],
  },

  "Moondancer Archdruid": {
    mobName: "Moondancer Archdruid",
    copperMin: 450,
    copperMax: 700,
    autoDrops: [
      { tokenId: 40n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Dragon's Breath
      { tokenId: 26n, minQuantity: 4, maxQuantity: 6, chance: 0.6 }, // Gold Ore
      { tokenId: 121n, minQuantity: 1, maxQuantity: 2, chance: 0.35 }, // Arcane Crystal
      { tokenId: 120n, minQuantity: 1, maxQuantity: 2, chance: 0.25 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 75n, minQuantity: 1, maxQuantity: 2, chance: 0.7 }, // Necromancer's Essence
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Heavy Leather
    ],
  },

  // --- Felsrock Citadel Mobs (L35-40) ---
  "Iron Automaton": {
    mobName: "Iron Automaton",
    copperMin: 260,
    copperMax: 420,
    autoDrops: [
      { tokenId: 26n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Gold Ore
      { tokenId: 25n, minQuantity: 2, maxQuantity: 4, chance: 0.4 }, // Silver Ore
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 2, maxQuantity: 3, chance: 0.7 }, // Golem Core
    ],
  },

  "Molten Forgebound": {
    mobName: "Molten Forgebound",
    copperMin: 275,
    copperMax: 440,
    autoDrops: [
      { tokenId: 26n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Gold Ore
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Dragon's Breath
      { tokenId: 116n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Rough Ruby
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 1, maxQuantity: 2, chance: 0.6 }, // Golem Core
    ],
  },

  "Deep Dweller": {
    mobName: "Deep Dweller",
    copperMin: 285,
    copperMax: 460,
    autoDrops: [
      { tokenId: 1n, minQuantity: 3, maxQuantity: 5, chance: 0.5 }, // Raw Meat
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Flawed Diamond
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Heavy Leather
      { tokenId: 73n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Troll Hide
    ],
  },

  "Rune Golem": {
    mobName: "Rune Golem",
    copperMin: 300,
    copperMax: 480,
    autoDrops: [
      { tokenId: 26n, minQuantity: 3, maxQuantity: 5, chance: 0.5 }, // Gold Ore
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Arcane Crystal
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Flawed Diamond
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Golem Core
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.7 }, // Ancient Bone
    ],
  },

  "Corrupted Dwarf King": {
    mobName: "Corrupted Dwarf King",
    copperMin: 320,
    copperMax: 510,
    autoDrops: [
      { tokenId: 26n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Gold Ore
      { tokenId: 0n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Healing Potion
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Heavy Leather
      { tokenId: 72n, minQuantity: 4, maxQuantity: 6, chance: 0.6 }, // Ancient Bone
    ],
  },

  "Forgemaster Infernal": {
    mobName: "Forgemaster Infernal",
    copperMin: 550,
    copperMax: 900,
    autoDrops: [
      { tokenId: 26n, minQuantity: 5, maxQuantity: 8, chance: 0.8 }, // Gold Ore
      { tokenId: 40n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Arcane Crystal
      { tokenId: 119n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Flawed Diamond
      { tokenId: 120n, minQuantity: 1, maxQuantity: 2, chance: 0.25 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Golem Core
      { tokenId: 75n, minQuantity: 1, maxQuantity: 2, chance: 0.6 }, // Necromancer's Essence
    ],
  },

  // --- Lake Lumina Mobs (L40-45) ---
  "Luminous Wraith": {
    mobName: "Luminous Wraith",
    copperMin: 340,
    copperMax: 540,
    autoDrops: [
      { tokenId: 39n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Starbloom
      { tokenId: 80n, minQuantity: 2, maxQuantity: 4, chance: 0.4 }, // Mana Potion
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Arcane Crystal
    ],
    skinningDrops: [],
  },

  "Crystal Golem": {
    mobName: "Crystal Golem",
    copperMin: 360,
    copperMax: 570,
    autoDrops: [
      { tokenId: 26n, minQuantity: 3, maxQuantity: 5, chance: 0.5 }, // Gold Ore
      { tokenId: 119n, minQuantity: 1, maxQuantity: 2, chance: 0.2 }, // Flawed Diamond
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Golem Core
    ],
  },

  "Drowned Knight": {
    mobName: "Drowned Knight",
    copperMin: 380,
    copperMax: 600,
    autoDrops: [
      { tokenId: 26n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Gold Ore
      { tokenId: 0n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Healing Potion
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.8 }, // Ancient Bone
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Heavy Leather
    ],
  },

  "Lumen Serpent": {
    mobName: "Lumen Serpent",
    copperMin: 400,
    copperMax: 630,
    autoDrops: [
      { tokenId: 1n, minQuantity: 4, maxQuantity: 6, chance: 0.6 }, // Raw Meat
      { tokenId: 39n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Starbloom
      { tokenId: 117n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Rough Sapphire
    ],
    skinningDrops: [
      { tokenId: 71n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Shadow Pelt (scales)
      { tokenId: 70n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Heavy Leather
    ],
  },

  "Sunken Horror": {
    mobName: "Sunken Horror",
    copperMin: 420,
    copperMax: 660,
    autoDrops: [
      { tokenId: 40n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Arcane Crystal
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Flawed Diamond
    ],
    skinningDrops: [
      { tokenId: 73n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Troll Hide
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.7 }, // Ancient Bone
    ],
  },

  "Solaris Warden": {
    mobName: "Solaris Warden",
    copperMin: 700,
    copperMax: 1100,
    autoDrops: [
      { tokenId: 26n, minQuantity: 6, maxQuantity: 10, chance: 0.8 }, // Gold Ore
      { tokenId: 40n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Arcane Crystal
      { tokenId: 119n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Flawed Diamond
      { tokenId: 120n, minQuantity: 1, maxQuantity: 2, chance: 0.25 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 75n, minQuantity: 2, maxQuantity: 3, chance: 0.8 }, // Necromancer's Essence
      { tokenId: 74n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Golem Core
    ],
  },

  // --- Azurshard Chasm Mobs (L45-50) ---
  "Azure Dragonkin": {
    mobName: "Azure Dragonkin",
    copperMin: 450,
    copperMax: 700,
    autoDrops: [
      { tokenId: 1n, minQuantity: 4, maxQuantity: 6, chance: 0.6 }, // Raw Meat
      { tokenId: 40n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Dragon's Breath
      { tokenId: 117n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Rough Sapphire
    ],
    skinningDrops: [
      { tokenId: 73n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Troll Hide (dragonscale)
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Heavy Leather
    ],
  },

  "Void Weaver": {
    mobName: "Void Weaver",
    copperMin: 475,
    copperMax: 740,
    autoDrops: [
      { tokenId: 80n, minQuantity: 3, maxQuantity: 5, chance: 0.5 }, // Mana Potion
      { tokenId: 39n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Starbloom
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Arcane Crystal
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 67n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Spider Silk (void threads)
    ],
  },

  "Shard Sentinel": {
    mobName: "Shard Sentinel",
    copperMin: 500,
    copperMax: 780,
    autoDrops: [
      { tokenId: 26n, minQuantity: 3, maxQuantity: 5, chance: 0.5 }, // Gold Ore
      { tokenId: 119n, minQuantity: 1, maxQuantity: 2, chance: 0.2 }, // Flawed Diamond
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Golem Core
      { tokenId: 72n, minQuantity: 6, maxQuantity: 10, chance: 0.7 }, // Ancient Bone
    ],
  },

  "Chasm Wyrm": {
    mobName: "Chasm Wyrm",
    copperMin: 530,
    copperMax: 830,
    autoDrops: [
      { tokenId: 1n, minQuantity: 5, maxQuantity: 8, chance: 0.7 }, // Raw Meat
      { tokenId: 40n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Dragon's Breath
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 73n, minQuantity: 4, maxQuantity: 6, chance: 0.8 }, // Troll Hide (wyrm scales)
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.7 }, // Ancient Bone
    ],
  },

  "Essence Devourer": {
    mobName: "Essence Devourer",
    copperMin: 560,
    copperMax: 880,
    autoDrops: [
      { tokenId: 40n, minQuantity: 3, maxQuantity: 5, chance: 0.5 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 2, chance: 0.2 }, // Arcane Crystal
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Shadow Opal
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Flawed Diamond
    ],
    skinningDrops: [
      { tokenId: 75n, minQuantity: 1, maxQuantity: 2, chance: 0.6 }, // Necromancer's Essence
    ],
  },

  "Azurshard Dragon": {
    mobName: "Azurshard Dragon",
    copperMin: 900,
    copperMax: 1500,
    autoDrops: [
      { tokenId: 26n, minQuantity: 8, maxQuantity: 12, chance: 0.9 }, // Gold Ore
      { tokenId: 40n, minQuantity: 5, maxQuantity: 8, chance: 0.8 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Arcane Crystal
      { tokenId: 119n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Flawed Diamond
      { tokenId: 120n, minQuantity: 2, maxQuantity: 3, chance: 0.35 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 75n, minQuantity: 2, maxQuantity: 4, chance: 0.8 }, // Necromancer's Essence
      { tokenId: 73n, minQuantity: 5, maxQuantity: 8, chance: 0.9 }, // Troll Hide (dragon scales)
      { tokenId: 74n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Golem Core (dragon heart)
      { tokenId: 72n, minQuantity: 8, maxQuantity: 12, chance: 0.9 }, // Ancient Bone
    ],
  },
};

/**
 * Get loot table for a mob by name
 */
export function getLootTable(mobName: string): MobLootTable | undefined {
  return LOOT_TABLES[mobName];
}

/**
 * Roll drops based on loot table
 */
export function rollDrops(drops: LootDrop[]): Array<{ tokenId: bigint; quantity: number }> {
  const results: Array<{ tokenId: bigint; quantity: number }> = [];

  for (const drop of drops) {
    if (Math.random() <= drop.chance) {
      const quantity =
        Math.floor(Math.random() * (drop.maxQuantity - drop.minQuantity + 1)) +
        drop.minQuantity;
      results.push({ tokenId: drop.tokenId, quantity });
    }
  }

  return results;
}

/**
 * Roll random copper amount from range
 */
export function rollCopper(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Merge additional loot tables (e.g., dungeon mobs) into the main LOOT_TABLES.
 */
export function registerDungeonLootTables(tables: Record<string, MobLootTable>): void {
  Object.assign(LOOT_TABLES, tables);
}
