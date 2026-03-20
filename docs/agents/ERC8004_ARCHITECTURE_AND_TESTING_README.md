# ERC-8004 Architecture And Testing README

This document is for developers and agents working on the current ERC-8004-integrated WoG architecture.

It explains:

- what changed in the system
- why those changes were necessary
- which files now own which responsibilities
- how local dev works with Hardhat
- how reputation consistency works
- which tests exist and what each one is meant to validate

This is an implementation document, not a roadmap. For the broader target-state plan, see [ERC8004_FULL_INTEGRATION_PLAN.md](../ERC8004_FULL_INTEGRATION_PLAN.md).

## Core Model

The trust model is now character or agent based, not wallet based.

The important semantic rules are:

- each playable character maps to an `agentId`
- reputation belongs to `agentId`
- validation claims belong to `agentId`
- identity metadata and A2A discovery belong to the identity registry
- one wallet can own multiple characters, and those characters must not collapse into one trust record

This is the biggest architectural shift behind the integration. The wallet is the owner or controller. The agent identity is the trust subject.

## What Changed

### Identity registration is now part of character bootstrap

Character creation is no longer just an NFT mint concern.

The bootstrap flow now expects:

1. character NFT is minted or recovered
2. ERC-8004 identity is registered
3. `agentId` is persisted into character save data
4. validation bootstrap can publish claims against that agent
5. downstream systems read and write trust data by `agentId`

Primary files:

- [characterRoutes.ts](../../shard/src/character/characterRoutes.ts)
- [blockchain.ts](../../shard/src/blockchain/blockchain.ts)
- [identity.ts](../../shard/src/erc8004/identity.ts)

### Reputation is now agent keyed

The old wallet-keyed reputation assumptions have been replaced in the active runtime path.

Primary files:

- [reputationManager.ts](../../shard/src/economy/reputationManager.ts)
- [reputationChain.ts](../../shard/src/economy/reputationChain.ts)
- [reputationRoutes.ts](../../shard/src/economy/reputationRoutes.ts)
- [reputation.ts](../../shard/src/erc8004/reputation.ts)

### Validation is now a real runtime surface

Validation is no longer just conceptual contract support. The app can publish and read claims.

Primary files:

- [validation.ts](../../shard/src/erc8004/validation.ts)
- [reputationRoutes.ts](../../shard/src/economy/reputationRoutes.ts)

### Client trust views now consume agent APIs

The client reputation views now read the agent-based endpoints and surface more of the identity layer.

Primary files:

- [ChampionsPage.tsx](../../client/src/components/ChampionsPage.tsx)
- [ReputationPanel.tsx](../../client/src/components/ReputationPanel.tsx)
- [InspectDialog.tsx](../../client/src/components/InspectDialog.tsx)

### PvP matchmaking no longer fabricates identity

One important stale path was the PvP queue UI. It used to invent `agentId` from the wallet and hardcode `characterTokenId` and level. That is now fixed.

The queue UI now resolves the real live player entity and uses the actual:

- `agentId`
- `characterTokenId`
- live level

Primary file:

- [MatchmakingQueue.tsx](../../client/src/components/MatchmakingQueue.tsx)

## Contract Layer

The trust-related contracts are:

- [WoGIdentityRegistry.sol](../../contracts/WoGIdentityRegistry.sol)
- [WoGReputationRegistry.sol](../../contracts/WoGReputationRegistry.sol)
- [WoGValidationRegistry.sol](../../contracts/WoGValidationRegistry.sol)

There is also a local Hardhat copy set under [hardhat/contracts](../../hardhat/contracts) used for local deployment and integration tests.

For local full-stack testing, the Hardhat workspace also includes mock prerequisite asset contracts:

- [WoGMockGold.sol](../../hardhat/contracts/WoGMockGold.sol)
- [WoGMockItems.sol](../../hardhat/contracts/WoGMockItems.sol)
- [WoGMockCharacters.sol](../../hardhat/contracts/WoGMockCharacters.sol)

These mocks matter because the game cannot complete normal character onboarding if the prerequisite asset contracts are missing locally.

## Shard Integration Layer

The shard-side ERC-8004 boundary is under [shard/src/erc8004](../../shard/src/erc8004).

The current modules are:

- [identity.ts](../../shard/src/erc8004/identity.ts)
  - identity read and write helpers
- [reputation.ts](../../shard/src/erc8004/reputation.ts)
  - thin bridge exports for the reputation runtime
- [validation.ts](../../shard/src/erc8004/validation.ts)
  - validation write and read helpers
- [agentResolution.ts](../../shard/src/erc8004/agentResolution.ts)
  - runtime normalization and lookup helpers

