/**
 * Deploy a fresh WoGMockIdentityRegistry to a testnet so the bridge adapter
 * has something to wrap. The production registry @ 0x1351...db52 is on SKALE
 * Base mainnet only; testnet doesn't have one.
 *
 * Usage:
 *   cd hardhat
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *     npx hardhat run scripts/deployTestnetRegistry.ts --network skaleSepolia
 */
import "dotenv/config";
import hre from "hardhat";

const { ethers, network } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  const providerNetwork = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network:  ${network.name} (chainId: ${providerNetwork.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} (native)\n`);

  console.log("Deploying WoGMockIdentityRegistry...");
  const contract = await ethers.deployContract("WoGMockIdentityRegistry");
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`\n  WoGMockIdentityRegistry: ${address}`);
  console.log("\nDone. Pass this address to deployBridgeAdapter via IDENTITY_REGISTRY=...");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
