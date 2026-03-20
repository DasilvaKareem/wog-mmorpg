import "dotenv/config";
import hre from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { ethers, network } = hre;

async function deployContract(name: string, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name}: ${address}`);
  return { contract, address };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const providerNetwork = await ethers.provider.getNetwork();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Network: ${network.name}`);

  const gold = await deployContract("WoGMockGold");
  const items = await deployContract("WoGMockItems");
  const characters = await deployContract("WoGMockCharacters");
  const identity = await deployContract("WoGIdentityRegistry");
  const reputation = await deployContract("WoGReputationRegistry");
  const validation = await deployContract("WoGValidationRegistry");
  const auctionHouse = await deployContract("WoGAuctionHouse");
  const trade = await deployContract("WoGTrade");
  const guild = await deployContract("WoGGuild");
  const guildVault = await deployContract("WoGGuildVault", [guild.address]);
  const landRegistry = await deployContract("WoGLandRegistry");
  const nameService = await deployContract("WoGNameService");
  const predictionMarket = await deployContract("PvPPredictionMarket", [deployer.address]);

  console.log("\nEnvironment values:");
  console.log(`GOLD_CONTRACT_ADDRESS=${gold.address}`);
  console.log(`ITEMS_CONTRACT_ADDRESS=${items.address}`);
  console.log(`CHARACTER_CONTRACT_ADDRESS=${characters.address}`);
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identity.address}`);
  console.log(`REPUTATION_REGISTRY_ADDRESS=${reputation.address}`);
  console.log(`VALIDATION_REGISTRY_ADDRESS=${validation.address}`);
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
    deployedAt: new Date().toISOString(),
    environment: {
      GOLD_CONTRACT_ADDRESS: gold.address,
      ITEMS_CONTRACT_ADDRESS: items.address,
      CHARACTER_CONTRACT_ADDRESS: characters.address,
      IDENTITY_REGISTRY_ADDRESS: identity.address,
      REPUTATION_REGISTRY_ADDRESS: reputation.address,
      VALIDATION_REGISTRY_ADDRESS: validation.address,
      AUCTION_HOUSE_CONTRACT_ADDRESS: auctionHouse.address,
      TRADE_CONTRACT_ADDRESS: trade.address,
      GUILD_CONTRACT_ADDRESS: guild.address,
      GUILD_VAULT_CONTRACT_ADDRESS: guildVault.address,
      LAND_REGISTRY_CONTRACT_ADDRESS: landRegistry.address,
      NAME_SERVICE_CONTRACT_ADDRESS: nameService.address,
      PREDICTION_CONTRACT_ADDRESS: predictionMarket.address,
    },
  };

  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const deploymentsDir = path.resolve(thisDir, "../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const manifestPath = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nSaved deployment manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
