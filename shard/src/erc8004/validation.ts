import { ethers } from "ethers";
import { biteWallet } from "../blockchain/biteChain.js";
import { queueBiteTransaction } from "../blockchain/biteTxQueue.js";
import {
  executeRegisteredChainOperation,
  registerChainOperationProcessor,
  type ChainOperationRecord,
} from "../blockchain/chainOperationStore.js";
import { OFFICIAL_VALIDATION_REGISTRY_ABI } from "./official.js";
import { normalizeAgentId } from "./agentResolution.js";

const VALIDATION_REGISTRY_ADDRESS = process.env.VALIDATION_REGISTRY_ADDRESS;

const validationContract =
  VALIDATION_REGISTRY_ADDRESS && biteWallet
    ? new ethers.Contract(VALIDATION_REGISTRY_ADDRESS, OFFICIAL_VALIDATION_REGISTRY_ABI, biteWallet)
    : null;

export interface AgentValidation {
  requestHash: string;
  validator: string;
  claimType: string;
  response: number;
  lastUpdated: number;
  active: boolean;
}

function toIdentityId(agentId: string | bigint): bigint {
  return BigInt(normalizeAgentId(agentId));
}

export async function publishValidationClaim(
  agentId: string | bigint,
  claim: string
): Promise<string | null> {
  if (!validationContract || !biteWallet) return null;

  try {
    const validatorAddress = await biteWallet.getAddress();
    const requestHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "string", "address", "uint256"],
        [toIdentityId(agentId), claim, validatorAddress, BigInt(Date.now())]
      )
    );
    const requestURI = `wog://validation/request/${normalizeAgentId(agentId)}/${encodeURIComponent(claim)}`;
    const responseURI = `wog://validation/response/${normalizeAgentId(agentId)}/${encodeURIComponent(claim)}`;
    return await executeRegisteredChainOperation<string>("validation-claim", `${normalizeAgentId(agentId)}:${claim}`, {
      agentId: normalizeAgentId(agentId),
      claim,
      validatorAddress,
      requestHash,
      requestURI,
      responseURI,
    });
  } catch (err) {
    console.warn(`[erc8004.validation] publish claim failed for ${normalizeAgentId(agentId)} ${claim}:`, err);
    return null;
  }
}

registerChainOperationProcessor("validation-claim", async (record: ChainOperationRecord) => {
  const payload = JSON.parse(record.payload) as {
    agentId: string;
    claim: string;
    validatorAddress: string;
    requestHash: string;
    requestURI: string;
    responseURI: string;
  };
  await queueBiteTransaction(`validation-request:${payload.agentId}:${payload.claim}`, async () => {
    const tx = await validationContract!.validationRequest(
      payload.validatorAddress,
      toIdentityId(payload.agentId),
      payload.requestURI,
      payload.requestHash
    );
    return tx.wait();
  });

  const receipt = await queueBiteTransaction(`validation-response:${payload.agentId}:${payload.claim}`, async () => {
    const tx = await validationContract!.validationResponse(
      payload.requestHash,
      100,
      payload.responseURI,
      ethers.ZeroHash,
      payload.claim
    );
    return tx.wait();
  });

  return { result: receipt.hash, txHash: receipt.hash };
});

export async function getValidationClaims(agentId: string | bigint): Promise<AgentValidation[]> {
  if (!validationContract) return [];

  try {
    const requestHashes = await validationContract.getAgentValidations(toIdentityId(agentId));
    const statuses = await Promise.all(
      (requestHashes ?? []).map(async (requestHash: string) => {
        const status = await validationContract.getValidationStatus(requestHash);
        return {
          requestHash: String(requestHash),
          validator: String(status.validatorAddress),
          claimType: String(status.tag),
          response: Number(status.response),
          lastUpdated: Number(status.lastUpdate) * 1000,
          active: Number(status.response) >= 100,
        } satisfies AgentValidation;
      })
    );
    return statuses.filter((status) => status.claimType);
  } catch (err) {
    console.warn(`[erc8004.validation] get claims failed for ${normalizeAgentId(agentId)}:`, err);
    return [];
  }
}

export async function isValidationClaimActive(agentId: string | bigint, claim: string): Promise<boolean> {
  const claims = await getValidationClaims(agentId);
  return claims.some((entry) => entry.claimType === claim && entry.active);
}
