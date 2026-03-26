# Agent / Reconciliation TODO

This is a deferred backlog note for making the shard more chain-authoritative and more resilient after Redis loss, restarts, or external on-chain changes.

## Current Reality

- Core blockchain flows are recoverable enough to be playable.
- The system is not fully chain-authoritative end to end.
- Some important runtime and agent state is still Redis-first or in-memory only.
- External on-chain changes are only reflected immediately in some chain-read paths.

## Main Risks

- Redis wipe leaves operational state empty.
- Some local projections can drift from chain.
- Duplicate retry attempts may happen after state loss.
- Agent runtime can stay stale until restart, self-heal, or a specific refresh path runs.

## Work To Do

- Define source of truth for every major subsystem.
- Mark each subsystem as one of:
  - on-chain authoritative
  - Redis authoritative
  - derived cache only

- Add startup backfill/indexing for chain-owned state.
- Rebuild these from chain or contract events:
  - character token ownership and wallet mapping
  - ERC-8004 identity ownership and endpoint
  - reputation summary
  - name ownership
  - plot ownership

- Add explicit periodic reconciliation for external on-chain changes.
- Poll or index contract events for:
  - identity transfer
  - endpoint update
  - reputation update
  - plot claim/release
  - name registration/update

- Make all blockchain write flows idempotent.
- Each write should:
  - use a deterministic operation key
  - check whether the intended chain result already exists
  - mark completed when the result is already present
  - avoid blind duplicate retries

- Add agent-specific reconciliation.
- Periodically verify:
  - enabled agent config in Redis
  - custodial wallet to character mapping
  - character to agent identity mapping
  - on-chain identity owner
  - on-chain A2A endpoint
  - live entity presence in world memory

- Add drift detection and reporting.
- Alert or auto-heal when local state disagrees with chain for:
  - character owner
  - identity owner
  - plot owner
  - important balances
  - name owner

- Separate ephemeral runtime state from durable game state more clearly.
- Runtime-only state is fine for:
  - live loops
  - match queues
  - transient sessions
- Durable progression should either be on-chain or rebuildable.

## Suggested Order

1. Document source of truth per subsystem.
2. Add startup backfill for character, identity, name, and plot state.
3. Add a generic idempotent blockchain operation wrapper.
4. Add agent ownership/endpoint reconciliation worker.
5. Add drift detection dashboard or admin endpoint.

## Scope Note

This is not urgent for current playability, but it is important before treating the shard as strongly recoverable or fully chain-authoritative.
