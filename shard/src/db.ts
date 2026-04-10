/**
 * PostgreSQL connection pool.
 * All durable game data (characters, chain ops, wallet registrations, agent configs)
 * should eventually live here instead of Redis-only storage.
 *
 * Usage:
 *   import { db } from "./db.js";
 *   const res = await db.query("SELECT * FROM characters WHERE wallet = $1", [wallet]);
 */

import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getDb(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set — PostgreSQL is required");
    }
    pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return pool;
}

/** Alias for convenience */
export const db = { query: (...args: Parameters<pg.Pool["query"]>) => getDb().query(...args) };

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Run on server startup — creates tables if they don't exist.
 * Idempotent; safe to call every boot.
 */
export async function runMigrations(): Promise<void> {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");

    // ── Characters ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS characters (
        wallet          TEXT NOT NULL,
        name            TEXT NOT NULL,
        data            JSONB NOT NULL,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (wallet, name)
      )
    `);

    // ── Wallet registrations ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_registrations (
        wallet          TEXT PRIMARY KEY,
        status          TEXT NOT NULL DEFAULT 'pending',
        sfuel_tx        TEXT,
        gold_tx         TEXT,
        treasury_wallet TEXT,
        operation_id    TEXT,
        last_error      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Chain operation queue ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS chain_operations (
        operation_id    TEXT PRIMARY KEY,
        type            TEXT NOT NULL,
        subject         TEXT NOT NULL,
        payload         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'queued',
        attempt_count   INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_attempt_at TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        tx_hash         TEXT,
        last_error      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS chain_operations_status_next
        ON chain_operations (status, next_attempt_at)
        WHERE status IN ('queued', 'failed_retryable')
    `);

    // ── Agent configs ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_configs (
        wallet          TEXT PRIMARY KEY,
        config          JSONB NOT NULL,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Custodial wallet mappings ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS custodial_wallets (
        user_wallet       TEXT PRIMARY KEY,
        custodial_address TEXT NOT NULL,
        encrypted_key     TEXT NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query("COMMIT");
    console.log("[db] migrations complete");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
