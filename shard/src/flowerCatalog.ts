export type FlowerType =
  | "meadow-lily"
  | "wild-rose"
  | "dandelion"
  | "clover"
  | "lavender"
  | "sage"
  | "mint"
  | "moonflower"
  | "starbloom"
  | "dragons-breath";

export interface FlowerProperties {
  label: string;
  rarity: "common" | "uncommon" | "rare" | "epic";
  maxCharges: number;
  tokenId: bigint;
  respawnTicks: number;
  requiredSickleTier: number; // Minimum sickle tier needed
}

export const FLOWER_CATALOG: Record<FlowerType, FlowerProperties> = {
  // Common Flowers (Tier 1)
  "meadow-lily": {
    label: "Meadow Lily Patch",
    rarity: "common",
    maxCharges: 3,
    tokenId: 31n,
    respawnTicks: 100,
    requiredSickleTier: 1,
  },
  "wild-rose": {
    label: "Wild Rose Bush",
    rarity: "common",
    maxCharges: 3,
    tokenId: 32n,
    respawnTicks: 100,
    requiredSickleTier: 1,
  },
  dandelion: {
    label: "Dandelion Cluster",
    rarity: "common",
    maxCharges: 4,
    tokenId: 33n,
    respawnTicks: 80,
    requiredSickleTier: 1,
  },
  clover: {
    label: "Clover Field",
    rarity: "common",
    maxCharges: 4,
    tokenId: 34n,
    respawnTicks: 90,
    requiredSickleTier: 1,
  },

  // Uncommon Flowers (Tier 2)
  lavender: {
    label: "Lavender Grove",
    rarity: "uncommon",
    maxCharges: 2,
    tokenId: 35n,
    respawnTicks: 150,
    requiredSickleTier: 2,
  },
  sage: {
    label: "Sage Shrub",
    rarity: "uncommon",
    maxCharges: 2,
    tokenId: 36n,
    respawnTicks: 160,
    requiredSickleTier: 2,
  },
  mint: {
    label: "Wild Mint Patch",
    rarity: "uncommon",
    maxCharges: 3,
    tokenId: 37n,
    respawnTicks: 140,
    requiredSickleTier: 2,
  },

  // Rare Flowers (Tier 3)
  moonflower: {
    label: "Moonflower Bloom",
    rarity: "rare",
    maxCharges: 2,
    tokenId: 38n,
    respawnTicks: 220,
    requiredSickleTier: 3,
  },
  starbloom: {
    label: "Starbloom Blossom",
    rarity: "rare",
    maxCharges: 1,
    tokenId: 39n,
    respawnTicks: 240,
    requiredSickleTier: 3,
  },

  // Epic Flower (Tier 4)
  "dragons-breath": {
    label: "Dragon's Breath Flower",
    rarity: "epic",
    maxCharges: 1,
    tokenId: 40n,
    respawnTicks: 300,
    requiredSickleTier: 4,
  },
};
