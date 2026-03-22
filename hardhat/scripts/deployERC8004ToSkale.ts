/**
 * Deploy the 3 ERC-8004 registry contracts to SKALE Base via Hardhat.
 * Handles nonce collisions from the running production shard.
 *
 * Usage:
 *   cd hardhat
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deployERC8004ToSkale.ts --network skale
 */
import { ethers } from "hardhat";
import type { BaseContract, ContractFactory } from "ethers";

async function deployWithRetry(
  name: string,
  factory: ContractFactory,
  maxAttempts = 15
): Promise<BaseContract> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const contract = await factory.deploy();
      await contract.waitForDeployment();
      return contract;
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
  const address = await deployer.getAddress();
  console.log(`Deployer: ${address}`);

  const nonce = await deployer.getNonce();
  console.log(`Current nonce: ${nonce}`);

  // 1. WoGIdentityRegistry
  console.log("\nDeploying WoGIdentityRegistry...");
  const Identity = await ethers.getContractFactory("WoGIdentityRegistry");
  const identity = await deployWithRetry("WoGIdentityRegistry", Identity);
  const identityAddr = await identity.getAddress();
  console.log(`  WoGIdentityRegistry: ${identityAddr}`);

  const isMinter = await (identity as any).authorizedMinters(address);
  console.log(`  Deployer is authorized minter: ${isMinter}`);

  // 2. WoGReputationRegistry
  console.log("\nDeploying WoGReputationRegistry...");
  const Reputation = await ethers.getContractFactory("WoGReputationRegistry");
  const reputation = await deployWithRetry("WoGReputationRegistry", Reputation);
  const reputationAddr = await reputation.getAddress();
  console.log(`  WoGReputationRegistry: ${reputationAddr}`);

  // 3. WoGValidationRegistry
  console.log("\nDeploying WoGValidationRegistry...");
  const Validation = await ethers.getContractFactory("WoGValidationRegistry");
  const validation = await deployWithRetry("WoGValidationRegistry", Validation);
  const validationAddr = await validation.getAddress();
  console.log(`  WoGValidationRegistry: ${validationAddr}`);

  // Smoke test: register an identity
  console.log("\nSmoke test: registering test identity...");
  for (let i = 0; i < 10; i++) {
    try {
      const registerTx = await (identity as any)["register(string)"](
        "https://wog.urbantech.dev/a2a/smoke-test"
      );
      const receipt = await registerTx.wait();
      const event = receipt!.logs.find(
        (l: any) => l.topics?.[0] === ethers.id("Registered(uint256,string,address)")
      );
      if (event) {
        console.log(`  Test agentId: ${BigInt(event.topics[1])}`);
      } else {
        console.log("  WARNING: No Registered event found!");
      }
      break;
    } catch (err: any) {
      if (String(err?.message ?? "").includes("nonce")) {
        console.log(`  Smoke test nonce collision, retrying...`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      console.warn("  Smoke test failed:", err.message?.slice(0, 100));
      break;
    }
  }

  console.log("\n=== Add these to shard/.env ===");
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityAddr}`);
  console.log(`REPUTATION_REGISTRY_ADDRESS=${reputationAddr}`);
  console.log(`VALIDATION_REGISTRY_ADDRESS=${validationAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
