import "dotenv/config";
import { ethers } from "ethers";
import { biteProvider } from "../src/blockchain/biteChain.js";
import { mintCharacterWithIdentity, registerIdentity } from "../src/blockchain/blockchain.js";
import { registerNameOnChain, reverseLookupOnChain } from "../src/blockchain/nameServiceChain.js";
import { saveCharacter } from "../src/character/characterStore.js";
import { computeStatsAtLevel } from "../src/character/leveling.js";
import { getClassById } from "../src/character/classes.js";
import { getRaceById } from "../src/character/races.js";

type Args = {
  walletAddress: string;
  name: string;
  raceId: string;
  classId: string;
  calling?: string;
  registerName: boolean;
};

type StepSummary = {
  name: string;
  durationMs: number;
  txHash?: string | null;
  gasUsed?: string | null;
  gasPriceWei?: string | null;
  feeWei?: string | null;
  feeEther?: string | null;
  status: "ok" | "skipped";
};

function usage(exitCode = 1): never {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx scripts/benchmarkCharacterBootstrap.ts [--wallet 0x...] [--name TestHero] [--race human] [--class warrior] [--calling adventurer] [--register-name]",
      "",
      "Notes:",
      "  - This sends real on-chain transactions using the current shard .env.",
      "  - Default wallet is a fresh random address.",
      "  - This benchmarks character bootstrap only, not wallet welcome-bonus registration.",
    ].join("\n")
  );
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Args {
  const result: Args = {
    walletAddress: ethers.Wallet.createRandom().address,
    name: `Bench${Math.random().toString(36).slice(2, 8)}`,
    raceId: "human",
    classId: "warrior",
    registerName: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--register-name") {
      result.registerName = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next) usage();
    if (arg === "--wallet") {
      result.walletAddress = next;
      i++;
      continue;
    }
    if (arg === "--name") {
      result.name = next;
      i++;
      continue;
    }
    if (arg === "--race") {
      result.raceId = next;
      i++;
      continue;
    }
    if (arg === "--class") {
      result.classId = next;
      i++;
      continue;
    }
    if (arg === "--calling") {
      result.calling = next;
      i++;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(result.walletAddress)) {
    throw new Error(`Invalid wallet address: ${result.walletAddress}`);
  }

  if (!getRaceById(result.raceId)) {
    throw new Error(`Unknown raceId: ${result.raceId}`);
  }

  if (!getClassById(result.classId)) {
    throw new Error(`Unknown classId: ${result.classId}`);
  }

  return result;
}

function nowMs(): number {
  return Date.now();
}

async function summarizeReceipt(txHash: string | null | undefined): Promise<Partial<StepSummary>> {
  if (!txHash) {
    return {
      txHash: txHash ?? null,
      gasUsed: null,
      gasPriceWei: null,
      feeWei: null,
      feeEther: null,
    };
  }

  const receipt = await biteProvider.getTransactionReceipt(txHash).catch(() => null);
  if (!receipt) {
    return {
      txHash,
      gasUsed: null,
      gasPriceWei: null,
      feeWei: null,
      feeEther: null,
    };
  }

  const gasUsed = receipt.gasUsed ?? null;
  const gasPrice = (receipt as any).effectiveGasPrice ?? (receipt as any).gasPrice ?? null;
  const feeWei = gasUsed != null && gasPrice != null ? gasUsed * gasPrice : null;

  return {
    txHash,
    gasUsed: gasUsed != null ? gasUsed.toString() : null,
    gasPriceWei: gasPrice != null ? gasPrice.toString() : null,
    feeWei: feeWei != null ? feeWei.toString() : null,
    feeEther: feeWei != null ? ethers.formatEther(feeWei) : null,
  };
}

