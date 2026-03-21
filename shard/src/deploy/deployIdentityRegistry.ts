/**
 * One-time deploy script for the WoGIdentityRegistry (ERC-8004) contract on SKALE Base.
 *
 * Usage:
 *   npx tsx shard/src/deploy/deployIdentityRegistry.ts
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

const deployWallet = process.env.SERVER_PRIVATE_KEY
  ? new ethers.Wallet(process.env.SERVER_PRIVATE_KEY, biteProvider)
  : null;

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
    "../../../contracts/WoGIdentityRegistry.sol"
  );
  const source = readFileSync(solPath, "utf-8");

  console.log("Compiling WoGIdentityRegistry.sol...");

  // 2. Compile with solc + OZ import resolver
  const input = {
    language: "Solidity",
    sources: {
      "WoGIdentityRegistry.sol": { content: source },
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
    output.contracts["WoGIdentityRegistry.sol"]["WoGIdentityRegistry"];
  const abi = compiled.abi;
  const bytecode = "0x" + compiled.evm.bytecode.object;

  console.log(
    `Compiled successfully. Bytecode size: ${bytecode.length / 2} bytes`
  );

  if (!deployWallet) {
    console.error("SERVER_PRIVATE_KEY not set — cannot deploy");
    process.exit(1);
  }

  const deployerAddress = await deployWallet.getAddress();
  console.log(`Deployer address: ${deployerAddress}`);

  // 3. Deploy — the production server is actively using this wallet, so we
  // retry with incrementing nonce until we find a free slot
  console.log("Deploying WoGIdentityRegistry to SKALE Base...");
  const factory = new ethers.ContractFactory(abi, bytecode, deployWallet);

  let contract: ethers.BaseContract | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const nonce = await biteProvider.getTransactionCount(deployerAddress, "pending");
    const tryNonce = nonce + attempt; // skip ahead if pending txs are blocking
    console.log(`Attempt ${attempt + 1}: nonce ${tryNonce}`);
    try {
      contract = await factory.deploy({ nonce: tryNonce, gasLimit: 3_000_000 });
      break;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("nonce") || msg.includes("Pending transaction")) {
        console.warn(`Nonce ${tryNonce} in use, retrying...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }

  if (!contract) throw new Error("Failed to deploy after 10 attempts — too many pending txs");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nWoGIdentityRegistry deployed at: ${address}`);
  console.log(`\nAdd to your .env:`);
  console.log(`  IDENTITY_REGISTRY_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
