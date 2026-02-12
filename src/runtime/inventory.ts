import { randomUUID } from "node:crypto";
import type { ItemTemplate, InventorySlot, PlayerInventory } from "../types/item.js";
import type { LootDrop } from "../types/loot-table.js";

const DEFAULT_MAX_SLOTS = 20;

export class InventoryManager {
  private inventories: Map<string, PlayerInventory> = new Map();
  private items: Map<string, ItemTemplate>;

  constructor(items: Map<string, ItemTemplate>) {
    this.items = items;
  }

  /** Get or create inventory for an owner */
  getInventory(ownerId: string): PlayerInventory {
    let inv = this.inventories.get(ownerId);
    if (!inv) {
      inv = { ownerId, slots: [], maxSlots: DEFAULT_MAX_SLOTS };
      this.inventories.set(ownerId, inv);
    }
    return inv;
  }

  /** Add loot drops to an owner's inventory. Returns what was actually added. */
  addDrops(ownerId: string, drops: LootDrop[]): LootDrop[] {
    const added: LootDrop[] = [];

    for (const drop of drops) {
      const template = this.items.get(drop.itemId);
      if (!template) continue;

      const qty = this.addItem(ownerId, template, drop.quantity);
      if (qty > 0) {
        added.push({ itemId: drop.itemId, quantity: qty });
      }
    }

    return added;
  }

  /** Add quantity of an item. Returns how many were actually added. */
  private addItem(ownerId: string, template: ItemTemplate, quantity: number): number {
    const inv = this.getInventory(ownerId);
    let remaining = quantity;

    if (template.stackable) {
      // Try to fill existing stacks first
      for (const slot of inv.slots) {
        if (slot.itemId === template.itemId && slot.quantity < template.maxStack) {
          const space = template.maxStack - slot.quantity;
          const toAdd = Math.min(remaining, space);
          slot.quantity += toAdd;
          remaining -= toAdd;
          if (remaining <= 0) break;
        }
      }

      // Create new stacks for remainder
      while (remaining > 0 && inv.slots.length < inv.maxSlots) {
        const toAdd = Math.min(remaining, template.maxStack);
        inv.slots.push({
          itemId: template.itemId,
          instanceId: randomUUID(),
          quantity: toAdd,
        });
        remaining -= toAdd;
      }
    } else {
      // Non-stackable: each unit gets its own slot
      while (remaining > 0 && inv.slots.length < inv.maxSlots) {
        inv.slots.push({
          itemId: template.itemId,
          instanceId: randomUUID(),
          quantity: 1,
        });
        remaining--;
      }
    }

    return quantity - remaining;
  }

  /** Remove an item by instanceId. Returns true if removed. */
  removeByInstanceId(ownerId: string, instanceId: string): boolean {
    const inv = this.inventories.get(ownerId);
    if (!inv) return false;

    const idx = inv.slots.findIndex((s) => s.instanceId === instanceId);
    if (idx === -1) return false;

    inv.slots.splice(idx, 1);
    return true;
  }

  /** Remove quantity of a stackable item by itemId. Returns how many were removed. */
  removeByItemId(ownerId: string, itemId: string, quantity: number): number {
    const inv = this.inventories.get(ownerId);
    if (!inv) return 0;

    let remaining = quantity;

    for (let i = inv.slots.length - 1; i >= 0 && remaining > 0; i--) {
      const slot = inv.slots[i];
      if (slot.itemId !== itemId) continue;

      const toRemove = Math.min(remaining, slot.quantity);
      slot.quantity -= toRemove;
      remaining -= toRemove;

      if (slot.quantity <= 0) {
        inv.slots.splice(i, 1);
      }
    }

    return quantity - remaining;
  }
}
