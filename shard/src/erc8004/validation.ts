import { ethers } from "ethers";
import { biteWallet } from "../blockchain/biteChain.js";
import { normalizeAgentId } from "./agentResolution.js";

const VALIDATION_REGISTRY_ADDRESS = process.env.VALIDATION_REGISTRY_ADDRESS;

const VALIDATION_ABI = [
  "function verifyCapability(uint256 agentId, string claim, uint256 expiry) external",
  "function getVerifications(uint256 agentId) view returns (tuple(address verifier, string claim, uint256 validUntil)[])",
  "function isVerified(uint256 agentId, string claim) view returns (bool)",
];

const validationContract =
  VALIDATION_REGISTRY_ADDRESS && biteWallet
    ? new ethers.Contract(VALIDATION_REGISTRY_ADDRESS, VALIDATION_ABI, biteWallet)
    : null;

export interface AgentValidation {
  verifier: string;
  claim: string;
  validUntil: number;
}

function toIdentityId(agentId: string | bigint): bigint {
  return BigInt(normalizeAgentId(agentId));
}

export async function publishValidationClaim(
  agentId: string | bigint,
  claim: string,
  validUntil: number
): Promise<string | null> {
  if (!validationContract) return null;
  try {
    const tx = await validationContract.verifyCapability(toIdentityId(agentId), claim, BigInt(validUntil));
    const receipt = await tx.wait();
    return receipt.hash;
  } catch (err) {
    console.warn(`[erc8004.validation] publish claim failed for ${normalizeAgentId(agentId)} ${claim}:`, err);
    return null;
  }
}

export async function getValidationClaims(agentId: string | bigint): Promise<AgentValidation[]> {
  if (!validationContract) return [];
  try {
    const claims = await validationContract.getVerifications(toIdentityId(agentId));
    return (claims ?? []).map((claim: any) => ({
      verifier: String(claim.verifier),
      claim: String(claim.claim),
      validUntil: Number(claim.validUntil),
    }));
  } catch (err) {
    console.warn(`[erc8004.validation] get claims failed for ${normalizeAgentId(agentId)}:`, err);
    return [];
  }
}

export async function isValidationClaimActive(agentId: string | bigint, claim: string): Promise<boolean> {
  if (!validationContract) return false;
  try {
    return Boolean(await validationContract.isVerified(toIdentityId(agentId), claim));
  } catch {
    return false;
  }
}
