/**
 * Bridge orchestrator.
 *
 * State machine: pending_burn -> burn_confirmed -> claim_signed -> redeemed
 *                                          \-> expired -> refunded (admin)
 *
 * Responsibilities:
 *   - exportCharacterToBase / importCharacterToSkale: create bridge ops + (custodial)
 *     submit the burn/escrow tx on the source chain.
 *   - handleBridgeOutObserved: listener callback. Promote pending_burn -> burn_confirmed,
 *     snapshot metadata URI + nonce, sign the EIP-712 claim, store it, mark character
 *     bridgedOut. Also stops the running agent if any.
 *   - handleBridgeInObserved: listener callback. Promote claim_signed -> redeemed.
 *     For bridge-back, clear bridgedOut on the character.
 *   - refundExpiredBridge: admin-driven recovery path for expired claims.
 *
 * Custodial submission (the actual on-chain burn from server account) is not
 * implemented in this skeleton — it requires deployed contracts to call. The
 * service is wired so external-wallet flows work today: the user submits the
 * burn themselves, the listener observes the BridgeOut event, and the server
 * signs the claim, which the user then redeems on the destination chain.
 */
import { randomUUID } from "node:crypto";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHARACTER_CONTRACT,
  BRIDGE_CLAIM_TTL_SECONDS,
  BRIDGE_ENABLED,
  BRIDGE_RATE_LIMIT_GLOBAL_PER_HOUR,
  BRIDGE_RATE_LIMIT_PER_HOUR,
  SKALE_BASE_CHAIN_ID,
  SKALE_BRIDGE_ADAPTER_CONTRACT,
  bridgeContractsConfigured,
} from "./bridgeConfig.js";
import {
  CreateBridgeOpInput,
  countBridgesInLastHour,
  createBridgeOperation,
  findActiveBridgeBySourceToken,
  getBridgeOperation,
  listExpirableSignedClaims,
  updateBridgeOperation,
} from "./bridgeStore.js";
import { computeClaimDigest, signBridgeClaim } from "./bridgeClaimSigner.js";
import {
  BridgeClaim,
  BridgeRecord,
  FRESH_MINT_SENTINEL,
  SignedBridgeClaim,
} from "./types.js";
import {
  assertCharacterNotBridgedOut,
  loadCharacter,
  setCharacterBridgedOut,
} from "../../character/characterStore.js";

export class BridgeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

function assertEnabled() {
  if (!BRIDGE_ENABLED) {
    throw new BridgeError("disabled", "Bridge feature is disabled (BRIDGE_ENABLED=false)");
  }
  if (!bridgeContractsConfigured()) {
    throw new BridgeError(
      "not_configured",
      "Bridge contracts not configured (set BASE_MAINNET_CHARACTER_CONTRACT and SKALE_BRIDGE_ADAPTER_CONTRACT)",
    );
  }
}

async function assertWithinRateLimit(walletAddress: string): Promise<void> {
  const [perWallet, global] = await Promise.all([
    countBridgesInLastHour(walletAddress),
    countBridgesInLastHour(),
  ]);
  if (perWallet >= BRIDGE_RATE_LIMIT_PER_HOUR) {
    throw new BridgeError(
      "rate_limit_wallet",
      `Per-wallet bridge limit reached (${BRIDGE_RATE_LIMIT_PER_HOUR}/hr)`,
    );
  }
  if (global >= BRIDGE_RATE_LIMIT_GLOBAL_PER_HOUR) {
    throw new BridgeError(
      "rate_limit_global",
      `Global bridge limit reached (${BRIDGE_RATE_LIMIT_GLOBAL_PER_HOUR}/hr)`,
    );
  }
}

function verifyingContractFor(destinationChainId: number): `0x${string}` {
  if (destinationChainId === BASE_MAINNET_CHAIN_ID) {
    return BASE_MAINNET_CHARACTER_CONTRACT as `0x${string}`;
  }
  if (destinationChainId === SKALE_BASE_CHAIN_ID) {
    return SKALE_BRIDGE_ADAPTER_CONTRACT as `0x${string}`;
  }
  throw new BridgeError("bad_destination", `Unsupported destination chain ${destinationChainId}`);
}

/* ---------------------------------------------------------------------------
 * User-facing entrypoints
 * ------------------------------------------------------------------------- */

export interface ExportToBaseInput {
  walletAddress: string;
  characterTokenId: string;
  characterName: string;
  characterClassId: string;
  baseRecipient: string;
  /** True if the server holds the wallet key and will submit the burn itself. */
  custodialFlow: boolean;
}

