import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import {
  mintCharacterWithIdentity,
  recoverCharacterTokenIdFromTransaction,
  registerIdentity,
} from "../blockchain/blockchain.js";
import {
  isNameServiceEnabled,
  registerNameOnChain,
  reverseLookupOnChain,
} from "../blockchain/nameServiceChain.js";
import { reputationManager } from "../economy/reputationManager.js";
import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "../redis.js";
import { CLASS_DEFINITIONS } from "./classes.js";
import { RACE_DEFINITIONS } from "./races.js";
import { loadCharacter, saveCharacter } from "./characterStore.js";
import { getAllEntities } from "../world/zoneRuntime.js";
import { computeStatsAtLevel } from "./leveling.js";
import {
  getCharacterBootstrapJobRecord,
  listDueCharacterBootstrapJobs,
  listDueCharacterBootstrapJobKeys,
  upsertCharacterBootstrapJob,
} from "../db/walletInfraStore.js";
import { isPostgresConfigured } from "../db/postgres.js";
import { listAllCharacterProjections } from "./characterProjectionStore.js";
import { ensureWalletRegistrationQueued } from "../blockchain/wallet.js";

export type CharacterBootstrapStatus =
  | "queued"
  | "pending_mint"
  | "pending_mint_receipt"
  | "mint_confirmed"
  | "identity_pending"
  | "completed"
  | "failed_retryable"
  | "failed_permanent";

export interface CharacterBootstrapJob {
  walletAddress: string;
  characterName: string;
  status: CharacterBootstrapStatus;
  source: string;
  validationTags: string[];
  attemptCount: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  lastAttemptAt?: number;
  completedAt?: number;
  lastError?: string;
  mintTxHash?: string;
}

const memoryJobs = new Map<string, CharacterBootstrapJob>();
const memoryLocks = new Set<string>();
const memoryPending = new Set<string>();
const pendingIndexKey = "character:bootstrap:pending";
let workerTimer: NodeJS.Timeout | null = null;
let workerInFlight = false;
const CHARACTER_BOOTSTRAP_MAX_RETRIES = Math.max(
  0,
  Number.parseInt(process.env.CHARACTER_BOOTSTRAP_MAX_RETRIES ?? "8", 10) || 8
);
const NAME_AUTO_REGISTER_RETRY_COOLDOWN_MS = Number.parseInt(
  process.env.NAME_AUTO_REGISTER_RETRY_COOLDOWN_MS ?? "900000",
  10,
) || 900_000;
const nextNameAutoRegisterAttemptAt = new Map<string, number>();

export function getCharacterBootstrapMaxRetries(): number {
  return CHARACTER_BOOTSTRAP_MAX_RETRIES;
}

