#!/usr/bin/env tsx
import "dotenv/config";
import { getOwnedCharacters } from "./blockchain.js";

const wallet = "0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b";

async function checkNFT() {
  console.log(`📋 Checking NFTs for wallet: ${wallet}\n`);

  const characters = await getOwnedCharacters(wallet);

  if (characters.length === 0) {
    console.log("❌ No character NFTs found");
    return;
  }

  console.log(`✅ Found ${characters.length} character(s):\n`);
  characters.forEach((char, i) => {
    console.log(`Character #${i + 1}:`);
    console.log(`  Token ID: ${char.id.toString()}`);
    console.log(`  Name: ${char.metadata.name}`);
    console.log(`  Race: ${(char.metadata as any).properties?.race ?? "unknown"}`);
    console.log(`  Class: ${(char.metadata as any).properties?.class ?? "unknown"}`);
    console.log(`  Level: ${(char.metadata as any).properties?.level ?? "unknown"}`);
    console.log();
  });
}

checkNFT();
