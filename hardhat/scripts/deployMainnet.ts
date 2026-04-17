/**
 * Deploy production contracts to SKALE Base mainnet.
 * Handles nonce collisions from the running production shard.
 *
 * Usage:
 *   cd hardhat
 *   npx hardhat run scripts/deployMainnet.ts --network skale
 */
import "dotenv/config";
import hre from "hardhat";
import fs from "node:fs";
import path from "node:path";
import type { BaseContract, ContractFactory } from "ethers";

const { ethers, network } = hre;

async function deployWithRetry(
  name: string,
  factory: ContractFactory,
  args: unknown[] = [],
  maxAttempts = 15
): Promise<{ contract: BaseContract; address: string }> {
  console.log(`Deploying ${name}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const contract = await factory.deploy(...args);
      await contract.waitForDeployment();
      const address = await contract.getAddress();
      console.log(`  ${name}: ${address}`);
      return { contract, address };
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("nonce") || msg.includes("Pending transaction")) {
        console.log(`  Attempt ${i + 1}: nonce collision, retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to deploy ${name} after ${maxAttempts} attempts`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const providerNetwork = await ethers.provider.getNetwork();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Network: ${network.name} (chainId: ${providerNetwork.chainId})`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} sFUEL\n`);

  // --- Production contracts only (no mocks) ---

  const AuctionHouse = await ethers.getContractFactory("WoGAuctionHouse");
  const auctionHouse = await deployWithRetry("WoGAuctionHouse", AuctionHouse);

  const Trade = await ethers.getContractFactory("WoGTrade");
  const trade = await deployWithRetry("WoGTrade", Trade);

  const Guild = await ethers.getContractFactory("WoGGuild");
  const guild = await deployWithRetry("WoGGuild", Guild);

  const GuildVault = await ethers.getContractFactory("WoGGuildVault");
  const guildVault = await deployWithRetry("WoGGuildVault", GuildVault, [guild.address]);

  const LandRegistry = await ethers.getContractFactory("WoGLandRegistry");
  const landRegistry = await deployWithRetry("WoGLandRegistry", LandRegistry);

  const NameService = await ethers.getContractFactory("WoGNameService");
  const nameService = await deployWithRetry("WoGNameService", NameService);

  const PredictionMarket = await ethers.getContractFactory("PvPPredictionMarket");
  const predictionMarket = await deployWithRetry("PvPPredictionMarket", PredictionMarket, [deployer.address]);

  console.log("\n=== Environment values ===");
  console.log(`AUCTION_HOUSE_CONTRACT_ADDRESS=${auctionHouse.address}`);
  console.log(`TRADE_CONTRACT_ADDRESS=${trade.address}`);
  console.log(`GUILD_CONTRACT_ADDRESS=${guild.address}`);
  console.log(`GUILD_VAULT_CONTRACT_ADDRESS=${guildVault.address}`);
  console.log(`LAND_REGISTRY_CONTRACT_ADDRESS=${landRegistry.address}`);
  console.log(`NAME_SERVICE_CONTRACT_ADDRESS=${nameService.address}`);
  console.log(`PREDICTION_CONTRACT_ADDRESS=${predictionMarket.address}`);

  const manifest = {
    network: network.name,
    chainId: Number(providerNetwork.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      AUCTION_HOUSE_CONTRACT_ADDRESS: auctionHouse.address,
      TRADE_CONTRACT_ADDRESS: trade.address,
      GUILD_CONTRACT_ADDRESS: guild.address,
      GUILD_VAULT_CONTRACT_ADDRESS: guildVault.address,
      LAND_REGISTRY_CONTRACT_ADDRESS: landRegistry.address,
      NAME_SERVICE_CONTRACT_ADDRESS: nameService.address,
      PREDICTION_CONTRACT_ADDRESS: predictionMarket.address,
    },
  };

  const deploymentsDir = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const manifestPath = path.join(deploymentsDir, `${network.name}-mainnet.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nSaved deployment manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