function normalizeWallet(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

function collapseCharacterName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function jobId(walletAddress: string, characterName: string): string {
  return `${normalizeWallet(walletAddress)}:${collapseCharacterName(characterName)}`;
}

function key(walletAddress: string, characterName: string): string {
  return `character:bootstrap:${jobId(walletAddress, characterName)}`;
}

function lockKey(walletAddress: string, characterName: string): string {
  return `character:bootstrap:lock:${jobId(walletAddress, characterName)}`;
}

function serializeJob(job: CharacterBootstrapJob): Record<string, string> {
  return {
    walletAddress: normalizeWallet(job.walletAddress),
    characterName: collapseCharacterName(job.characterName),
    status: job.status,
    source: job.source,
    validationTags: JSON.stringify(job.validationTags),
    attemptCount: String(job.attemptCount),
    nextAttemptAt: String(job.nextAttemptAt),
    createdAt: String(job.createdAt),
    updatedAt: String(job.updatedAt),
    ...(job.lastAttemptAt != null && { lastAttemptAt: String(job.lastAttemptAt) }),
    ...(job.completedAt != null && { completedAt: String(job.completedAt) }),
    ...(job.lastError ? { lastError: job.lastError } : {}),
    ...(job.mintTxHash ? { mintTxHash: job.mintTxHash } : {}),
  };
}

function parseJob(raw: Record<string, string>): CharacterBootstrapJob | null {
  if (!raw.walletAddress || !raw.characterName || !raw.status) return null;
  let validationTags: string[] = [];
  try {
    const parsed = JSON.parse(raw.validationTags ?? "[]");
    if (Array.isArray(parsed)) validationTags = parsed.map((value) => String(value));
  } catch {
    validationTags = [];
  }
  return {
    walletAddress: normalizeWallet(raw.walletAddress),
    characterName: collapseCharacterName(raw.characterName),
    status: raw.status as CharacterBootstrapStatus,
    source: raw.source ?? "unknown",
    validationTags,
    attemptCount: Number(raw.attemptCount ?? "0") || 0,
    nextAttemptAt: Number(raw.nextAttemptAt ?? "0") || 0,
    createdAt: Number(raw.createdAt ?? "0") || 0,
    updatedAt: Number(raw.updatedAt ?? "0") || 0,
    ...(raw.lastAttemptAt ? { lastAttemptAt: Number(raw.lastAttemptAt) || 0 } : {}),
    ...(raw.completedAt ? { completedAt: Number(raw.completedAt) || 0 } : {}),
    ...(raw.lastError ? { lastError: raw.lastError } : {}),
    ...(raw.mintTxHash ? { mintTxHash: raw.mintTxHash } : {}),
  };
}

async function saveJob(job: CharacterBootstrapJob): Promise<void> {
  if (isPostgresConfigured()) {
    await upsertCharacterBootstrapJob(key(job.walletAddress, job.characterName), job);
  }
  const redis = getRedis();
  if (redis) {
    await redis.hset(key(job.walletAddress, job.characterName), serializeJob(job));
    const staleFields: string[] = [];
    if (job.lastError == null) staleFields.push("lastError");
    if (job.completedAt == null) staleFields.push("completedAt");
    if (job.lastAttemptAt == null) staleFields.push("lastAttemptAt");
    if (job.mintTxHash == null) staleFields.push("mintTxHash");
    if (staleFields.length > 0) {
      await redis.hdel(key(job.walletAddress, job.characterName), ...staleFields);
    }
    if (job.status === "completed" || job.status === "failed_permanent") {
      await redis.zrem(pendingIndexKey, jobId(job.walletAddress, job.characterName));
    } else {
      await redis.zadd(pendingIndexKey, job.nextAttemptAt, jobId(job.walletAddress, job.characterName));
    }
    return;
  }

  assertRedisAvailable("characterBootstrap.saveJob");
  memoryJobs.set(key(job.walletAddress, job.characterName), job);
  if (job.status === "completed" || job.status === "failed_permanent") {
    memoryPending.delete(jobId(job.walletAddress, job.characterName));
  } else {
    memoryPending.add(jobId(job.walletAddress, job.characterName));
  }
}

export async function loadCharacterBootstrapJob(walletAddress: string, characterName: string): Promise<CharacterBootstrapJob | null> {
  if (isPostgresConfigured()) {
    const job = await getCharacterBootstrapJobRecord(key(walletAddress, characterName));
    if (job) return job;
  }
  const redis = getRedis();
  if (redis) {
    const raw = await redis.hgetall(key(walletAddress, characterName));
    if (!raw || Object.keys(raw).length === 0) return null;
    return parseJob(raw);
  }

  if (!isMemoryFallbackAllowed()) {
    assertRedisAvailable("characterBootstrap.loadJob");
    return null;
  }
  return memoryJobs.get(key(walletAddress, characterName)) ?? null;
}

function buildCharacterMetadata(saved: NonNullable<Awaited<ReturnType<typeof loadCharacter>>>) {
  const classDef = CLASS_DEFINITIONS.find((entry) => entry.id === saved.classId);
  const raceDef = RACE_DEFINITIONS.find((entry) => entry.id === saved.raceId);
  const className = classDef?.name ?? saved.classId;
  const raceName = raceDef?.name ?? saved.raceId;
  const callingLabel = saved.calling ? saved.calling.charAt(0).toUpperCase() + saved.calling.slice(1) : null;

  return {
    name: `${saved.name} the ${className}`,
    description: `Level ${saved.level} ${raceName} ${className}${callingLabel ? ` (${callingLabel})` : ""}`,
    properties: {
      race: saved.raceId,
      class: saved.classId,
      ...(saved.calling && { calling: saved.calling }),
      level: saved.level,
      xp: saved.xp,
      stats: computeStatsAtLevel(saved.raceId, saved.classId, saved.level),
    },
  };
}

function normalizeCharacterKey(name: string, classId?: string | null): string {
  const stripped = collapseCharacterName(name).replace(/\s+the\s+\w+$/i, "").trim().toLowerCase();
  return `${stripped}::${(classId ?? "").trim().toLowerCase()}`;
}

function updateRuntimeProjection(walletAddress: string, characterName: string, tokenId?: bigint | null, agentId?: bigint | null): void {
  const normalizedWallet = normalizeWallet(walletAddress);
  const normalizedName = collapseCharacterName(characterName);
  for (const entity of getAllEntities().values()) {
    if (entity.type !== "player") continue;
    if (entity.walletAddress?.toLowerCase() !== normalizedWallet) continue;
    if (collapseCharacterName(entity.name) !== normalizedName) continue;
    if (tokenId != null) entity.characterTokenId = tokenId;
    if (agentId != null) entity.agentId = agentId;
  }
}

async function sanitizeSavedIdentityState(
  _walletAddress: string,
  _characterName: string,
  saved: NonNullable<Awaited<ReturnType<typeof loadCharacter>>>,
): Promise<NonNullable<Awaited<ReturnType<typeof loadCharacter>>>> {
  return saved;
}

async function ensureNameRegistered(walletAddress: string, characterName: string, logger?: FastifyBaseLogger): Promise<void> {
  if (!isNameServiceEnabled()) return;
  const walletKey = normalizeWallet(walletAddress);
  const desiredName = collapseCharacterName(characterName).toLowerCase();
  const now = Date.now();
  const nextAllowedAttempt = nextNameAutoRegisterAttemptAt.get(walletKey) ?? 0;
  if (now < nextAllowedAttempt) return;
  try {
    const currentName = await reverseLookupOnChain(walletAddress).catch(() => null);
    if (currentName?.trim().toLowerCase() === desiredName) {
      nextNameAutoRegisterAttemptAt.delete(walletKey);
      return;
    }
    const registered = await registerNameOnChain(walletAddress, characterName);
    if (registered) {
      nextNameAutoRegisterAttemptAt.delete(walletKey);
      logger?.info(`[nameService] Auto-registered "${characterName}.wog" for ${walletAddress}`);
    } else {
      nextNameAutoRegisterAttemptAt.set(walletKey, now + NAME_AUTO_REGISTER_RETRY_COOLDOWN_MS);
      logger?.warn(
        `[nameService] Auto-register did not complete for ${walletAddress}; backing off for ${Math.round(
          NAME_AUTO_REGISTER_RETRY_COOLDOWN_MS / 1000,
        )}s`,
      );
    }
  } catch (err) {
    nextNameAutoRegisterAttemptAt.set(walletKey, now + NAME_AUTO_REGISTER_RETRY_COOLDOWN_MS);
    logger?.warn(`[nameService] Auto-register failed for ${walletAddress}: ${(err as Error).message}`);
  }
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attemptCount, 5));
}

