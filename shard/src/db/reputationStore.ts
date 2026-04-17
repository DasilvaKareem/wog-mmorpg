import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { ReputationFeedback, ReputationScore } from "../economy/reputationManager.js";

export async function upsertReputationScore(agentId: string, score: ReputationScore): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.reputation_scores (agent_id, payload_json, last_updated_ms, updated_at)
     values ($1,$2::jsonb,$3,now())
     on conflict (agent_id) do update set payload_json = excluded.payload_json, last_updated_ms = excluded.last_updated_ms, updated_at = now()`,
    [agentId, JSON.stringify(score), score.lastUpdated]
  );
}

export async function getReputationScore(agentId: string): Promise<ReputationScore | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: ReputationScore }>(
    `select payload_json from game.reputation_scores where agent_id = $1 limit 1`,
    [agentId]
  );
  return rows[0]?.payload_json ?? null;
}

export async function insertReputationFeedback(feedback: ReputationFeedback): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.reputation_feedback (agent_id, payload_json, timestamp_ms, updated_at)
     values ($1,$2::jsonb,$3,now())`,
    [feedback.agentId, JSON.stringify(feedback), feedback.timestamp]
  );
}

export async function listReputationFeedback(agentId: string, limit: number): Promise<ReputationFeedback[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ payload_json: ReputationFeedback }>(
    `select payload_json
       from game.reputation_feedback
      where agent_id = $1
      order by timestamp_ms desc
      limit $2`,
    [agentId, limit]
  );
  return rows.map((r) => r.payload_json);
}

export async function listReputationTimeline(agentId: string, limit: number): Promise<Array<{ ts: number; combat: number; economic: number; social: number; crafting: number; agent: number; overall: number; category?: string; delta?: number; reason?: string }>> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ payload_json: { ts?: number; combat: number; economic: number; social: number; crafting: number; agent: number; overall: number; category?: string; delta?: number; reason?: string }; timestamp_ms: string }>(
    `select payload_json, timestamp_ms::text
       from game.reputation_feedback
      where agent_id = $1
      order by timestamp_ms desc
      limit $2`,
    [agentId, limit]
  );
  return rows.map((row) => ({ ts: Number(row.timestamp_ms), ...row.payload_json }));
}
