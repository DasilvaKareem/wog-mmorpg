# Full Shard Domain Architecture

This document is the exhaustive target architecture for the shard.

## Authority Model

- Postgres: authoritative durable data
- Redis: cache, locks, queues, streams, session/runtime fanout
- In-memory runtime: active world simulation only
- Blockchain: downstream publication sink only

No normal gameplay read should require chain access.
No durable gameplay truth should depend on Redis survival.

## Domain Map

### `character/`

Postgres authoritative:
- characters
- identity state
- bootstrap status
- progression
- character summaries

Redis:
- optional hot cache only

Blockchain:
- publish registration / metadata asynchronously from outbox

### `blockchain/`

Postgres authoritative:
- chain operation queue
- tx status
- downstream publication history

Redis:
- distributed locks only when useful
- short-lived coordination only

Never:
- use blockchain reads as gameplay truth

### `world/`

In-memory authoritative for active tick simulation:
- movement
- combat orders
- NPC active behavior

Postgres authoritative for durable state:
- last durable player snapshot
- live session recovery snapshot
- world ownership state

Redis:
- ephemeral live-session cache
- fanout/cache

### `combat/`

In-memory authoritative during active battles.

Postgres authoritative for durable results:
- pvp stats
- match history
- rankings
- reputation-impact outcomes

Redis:
- matchmaking queues
- transient battle/session coordination

### `items/`

Postgres authoritative:
- inventory
- equipment
- item durability
- affixes / RNG rolls
- ownership history where needed

Redis:
- derived hot inventory cache only

### `professions/`

Postgres authoritative:
- profession unlocks
- xp
- levels
- recipe unlocks
- cooldown state if durability matters across restarts

Redis:
- temporary worker/runtime hints only

### `farming/`

Postgres authoritative:
- plots
- buildings
- crop state
- ownership
- timers / completion timestamps

Redis:
- short-lived task queue / notification cache only

### `economy/`

Postgres authoritative:
- auctions
- listings
- guild membership
- guild vault records
- reputation state
- purchase history
- prediction market durable records
- trade history

Redis:
- hot market caches
- rate limiting
- queue/lock support

### `marketplace/`

Postgres authoritative:
- rentals
- direct-buy records
- asset portability records
- settlement history

Redis:
- request coordination / temporary payment state only if not critical

### `social/`

Postgres authoritative:
- friends
- parties
- quest state
- diary
- notifications
- leaderboard source tables

Redis:
- inbox streams
- websocket/pubsub fanout
- invite TTL caches

### `agents/`

Postgres authoritative:
- agent config
- wallet links
- runtime ownership metadata
- long-lived objectives / edicts

Redis:
- inbox streams
- transient runtime heartbeat
- locks / rate limits

### `auth/`

Postgres authoritative when persistence matters:
- user linkage metadata
- long-lived auth/account association data

Redis:
- challenge nonces
- short-lived auth state
- rate limits

### `resources/`

Mostly static/catalog or runtime-generated.

Postgres only if ownership/consumption must persist durably.

### `routes/`

Read from Postgres-backed services.
Never contain reconciliation logic.

### `runtime/`

In-memory only.
No durable truth should live here without snapshotting to Postgres.

## Performance Rules

1. No Redis `KEYS` on hot paths.
2. No chain log scans on request paths.
3. No request-path reconciliation.
4. Durable writes use Postgres transactions.
5. External publication uses Postgres outbox.
6. Redis values must be reconstructable from Postgres or runtime.
7. API handlers call services, not storage primitives directly.

## Service / Repository Split

Target structure:

- `services/character-service.ts`
- `services/inventory-service.ts`
- `services/quest-service.ts`
- `services/party-service.ts`
- `services/guild-service.ts`
- `services/market-service.ts`
- `services/farming-service.ts`
- `services/agent-service.ts`

Backed by:

- `repositories/postgres/*`
- `cache/redis/*`
- `workers/*`

## Migration End State

When the migration is complete:

- Redis flush should not lose progression or ownership state
- chain RPC outages should not break normal reads
- request latency should be dominated by indexed Postgres queries and in-memory runtime, not remote scans
- blockchain publication should be retryable without affecting gameplay reads
