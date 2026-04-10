import { postgresQuery, withPostgresClient } from "../db/postgres.js";

export interface CharacterProjectionRecord {
  walletAddress: string;
  normalizedName: string;
  characterName: string;
  classId: string;
  raceId: string;
  level: number;
  xp: number;
  characterTokenId: string | null;
  agentId: string | null;
  agentRegistrationTxHash: string | null;
  chainRegistrationStatus: string | null;
  chainRegistrationLastError: string | null;
  zoneId: string;
  calling: string | null;
  gender: string | null;
  skinColor: string | null;
  hairStyle: string | null;
  eyeColor: string | null;
  origin: string | null;
  snapshotJson: Record<string, unknown>;
  source: string;
  updatedAt: string;
}

function normalizeWallet(value: string): string {
  return value.trim().toLowerCase();
}

function collapseCharacterName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeCharacterName(value: string): string {
  return collapseCharacterName(value).replace(/\s+the\s+\w+$/i, "").trim().toLowerCase();
}

export function normalizeStoredCharacterName(value: string): string {
  return normalizeCharacterName(value);
}

export async function upsertCharacterProjection(params: {
  walletAddress: string;
  character: {
    name: string;
    classId: string;
    raceId: string;
    level: number;
    xp: number;
    characterTokenId?: string | null;
    agentId?: string | null;
    agentRegistrationTxHash?: string | null;
    chainRegistrationStatus?: string | null;
    chainRegistrationLastError?: string | null;
    zone?: string;
    calling?: string;
    gender?: string;
    skinColor?: string;
    hairStyle?: string;
    eyeColor?: string;
    origin?: string;
  };
  source?: string;
}): Promise<void> {
  const { walletAddress, character, source = "redis-sync" } = params;
  const normalizedWallet = normalizeWallet(walletAddress);
  const normalizedName = normalizeCharacterName(character.name);
  const collapsedName = collapseCharacterName(character.name);
  const level = Math.max(1, Number(character.level ?? 1) || 1);
  const xp = Math.max(0, Number(character.xp ?? 0) || 0);
  const snapshotJson = JSON.stringify(character);

  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      const characterResult = await client.query<{ character_id: string }>(
        `
          insert into game.characters (
            wallet_address,
            normalized_name,
            character_name,
            class_id,
            race_id,
            level,
            xp,
            zone_id,
            calling,
            gender,
            skin_color,
            hair_style,
            eye_color,
            origin,
            snapshot_json,
            updated_at
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, now()
          )
          on conflict (wallet_address, normalized_name, class_id)
          do update set
            character_name = excluded.character_name,
            race_id = excluded.race_id,
            level = excluded.level,
            xp = excluded.xp,
            zone_id = excluded.zone_id,
            calling = excluded.calling,
            gender = excluded.gender,
            skin_color = excluded.skin_color,
            hair_style = excluded.hair_style,
            eye_color = excluded.eye_color,
            origin = excluded.origin,
            snapshot_json = excluded.snapshot_json,
            updated_at = now()
          returning character_id
        `,
        [
          normalizedWallet,
          normalizedName,
          collapsedName,
          character.classId,
          character.raceId,
          level,
          xp,
          character.zone ?? "village-square",
          character.calling ?? null,
          character.gender ?? null,
          character.skinColor ?? null,
          character.hairStyle ?? null,
          character.eyeColor ?? null,
          character.origin ?? null,
          snapshotJson,
        ]
      );
      const characterId = Number(characterResult.rows[0]?.character_id ?? "0");

      await client.query(
        `
          insert into game.character_identity_state (
            character_id,
            character_token_id,
            agent_id,
            agent_registration_tx_hash,
            chain_registration_status,
            chain_registration_last_error,
            updated_at
          ) values ($1, $2, $3, $4, $5, $6, now())
          on conflict (character_id)
          do update set
            character_token_id = excluded.character_token_id,
            agent_id = excluded.agent_id,
            agent_registration_tx_hash = excluded.agent_registration_tx_hash,
            chain_registration_status = excluded.chain_registration_status,
            chain_registration_last_error = excluded.chain_registration_last_error,
            updated_at = now()
        `,
        [
          characterId,
          character.characterTokenId ?? null,
          character.agentId ?? null,
          character.agentRegistrationTxHash ?? null,
          character.chainRegistrationStatus ?? null,
          character.chainRegistrationLastError ?? null,
        ]
      );

      await client.query(
        `
          insert into game.character_projections (
            wallet_address,
            normalized_name,
            character_name,
            class_id,
            race_id,
            level,
            xp,
            character_token_id,
            agent_id,
            agent_registration_tx_hash,
            chain_registration_status,
            chain_registration_last_error,
            zone_id,
            calling,
            gender,
            skin_color,
            hair_style,
            eye_color,
            origin,
            snapshot_json,
            source,
            updated_at
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21, now()
          )
          on conflict (wallet_address, normalized_name, class_id)
          do update set
            character_name = excluded.character_name,
            race_id = excluded.race_id,
            level = excluded.level,
            xp = excluded.xp,
            character_token_id = excluded.character_token_id,
            agent_id = excluded.agent_id,
            agent_registration_tx_hash = excluded.agent_registration_tx_hash,
            chain_registration_status = excluded.chain_registration_status,
            chain_registration_last_error = excluded.chain_registration_last_error,
            zone_id = excluded.zone_id,
            calling = excluded.calling,
            gender = excluded.gender,
            skin_color = excluded.skin_color,
            hair_style = excluded.hair_style,
            eye_color = excluded.eye_color,
            origin = excluded.origin,
            snapshot_json = excluded.snapshot_json,
            source = excluded.source,
            updated_at = now()
        `,
        [
          normalizedWallet,
          normalizedName,
          collapsedName,
          character.classId,
          character.raceId,
          level,
          xp,
          character.characterTokenId ?? null,
          character.agentId ?? null,
          character.agentRegistrationTxHash ?? null,
          character.chainRegistrationStatus ?? null,
          character.chainRegistrationLastError ?? null,
          character.zone ?? "village-square",
          character.calling ?? null,
          character.gender ?? null,
          character.skinColor ?? null,
          character.hairStyle ?? null,
          character.eyeColor ?? null,
          character.origin ?? null,
          snapshotJson,
          source,
        ]
      );

      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

export async function deleteCharacterProjection(params: {
  walletAddress: string;
  characterName: string;
  classId?: string | null;
}): Promise<void> {
  const { walletAddress, characterName, classId } = params;
  if (classId) {
    await withPostgresClient(async (client) => {
      await client.query("begin");
      try {
        await client.query(
          `delete from game.character_projections where wallet_address = $1 and normalized_name = $2 and class_id = $3`,
          [normalizeWallet(walletAddress), normalizeCharacterName(characterName), classId]
        );
        await client.query(
          `delete from game.characters where wallet_address = $1 and normalized_name = $2 and class_id = $3`,
          [normalizeWallet(walletAddress), normalizeCharacterName(characterName), classId]
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    });
    return;
  }

  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `delete from game.character_projections where wallet_address = $1 and normalized_name = $2`,
        [normalizeWallet(walletAddress), normalizeCharacterName(characterName)]
      );
      await client.query(
        `delete from game.characters where wallet_address = $1 and normalized_name = $2`,
        [normalizeWallet(walletAddress), normalizeCharacterName(characterName)]
      );
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

export async function listCharacterProjectionsForWallets(wallets: string[]): Promise<CharacterProjectionRecord[]> {
  const normalizedWallets = wallets
    .map((wallet) => wallet?.trim())
    .filter((wallet): wallet is string => Boolean(wallet))
    .map(normalizeWallet);
  if (normalizedWallets.length === 0) return [];

  const { rows } = await postgresQuery<{
    wallet_address: string;
    normalized_name: string;
    character_name: string;
    class_id: string;
    race_id: string;
    level: number;
    xp: number;
    character_token_id: string | null;
    agent_id: string | null;
    agent_registration_tx_hash: string | null;
    chain_registration_status: string | null;
    chain_registration_last_error: string | null;
    zone_id: string;
    calling: string | null;
    gender: string | null;
    skin_color: string | null;
    hair_style: string | null;
    eye_color: string | null;
    origin: string | null;
    snapshot_json: Record<string, unknown> | null;
    source: string;
    updated_at: string;
  }>(
    `
      select
        wallet_address,
        normalized_name,
        character_name,
        class_id,
        race_id,
        level,
        xp,
        character_token_id,
        agent_id,
        agent_registration_tx_hash,
        chain_registration_status,
        chain_registration_last_error,
        zone_id,
        calling,
        gender,
        skin_color,
        hair_style,
        eye_color,
        origin,
        snapshot_json,
        source,
        updated_at::text as updated_at
      from game.character_projections
      where wallet_address = any($1::text[])
      order by updated_at desc
    `,
    [normalizedWallets]
  );

  return rows.map((row) => ({
    walletAddress: row.wallet_address,
    normalizedName: row.normalized_name,
    characterName: row.character_name,
    classId: row.class_id,
    raceId: row.race_id,
    level: Number(row.level ?? 1) || 1,
    xp: Number(row.xp ?? 0) || 0,
    characterTokenId: row.character_token_id,
    agentId: row.agent_id,
    agentRegistrationTxHash: row.agent_registration_tx_hash,
    chainRegistrationStatus: row.chain_registration_status,
    chainRegistrationLastError: row.chain_registration_last_error,
    zoneId: row.zone_id,
    calling: row.calling,
    gender: row.gender,
    skinColor: row.skin_color,
    hairStyle: row.hair_style,
    eyeColor: row.eye_color,
    origin: row.origin,
    snapshotJson: row.snapshot_json ?? {},
    source: row.source,
    updatedAt: row.updated_at,
  }));
}

export async function getCharacterProjectionByAgentId(agentId: string): Promise<CharacterProjectionRecord | null> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) return null;

  const { rows } = await postgresQuery<{
    wallet_address: string;
    normalized_name: string;
    character_name: string;
    class_id: string;
    race_id: string;
    level: number;
    xp: number;
    character_token_id: string | null;
    agent_id: string | null;
    agent_registration_tx_hash: string | null;
    chain_registration_status: string | null;
    chain_registration_last_error: string | null;
    zone_id: string;
    calling: string | null;
    gender: string | null;
    skin_color: string | null;
    hair_style: string | null;
    eye_color: string | null;
    origin: string | null;
    snapshot_json: Record<string, unknown> | null;
    source: string;
    updated_at: string;
  }>(
    `
      select
        wallet_address,
        normalized_name,
        character_name,
        class_id,
        race_id,
        level,
        xp,
        character_token_id,
        agent_id,
        agent_registration_tx_hash,
        chain_registration_status,
        chain_registration_last_error,
        zone_id,
        calling,
        gender,
        skin_color,
        hair_style,
        eye_color,
        origin,
        snapshot_json,
        source,
        updated_at::text as updated_at
      from game.character_projections
      where agent_id = $1
      order by updated_at desc
      limit 1
    `,
    [normalizedAgentId]
  );

  const row = rows[0];
  if (!row) return null;
  return {
    walletAddress: row.wallet_address,
    normalizedName: row.normalized_name,
    characterName: row.character_name,
    classId: row.class_id,
    raceId: row.race_id,
    level: Number(row.level ?? 1) || 1,
    xp: Number(row.xp ?? 0) || 0,
    characterTokenId: row.character_token_id,
    agentId: row.agent_id,
    agentRegistrationTxHash: row.agent_registration_tx_hash,
    chainRegistrationStatus: row.chain_registration_status,
    chainRegistrationLastError: row.chain_registration_last_error,
    zoneId: row.zone_id,
    calling: row.calling,
    gender: row.gender,
    skinColor: row.skin_color,
    hairStyle: row.hair_style,
    eyeColor: row.eye_color,
    origin: row.origin,
    snapshotJson: row.snapshot_json ?? {},
    source: row.source,
    updatedAt: row.updated_at,
  };
}

export async function getCharacterSnapshotForWallet(
  walletAddress: string,
  characterName: string
): Promise<Record<string, unknown> | null> {
  const normalizedWallet = normalizeWallet(walletAddress);
  const normalizedName = normalizeCharacterName(characterName);
  const { rows } = await postgresQuery<{ snapshot_json: Record<string, unknown> | null }>(
    `
      select snapshot_json
      from game.character_projections
      where wallet_address = $1
        and normalized_name = $2
      order by updated_at desc
      limit 1
    `,
    [normalizedWallet, normalizedName]
  );
  return rows[0]?.snapshot_json ?? null;
}

export async function listCharacterSnapshotsForWallet(
  walletAddress: string
): Promise<Record<string, unknown>[]> {
  const normalizedWallet = normalizeWallet(walletAddress);
  const { rows } = await postgresQuery<{ snapshot_json: Record<string, unknown> | null }>(
    `
      select snapshot_json
      from game.character_projections
      where wallet_address = $1
      order by updated_at desc
    `,
    [normalizedWallet]
  );
  return rows
    .map((row) => row.snapshot_json ?? null)
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

export async function upsertWalletLink(params: {
  ownerWallet: string;
  custodialWallet?: string | null;
  entityId?: string | null;
  lastZoneId?: string | null;
  characterName?: string | null;
  agentId?: string | null;
  characterTokenId?: string | null;
}): Promise<void> {
  await postgresQuery(
    `
      insert into game.wallet_links (
        owner_wallet,
        custodial_wallet,
        entity_id,
        last_zone_id,
        character_name,
        agent_id,
        character_token_id,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, now())
      on conflict (owner_wallet)
      do update set
        custodial_wallet = coalesce(excluded.custodial_wallet, game.wallet_links.custodial_wallet),
        entity_id = coalesce(excluded.entity_id, game.wallet_links.entity_id),
        last_zone_id = coalesce(excluded.last_zone_id, game.wallet_links.last_zone_id),
        character_name = coalesce(excluded.character_name, game.wallet_links.character_name),
        agent_id = coalesce(excluded.agent_id, game.wallet_links.agent_id),
        character_token_id = coalesce(excluded.character_token_id, game.wallet_links.character_token_id),
        updated_at = now()
    `,
    [
      normalizeWallet(params.ownerWallet),
      params.custodialWallet ? normalizeWallet(params.custodialWallet) : null,
      params.entityId ?? null,
      params.lastZoneId ?? null,
      params.characterName ? collapseCharacterName(params.characterName) : null,
      params.agentId ?? null,
      params.characterTokenId ?? null,
    ]
  );
}

export async function clearWalletEntityLink(ownerWallet: string): Promise<void> {
  await postgresQuery(
    `
      update game.wallet_links
      set entity_id = null,
          last_zone_id = null,
          character_name = null,
          agent_id = null,
          character_token_id = null,
          updated_at = now()
      where owner_wallet = $1
    `,
    [normalizeWallet(ownerWallet)]
  );
}
