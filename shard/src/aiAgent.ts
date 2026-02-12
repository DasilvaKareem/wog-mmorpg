#!/usr/bin/env tsx
/**
 * Autonomous AI Agent - Plays through the entire quest chain
 * Accepts quests, kills mobs, buys gear, progresses through zones
 */

const API_BASE = "http://localhost:3000";
const AGENT_WALLET = "0xAGENT1234567890abcdef1234567890abcdef12"; // Dummy wallet for agent

interface QuestObjective {
  type: string;
  targetMobType: string;
  targetMobName?: string;
  count: number;
}

interface Quest {
  id: string;
  title: string;
  description: string;
  objective: QuestObjective;
  rewards: { gold: number; xp: number };
  prerequisiteQuestId?: string;
}

interface ActiveQuest {
  questId: string;
  progress: number;
  required: number;
  complete: boolean;
  quest: Quest;
}

interface Entity {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level?: number;
  zoneId?: string;
}

const ZONES = ["human-meadow", "wild-meadow", "dark-forest"];
const ZONE_QUEST_GIVERS: Record<string, string> = {
  "human-meadow": "Guard Captain Marcus",
  "wild-meadow": "Ranger Thornwood",
  "dark-forest": "Priestess Selene",
};

let agentId: string | null = null;
let currentZone = "human-meadow";

async function apiCall(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }
  return response.json();
}

async function spawnAgent(): Promise<string> {
  console.log("🤖 Spawning AI Agent...");

  const data = await apiCall("POST", "/spawn", {
    zoneId: currentZone,
    type: "player",
    name: "AI Agent Alpha",
    x: 100,
    y: 100,
    walletAddress: AGENT_WALLET,
    level: 1,
    xp: 0,
    raceId: "human",
    classId: "warrior",
  });

  agentId = data.spawned.id;
  console.log(`✅ Agent spawned: ${agentId} at (100, 100) in ${currentZone}`);
  return agentId;
}

async function getZoneState(zoneId: string): Promise<any> {
  const state = await apiCall("GET", "/state", null);
  return state.zones[zoneId];
}

async function findNpcByName(zoneId: string, npcName: string): Promise<Entity | null> {
  const zone = await getZoneState(zoneId);
  const entities = Object.values(zone.entities) as Entity[];
  return entities.find((e: Entity) => e.name === npcName && e.type === "quest-giver") || null;
}

async function findMobsByName(zoneId: string, mobName: string): Promise<Entity[]> {
  const zone = await getZoneState(zoneId);
  const entities = Object.values(zone.entities) as Entity[];
  return entities.filter((e: Entity) => e.name === mobName && (e.type === "mob" || e.type === "boss"));
}

async function getAvailableQuests(zoneId: string): Promise<Quest[]> {
  const npcName = ZONE_QUEST_GIVERS[zoneId];
  const npc = await findNpcByName(zoneId, npcName);

  if (!npc) {
    console.log(`⚠️  Quest giver "${npcName}" not found in ${zoneId}`);
    return [];
  }

  const data = await apiCall("GET", `/quests/${zoneId}/${npc.id}?playerId=${agentId}`, null);
  return data.quests || [];
}

async function acceptQuest(zoneId: string, questId: string): Promise<boolean> {
  try {
    const result = await apiCall("POST", "/quests/accept", {
      zoneId,
      playerId: agentId,
      questId,
    });
    console.log(`📜 Accepted quest: ${result.quest.title}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to accept quest ${questId}:`, err);
    return false;
  }
}

async function getActiveQuests(): Promise<ActiveQuest[]> {
  try {
    const data = await apiCall("GET", `/quests/active/${currentZone}/${agentId}`, null);
    return data.activeQuests || [];
  } catch (err) {
    return [];
  }
}

async function attackMob(mobId: string): Promise<void> {
  await apiCall("POST", "/command", {
    zoneId: currentZone,
    entityId: agentId,
    action: "attack",
    targetId: mobId,
  });
}

async function moveToPosition(x: number, y: number): Promise<void> {
  await apiCall("POST", "/command", {
    zoneId: currentZone,
    entityId: agentId,
    action: "move",
    x: x,
    y: y,
  });
}