This directory is the intended home for trust-specific behavior. Some identity orchestration still remains in more generic blockchain modules, but the repo is much closer to a clean boundary than before.

## API Surfaces

The primary trust endpoints are:

- `GET /api/agents/:agentId/identity`
- `GET /api/agents/:agentId/reputation`
- `GET /api/agents/:agentId/reputation/history`
- `GET /api/agents/:agentId/reputation/timeline`
- `GET /api/agents/:agentId/validations`
- `POST /api/agents/:agentId/reputation/feedback`
- `POST /api/agents/:agentId/reputation/batch-update`
- `GET /a2a/resolve/:agentId`

Primary route file:

- [reputationRoutes.ts](../../shard/src/economy/reputationRoutes.ts)

## Local Dev Architecture

### Why local dev had to change

The first local failure mode was not the ERC-8004 contracts themselves. The real issue was that shard boot and character onboarding still depended on prerequisite asset contracts that were missing in localhost mode.

That caused failures like:

- character mint bootstrap failing before identity registration finished
- merchant or item initialization failing because item contract addresses were unset
- GOLD balance calls decoding empty data because the gold contract address was unset

The fix was to make local dev deploy and auto-wire all required contracts together.

### Current local-dev flow

Hardhat now owns the local deployment source of truth.

Primary files:

- [deploy.ts](../../hardhat/scripts/deploy.ts)
- [localhost.json](../../hardhat/deployments/localhost.json)
- [devLocalContracts.ts](../../shard/src/config/devLocalContracts.ts)

When `DEV=true`:

- shard defaults to the local Hardhat chain
- shard reads the deployment manifest
- local contract env values are automatically filled from that manifest
- stale zero or missing addresses are overridden during boot

Recommended full local flow:

```bash
# terminal 1
cd hardhat
npm run node

# terminal 2
cd hardhat
cp .env.example .env
npm run deploy:localhost

# terminal 3
cd shard
DEV=true REDIS_ALLOW_MEMORY_FALLBACK=true pnpm dev

# terminal 4
cd client
pnpm dev
```

## Shared Signer And Nonce Model

### The problem

Multiple modules were previously sending BITE-side transactions concurrently from the same signer.

Hardhat automine made this fail quickly with:

- `NONCE_EXPIRED`
- `Nonce too low`

The modules affected included:

- identity registration
- validation claim publishing
- reputation initialization and writes
- name registration

### The fix

A shared serialized queue now sits in:

- [biteTxQueue.ts](../../shard/src/blockchain/biteTxQueue.ts)

All relevant BITE-side write paths were routed through it.

This is a real architectural fix, not a Hardhat-only hack. Hardhat exposed the race most clearly, but the underlying shared-signer concurrency problem was real.

## Eventual Consistency Model

### Why it exists

The game needs low-latency local updates. Waiting for every reputation write to become fully chain-synchronous would slow gameplay and make the runtime less responsive.

### Current behavior

The current reputation model is:

1. local gameplay writes update the in-memory read model immediately
2. the API can serve those fast local values
3. chain writes are submitted asynchronously
4. once chain state lands, the read model reconciles from chain
5. reconciled values are written back to Redis

Primary files:

- [reputationManager.ts](../../shard/src/economy/reputationManager.ts)
- [reputationChain.ts](../../shard/src/economy/reputationChain.ts)

### Practical meaning

This system is intentionally eventually consistent, not immediately chain-consistent.

That gives:

- fast local gameplay
- fast API reads
- eventual convergence to chain

It avoids the older failure mode where local and chain values could drift indefinitely with no reconciliation path.

## Testing Structure

There are now different test layers, each serving a different purpose.

### 1. Contract integration tests

These live under [hardhat/test](../../hardhat/test).

Primary file:

- [ERC8004Registries.ts](../../hardhat/test/ERC8004Registries.ts)

This suite is for:

- local contract deployment validation
- identity registration flow
- metadata writes
- validation claims
- reputation initialization and updates
- authorization and expiry paths
- edge cases like zero-token character binding

Run with:

```bash
cd hardhat
npm test
```

### 2. Shard ERC-8004 end-to-end test

Primary file:

- [erc8004DevIntegration.test.ts](../../shard/tests/erc8004DevIntegration.test.ts)

This test validates the actual server integration path, not just contract behavior.

It covers the shard talking to deployed contracts through the current runtime wiring.

It can run in:

- `DEV=true` manifest-driven mode
- explicit-env mode without `DEV=true`

Run with:

```bash
cd shard
DEV=true JWT_SECRET=test npm run test:erc8004
```

Or explicit-env style:

