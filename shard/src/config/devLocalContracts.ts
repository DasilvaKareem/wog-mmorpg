import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOfficialErc8004Addresses } from "../erc8004/official.js";

type DeploymentManifest = {
  chainId?: number;
  environment?: Record<string, string>;
  network?: string;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const DEV_ENABLED = TRUE_VALUES.has((process.env.DEV ?? "").trim().toLowerCase());
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function shouldOverrideWithManifest(key: string, currentValue: string | undefined): boolean {
  if (!currentValue) return true;
  if (currentValue === ZERO_ADDRESS) return true;

  // In DEV mode, local chain addresses should come from the active Hardhat manifest
  // rather than any stale values persisted in shard/.env.
  if (
    key.endsWith("_CONTRACT_ADDRESS") ||
    key.endsWith("_REGISTRY_ADDRESS") ||
    key === "SKALE_BASE_RPC_URL" ||
    key === "SKALE_BASE_CHAIN_ID"
  ) {
    return true;
  }

  return false;
}

function readLocalManifest(): DeploymentManifest | null {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const deploymentsDir = path.resolve(thisDir, "../../../hardhat/deployments");
  const candidates = ["localhost.json", "hardhat.json"];

  for (const fileName of candidates) {
    const filePath = path.join(deploymentsDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as DeploymentManifest;
    } catch (error: any) {
      console.warn(`[dev] Failed to parse ${filePath}: ${error.message}`);
    }
  }

  return null;
}

function applyOfficialRegistryFallback(chainIdRaw: string | undefined): void {
  const chainId = Number(chainIdRaw);
  const official = getOfficialErc8004Addresses(chainId);
  if (!official) return;

  if (shouldOverrideWithManifest("IDENTITY_REGISTRY_ADDRESS", process.env.IDENTITY_REGISTRY_ADDRESS)) {
    process.env.IDENTITY_REGISTRY_ADDRESS = official.identity;
  }
  if (official.reputation && shouldOverrideWithManifest("REPUTATION_REGISTRY_ADDRESS", process.env.REPUTATION_REGISTRY_ADDRESS)) {
    process.env.REPUTATION_REGISTRY_ADDRESS = official.reputation;
  }
  if (shouldOverrideWithManifest("VALIDATION_REGISTRY_ADDRESS", process.env.VALIDATION_REGISTRY_ADDRESS)) {
    if (official.validation) {
      process.env.VALIDATION_REGISTRY_ADDRESS = official.validation;
    } else {
      delete process.env.VALIDATION_REGISTRY_ADDRESS;
    }
  }
  if (!official.reputation && shouldOverrideWithManifest("REPUTATION_REGISTRY_ADDRESS", process.env.REPUTATION_REGISTRY_ADDRESS)) {
    delete process.env.REPUTATION_REGISTRY_ADDRESS;
  }
}

if (DEV_ENABLED) {
  process.env.SKALE_BASE_CHAIN_ID ??= "31337";
  process.env.SKALE_BASE_RPC_URL ??= process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";

  const manifest = readLocalManifest();
  if (manifest?.environment) {
    for (const [key, value] of Object.entries(manifest.environment)) {
      if (value && shouldOverrideWithManifest(key, process.env[key])) {
        process.env[key] = value;
      }
    }
    if (manifest.chainId) {
      process.env.SKALE_BASE_CHAIN_ID = String(manifest.chainId);
    }
    console.log(
      `[dev] Loaded local contract addresses from Hardhat ${manifest.network ?? "deployment"} manifest`
    );
  } else {
    console.warn(
      "[dev] DEV=true but no Hardhat deployment manifest was found. Run the local Hardhat deploy before starting shard."
    );
  }
} else {
  applyOfficialRegistryFallback(process.env.SKALE_BASE_CHAIN_ID);
}
