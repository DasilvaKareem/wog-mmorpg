# ERC-8004 Architecture And Testing README

This is the authoritative agent-facing implementation doc for the current WoG ERC-8004 architecture.

It documents:

- official registry integration on supported SKALE chains
- local Hardhat mock integration for dev and CI
- current identity, reputation, and validation flow in shard
- what tests are passing today and what each test proves

## Quick Ops Checklist

Use this when you need a fast end-to-end health check of the current ERC-8004 stack.

1. Start local chain:

```bash
cd hardhat
npm run node
```

2. Deploy local contracts:

```bash
cd hardhat
npm run deploy:localhost
```

3. Verify contract layer:

```bash
cd hardhat
npm test
```

4. Verify shard build:

```bash
cd shard
npm run build
```

5. Run shard ERC-8004 integration test (deterministic local mode):

```bash
cd shard
DEV=true REDIS_ALLOW_MEMORY_FALLBACK=true LOCAL_TEST_MODE=core JWT_SECRET=local-dev-jwt-secret npx tsx tests/erc8004DevIntegration.test.ts
```

6. Optional official compatibility read checks (Sepolia identity + reputation):

```bash
node --input-type=module
```

Run direct `eth_getCode` + `eth_call(getVersion)` against:

- identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`

## Supported Networks

WoG currently supports three chains for ERC-8004 integration:

- `1187947933` (`skale-base`)
- `324705682` (`skale-base-sepolia`)
- `31337` (`hardhat-local`)

Primary source:

- [official.ts](../../shard/src/erc8004/official.ts)

### Official Registry Mapping

#### SKALE Base Mainnet (`1187947933`)

- Identity: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- Validation: optional (not required by runtime)

#### SKALE Base Sepolia (`324705682`)

- Identity: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Reputation: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- Validation: optional (not required by runtime)

#### Local Hardhat (`31337`)

- Uses local deploy manifest addresses from `hardhat/deployments/localhost.json`

## Runtime Architecture

### Identity

Identity is the trust anchor. Character bootstrap binds gameplay entities to `agentId`.

Key behavior:

1. mint or recover character NFT
2. register identity in identity registry
3. persist `agentId` and `characterTokenId`
4. transfer identity NFT to player owner wallet

Primary files:

- [blockchain.ts](../../shard/src/blockchain/blockchain.ts)
- [identity.ts](../../shard/src/erc8004/identity.ts)
- [characterRoutes.ts](../../shard/src/character/characterRoutes.ts)

### Reputation

Reputation is keyed by `agentId`, never wallet.

Primary files:

- [reputationChain.ts](../../shard/src/economy/reputationChain.ts)
- [reputationManager.ts](../../shard/src/economy/reputationManager.ts)
- [reputationRoutes.ts](../../shard/src/economy/reputationRoutes.ts)

### Validation (Optional Mode)

Validation is implemented but runtime-optional.

Rules:

- If `VALIDATION_REGISTRY_ADDRESS` exists, shard publishes and reads validation claims.
- If missing, shard does not fail identity/reputation/gameplay flow.
- API returns empty validations instead of hard failure.

Primary files:

- [validation.ts](../../shard/src/erc8004/validation.ts)
- [devLocalContracts.ts](../../shard/src/config/devLocalContracts.ts)
- [official.ts](../../shard/src/erc8004/official.ts)

## Official vs Local Switching

Switching is environment-driven, not code-path-driven.

### DEV mode (`DEV=true`)

- reads local Hardhat deployment manifest
- auto-wires local contract addresses for `31337`
- used for full local integration testing

### Non-DEV mode

- uses official network mapping by chain id
- fills identity/reputation from official map
- leaves validation optional

Primary file:

- [devLocalContracts.ts](../../shard/src/config/devLocalContracts.ts)

## A2A And Identity Resolution

A2A metadata now reflects actual network mode:

- chain name from chain id
- `mode: "official"` for supported SKALE ids
- `mode: "local-mock"` for local hardhat

Primary file:

- [a2aRoutes.ts](../../shard/src/agents/a2aRoutes.ts)

## Local Contracts

Local mock registries were aligned to official runtime semantics used by shard.

Primary contracts (single source of truth):

- [WoGMockIdentityRegistry.sol](../../hardhat/contracts/WoGMockIdentityRegistry.sol)
- [WoGMockReputationRegistry.sol](../../hardhat/contracts/WoGMockReputationRegistry.sol)
- [WoGMockValidationRegistry.sol](../../hardhat/contracts/WoGMockValidationRegistry.sol)

Deploy script wiring:

- [deploy.ts](../../hardhat/scripts/deploy.ts)

## Test Matrix

### 1. Contract Test Layer (Hardhat)

Command:

```bash
cd hardhat
npm test
```

What it validates:

- local identity registry semantics
- local reputation registry semantics
- local validation registry semantics
- cross-registry compatibility for local dev

Status: passing.

### 2. Shard Full Local Integration

Command:

```bash
cd shard
DEV=true REDIS_ALLOW_MEMORY_FALLBACK=true LOCAL_TEST_MODE=core JWT_SECRET=local-dev-jwt-secret npx tsx tests/erc8004DevIntegration.test.ts
```

What it validates:

- shard auth + wallet bootstrap
- character creation and identity registration
- on-chain identity metadata reads
- validation claim publication and reads (local mode)
- spawn with `agentId`
- reputation convergence from API to chain summary

Status: passing (`20 passed, 0 failed` on latest verified local run).

### 3. Official Sepolia Compatibility (Read-Only)

Validated by direct RPC calls:

- identity has code and returns `getVersion() = 2.0.0`
- reputation has code and returns `getVersion() = 2.0.0`
- reputation `getIdentityRegistry()` points to official Sepolia identity

This confirms official Sepolia identity+reputation compatibility with shard ABI surface.

## Notes For Agents

- Do not assume validation registry exists on every supported official network.
- Do not key trust logic by wallet; always key by `agentId`.
- Prefer updating [official.ts](../../shard/src/erc8004/official.ts) for network/address mapping changes.
- Keep local integration deterministic by using `LOCAL_TEST_MODE=core` during shard integration tests.
