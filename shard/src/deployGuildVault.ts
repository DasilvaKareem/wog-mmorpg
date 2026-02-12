/**
 * One-time deploy script for the WoGGuildVault contract on the BITE v2 Sandbox chain.
 *
 * Usage:
 *   npx tsx shard/src/deployGuildVault.ts
 *
 * Requires env vars:
 *   SERVER_PRIVATE_KEY — deployer wallet private key
 *   GUILD_CONTRACT_ADDRESS — address of the main WoGGuild contract
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import solc from "solc";
import { biteWallet } from "./biteChain.js";

async function main() {
  const guildContractAddress = process.env.GUILD_CONTRACT_ADDRESS;
  if (!guildContractAddress) {
    console.error("GUILD_CONTRACT_ADDRESS not set in .env");
    process.exit(1);
  }

  // 1. Read Solidity source
  const solPath = resolve(import.meta.dirname, "../../contracts/WoGGuildVault.sol");
  const source = readFileSync(solPath, "utf-8");

  console.log("Compiling WoGGuildVault.sol...");

  // 2. Compile with solc
  const input = {
    language: "Solidity",
    sources: {
      "WoGGuildVault.sol": { content: source },
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

  const compiled = output.contracts["WoGGuildVault.sol"]["WoGGuildVault"];
  const abi = compiled.abi;
  const bytecode = "0x" + compiled.evm.bytecode.object;

  console.log(`Compiled successfully. Bytecode size: ${bytecode.length / 2} bytes`);
  console.log(`Deployer address: ${biteWallet.address}`);
  console.log(`Guild contract address: ${guildContractAddress}`);

  // 3. Deploy with guild contract address
  console.log("Deploying to BITE v2 Sandbox...");
  const factory = new ethers.ContractFactory(abi, bytecode, biteWallet);
  const contract = await factory.deploy(guildContractAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nWoGGuildVault deployed at: ${address}`);
  console.log(`\nAdd to your .env:`);
  console.log(`  GUILD_VAULT_CONTRACT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