function printStep(step: StepSummary): void {
  console.log(`\n${step.name}`);
  console.log(`  status: ${step.status}`);
  console.log(`  durationMs: ${step.durationMs}`);
  if (step.txHash !== undefined) console.log(`  txHash: ${step.txHash}`);
  if (step.gasUsed !== undefined) console.log(`  gasUsed: ${step.gasUsed}`);
  if (step.gasPriceWei !== undefined) console.log(`  gasPriceWei: ${step.gasPriceWei}`);
  if (step.feeWei !== undefined) console.log(`  feeWei: ${step.feeWei}`);
  if (step.feeEther !== undefined) console.log(`  feeEther: ${step.feeEther}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const classDef = getClassById(args.classId)!;
  const raceDef = getRaceById(args.raceId)!;
  const stats = computeStatsAtLevel(args.raceId, args.classId, 1);
  const fullName = `${args.name} the ${classDef.name}`;
  const description = `Level 1 ${raceDef.name} ${classDef.name}${args.calling ? ` (${args.calling[0]!.toUpperCase()}${args.calling.slice(1)})` : ""}`;

  console.log("Bootstrap benchmark config");
  console.log(`  walletAddress: ${args.walletAddress}`);
  console.log(`  characterName: ${args.name}`);
  console.log(`  fullName: ${fullName}`);
  console.log(`  raceId: ${args.raceId}`);
  console.log(`  classId: ${args.classId}`);
  console.log(`  registerName: ${args.registerName}`);
  console.log(`  rpc: ${process.env.SKALE_BASE_RPC_URL ?? "https://skale-base.skalenodes.com/v1/base"}`);
  console.log(`  characterContract: ${process.env.CHARACTER_CONTRACT_ADDRESS ?? ""}`);
  console.log(`  identityRegistry: ${process.env.IDENTITY_REGISTRY_ADDRESS ?? ""}`);

  const totalStartedAt = nowMs();

  const persistStartedAt = nowMs();
  await saveCharacter(args.walletAddress, args.name, {
    name: args.name,
    level: 1,
    xp: 0,
    chainRegistrationStatus: "unregistered",
    raceId: args.raceId,
    classId: args.classId,
    calling: args.calling as any,
    zone: "village-square",
    x: 0,
    y: 0,
    kills: 0,
    completedQuests: [],
    storyFlags: [],
    learnedTechniques: [],
    professions: [],
  });
  const persistStep: StepSummary = {
    name: "persistCharacterSeed",
    status: "ok",
    durationMs: nowMs() - persistStartedAt,
  };

  const mintStartedAt = nowMs();
  const mintResult = await mintCharacterWithIdentity(
    args.walletAddress,
    {
      name: fullName,
      description,
      properties: {
        race: args.raceId,
        class: args.classId,
        ...(args.calling ? { calling: args.calling } : {}),
        level: 1,
        xp: 0,
        stats,
      },
    },
    ["wog:a2a-enabled"],
    { skipIdentityRegistration: true }
  );
  if (mintResult.tokenId == null) {
    throw new Error("Mint completed without tokenId");
  }
  await saveCharacter(args.walletAddress, args.name, {
    characterTokenId: mintResult.tokenId.toString(),
    chainRegistrationStatus: "mint_confirmed",
    chainRegistrationLastError: "",
  });
  const mintStep: StepSummary = {
    name: "mintCharacter",
    status: "ok",
    durationMs: nowMs() - mintStartedAt,
    ...(await summarizeReceipt(mintResult.txHash)),
  };

  const identityStartedAt = nowMs();
  const identityResult = await registerIdentity(mintResult.tokenId, args.walletAddress, "", {
    validationTags: ["wog:a2a-enabled"],
  });
  if (identityResult.agentId == null) {
    throw new Error(`Identity registration did not return agentId for token ${mintResult.tokenId.toString()}`);
  }
  await saveCharacter(args.walletAddress, args.name, {
    agentId: identityResult.agentId.toString(),
    ...(identityResult.txHash ? { agentRegistrationTxHash: identityResult.txHash } : {}),
    chainRegistrationStatus: "registered",
    chainRegistrationLastError: "",
  });
  const identityStep: StepSummary = {
    name: "registerIdentity",
    status: "ok",
    durationMs: nowMs() - identityStartedAt,
    ...(await summarizeReceipt(identityResult.txHash)),
  };

  let nameStep: StepSummary = {
    name: "registerName",
    status: "skipped",
    durationMs: 0,
  };
  if (args.registerName) {
    if (!process.env.NAME_SERVICE_CONTRACT_ADDRESS) {
      throw new Error("NAME_SERVICE_CONTRACT_ADDRESS is not set; cannot benchmark name registration");
    }
    const nameStartedAt = nowMs();
    const existing = await reverseLookupOnChain(args.walletAddress).catch(() => null);
    const ok = existing ? true : await registerNameOnChain(args.walletAddress, args.name);
    if (!ok) {
      throw new Error("Name registration returned false");
    }
    nameStep = {
      name: "registerName",
      status: "ok",
      durationMs: nowMs() - nameStartedAt,
    };
  }

  const totalDurationMs = nowMs() - totalStartedAt;
  const totalFeeWei = [mintStep, identityStep]
    .map((step) => BigInt(step.feeWei ?? "0"))
    .reduce((sum, value) => sum + value, 0n);

  printStep(persistStep);
  printStep(mintStep);
  printStep(identityStep);
  printStep(nameStep);

  console.log("\nSummary");
  console.log(`  totalDurationMs: ${totalDurationMs}`);
  console.log(`  characterTokenId: ${mintResult.tokenId.toString()}`);
  console.log(`  agentId: ${identityResult.agentId.toString()}`);
  console.log(`  totalFeeWeiKnown: ${totalFeeWei.toString()}`);
  console.log(`  totalFeeEtherKnown: ${ethers.formatEther(totalFeeWei)}`);

  console.log("\nJSON");
  console.log(JSON.stringify({
    walletAddress: args.walletAddress,
    characterName: args.name,
    fullName,
    raceId: args.raceId,
    classId: args.classId,
    registerName: args.registerName,
    totalDurationMs,
    characterTokenId: mintResult.tokenId.toString(),
    agentId: identityResult.agentId.toString(),
    totalFeeWeiKnown: totalFeeWei.toString(),
    totalFeeEtherKnown: ethers.formatEther(totalFeeWei),
    steps: [persistStep, mintStep, identityStep, nameStep],
  }, null, 2));
}

main().catch((err) => {
  console.error("\nBenchmark failed");
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
