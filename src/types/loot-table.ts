export interface LootEntry {
  itemId: string;
  weight: number;
  minQuantity: number;
  maxQuantity: number;
}

export interface LootTable {
  tableId: string;
  rolls: number;
  entries: LootEntry[];
}

export interface LootDrop {
  itemId: string;
  quantity: number;
}
