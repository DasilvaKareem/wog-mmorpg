import Redis from "ioredis";
import {
  acquireChainOperationLock,
  createChainOperation,
  executeRegisteredChainOperation,
  extendChainOperationLock,
  getChainOperationMaxRetries,
  getChainOperation,
  listDueChainOperations,
  markChainOperationRetryable,
  processPendingTrackedChainOperations,
  registerChainOperationProcessor,
  releaseChainOperationLock,
  runTrackedChainOperation,
  updateChainOperation,
} from "../src/blockchain/chainOperationStore.js";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

const redis = new Redis(REDIS_URL);
let passed = 0;
let failed = 0;

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

async function zscorePending(operationId: string): Promise<string | null> {
  return redis.zscore("chainop:pending", operationId);
}

async function lockTtl(operationId: string): Promise<number> {
  return redis.pttl(`chainop:lock:${operationId}`);
}

async function typeMembership(type: string, operationId: string): Promise<boolean> {
  return (await redis.sismember(`chainop:type:${type}`, operationId)) === 1;
}

async function main() {
  console.log("\n── Durable Chain Operation Store ──");

  registerChainOperationProcessor("test-registered", async (record) => {
    const payload = JSON.parse(record.payload) as { succeed?: boolean; value: string };
    if (!payload.succeed) throw new Error(`processor failed:${payload.value}`);
    return { result: { value: payload.value }, txHash: "0xregistered" };
  });
  let submittedReplayExecutions = 0;
  registerChainOperationProcessor("test-submitted-no-replay", async () => {
    submittedReplayExecutions++;
    return { result: { ok: true }, txHash: "0xsubmitted" };
  });

  const queued = await createChainOperation("test-op", "subject-a", { step: 1, kind: "queued" });
  const queuedFromStore = await getChainOperation(queued.operationId);
  requireOk(queuedFromStore !== null, "expected queued operation to exist");
  assert(queuedFromStore!.status === "queued", "new operation starts queued", queuedFromStore);
  assert(await typeMembership("test-op", queued.operationId), "operation is indexed by type");
  assert((await zscorePending(queued.operationId)) !== null, "queued operation is present in pending zset");

  const firstLock = await acquireChainOperationLock(queued.operationId, 5_000);
  const secondLock = await acquireChainOperationLock(queued.operationId, 5_000);
  assert(firstLock === true, "first lock acquisition succeeds");
  assert(secondLock === false, "duplicate lock acquisition is rejected");
  await releaseChainOperationLock(queued.operationId);
  const thirdLock = await acquireChainOperationLock(queued.operationId, 5_000);
  assert(thirdLock === true, "lock can be reacquired after release");
  const extended = await extendChainOperationLock(queued.operationId, 20_000);
  const extendedTtl = await lockTtl(queued.operationId);
  assert(extended === true, "lock heartbeat extension succeeds");
  assert(extendedTtl > 5_000, "lock heartbeat extension refreshes TTL", extendedTtl);
  await releaseChainOperationLock(queued.operationId);

  const submitted = await updateChainOperation(queued.operationId, {
    status: "submitted",
    attemptCount: 1,
    lastAttemptAt: Date.now(),
  });
  requireOk(submitted !== null, "expected updateChainOperation to return updated record");
  assert(submitted!.status === "submitted", "operation can be promoted to submitted", submitted);
  const submittedDue = await listDueChainOperations("test-op");
  assert(
    !submittedDue.some((op) => op.operationId === queued.operationId),
    "submitted operation is excluded from replay due listing",
    submittedDue,
  );

  const retryable = await markChainOperationRetryable(queued.operationId, new Error("simulated boom"));
  requireOk(retryable !== null, "expected markChainOperationRetryable to return updated record");
  assert(retryable!.status === "failed_retryable", "retryable failure marks operation failed_retryable", retryable);
  assert(retryable!.attemptCount === 2, "retryable failure increments attempt count", retryable);
  assert(Boolean(retryable!.lastError?.includes("simulated boom")), "retryable failure stores lastError", retryable);
  assert(retryable!.nextAttemptAt > Date.now(), "retryable failure schedules future retry", retryable);
  assert((await zscorePending(queued.operationId)) !== null, "retryable operation remains pending");

  await updateChainOperation(queued.operationId, {
    nextAttemptAt: 0,
  });
  const due = await listDueChainOperations("test-op");
  assert(due.some((op) => op.operationId === queued.operationId), "due operation listing includes forced-due retry");

  const completed = await updateChainOperation(queued.operationId, {
    status: "completed",
    completedAt: Date.now(),
    txHash: "0xabc123",
    lastError: undefined,
  });
  requireOk(completed !== null, "expected completed update to succeed");
  assert(completed!.status === "completed", "operation can be marked completed", completed);
  assert((await zscorePending(queued.operationId)) === null, "completed operation is removed from pending zset");

  const completedRaw = await redis.hgetall(`chainop:${queued.operationId}`);
  assert(!completedRaw.lastError, "completed operation clears stale lastError field", completedRaw);
  assert(completedRaw.txHash === "0xabc123", "completed operation persists txHash", completedRaw);

  const successfulResult = await runTrackedChainOperation(
    "test-success",
    "subject-success",
    { hello: "world" },
    async () => ({
      result: { ok: true },
      txHash: "0xsuccess",
    }),
  );
  assert(successfulResult.ok === true, "runTrackedChainOperation returns executor result");

  const successIds = await redis.smembers("chainop:type:test-success");
  requireOk(successIds.length > 0, "expected a success operation id");
  const successRecord = await getChainOperation(successIds[successIds.length - 1]);
  requireOk(successRecord !== null, "expected success record to exist");
  assert(successRecord!.status === "completed", "successful tracked operation completes", successRecord);
  assert(successRecord!.txHash === "0xsuccess", "successful tracked operation stores txHash", successRecord);
  assert((await zscorePending(successRecord!.operationId)) === null, "successful tracked operation leaves no pending entry");

  let threw = false;
  try {
    await runTrackedChainOperation(
      "test-failure",
      "subject-failure",
      { hello: "failure" },
      async () => {
        throw new Error("executor failed");
      },
    );
  } catch (err) {
    threw = true;
    assert((err as Error).message === "executor failed", "tracked operation rethrows executor failure");
  }
  assert(threw, "failing tracked operation throws");

  const failureIds = await redis.smembers("chainop:type:test-failure");
  requireOk(failureIds.length > 0, "expected a failure operation id");
  const failureRecord = await getChainOperation(failureIds[failureIds.length - 1]);
  requireOk(failureRecord !== null, "expected failure record to exist");
  assert(failureRecord!.status === "failed_retryable", "failing tracked operation is persisted as retryable", failureRecord);
  assert(Boolean(failureRecord!.lastError?.includes("executor failed")), "failing tracked operation stores error", failureRecord);
  assert((await zscorePending(failureRecord!.operationId)) !== null, "failing tracked operation stays pending for recovery");

  const resumedAfterRestart = await getChainOperation(failureRecord!.operationId);
  requireOk(resumedAfterRestart !== null, "expected persisted failure to survive reload");
  assert(
    resumedAfterRestart!.operationId === failureRecord!.operationId &&
      resumedAfterRestart!.status === "failed_retryable",
    "operation state can be reloaded from Redis after simulated process restart",
    resumedAfterRestart,
  );

  const registeredResult = await executeRegisteredChainOperation<{ value: string }>(
    "test-registered",
    "subject-registered",
    { succeed: true, value: "ok" }
  );
  assert(registeredResult.value === "ok", "registered processor executes immediately");

  const registeredIds = await redis.smembers("chainop:type:test-registered");
  requireOk(registeredIds.length > 0, "expected registered operation id");
  const registeredRecordId = registeredIds[registeredIds.length - 1];
  await updateChainOperation(registeredRecordId, {
    payload: JSON.stringify({ succeed: false, value: "retry-me" }),
    status: "queued",
    nextAttemptAt: 0,
    attemptCount: 0,
    lastError: undefined,
  });
  await processPendingTrackedChainOperations(console, ["test-registered"]);
  const retryRecord = await getChainOperation(registeredRecordId);
  requireOk(retryRecord !== null, "expected retry record");
  assert(retryRecord!.status === "failed_retryable", "registered processor failure becomes retryable", retryRecord);

  await updateChainOperation(registeredRecordId, {
    payload: JSON.stringify({ succeed: true, value: "recovered" }),
    status: "queued",
    nextAttemptAt: 0,
    lastError: undefined,
  });
  await processPendingTrackedChainOperations(console, ["test-registered"]);
  const recoveredRecord = await getChainOperation(registeredRecordId);
  requireOk(recoveredRecord !== null, "expected recovered record");
  assert(recoveredRecord!.status === "completed", "registered processor replay completes queued operation", recoveredRecord);

  const capped = await createChainOperation("test-op-max", "subject-max", { kind: "capped" });
  let cappedRecord = await getChainOperation(capped.operationId);
  requireOk(cappedRecord !== null, "expected capped operation to exist");
  for (let i = 0; i < getChainOperationMaxRetries(); i++) {
    cappedRecord = await markChainOperationRetryable(capped.operationId, new Error(`retry-${i}`));
  }
  requireOk(cappedRecord !== null, "expected capped record");
  assert(cappedRecord!.status === "failed_permanent", "retry cap converts operation to failed_permanent", cappedRecord);
  assert((await zscorePending(capped.operationId)) === null, "failed_permanent operation leaves pending queue", cappedRecord);

  const submittedNoReplay = await createChainOperation("test-submitted-no-replay", "subject-submitted", { kind: "submitted" });
  await updateChainOperation(submittedNoReplay.operationId, {
    status: "submitted",
    attemptCount: 1,
    nextAttemptAt: 0,
    lastAttemptAt: Date.now(),
  });
  await processPendingTrackedChainOperations(console, ["test-submitted-no-replay"]);
  assert(submittedReplayExecutions === 0, "replay worker does not re-execute submitted operations");

  console.log("\n==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("==================================================");

  await redis.quit();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nFATAL:", err instanceof Error ? err.message : err);
  await redis.quit();
  process.exit(1);
});