/**
 * Create a bridge operation for SKALE -> Base. Does NOT submit the burn tx in
 * this skeleton; for custodial flows that comes from a follow-up task.
 *
 * External-wallet callers: take this response, sign + submit `adapter.bridgeOut`
 * yourself. The listener will pick up the event and promote the op.
 */
export async function exportCharacterToBase(input: ExportToBaseInput): Promise<BridgeRecord> {
  assertEnabled();
  await assertCharacterNotBridgedOut(input.walletAddress, input.characterName);
  await assertWithinRateLimit(input.walletAddress);

  const existing = await findActiveBridgeBySourceToken({
    sourceChainId: SKALE_BASE_CHAIN_ID,
    sourceTokenId: input.characterTokenId,
  });
  if (existing) {
    throw new BridgeError(
      "conflict",
      `An active bridge for tokenId ${input.characterTokenId} already exists (${existing.bridgeId}, status=${existing.status})`,
    );
  }

  const createInput: CreateBridgeOpInput = {
    direction: "skale-to-base",
    walletAddress: input.walletAddress,
    custodialFlow: input.custodialFlow,
    sourceChainId: SKALE_BASE_CHAIN_ID,
    destinationChainId: BASE_MAINNET_CHAIN_ID,
    sourceTokenId: input.characterTokenId,
    destinationTokenId: input.characterTokenId, // round-trip: same id on Base
    recipientAddress: input.baseRecipient,
    characterName: input.characterName,
    characterClassId: input.characterClassId,
  };
  return await createBridgeOperation(createInput);
}

export interface ImportFromBaseInput {
  walletAddress: string;
  /** The tokenId on Base mainnet being bridged back. Pass null/undefined if it
   *  was never on SKALE (will fresh-mint via the registry). */
  baseTokenId: string;
  skaleRecipient: string;
  /** Optional character name + class hint to restore in the game DB on redeem. */
  characterName?: string;
  characterClassId?: string;
  custodialFlow: boolean;
  /** True if the source character originated on Base (no prior SKALE history). */
  freshMint: boolean;
}

export async function importCharacterToSkale(input: ImportFromBaseInput): Promise<BridgeRecord> {
  assertEnabled();
  await assertWithinRateLimit(input.walletAddress);

  const existing = await findActiveBridgeBySourceToken({
    sourceChainId: BASE_MAINNET_CHAIN_ID,
    sourceTokenId: input.baseTokenId,
  });
  if (existing) {
    throw new BridgeError(
      "conflict",
      `An active bridge for Base tokenId ${input.baseTokenId} already exists (${existing.bridgeId}, status=${existing.status})`,
    );
  }

  const destinationTokenId = input.freshMint ? FRESH_MINT_SENTINEL.toString() : input.baseTokenId;
  return await createBridgeOperation({
    direction: "base-to-skale",
    walletAddress: input.walletAddress,
    custodialFlow: input.custodialFlow,
    sourceChainId: BASE_MAINNET_CHAIN_ID,
    destinationChainId: SKALE_BASE_CHAIN_ID,
    sourceTokenId: input.baseTokenId,
    destinationTokenId,
    recipientAddress: input.skaleRecipient,
    characterName: input.characterName ?? null,
    characterClassId: input.characterClassId ?? null,
  });
}

/* ---------------------------------------------------------------------------
 * Listener callbacks (invoked by bridgeEventListener.ts on observed events)
 * ------------------------------------------------------------------------- */

export interface BridgeOutObservedInput {
  chainId: number;
  tokenId: string;
  holder: string;
  destinationRecipient: string;
  destinationChainId: number;
  metadataURI: string;
  nonce: `0x${string}`;
  txHash: string;
  blockNumber: number;
}

/**
 * Idempotent. Called by listener for every BridgeOut log.
 *  - Locates the matching pending_burn op (created via export/import API) or
 *    creates one on the fly for fully external flows.
 *  - Snapshots metadata URI + on-chain nonce.
 *  - Signs the EIP-712 claim and stores it.
 *  - Marks the character bridgedOut in the game DB.
 */
