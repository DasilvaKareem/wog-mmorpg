import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { MerchantState } from "../world/merchantAgent.js";

export async function upsertMerchantState(merchantId: string, zoneId: string, npcName: string, walletAddress: string, payload: unknown): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.merchant_states (merchant_id, zone_id, npc_name, wallet_address, payload_json, updated_at)
     values ($1,$2,$3,$4,$5::jsonb,now())
     on conflict (merchant_id) do update set
       zone_id = excluded.zone_id,
       npc_name = excluded.npc_name,
       wallet_address = excluded.wallet_address,
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [merchantId, zoneId, npcName, walletAddress.toLowerCase(), JSON.stringify(payload)]
  );
}

export async function listMerchantStates(): Promise<Array<{ merchantId: string; payload: unknown }>> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ merchant_id: string; payload_json: unknown }>(
    `select merchant_id, payload_json from game.merchant_states`
  );
  return rows.map((row) => ({ merchantId: row.merchant_id, payload: row.payload_json }));
}

export async function getMerchantStateProjection(merchantId: string): Promise<unknown | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: unknown }>(
    `select payload_json
       from game.merchant_states
      where merchant_id = $1
      limit 1`,
    [merchantId]
  );
  return rows[0]?.payload_json ?? null;
}