async function completeQuest(zoneId: string, questId: string): Promise<boolean> {
  const npcName = ZONE_QUEST_GIVERS[zoneId];
  const npc = await findNpcByName(zoneId, npcName);

  if (!npc) {
    console.log(`⚠️  Quest giver "${npcName}" not found`);
    return false;
  }

  try {
    const result = await apiCall("POST", "/quests/complete", {
      zoneId,
      playerId: agentId,
      questId,
      npcId: npc.id,
    });
    console.log(`✅ Completed quest! Rewards: ${result.rewards.gold}g, ${result.rewards.xp}xp`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to complete quest:`, err);
    return false;
  }
}

async function huntMobs(targetMobName: string, count: number): Promise<void> {
  console.log(`🎯 Hunting ${count}x ${targetMobName}...`);

  let killed = 0;
  while (killed < count) {
    const mobs = await findMobsByName(currentZone, targetMobName);

    if (mobs.length === 0) {
      console.log(`⏳ Waiting for ${targetMobName} to spawn...`);
      await sleep(5000); // Wait 5 seconds for respawn
      continue;
    }

    // Attack the first available mob
    const targetMob = mobs[0];
    console.log(`⚔️  Attacking ${targetMob.name} (${targetMob.id.slice(0, 8)}...)`);
    await attackMob(targetMob.id);

    // Wait for combat to resolve (check every second)
    let combatActive = true;
    while (combatActive) {
      await sleep(1000);

      // Check if mob still exists
      const currentMobs = await findMobsByName(currentZone, targetMobName);
      const stillExists = currentMobs.some(m => m.id === targetMob.id);

      if (!stillExists) {
        killed++;
        console.log(`💀 Killed ${targetMobName} (${killed}/${count})`);
        combatActive = false;
      }
    }

    // Wait for quest progress to update on server
    await sleep(1500);
  }

  // Extra wait to ensure all quest progress is synced
  console.log("⏳ Waiting for quest progress to sync...");
  await sleep(2000);
}

async function buyGearFromMerchant(zoneId: string): Promise<void> {
  console.log(`🛒 Looking for merchants in ${zoneId}...`);

  const zone = await getZoneState(zoneId);
  const entities = Object.values(zone.entities) as Entity[];
  const merchants = entities.filter((e: Entity) => e.type === "merchant");

  if (merchants.length === 0) {
    console.log(`⚠️  No merchants found in ${zoneId}`);
    return;
  }

  // Try to buy basic gear from first merchant
  const merchant = merchants[0];
  console.log(`💰 Found merchant: ${merchant.name}`);

  // Get shop inventory
  try {
    const shop = await apiCall("GET", `/shop/npc/${zoneId}/${merchant.id}`, null);
    console.log(`📦 Merchant has ${shop.items?.length || 0} items for sale`);

    // Buy first affordable weapon/armor (simplified - just try to buy first few items)
    if (shop.items && shop.items.length > 0) {
      for (let i = 0; i < Math.min(3, shop.items.length); i++) {
        const item = shop.items[i];
        try {
          await apiCall("POST", "/shop/buy", {
            buyerWallet: AGENT_WALLET,
            npcEntityId: merchant.id,
            zoneId,
            tokenId: item.tokenId,
            quantity: 1,
          });
          console.log(`✅ Purchased: ${item.name} for ${item.price}g`);
        } catch (err: any) {
          console.log(`⚠️  Couldn't buy ${item.name}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.log(`⚠️  Failed to access merchant shop:`, err);
  }
}

async function changeZone(newZone: string): Promise<void> {
  console.log(`🌍 Traveling to ${newZone}...`);

  // Spawn agent in new zone
  const data = await apiCall("POST", "/spawn", {
    zoneId: newZone,
    type: "player",
    name: "AI Agent Alpha",
    x: 100,
    y: 100,
    walletAddress: AGENT_WALLET,
    level: 10, // Higher level for new zones
    xp: 0,
    raceId: "human",
    classId: "warrior",
  });

  agentId = data.spawned.id;
  currentZone = newZone;
  console.log(`✅ Arrived in ${newZone} (${agentId})`);
}

async function playThroughZone(zoneId: string, maxQuests: number = 100): Promise<boolean> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🗺️  ENTERING ZONE: ${zoneId.toUpperCase()}`);
  console.log("=".repeat(60));

  // Buy gear first
  await buyGearFromMerchant(zoneId);

  let questsCompleted = 0;

  while (questsCompleted < maxQuests) {
    // Get available quests
    const availableQuests = await getAvailableQuests(zoneId);

    if (availableQuests.length === 0) {
      console.log(`\n✨ All quests completed in ${zoneId}!`);
      break;
    }

    // Accept first available quest
    const quest = availableQuests[0];
    console.log(`\n📋 Quest ${questsCompleted + 1}: ${quest.title}`);
    console.log(`   Objective: Kill ${quest.objective.count}x ${quest.objective.targetMobName}`);
    console.log(`   Rewards: ${quest.rewards.gold}g, ${quest.rewards.xp}xp`);

    const accepted = await acceptQuest(zoneId, quest.id);
    if (!accepted) {
      console.log(`❌ Failed to accept quest, stopping...`);
      break;
    }

    // Hunt the required mobs
    await huntMobs(quest.objective.targetMobName!, quest.objective.count);

    // Return to quest giver and complete
    const completed = await completeQuest(zoneId, quest.id);
    if (completed) {
      questsCompleted++;
      console.log(`\n🎉 Quest Chain Progress: ${questsCompleted} quests completed!`);
    } else {
      console.log(`❌ Failed to complete quest, stopping...`);
      break;
    }

    // Small delay between quests
    await sleep(1000);
  }

  console.log(`\n✅ Finished ${zoneId} - Completed ${questsCompleted} quests!`);
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              WOG MMORPG - AI AGENT ALPHA                  ║
║         Autonomous Quest Completion & Mob Slaying         ║
╚═══════════════════════════════════════════════════════════╝
  `);

  try {
    // Spawn the agent in starting zone
    await spawnAgent();
    await sleep(2000);

    // Complete all quests in Human Meadow (full quest chain)
    await playThroughZone("human-meadow", 7);

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    🏆 QUEST COMPLETE! 🏆                  ║
║     AI Agent Alpha has completed the quest chain!         ║
╚═══════════════════════════════════════════════════════════╝
    `);

  } catch (err) {
    console.error("❌ Agent encountered fatal error:", err);
    process.exit(1);
  }
}

// Run the agent
main();
