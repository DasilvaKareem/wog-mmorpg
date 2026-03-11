import { loadAllCharactersForWallet } from "../character/characterStore.js";
import { getAllEntities } from "../world/zoneRuntime.js";

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
  for (const saved of savedCharacters) {
    if (liveCharacterNames.has(normalizeCharacterName(saved.name))) continue;
    incrementEquippedCounts(saved.equipment, counts);
  }

  return counts;
}

export function getRecyclableQuantity(
  ownedQuantity: number,
  equippedCount: number,
): number {
  return Math.max(0, ownedQuantity - Math.max(0, equippedCount));
}
