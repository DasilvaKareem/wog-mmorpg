import type { CharacterSavePatch } from "./characterStore.js";

function normalizeNumericId(value: string | bigint | null | undefined): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

export async function buildVerifiedIdentityPatch(
  _walletAddress: string,
  params: {
    characterTokenId?: string | bigint | null;
    agentId?: string | bigint | null;
    agentRegistrationTxHash?: string | null;
    chainRegistrationStatus?: CharacterSavePatch["chainRegistrationStatus"];
  }
): Promise<CharacterSavePatch> {
  const tokenId = normalizeNumericId(params.characterTokenId);
  const agentId = normalizeNumericId(params.agentId);

  if (!tokenId) {
    return {};
  }

  const patch: CharacterSavePatch = {
    characterTokenId: tokenId,
  };

  if (!agentId) {
    return patch;
  }

  return {
    characterTokenId: tokenId,
    agentId,
    ...(params.agentRegistrationTxHash ? { agentRegistrationTxHash: params.agentRegistrationTxHash } : {}),
    ...(params.chainRegistrationStatus ? { chainRegistrationStatus: params.chainRegistrationStatus } : {}),
  };
}
