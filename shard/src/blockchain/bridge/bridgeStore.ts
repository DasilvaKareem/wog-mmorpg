import { randomUUID } from "node:crypto";
import { isPostgresConfigured, postgresQuery } from "../../db/postgres.js";
import type { BridgeDirection, BridgeRecord, BridgeStatus } from "./types.js";

/**
 * Persistence layer for bridge_operations.
 * Postgres is the source of truth; Redis is not used here because the listener
 * already keeps cursors in Redis and bridge ops are durable by nature.
 */

interface BridgeRow {
  bridge_id: string;
  direction: string;
  wallet_address: string;
  custodial_flow: boolean;
  source_chain_id: string;
  destination_chain_id: string;
  source_token_id: string;
  destination_token_id: string | null;
  recipient_address: string;
  status: string;
  burn_tx_hash: string | null;
  redeem_tx_hash: string | null;
  metadata_uri: string | null;
  claim_nonce: Buffer | null;
  claim_digest: Buffer | null;
  claim_signature: Buffer | null;
  claim_expires_at: Date | null;
  character_name: string | null;
  character_class_id: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

function hexFromBuffer(b: Buffer | null): string | null {
  if (!b) return null;
  return `0x${b.toString("hex")}`;
}

function bufferFromHex(hex: string | null | undefined): Buffer | null {
  if (!hex) return null;
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(stripped, "hex");
}

function fromRow(row: BridgeRow): BridgeRecord {
  return {
    bridgeId: row.bridge_id,
    direction: row.direction as BridgeDirection,
    walletAddress: row.wallet_address,
    custodialFlow: row.custodial_flow,
    sourceChainId: Number(row.source_chain_id),
    destinationChainId: Number(row.destination_chain_id),
    sourceTokenId: row.source_token_id,
    destinationTokenId: row.destination_token_id,
    recipientAddress: row.recipient_address,
    status: row.status as BridgeStatus,
    burnTxHash: row.burn_tx_hash,
    redeemTxHash: row.redeem_tx_hash,
    metadataURI: row.metadata_uri,
    claimNonce: hexFromBuffer(row.claim_nonce),
    claimDigest: hexFromBuffer(row.claim_digest),
    claimSignature: hexFromBuffer(row.claim_signature),
    claimExpiresAt: row.claim_expires_at ? row.claim_expires_at.getTime() : null,
    characterName: row.character_name,
    characterClassId: row.character_class_id,
    lastError: row.last_error,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

export interface CreateBridgeOpInput {
  direction: BridgeDirection;
  walletAddress: string;
  custodialFlow: boolean;
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenId: string;
  destinationTokenId?: string | null;
  recipientAddress: string;
  characterName?: string | null;
  characterClassId?: string | null;
}

/**
 * Create a new bridge operation in `pending_burn` state.
 * Throws on conflict (e.g., another active bridge exists for the same source token).
 */
export async function createBridgeOperation(input: CreateBridgeOpInput): Promise<BridgeRecord> {
  if (!isPostgresConfigured()) {
    throw new Error("Postgres required for bridge operations");
  }
  const bridgeId = randomUUID();
  const { rows } = await postgresQuery<BridgeRow>(
    `
      insert into game.bridge_operations (
        bridge_id, direction, wallet_address, custodial_flow,
        source_chain_id, destination_chain_id,
        source_token_id, destination_token_id,
        recipient_address, status,
        character_name, character_class_id,
        created_at, updated_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_burn', $10, $11, now(), now()
      )
      returning *
    `,
    [
      bridgeId,
      input.direction,
      input.walletAddress.toLowerCase(),
      input.custodialFlow,
      input.sourceChainId,
      input.destinationChainId,
      input.sourceTokenId,
      input.destinationTokenId ?? null,
      input.recipientAddress.toLowerCase(),
      input.characterName ?? null,
      input.characterClassId ?? null,
    ],
  );
  return fromRow(rows[0]);
}

export async function getBridgeOperation(bridgeId: string): Promise<BridgeRecord | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<BridgeRow>(
    `select * from game.bridge_operations where bridge_id = $1`,
    [bridgeId],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function findActiveBridgeBySourceToken(params: {
  sourceChainId: number;
  sourceTokenId: string;
}): Promise<BridgeRecord | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<BridgeRow>(
    `
      select * from game.bridge_operations
      where source_chain_id = $1
        and source_token_id = $2
        and status in ('pending_burn', 'burn_confirmed', 'claim_signed')
      order by created_at desc
      limit 1
    `,
    [params.sourceChainId, params.sourceTokenId],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listBridgeOperationsByWallet(
  walletAddress: string,
  limit = 50,
): Promise<BridgeRecord[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<BridgeRow>(
    `
      select * from game.bridge_operations
      where wallet_address = $1
      order by created_at desc
      limit $2
    `,
    [walletAddress.toLowerCase(), limit],
  );
  return rows.map(fromRow);
}

export async function listExpirableSignedClaims(now = Date.now()): Promise<BridgeRecord[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<BridgeRow>(
    `
      select * from game.bridge_operations
      where status = 'claim_signed'
        and claim_expires_at is not null
        and claim_expires_at < to_timestamp($1 / 1000.0)
      order by claim_expires_at asc
      limit 100
    `,
    [now],
  );
  return rows.map(fromRow);
}

export interface UpdateBridgeOpInput {
  status?: BridgeStatus;
  burnTxHash?: string | null;
  redeemTxHash?: string | null;
  metadataURI?: string | null;
  claimNonce?: string | null;
  claimDigest?: string | null;
  claimSignature?: string | null;
  claimExpiresAt?: number | null;
  destinationTokenId?: string | null;
  lastError?: string | null;
}

export async function updateBridgeOperation(
  bridgeId: string,
  patch: UpdateBridgeOpInput,
): Promise<BridgeRecord> {
  if (!isPostgresConfigured()) {
    throw new Error("Postgres required for bridge operations");
  }
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  const push = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length + 1}`);
  };
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.burnTxHash !== undefined) push("burn_tx_hash", patch.burnTxHash);
  if (patch.redeemTxHash !== undefined) push("redeem_tx_hash", patch.redeemTxHash);
  if (patch.metadataURI !== undefined) push("metadata_uri", patch.metadataURI);
  if (patch.claimNonce !== undefined) push("claim_nonce", bufferFromHex(patch.claimNonce));
  if (patch.claimDigest !== undefined) push("claim_digest", bufferFromHex(patch.claimDigest));
  if (patch.claimSignature !== undefined) push("claim_signature", bufferFromHex(patch.claimSignature));
  if (patch.claimExpiresAt !== undefined) {
    push("claim_expires_at", patch.claimExpiresAt ? new Date(patch.claimExpiresAt) : null);
  }
  if (patch.destinationTokenId !== undefined) push("destination_token_id", patch.destinationTokenId);
  if (patch.lastError !== undefined) push("last_error", patch.lastError);

  const { rows } = await postgresQuery<BridgeRow>(
    `update game.bridge_operations set ${sets.join(", ")} where bridge_id = $1 returning *`,
    [bridgeId, ...params],
  );
  if (!rows[0]) {
    throw new Error(`Bridge operation ${bridgeId} not found`);
  }
  return fromRow(rows[0]);
}

export async function countBridgesInLastHour(walletAddress?: string): Promise<number> {
  if (!isPostgresConfigured()) return 0;
  const sql = walletAddress
    ? `select count(*) as n from game.bridge_operations
        where wallet_address = $1 and created_at > now() - interval '1 hour'`
    : `select count(*) as n from game.bridge_operations
        where created_at > now() - interval '1 hour'`;
  const params = walletAddress ? [walletAddress.toLowerCase()] : [];
  const { rows } = await postgresQuery<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? "0");
}
