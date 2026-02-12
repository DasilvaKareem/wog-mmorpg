/**
 * One-time deploy script for the WoGTrade contract on the BITE v2 Sandbox chain.
 *
 * Usage:
 *   npx tsx shard/src/deployTrade.ts
 *
 * Requires env vars:
 *   SERVER_PRIVATE_KEY — deployer wallet private key
 *   BITE_V2_RPC_URL    — (optional) override RPC URL for BITE v2 sandbox
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import solc from "solc";
import { biteWallet } from "./biteChain.js";

async function main() {
  // 1. Read Solidity source
  const solPath = resolve(import.meta.dirname, "../../contracts/WoGTrade.sol");
  const source = readFileSync(solPath, "utf-8");

  console.log("Compiling WoGTrade.sol...");

  // 2. Compile with solc
  const input = {
    language: "Solidity",
    sources: {
      "WoGTrade.sol": { content: source },
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

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

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

  const compiled = output.contracts["WoGTrade.sol"]["WoGTrade"];
  const abi = compiled.abi;
  const bytecode = "0x" + compiled.evm.bytecode.object;

  console.log(`Compiled successfully. Bytecode size: ${bytecode.length / 2} bytes`);
  console.log(`Deployer address: ${biteWallet.address}`);

  // 3. Deploy
  console.log("Deploying to BITE v2 Sandbox...");
  const factory = new ethers.ContractFactory(abi, bytecode, biteWallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nWoGTrade deployed at: ${address}`);
  console.log(`\nAdd to your .env:`);
  console.log(`  TRADE_CONTRACT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
