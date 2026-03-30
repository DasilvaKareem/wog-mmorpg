# Shard Persistence Architecture

## Summary

The shard now treats Redis as the required persistent backing store for critical off-chain gameplay state.
Process memory remains a runtime cache and execution surface, but high-value state is checkpointed or written
through to Redis so a restart does not wipe recent player progress or subsystem metadata.

This update hardens the highest-risk restart paths:
- live online player session restore
- online player progression checkpoints
- party invites and friend requests
- agent runtime intent snapshots
- merchant inventory and pricing state
- PvP stats, queue state, and battle recovery metadata
- durable blockchain operation records plus retry/reconciliation workers
- replayable character mint / identity / metadata writes
- capped retries plus visible permanent-failure states for chain-backed bootstrap flows
- boot-time Redis persistence enforcement

## Storage Rules

- Static content:
  - zone JSON
  - item catalogs
  - quest graph content
  - world layout data
- On-chain authority:
  - gold balances
  - item balances
  - character NFTs
  - identity / validation / reputation registries
- Redis authority or durable backing:
  - character progression snapshots
  - agent config/chat/inbox
  - plot ownership
  - merchant state
  - PvP stats and queue state
  - blockchain operation/outbox records
  - diary / friends / notification bindings
- In-memory only is allowed only for:
  - tick-local combat execution
  - derived caches and indexes
  - active timers
  - data that is recomputable without player-visible loss

## Implemented Changes

### Durable Blockchain Operation Tracking

`shard/src/blockchain/chainOperationStore.ts`

- Chain-mutating subsystems now share a Redis-backed operation registry:
  - `chainop:{operationId}`
  - `chainop:type:{type}`
  - `chainop:pending`
- Each operation records:
  - subject
  - serialized payload
  - attempt count
  - retry schedule
  - tx hash
  - terminal completion or retryable failure state
- Shared replay workers can resume registered operation types from `chainop:pending`.
- `CHAIN_OPERATION_MAX_RETRIES` now caps automatic replay attempts.
- Once an operation crosses the cap, it is marked `failed_permanent` and removed from the retry queue instead of looping forever.
- This removes the old pattern of silent fire-and-forget chain writes with only log-based recovery.

### Chain-Reconciled Gameplay Bridges

The following mutation paths now use the shared durable operation pattern:

- `shard/src/blockchain/wallet.ts`
  - wallet welcome-bonus bootstrap is queued, retried, and only marked complete after chain settlement
- `shard/src/blockchain/nameServiceChain.ts`
  - name registration/release writes are tracked and retried
- `shard/src/farming/plotSystem.ts`
  - plot claim/release/transfer/building updates enqueue durable land-registry operations
- `shard/src/economy/reputationChain.ts`
  - reputation feedback writes are queued in Redis instead of only batching in memory
- `shard/src/economy/guildChain.ts`
  - guild create/invite/join/leave/deposit/proposal/vote/execute writes now emit durable operation records
- `shard/src/economy/guildVaultChain.ts`
  - guild vault deposit/withdraw/lend/return writes now emit durable operation records
- `shard/src/economy/auctionHouseChain.ts`
  - auction create/bid/buyout/end/cancel writes now emit durable operation records
- `shard/src/blockchain/bite.ts`
  - trade create/offer/cancel writes now emit durable operation records
- `shard/src/economy/predictionPoolManager.ts`
  - prediction create/bet/lock/settle/claim/cancel writes now emit durable operation records
- `shard/src/blockchain/blockchain.ts`
  - character mint, identity registration, metadata updates, sFUEL, gold, items, and A2A endpoint writes now use registered replay processors
- `shard/src/erc8004/validation.ts`
  - validation claim publication now runs as a replayable tracked chain operation

This means chain-owned facts now follow one consistent rule:

- chain is authoritative for the chain-owned fact
- Redis stores the shard projection plus the durable operation/retry state
- if a write path fails, the failure remains visible and retryable instead of disappearing into process memory

### Character Bootstrap Registration State

`shard/src/character/characterStore.ts`
`shard/src/character/characterBootstrap.ts`

- Character saves now expose explicit chain registration state:
  - `unregistered`
  - `pending_mint`
  - `mint_confirmed`
  - `identity_pending`
  - `registered`
  - `failed_retryable`
  - `failed_permanent`
- `CHARACTER_BOOTSTRAP_MAX_RETRIES` caps retries for bootstrap jobs.
- If retries are exhausted, the character remains in Redis with a visible failed registration state instead of silently retrying forever.
- Redis keeps the gameplay character record even if chain registration is delayed or permanently failed.

### Online Player Checkpointing

`shard/src/world/zoneRuntime.ts`

- Online players are now checkpointed every `PLAYER_PERSIST_INTERVAL_MS`.
- Default interval is `5000ms`.
- Graceful shutdown still flushes all online players.
- Character snapshots include location, level/xp, quests, flags, techniques, professions, and equipment.

### Live Player Session Persistence

`shard/src/world/zoneRuntime.ts`
`shard/src/world/spawnOrders.ts`

- Active player entities are now persisted to Redis under:
  - `world:live-players`
  - `world:live-player:{wallet}`
- Stored session data includes:
  - the live player entity snapshot
  - the wallet-to-live-entity registry
  - learned professions for session rehydration
- On boot, the shard restores these live player sessions back into the world and re-registers the spawned wallet map.
- On explicit despawn/logout, the live-player Redis record is removed.
- This means a crash no longer drops online players out of the world until they manually respawn.

### Merchant Persistence

`shard/src/world/merchantAgent.ts`

- Merchant state now persists to Redis under:
  - `merchant:states`
  - `merchant:state:{zoneId}:{merchant-slug}`
