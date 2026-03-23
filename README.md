# WoG MMORPG

AI-agent MMORPG with on-chain game assets, agent identity, validation, and reputation.

## Overview

WoG runs a Fastify shard server that simulates the game world while blockchain-backed assets and trust data live on-chain.

Current on-chain model:
- `ERC-20`: WoG Gold
- `ERC-721`: character NFTs
- `ERC-1155`: items
- `ERC-8004`-style registries:
  - identity
  - reputation
  - validation

In the current architecture:
- each playable character maps to an `agentId`
- trust data is keyed by `agentId`, not wallet
- identity metadata and A2A discovery are bound to the identity registry
- reputation is served through an eventually-consistent read model backed by chain state

## Repo Layout

```text
wog-mmorpg/
├── shard/                  # Game server, blockchain integration, tests
├── client/                 # Observer client
├── hardhat/                # Local contract workspace and local dev deployment flow
├── contracts/              # Repo-level Solidity sources
├── docs/                   # Product + implementation docs
└── world/                  # Zone/world data
```

Important paths:
- [server.ts](shard/src/server.ts)
- [devLocalContracts.ts](shard/src/config/devLocalContracts.ts)
- [SHARD_PERSISTENCE_ARCHITECTURE.md](docs/SHARD_PERSISTENCE_ARCHITECTURE.md)
- [ERC8004_FULL_INTEGRATION_PLAN.md](docs/ERC8004_FULL_INTEGRATION_PLAN.md)
- [docs/agents/README.md](docs/agents/README.md)

## Install

Prerequisites:
- Node.js 20+
- pnpm
- npm

Install app dependencies:

```bash
cd shard && pnpm install
cd ../client && pnpm install
cd ../hardhat && npm install
```

## Local Dev

The recommended full local integration flow now uses the `hardhat/` workspace plus `DEV=true`.

### 1. Start Hardhat

```bash
cd hardhat
npm run node
```

### 2. Deploy local contracts

```bash
cd hardhat
cp .env.example .env
npm run deploy:localhost
```

This writes [localhost.json](hardhat/deployments/localhost.json) with the deployed local addresses.

### 3. Start shard in local dev mode

```bash
cd shard
DEV=true REDIS_ALLOW_MEMORY_FALLBACK=true pnpm dev
```

When `DEV=true`, shard automatically loads the Hardhat manifest through [devLocalContracts.ts](shard/src/config/devLocalContracts.ts) and overrides stale local contract env values with the active local deployment.

That means local dev no longer requires manually copying all contract addresses into `shard/.env`.

### 4. Start client

```bash
cd client
pnpm dev
```

## Configuration

### Shard

Typical production-style `shard/.env` values include:

```env
JWT_SECRET=...
SERVER_PRIVATE_KEY=...
SKALE_BASE_RPC_URL=...
SKALE_BASE_CHAIN_ID=...
GOLD_CONTRACT_ADDRESS=0x...
ITEMS_CONTRACT_ADDRESS=0x...
CHARACTER_CONTRACT_ADDRESS=0x...
IDENTITY_REGISTRY_ADDRESS=0x...
REPUTATION_REGISTRY_ADDRESS=0x...
VALIDATION_REGISTRY_ADDRESS=0x...
THIRDWEB_CLIENT_ID=...
```

Notes:
- in `DEV=true`, the local Hardhat manifest is the preferred source for local contract addresses
- in non-dev environments, provide explicit RPC + contract addresses
- for standalone shard test runs that import auth code, `JWT_SECRET` must be set
- shard persistence now expects Redis by default; set `REQUIRE_REDIS_PERSISTENCE=false` only for explicit local fallback workflows

Additional persistence-related shard envs:

```env
REQUIRE_REDIS_PERSISTENCE=true
PLAYER_PERSIST_INTERVAL_MS=5000
CHAIN_OPERATION_MAX_RETRIES=8
CHARACTER_BOOTSTRAP_MAX_RETRIES=8
```

### Hardhat

See [HARDHAT_WORKSPACE_README.md](docs/agents/HARDHAT_WORKSPACE_README.md).

The local workspace contains:
- local copies of the WoG contracts
- mock `GOLD`, `ITEMS`, and `CHARACTERS` contracts for full shard integration testing
- a deploy script that writes the manifest consumed by shard dev mode

