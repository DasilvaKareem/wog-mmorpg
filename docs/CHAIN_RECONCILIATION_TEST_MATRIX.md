# Chain Reconciliation Test Matrix

This document defines the recovery and reconciliation cases that matter for the shard's
blockchain-backed mutation pattern.

## Scope

These cases cover the shared Redis-backed chain operation model and the main subsystems that use it:

- wallet bootstrap
- character bootstrap
- name service
- plots / land registry
- reputation feedback
- guild
- guild vault
- auction house
- trade
- prediction markets

## Core Invariants

Every chain-backed mutation should satisfy these invariants:

1. A durable Redis operation record exists before the mutation is considered in progress.
2. A crash before completion does not make the mutation invisible.
3. A retryable failure records error state and a future retry time.
4. A completed operation is removed from the pending index.
5. Completed state clears stale retry errors.
6. Chain-owned facts converge from chain truth, not from stale Redis projection.

## Automated Tests

### 1. Shared Operation Store

Command:

```bash
cd shard
REDIS_URL=redis://127.0.0.1:6379 JWT_SECRET=test npx tsx tests/chainOperationStoreRecovery.test.ts
```

Covers:

- queued record persistence
- type index membership
- pending zset membership
- lock acquire/release semantics
- retryable failure bookkeeping
- due-operation listing
- terminal completion cleanup
- success path through `runTrackedChainOperation(...)`
- failure path through `runTrackedChainOperation(...)`
- reload from Redis after simulated process restart

### 2. Character Bootstrap Recovery

Command:

```bash
cd shard
DEV=true REDIS_URL=redis://127.0.0.1:6379 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef SERVER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 JWT_SECRET=local-dev-jwt-secret npx tsx tests/characterBootstrapOutbox.test.ts
```

Covers:

- Redis losing `characterTokenId`
- Redis losing `agentId`
- no duplicate mint/identity when chain already has the truth
- pending bootstrap replay after restart

### 3. Full Local ERC-8004 Integration

Command:

```bash
cd shard
DEV=true REDIS_ALLOW_MEMORY_FALLBACK=true LOCAL_TEST_MODE=core JWT_SECRET=local-dev-jwt-secret npx tsx tests/erc8004DevIntegration.test.ts
```

Covers:

- auth
- wallet bootstrap
- character creation
- identity registration
- validation
- name registration
- spawn flow
- reputation convergence

### 4. Processor-Backed Retry Recovery

Command:

```bash
cd shard
DEV=true REDIS_URL=redis://127.0.0.1:6379 SERVER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 npx tsx tests/chainReconciliationRecovery.test.ts
```

Covers:

- wallet queued op replay to completion
- wallet retryable failure persistence
- wallet retry succeeds after payload correction
- name queued op replay to completion
- name retryable failure persistence
- name retry succeeds after payload correction
- plot queued op replay to completion with Redis ownership already written
- plot retryable failure persistence
- plot retry succeeds after payload correction
- reputation queued op replay to completion with a real local `agentId`
- reputation retryable failure persistence
- reputation retry succeeds after payload correction

### 5. Remaining Blockchain Write Processor Recovery

Command:

```bash
cd shard
DEV=true REDIS_URL=redis://127.0.0.1:6379 SERVER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 npx tsx tests/blockchainWriteProcessorRecovery.test.ts
```

Covers:

- character mint op retryable failure on invalid payload
- character mint replay to completion after payload correction
- identity registration op retryable failure on invalid owner address
- identity replay to completion after payload correction
- validation claim completion as part of identity replay
- metadata update op retryable failure on invalid token id payload
- metadata replay to completion after payload correction
- metadata dedupe behavior after successful replay

## Manual / Staging Cases

These are the remaining manual cases worth exercising before production changes.

### Wallet Bootstrap

- kill shard after operation record is created but before `wallet:registered:{wallet}` is written
- kill shard after sFUEL succeeds but before welcome GOLD succeeds
- verify next boot resumes pending operation and does not silently lose it
- verify completed wallet bootstrap clears stale `lastError`

### Name Service

- kill shard after name operation record is queued but before chain submission
- kill shard after chain submission but before Redis completion update
- verify retry state remains visible in Redis
- verify reverse lookup eventually matches chain after worker replay

### Plot / Land Registry

- claim a plot, kill shard before worker finishes, restart and verify:
  - Redis ownership remains
  - pending chain op remains
  - worker completes claim on next boot
- release a plot under the same failure window
- transfer a plot under the same failure window
- update building stage under the same failure window

### Reputation

- submit feedback, kill shard before worker flush, restart and verify:
  - pending operation survives
  - worker replays it once
  - chain summary eventually reflects the feedback
- verify repeated worker ticks do not lose retryable errors

### Guild / Guild Vault

- create guild, invite, join, deposit, proposal, vote, execute:
  - inspect `chainop:type:*` keys after each call
  - verify success leaves terminal completion records and no pending entry
- repeat for vault deposit/withdraw/lend/return

### Auction / Trade / Prediction

- create/bid/buyout/end/cancel auction with shard restart between request and completion
- create trade, submit offer, cancel trade with restart between request and completion
- create pool, place bet, lock, settle, claim, cancel with restart between request and completion

## Redis Crash Note

There are two different failure classes:

1. Shard process crash with Redis surviving
2. Redis server crash or data loss

The current automated tests cover class 1.

Class 2 depends on Redis deployment durability outside the shard code:

- AOF / RDB persistence policy
- replication / failover
- managed Redis durability guarantees

If Redis itself loses acknowledged writes, the shard cannot reconstruct those writes from process memory.
That is an infrastructure durability issue, not an application retry issue.

## Release Gate Recommendation

Before calling reconciliation work "done", the minimum bar should be:

- `tests/chainOperationStoreRecovery.test.ts` passes
- `tests/characterBootstrapOutbox.test.ts` passes
- `tests/erc8004DevIntegration.test.ts` passes
- `tests/chainReconciliationRecovery.test.ts` passes
- `tests/blockchainWriteProcessorRecovery.test.ts` passes
- at least one manual restart test is performed for wallet, name, plot, and reputation flows on staging
