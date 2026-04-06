/**
 * Deploy PvPPredictionMarket to SKALE Base Sepolia.
 *
 * Usage:
 *   cd hardhat
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deployPredictionMarket.ts --network skaleSepolia
 */
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying PvPPredictionMarket with account:", deployer.address);

  const factory = await ethers.getContractFactory("PvPPredictionMarket");

  // Fee collector = deployer (treasury)
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const contract = await factory.deploy(deployer.address);
      await contract.waitForDeployment();
      const address = await contract.getAddress();
      console.log(`\nPvPPredictionMarket deployed at: ${address}`);
      console.log(`\nAdd to shard/.env:\n  PREDICTION_CONTRACT_ADDRESS=${address}`);
      return;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("nonce") || msg.includes("Pending transaction")) {
        console.log(`  Attempt ${attempt + 1}: nonce collision, retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed after 15 attempts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
