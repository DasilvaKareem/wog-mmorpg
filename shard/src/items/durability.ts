// Equipment durability decay. Called on every landed hit (both attacker
// and defender). When a piece hits 0, it auto-unequips and is marked broken.
// On death, broken items are burned (handled by handlePlayerDeath).

import type { Entity } from "../world/zoneRuntime.js";
import { recalculateEntityVitals } from "../world/zoneRuntime.js";
import type { ArmorSlot, EquipmentSlot } from "./itemCatalog.js";
import { upsertItemInstanceFromEquipment } from "./itemRng.js";
import { saveCharacter } from "../character/characterStore.js";
import { logZoneEvent } from "../world/zoneEvents.js";

export const ARMOR_SLOTS: ArmorSlot[] = [
  "chest",
  "legs",
  "boots",
  "helm",
  "shoulders",
  "gloves",
  "belt",
  "shield",
  "cape",
  "ring",
  "amulet",
];

/** Slots that take durability damage on a landed hit. */
export const WEAPON_AND_ARMOR_SLOTS: EquipmentSlot[] = ["weapon", ...ARMOR_SLOTS];

export function applyDurabilityLoss(entity: Entity, slots: EquipmentSlot[]): void {
  if (!entity.equipment) return;

  let changed = false;
  const owner = entity.walletAddress;
  for (const slot of slots) {
    const equipped = entity.equipment[slot];
    if (!equipped || equipped.durability <= 0) continue;

    equipped.durability = Math.max(0, equipped.durability - 1);
    if (equipped.durability === 0) {
      equipped.broken = true;
      const brokenName = equipped.name ?? `tokenId ${equipped.tokenId}`;
      delete entity.equipment[slot];
      changed = true;
      console.log(`[durability] ${entity.name}'s ${brokenName} (${slot}) broke and was unequipped`);
      logZoneEvent({
        zoneId: entity.region ?? "unknown",
        type: "system",
        tick: 0,
        message: `${entity.name}'s ${brokenName} broke!`,
        entityId: entity.id,
        entityName: entity.name,
      });
    }
    if (
      owner &&
      (equipped.instanceId || equipped.enchantments?.length || equipped.quality || equipped.rolledStats || equipped.bonusAffix)
    ) {
      const persisted = upsertItemInstanceFromEquipment({
        instanceId: equipped.instanceId,
        walletAddress: owner,
        tokenId: equipped.tokenId,
        name: equipped.name,
        quality: equipped.quality,
        rolledStats: equipped.rolledStats,
        bonusAffix: equipped.bonusAffix,
        durability: equipped.durability,
        maxDurability: equipped.maxDurability,
        enchantments: equipped.enchantments,
      });
      equipped.instanceId = persisted.instanceId;
    }
    changed = true;
  }

  if (changed) {
    recalculateEntityVitals(entity);
    if (owner) {
      saveCharacter(owner, entity.name, { equipment: entity.equipment }).catch(() => {});
    }
  }
}
