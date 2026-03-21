# WoG Hardhat Workspace

Local Hardhat project for compiling, testing, and deploying the WoG Solidity contracts against:

- the built-in Hardhat network
- a local Hardhat node at `http://127.0.0.1:8545`

## Included contracts

This workspace is the Solidity source-of-truth for WoG contracts, including:

- `WoGMockIdentityRegistry.sol`
- `WoGMockReputationRegistry.sol`
- `WoGMockValidationRegistry.sol`
- `WoGAuctionHouse.sol`
- `WoGTrade.sol`
- `WoGGuild.sol`
- `WoGGuildVault.sol`
- `WoGLandRegistry.sol`
- `WoGNameService.sol`
- `PvPPredictionMarket.sol`

It also includes local mock prerequisite asset contracts used by shard local-dev integration:

- `WoGMockGold.sol`
- `WoGMockItems.sol`
- `WoGMockCharacters.sol`

## Commands

Install dependencies:

```bash
cd hardhat
npm install
```

Compile:

```bash
npm run compile
```

Run tests:

```bash
npm test
```

The Hardhat suite now covers more than deploy smoke tests:
- local mock asset contracts
- identity registration flow
- metadata writes
- validation claims
- reputation updates
- authorization and expiry paths
- zero-token local character binding

Start a local chain:

```bash
npm run node
```

Deploy to the local node:

```bash
cp .env.example .env
npm run deploy:localhost
```

This writes [localhost.json](../../hardhat/deployments/localhost.json), which shard consumes automatically when started with `DEV=true`.

Deploy to the in-process Hardhat network:

```bash
npm run deploy:hardhat
```

## Environment

Copy `.env.example` to `.env` and set:

- `HARDHAT_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`

`DEPLOYER_PRIVATE_KEY` is only required for `localhost` deployment when you want to use a specific funded account instead of Hardhat's default unlocked accounts.

## Deployment output

The deploy script prints addresses for:

- `GOLD_CONTRACT_ADDRESS`
- `ITEMS_CONTRACT_ADDRESS`
- `CHARACTER_CONTRACT_ADDRESS`
- `IDENTITY_REGISTRY_ADDRESS`
- `REPUTATION_REGISTRY_ADDRESS`
- `VALIDATION_REGISTRY_ADDRESS`
- `AUCTION_HOUSE_CONTRACT_ADDRESS`
- `TRADE_CONTRACT_ADDRESS`
- `GUILD_CONTRACT_ADDRESS`
- `GUILD_VAULT_CONTRACT_ADDRESS`
- `LAND_REGISTRY_CONTRACT_ADDRESS`
- `NAME_SERVICE_CONTRACT_ADDRESS`
- `PREDICTION_CONTRACT_ADDRESS`

For local shard dev, these addresses are also written to [localhost.json](../../hardhat/deployments/localhost.json), and shard auto-loads them when `DEV=true`.

## Shard Integration

Recommended local full-stack flow:

```bash
# terminal 1
cd hardhat
npm run node

# terminal 2
cd hardhat
npm run deploy:localhost

# terminal 3
cd shard
DEV=true REDIS_ALLOW_MEMORY_FALLBACK=true pnpm dev
```

Shard-side ERC-8004 e2e test:

```bash
cd shard
DEV=true JWT_SECRET=test npm run test:erc8004
```

The same test can also run without `DEV=true` if you provide explicit RPC + contract addresses.
