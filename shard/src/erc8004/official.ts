export type Erc8004RegistryAddresses = {
  identity: string;
  reputation?: string | null;
  validation?: string | null;
};

const OFFICIAL_TESTNET_IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const OFFICIAL_MAINNET_IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const OFFICIAL_TESTNET_REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const OFFICIAL_MAINNET_REPUTATION = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

export const LOCAL_HARDHAT_CHAIN_ID = 31337;
export const SKALE_BASE_MAINNET_CHAIN_ID = 1187947933;
export const SKALE_BASE_SEPOLIA_CHAIN_ID = 324705682;

const SUPPORTED_TESTNET_CHAIN_IDS = new Set<number>([SKALE_BASE_SEPOLIA_CHAIN_ID]);
const SUPPORTED_MAINNET_CHAIN_IDS = new Set<number>([SKALE_BASE_MAINNET_CHAIN_ID]);

export const OFFICIAL_IDENTITY_REGISTRY_ABI = [
  "function register() returns (uint256 agentId)",
  "function register(string agentURI) returns (uint256 agentId)",
  "function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "function unsetAgentWallet(uint256 agentId)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function isAuthorizedOrOwner(address spender, uint256 agentId) view returns (bool)",
  "function getVersion() view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)",
  "event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)",
] as const;

export const OFFICIAL_REPUTATION_REGISTRY_ABI = [
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function revokeFeedback(uint256 agentId, uint64 feedbackIndex)",
  "function appendResponse(uint256 agentId, address clientAddress, uint64 feedbackIndex, string responseURI, bytes32 responseHash)",
  "function getIdentityRegistry() view returns (address)",
  "function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)",
  "function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
  "function getResponseCount(uint256 agentId, address clientAddress, uint64 feedbackIndex, address[] responders) view returns (uint64 count)",
  "function getClients(uint256 agentId) view returns (address[])",
  "function getVersion() view returns (string)",
] as const;

export const OFFICIAL_VALIDATION_REGISTRY_ABI = [
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "function getIdentityRegistry() view returns (address)",
  "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
  "function getSummary(uint256 agentId, address[] validatorAddresses, string tag) view returns (uint64 count, uint8 avgResponse)",
  "function getAgentValidations(uint256 agentId) view returns (bytes32[] requestHashes)",
  "function getValidatorRequests(address validatorAddress) view returns (bytes32[] requestHashes)",
  "function getVersion() view returns (string)",
] as const;

export function getOfficialErc8004Addresses(
  chainId: number | null | undefined
): Erc8004RegistryAddresses | null {
  if (!chainId || Number.isNaN(chainId) || chainId <= 0 || chainId === LOCAL_HARDHAT_CHAIN_ID) {
    return null;
  }

  if (SUPPORTED_TESTNET_CHAIN_IDS.has(chainId)) {
    return {
      identity: OFFICIAL_TESTNET_IDENTITY,
      reputation: OFFICIAL_TESTNET_REPUTATION,
      validation: null,
    };
  }

  if (SUPPORTED_MAINNET_CHAIN_IDS.has(chainId)) {
    return {
      identity: OFFICIAL_MAINNET_IDENTITY,
      reputation: OFFICIAL_MAINNET_REPUTATION,
      validation: null,
    };
  }

  return null;
}

export function getErc8004ChainName(chainId: number): string {
  if (chainId === LOCAL_HARDHAT_CHAIN_ID) return "hardhat-local";
  if (chainId === SKALE_BASE_MAINNET_CHAIN_ID) return "skale-base";
  if (chainId === SKALE_BASE_SEPOLIA_CHAIN_ID) return "skale-base-sepolia";
  return `chain-${chainId}`;
}
