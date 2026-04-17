import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let initialized = false;
let postgresConfigured = false;
let lastPostgresError: string | null = null;

function resolveDatabaseUrl(): string | null {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_DSN,
  ];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://")) {
      return trimmed;
    }
  }

  return null;
}

export async function initPostgres(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const connectionString = resolveDatabaseUrl();
  postgresConfigured = Boolean(connectionString);
  if (!connectionString) {
    return;
  }

  try {
    const nextPool = new Pool({
      connectionString,
      max: Number.parseInt(process.env.POSTGRES_POOL_MAX ?? "10", 10) || 10,
      idleTimeoutMillis: 30_000,
      ssl: /sslmode=require/i.test(connectionString) ? { rejectUnauthorized: false } : undefined,
    });

    nextPool.on("error", (err: Error) => {
      lastPostgresError = err.message;
      console.warn("[postgres] Pool error:", err.message);
    });

    await nextPool.query("select 1");
    pool = nextPool;
    lastPostgresError = null;
    console.log("[postgres] Connected");
  } catch (err: any) {
    lastPostgresError = err?.message ?? String(err);
    pool = null;
    console.error("[postgres] Failed to connect:", lastPostgresError);
  }
}

export function getPostgres(): Pool | null {
  return pool;
}

export function isPostgresConfigured(): boolean {
  return postgresConfigured;
}

export function assertPostgresAvailable(context: string): void {
  if (pool) return;
  if (!postgresConfigured) {
    throw new Error(`[postgres] ${context}: DATABASE_URL is not configured`);
  }
  throw new Error(`[postgres] ${context}: Postgres is unavailable${lastPostgresError ? ` (${lastPostgresError})` : ""}`);
}

export async function withPostgresClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  assertPostgresAvailable("withPostgresClient");
  const client = await pool!.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function postgresQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  assertPostgresAvailable("postgresQuery");
  return await pool!.query<T>(text, values);
}
