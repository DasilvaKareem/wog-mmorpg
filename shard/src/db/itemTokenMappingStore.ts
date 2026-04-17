import { isPostgresConfigured, postgresQuery } from "./postgres.js";

export interface PersistedItemTokenMapping {
  gameTokenId: string;
  chainTokenId: string;
  itemName: string;
}

export async function listItemTokenMappings(): Promise<PersistedItemTokenMapping[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{
    game_token_id: string;
    chain_token_id: string;
    item_name: string;
  }>(
    `select game_token_id::text, chain_token_id::text, item_name
       from game.item_token_mappings
      order by chain_token_id asc`
  );
  return rows.map((row) => ({
    gameTokenId: row.game_token_id,
    chainTokenId: row.chain_token_id,
    itemName: row.item_name,
  }));
}

export async function upsertItemTokenMappings(entries: PersistedItemTokenMapping[]): Promise<void> {
  if (!isPostgresConfigured() || entries.length === 0) return;
  for (const entry of entries) {
    await postgresQuery(
      `insert into game.item_token_mappings (
        game_token_id, chain_token_id, item_name, updated_at
      ) values ($1, $2, $3, now())
      on conflict (game_token_id) do update set
        chain_token_id = excluded.chain_token_id,
        item_name = excluded.item_name,
        updated_at = now()`,
      [entry.gameTokenId, entry.chainTokenId, entry.itemName]
    );
  }
}