function truncateError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 240);
}

function toCharacterRegistrationStatus(
  status: CharacterBootstrapStatus
): NonNullable<Awaited<ReturnType<typeof loadCharacter>>>["chainRegistrationStatus"] {
  switch (status) {
    case "pending_mint":
    case "pending_mint_receipt":
      return "pending_mint";
    case "mint_confirmed":
      return "mint_confirmed";
    case "identity_pending":
      return "identity_pending";
    case "completed":
      return "registered";
    case "failed_retryable":
      return "failed_retryable";
    case "failed_permanent":
      return "failed_permanent";
    case "queued":
    default:
      return "unregistered";
  }
}

async function syncCharacterRegistrationState(
  walletAddress: string,
  characterName: string,
  job: CharacterBootstrapJob
): Promise<void> {
  await saveCharacter(walletAddress, characterName, {
    chainRegistrationStatus: toCharacterRegistrationStatus(job.status),
    ...(job.lastError ? { chainRegistrationLastError: job.lastError } : { chainRegistrationLastError: "" }),
  });
}

async function markRetryable(job: CharacterBootstrapJob, err: unknown): Promise<CharacterBootstrapJob> {
  const now = Date.now();
  const attemptCount = job.attemptCount + 1;
  if (attemptCount >= CHARACTER_BOOTSTRAP_MAX_RETRIES) {
    return await markPermanent(
      { ...job, attemptCount, updatedAt: now, lastAttemptAt: now },
      `max retries exceeded: ${truncateError(err)}`
    );
  }
  const updated: CharacterBootstrapJob = {
    ...job,
    status: "failed_retryable",
    attemptCount,
    nextAttemptAt: now + retryDelayMs(attemptCount),
    updatedAt: now,
    lastAttemptAt: now,
    lastError: truncateError(err),
  };
  await saveJob(updated);
  await syncCharacterRegistrationState(job.walletAddress, job.characterName, updated);
  return updated;
}

