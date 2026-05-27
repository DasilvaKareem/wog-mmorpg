/**
 * Deploy WoGCharacterBase to Coinbase Base (mainnet or sepolia).
 *
 * Usage:
 *   cd hardhat
 *   BRIDGE_SIGNER=0x... DEPLOYER_PRIVATE_KEY=0x... SOURCE_CHAIN_ID=324705682 \
 *     npx hardhat run scripts/deployCharacterBase.ts --network baseSepolia
 *
 *   For mainnet:
 *   BRIDGE_SIGNER=0x... DEPLOYER_PRIVATE_KEY=0x... SOURCE_CHAIN_ID=1187947933 \
 *     npx hardhat run scripts/deployCharacterBase.ts --network base
 *
 * BRIDGE_SIGNER: address of the server account that signs EIP-712 bridge claims.
 *                Must equal the address derived from SERVER_PRIVATE_KEY on the shard.
 * SOURCE_CHAIN_ID: chain id of the OTHER side (SKALE). Mainnet = 1187947933,
 *                  SKALE Base Sepolia = 324705682.
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
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  const bridgeSigner = process.env.BRIDGE_SIGNER;
  if (!bridgeSigner || !ethers.isAddress(bridgeSigner)) {
    throw new Error("Set BRIDGE_SIGNER env var to the shard server's signer address");
  }
  const sourceChainIdRaw = process.env.SOURCE_CHAIN_ID;
  if (!sourceChainIdRaw) {
    throw new Error(
      "Set SOURCE_CHAIN_ID env var to the SKALE chain id (mainnet=1187947933, sepolia=324705682)",
    );
  }
  const sourceChainId = BigInt(sourceChainIdRaw);
  console.log(`Bridge signer:    ${bridgeSigner}`);
  console.log(`Source chain id:  ${sourceChainId}\n`);

  const factory = await ethers.getContractFactory("WoGCharacterBase");
  console.log("Deploying WoGCharacterBase...");
  const contract = await factory.deploy(bridgeSigner, sourceChainId);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`\n  WoGCharacterBase: ${address}`);

  // Read back to verify ctor wired up
  const onchainSigner = await contract.bridgeSigner();
  console.log(`  bridgeSigner readback: ${onchainSigner}`);
  if (onchainSigner.toLowerCase() !== bridgeSigner.toLowerCase()) {
    throw new Error("Deployed signer does not match expected");
  }

  console.log("\nDone. Add to shard/.env:");
  console.log(`  BASE_MAINNET_CHARACTER_CONTRACT=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
