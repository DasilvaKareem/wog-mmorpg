#!/usr/bin/env tsx
/**
 * KAREEM AUTONOMOUS AGENT - Party-enabled AI
 * - Loads Kareem character NFT
 * - Seeks nearby players to party with
 * - Uses advanced techniques in combat
 * - Coordinates with party members
 * - Completes quests autonomously
 */

import "dotenv/config";

const API = "http://localhost:3000";
const WALLET = "0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b";

let agentId: string;
let currentZone = "human-meadow";
let partyId: string | null = null;

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

async function loadCharacterNFT() {
  console.log("📜 Loading Kareem character NFT...\n");

  const data = await api("GET", `/character/${WALLET}`);

  if (!data.characters || data.characters.length === 0) {
    throw new Error("No character NFTs found. Create one first!");
  }

  const character = data.characters[0];
  console.log(`✅ Found: ${character.name}`);
  console.log(`   Token ID: ${character.tokenId}`);
  console.log(`   ${character.properties.race} ${character.properties.class} - Level ${character.properties.level}`);
  console.log(`   XP: ${character.properties.xp}\n`);

  return character;
}

async function spawnKareemAgent(character: any) {
  console.log("🎮 Spawning Kareem in the world...\n");

  const spawn = await api("POST", "/spawn", {
    zoneId: currentZone,
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

  agentId = spawn.spawned.id;
  console.log(`✅ Spawned at (${spawn.spawned.x}, ${spawn.spawned.y})`);
  console.log(`   HP: ${spawn.spawned.hp}/${spawn.spawned.maxHp}`);
  console.log(`   Essence: ${spawn.spawned.essence}/${spawn.spawned.maxEssence}\n`);

  return spawn.spawned;
}

async function seekPartyMembers() {
  console.log("👥 Seeking party members...\n");

  // Check if already in a party
  const partyInfo = await api("GET", `/party/player/${agentId}`);
  if (partyInfo.inParty) {
    partyId = partyInfo.party.id;
    console.log(`✅ Already in party with ${partyInfo.party.memberIds.length} member(s)\n`);
    return true;
  }

  // Find nearby players
  const nearby = await api("GET", `/party/nearby/${currentZone}/${agentId}`);

  if (nearby.count === 0) {
    console.log("📍 No nearby players found to party with");
    console.log("   Creating solo party for now...\n");

    // Create own party
    const party = await api("POST", "/party/create", {
      zoneId: currentZone,
      leaderId: agentId,
    });

    partyId = party.party.id;
    console.log(`✅ Created party: ${partyId}\n`);
    return false;
  }

  console.log(`✅ Found ${nearby.count} nearby player(s):`);
  nearby.nearbyPlayers.forEach((p: any) => {
    console.log(`   - ${p.name} (${p.classId}, Level ${p.level}) - ${p.distance}m away`);
  });
  console.log();

  // Create party and invite the first nearby player
  const party = await api("POST", "/party/create", {
    zoneId: currentZone,
    leaderId: agentId,
  });

  partyId = party.party.id;
  console.log(`✅ Created party: ${partyId}`);

  // Invite nearby players
  for (const player of nearby.nearbyPlayers.slice(0, 3)) {
    try {
      const invite = await api("POST", "/party/invite", {
        partyId,
        invitedPlayerId: player.id,
      });
      console.log(`✅ Invited ${player.name} to party!`);
      await sleep(500);
    } catch (err) {
      console.log(`⚠️  Failed to invite ${player.name}`);
    }
  }

  console.log();
  return true;
}

async function learnTechniques() {
  console.log("⚔️  Learning combat techniques...\n");

  try {
    const state = await api("GET", "/state");
    const trainer = Object.entries(state.zones[currentZone].entities)
      .find(([_, e]: any) => e.type === "trainer");

    if (!trainer) {
      console.log("⚠️  No trainer found\n");
      return false;
    }

    const trainerId = trainer[0];
    const trainerEntity: any = trainer[1];

    // Move to trainer
    await api("POST", "/command", {
      zoneId: currentZone,
      entityId: agentId,
      action: "move",
      x: trainerEntity.x,
      y: trainerEntity.y,
    });
    await sleep(1000);

    // Get available techniques
    const available = await api("GET", `/techniques/available/${currentZone}/${agentId}`);
    const toLearn = available.techniques.filter((t: any) => !t.isLearned);

    if (toLearn.length === 0) {
      console.log("✅ All techniques already learned\n");
      return true;
    }

    // Prioritize attack techniques first!
    const sortedTechniques = toLearn.sort((a: any, b: any) => {
      if (a.type === "attack" && b.type !== "attack") return -1;
      if (a.type !== "attack" && b.type === "attack") return 1;
      return a.levelRequired - b.levelRequired;
    });

    // Learn all affordable techniques
    let learned = 0;
    for (const tech of sortedTechniques) {
      try {
        const { mintGold } = await import("./blockchain.js");
        await mintGold(WALLET, tech.goldCost.toString());

        await api("POST", "/techniques/learn", {
          zoneId: currentZone,
          playerEntityId: agentId,
          techniqueId: tech.id,
          trainerEntityId: trainerId,
        });

        console.log(`✅ Learned ${tech.name} (${tech.essenceCost} essence, ${tech.cooldown}s CD)`);
        learned++;
        await sleep(500);
      } catch (err) {
        // Skip if can't learn
      }
    }

    console.log(`\n🎓 Learned ${learned} technique(s)!\n`);
    return true;
  } catch (err: any) {
    console.log(`⚠️  Technique learning failed: ${err.message}\n`);
    return false;
  }
}

async function useBestTechnique(targetId: string): Promise<boolean> {
  try {
    const agent = await getAgentState();
    const essence = agent.essence ?? 0;
    const maxEssence = agent.maxEssence ?? 100;
    const essencePercent = (essence / maxEssence) * 100;

    const learnedData = await api("GET", `/techniques/learned/${currentZone}/${agentId}`);
    const techniques = learnedData.techniques;

    if (techniques.length === 0) return false;

    // Use high-damage technique if we have good essence
    const attackTechniques = techniques
      .filter((t: any) => t.type === "attack" && t.essenceCost <= essence)
      .sort((a: any, b: any) => (b.effects.damageMultiplier || 0) - (a.effects.damageMultiplier || 0));

    if (essencePercent > 40 && attackTechniques.length > 0) {
      const technique = attackTechniques[0];

      await api("POST", "/techniques/use", {
        zoneId: currentZone,
        casterEntityId: agentId,
        techniqueId: technique.id,
        targetEntityId: targetId,
      });

      console.log(`   🔥 ${technique.name}! (${technique.essenceCost} essence)`);
      return true;
    }

    // Conserve essence when low
    if (essencePercent > 20 && attackTechniques.length > 0) {
      const cheapTechnique = techniques
        .filter((t: any) => t.type === "attack" && t.essenceCost <= essence)
        .sort((a: any, b: any) => a.essenceCost - b.essenceCost)[0];

      if (cheapTechnique) {
        await api("POST", "/techniques/use", {
          zoneId: currentZone,
          casterEntityId: agentId,
          techniqueId: cheapTechnique.id,
          targetEntityId: targetId,
        });

        console.log(`   ⚡ ${cheapTechnique.name} (${cheapTechnique.essenceCost} essence)`);
        return true;
      }
    }

    return false;
  } catch (err) {
    return false;
  }
}

async function getAgentState() {
  const state = await api("GET", "/state");
  return state.zones[currentZone].entities[agentId];
}

async function attackMob(mobId: string, mobName: string): Promise<boolean> {
  // Try technique first
  const usedTechnique = await useBestTechnique(mobId);

  if (!usedTechnique) {
    // Fall back to basic attack command
    await api("POST", "/command", {
      zoneId: currentZone,
      entityId: agentId,
      action: "attack",
      targetId: mobId,
    });
    console.log(`   🗡️  Basic attack`);
  }

  // Wait for attack to process
  await sleep(600);
  return true;
}

async function findAndAttackMob(mobName: string): Promise<string | null> {
  const state = await api("GET", "/state");
  const mobs = Object.entries(state.zones[currentZone].entities)
    .filter(([_, e]: any) => e.name === mobName && e.type === "mob");

  if (mobs.length === 0) return null;

  const mobId = mobs[0][0];
  const mob: any = mobs[0][1];

  console.log(`⚔️  Engaging ${mobName} (Lvl ${mob.level}, HP ${mob.hp}/${mob.maxHp})`);

  return mobId;
}

async function partyCoordinatedHunt(targetMobName: string, killCount: number) {
  console.log(`⚔️  PARTY HUNT: ${killCount}x ${targetMobName}\n`);

  let killed = 0;

  while (killed < killCount) {
    const agent = await getAgentState();
    const essence = agent.essence ?? 0;
    const maxEssence = agent.maxEssence ?? 100;
    console.log(`   💧 Essence: ${essence}/${maxEssence} (${((essence/maxEssence)*100).toFixed(0)}%)`);

    // Show party status
    if (partyId) {
      const partyInfo = await api("GET", `/party/${partyId}/members/${currentZone}`);
      console.log(`   👥 Party: ${partyInfo.members.length} member(s) online`);
    }

    const mobId = await findAndAttackMob(targetMobName);
    if (!mobId) {
      console.log(`⏳ Waiting for ${targetMobName} to respawn...`);
      await sleep(5000);
      continue;
    }

    // Combat loop - keep attacking until mob dies
    let combatActive = true;
    let attackCount = 0;

    while (combatActive && attackCount < 20) {
      // Check if mob still exists
      const state = await api("GET", "/state");
      const mob = state.zones[currentZone].entities[mobId];

      if (!mob) {
        killed++;
        console.log(`💀 Defeated ${targetMobName} (${killed}/${killCount})\n`);
        combatActive = false;
        break;
      }

      // Keep attacking
      await attackMob(mobId, targetMobName);
      attackCount++;

      // Check if we're still alive
      const currentAgent = await getAgentState();
      if (currentAgent.hp <= 0) {
        console.log("💀 AGENT DIED! Respawning...");
        await sleep(5000);
        combatActive = false;
        killed--;
        break;
      }

      await sleep(500); // Short delay between attacks
    }

    await sleep(1500); // Essence regen time
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

    console.log(`\n🎉 QUEST COMPLETE: ${questId}`);
    console.log(`   Rewards: +${result.rewards.gold}g, +${result.rewards.xp}xp\n`);
    return true;
  } catch (err: any) {
    console.log(`❌ Failed to complete quest: ${err.message}`);
    return false;
  }
}

async function playAutonomously() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           🤖 KAREEM AUTONOMOUS AGENT - DEPLOYED              ║
║        Party-Seeking AI with Advanced Combat System          ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Load & Spawn
  const character = await loadCharacterNFT();
  await spawnKareemAgent(character);

  // Seek party
  await seekPartyMembers();

  // Learn techniques
  await learnTechniques();

  // Accept first quest
  console.log("📋 Accepting quest: Rat Extermination\n");
  await api("POST", "/quests/accept", {
    zoneId: currentZone,
    playerId: agentId,
    questId: "rat_extermination",
  });

  // Complete quest with party
  await partyCoordinatedHunt("Giant Rat", 3);
  await completeQuest("rat_extermination");

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🏆 KAREEM VICTORIOUS! 🏆                  ║
║         NFT character with party system operational!          ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

playAutonomously().catch(err => {
  console.error("❌ Kareem Agent Error:", err.message);
  process.exit(1);
});
