/**
 * Deploy the full WoG ERC-8004 registry set:
 * - WoGIdentityRegistry
 * - WoGReputationRegistry
 * - WoGValidationRegistry
 *
 * Usage:
 *   npx tsx shard/src/deploy/deployERC8004Registries.ts
 *
 * Requires env vars:
 *   SERVER_PRIVATE_KEY
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import type { InterfaceAbi } from "ethers";
import solc from "solc";
import { biteWallet } from "../blockchain/biteChain.js";

type CompiledContract = {
  abi: InterfaceAbi;
  bytecode: string;
};

const CONTRACT_FILES = [
  "WoGIdentityRegistry.sol",
  "WoGReputationRegistry.sol",
  "WoGValidationRegistry.sol",
] as const;

function findImports(importPath: string) {
  const base = resolve(import.meta.dirname, "../../node_modules");
  try {
    const content = readFileSync(resolve(base, importPath), "utf-8");
    return { contents: content };
  } catch {
    return { error: "File not found: " + importPath };
  }
}

function compileContracts(): Record<string, CompiledContract> {
  const sources = Object.fromEntries(
    CONTRACT_FILES.map((fileName) => [
      fileName,
      {
        content: readFileSync(resolve(import.meta.dirname, `../../../contracts/${fileName}`), "utf-8"),
      },
    ])
  );

  const input = {
    language: "Solidity",
    sources,
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
      optimizer: { enabled: true, runs: 200 },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  if (output.errors) {
    const errors = output.errors.filter((e: { severity: string }) => e.severity === "error");
    if (errors.length > 0) {
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

  return {
    identity: {
      abi: output.contracts["WoGIdentityRegistry.sol"]["WoGIdentityRegistry"].abi,
      bytecode: "0x" + output.contracts["WoGIdentityRegistry.sol"]["WoGIdentityRegistry"].evm.bytecode.object,
    },
    reputation: {
      abi: output.contracts["WoGReputationRegistry.sol"]["WoGReputationRegistry"].abi,
      bytecode: "0x" + output.contracts["WoGReputationRegistry.sol"]["WoGReputationRegistry"].evm.bytecode.object,
    },
    validation: {
      abi: output.contracts["WoGValidationRegistry.sol"]["WoGValidationRegistry"].abi,
      bytecode: "0x" + output.contracts["WoGValidationRegistry.sol"]["WoGValidationRegistry"].evm.bytecode.object,
    },
  };
}

async function deployContract(name: string, compiled: CompiledContract): Promise<string> {
  if (!biteWallet) {
    console.error("SERVER_PRIVATE_KEY not set — cannot deploy");
    process.exit(1);
  }

  console.log(`Deploying ${name}...`);
  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, biteWallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ${name}: ${address}`);
  return address;
}

async function main() {
  if (!biteWallet) {
    console.error("SERVER_PRIVATE_KEY not set — cannot deploy");
    process.exit(1);
  }

  const deployerAddress = await biteWallet.getAddress();
  console.log(`Deployer: ${deployerAddress}`);
  console.log("Compiling ERC-8004 registries...");
  const compiled = compileContracts();

  const identityAddress = await deployContract("WoGIdentityRegistry", compiled.identity);
  const reputationAddress = await deployContract("WoGReputationRegistry", compiled.reputation);
  const validationAddress = await deployContract("WoGValidationRegistry", compiled.validation);

  console.log("\nAdd these to your .env:");
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityAddress}`);
  console.log(`REPUTATION_REGISTRY_ADDRESS=${reputationAddress}`);
  console.log(`VALIDATION_REGISTRY_ADDRESS=${validationAddress}`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
