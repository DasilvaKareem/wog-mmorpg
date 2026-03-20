import { loadAllCharactersForWallet } from "../character/characterStore.js";
import { getAllEntities, type Entity } from "../world/zoneRuntime.js";

export function normalizeAgentId(agentId: string | bigint): string {
  return typeof agentId === "bigint" ? agentId.toString() : agentId.trim();
}

export function getEntityAgentId(entity: Pick<Entity, "agentId"> | null | undefined): string | null {
  if (!entity?.agentId) return null;
  return normalizeAgentId(entity.agentId);
}

export function resolveLiveAgentIdForWallet(walletAddress: string): string | null {
  const wallet = walletAddress.toLowerCase();
  const matches = new Set<string>();

  for (const entity of getAllEntities().values()) {
    if (entity.type !== "player") continue;
    if (entity.walletAddress?.toLowerCase() !== wallet) continue;
    if (entity.agentId == null) continue;
    matches.add(entity.agentId.toString());
  }

  if (matches.size !== 1) return null;
  return Array.from(matches)[0] ?? null;
}

export async function resolveAgentIdForWallet(walletAddress: string): Promise<string | null> {
  const liveAgentId = resolveLiveAgentIdForWallet(walletAddress);
  if (liveAgentId) return liveAgentId;

  const characters = await loadAllCharactersForWallet(walletAddress);
  const agentIds = new Set(
    characters
      .map((character) => character.agentId?.trim())
      .filter((agentId): agentId is string => Boolean(agentId))
  );

  if (agentIds.size !== 1) return null;
  return Array.from(agentIds)[0] ?? null;
}

export async function requireAgentIdForWallet(walletAddress: string, context: string): Promise<string> {
  const agentId = await resolveAgentIdForWallet(walletAddress);
  if (!agentId) {
    throw new Error(`[erc8004] Missing agentId for wallet ${walletAddress} during ${context}`);
  }
  return agentId;
}

export async function resolvePreferredAgentIdForWallet(walletAddress: string): Promise<string | null> {
  const liveAgentId = resolveLiveAgentIdForWallet(walletAddress);
  if (liveAgentId) return liveAgentId;

  const characters = (await loadAllCharactersForWallet(walletAddress))
    .filter((character): character is typeof character & { agentId: string } => Boolean(character.agentId?.trim()));

  if (characters.length === 0) return null;

  characters.sort((left, right) => {
    if (left.level !== right.level) return right.level - left.level;
    if (left.xp !== right.xp) return right.xp - left.xp;
    return left.name.localeCompare(right.name);
  });

  return characters[0]?.agentId?.trim() ?? null;
}