export async function markCharacterBootstrapRetryableFailure(
  walletAddress: string,
  characterName: string,
  err: unknown
): Promise<CharacterBootstrapJob | null> {
  const job = await loadCharacterBootstrapJob(walletAddress, characterName);
  if (!job) return null;
  return await markRetryable(job, err);
}

async function markPermanent(job: CharacterBootstrapJob, message: string): Promise<CharacterBootstrapJob> {
  const now = Date.now();
  const updated: CharacterBootstrapJob = {
    ...job,
    status: "failed_permanent",
    nextAttemptAt: 0,
    updatedAt: now,
    lastAttemptAt: now,
    lastError: message.slice(0, 240),
  };
  await saveJob(updated);
  await syncCharacterRegistrationState(job.walletAddress, job.characterName, updated);
  return updated;
}

async function acquireLock(walletAddress: string, characterName: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    const result = await redis.set(lockKey(walletAddress, characterName), String(Date.now()), "PX", 30_000, "NX");
    return result === "OK";
  }

  if (!isMemoryFallbackAllowed()) {
    assertRedisAvailable("characterBootstrap.acquireLock");
    return false;
  }

  const lock = lockKey(walletAddress, characterName);
  if (memoryLocks.has(lock)) return false;
  memoryLocks.add(lock);
  return true;
}

function startLockHeartbeat(walletAddress: string, characterName: string): NodeJS.Timeout | null {
  const redis = getRedis();
  if (!redis) return null;
  const keyName = lockKey(walletAddress, characterName);
  return setInterval(() => {
    void redis.pexpire(keyName, 30_000).catch(() => {});
  }, 10_000);
}

async function releaseLock(walletAddress: string, characterName: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.del(lockKey(walletAddress, characterName));
    return;
  }
  memoryLocks.delete(lockKey(walletAddress, characterName));
}

