/**
 * Shared types for the SKALE Base ↔ Coinbase Base NFT bridge.
 *
 * The EIP-712 BridgeClaim struct defined here MUST stay byte-identical to the
 * Solidity definitions in:
 *   - hardhat/contracts/WoGCharacterBase.sol (Base side)
 *   - hardhat/contracts/WoGBridgeAdapter.sol (SKALE side)
 *
 * Any field reordering, type change, or rename will break signature verification.
 */

export const BRIDGE_DOMAIN_NAME = "WoGBridge";
export const BRIDGE_DOMAIN_VERSION = "1";

/** Sentinel value for destinationTokenId on a fresh-mint (Base-origin) claim. */
export const FRESH_MINT_SENTINEL = (1n << 256n) - 1n;

export type BridgeDirection = "skale-to-base" | "base-to-skale";

export type BridgeStatus =
  | "pending_burn"
  | "burn_confirmed"
  | "claim_signed"
  | "redeemed"
  | "expired"
  | "refunded";

export interface BridgeClaim {
  sourceTokenId: bigint;
  destinationTokenId: bigint;
  recipient: `0x${string}`;
  sourceChainId: bigint;
  destinationChainId: bigint;
  metadataURI: string;
  nonce: `0x${string}`;
  expiresAt: bigint;
}

export interface SignedBridgeClaim {
  claim: BridgeClaim;
  signature: `0x${string}`;
  digest: `0x${string}`;
  /** The contract address that signed the EIP-712 domain (destination chain bridge contract). */
  verifyingContract: `0x${string}`;
}

export interface BridgeRecord {
  bridgeId: string;                       // uuid
  direction: BridgeDirection;
  walletAddress: string;                  // owner wallet (auth subject), lowercased
  custodialFlow: boolean;                 // true if the server is signing the burn tx
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenId: string;
  destinationTokenId: string | null;      // null until known; set on claim sign for round-trip
  recipientAddress: string;
  status: BridgeStatus;
  burnTxHash: string | null;
  redeemTxHash: string | null;
  metadataURI: string | null;
  claimNonce: string | null;              // hex 0x-prefixed
  claimDigest: string | null;             // hex 0x-prefixed
  claimSignature: string | null;          // hex 0x-prefixed
  claimExpiresAt: number | null;          // unix ms
  characterName: string | null;
  characterClassId: string | null;
  lastError: string | null;
  createdAt: number;                      // unix ms
  updatedAt: number;                      // unix ms
}

/** Type the EIP-712 signer/verifier expects to encode this struct. */
export const BRIDGE_CLAIM_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  BridgeClaim: [
    { name: "sourceTokenId", type: "uint256" },
    { name: "destinationTokenId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "sourceChainId", type: "uint64" },
    { name: "destinationChainId", type: "uint64" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
};
