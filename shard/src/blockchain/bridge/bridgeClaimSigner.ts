import { Wallet, TypedDataEncoder, getBytes, keccak256, AbiCoder } from "ethers";
import type { TypedDataDomain } from "ethers";
import {
  BRIDGE_CLAIM_TYPES,
  BRIDGE_DOMAIN_NAME,
  BRIDGE_DOMAIN_VERSION,
  type BridgeClaim,
  type SignedBridgeClaim,
} from "./types.js";

/**
 * Signs EIP-712 BridgeClaim payloads using SERVER_PRIVATE_KEY.
 *
 * The signing address must equal the `bridgeSigner` configured on both
 * WoGCharacterBase (Base) and WoGBridgeAdapter (SKALE). Rotation is done
 * via setBridgeSigner(newAddress) on the contracts; this module reads the
 * key fresh from env so process restart picks up rotations.
 */

let cachedWallet: Wallet | null = null;

function getSignerWallet(): Wallet {
  if (cachedWallet) return cachedWallet;
  const key = process.env.SERVER_PRIVATE_KEY;
  if (!key) throw new Error("SERVER_PRIVATE_KEY not set; cannot sign bridge claims");
  cachedWallet = new Wallet(key);
  return cachedWallet;
}

/** Address that the contracts must trust as bridgeSigner. */
export function getBridgeSignerAddress(): string {
  return getSignerWallet().address;
}

function buildDomain(
  destinationChainId: bigint,
  verifyingContract: `0x${string}`,
): TypedDataDomain {
  return {
    name: BRIDGE_DOMAIN_NAME,
    version: BRIDGE_DOMAIN_VERSION,
    chainId: destinationChainId,
    verifyingContract,
  };
}

function toClaimValue(claim: BridgeClaim): Record<string, unknown> {
  return {
    sourceTokenId: claim.sourceTokenId,
    destinationTokenId: claim.destinationTokenId,
    recipient: claim.recipient,
    sourceChainId: claim.sourceChainId,
    destinationChainId: claim.destinationChainId,
    metadataURI: claim.metadataURI,
    nonce: claim.nonce,
    expiresAt: claim.expiresAt,
  };
}

/**
 * Compute the EIP-712 typed-data digest the destination contract will check.
 * Useful for storage (replay-protection in the DB) and for tests.
 */
export function computeClaimDigest(
  claim: BridgeClaim,
  verifyingContract: `0x${string}`,
): `0x${string}` {
  const domain = buildDomain(claim.destinationChainId, verifyingContract);
  return TypedDataEncoder.hash(domain, BRIDGE_CLAIM_TYPES, toClaimValue(claim)) as `0x${string}`;
}

export async function signBridgeClaim(
  claim: BridgeClaim,
  verifyingContract: `0x${string}`,
): Promise<SignedBridgeClaim> {
  const wallet = getSignerWallet();
  const domain = buildDomain(claim.destinationChainId, verifyingContract);
  const signature = (await wallet.signTypedData(
    domain,
    BRIDGE_CLAIM_TYPES,
    toClaimValue(claim),
  )) as `0x${string}`;
  const digest = computeClaimDigest(claim, verifyingContract);
  return { claim, signature, digest, verifyingContract };
}

/**
 * Deterministic nonce builder for server-initiated claims that don't observe
 * a chain BridgeOut nonce (used only in fresh-mint Base→SKALE where there is
 * no source escrow event yet — the server picks the nonce).
 */
export function buildClaimNonce(parts: {
  bridgeId: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenId: string;
  recipient: string;
}): `0x${string}` {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["string", "uint64", "uint64", "string", "address"],
    [
      parts.bridgeId,
      BigInt(parts.sourceChainId),
      BigInt(parts.destinationChainId),
      parts.sourceTokenId,
      parts.recipient,
    ],
  );
  return keccak256(getBytes(encoded)) as `0x${string}`;
}