export async function enqueueCharacterBootstrap(
  walletAddress: string,
  characterName: string,
  source: string,
  validationTags: string[] = []
): Promise<CharacterBootstrapJob> {
  const now = Date.now();
  const existing = await loadCharacterBootstrapJob(walletAddress, characterName);
  const job: CharacterBootstrapJob = existing
    ? {
        ...existing,
        status: existing.status === "completed" ? "queued" : existing.status,
        source,
        validationTags: Array.from(new Set([...existing.validationTags, ...validationTags])),
        nextAttemptAt: now,
        updatedAt: now,
        lastError: undefined,
        completedAt: undefined,
      }
    : {
        walletAddress: normalizeWallet(walletAddress),
        characterName: collapseCharacterName(characterName),
        status: "queued",
        source,
        validationTags: Array.from(new Set(validationTags)),
        attemptCount: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      };
  await saveJob(job);
  await syncCharacterRegistrationState(walletAddress, characterName, job);
  return job;
}

export async function processCharacterBootstrapJob(
  walletAddress: string,
  characterName: string,
  logger?: FastifyBaseLogger
): Promise<CharacterBootstrapJob | null> {
  const job = await loadCharacterBootstrapJob(walletAddress, characterName);
  if (!job) return null;
  if (!(await acquireLock(walletAddress, characterName))) return job;
  const heartbeat = startLockHeartbeat(walletAddress, characterName);

  try {
    const loaded = await loadCharacter(walletAddress, characterName);
    if (!loaded) {
      return await markPermanent(job, "Character save missing");
    }
    const saved = await sanitizeSavedIdentityState(walletAddress, characterName, loaded);

    const metadata = buildCharacterMetadata(saved);
    let tokenId = saved.characterTokenId ? BigInt(saved.characterTokenId) : null;
    let agentId = saved.agentId ? BigInt(saved.agentId) : null;
    let currentJob = job;

    if (tokenId == null) {
      let mintIdentityTxHash: string | null = null;
      if (currentJob.mintTxHash) {
        const recoveredTokenId = await recoverCharacterTokenIdFromTransaction(currentJob.mintTxHash);
        if (recoveredTokenId != null) {
          tokenId = recoveredTokenId;
          await saveCharacter(walletAddress, characterName, {
            characterTokenId: tokenId.toString(),
            chainRegistrationStatus: "mint_confirmed",
            chainRegistrationLastError: "",
          });
          updateRuntimeProjection(walletAddress, characterName, tokenId, agentId);
          currentJob = {
            ...currentJob,
            status: agentId != null ? "completed" : "mint_confirmed",
            updatedAt: Date.now(),
            lastError: undefined,
            ...(agentId != null && { completedAt: Date.now() }),
          };
          await saveJob(currentJob);
        } else {
          currentJob = {
            ...currentJob,
            status: "pending_mint_receipt",
            nextAttemptAt: Date.now() + 5_000,
            updatedAt: Date.now(),
            lastError: undefined,
          };
          await saveJob(currentJob);
          await syncCharacterRegistrationState(walletAddress, characterName, currentJob);
          return currentJob;
        }
      }
    }

    if (tokenId == null) {
      let mintIdentityTxHash: string | null = null;
      currentJob = {
        ...currentJob,
        status: "pending_mint",
        updatedAt: Date.now(),
      };
      await saveJob(currentJob);
      await syncCharacterRegistrationState(walletAddress, characterName, currentJob);

      const mintResult = await mintCharacterWithIdentity(
        walletAddress,
        metadata,
        currentJob.validationTags,
        { skipIdentityRegistration: true }
      );
      if (mintResult.tokenId == null) {
        currentJob = {
          ...currentJob,
          status: "pending_mint_receipt",
          mintTxHash: mintResult.txHash,
          nextAttemptAt: Date.now() + 5_000,
          updatedAt: Date.now(),
          lastError: undefined,
        };
        await saveJob(currentJob);
        await syncCharacterRegistrationState(walletAddress, characterName, currentJob);
        return currentJob;
      }
      tokenId = mintResult.tokenId;
      if (mintResult.identity?.agentId != null) {
        agentId = mintResult.identity.agentId;
      }
      mintIdentityTxHash = mintResult.identity?.txHash ?? null;

      await saveCharacter(walletAddress, characterName, {
        characterTokenId: tokenId.toString(),
        ...(agentId != null && { agentId: agentId.toString() }),
        ...(mintIdentityTxHash ? { agentRegistrationTxHash: mintIdentityTxHash } : {}),
        chainRegistrationStatus: agentId != null ? "registered" : "mint_confirmed",
        chainRegistrationLastError: "",
      });
      updateRuntimeProjection(walletAddress, characterName, tokenId, agentId);
      currentJob = {
        ...currentJob,
        status: agentId != null ? "completed" : "mint_confirmed",
        mintTxHash: mintResult.txHash,
        updatedAt: Date.now(),
        lastError: undefined,
        ...(agentId != null && { completedAt: Date.now() }),
      };
      await saveJob(currentJob);
    }

    if (tokenId != null && agentId == null) {
      currentJob = {
        ...currentJob,
        status: "identity_pending",
        updatedAt: Date.now(),
      };
      await saveJob(currentJob);
      await syncCharacterRegistrationState(walletAddress, characterName, currentJob);

      const identityResult = await registerIdentity(tokenId, walletAddress, "", {
        validationTags: currentJob.validationTags,
      });
      const identityTxHash = identityResult.txHash ?? null;
      if (identityResult.agentId == null) {
        throw new Error(`Identity registration did not return agentId for characterTokenId=${tokenId.toString()}`);
      }
      agentId = identityResult.agentId;

      await saveCharacter(walletAddress, characterName, {
        agentId: agentId.toString(),
        ...(identityTxHash ? { agentRegistrationTxHash: identityTxHash } : {}),
      });
      await saveCharacter(walletAddress, characterName, {
        chainRegistrationStatus: "registered",
        chainRegistrationLastError: "",
      });
      updateRuntimeProjection(walletAddress, characterName, tokenId, agentId);
      reputationManager.ensureInitialized(agentId);
      currentJob = {
        ...currentJob,
        status: "completed",
        updatedAt: Date.now(),
        completedAt: Date.now(),
        lastError: undefined,
      };
      await saveJob(currentJob);
    }

    if (agentId != null) {
      reputationManager.ensureInitialized(agentId);
    }
    if (currentJob.status === "completed") {
      await ensureNameRegistered(walletAddress, characterName, logger);
    }
    return await loadCharacterBootstrapJob(walletAddress, characterName);
  } catch (err) {
    logger?.warn(`[character-bootstrap] ${walletAddress}:${characterName} failed: ${truncateError(err)}`);
    const latest = await loadCharacterBootstrapJob(walletAddress, characterName);
    return await markRetryable(latest ?? job, err);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await releaseLock(walletAddress, characterName);
  }
}

