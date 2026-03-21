# ERC-8004 Reputation System

This document explains the current WoG reputation model after the ERC-8004 architecture update.

## Core Rule

Reputation is keyed by `agentId`, not wallet.

Implications:

- one wallet can own multiple characters
- each character can have distinct reputation history
- trust state is portable across sessions and wallet ownership changes

## Registry Model

WoG uses ERC-8004 registry surfaces:

1. Identity Registry
2. Reputation Registry
3. Validation Registry (optional at runtime)

For supported official SKALE networks, shard resolves official registry addresses from:

- [official.ts](../../shard/src/erc8004/official.ts)

For local `31337`, shard resolves registry addresses from the Hardhat deployment manifest.

## Reputation Write Path

### In-Game API Write

Routes write feedback by `agentId`:

- `POST /api/agents/:agentId/reputation/feedback`
- `POST /api/agents/:agentId/reputation/batch-update`

Primary route file:

- [reputationRoutes.ts](../../shard/src/economy/reputationRoutes.ts)

### Chain Bridge

Chain write and summary read logic lives in:

- [reputationChain.ts](../../shard/src/economy/reputationChain.ts)

The bridge uses the official reputation ABI surface and writes through the shared tx queue.

### Consistency Model

Reputation model is eventually consistent:

1. gameplay API path updates local read model quickly
2. chain writes are submitted asynchronously
3. chain summary is read back and reconciled

Primary manager:

- [reputationManager.ts](../../shard/src/economy/reputationManager.ts)

## Identity Dependency

Reputation assumes valid identity bootstrap has already occurred:

- character mint/recovery
- identity registration
- persisted `agentId`

If no valid `agentId` exists, reputation routes cannot resolve trust subject correctly.

Identity bootstrap files:

- [blockchain.ts](../../shard/src/blockchain/blockchain.ts)
- [characterRoutes.ts](../../shard/src/character/characterRoutes.ts)

## Validation Relationship

Validation is not required for core reputation flow.

Current behavior:

- validation claims are published when validation registry is configured
- validation reads return empty results when validation registry is absent
- reputation writes continue to function without validation

Validation module:

- [validation.ts](../../shard/src/erc8004/validation.ts)

## Current API Surfaces

### Identity

- `GET /api/agents/:agentId/identity`

### Reputation

- `GET /api/agents/:agentId/reputation`
- `GET /api/agents/:agentId/reputation/history`
- `GET /api/agents/:agentId/reputation/timeline`
- `POST /api/agents/:agentId/reputation/feedback`
- `POST /api/agents/:agentId/reputation/batch-update`

### Validation

- `GET /api/agents/:agentId/validations`

## Test Coverage

### Hardhat Contract Tests

```bash
cd hardhat
npm test
```

Covers local identity, reputation, and validation registry semantics and compatibility.

### Full Shard Local Integration

```bash
cd shard
DEV=true REDIS_ALLOW_MEMORY_FALLBACK=true LOCAL_TEST_MODE=core JWT_SECRET=local-dev-jwt-secret npx tsx tests/erc8004DevIntegration.test.ts
```

Covers:

- identity bootstrap
- validation publication (local mode)
- reputation feedback write
- convergence between API and on-chain summary

Latest verified status: passing (`20/20`).

## Official Network Compatibility Notes

Verified official Sepolia compatibility for identity+reputation via direct on-chain reads:

- identity `getVersion() = 2.0.0`
- reputation `getVersion() = 2.0.0`
- reputation identity pointer matches official Sepolia identity registry

Mainnet mapping should be maintained only in:

- [official.ts](../../shard/src/erc8004/official.ts)

Do not hardcode official addresses in route or manager files.

