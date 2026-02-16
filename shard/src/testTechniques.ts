#!/usr/bin/env tsx
import "dotenv/config";

const API = "http://localhost:3000";
const WALLET = "0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b";

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API Error: ${await res.text()}`);
  return res.json();
}

async function testTechniques() {
  console.log("🧪 Testing Technique System\n");

  // 1. Spawn a warrior
  console.log("1️⃣  Spawning Level 5 Warrior...");
  const spawn = await api("POST", "/spawn", {
    zoneId: "village-square",
    type: "player",
    name: "Technique Tester",
    x: 100,
    y: 200, // Spawn at trainer location
    walletAddress: WALLET,
    level: 5,
    raceId: "human",
    classId: "warrior",
  });
  const playerId = spawn.spawned.id;
  console.log(`✅ Spawned at (${spawn.spawned.x}, ${spawn.spawned.y})`);
  console.log(`   Essence: ${spawn.spawned.essence}/${spawn.spawned.maxEssence}\n`);

  // 2. Find trainer
  console.log("2️⃣  Finding class trainer...");
  const state = await api("GET", "/state");
  const trainer = Object.entries(state.zones["village-square"].entities)
    .find(([_, e]: any) => e.type === "trainer");
  if (!trainer) throw new Error("No trainer found");
  const trainerId = trainer[0];
  console.log(`✅ Found trainer: ${(trainer[1] as any).name}\n`);

  // 3. Get available techniques
  console.log("3️⃣  Getting available techniques...");
  const available = await api("GET", `/techniques/available/village-square/${playerId}`);
  console.log(`✅ Available techniques: ${available.techniques.length}`);
  available.techniques.forEach((t: any) => {
    console.log(`   - ${t.name} (Level ${t.levelRequired}, ${t.goldCost}g, ${t.essenceCost} essence)`);
  });
  console.log();

  // 4. Learn a technique
  console.log("4️⃣  Learning Heroic Strike...");
  const { mintGold } = await import("./blockchain.js");
  await mintGold(WALLET, "50");

  const learn = await api("POST", "/techniques/learn", {
    zoneId: "village-square",
    playerEntityId: playerId,
    techniqueId: "warrior_heroic_strike",
    trainerEntityId: trainerId,
  });
  console.log(`✅ Learned ${learn.technique}!`);
  console.log(`   Gold spent: ${learn.goldSpent}`);
  console.log(`   Remaining gold: ${learn.remainingGold}\n`);

  // 5. Spawn a test mob
  console.log("5️⃣  Spawning test mob...");
  const mob = await api("POST", "/spawn", {
    zoneId: "village-square",
    type: "mob",
    name: "Training Dummy",
    x: 100,
    y: 200,
    hp: 100,
    level: 1,
  });
  const mobId = mob.spawned.id;
  console.log(`✅ Spawned ${mob.spawned.name}\n`);

  // 6. Use technique on mob
  console.log("6️⃣  Using Heroic Strike on mob...");
  const use = await api("POST", "/techniques/use", {
    zoneId: "village-square",
    casterEntityId: playerId,
    techniqueId: "warrior_heroic_strike",
    targetEntityId: mobId,
  });
  console.log(`✅ Used ${use.technique}!`);
  console.log(`   Damage dealt: ${use.result.damage}`);
  console.log(`   Target HP: ${use.result.targetHp}`);
  console.log(`   Caster essence: ${use.casterEssence}\n`);

  console.log("🎉 Technique system working perfectly!\n");
}

testTechniques().catch(err => {
  console.error("❌ Test failed:", err.message);
  process.exit(1);
});
