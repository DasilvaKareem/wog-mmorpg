#!/usr/bin/env tsx
/**
 * Spawn Character from NFT
 * Loads character NFT data and spawns in game world
 */

const API = "http://localhost:3000";
const WALLET = "0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b";

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error: ${error}`);
  }
  return res.json();
}

async function spawnCharacterFromNFT() {
  console.log("📜 Loading character NFTs...\n");

  // Get character NFTs
  const data = await api("GET", `/character/${WALLET}`);

  if (!data.characters || data.characters.length === 0) {
    console.log("❌ No character NFTs found for this wallet");
    console.log("💡 Create one first: POST /character/create");
    return;
  }

  const character = data.characters[0];
  console.log(`✅ Found character NFT: ${character.name}`);
  console.log(`   Token ID: ${character.tokenId}`);
  console.log(`   Race: ${character.properties.race}`);
  console.log(`   Class: ${character.properties.class}`);
  console.log(`   Level: ${character.properties.level}`);
  console.log(`   XP: ${character.properties.xp}\n`);

  // Spawn in game world
  console.log("🎮 Spawning in game world...\n");

  const spawn = await api("POST", "/spawn", {
    zoneId: "village-square",
    type: "player",
    name: character.name,
    x: 150,
    y: 150,
    walletAddress: WALLET,
    level: character.properties.level,
    xp: character.properties.xp,
    characterTokenId: character.tokenId,
    raceId: character.properties.race,
    classId: character.properties.class,
  });

  console.log("✅ Character spawned in game!");
  console.log(`   Entity ID: ${spawn.spawned.id}`);
  console.log(`   Location: Human Meadow (150, 150)`);
  console.log(`   HP: ${spawn.spawned.hp}/${spawn.spawned.maxHp}`);
  console.log(`   Stats:`, spawn.spawned.stats);
  console.log("\n🎮 Your character is now in the game world!");
  console.log(`   Wallet: ${WALLET}`);
  console.log(`   Character NFT: Token #${character.tokenId}`);
}

spawnCharacterFromNFT().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
