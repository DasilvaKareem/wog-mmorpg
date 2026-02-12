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
    console.log(`  Token ID: ${char.tokenId}`);
    console.log(`  Name: ${char.name}`);
    console.log(`  Race: ${char.raceId}`);
    console.log(`  Class: ${char.classId}`);
    console.log(`  Level: ${char.level}`);
    console.log();
  });
}

checkNFT();
