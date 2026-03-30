import {
  getA2AEndpoint as getA2AEndpointFromBlockchain,
  getIdentityOwner as getIdentityOwnerFromBlockchain,
  registerIdentity as registerIdentityFromBlockchain,
  setA2AEndpoint as setA2AEndpointFromBlockchain,
  type IdentityRegistrationOptions,
  type IdentityRegistrationResult,
} from "../blockchain/blockchain.js";

export type {
  IdentityRegistrationOptions,
  IdentityRegistrationResult,
} from "../blockchain/blockchain.js";

export async function registerAgentIdentity(
  characterTokenId: bigint,
  ownerAddress: string,
  metadataURI: string,
  options?: IdentityRegistrationOptions
): Promise<IdentityRegistrationResult> {
  return registerIdentityFromBlockchain(characterTokenId, ownerAddress, metadataURI, options);
}

export async function getAgentEndpoint(agentId: bigint): Promise<string | null> {
  return getA2AEndpointFromBlockchain(agentId);
}

export async function setAgentEndpoint(agentId: bigint, endpointUrl: string): Promise<string | null> {
  return setA2AEndpointFromBlockchain(agentId, endpointUrl);
}

export async function getAgentOwnerWallet(agentId: bigint): Promise<string | null> {
  return getIdentityOwnerFromBlockchain(agentId);
}
