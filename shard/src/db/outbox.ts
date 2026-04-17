import { randomUUID } from "crypto";
import { postgresQuery } from "./postgres.js";

export type OutboxStatus = "pending" | "processing" | "published" | "failed";

export interface OutboxEventRecord<T = Record<string, unknown>> {
  eventId: string;
  topic: string;
  aggregateType: string;
  aggregateKey: string;
  payload: T;
  status: OutboxStatus;
  availableAt: string;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export async function enqueueOutboxEvent(params: {
  topic: string;
  aggregateType: string;
  aggregateKey: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
}): Promise<string> {
  const eventId = randomUUID();
  await postgresQuery(
    `
      insert into game.outbox_events (
        event_id,
        topic,
        aggregate_type,
        aggregate_key,
        payload_json,
        status,
        available_at
      ) values ($1, $2, $3, $4, $5::jsonb, 'pending', $6)
    `,
    [
      eventId,
      params.topic,
      params.aggregateType,
      params.aggregateKey,
      JSON.stringify(params.payload),
      params.availableAt ?? new Date(),
    ]
  );
  return eventId;
}

export async function listPendingOutboxEvents(limit = 100): Promise<OutboxEventRecord[]> {
  const { rows } = await postgresQuery<{
    event_id: string;
    topic: string;
    aggregate_type: string;
    aggregate_key: string;
    payload_json: Record<string, unknown>;
    status: OutboxStatus;
    available_at: string;
    attempt_count: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    published_at: string | null;
  }>(
    `
      select
        event_id,
        topic,
        aggregate_type,
        aggregate_key,
        payload_json,
        status,
        available_at::text as available_at,
        attempt_count,
        last_error,
        created_at::text as created_at,
        updated_at::text as updated_at,
        published_at::text as published_at
      from game.outbox_events
      where status in ('pending', 'failed')
        and available_at <= now()
      order by available_at asc, created_at asc
      limit $1
    `,
    [Math.max(1, limit)]
  );

  return rows.map((row) => ({
    eventId: row.event_id,
    topic: row.topic,
    aggregateType: row.aggregate_type,
    aggregateKey: row.aggregate_key,
    payload: row.payload_json ?? {},
    status: row.status,
    availableAt: row.available_at,
    attemptCount: Number(row.attempt_count ?? 0) || 0,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  }));
}

export async function markOutboxEventProcessing(eventId: string): Promise<void> {
  await postgresQuery(
    `
      update game.outbox_events
      set status = 'processing',
          attempt_count = attempt_count + 1,
          last_error = null,
          updated_at = now()
      where event_id = $1
    `,
    [eventId]
  );
}

export async function markOutboxEventPublished(eventId: string): Promise<void> {
  await postgresQuery(
    `
      update game.outbox_events
      set status = 'published',
          published_at = now(),
          updated_at = now(),
          last_error = null
      where event_id = $1
    `,
    [eventId]
  );
}

export async function markOutboxEventFailed(eventId: string, error: unknown, retryDelayMs = 30_000): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error ?? "unknown error")).slice(0, 400);
  await postgresQuery(
    `
      update game.outbox_events
      set status = 'failed',
          last_error = $2,
          available_at = now() + ($3::text || ' milliseconds')::interval,
          updated_at = now()
      where event_id = $1
    `,
    [eventId, message, Math.max(1_000, retryDelayMs)]
  );
}
