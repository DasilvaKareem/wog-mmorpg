/**
 * One-time deploy script for the WoGNameService contract on the BITE v2 Sandbox chain.
 *
 * Usage:
 *   npx tsx shard/src/deploy/deployNameService.ts
 *
 * Requires env vars:
 *   SERVER_PRIVATE_KEY — deployer wallet private key
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import solc from "solc";
import { biteWallet } from "../blockchain/biteChain.js";

/** Resolve @openzeppelin imports from shard/node_modules */
function findImports(importPath: string) {
  const base = resolve(import.meta.dirname, "../../node_modules");
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
    "../../../hardhat/contracts/WoGNameService.sol"
  );
  const source = readFileSync(solPath, "utf-8");

  console.log("Compiling WoGNameService.sol...");

  // 2. Compile with solc + OZ import resolver
  const input = {
    language: "Solidity",
    sources: {
      "WoGNameService.sol": { content: source },
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
    output.contracts["WoGNameService.sol"]["WoGNameService"];
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

  // 3. Deploy (use pending nonce to avoid stuck-tx conflicts on SKALE)
  console.log("Deploying to SKALE Base mainnet...");
  const pendingNonce = await biteWallet.getNonce("pending");
  console.log(`Using nonce: ${pendingNonce}`);
  const factory = new ethers.ContractFactory(abi, bytecode, biteWallet);
  const contract = await factory.deploy({ nonce: pendingNonce });
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nWoGNameService deployed at: ${address}`);
  console.log(`\nAdd to your .env:`);
  console.log(`  NAME_SERVICE_CONTRACT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