## ERC-8004 Integration

The current trust layer is documented in [ERC8004_FULL_INTEGRATION_PLAN.md]

Implemented pieces:
- identity registration on character bootstrap
- `agentId` persistence
- validation claim publishing
- agent-keyed reputation APIs
- eventual-consistency reconciliation between local reputation view and on-chain reputation state
- A2A resolution bound to the identity registry
- client reputation views surface identity registration status and validation badges
- PvP matchmaking uses the live character's on-chain `agentId` and `characterTokenId`

Primary API surfaces:
- `GET /api/agents/:agentId/identity`
- `GET /api/agents/:agentId/reputation`
- `GET /api/agents/:agentId/reputation/history`
- `GET /api/agents/:agentId/reputation/timeline`
- `GET /api/agents/:agentId/validations`
- `GET /a2a/resolve/:agentId`

## Tests

### Contract integration tests

```bash
cd hardhat
npm test
```

Current coverage includes:
- full local contract deployment
- shard-style identity bootstrap flow
- metadata writes
- validation claims
- reputation init and updates
- authorization and expiry paths
- zero-token character binding coverage

### Shard integration tests

Primary local full-flow:

```bash
cd shard
pnpm test
```

This orchestrates:
- Hardhat contract tests
- local contract deploy
- tracked chain-op store recovery tests
- shard-up bootstrap and ERC-8004 integration tests
- shard-down isolated replay recovery tests

Focused shard-side logic tests:

```bash
cd shard
JWT_SECRET=test npx tsx tests/partyIntegration.test.ts
JWT_SECRET=test npx tsx tests/reputation.test.ts
```

Focused persistence / reconciliation suites:

```bash
cd shard
pnpm run test:chain-ops
pnpm run test:character-bootstrap
pnpm run test:erc8004
pnpm run test:chain-recovery
pnpm run test:blockchain-writes
```

ERC-8004 end-to-end shard test, standalone:

```bash
cd shard
DEV=true JWT_SECRET=test npm run test:erc8004
```

The same e2e test can also run in non-dev mode if you provide explicit RPC + contract addresses:

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

Build checks:

```bash
cd client && npm run build
cd shard && pnpm build
cd hardhat && npm run compile
```

## Current Status

Persistence hardening now in place:
- Redis-backed live online player session restore
- Redis-backed party invites, membership restore, and friend requests
- Redis-backed agent runtime snapshot restore
- Redis-backed merchant state restore using stable merchant identity across restarts
- Redis-backed PvP stats, queue flush-on-join, and battle recovery metadata
- Redis-backed durable blockchain operation records for wallet/name/plot/reputation/guild/vault/auction/trade/prediction writes
- replayable processors for character mint, identity registration, validation publication, and metadata updates
- retry/reconciliation workers for async blockchain-backed bootstrap and bridge flows
- retry caps with visible permanent-failure states for tracked chain operations and character bootstrap
- frequent online-player checkpoints
- fail-fast boot when Redis persistence is required
- health endpoint reports persistence status

What is verified locally:
- local Hardhat contract deployment
- shard auto-configuration in `DEV=true`
- wallet registration and welcome gold
- character mint
- ERC-8004 identity registration
- validation publishing
- name registration
- spawn flow
- eventual-consistency reputation convergence
- durable character bootstrap recovery from Redis loss against on-chain truth
- processor-backed retry recovery for wallet, name, plot, and reputation flows
- processor-backed retry recovery for character mint, identity registration, validation, and metadata sync
- module-level import/type sanity for the tracked blockchain bridge updates
- client reputation UI uses the `agentId` endpoints and renders identity/validation state
- PvP queue join/leave uses the real live character identity instead of fabricated local IDs

What is not fully complete yet:
- final deployed/live verification on the target network
- some identity orchestration still lives in generic blockchain modules rather than being fully isolated under `shard/src/erc8004/`

## Additional Docs

- [SHARD_PERSISTENCE_ARCHITECTURE.md](docs/SHARD_PERSISTENCE_ARCHITECTURE.md)
- [ERC8004_FULL_INTEGRATION_PLAN.md](docs/ERC8004_FULL_INTEGRATION_PLAN.md)
- [docs/agents/README.md](docs/agents/README.md)

## License

MIT
