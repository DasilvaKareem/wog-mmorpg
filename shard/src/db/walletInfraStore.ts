import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { CharacterBootstrapJob } from "../character/characterBootstrap.js";

export async function upsertCustodialWallet(address: string, encryptedPrivateKey: string, createdAt: number): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.custodial_wallets (wallet_address, encrypted_private_key, created_at_ms, updated_at)
     values ($1,$2,$3,now())
     on conflict (wallet_address) do update set encrypted_private_key = excluded.encrypted_private_key, updated_at = now()`,
    [address.toLowerCase(), encryptedPrivateKey, createdAt]
  );
}

export async function getCustodialWalletRecord(address: string): Promise<{ encryptedPrivateKey: string; createdAt: number } | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ encrypted_private_key: string; created_at_ms: string }>(
    `select encrypted_private_key, created_at_ms::text from game.custodial_wallets where wallet_address = $1 limit 1`,
    [address.toLowerCase()]
  );
  return rows[0] ? { encryptedPrivateKey: rows[0].encrypted_private_key, createdAt: Number(rows[0].created_at_ms) } : null;
}

export async function deleteCustodialWalletRecord(address: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(`delete from game.custodial_wallets where wallet_address = $1`, [address.toLowerCase()]);
}

export async function listCustodialWalletRecords(): Promise<Array<{ address: string; createdAt: number }>> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ wallet_address: string; created_at_ms: string }>(
    `select wallet_address, created_at_ms::text from game.custodial_wallets`
  );
  return rows.map((r) => ({ address: r.wallet_address, createdAt: Number(r.created_at_ms) }));
}

export async function putWalletRuntimeState(key: string, payload: unknown): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.wallet_runtime_state (state_key, payload_json, updated_at)
     values ($1,$2::jsonb,now())
     on conflict (state_key) do update set payload_json = excluded.payload_json, updated_at = now()`,
    [key, JSON.stringify(payload)]
  );
}

export async function getWalletRuntimeState<T>(key: string): Promise<T | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: T }>(
    `select payload_json from game.wallet_runtime_state where state_key = $1 limit 1`,
    [key]
  );
  return rows[0]?.payload_json ?? null;
}

export async function listWalletRuntimeStatesByPrefix<T>(
  prefix: string
): Promise<Array<{ key: string; payload: T }>> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ state_key: string; payload_json: T }>(
    `select state_key, payload_json
       from game.wallet_runtime_state
      where state_key like $1
      order by state_key asc`,
    [`${prefix}%`]
  );
  return rows.map((row) => ({ key: row.state_key, payload: row.payload_json }));
}

export async function putWalletRegistrationState(address: string, payload: Record<string, string>): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.wallet_registration_state (wallet_address, status_json, updated_at)
     values ($1,$2::jsonb,now())
     on conflict (wallet_address) do update set status_json = excluded.status_json, updated_at = now()`,
    [address.toLowerCase(), JSON.stringify(payload)]
  );
}

export async function getWalletRegistrationState(address: string): Promise<Record<string, string> | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ status_json: Record<string, string> }>(
    `select status_json from game.wallet_registration_state where wallet_address = $1 limit 1`,
    [address.toLowerCase()]
  );
  return rows[0]?.status_json ?? null;
}

export async function upsertCharacterBootstrapJob(jobKey: string, job: CharacterBootstrapJob): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.character_bootstrap_jobs (
      job_key, wallet_address, character_name, status, next_attempt_at_ms, payload_json, updated_at
    ) values ($1,$2,$3,$4,$5,$6::jsonb,now())
    on conflict (job_key) do update set
      wallet_address = excluded.wallet_address,
      character_name = excluded.character_name,
      status = excluded.status,
      next_attempt_at_ms = excluded.next_attempt_at_ms,
      payload_json = excluded.payload_json,
      updated_at = now()`,
    [jobKey, job.walletAddress.toLowerCase(), job.characterName, job.status, job.nextAttemptAt, JSON.stringify(job)]
  );
}

export async function getCharacterBootstrapJobRecord(jobKey: string): Promise<CharacterBootstrapJob | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{ payload_json: CharacterBootstrapJob }>(
    `select payload_json from game.character_bootstrap_jobs where job_key = $1 limit 1`,
    [jobKey]
  );
  return rows[0]?.payload_json ?? null;
}

export async function listDueCharacterBootstrapJobKeys(now: number): Promise<string[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ job_key: string }>(
    `select job_key from game.character_bootstrap_jobs
      where status not in ('completed', 'failed_permanent')
        and next_attempt_at_ms <= $1
      order by next_attempt_at_ms asc`,
    [now]
  );
  return rows.map((r) => r.job_key);
}

export async function listDueCharacterBootstrapJobs(now: number): Promise<Array<{
  jobKey: string;
  walletAddress: string;
  characterName: string;
}>> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{
    job_key: string;
    wallet_address: string;
    character_name: string;
  }>(
    `select job_key, wallet_address, character_name
       from game.character_bootstrap_jobs
      where status not in ('completed', 'failed_permanent')
        and next_attempt_at_ms <= $1
      order by next_attempt_at_ms asc`,
    [now]
  );
  return rows.map((row) => ({
    jobKey: row.job_key,
    walletAddress: row.wallet_address,
    characterName: row.character_name,
  }));
}
