export type OreType = "coal" | "tin" | "copper" | "silver" | "gold";

export interface OreProperties {
  label: string;
  rarity: "common" | "uncommon" | "rare" | "epic";
  maxCharges: number;
  tokenId: bigint;
  respawnTicks: number;
  requiredPickaxeTier: number; // Minimum pickaxe tier needed
}

export const ORE_CATALOG: Record<OreType, OreProperties> = {
  coal: {
    label: "Coal Deposit",
    rarity: "common",
    maxCharges: 3,
    tokenId: 22n,
    respawnTicks: 120,
    requiredPickaxeTier: 1,
  },
  tin: {
    label: "Tin Vein",
    rarity: "common",
    maxCharges: 3,
    tokenId: 23n,
    respawnTicks: 120,
    requiredPickaxeTier: 1,
  },
  copper: {
    label: "Copper Vein",
    rarity: "uncommon",
    maxCharges: 2,
    tokenId: 24n,
    respawnTicks: 180,
    requiredPickaxeTier: 2,
  },
  silver: {
    label: "Silver Vein",
    rarity: "rare",
    maxCharges: 2,
    tokenId: 25n,
    respawnTicks: 240,
    requiredPickaxeTier: 3,
  },
  gold: {
    label: "Gold Vein",
    rarity: "epic",
    maxCharges: 1,
    tokenId: 26n,
    respawnTicks: 300,
    requiredPickaxeTier: 4,
  },
};