async function listDueJobs(now: number): Promise<Array<{ walletAddress: string; characterName: string }>> {
  if (isPostgresConfigured()) {
    const jobs = await listDueCharacterBootstrapJobs(now);
    if (jobs.length > 0) {
      return jobs.map((job) => ({
        walletAddress: normalizeWallet(job.walletAddress),
        characterName: collapseCharacterName(job.characterName),
      }));
    }
  }
  const redis = getRedis();
  if (redis) {
    const values = await redis.zrangebyscore(pendingIndexKey, 0, now);
    return values
      .map((value: string) => parseJobId(value))
      .filter((value: { walletAddress: string; characterName: string } | null): value is { walletAddress: string; characterName: string } => value != null);
  }

  if (!isMemoryFallbackAllowed()) {
    assertRedisAvailable("characterBootstrap.listDueJobs");
    return [];
  }
  return Array.from(memoryPending.values())
    .map((value: string) => parseJobId(value))
    .filter((value: { walletAddress: string; characterName: string } | null): value is { walletAddress: string; characterName: string } => value != null);
}

function parseJobId(value: string): { walletAddress: string; characterName: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  return {
    walletAddress: value.slice(0, separator),
    characterName: value.slice(separator + 1),
  };
}

export async function processPendingCharacterBootstraps(logger?: FastifyBaseLogger): Promise<number> {
  const dueJobs = await listDueJobs(Date.now());
  let processed = 0;
  for (const due of dueJobs) {
    await processCharacterBootstrapJob(due.walletAddress, due.characterName, logger);
    processed++;
  }
  return processed;
}

