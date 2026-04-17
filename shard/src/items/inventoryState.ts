import { loadAllCharactersForWallet } from "../character/characterStore.js";
import { getAllEntities } from "../world/zoneRuntime.js";
import { listEquipmentStateForWallet } from "../db/equipmentStateStore.js";

function normalizeCharacterName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

function incrementEquippedCounts(
  equipment: Record<string, unknown> | undefined,
  counts: Map<number, number>
): void {
  for (const equipped of Object.values(equipment ?? {})) {
    const tokenId = Number((equipped as { tokenId?: number | string })?.tokenId);
    if (!Number.isFinite(tokenId)) continue;
    counts.set(tokenId, (counts.get(tokenId) ?? 0) + 1);
  }
}

function collectEquippedInstanceIds(
  equipment: Record<string, unknown> | undefined,
  ids: Set<string>
): void {
  for (const equipped of Object.values(equipment ?? {})) {
    const instanceId = String((equipped as { instanceId?: string })?.instanceId ?? "").trim();
    if (instanceId) ids.add(instanceId);
  }
}

export async function getEquippedItemCounts(walletAddress: string): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const lowerWallet = walletAddress.toLowerCase();
  const liveCharacterNames = new Set<string>();

  for (const entity of getAllEntities().values()) {
    if (entity.type !== "player") continue;
    if (entity.walletAddress?.toLowerCase() !== lowerWallet) continue;
    liveCharacterNames.add(normalizeCharacterName(entity.name));
    incrementEquippedCounts(entity.equipment as Record<string, unknown> | undefined, counts);
  }

  const savedCharacters = await loadAllCharactersForWallet(walletAddress);
  const projectedEquipment = await listEquipmentStateForWallet(walletAddress).catch(() => []);
  if (projectedEquipment.length > 0) {
    const grouped = new Map<string, Record<string, unknown>>();
    for (const record of projectedEquipment) {
      if (!grouped.has(record.normalizedName)) grouped.set(record.normalizedName, {});
      grouped.get(record.normalizedName)![record.slotId] = record.itemState;
    }
    for (const [normalizedName, equipment] of grouped) {
      if (liveCharacterNames.has(normalizedName)) continue;
      incrementEquippedCounts(equipment, counts);
    }
    return counts;
  }

  for (const saved of savedCharacters) {
    if (liveCharacterNames.has(normalizeCharacterName(saved.name))) continue;
    incrementEquippedCounts(saved.equipment, counts);
  }

  return counts;
}

export async function getEquippedInstanceIds(walletAddress: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const lowerWallet = walletAddress.toLowerCase();
  const liveCharacterNames = new Set<string>();

  for (const entity of getAllEntities().values()) {
    if (entity.type !== "player") continue;
    if (entity.walletAddress?.toLowerCase() !== lowerWallet) continue;
    liveCharacterNames.add(normalizeCharacterName(entity.name));
    collectEquippedInstanceIds(entity.equipment as Record<string, unknown> | undefined, ids);
  }

  const savedCharacters = await loadAllCharactersForWallet(walletAddress);
  const projectedEquipment = await listEquipmentStateForWallet(walletAddress).catch(() => []);
  if (projectedEquipment.length > 0) {
    const grouped = new Map<string, Record<string, unknown>>();
    for (const record of projectedEquipment) {
      if (!grouped.has(record.normalizedName)) grouped.set(record.normalizedName, {});
      grouped.get(record.normalizedName)![record.slotId] = record.itemState;
    }
    for (const [normalizedName, equipment] of grouped) {
      if (liveCharacterNames.has(normalizedName)) continue;
      collectEquippedInstanceIds(equipment, ids);
    }
    return ids;
  }

  for (const saved of savedCharacters) {
    if (liveCharacterNames.has(normalizeCharacterName(saved.name))) continue;
    collectEquippedInstanceIds(saved.equipment, ids);
  }

  return ids;
}

export function getRecyclableQuantity(
  ownedQuantity: number,
  equippedCount: number,
): number {
  return Math.max(0, ownedQuantity - Math.max(0, equippedCount));
}
