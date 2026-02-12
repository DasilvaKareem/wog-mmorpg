export type OreType = "coal" | "tin" | "copper" | "silver" | "gold";
export type OreRarity = "common" | "uncommon" | "rare" | "epic";

export interface OreProperties {
  label: string;
  rarity: OreRarity;
  maxCharges: number;
  itemId: string;
}

export const ORE_CATALOG: Record<OreType, OreProperties> = {
  coal:   { label: "Coal Deposit",   rarity: "common",   maxCharges: 3, itemId: "coal-ore" },
  tin:    { label: "Tin Vein",       rarity: "common",   maxCharges: 3, itemId: "tin-ore" },
  copper: { label: "Copper Vein",    rarity: "uncommon", maxCharges: 2, itemId: "copper-ore" },
  silver: { label: "Silver Vein",    rarity: "rare",     maxCharges: 2, itemId: "silver-ore" },
  gold:   { label: "Gold Vein",      rarity: "epic",     maxCharges: 1, itemId: "gold-ore" },
};

/** Runtime state of an ore deposit on the terrain grid */
export interface OreDeposit {
  oreType: OreType;
  charges: number;
  maxCharges: number;
  /** Tick when this node was depleted, or null if still active */
  depletedAtTick: number | null;
}

/** Serialized ore deposit data for .ores.json files */
export interface OreDepositData {
  oreType: OreType;
  tx: number;
  tz: number;
}

/** Info returned by API queries */
export interface OreDepositInfo {
  tx: number;
  tz: number;
  oreType: OreType;
  label: string;
  rarity: OreRarity;
  charges: number;
  maxCharges: number;
  depleted: boolean;
}

/** Per-zone spawn weights — percentage of rock tiles that become ore deposits */
export const ZONE_ORE_TABLES: Record<string, Partial<Record<OreType, number>>> = {
  "village-square": {},
  "wild-meadow": {
    coal: 0.03,
    tin: 0.02,
    copper: 0.01,
  },
  "dark-forest": {
    coal: 0.02,
    tin: 0.01,
    copper: 0.02,
    silver: 0.015,
    gold: 0.005,
  },
};

export const ORE_RESPAWN_TICKS = 120;
