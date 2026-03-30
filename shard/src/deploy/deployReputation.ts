/**
 * One-time deploy script for the WoGMockReputationRegistry contract.
 *
 * Usage:
 *   npx tsx shard/src/deployReputation.ts
 *
 * Requires env vars:
 *   SERVER_PRIVATE_KEY — deployer wallet private key
 *   SKALE_BASE_RPC_URL — (optional) override RPC URL for SKALE Base mainnet
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import solc from "solc";
import { biteWallet } from "../blockchain/biteChain.js";

/** Resolve @openzeppelin imports from shard/node_modules */
function findImports(importPath: string) {
  const base = resolve(import.meta.dirname, "../node_modules");
  try {
    const content = readFileSync(resolve(base, importPath), "utf-8");
    return { contents: content };
  } catch {
    return { error: "File not found: " + importPath };
  }
}

async function main() {
  // 1. Read Solidity source
  const solPath = resolve(
    import.meta.dirname,
    "../../../hardhat/contracts/WoGMockReputationRegistry.sol"
  );
  const source = readFileSync(solPath, "utf-8");

  console.log("Compiling WoGMockReputationRegistry.sol...");

  // 2. Compile with solc + OZ import resolver
  const input = {
    language: "Solidity",
    sources: {
      "WoGMockReputationRegistry.sol": { content: source },
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
    // Print warnings
    for (const warn of output.errors) {
      if (warn.severity === "warning") {
        console.warn(warn.formattedMessage);
      }
    }
  }

  const compiled =
    output.contracts["WoGMockReputationRegistry.sol"]["WoGMockReputationRegistry"];
  const abi = compiled.abi;
  const bytecode = "0x" + compiled.evm.bytecode.object;

  console.log(
    `Compiled successfully. Bytecode size: ${bytecode.length / 2} bytes`
  );

  if (!biteWallet) {
    console.error("SERVER_PRIVATE_KEY not set — cannot deploy");
    process.exit(1);
  }

  const deployerAddress = await biteWallet.getAddress();
  console.log(`Deployer address: ${deployerAddress}`);

  // 3. Deploy
  console.log("Deploying to SKALE Base mainnet...");
  const factory = new ethers.ContractFactory(abi, bytecode, biteWallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nWoGMockReputationRegistry deployed at: ${address}`);
  console.log(`\nAdd to your .env:`);
  console.log(`  REPUTATION_REGISTRY_ADDRESS=${address}`);

  // 4. Deployer is already authorized via constructor (authorizedReporters[msg.sender] = true)
  // but let's confirm by calling authorizeReporter explicitly for clarity in logs
  const deployedContract = new ethers.Contract(address, abi, biteWallet);
  const tx = await deployedContract.authorizeReporter(deployerAddress);
  await tx.wait();
  console.log(`\nDeployer ${deployerAddress} confirmed as authorized reporter.`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