- Persisted merchant fields include:
  - custodial wallet
  - current inventory quantities
  - dynamic prices
  - gold balance
  - restock/announcement timestamps
  - sales and purchase counters
- Merchant state is restored by stable merchant identity, not by transient runtime entity ID.
- Legacy pre-migration merchant keys are migrated forward on restore.
- Old merchant entity IDs remain readable through an alias mapping after restart.
- Shop buy/sell flows now await merchant persistence updates.

### Pending Social State Persistence

`shard/src/social/partySystem.ts`
`shard/src/social/friendsSystem.ts`

- Party invites are now Redis-backed under:
  - `wog:party:invites:{custodialWallet}`
- Party membership is persisted under:
  - `wog:party:{partyId}`
  - `wog:party:wallet:{wallet}`
  - `wog:party:ids`
- Friend requests are now Redis-backed under:
  - `friends:req:{wallet}`
- Both systems still enforce their existing TTL behavior, but restart no longer wipes pending invites or requests.
- Party membership is restored on boot and can be lazily reloaded during invite acceptance if the runtime cache is cold.
- In-memory maps remain only as hot caches for the Redis-backed pending state.

### Agent Runtime Snapshot Persistence

`shard/src/agents/agentConfigStore.ts`
`shard/src/agents/agentRunner.ts`
`shard/src/agents/agentManager.ts`

- Agent runner snapshots are now persisted in Redis under:
  - `agent:runtime:{userWallet}`
- Stored runtime fields include:
  - current script
  - current activity
  - recent activity log
  - current region
  - entity linkage
  - custodial wallet
  - pending summoner question id
  - last trigger
- On restart, enabled agents restore their runner snapshot before resuming their loop.
- On explicit user stop, the runtime snapshot is cleared so a later manual restart does not resume stale intent.

### PvP Persistence

`shard/src/combat/pvpBattleManager.ts`
`shard/src/combat/matchmaking.ts`

- PvP stats now persist to Redis:
  - `pvp:player-stats`
  - `pvp:match-history`
  - `pvp:queues`
  - `pvp:active-battles`
- PvP queue state is restored on boot.
- Match history and ELO stats survive restart.
- Active battle summaries are recorded and moved to `pvp:last-recovery` on boot so crashes leave a recoverable audit trail.
- Queue joins and leaves now flush to Redis before the API responds, removing the crash window for immediate queue-loss after enqueue.

## Boot And Runtime Policy

`shard/src/server.ts`

- The shard now exposes persistence status in `GET /health`.
- `REQUIRE_REDIS_PERSISTENCE` defaults to `true`.
- If Redis is required and unavailable, shard boot fails fast.
- If explicitly disabled, the shard logs that persistence guarantees are reduced.
- Shard boot now also starts:
  - character bootstrap replay worker
  - wallet/name/plot/reputation replay workers
  - shared tracked chain-operation replay worker

## Environment

- `REQUIRE_REDIS_PERSISTENCE=true|false`
  - default: `true`
  - when `true`, boot fails if Redis is unavailable
- `REDIS_ALLOW_MEMORY_FALLBACK=true|false`
  - default: `false`
  - when `true`, local/test workflows may run without Redis
- `PLAYER_PERSIST_INTERVAL_MS=<number>`
  - default: `5000`
  - controls periodic online-player checkpoint frequency
- `CHAIN_OPERATION_MAX_RETRIES=<number>`
  - default: `8`
  - caps automatic replay for tracked chain operations before `failed_permanent`
- `CHARACTER_BOOTSTRAP_MAX_RETRIES=<number>`
  - default: `8`
  - caps automatic replay for character NFT + identity bootstrap jobs

## Verified Recovery Coverage

The local full-flow runner in `shard/tests/runLocalFullFlowAuto.ts` now verifies:

- shared chain operation bookkeeping and retry semantics
- durable character bootstrap recovery
- local ERC-8004 identity / validation / reputation integration
- replay recovery for wallet / name / plot / reputation operations
- replay recovery for character mint / identity registration / metadata update operations

Latest local verified test set:

- `test:chain-ops` -> `32 passed`
- `test:character-bootstrap` -> `19 passed`
- `test:erc8004` -> `20 passed`
- `test:chain-recovery` -> `26 passed`
- `test:blockchain-writes` -> `8 passed`
- `pnpm test` orchestrated full-flow -> passing

## Remaining Gaps

This update does not yet make every mutable subsystem fully Redis-authoritative.
The main remaining work is:
- full world entity state as a first-class Redis repository instead of player-session-only restore
- full active PvP battle replay/resume instead of summary recovery
- stricter repository boundaries for all mutable domains

Those should be the next migration steps if the goal is complete Redis authority for all off-chain mutable state.

## Later TODO: Full Redis-Authoritative World State

This is intentionally deferred because it is a large architectural change, not a small patch.

### Goal

Move the shard from:
- in-memory `world.entities` as primary authority

To:
- Redis entity records as primary authority
- in-memory world maps as read-through/write-through projections only

### Expected Changes

- Persist every live entity under Redis keys such as:
  - `world:entity:{entityId}`
  - `world:zone:{zoneId}:entities`
  - `world:wallet:{wallet}:entity`
- Replace direct `Entity` mutation paths with repository-backed mutation helpers.
- Rebuild the live world from Redis on boot instead of relying mainly on spawn-time reconstruction.
- Keep only truly ephemeral tick-local state in memory:
  - transient combat targeting
  - temporary pathing / aggro scratch data
  - derived caches

### Why It Is Deferred

- `zoneRuntime.ts` currently assumes direct in-memory mutation in many places.
- A one-shot rewrite would have a high regression risk across combat, movement, death, and zone transitions.
- This needs a phased migration with repository boundaries and consistency checks.

### Recommendation

Treat this as the next major persistence project once the current hardening pass has been exercised in staging/production.
