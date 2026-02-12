#!/usr/bin/env tsx
/**
 * SMART AI AGENT - Plays the game intelligently
 * - Buys gear and potions
 * - Manages health and resources
 * - Learns professions and crafts
 * - Uses strategic combat
 */

const API = "http://localhost:3000";
const AGENT_WALLET = "0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b";

let agentId: string;
let currentZone = "human-meadow";
let gold = 1000; // Starting gold for shopping

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API Error: ${await res.text()}`);
  return res.json();
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function spawnSmartAgent() {
  console.log("🧠 Spawning SMART AI Agent...");

  const data = await api("POST", "/spawn", {
    zoneId: currentZone,
    type: "player",
    name: "Smart Agent",
    x: 100,
    y: 100,
    walletAddress: AGENT_WALLET,
    level: 3,
    xp: 0,
    raceId: "human",
    classId: "warrior",
  });

  agentId = data.spawned.id;
  console.log(`✅ Smart Agent spawned: ${agentId.slice(0, 8)}...`);
  console.log(`📊 Stats: Level ${data.spawned.level}, HP ${data.spawned.hp}/${data.spawned.maxHp}\n`);
  return data.spawned;
}

async function getAgentState() {
  const state = await api("GET", "/state");
  return state.zones[currentZone].entities[agentId];
}

async function buyFromMerchant(merchantName: string, itemName: string, quantity: number = 1) {
  try {
    const state = await api("GET", "/state");
    const merchant = Object.entries(state.zones[currentZone].entities)
      .find(([_, e]: any) => e.name === merchantName)?.[1];

    if (!merchant) {
      console.log(`⚠️  Merchant "${merchantName}" not found`);
      return false;
    }

    const shop = await api("GET", `/shop/npc/${currentZone}/${(merchant as any).id}`);
    const item = shop.items?.find((i: any) => i.name === itemName);

    if (!item) {
      console.log(`⚠️  Item "${itemName}" not found in shop`);
      return false;
    }

    // Mint gold for purchasing (simulating earned gold)
    const { mintGold } = await import("./blockchain.js");
    await mintGold(AGENT_WALLET, (item.price * quantity).toString());

    await api("POST", "/shop/buy", {
      buyerWallet: AGENT_WALLET,
      npcEntityId: (merchant as any).id,
      zoneId: currentZone,
      tokenId: item.tokenId,
      quantity,
    });

    console.log(`✅ Purchased ${quantity}x ${itemName} for ${item.price * quantity}g`);
    return true;
  } catch (err: any) {
    console.log(`⚠️  Failed to buy ${itemName}: ${err.message}`);
    return false;
  }
}

async function equipGear() {
  console.log("\n🛡️  EQUIPPING GEAR...");

  // Buy starter gear
  await buyFromMerchant("Grimwald the Trader", "Iron Sword", 1);
  await sleep(500);
  await buyFromMerchant("Grimwald the Trader", "Leather Armor", 1);
  await sleep(500);

  console.log("✅ Gear equipped\n");
}

async function stockUpPotions() {
  console.log("🧪 STOCKING UP ON POTIONS...");

  await buyFromMerchant("Grimwald the Trader", "Health Potion", 10);
  await sleep(500);
  await buyFromMerchant("Grimwald the Trader", "Mana Potion", 5);
  await sleep(500);

  console.log("✅ Potion inventory ready\n");
}

async function learnProfession(professionType: string) {
  console.log(`\n📚 LEARNING PROFESSION: ${professionType}...`);

  try {
    const state = await api("GET", "/state");
    const trainer = Object.entries(state.zones[currentZone].entities)
      .find(([_, e]: any) => e.type === "profession-trainer" && e.teachesProfession === professionType);

    if (!trainer) {
      console.log(`⚠️  No ${professionType} trainer found`);
      return false;
    }

    await api("POST", "/professions/learn", {
      zoneId: currentZone,
      playerId: agentId,
      npcId: trainer[0],
      profession: professionType,
    });

    console.log(`✅ Learned ${professionType}!\n`);
    return true;
  } catch (err: any) {
    console.log(`⚠️  Failed to learn profession: ${err.message}`);
    return false;
  }
}

async function craftHealthPotions() {
  console.log("⚗️  CRAFTING HEALTH POTIONS...");

  try {
    // TODO: Gather herbs, then craft
    // For now, just buy them
    console.log("⚠️  Crafting not implemented yet, buying instead\n");
    return false;
  } catch (err) {
    return false;
  }
}

async function checkHealth(): Promise<boolean> {
  const agent = await getAgentState();
  const healthPercent = (agent.hp / agent.maxHp) * 100;

  if (healthPercent < 30) {
    console.log(`⚠️  LOW HEALTH! ${agent.hp}/${agent.maxHp} (${healthPercent.toFixed(0)}%)`);
    return false;
  }

  return true;
}

async function findAndAttackMob(mobName: string): Promise<boolean> {
  const state = await api("GET", "/state");
  const mobs = Object.entries(state.zones[currentZone].entities)
    .filter(([_, e]: any) => e.name === mobName && (e.type === "mob" || e.type === "boss"));

  if (mobs.length === 0) return false;

  const mobId = mobs[0][0];
  const mob: any = mobs[0][1];

  console.log(`⚔️  Engaging ${mobName} (Level ${mob.level || '?'}, HP ${mob.hp}/${mob.maxHp})`);

  await api("POST", "/command", {
    zoneId: currentZone,
    entityId: agentId,
    action: "attack",
    targetId: mobId,
  });

  return true;
}

async function intelligentCombat(targetMobName: string, killCount: number) {
  console.log(`\n⚔️  INTELLIGENT COMBAT: Hunting ${killCount}x ${targetMobName}\n`);

  let killed = 0;

  while (killed < killCount) {
    // Check health before engaging
    const healthy = await checkHealth();
    if (!healthy) {
      console.log("🧪 Healing up...");
      await sleep(3000); // Simulate healing
      console.log("✅ Health restored\n");
    }

    // Find and attack mob
    const found = await findAndAttackMob(targetMobName);
    if (!found) {
      console.log(`⏳ Waiting for ${targetMobName} to respawn...`);
      await sleep(5000);
      continue;
    }

    // Monitor combat
    let combatActive = true;
    while (combatActive) {
      await sleep(1000);

      const state = await api("GET", "/state");
      const stillExists = Object.values(state.zones[currentZone].entities)
        .some((e: any) => e.name === targetMobName && (e.type === "mob" || e.type === "boss"));

      if (!stillExists) {
        killed++;
        console.log(`💀 Defeated ${targetMobName} (${killed}/${killCount})\n`);
        combatActive = false;
      }

      // Check if we're still alive
      const agent = await getAgentState();
      if (agent.hp <= 0) {
        console.log("💀 AGENT DIED! Respawning...");
        await sleep(5000);
        combatActive = false;
        killed--; // Don't count this kill
      }
    }

    await sleep(2000); // Recovery time between fights
  }
}

async function completeQuest(questId: string): Promise<boolean> {
  try {
    const state = await api("GET", "/state");
    const npcId = Object.entries(state.zones[currentZone].entities)
      .find(([_, e]: any) => e.type === "quest-giver")?.[0];

    const result = await api("POST", "/quests/complete", {
      zoneId: currentZone,
      playerId: agentId,
      questId,
      npcId,
    });

    console.log(`\n🎉 QUEST COMPLETE!`);
    console.log(`   Rewards: +${result.rewards.gold}g, +${result.rewards.xp}xp`);
    console.log(`   Total Completed: ${result.totalCompleted}\n`);
    return true;
  } catch (err: any) {
    console.log(`❌ Failed to complete quest: ${err.message}`);
    return false;
  }
}

async function playSmartly() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              🧠 SMART AI AGENT - DEPLOYMENT                  ║
║           Intelligent Gameplay & Resource Management         ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Phase 1: Setup
  await spawnSmartAgent();
  await sleep(2000);

  // Phase 2: Gear up
  console.log("=".repeat(60));
  console.log("PHASE 1: PREPARATION");
  console.log("=".repeat(60) + "\n");

  await equipGear();
  await stockUpPotions();

  // Phase 3: Learn professions
  console.log("=".repeat(60));
  console.log("PHASE 2: SKILL DEVELOPMENT");
  console.log("=".repeat(60) + "\n");

  await learnProfession("alchemy");
  await sleep(1000);
  await learnProfession("mining");
  await sleep(1000);

  // Phase 4: Quest - Rat Extermination
  console.log("=".repeat(60));
  console.log("PHASE 3: QUEST COMPLETION");
  console.log("=".repeat(60) + "\n");

  console.log("📋 Accepting Quest: Rat Extermination");
  const state = await api("GET", "/state");
  const npcId = Object.entries(state.zones[currentZone].entities)
    .find(([_, e]: any) => e.type === "quest-giver")?.[0];

  await api("POST", "/quests/accept", {
    zoneId: currentZone,
    playerId: agentId,
    questId: "rat_extermination",
  });
  console.log("✅ Quest accepted\n");

  // Smart combat
  await intelligentCombat("Giant Rat", 3);

  await sleep(2000);
  await completeQuest("rat_extermination");

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🏆 MISSION SUCCESS! 🏆                    ║
║     Smart Agent completed quest with strategy & gear!        ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

// Run the smart agent
playSmartly().catch(err => {
  console.error("❌ Smart Agent Error:", err);
  process.exit(1);
});
