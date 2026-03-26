import "dotenv/config";

process.env.DEV ??= "true";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.SERVER_PRIVATE_KEY ??= "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

await import("../src/config/devLocalContracts.ts");

import { ethers } from "ethers";
import {
  createChainOperation,
  getChainOperation,
  processPendingTrackedChainOperations,
  updateChainOperation,
} from "../src/blockchain/chainOperationStore.js";
import {
  findIdentityByCharacterTokenId,
  getOwnedCharacters,
  updateCharacterMetadata,
} from "../src/blockchain/blockchain.js";
import { getValidationClaims } from "../src/erc8004/validation.js";

type LoggerLike = {
  error: (err: unknown, msg?: string) => void;
};

const logger: LoggerLike = {
  error: (...args) => console.error(...args),
};

let passed = 0;
let failed = 0;
const HAS_VALIDATION_REGISTRY = Boolean(process.env.VALIDATION_REGISTRY_ADDRESS);

function assert(condition: boolean, label: string, details?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
    return;
  }
  console.error(`  ✗ ${label}`);
  if (details !== undefined) {
    console.error(`    ${typeof details === "string" ? details : JSON.stringify(details)}`);
  }
  failed++;
}

function requireOk(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function poll<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<T> {
  const start = Date.now();
  let lastValue: T | undefined;
  while (Date.now() - start < timeoutMs) {
    lastValue = await fn();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  console.log("\n── Blockchain Write Processor Recovery ──");

  console.log("\n── Character Mint Recovery ──");
  const mintedOwner = ethers.Wallet.createRandom().address;
  const mintedName = `Recovery-${Math.random().toString(36).slice(2, 8)}`;
  const mintOp = await createChainOperation("character-mint", "broken-mint", {
    toAddress: "oops",
    nft: {
      name: mintedName,
      description: "recovery mint",
      properties: { race: "human", class: "warrior", level: 1 },
    },
  });
  await processPendingTrackedChainOperations(logger, ["character-mint"]);
  const mintFailed = await poll(
    "character mint retryable failure",
    async () => await getChainOperation(mintOp.operationId),
    (value) => value?.status === "failed_retryable",
  );
  requireOk(mintFailed !== null, "character mint op should exist");
  assert(Boolean(mintFailed.lastError), "character mint stores retryable error", mintFailed);

  await updateChainOperation(mintOp.operationId, {
    payload: JSON.stringify({
      toAddress: mintedOwner,
      nft: {
        name: mintedName,
        description: "recovery mint",
        properties: { race: "human", class: "warrior", level: 1 },
      },
    }),
    status: "queued",
    nextAttemptAt: 0,
    lastError: undefined,
  });
  await processPendingTrackedChainOperations(logger, ["character-mint"]);
  const mintCompleted = await poll(
    "character mint completion",
    async () => await getChainOperation(mintOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(mintCompleted !== null, "character mint completion record should exist");
  const ownedCharacters = await poll(
    "minted character ownership",
    async () => await getOwnedCharacters(mintedOwner),
    (value) => Array.isArray(value) && value.some((entry) => entry.metadata?.name === mintedName),
  );
  const mintedCharacter = ownedCharacters.find((entry) => entry.metadata?.name === mintedName);
  requireOk(Boolean(mintedCharacter), "minted character should be discoverable on-chain");
  const tokenId = BigInt(mintedCharacter!.id.toString());
  assert(mintCompleted.status === "completed", "character mint retry succeeds after payload correction", mintCompleted);

  console.log("\n── Identity Registration Recovery ──");
  const identityOwner = ethers.Wallet.createRandom().address;
  const identityOp = await createChainOperation("identity-register", tokenId.toString(), {
    characterTokenId: tokenId.toString(),
    ownerAddress: "oops",
    metadataURI: `ipfs://${mintCompleted.txHash ?? "recovery"}`,
    validationTags: ["battle-tested"],
  });
  await processPendingTrackedChainOperations(logger, ["identity-register"]);
  const identityFailed = await poll(
    "identity register retryable failure",
    async () => await getChainOperation(identityOp.operationId),
    (value) => value?.status === "failed_retryable",
  );
  requireOk(identityFailed !== null, "identity register op should exist");
  assert(Boolean(identityFailed.lastError), "identity register stores retryable error", identityFailed);

  await updateChainOperation(identityOp.operationId, {
    payload: JSON.stringify({
      characterTokenId: tokenId.toString(),
      ownerAddress: identityOwner,
      metadataURI: `ipfs://${mintCompleted.txHash ?? "recovery"}`,
      validationTags: ["battle-tested"],
    }),
    status: "queued",
    nextAttemptAt: 0,
    lastError: undefined,
  });
  await processPendingTrackedChainOperations(logger, ["identity-register", "validation-claim"]);
  const identityCompleted = await poll(
    "identity registration completion",
    async () => await getChainOperation(identityOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(identityCompleted !== null, "identity completion record should exist");
  const identity = await poll(
    "identity lookup by character token",
    async () => await findIdentityByCharacterTokenId(tokenId),
    (value) => value != null && value.ownerAddress?.toLowerCase() === identityOwner.toLowerCase(),
  );
  requireOk(identity !== null, "identity should be discoverable after replay");
  assert(identity.ownerAddress?.toLowerCase() === identityOwner.toLowerCase(), "identity owner converges to corrected address", identity);
  if (HAS_VALIDATION_REGISTRY) {
    const validations = await poll(
      "validation claim visibility",
      async () => await getValidationClaims(identity.agentId),
      (value) => value.some((entry) => entry.claimType === "battle-tested" && entry.active),
    );
    assert(validations.some((entry) => entry.claimType === "battle-tested" && entry.active), "identity replay also completes validation claim", validations);
  } else {
    const validations = await getValidationClaims(identity.agentId);
    assert(validations.length === 0, "validation claim assertions are skipped when no validation registry is configured", validations);
  }

  console.log("\n── Character Metadata Recovery ──");
  const metadataOp = await createChainOperation("character-metadata-update", `${tokenId}:9`, {
    characterTokenId: "oops",
    name: `${mintedName} Prime`,
    raceId: "human",
    classId: "warrior",
    level: 9,
    xp: 900,
    stats: {
      str: 40,
      def: 30,
      hp: 140,
      agi: 24,
      int: 10,
      mp: 20,
      faith: 12,
      luck: 16,
      essence: 90,
    },
  });
  await processPendingTrackedChainOperations(logger, ["character-metadata-update"]);
  const metadataFailed = await poll(
    "metadata retryable failure",
    async () => await getChainOperation(metadataOp.operationId),
    (value) => value?.status === "failed_retryable",
  );
  requireOk(metadataFailed !== null, "metadata operation should exist");
  assert(Boolean(metadataFailed.lastError), "metadata update stores retryable error", metadataFailed);

  await updateChainOperation(metadataOp.operationId, {
    payload: JSON.stringify({
      characterTokenId: tokenId.toString(),
      name: `${mintedName} Prime`,
      raceId: "human",
      classId: "warrior",
      level: 9,
      xp: 900,
      stats: {
        str: 40,
        def: 30,
        hp: 140,
        agi: 24,
        int: 10,
        mp: 20,
        faith: 12,
        luck: 16,
        essence: 90,
      },
    }),
    status: "queued",
    nextAttemptAt: 0,
    lastError: undefined,
  });
  await processPendingTrackedChainOperations(logger, ["character-metadata-update"]);
  const metadataCompleted = await poll(
    "metadata completion",
    async () => await getChainOperation(metadataOp.operationId),
    (value) => value?.status === "completed",
  );
  requireOk(metadataCompleted !== null, "metadata completion record should exist");
  assert(metadataCompleted.status === "completed", "metadata replay succeeds after payload correction", metadataCompleted);
  const duplicateMetadataResult = await updateCharacterMetadata({
    characterTokenId: tokenId,
    name: `${mintedName} Prime`,
    raceId: "human",
    classId: "warrior",
    level: 9,
    xp: 900,
    stats: {
      str: 40,
      def: 30,
      hp: 140,
      agi: 24,
      int: 10,
      mp: 20,
      faith: 12,
      luck: 16,
      essence: 90,
    },
  });
  assert(duplicateMetadataResult === "skipped-same-level", "metadata dedupe still works after replay completion", duplicateMetadataResult);

  console.log("\n==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
