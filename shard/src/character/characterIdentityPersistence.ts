import { findIdentityByCharacterTokenId } from "../blockchain/blockchain.js";
import type { CharacterSavePatch } from "./characterStore.js";

function normalizeNumericId(value: string | bigint | null | undefined): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

export async function buildVerifiedIdentityPatch(
  walletAddress: string,
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

  const found = await findIdentityByCharacterTokenId(BigInt(tokenId), walletAddress).catch(() => null);
  if (found?.agentId?.toString() !== agentId) {
    return {
      characterTokenId: tokenId,
      agentId: null,
      agentRegistrationTxHash: null,
      ...(params.chainRegistrationStatus === "registered"
        ? { chainRegistrationStatus: "mint_confirmed" }
        : {}),
    };
  }

  return {
    characterTokenId: tokenId,
    agentId,
    ...(params.agentRegistrationTxHash ? { agentRegistrationTxHash: params.agentRegistrationTxHash } : {}),
    ...(params.chainRegistrationStatus ? { chainRegistrationStatus: params.chainRegistrationStatus } : {}),
  };
}
