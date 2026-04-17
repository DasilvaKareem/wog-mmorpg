import { postgresQuery } from "./postgres.js";

export interface LiveSessionRecord {
  walletAddress: string;
  entityId: string | null;
  zoneId: string;
  sessionState: Record<string, unknown>;
  updatedAt: string;
}

function normalizeWallet(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

export async function upsertLiveSession(params: {
  walletAddress: string;
  entityId?: string | null;
  zoneId: string;
  sessionState: Record<string, unknown>;
}): Promise<void> {
  await postgresQuery(
    `
      insert into game.live_sessions (
        wallet_address,
        entity_id,
        zone_id,
        session_state,
        updated_at
      ) values ($1, $2, $3, $4::jsonb, now())
      on conflict (wallet_address)
      do update set
        entity_id = excluded.entity_id,
        zone_id = excluded.zone_id,
        session_state = excluded.session_state,
        updated_at = now()
    `,
    [
      normalizeWallet(params.walletAddress),
      params.entityId ?? null,
      params.zoneId,
      JSON.stringify(params.sessionState),
    ]
  );
}

export async function deleteLiveSession(walletAddress: string): Promise<void> {
  await postgresQuery(
    `delete from game.live_sessions where wallet_address = $1`,
    [normalizeWallet(walletAddress)]
  );
}

export async function listLiveSessions(): Promise<LiveSessionRecord[]> {
  const { rows } = await postgresQuery<{
    wallet_address: string;
    entity_id: string | null;
    zone_id: string;
    session_state: Record<string, unknown> | null;
    updated_at: string;
  }>(
    `
      select
        wallet_address,
        entity_id,
        zone_id,
        session_state,
        updated_at::text as updated_at
      from game.live_sessions
      order by updated_at desc
    `
  );

  return rows.map((row) => ({
    walletAddress: row.wallet_address,
    entityId: row.entity_id,
    zoneId: row.zone_id,
    sessionState: row.session_state ?? {},
    updatedAt: row.updated_at,
  }));
}