```bash
cd shard
JWT_SECRET=test \
SKALE_BASE_RPC_URL=http://127.0.0.1:8545 \
SKALE_BASE_CHAIN_ID=31337 \
GOLD_CONTRACT_ADDRESS=0x... \
ITEMS_CONTRACT_ADDRESS=0x... \
CHARACTER_CONTRACT_ADDRESS=0x... \
IDENTITY_REGISTRY_ADDRESS=0x... \
REPUTATION_REGISTRY_ADDRESS=0x... \
VALIDATION_REGISTRY_ADDRESS=0x... \
npm run test:erc8004
```

### 3. Regular shard integration tests

Primary files:

- [partyIntegration.test.ts](../../shard/tests/partyIntegration.test.ts)
- [reputation.test.ts](../../shard/tests/reputation.test.ts)

These are not the same as the Hardhat contract suite.

Their role is to keep shard logic aligned with the new identity model:

- party or matchmaking logic should not collapse distinct agents
- reputation manager behavior should match the agent-keyed model
- the eventual-consistency runtime should remain coherent

Run with:

```bash
cd shard
JWT_SECRET=test npx tsx tests/partyIntegration.test.ts
JWT_SECRET=test npx tsx tests/reputation.test.ts
```

### 4. Build verification

Useful sanity checks:

```bash
cd client && npm run build
cd shard && pnpm build
cd hardhat && npm run compile
```

## Client Surfaces

### Reputation surfaces

The client now reads the agent-based reputation APIs in the main trust views.

Primary files:

- [ChampionsPage.tsx](../../client/src/components/ChampionsPage.tsx)
- [ReputationPanel.tsx](../../client/src/components/ReputationPanel.tsx)
- [InspectDialog.tsx](../../client/src/components/InspectDialog.tsx)

### Identity and validation surfacing

The client now surfaces:

- identity registration status
- validation badges
- character token linkage where relevant

This is not the full possible identity UI, but it closes the earlier gap where the backend trust APIs existed without meaningful client exposure.

## Current File Map

If you are trying to understand where to make changes, this is the practical map:

### Contracts

- [contracts/WoGIdentityRegistry.sol](../../contracts/WoGIdentityRegistry.sol)
- [contracts/WoGReputationRegistry.sol](../../contracts/WoGReputationRegistry.sol)
- [contracts/WoGValidationRegistry.sol](../../contracts/WoGValidationRegistry.sol)

### Local Hardhat workspace

- [hardhat/contracts](../../hardhat/contracts)
- [hardhat/test/ERC8004Registries.ts](../../hardhat/test/ERC8004Registries.ts)
- [hardhat/scripts/deploy.ts](../../hardhat/scripts/deploy.ts)

### Shard runtime

- [shard/src/erc8004](../../shard/src/erc8004)
- [shard/src/economy/reputationManager.ts](../../shard/src/economy/reputationManager.ts)
- [shard/src/economy/reputationChain.ts](../../shard/src/economy/reputationChain.ts)
- [shard/src/economy/reputationRoutes.ts](../../shard/src/economy/reputationRoutes.ts)
- [shard/src/character/characterRoutes.ts](../../shard/src/character/characterRoutes.ts)
- [shard/src/blockchain/biteTxQueue.ts](../../shard/src/blockchain/biteTxQueue.ts)
- [shard/src/config/devLocalContracts.ts](../../shard/src/config/devLocalContracts.ts)

### Client

- [client/src/components/ChampionsPage.tsx](../../client/src/components/ChampionsPage.tsx)
- [client/src/components/ReputationPanel.tsx](../../client/src/components/ReputationPanel.tsx)
- [client/src/components/InspectDialog.tsx](../../client/src/components/InspectDialog.tsx)
- [client/src/components/MatchmakingQueue.tsx](../../client/src/components/MatchmakingQueue.tsx)

## Remaining Gaps

The current architecture is much stronger, but some work still remains:

- live deployment and verification on the target network
- more cleanup to move residual identity orchestration fully into `shard/src/erc8004/`
- better published or generated docs for external API consumers under `client/public/docs`
- richer validation claims and richer trust UI
- additional contract-focused unit tests beyond the current integration-heavy suite

## Practical Summary

The important thing for future developers and agents is:

- trust is now agent based
- local dev depends on the Hardhat manifest-driven contract wiring
- reputation is intentionally eventually consistent
- BITE-side writes must go through the shared queue
- contract tests, shard e2e tests, and regular shard tests each validate different layers of the integration

If you keep those five rules in mind, the updated architecture is much easier to work on without reintroducing the old wallet-based or race-prone assumptions.
