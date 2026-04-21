import { postgresQuery, withPostgresClient } from "./postgres.js";

function normalizeWallet(value: string): string {
  return value.trim().toLowerCase();
}

function collapseCharacterName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// Mirror of characterProjectionStore.normalizeCharacterName — keep in sync so the
// table keys off the same identity as game.character_projections.
function normalizeCharacterName(value: string): string {
  return collapseCharacterName(value).replace(/\s+the\s+\w+$/i, "").trim().toLowerCase();
}

export async function markQuestCompleted(params: {
  walletAddress: string;
  characterName: string;
  questId: string;
}): Promise<void> {
  const walletAddress = normalizeWallet(params.walletAddress);
  const normalizedName = normalizeCharacterName(params.characterName);
  const questId = params.questId.trim();
  if (!walletAddress || !normalizedName || !questId) return;

  await postgresQuery(
    `
      insert into game.character_completed_quests (
        wallet_address,
        normalized_name,
        quest_id,
        completed_at
      ) values ($1, $2, $3, now())
      on conflict (wallet_address, normalized_name, quest_id) do nothing
    `,
    [walletAddress, normalizedName, questId]
  );
}

export async function hasCompletedQuest(params: {
  walletAddress: string;
  characterName: string;
  questId: string;
}): Promise<boolean> {
  const walletAddress = normalizeWallet(params.walletAddress);
  const normalizedName = normalizeCharacterName(params.characterName);
  const questId = params.questId.trim();
  if (!walletAddress || !normalizedName || !questId) return false;

  const { rows } = await postgresQuery<{ exists: boolean }>(
    `
      select exists(
        select 1
        from game.character_completed_quests
        where wallet_address = $1
          and normalized_name = $2
          and quest_id = $3
      ) as exists
    `,
    [walletAddress, normalizedName, questId]
  );
  return Boolean(rows[0]?.exists);
}

export async function listCompletedQuests(params: {
  walletAddress: string;
  characterName: string;
}): Promise<string[]> {
  const walletAddress = normalizeWallet(params.walletAddress);
  const normalizedName = normalizeCharacterName(params.characterName);
  if (!walletAddress || !normalizedName) return [];

  const { rows } = await postgresQuery<{ quest_id: string }>(
    `
      select quest_id
      from game.character_completed_quests
      where wallet_address = $1
        and normalized_name = $2
    `,
    [walletAddress, normalizedName]
  );
  return rows.map((row) => row.quest_id);
}

/**
 * One-time backfill from game.character_projections.snapshot_json into
 * game.character_completed_quests. Safe to run repeatedly — every insert uses
 * on conflict do nothing. Returns {scanned, inserted} for logging.
 */
export async function backfillFromCharacterProjections(): Promise<{
  scanned: number;
  inserted: number;
}> {
  const { rows } = await postgresQuery<{
    wallet_address: string;
    character_name: string;
    snapshot_json: Record<string, unknown> | null;
  }>(
    `
      select wallet_address, character_name, snapshot_json
      from game.character_projections
      where snapshot_json ? 'completedQuests'
    `
  );

  let inserted = 0;
  for (const row of rows) {
    const raw = row.snapshot_json?.completedQuests;
    const questIds = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
    if (questIds.length === 0) continue;
    try {
      inserted += await bulkInsertCompletedQuests({
        walletAddress: row.wallet_address,
        characterName: row.character_name,
        questIds,
      });
    } catch (err) {
      console.warn(
        `[questBackfill] Failed for ${row.wallet_address}:${row.character_name}: ${String((err as Error)?.message ?? err).slice(0, 140)}`
      );
    }
  }
  return { scanned: rows.length, inserted };
}

export async function bulkInsertCompletedQuests(params: {
  walletAddress: string;
  characterName: string;
  questIds: string[];
}): Promise<number> {
  const walletAddress = normalizeWallet(params.walletAddress);
  const normalizedName = normalizeCharacterName(params.characterName);
  const questIds = Array.from(new Set(params.questIds.map((q) => q.trim()).filter(Boolean)));
  if (!walletAddress || !normalizedName || questIds.length === 0) return 0;

  let inserted = 0;
  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      for (const questId of questIds) {
        const res = await client.query(
          `
            insert into game.character_completed_quests (
              wallet_address,
              normalized_name,
              quest_id,
              completed_at
            ) values ($1, $2, $3, now())
            on conflict (wallet_address, normalized_name, quest_id) do nothing
          `,
          [walletAddress, normalizedName, questId]
        );
        inserted += res.rowCount ?? 0;
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
  return inserted;
}
