import type { ItemTemplate } from "../types/item.js";
import type { LootTable, LootDrop } from "../types/loot-table.js";

export class LootRoller {
  private tables: Map<string, LootTable>;
  private items: Map<string, ItemTemplate>;

  constructor(tables: Map<string, LootTable>, items: Map<string, ItemTemplate>) {
    this.tables = tables;
    this.items = items;
  }

  roll(tableId: string): LootDrop[] {
    const table = this.tables.get(tableId);
    if (!table) return [];

    const drops: LootDrop[] = [];

    for (let r = 0; r < table.rolls; r++) {
      const entry = this.weightedPick(table);
      if (!entry) continue;

      // Validate item exists
      if (!this.items.has(entry.itemId)) continue;

      const quantity = entry.minQuantity + Math.floor(
        Math.random() * (entry.maxQuantity - entry.minQuantity + 1),
      );

      // Merge with existing drop of same item
      const existing = drops.find((d) => d.itemId === entry.itemId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        drops.push({ itemId: entry.itemId, quantity });
      }
    }

    return drops;
  }

  private weightedPick(table: LootTable) {
    const totalWeight = table.entries.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const entry of table.entries) {
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }

    return table.entries[table.entries.length - 1];
  }

  hasTable(tableId: string): boolean {
    return this.tables.has(tableId);
  }
}
