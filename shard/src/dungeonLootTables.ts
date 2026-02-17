/**
 * Dungeon Loot Tables — mob/boss drops for instanced dungeon encounters.
 *
 * Higher rank = rarer materials + more gold.
 * Merged into LOOT_TABLES at startup via registerDungeonLootTables().
 */

import type { MobLootTable } from "./lootTables.js";
import { registerDungeonLootTables } from "./lootTables.js";

export const DUNGEON_LOOT_TABLES: Record<string, MobLootTable> = {
  // =================== RANK E ===================
  "Dungeon Rat": {
    mobName: "Dungeon Rat",
    copperMin: 8,
    copperMax: 15,
    autoDrops: [
      { tokenId: 1n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Raw Meat
      { tokenId: 22n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Coal Ore
    ],
    skinningDrops: [
      { tokenId: 62n, minQuantity: 1, maxQuantity: 2, chance: 0.7 }, // Scrap Leather
    ],
  },
  "Dungeon Bat": {
    mobName: "Dungeon Bat",
    copperMin: 8,
    copperMax: 14,
    autoDrops: [
      { tokenId: 31n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Meadow Lily
    ],
    skinningDrops: [
      { tokenId: 62n, minQuantity: 1, maxQuantity: 1, chance: 0.5 }, // Scrap Leather
      { tokenId: 68n, minQuantity: 1, maxQuantity: 1, chance: 0.4 }, // Small Bone
    ],
  },
  "Dungeon Slime": {
    mobName: "Dungeon Slime",
    copperMin: 10,
    copperMax: 18,
    autoDrops: [
      { tokenId: 33n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Dandelion
      { tokenId: 22n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Coal Ore
    ],
    skinningDrops: [],
  },

  // =================== RANK D ===================
  "Dungeon Skeleton": {
    mobName: "Dungeon Skeleton",
    copperMin: 18,
    copperMax: 30,
    autoDrops: [
      { tokenId: 23n, minQuantity: 1, maxQuantity: 2, chance: 0.35 }, // Tin Ore
      { tokenId: 34n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Clover
    ],
    skinningDrops: [
      { tokenId: 68n, minQuantity: 2, maxQuantity: 3, chance: 0.7 }, // Small Bone
      { tokenId: 72n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Ancient Bone
    ],
  },
  "Dungeon Spider": {
    mobName: "Dungeon Spider",
    copperMin: 20,
    copperMax: 32,
    autoDrops: [
      { tokenId: 35n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Lavender
    ],
    skinningDrops: [
      { tokenId: 67n, minQuantity: 1, maxQuantity: 2, chance: 0.6 }, // Spider Silk
      { tokenId: 63n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Light Leather
    ],
  },
  "Dungeon Guardian D": {
    mobName: "Dungeon Guardian D",
    copperMin: 60,
    copperMax: 100,
    autoDrops: [
      { tokenId: 23n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Tin Ore
      { tokenId: 24n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Copper Ore
      { tokenId: 0n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Health Potion
      { tokenId: 116n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Rough Ruby
    ],
    skinningDrops: [
      { tokenId: 64n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Medium Leather
      { tokenId: 69n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Thick Bone
    ],
  },

  // =================== RANK C ===================
  "Dungeon Wraith": {
    mobName: "Dungeon Wraith",
    copperMin: 30,
    copperMax: 50,
    autoDrops: [
      { tokenId: 36n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Sage
      { tokenId: 24n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Copper Ore
      { tokenId: 117n, minQuantity: 1, maxQuantity: 1, chance: 0.08 }, // Rough Sapphire
    ],
    skinningDrops: [
      { tokenId: 71n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Shadow Pelt
    ],
  },
  "Dungeon Golem": {
    mobName: "Dungeon Golem",
    copperMin: 35,
    copperMax: 55,
    autoDrops: [
      { tokenId: 24n, minQuantity: 1, maxQuantity: 3, chance: 0.5 }, // Copper Ore
      { tokenId: 25n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Silver Ore
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Golem Core
      { tokenId: 69n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Thick Bone
    ],
  },
  "Dungeon Guardian C": {
    mobName: "Dungeon Guardian C",
    copperMin: 100,
    copperMax: 160,
    autoDrops: [
      { tokenId: 25n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Silver Ore
      { tokenId: 38n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Moonflower
      { tokenId: 0n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Health Potion
      { tokenId: 117n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Rough Sapphire
      { tokenId: 118n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Rough Emerald
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 2, maxQuantity: 3, chance: 0.7 }, // Heavy Leather
      { tokenId: 74n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Golem Core
    ],
  },

  // =================== RANK B ===================
  "Dungeon Reaver": {
    mobName: "Dungeon Reaver",
    copperMin: 50,
    copperMax: 80,
    autoDrops: [
      { tokenId: 25n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Silver Ore
      { tokenId: 39n, minQuantity: 1, maxQuantity: 1, chance: 0.25 }, // Starbloom
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.08 }, // Flawed Diamond
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 1, maxQuantity: 3, chance: 0.7 }, // Heavy Leather
      { tokenId: 72n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Ancient Bone
    ],
  },
  "Dungeon Necromancer": {
    mobName: "Dungeon Necromancer",
    copperMin: 55,
    copperMax: 90,
    autoDrops: [
      { tokenId: 80n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Mana Potion
      { tokenId: 39n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Starbloom
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 75n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Necromancer's Essence
    ],
  },
  "Dungeon Guardian B": {
    mobName: "Dungeon Guardian B",
    copperMin: 150,
    copperMax: 250,
    autoDrops: [
      { tokenId: 26n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Gold Ore
      { tokenId: 39n, minQuantity: 2, maxQuantity: 4, chance: 0.6 }, // Starbloom
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Dragon's Breath
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Flawed Diamond
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Shadow Opal
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.08 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 73n, minQuantity: 1, maxQuantity: 2, chance: 0.6 }, // Troll Hide
      { tokenId: 72n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Ancient Bone
    ],
  },

  // =================== RANK A ===================
  "Dungeon Abomination": {
    mobName: "Dungeon Abomination",
    copperMin: 80,
    copperMax: 130,
    autoDrops: [
      { tokenId: 26n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Gold Ore
      { tokenId: 40n, minQuantity: 1, maxQuantity: 1, chance: 0.25 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.1 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 73n, minQuantity: 1, maxQuantity: 2, chance: 0.6 }, // Troll Hide
      { tokenId: 70n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Heavy Leather
    ],
  },
  "Dungeon Lich": {
    mobName: "Dungeon Lich",
    copperMin: 90,
    copperMax: 140,
    autoDrops: [
      { tokenId: 80n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Mana Potion
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.35 }, // Dragon's Breath
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Shadow Opal
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.12 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 75n, minQuantity: 1, maxQuantity: 1, chance: 0.35 }, // Necromancer's Essence
    ],
  },
  "Dungeon Guardian A": {
    mobName: "Dungeon Guardian A",
    copperMin: 250,
    copperMax: 400,
    autoDrops: [
      { tokenId: 26n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Gold Ore
      { tokenId: 40n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 2, chance: 0.25 }, // Arcane Crystal
      { tokenId: 119n, minQuantity: 1, maxQuantity: 2, chance: 0.25 }, // Flawed Diamond
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Golem Core
      { tokenId: 73n, minQuantity: 2, maxQuantity: 3, chance: 0.6 }, // Troll Hide
      { tokenId: 75n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Necromancer's Essence
    ],
  },

  // =================== RANK S ===================
  "Dungeon Void Walker": {
    mobName: "Dungeon Void Walker",
    copperMin: 120,
    copperMax: 200,
    autoDrops: [
      { tokenId: 26n, minQuantity: 2, maxQuantity: 3, chance: 0.5 }, // Gold Ore
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.4 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Arcane Crystal
      { tokenId: 120n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 71n, minQuantity: 2, maxQuantity: 3, chance: 0.7 }, // Shadow Pelt
      { tokenId: 75n, minQuantity: 1, maxQuantity: 1, chance: 0.3 }, // Necromancer's Essence
    ],
  },
  "Dungeon Dread Knight": {
    mobName: "Dungeon Dread Knight",
    copperMin: 130,
    copperMax: 210,
    autoDrops: [
      { tokenId: 26n, minQuantity: 2, maxQuantity: 4, chance: 0.5 }, // Gold Ore
      { tokenId: 40n, minQuantity: 1, maxQuantity: 2, chance: 0.35 }, // Dragon's Breath
      { tokenId: 119n, minQuantity: 1, maxQuantity: 1, chance: 0.2 }, // Flawed Diamond
      { tokenId: 121n, minQuantity: 1, maxQuantity: 1, chance: 0.15 }, // Arcane Crystal
    ],
    skinningDrops: [
      { tokenId: 70n, minQuantity: 3, maxQuantity: 5, chance: 0.8 }, // Heavy Leather
      { tokenId: 72n, minQuantity: 3, maxQuantity: 5, chance: 0.7 }, // Ancient Bone
    ],
  },
  "Dungeon Guardian S": {
    mobName: "Dungeon Guardian S",
    copperMin: 400,
    copperMax: 650,
    autoDrops: [
      { tokenId: 26n, minQuantity: 5, maxQuantity: 8, chance: 0.8 }, // Gold Ore
      { tokenId: 40n, minQuantity: 3, maxQuantity: 5, chance: 0.6 }, // Dragon's Breath
      { tokenId: 121n, minQuantity: 2, maxQuantity: 3, chance: 0.4 }, // Arcane Crystal
      { tokenId: 119n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Flawed Diamond
      { tokenId: 120n, minQuantity: 1, maxQuantity: 2, chance: 0.3 }, // Shadow Opal
    ],
    skinningDrops: [
      { tokenId: 74n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Golem Core
      { tokenId: 75n, minQuantity: 1, maxQuantity: 2, chance: 0.5 }, // Necromancer's Essence
      { tokenId: 73n, minQuantity: 2, maxQuantity: 4, chance: 0.7 }, // Troll Hide
    ],
  },
};

/** Register dungeon loot tables at startup. */
export function initDungeonLootTables(): void {
  registerDungeonLootTables(DUNGEON_LOOT_TABLES);
}
