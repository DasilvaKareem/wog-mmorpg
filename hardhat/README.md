# WoG Hardhat Workspace

Local Hardhat project for compiling, testing, and deploying the WoG Solidity contracts against:

- the built-in Hardhat network
- a local Hardhat node at `http://127.0.0.1:8545`

## Included contracts

This workspace contains copies of the app's Solidity contracts from the repo-level [contracts](/home/preyanshu/wog-mmorpg/contracts) folder, including:

- `WoGIdentityRegistry.sol`
- `WoGReputationRegistry.sol`
- `WoGValidationRegistry.sol`
- `WoGAuctionHouse.sol`
- `WoGTrade.sol`
- `WoGGuild.sol`
- `WoGGuildVault.sol`
- `WoGLandRegistry.sol`
- `WoGNameService.sol`
- `PvPPredictionMarket.sol`

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

Start a local chain:

```bash
npm run node
```

Deploy to the local node:

```bash
cp .env.example .env
npm run deploy:localhost
```

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

These can be copied into the shard `.env` for local app testing.