function shouldAutoQueueBootstrap(params: {
  chainRegistrationStatus: string | null | undefined;
  agentId: string | null | undefined;
  existingJob: CharacterBootstrapJob | null;
}): boolean {
  const status = params.chainRegistrationStatus ?? "unregistered";
  if (params.agentId) return false;
  if (status === "registered" || status === "failed_permanent") return false;

  const job = params.existingJob;
  if (!job) return true;
  if (job.status === "completed" || job.status === "failed_permanent") {
    return status !== "registered";
  }
  return false;
}

export async function reconcileMissingCharacterBootstrapJobs(logger?: FastifyBaseLogger): Promise<number> {
  if (!isPostgresConfigured()) return 0;

  const projections = await listAllCharacterProjections();
  let enqueued = 0;

  for (const projection of projections) {
    const existingJob = await loadCharacterBootstrapJob(projection.walletAddress, projection.characterName);
    if (!shouldAutoQueueBootstrap({
      chainRegistrationStatus: projection.chainRegistrationStatus,
      agentId: projection.agentId,
      existingJob,
    })) {
      continue;
    }

    await enqueueCharacterBootstrap(
      projection.walletAddress,
      projection.characterName,
      "character:auto-reconcile",
      ["wog:a2a-enabled"]
    );
    enqueued++;
  }

  if (enqueued > 0) {
    logger?.info(`[character-bootstrap] Auto-enqueued ${enqueued} missing bootstrap job(s) from persisted character state`);
  }

  return enqueued;
}

export async function reconcileImportedPlayerBootstrap(server: FastifyInstance): Promise<{
  walletQueued: number;
  walletAlreadyQueued: number;
  characterQueued: number;
}> {
  if (!isPostgresConfigured()) {
    return { walletQueued: 0, walletAlreadyQueued: 0, characterQueued: 0 };
  }

  const projections = await listAllCharacterProjections();
  const seenWallets = new Set<string>();
  let walletQueued = 0;
  let walletAlreadyQueued = 0;

  for (const projection of projections) {
    const walletAddress = normalizeWallet(projection.walletAddress);
    if (seenWallets.has(walletAddress)) continue;
    seenWallets.add(walletAddress);

    const result = await ensureWalletRegistrationQueued(server, walletAddress);
    if (result === "queued") walletQueued += 1;
    if (result === "already_queued") walletAlreadyQueued += 1;
  }

  const characterQueued = await reconcileMissingCharacterBootstrapJobs(server.log);
  if (walletQueued > 0 || walletAlreadyQueued > 0 || characterQueued > 0) {
    server.log.info(
      `[bootstrap-reconcile] queued wallets=${walletQueued}, active-wallet-ops=${walletAlreadyQueued}, character-jobs=${characterQueued}`
    );
  }

  return { walletQueued, walletAlreadyQueued, characterQueued };
}

export async function startCharacterBootstrapWorker(server: FastifyInstance): Promise<void> {
  if (workerTimer) return;

  await reconcileImportedPlayerBootstrap(server);

  const run = async () => {
    if (workerInFlight) return;
    workerInFlight = true;
    try {
      await processPendingCharacterBootstraps(server.log);
    } finally {
      workerInFlight = false;
    }
  };

  void run();
  workerTimer = setInterval(() => {
    void run();
  }, 5_000);
}
