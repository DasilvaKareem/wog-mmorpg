import type { CharacterSavePatch } from "./characterStore.js";
import {
  getCharacterProjectionByAgentId,
  listCharacterProjectionsForTokenIds,
  type CharacterProjectionRecord,
} from "./characterProjectionStore.js";

function normalizeNumericId(value: string | bigint | null | undefined): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function normalizeChainRegistrationStatus(
  value: string | null | undefined,
): CharacterSavePatch["chainRegistrationStatus"] | null {
  switch (value) {
    case "unregistered":
    case "pending_mint":
    case "pending_mint_receipt":
    case "mint_confirmed":
    case "identity_pending":
    case "registered":
    case "failed_retryable":
    case "failed_permanent":
      return value;
    default:
      return null;
  }
}

function pickBestProjection(projections: CharacterProjectionRecord[]): CharacterProjectionRecord | null {
  if (projections.length === 0) return null;
  const rank = (projection: CharacterProjectionRecord): number => {
    const status = projection.chainRegistrationStatus ?? "";
    const hasAgent = /^\d+$/.test(projection.agentId?.trim() ?? "");
    if (status === "registered" && hasAgent) return 4;
    if (hasAgent) return 3;
    if (status === "registered") return 2;
    return 1;
  };

  return projections
    .slice()
    .sort((left, right) => {
      const rankDiff = rank(right) - rank(left);
      if (rankDiff !== 0) return rankDiff;
      return String(right.updatedAt).localeCompare(String(left.updatedAt));
    })[0] ?? null;
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
  let tokenId = normalizeNumericId(params.characterTokenId);
  let agentId = normalizeNumericId(params.agentId);
  let agentRegistrationTxHash = params.agentRegistrationTxHash ?? null;
  let chainRegistrationStatus: CharacterSavePatch["chainRegistrationStatus"] | null =
    params.chainRegistrationStatus ?? null;

  if (tokenId && !agentId) {
    const projection = pickBestProjection(await listCharacterProjectionsForTokenIds([tokenId]).catch(() => []));
    if (projection) {
      agentId = normalizeNumericId(projection.agentId);
      agentRegistrationTxHash = agentRegistrationTxHash ?? projection.agentRegistrationTxHash ?? null;
      chainRegistrationStatus = chainRegistrationStatus ?? normalizeChainRegistrationStatus(projection.chainRegistrationStatus);
    }
  } else if (agentId && !tokenId) {
    const projection = await getCharacterProjectionByAgentId(agentId).catch(() => null);
    if (projection) {
      tokenId = normalizeNumericId(projection.characterTokenId);
      agentRegistrationTxHash = agentRegistrationTxHash ?? projection.agentRegistrationTxHash ?? null;
      chainRegistrationStatus = chainRegistrationStatus ?? normalizeChainRegistrationStatus(projection.chainRegistrationStatus);
    }
  }

  if (!tokenId) return {};

  return {
    characterTokenId: tokenId,
    ...(agentId ? { agentId } : {}),
    ...(agentRegistrationTxHash ? { agentRegistrationTxHash } : {}),
    ...(chainRegistrationStatus ? { chainRegistrationStatus } : {}),
  };
}
