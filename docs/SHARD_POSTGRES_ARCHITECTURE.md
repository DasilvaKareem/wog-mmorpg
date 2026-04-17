# Shard Architecture: Postgres Source Of Truth

## Final model

- Postgres is the authoritative durable database.
- Redis is runtime/cache/queue/lock infrastructure only.
- Blockchain is a downstream publication sink, not a read-side source of truth.

## Responsibilities

### Postgres

Postgres owns all persistent gameplay state:

- wallet links
- characters
- character identity state
- durable character summaries / projections
- durable runtime snapshots
- durable chain operation queue
- outbox events for downstream publication

### Redis

Redis is intentionally non-authoritative:

- live player sessions
- runtime fanout / cache
- queues and locks
- short-lived summaries
- rate limiting

If Redis is flushed, the shard should lose hot state, not character truth.

### Blockchain

Blockchain receives published state asynchronously:

1. gameplay write commits to Postgres
2. outbox event is written in Postgres
3. worker publishes downstream to chain
4. publication status is recorded back in Postgres

No normal gameplay read should need chain RPC.

## Request path rules

- do not read chain in request handlers
- do not reconcile chain state in request handlers
- do not use Redis `KEYS` in hot paths
- durable reads come from Postgres
- Redis may overlay live-session/runtime data only

## Current foundation in repo

### Postgres bootstrap

- [postgres.ts](/home/preyanshu/wog-mmorpg/shard/src/db/postgres.ts)
- [gameSchema.ts](/home/preyanshu/wog-mmorpg/shard/src/db/gameSchema.ts)

### Durable outbox

- [outbox.ts](/home/preyanshu/wog-mmorpg/shard/src/db/outbox.ts)
- chain operations are also persisted durably in [chainOperationStore.ts](/home/preyanshu/wog-mmorpg/shard/src/blockchain/chainOperationStore.ts)

### Character domain storage

- [characterProjectionStore.ts](/home/preyanshu/wog-mmorpg/shard/src/character/characterProjectionStore.ts)
- [characterStore.ts](/home/preyanshu/wog-mmorpg/shard/src/character/characterStore.ts)
- [characterRoutes.ts](/home/preyanshu/wog-mmorpg/shard/src/character/characterRoutes.ts)

### Durable live sessions

- [liveSessionStore.ts](/home/preyanshu/wog-mmorpg/shard/src/db/liveSessionStore.ts)
- [zoneRuntime.ts](/home/preyanshu/wog-mmorpg/shard/src/world/zoneRuntime.ts)

### Wallet link sync

- [agentConfigStore.ts](/home/preyanshu/wog-mmorpg/shard/src/agents/agentConfigStore.ts)

## Local stack

Use [docker-compose.yml](/home/preyanshu/wog-mmorpg/docker-compose.yml) for:

- Postgres
- Redis
- shard

Use [shard/.env.architecture.example](/home/preyanshu/wog-mmorpg/shard/.env.architecture.example) as the local env template.

## Next migration targets

The next domains to move fully onto Postgres-first persistence should be:

1. inventory and equipment
2. quests and professions
3. parties and guild membership
4. plot / farming ownership
5. auction listings and trade history
6. inventory/equipment and social systems stop treating Redis as durable truth
