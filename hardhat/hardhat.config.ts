import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const LOCAL_RPC_URL = process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";
const DEPLOYER_ACCOUNTS = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];
const LOCALHOST_ACCOUNTS = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : undefined;
const SKALE_BASE_MAINNET_RPC_URL =
  process.env.SKALE_BASE_MAINNET_RPC_URL || "https://skale-base.skalenodes.com/v1/base";
const SKALE_BASE_SEPOLIA_RPC_URL =
  process.env.SKALE_BASE_SEPOLIA_RPC_URL ||
  "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.24",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {},
    localhost: {
      url: LOCAL_RPC_URL,
      accounts: LOCALHOST_ACCOUNTS,
    },
    skale: {
      url: SKALE_BASE_MAINNET_RPC_URL,
      chainId: 1187947933,
      accounts: DEPLOYER_ACCOUNTS,
    },
    skaleSepolia: {
      url: SKALE_BASE_SEPOLIA_RPC_URL,
      chainId: 324705682,
      accounts: DEPLOYER_ACCOUNTS,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;
