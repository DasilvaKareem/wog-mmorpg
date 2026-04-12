import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOfficialErc8004Addresses, SKALE_BASE_MAINNET_CHAIN_ID } from "../erc8004/official.js";

type DeploymentManifest = {
  chainId?: number;
  environment?: Record<string, string>;
  network?: string;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const DEV_ENABLED = TRUE_VALUES.has((process.env.DEV ?? "").trim().toLowerCase());
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SHARD_CHAIN_ENV = (process.env.SHARD_CHAIN_ENV ?? "").trim().toLowerCase();
const HARDHAT_ACCOUNT_0_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

type PresetEnvironment = Record<string, string>;
type ChainPreset = {
  chainId: string;
  rpcUrl: string;
  environment: PresetEnvironment;
};

const LOCAL_PRESET: ChainPreset = {
  chainId: "31337",
  rpcUrl: "http://127.0.0.1:8545",
  environment: {
    GOLD_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    ITEMS_CONTRACT_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    CHARACTER_CONTRACT_ADDRESS: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    IDENTITY_REGISTRY_ADDRESS: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    REPUTATION_REGISTRY_ADDRESS: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    VALIDATION_REGISTRY_ADDRESS: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    AUCTION_HOUSE_CONTRACT_ADDRESS: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    TRADE_CONTRACT_ADDRESS: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
    GUILD_CONTRACT_ADDRESS: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    GUILD_VAULT_CONTRACT_ADDRESS: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    LAND_REGISTRY_CONTRACT_ADDRESS: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
    NAME_SERVICE_CONTRACT_ADDRESS: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
    PREDICTION_CONTRACT_ADDRESS: "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0",
  },
};

const TESTNET_PRESET: ChainPreset = {
  chainId: "324705682",
  rpcUrl: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
  environment: {
    GOLD_CONTRACT_ADDRESS: "0x64DCbBa18873Cff6D82b01Be48C4A71530907599",
    ITEMS_CONTRACT_ADDRESS: "0x8310879324ab014d37Ff00e7cE4f9BA997Ac1a3b",
    CHARACTER_CONTRACT_ADDRESS: "0x84c8De907404a040696d84E2f446B8124B39A3B1",
    IDENTITY_REGISTRY_ADDRESS: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    REPUTATION_REGISTRY_ADDRESS: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    VALIDATION_REGISTRY_ADDRESS: "0x695606de050d828F650a2bDbbb480653900ee001",
    AUCTION_HOUSE_CONTRACT_ADDRESS: "0xd4BbB7af25D1E789e53118CFFF28BA7887D35733",
    TRADE_CONTRACT_ADDRESS: "0xBfC9d52DC609e3Ab97f5402FAae2818d5652F0aD",
    GUILD_CONTRACT_ADDRESS: "0xCDd016eb73C8Ea9463eA51F9e697731FE1fB90Dc",
    GUILD_VAULT_CONTRACT_ADDRESS: "0x918706F16C438383aee6e883302942ba779877B9",
    LAND_REGISTRY_CONTRACT_ADDRESS: "0x229a6672D42b52767327632240e6E674273e3097",
    NAME_SERVICE_CONTRACT_ADDRESS: "0x87b75cAa9B05b9BE941651Bb092c16272A563836",
    PREDICTION_CONTRACT_ADDRESS: "0x7F1Eed8d0FFDf225552c7Cb64C495A83AB839b2d",
  },
};

const MAINNET_PRESET: ChainPreset = {
  chainId: "1187947933",
  rpcUrl: "https://skale-base.skalenodes.com/v1/base",
  environment: {
    GOLD_CONTRACT_ADDRESS: "0x1b6825b0607237506d7401A382c0c9d8632c4969",
    ITEMS_CONTRACT_ADDRESS: "0x91EDD7aA82B303c183D7A74E333940725a70712e",
    CHARACTER_CONTRACT_ADDRESS: "0x1351566E5fdDE4252F3542822e171686c461dB52",
    IDENTITY_REGISTRY_ADDRESS: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    REPUTATION_REGISTRY_ADDRESS: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    AUCTION_HOUSE_CONTRACT_ADDRESS: "0x8FBcA728a8B904587CE6220dfA05F2c0DE3060B6",
    TRADE_CONTRACT_ADDRESS: "0x2c803D0583C6314d8937357B44b26E2513Bbb1d7",
    GUILD_CONTRACT_ADDRESS: "0x5e37f36D1B757CcE81dcCC93f240732D777CA375",
    GUILD_VAULT_CONTRACT_ADDRESS: "0xF902D5D039d85E5A57736a553C17DB90C211080e",
    LAND_REGISTRY_CONTRACT_ADDRESS: "0xf31A72d1A4Bab4559Db6BEf8a172c9344683873e",
    NAME_SERVICE_CONTRACT_ADDRESS: "0x1d582561C4295526f9DB6CB94748e3Bb324a9cEF",
    PREDICTION_CONTRACT_ADDRESS: "0xfDcD63CC9857fa6061Dc3e0d25836a251e4a45BE",
  },
};

const CHAIN_PRESETS: Record<string, ChainPreset> = {
  local: LOCAL_PRESET,
  testnet: TESTNET_PRESET,
  mainnet: MAINNET_PRESET,
};

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

function applyChainPreset(presetName: string): void {
  const preset = CHAIN_PRESETS[presetName];
  if (!preset) return;

  if (shouldOverrideWithManifest("SKALE_BASE_CHAIN_ID", process.env.SKALE_BASE_CHAIN_ID)) {
    process.env.SKALE_BASE_CHAIN_ID = preset.chainId;
  }
  if (shouldOverrideWithManifest("SKALE_BASE_RPC_URL", process.env.SKALE_BASE_RPC_URL)) {
    process.env.SKALE_BASE_RPC_URL = preset.rpcUrl;
  }

  for (const [key, value] of Object.entries(preset.environment)) {
    if (shouldOverrideWithManifest(key, process.env[key])) {
      process.env[key] = value;
    }
  }

  if (presetName === "local") {
    process.env.SERVER_PRIVATE_KEY =
      process.env.LOCAL_SERVER_PRIVATE_KEY ||
      process.env.HARDHAT_LOCAL_SERVER_PRIVATE_KEY ||
      HARDHAT_ACCOUNT_0_PRIVATE_KEY;
  }
}

if (SHARD_CHAIN_ENV && CHAIN_PRESETS[SHARD_CHAIN_ENV]) {
  applyChainPreset(SHARD_CHAIN_ENV);
}

if (DEV_ENABLED) {
  if (!SHARD_CHAIN_ENV || SHARD_CHAIN_ENV === "local") {
    process.env.SKALE_BASE_CHAIN_ID ??= "31337";
    process.env.SKALE_BASE_RPC_URL ??= process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";
  }

  const manifest = readLocalManifest();
  if (manifest?.environment && (!SHARD_CHAIN_ENV || SHARD_CHAIN_ENV === "local")) {
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
  } else if (!SHARD_CHAIN_ENV || SHARD_CHAIN_ENV === "local") {
    console.warn(
      "[dev] DEV=true but no Hardhat deployment manifest was found. Run the local Hardhat deploy before starting shard."
    );
  }
} else {
  applyOfficialRegistryFallback(process.env.SKALE_BASE_CHAIN_ID ?? String(SKALE_BASE_MAINNET_CHAIN_ID));
}
