/**
 * Deploy Reputation System Contracts
 * Deploys ERC-8004 Identity and Reputation registries
 */

import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Deploying WoG Reputation System...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString(), "\n");

  // Deploy Identity Registry
  console.log("📝 Deploying WoGIdentityRegistry...");
  const IdentityRegistry = await ethers.getContractFactory("WoGIdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy();
  await identityRegistry.deployed();

  console.log("✅ IdentityRegistry deployed to:", identityRegistry.address);
  console.log("   Transaction hash:", identityRegistry.deployTransaction.hash, "\n");

  // Deploy Reputation Registry
  console.log("📝 Deploying WoGReputationRegistry...");
  const ReputationRegistry = await ethers.getContractFactory("WoGReputationRegistry");
  const reputationRegistry = await ReputationRegistry.deploy();
  await reputationRegistry.deployed();

  console.log("✅ ReputationRegistry deployed to:", reputationRegistry.address);
  console.log("   Transaction hash:", reputationRegistry.deployTransaction.hash, "\n");

  // Authorize backend wallet (from environment)
  const backendWallet = process.env.BACKEND_WALLET_ADDRESS || deployer.address;

  console.log("🔐 Authorizing backend wallet:", backendWallet);

  const authIdentityTx = await identityRegistry.authorizeMinter(backendWallet);
  await authIdentityTx.wait();
  console.log("   ✅ Authorized as Identity minter");

  const authReputationTx = await reputationRegistry.authorizeReporter(backendWallet);
  await authReputationTx.wait();
  console.log("   ✅ Authorized as Reputation reporter\n");

  // Print summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Deployment Complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\nAdd these to your .env file:\n");
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityRegistry.address}`);
  console.log(`REPUTATION_REGISTRY_ADDRESS=${reputationRegistry.address}`);
  console.log("\nVerification commands:");
  console.log(`npx hardhat verify --network <network> ${identityRegistry.address}`);
  console.log(`npx hardhat verify --network <network> ${reputationRegistry.address}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
