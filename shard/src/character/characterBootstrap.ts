import type { FastifyBaseLogger } from "fastify";
import { getOwnedCharacters, mintCharacterWithIdentity, registerIdentity, findIdentityByCharacterTokenId } from "../blockchain/blockchain.js";
import { reverseLookupOnChain, registerNameOnChain } from "../blockchain/nameServiceChain.js";
import { reputationManager } from "../economy/reputationManager.js";
import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "../redis.js";
import { CLASS_DEFINITIONS } from "./classes.js";
import { RACE_DEFINITIONS } from "./races.js";
import { loadCharacter, saveCharacter } from "./characterStore.js";
import { getAllEntities } from "../world/zoneRuntime.js";
import { computeStatsAtLevel } from "./leveling.js";

export type CharacterBootstrapStatus =
  | "queued"
  | "pending_mint"
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
  };
}

async function saveJob(job: CharacterBootstrapJob): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.hset(key(job.walletAddress, job.characterName), serializeJob(job));
    const staleFields: string[] = [];
    if (job.lastError == null) staleFields.push("lastError");
    if (job.completedAt == null) staleFields.push("completedAt");
    if (job.lastAttemptAt == null) staleFields.push("lastAttemptAt");
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

async function reconcileCharacterTokenFromChain(walletAddress: string, characterName: string, classId: string): Promise<bigint | null> {
  const desiredKey = normalizeCharacterKey(characterName, classId);
  const owned = await getOwnedCharacters(walletAddress);
  for (const nft of owned) {
    const props = (nft.metadata?.properties ?? {}) as Record<string, unknown>;
    const candidateKey = normalizeCharacterKey(String(nft.metadata?.name ?? ""), typeof props.class === "string" ? props.class : null);
    if (candidateKey !== desiredKey) continue;
    try {
      return BigInt(nft.id.toString());
    } catch {
      continue;
    }
  }
  return null;
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

async function ensureNameRegistered(walletAddress: string, characterName: string, logger?: FastifyBaseLogger): Promise<void> {
  try {
    const existing = await reverseLookupOnChain(walletAddress);
    if (existing) return;
    const registered = await registerNameOnChain(walletAddress, characterName);
    if (registered) {
      logger?.info(`[nameService] Auto-registered "${characterName}.wog" for ${walletAddress}`);
    } else {
      logger?.warn(`[nameService] Auto-register did not complete for ${walletAddress}`);
    }
  } catch (err) {
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

  try {
    const saved = await loadCharacter(walletAddress, characterName);
    if (!saved) {
      return await markPermanent(job, "Character save missing");
    }

    const metadata = buildCharacterMetadata(saved);
    let tokenId = saved.characterTokenId ? BigInt(saved.characterTokenId) : null;
    let agentId = saved.agentId ? BigInt(saved.agentId) : null;
    let currentJob = job;

    if (tokenId == null) {
      currentJob = {
        ...currentJob,
        status: "pending_mint",
        updatedAt: Date.now(),
      };
      await saveJob(currentJob);
      await syncCharacterRegistrationState(walletAddress, characterName, currentJob);

      const recoveredTokenId = await reconcileCharacterTokenFromChain(walletAddress, characterName, saved.classId);
      if (recoveredTokenId != null) {
        tokenId = recoveredTokenId;
      } else {
        const mintResult = await mintCharacterWithIdentity(walletAddress, metadata, currentJob.validationTags);
        if (mintResult.tokenId == null) {
          throw new Error("Character mint completed without tokenId");
        }
        tokenId = mintResult.tokenId;
        if (mintResult.identity?.agentId != null) {
          agentId = mintResult.identity.agentId;
        }
      }

      await saveCharacter(walletAddress, characterName, {
        characterTokenId: tokenId.toString(),
        ...(agentId != null && { agentId: agentId.toString() }),
        chainRegistrationStatus: agentId != null ? "registered" : "mint_confirmed",
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
    }

    if (tokenId != null && agentId == null) {
      currentJob = {
        ...currentJob,
        status: "identity_pending",
        updatedAt: Date.now(),
      };
      await saveJob(currentJob);
      await syncCharacterRegistrationState(walletAddress, characterName, currentJob);

      const recoveredIdentity = await findIdentityByCharacterTokenId(tokenId);
      if (recoveredIdentity?.agentId != null) {
        agentId = recoveredIdentity.agentId;
      } else {
        const identityResult = await registerIdentity(tokenId, walletAddress, "", {
          validationTags: currentJob.validationTags,
        });
        if (identityResult.agentId == null) {
          throw new Error(`Identity registration did not return agentId for characterTokenId=${tokenId.toString()}`);
        }
        agentId = identityResult.agentId;
      }

      await saveCharacter(walletAddress, characterName, { agentId: agentId.toString() });
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
    await ensureNameRegistered(walletAddress, characterName, logger);
    return await loadCharacterBootstrapJob(walletAddress, characterName);
  } catch (err) {
    logger?.warn(`[character-bootstrap] ${walletAddress}:${characterName} failed: ${truncateError(err)}`);
    const latest = await loadCharacterBootstrapJob(walletAddress, characterName);
    return await markRetryable(latest ?? job, err);
  } finally {
    await releaseLock(walletAddress, characterName);
  }
}

async function listDueJobs(now: number): Promise<string[]> {
  const redis = getRedis();
  if (redis) {
    return await redis.zrangebyscore(pendingIndexKey, 0, now);
  }

  if (!isMemoryFallbackAllowed()) {
    assertRedisAvailable("characterBootstrap.listDueJobs");
    return [];
  }
  return Array.from(memoryPending.values());
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
  for (const value of dueJobs) {
    const parsed = parseJobId(value);
    if (!parsed) continue;
    await processCharacterBootstrapJob(parsed.walletAddress, parsed.characterName, logger);
    processed++;
  }
  return processed;
}

export async function startCharacterBootstrapWorker(logger?: FastifyBaseLogger): Promise<void> {
  if (workerTimer) return;

  const run = async () => {
    if (workerInFlight) return;
    workerInFlight = true;
    try {
      await processPendingCharacterBootstraps(logger);
    } finally {
      workerInFlight = false;
    }
  };

  await run();
  workerTimer = setInterval(() => {
    void run();
  }, 5_000);
}
