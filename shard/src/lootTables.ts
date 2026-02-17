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
