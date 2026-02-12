#!/usr/bin/env tsx
/**
 * Setup Wallet - Mint starting gold for shopping
 */

import "dotenv/config";
import { mintGold } from "./blockchain.js";

const WALLET = "0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b";
const STARTING_GOLD = "10000"; // 10,000 gold to start

async function setupWallet() {
  console.log("💰 Setting up wallet with starting gold...\n");
  console.log(`Wallet: ${WALLET}`);
  console.log(`Amount: ${STARTING_GOLD} gold\n`);

  try {
    const txHash = await mintGold(WALLET, STARTING_GOLD);
    console.log(`✅ Gold minted successfully!`);
    console.log(`   Transaction: ${txHash}`);
    console.log(`\n🎮 Wallet is now ready for shopping!`);
  } catch (err: any) {
    console.error("❌ Failed to mint gold:", err.message);
    process.exit(1);
  }
}

setupWallet();