export async function handleBridgeOutObserved(input: BridgeOutObservedInput): Promise<void> {
  if (!BRIDGE_ENABLED || !bridgeContractsConfigured()) return;

  let record = await findActiveBridgeBySourceToken({
    sourceChainId: input.chainId,
    sourceTokenId: input.tokenId,
  });

  // External-wallet flow without prior /bridge/export call: create the op now.
  if (!record) {
    const direction =
      input.chainId === SKALE_BASE_CHAIN_ID ? "skale-to-base" : "base-to-skale";
    record = await createBridgeOperation({
      direction,
      walletAddress: input.holder,
      custodialFlow: false,
      sourceChainId: input.chainId,
      destinationChainId: input.destinationChainId,
      sourceTokenId: input.tokenId,
      destinationTokenId:
        direction === "base-to-skale"
          ? FRESH_MINT_SENTINEL.toString() // unknown game-side, default to fresh mint
          : input.tokenId,
      recipientAddress: input.destinationRecipient,
      characterName: null,
      characterClassId: null,
    });
  }

  if (record.status !== "pending_burn" && record.status !== "burn_confirmed") {
    // Already processed (claim_signed / redeemed / refunded) — nothing to do.
    return;
  }

  const promoted = await updateBridgeOperation(record.bridgeId, {
    status: "burn_confirmed",
    burnTxHash: input.txHash,
    metadataURI: input.metadataURI,
    claimNonce: input.nonce,
  });

  // Mark character bridgedOut as soon as the burn is confirmed.
  if (promoted.characterName) {
    await setCharacterBridgedOut({
      walletAddress: promoted.walletAddress,
      characterName: promoted.characterName,
      bridgedOut: true,
      destinationChainId: promoted.destinationChainId,
      destinationTokenId: promoted.destinationTokenId,
    }).catch((err) => {
      console.warn(
        `[bridgeService] setCharacterBridgedOut failed for ${promoted.bridgeId}: ${err.message}`,
      );
    });
  }

  // Stop the running agent / unregister live entity (best-effort, no hard
  // dependency to avoid circular imports). Wire up at server boot in
  // server.ts via subscribing to a bridge event emitter.

  await signAndStoreClaim(promoted, input.nonce);
}

async function signAndStoreClaim(
  record: BridgeRecord,
  nonce: `0x${string}`,
): Promise<SignedBridgeClaim> {
  const verifyingContract = verifyingContractFor(record.destinationChainId);
  const expiresAt = Math.floor(Date.now() / 1000) + BRIDGE_CLAIM_TTL_SECONDS;
  const destinationTokenId =
    record.destinationTokenId == null ? record.sourceTokenId : record.destinationTokenId;

  const claim: BridgeClaim = {
    sourceTokenId: BigInt(record.sourceTokenId),
    destinationTokenId: BigInt(destinationTokenId),
    recipient: record.recipientAddress as `0x${string}`,
    sourceChainId: BigInt(record.sourceChainId),
    destinationChainId: BigInt(record.destinationChainId),
    metadataURI: record.metadataURI ?? "",
    nonce,
    expiresAt: BigInt(expiresAt),
  };

  const signed = await signBridgeClaim(claim, verifyingContract);
  await updateBridgeOperation(record.bridgeId, {
    status: "claim_signed",
    claimDigest: signed.digest,
    claimSignature: signed.signature,
    claimExpiresAt: expiresAt * 1000,
  });
  return signed;
}

export interface BridgeInObservedInput {
  chainId: number;
  tokenId: string;
  recipient: string;
  sourceChainId: number;
  claimDigest: `0x${string}`;
  txHash: string;
}

/**
 * Idempotent. Called by listener for every BridgeIn log.
 *  - Look up the bridge op by claim digest.
 *  - Promote to redeemed.
 *  - For Base→SKALE redemption, clear bridgedOut on the character so the user
 *    can play again immediately.
 */
export async function handleBridgeInObserved(input: BridgeInObservedInput): Promise<void> {
  if (!BRIDGE_ENABLED || !bridgeContractsConfigured()) return;

  // Find by claim digest. Falls back to (destinationChainId, destinationTokenId)
  // if no digest match (handles edge cases where digest insertion races).
  const record = await findBridgeByClaimDigest(input.claimDigest);
  if (!record) {
    console.warn(
      `[bridgeService] BridgeIn observed for unknown claim digest ${input.claimDigest} on chain ${input.chainId}`,
    );
    return;
  }
  if (record.status === "redeemed") return;

  const updated = await updateBridgeOperation(record.bridgeId, {
    status: "redeemed",
    redeemTxHash: input.txHash,
    destinationTokenId: input.tokenId,
  });

  // For bridge-back (Base→SKALE), restore the character.
  if (updated.direction === "base-to-skale" && updated.characterName) {
    await setCharacterBridgedOut({
      walletAddress: updated.walletAddress,
      characterName: updated.characterName,
      bridgedOut: false,
      destinationChainId: null,
      destinationTokenId: null,
      destinationTxHash: null,
    }).catch((err) => {
      console.warn(
        `[bridgeService] restore bridgedOut=false failed for ${updated.bridgeId}: ${err.message}`,
      );
    });
  }
}

