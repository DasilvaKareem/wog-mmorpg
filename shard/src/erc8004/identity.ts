import {
  getA2AEndpoint as getA2AEndpointFromBlockchain,
  getAgentWallet as getAgentWalletFromBlockchain,
  registerIdentity as registerIdentityFromBlockchain,
  setA2AEndpoint as setA2AEndpointFromBlockchain,
  type IdentityRegistrationResult,
} from "../blockchain/blockchain.js";

export type { IdentityRegistrationResult } from "../blockchain/blockchain.js";

export async function registerAgentIdentity(
  characterTokenId: bigint,
  ownerAddress: string,
  metadataURI: string
): Promise<IdentityRegistrationResult> {
  return registerIdentityFromBlockchain(characterTokenId, ownerAddress, metadataURI);
}

export async function getAgentEndpoint(agentId: bigint): Promise<string | null> {
  return getA2AEndpointFromBlockchain(agentId);
}

export async function setAgentEndpoint(agentId: bigint, endpointUrl: string): Promise<string | null> {
  return setA2AEndpointFromBlockchain(agentId, endpointUrl);
}

export async function getAgentOwnerWallet(agentId: bigint): Promise<string | null> {
  return getAgentWalletFromBlockchain(agentId);
}
