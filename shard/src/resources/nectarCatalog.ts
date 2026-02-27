/**
 * Nectar — naturally occurring liquids gathered from special nodes.
 * Raw ingredients for tonics, resistance elixirs, and advanced alchemy.
 */

export type NectarType =
  | "dew-nectar"
  | "suncrest-nectar"
  | "moonpetal-nectar"
  | "emberveil-nectar"
  | "gloomveil-nectar"
  | "stormwell-nectar";

export interface NectarProperties {
  label: string;
  rarity: "common" | "uncommon" | "rare" | "epic";
  maxCharges: number;
  tokenId: bigint;
  respawnTicks: number;
  /** Minimum sickle tier needed to gather (reuses herbalism tools). */
  requiredSickleTier: number;
}

export const NECTAR_CATALOG: Record<NectarType, NectarProperties> = {
  // Common (Tier 1)
  "dew-nectar": {
    label: "Dew Nectar Pool",
    rarity: "common",
    maxCharges: 3,
    tokenId: 150n,
    respawnTicks: 120,
    requiredSickleTier: 1,
  },
  // Uncommon (Tier 2)
  "suncrest-nectar": {
    label: "Suncrest Nectar Spring",
    rarity: "uncommon",
    maxCharges: 2,
    tokenId: 151n,
    respawnTicks: 180,
    requiredSickleTier: 2,
  },
  // Rare (Tier 3)
  "moonpetal-nectar": {
    label: "Moonpetal Nectar Bloom",
    rarity: "rare",
    maxCharges: 2,
    tokenId: 152n,
    respawnTicks: 250,
    requiredSickleTier: 3,
  },
  "emberveil-nectar": {
    label: "Emberveil Nectar Vent",
    rarity: "rare",
    maxCharges: 1,
    tokenId: 153n,
    respawnTicks: 280,
    requiredSickleTier: 3,
  },
  // Epic (Tier 4)
  "gloomveil-nectar": {
    label: "Gloomveil Nectar Hollow",
    rarity: "epic",
    maxCharges: 1,
    tokenId: 154n,
    respawnTicks: 320,
    requiredSickleTier: 4,
  },
  "stormwell-nectar": {
    label: "Stormwell Nectar Fissure",
    rarity: "epic",
    maxCharges: 1,
    tokenId: 155n,
    respawnTicks: 320,
    requiredSickleTier: 4,
  },
};
