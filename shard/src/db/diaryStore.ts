import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { DiaryEntry } from "../social/diary.js";

export async function insertDiaryEntry(entry: DiaryEntry): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.diary_entries (entry_id, wallet_address, timestamp_ms, payload_json, updated_at)
     values ($1,$2,$3,$4::jsonb,now())`,
    [entry.id, entry.walletAddress.toLowerCase(), entry.timestamp, JSON.stringify(entry)]
  );
}

export async function listDiaryEntries(walletAddress: string, limit: number, offset: number): Promise<DiaryEntry[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ payload_json: DiaryEntry }>(
    `select payload_json
       from game.diary_entries
      where wallet_address = $1
      order by timestamp_ms desc
      limit $2 offset $3`,
    [walletAddress.toLowerCase(), limit, offset]
  );
  return rows.map((row) => row.payload_json);
}
