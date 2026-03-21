/**
 * One-time deploy script for the WoGLandRegistry contract on SKALE Base.
 *
 * Usage:
 *   npx tsx shard/src/deploy/deployLandRegistry.ts
 *
 * Requires env vars:
 *   SERVER_PRIVATE_KEY — deployer wallet private key
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import solc from "solc";
import { biteProvider } from "../blockchain/biteChain.js";

/** Resolve @openzeppelin imports from shard/node_modules (pnpm-compatible) */
function findImports(importPath: string) {
  const shardRoot = resolve(import.meta.dirname, "../..");
  const candidates = [
    resolve(shardRoot, "node_modules", importPath),
    resolve(shardRoot, "node_modules/.pnpm/@openzeppelin+contracts@4.9.6/node_modules", importPath),
  ];
  for (const p of candidates) {
    try {
      const content = readFileSync(p, "utf-8");
      return { contents: content };
    } catch { /* try next */ }
  }
  return { error: "File not found: " + importPath };
}

async function main() {
  // 1. Read Solidity source
  const solPath = resolve(
    import.meta.dirname,
    "../../../hardhat/contracts/WoGLandRegistry.sol"
  );
  const source = readFileSync(solPath, "utf-8");

  console.log("Compiling WoGLandRegistry.sol...");

  // 2. Compile with solc + OZ import resolver
  const input = {
    language: "Solidity",
    sources: {
      "WoGLandRegistry.sol": { content: source },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
      optimizer: { enabled: true, runs: 200 },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImports })
  );

  // Check for compilation errors
  if (output.errors) {
    const errors = output.errors.filter(
      (e: { severity: string }) => e.severity === "error"
    );
    if (errors.length > 0) {
      console.error("Compilation errors:");
      for (const err of errors) {
        console.error(err.formattedMessage);
      }
      process.exit(1);
    }
    for (const warn of output.errors) {
      if (warn.severity === "warning") {
        console.warn(warn.formattedMessage);
      }
    }
  }

  const compiled =
    output.contracts["WoGLandRegistry.sol"]["WoGLandRegistry"];
  const abi = compiled.abi;
  const bytecode = "0x" + compiled.evm.bytecode.object;

  console.log(
    `Compiled successfully. Bytecode size: ${bytecode.length / 2} bytes`
  );

  const pk = process.env.SERVER_PRIVATE_KEY;
  if (!pk) {
    console.error("SERVER_PRIVATE_KEY not set — cannot deploy");
    process.exit(1);
  }

  // Use a fresh wallet (no NonceManager) to avoid nonce conflicts with running server
  const deployWallet = new ethers.Wallet(pk, biteProvider);
  const deployerAddress = await deployWallet.getAddress();
  console.log(`Deployer address: ${deployerAddress}`);

  // Use "latest" nonce + offset to skip past pending server txs
  const latestNonce = await biteProvider.getTransactionCount(deployerAddress, "latest");
  const pendingNonce = await biteProvider.getTransactionCount(deployerAddress, "pending");
  const nonce = Math.max(latestNonce, pendingNonce) + 2; // skip past any in-flight txs
  console.log(`Nonces — latest: ${latestNonce}, pending: ${pendingNonce}, using: ${nonce}`);

  // 3. Deploy
  console.log("Deploying WoGLandRegistry to SKALE Base...");
  const factory = new ethers.ContractFactory(abi, bytecode, deployWallet);
  const contract = await factory.deploy({ nonce });
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅ WoGLandRegistry deployed at: ${address}`);
  console.log(`\nAdd to your .env:`);
  console.log(`  LAND_REGISTRY_CONTRACT_ADDRESS=${address}`);

  // 4. Verify owner
  const deployedContract = new ethers.Contract(address, abi, deployWallet);
  const owner = await deployedContract.owner();
  console.log(`\nContract owner: ${owner}`);
  console.log(`Deployer matches owner: ${owner.toLowerCase() === deployerAddress.toLowerCase()}`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