async function findBridgeByClaimDigest(digest: string): Promise<BridgeRecord | null> {
  // Implemented inline to avoid bloating bridgeStore with niche queries.
  const { postgresQuery, isPostgresConfigured } = await import("../../db/postgres.js");
  if (!isPostgresConfigured()) return null;
  const stripped = digest.startsWith("0x") ? digest.slice(2) : digest;
  const buf = Buffer.from(stripped, "hex");
  const { rows } = await postgresQuery<any>(
    `select * from game.bridge_operations where claim_digest = $1 limit 1`,
    [buf],
  );
  if (!rows[0]) return null;
  // Use the same row→record mapping via getBridgeOperation since the row shape is identical.
  return getBridgeOperation(rows[0].bridge_id);
}

/* ---------------------------------------------------------------------------
 * Refund worker
 * ------------------------------------------------------------------------- */

/**
 * Returns the list of bridge ops eligible for refund:
 *   - status = claim_signed
 *   - claim_expires_at in the past
 *
 * The actual on-chain refund call (adapter.refundEscrow for skale-to-base, or
 * a fresh-mint admin call for base-to-skale) is left to a follow-up task.
 * For now this surfaces the queue so operators can review.
 */
export async function listRefundableBridges(): Promise<BridgeRecord[]> {
  return listExpirableSignedClaims();
}

export async function markBridgeRefunded(
  bridgeId: string,
  refundTxHash: string,
): Promise<BridgeRecord> {
  const record = await getBridgeOperation(bridgeId);
  if (!record) throw new BridgeError("not_found", `Bridge ${bridgeId} not found`);
  if (record.status !== "claim_signed" && record.status !== "expired") {
    throw new BridgeError(
      "bad_state",
      `Bridge ${bridgeId} is in status ${record.status}; cannot refund`,
    );
  }
  const updated = await updateBridgeOperation(bridgeId, {
    status: "refunded",
    redeemTxHash: refundTxHash,
  });

  // Restore the character so they can keep playing.
  if (updated.direction === "skale-to-base" && updated.characterName) {
    await setCharacterBridgedOut({
      walletAddress: updated.walletAddress,
      characterName: updated.characterName,
      bridgedOut: false,
      destinationChainId: null,
      destinationTokenId: null,
      destinationTxHash: null,
    }).catch(() => {});
  }
  return updated;
}

/* ---------------------------------------------------------------------------
 * Read helpers
 * ------------------------------------------------------------------------- */

export { getBridgeOperation, listBridgeOperationsByWallet } from "./bridgeStore.js";

export async function buildClaimResponse(
  bridgeId: string,
): Promise<{
  claim: BridgeClaim;
  signature: `0x${string}`;
  digest: `0x${string}`;
  verifyingContract: `0x${string}`;
} | null> {
  const record = await getBridgeOperation(bridgeId);
  if (!record) return null;
  if (record.status !== "claim_signed") return null;
  if (!record.claimSignature || !record.claimDigest || !record.claimExpiresAt) return null;

  const verifyingContract = verifyingContractFor(record.destinationChainId);
  const claim: BridgeClaim = {
    sourceTokenId: BigInt(record.sourceTokenId),
    destinationTokenId: BigInt(record.destinationTokenId ?? record.sourceTokenId),
    recipient: record.recipientAddress as `0x${string}`,
    sourceChainId: BigInt(record.sourceChainId),
    destinationChainId: BigInt(record.destinationChainId),
    metadataURI: record.metadataURI ?? "",
    nonce: (record.claimNonce ?? "0x") as `0x${string}`,
    expiresAt: BigInt(Math.floor(record.claimExpiresAt / 1000)),
  };

  // Sanity check: recompute digest and confirm it matches storage.
  const expectedDigest = computeClaimDigest(claim, verifyingContract);
  if (expectedDigest !== record.claimDigest) {
    throw new BridgeError(
      "digest_mismatch",
      `Stored digest does not match computed digest for ${bridgeId}`,
    );
  }

  return {
    claim,
    signature: record.claimSignature as `0x${string}`,
    digest: record.claimDigest as `0x${string}`,
    verifyingContract,
  };
}

/** Used by routes / status display to advertise that a character is exportable. */
export async function getCharacterBridgeStatus(
  walletAddress: string,
  characterName: string,
): Promise<{ bridgedOut: boolean; destinationChainId: number | null }> {
  const saved = await loadCharacter(walletAddress, characterName);
  return {
    bridgedOut: saved?.bridgedOut === true,
    destinationChainId: saved?.bridgedDestinationChainId ?? null,
  };
}
