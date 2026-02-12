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
  goldMin: number;
  goldMax: number;
  autoDrops: LootDrop[]; // Auto-mint on kill
  skinningDrops: LootDrop[]; // Requires skinning profession
}

export const LOOT_TABLES: Record<string, MobLootTable> = {
  // --- Human Meadow Mobs (Starter Zone) ---
  "Hungry Wolf": {
    mobName: "Hungry Wolf",
    goldMin: 8,
    goldMax: 15,
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
    goldMin: 5,
    goldMax: 10,
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
    goldMin: 10,
    goldMax: 18,
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
    goldMin: 12,
    goldMax: 20,
    autoDrops: [
      { tokenId: 22n, minQuantity: 1, maxQuantity: 2, chance: 0.2 }, // Coal Ore
    ],
    skinningDrops: [
      { tokenId: 63n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Light Leather
    ],
  },

  "Bandit Scout": {
    mobName: "Bandit Scout",
    goldMin: 15,
    goldMax: 25,
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
    goldMin: 8,
    goldMax: 14,
    autoDrops: [
      { tokenId: 31n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Meadow Lily (slime residue)
    ],
    skinningDrops: [], // Slimes can't be skinned
  },

  "Diseased Wolf": {
    mobName: "Diseased Wolf",
    goldMin: 10,
    goldMax: 16,
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
    goldMin: 20,
    goldMax: 35,
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
    goldMin: 18,
    goldMax: 30,
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
    goldMin: 25,
    goldMax: 40,
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
    goldMin: 30,
    goldMax: 50,
    autoDrops: [
      { tokenId: 35n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Lavender (corrupted wood)
    ],
    skinningDrops: [
      { tokenId: 69n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Thick Bone (wood)
    ],
  },

  "Dire Wolf": {
    mobName: "Dire Wolf",
    goldMin: 35,
    goldMax: 55,
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
    goldMin: 40,
    goldMax: 65,
    autoDrops: [
      { tokenId: 1n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Raw Meat
      { tokenId: 39n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Starbloom (shadow essence)
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 1, maxQuantity: 2, chance: 0.7 }, // Heavy Leather
      { tokenId: 71n, minQuantity: 1, maxQuantity: 1, chance: 0.4 }, // Shadow Pelt
      { tokenId: 69n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Thick Bone
    ],
  },

  "Dark Cultist": {
    mobName: "Dark Cultist",
    goldMin: 50,
    goldMax: 80,
    autoDrops: [
      { tokenId: 2n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Mana Potion
      { tokenId: 24n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Copper Ore
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Heavy Leather (robes)
    ],
  },

  "Undead Knight": {
    mobName: "Undead Knight",
    goldMin: 60,
    goldMax: 95,
    autoDrops: [
      { tokenId: 24n, minQuantity: 1, maxQuantity: 3, chance: 0.4 }, // Copper Ore
      { tokenId: 25n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Silver Ore
    ],
    skinningDrops: [
      { tokenId: 72n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Ancient Bone
      { tokenId: 70n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Heavy Leather (armor)
    ],
  },

  "Forest Troll": {
    mobName: "Forest Troll",
    goldMin: 70,
    goldMax: 110,
    autoDrops: [
      { tokenId: 1n, minQuantity: 4, maxQuantity: 6, chance: 0.7 }, // Raw Meat
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Heavy Leather
      { tokenId: 73n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Troll Hide
      { tokenId: 72n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Ancient Bone
    ],
  },

  "Ancient Golem": {
    mobName: "Ancient Golem",
    goldMin: 80,
    goldMax: 130,
    autoDrops: [
      { tokenId: 25n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Silver Ore
      { tokenId: 26n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Gold Ore
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 1, maxQuantity: 3, chance: 0.6 }, // Golem Core
      { tokenId: 72n, minQuantity: 5, maxQuantity: 8, chance: 0.8 }, // Ancient Bone (stone)
    ],
  },

  "Necromancer Valdris": {
    mobName: "Necromancer Valdris",
    goldMin: 150,
    goldMax: 250,
    autoDrops: [
      { tokenId: 2n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Mana Potion
      { tokenId: 26n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Gold Ore
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Dragon's Breath
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
 * Roll random gold amount from range
 */
export function rollGold(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
