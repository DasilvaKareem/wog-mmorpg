/**
 * Deploy WoGBridgeAdapter to SKALE Base.
 *
 * Usage (mainnet):
 *   cd hardhat
 *   IDENTITY_REGISTRY=0x1351566E5fdDE4252F3542822e171686c461dB52 \
 *     BRIDGE_SIGNER=0x... DEPLOYER_PRIVATE_KEY=0x... SOURCE_CHAIN_ID=8453 \
 *     npx hardhat run scripts/deployBridgeAdapter.ts --network skale
 *
 * Usage (sepolia):
 *   IDENTITY_REGISTRY=0x<sepolia-registry> \
 *     BRIDGE_SIGNER=0x... DEPLOYER_PRIVATE_KEY=0x... SOURCE_CHAIN_ID=84532 \
 *     npx hardhat run scripts/deployBridgeAdapter.ts --network skaleSepolia
 *
 * BRIDGE_SIGNER: must equal the address derived from SERVER_PRIVATE_KEY on the shard.
 * IDENTITY_REGISTRY: defaults to the production registry; on testnet, deploy a fresh
 *                    WoGMockIdentityRegistry and pass its address here.
 * SOURCE_CHAIN_ID: chain id of the OTHER side (Base). Mainnet = 8453, Sepolia = 84532.
 */
import "dotenv/config";
import hre from "hardhat";

const { ethers, network } = hre;

const DEFAULT_IDENTITY_REGISTRY = "0x1351566E5fdDE4252F3542822e171686c461dB52";

async function main() {
  const [deployer] = await ethers.getSigners();
  const providerNetwork = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network:  ${network.name} (chainId: ${providerNetwork.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} sFUEL\n`);

  const registry = process.env.IDENTITY_REGISTRY || DEFAULT_IDENTITY_REGISTRY;
  if (!ethers.isAddress(registry)) {
    throw new Error(`Invalid IDENTITY_REGISTRY: ${registry}`);
  }
  const bridgeSigner = process.env.BRIDGE_SIGNER;
  if (!bridgeSigner || !ethers.isAddress(bridgeSigner)) {
    throw new Error("Set BRIDGE_SIGNER env var to the shard server's signer address");
  }
  const sourceChainIdRaw = process.env.SOURCE_CHAIN_ID;
  if (!sourceChainIdRaw) {
    throw new Error(
      "Set SOURCE_CHAIN_ID env var to the Base chain id (mainnet=8453, sepolia=84532)",
    );
  }
  const sourceChainId = BigInt(sourceChainIdRaw);
  console.log(`Wraps registry:   ${registry}`);
  console.log(`Bridge signer:    ${bridgeSigner}`);
  console.log(`Source chain id:  ${sourceChainId}\n`);

  const factory = await ethers.getContractFactory("WoGBridgeAdapter");
  console.log("Deploying WoGBridgeAdapter...");
  const contract = await factory.deploy(registry, bridgeSigner, sourceChainId);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`\n  WoGBridgeAdapter: ${address}`);

  const onchainSigner = await contract.bridgeSigner();
  const onchainRegistry = await contract.registry();
  console.log(`  bridgeSigner readback: ${onchainSigner}`);
  console.log(`  registry readback:     ${onchainRegistry}`);
  if (onchainSigner.toLowerCase() !== bridgeSigner.toLowerCase()) {
    throw new Error("Deployed signer does not match expected");
  }
  if (onchainRegistry.toLowerCase() !== registry.toLowerCase()) {
    throw new Error("Deployed registry does not match expected");
  }

  console.log("\nDone. Add to shard/.env:");
  console.log(`  SKALE_BRIDGE_ADAPTER_CONTRACT=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
