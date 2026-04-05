import "dotenv/config";
import crypto from "node:crypto";
import Fastify from "fastify";
import { ethers } from "ethers";
import {
  generateAuthToken,
  verifyWalletSignature,
  walletsMatch,
} from "../src/auth/auth.js";
import { validateCharacterInput, computeCharacter } from "../src/character/characterCreate.js";
import { saveCharacter, loadCharacter } from "../src/character/characterStore.js";
import {
  enqueueCharacterBootstrap,
  loadCharacterBootstrapJob,
  processCharacterBootstrapJob,
} from "../src/character/characterBootstrap.js";
import { registerWalletWithWelcomeBonus } from "../src/blockchain/wallet.js";
import { computeStatsAtLevel } from "../src/character/leveling.js";
import { getRedis } from "../src/redis.js";

type BootstrapStatus =
  | "queued"
  | "pending_mint"
  | "mint_confirmed"
  | "identity_pending"
  | "completed"
  | "failed_retryable"
  | "failed_permanent";

function collapseCharacterName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function jobRedisKey(walletAddress: string, characterName: string): string {
  return `character:bootstrap:${walletAddress.toLowerCase()}:${collapseCharacterName(characterName)}`;
}

async function waitForJobStatus(
  walletAddress: string,
  characterName: string,
  predicate: (status: BootstrapStatus) => boolean,
  timeoutMs = 180_000,
  intervalMs = 250,
): Promise<{ job: NonNullable<Awaited<ReturnType<typeof loadCharacterBootstrapJob>>>; detectedAt: number }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await loadCharacterBootstrapJob(walletAddress, characterName);
    if (job && predicate(job.status)) {
      return { job, detectedAt: Date.now() };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for bootstrap job status for ${walletAddress}:${characterName}`);
}

async function main(): Promise<void> {
  const routeStartedAt = Date.now();

  const wallet = ethers.Wallet.createRandom();
  const walletAddress = await wallet.getAddress();
  const timestamp = Date.now();
  const name = `Flow${crypto.randomBytes(3).toString("hex")}`;
  const race = "human";
  const className = "warrior";
  const message = `Sign this message to authenticate with WoG MMORPG\nTimestamp: ${timestamp}\nWallet: ${walletAddress}`;
  const signature = await wallet.signMessage(message);
  const authOk = await verifyWalletSignature(walletAddress, signature, timestamp);
  if (!authOk) {
    throw new Error("Wallet signature verification failed");
  }

  const token = generateAuthToken(walletAddress);
  if (!walletsMatch(walletAddress, walletAddress) || !token) {
    throw new Error("JWT generation failed");
  }

  const validationError = validateCharacterInput({ walletAddress, name, race, className });
  if (validationError) {
    throw new Error(validationError);
  }

  const server = Fastify({ logger: false });
  const character = computeCharacter(name, race, className);
  const existingSave = await loadCharacter(walletAddress, character.name);
  const metadata = {
    name: `${character.name} the ${character.class.name}`,
    description: `Level ${character.level} ${character.race.name} ${character.class.name}`,
  };

  const walletRegistration = await registerWalletWithWelcomeBonus(server as any, walletAddress);

  if (!existingSave) {
    await saveCharacter(walletAddress, character.name, {
      name: character.name,
      level: 1,
      xp: 0,
      chainRegistrationStatus: "unregistered",
      raceId: character.race.id,
      classId: character.class.id,
      zone: "village-square",
      x: 0,
      y: 0,
      kills: 0,
      completedQuests: [],
      learnedTechniques: [],
      professions: [],
    });
  }

  const enqueueStartedAt = Date.now();
  const job = await enqueueCharacterBootstrap(walletAddress, character.name, "character:create", ["wog:a2a-enabled"]);
  const enqueuedAt = Date.now();
  void processCharacterBootstrapJob(walletAddress, character.name, server.log);

  const redis = getRedis();
  const rawRedisJob = redis ? await redis.hgetall(jobRedisKey(walletAddress, character.name)) : null;
  const pendingScore = redis ? await redis.zscore("character:bootstrap:pending", `${walletAddress.toLowerCase()}:${character.name}`) : null;

  const queuedDetected = await waitForJobStatus(walletAddress, character.name, (status) => status === "queued", 5_000, 100);
  const pickedUp = await waitForJobStatus(walletAddress, character.name, (status) => status !== "queued", 180_000, 100);
  const completed = await waitForJobStatus(
    walletAddress,
    character.name,
    (status) => status === "completed" || status === "failed_retryable" || status === "failed_permanent",
    240_000,
    500
  );

  const finishedAt = completed.detectedAt;
  const finalSave = await loadCharacter(walletAddress, character.name);

  console.log(JSON.stringify({
    flow: {
      walletAddress,
      jwtIssued: Boolean(token),
      authVerified: authOk,
      routeName: "/character/create",
      requestBody: {
        walletAddress,
        name,
        race,
        className,
      },
      responseShape: {
        ok: true,
        existing: Boolean(existingSave),
        walletRegistration,
        character: {
          name: metadata.name,
          description: metadata.description,
          race: character.race.id,
          class: character.class.id,
          level: 1,
          xp: 0,
          stats: computeStatsAtLevel(character.race.id, character.class.id, 1),
        },
        bootstrap: {
          status: job.status,
          sourceOfTruth: "blockchain-eventual",
          chainRegistrationStatus: "unregistered",
        },
      },
    },
    redis: {
      jobKey: jobRedisKey(walletAddress, character.name),
      pendingIndexKey: "character:bootstrap:pending",
      rawJobFields: rawRedisJob,
      pendingScore,
    },
    timingsMs: {
      createCallStartToQueued: enqueuedAt - routeStartedAt,
      enqueueOnly: enqueuedAt - enqueueStartedAt,
      queuedDetectedLatency: queuedDetected.detectedAt - enqueuedAt,
      queueToPickedUp: pickedUp.detectedAt - enqueuedAt,
      createCallToBootstrapDone: finishedAt - routeStartedAt,
    },
    jobStates: {
      initial: job.status,
      pickedUp: pickedUp.job.status,
      completed: completed.job.status,
      attemptCount: completed.job.attemptCount,
      lastError: completed.job.lastError ?? null,
    },
    finalCharacter: finalSave,
  }, null, 2));

  await server.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
