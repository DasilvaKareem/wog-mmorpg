export type ItemCategory = "weapon" | "armor" | "consumable" | "quest";
export type ItemRarity = "common" | "uncommon" | "rare" | "epic";

export interface ItemTemplate {
  itemId: string;
  name: string;
  category: ItemCategory;
  rarity: ItemRarity;
  stackable: boolean;
  maxStack: number;
  // Weapon stats
  damage?: number;
  // Consumable effects
  healAmount?: number;
  // Description for display
  description: string;
}

export interface InventorySlot {
  itemId: string;
  instanceId: string;
  quantity: number;
}

export interface PlayerInventory {
  ownerId: string;
  slots: InventorySlot[];
  maxSlots: number;
}
