import { postgresQuery, withPostgresClient } from "./postgres.js";

export interface PersistedPartyRecord {
  id: string;
  leaderWallet: string;
  memberWallets: string[];
  zoneId: string;
  createdAt: number;
  shareXp: boolean;
  shareGold: boolean;
}

function normalizeWallet(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

export async function savePersistedParty(party: PersistedPartyRecord): Promise<void> {
  const memberWallets = Array.from(new Set(party.memberWallets.map(normalizeWallet).filter(Boolean)));
  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `
          insert into game.parties (
            party_id,
            leader_wallet,
            member_wallets_json,
            zone_id,
            created_at,
            share_xp,
            share_gold,
            updated_at
          ) values (
            $1, $2, $3::jsonb, $4, to_timestamp($5::double precision / 1000.0), $6, $7, now()
          )
          on conflict (party_id)
          do update set
            leader_wallet = excluded.leader_wallet,
            member_wallets_json = excluded.member_wallets_json,
            zone_id = excluded.zone_id,
            share_xp = excluded.share_xp,
            share_gold = excluded.share_gold,
            updated_at = now()
        `,
        [
          party.id,
          normalizeWallet(party.leaderWallet),
          JSON.stringify(memberWallets),
          party.zoneId,
          party.createdAt,
          party.shareXp,
          party.shareGold,
        ]
      );
      await client.query(`delete from game.party_wallet_memberships where party_id = $1`, [party.id]);
      for (const wallet of memberWallets) {
        await client.query(
          `
            insert into game.party_wallet_memberships (wallet_address, party_id, updated_at)
            values ($1, $2, now())
            on conflict (wallet_address)
            do update set
              party_id = excluded.party_id,
              updated_at = now()
          `,
          [wallet, party.id]
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

export async function deletePersistedParty(partyId: string): Promise<void> {
  await postgresQuery(`delete from game.parties where party_id = $1`, [partyId]);
}

export async function deletePersistedPartyWallet(walletAddress: string): Promise<void> {
  await postgresQuery(`delete from game.party_wallet_memberships where wallet_address = $1`, [normalizeWallet(walletAddress)]);
}

export async function getPersistedPartyForWallet(walletAddress: string): Promise<PersistedPartyRecord | null> {
  const { rows } = await postgresQuery<{
    party_id: string;
    leader_wallet: string;
    member_wallets_json: string[] | null;
    zone_id: string;
    created_at_ms: string;
    share_xp: boolean;
    share_gold: boolean;
  }>(
    `
      select
        p.party_id,
        p.leader_wallet,
        p.member_wallets_json,
        p.zone_id,
        floor(extract(epoch from p.created_at) * 1000)::text as created_at_ms,
        p.share_xp,
        p.share_gold
      from game.party_wallet_memberships pwm
      join game.parties p on p.party_id = pwm.party_id
      where pwm.wallet_address = $1
      limit 1
    `,
    [normalizeWallet(walletAddress)]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: row.party_id,
    leaderWallet: row.leader_wallet,
    memberWallets: Array.isArray(row.member_wallets_json) ? row.member_wallets_json : [],
    zoneId: row.zone_id,
    createdAt: Number(row.created_at_ms ?? "0") || 0,
    shareXp: row.share_xp,
    shareGold: row.share_gold,
  };
}

export async function getPersistedPartyById(partyId: string): Promise<PersistedPartyRecord | null> {
  const { rows } = await postgresQuery<{
    party_id: string;
    leader_wallet: string;
    member_wallets_json: string[] | null;
    zone_id: string;
    created_at_ms: string;
    share_xp: boolean;
    share_gold: boolean;
  }>(
    `
      select
        party_id,
        leader_wallet,
        member_wallets_json,
        zone_id,
        floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
        share_xp,
        share_gold
      from game.parties
      where party_id = $1
      limit 1
    `,
    [partyId]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: row.party_id,
    leaderWallet: row.leader_wallet,
    memberWallets: Array.isArray(row.member_wallets_json) ? row.member_wallets_json : [],
    zoneId: row.zone_id,
    createdAt: Number(row.created_at_ms ?? "0") || 0,
    shareXp: row.share_xp,
    shareGold: row.share_gold,
  };
}

export async function listPersistedPartyIds(): Promise<string[]> {
  const { rows } = await postgresQuery<{ party_id: string }>(`select party_id from game.parties order by updated_at desc`);
  return rows.map((row) => row.party_id);
}
