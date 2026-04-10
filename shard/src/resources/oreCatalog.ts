export type OreType = "stone" | "coal" | "tin" | "copper" | "silver" | "gold";

export interface OreProperties {
  label: string;
  rarity: "common" | "uncommon" | "rare" | "epic";
  maxCharges: number;
  tokenId: bigint;
  respawnTicks: number;
  requiredPickaxeTier: number; // Minimum pickaxe tier needed
  requiredSkillLevel: number; // Minimum mining skill level (1-300) needed
}

export const ORE_CATALOG: Record<OreType, OreProperties> = {
  stone: {
    label: "Stone Blocks",
    rarity: "common",
    maxCharges: 5,
    tokenId: 191n,
    respawnTicks: 80,
    requiredPickaxeTier: 1,
    requiredSkillLevel: 1,
  },
  coal: {
    label: "Coal Deposit",
    rarity: "common",
    maxCharges: 3,
    tokenId: 22n,
    respawnTicks: 120,
    requiredPickaxeTier: 1,
    requiredSkillLevel: 1,
  },
  tin: {
    label: "Tin Vein",
    rarity: "common",
    maxCharges: 3,
    tokenId: 23n,
    respawnTicks: 120,
    requiredPickaxeTier: 1,
    requiredSkillLevel: 10,
  },
  copper: {
    label: "Copper Vein",
    rarity: "uncommon",
    maxCharges: 2,
    tokenId: 24n,
    respawnTicks: 180,
    requiredPickaxeTier: 2,
    requiredSkillLevel: 25,
  },
  silver: {
    label: "Silver Vein",
    rarity: "rare",
    maxCharges: 2,
    tokenId: 25n,
    respawnTicks: 240,
    requiredPickaxeTier: 3,
    requiredSkillLevel: 50,
  },
  gold: {
    label: "Gold Vein",
    rarity: "epic",
    maxCharges: 1,
    tokenId: 26n,
    respawnTicks: 300,
    requiredPickaxeTier: 4,
    requiredSkillLevel: 75,
  },
};
