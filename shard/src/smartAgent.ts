#!/usr/bin/env tsx
/**
 * SMART AI AGENT v3 — Survival-First Progression
 *
 * - Authenticates with wallet signature
 * - Loads character NFT from chain
 * - Phase 0: Talk quest chain → free L3 + full starter gear
 * - Phase 0.5: Equips all gear
 * - Phase 1: Human Meadow kill quests + grind to L5
 * - Phase 2: Wild Meadow quests + grind to L10
 * - Phase 3: Dark Forest quests + grind to L15
 * - Picks level-appropriate mobs (no suicide pulls)
 * - HP awareness before combat
 */

import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";

const API_URL = process.env.API_URL || "http://localhost:3000";
const PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY!;
// Derive wallet address from the private key so it always matches auth
const WALLET = privateKeyToAccount(PRIVATE_KEY as `0x${string}`).address;

let agentId: string;
let currentZone = "human-meadow";
let api: ReturnType<typeof createAuthenticatedAPI>;

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function banner(text: string) {
  const line = "=".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}\n`);
}

async function getAgentState() {
  const state = await api("GET", "/state");
  return state.zones[currentZone]?.entities?.[agentId];
}

async function printStatus() {
  const a = await getAgentState();
  if (!a) return;
  const hp = `${a.hp}/${a.maxHp}`;
  const ess = a.maxEssence ? `${a.essence}/${a.maxEssence}` : "n/a";
  console.log(
    `   [L${a.level}] HP ${hp}  Essence ${ess}  XP ${a.xp ?? 0}  Zone: ${currentZone}`
  );
}

// ---------------------------------------------------------------------------
//  Authentication + NFT loading
// ---------------------------------------------------------------------------

async function loadCharacterNFT() {
  console.log("Loading character NFT...\n");

  const data = await api("GET", `/character/${WALLET}`);

  if (!data.characters || data.characters.length === 0) {
    throw new Error("No character NFTs found — create one first!");
  }

  const c = data.characters[0];
  console.log(`   Found: ${c.name}`);
  console.log(
    `   ${c.properties.race} ${c.properties.class} — Level ${c.properties.level}, XP ${c.properties.xp}`
  );
  console.log(`   Token ID: ${c.tokenId}\n`);
  return c;
}

async function spawnAgent(character: any) {
  console.log("Spawning into world...\n");

  const data = await api("POST", "/spawn", {
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

  agentId = data.spawned.id;
  console.log(
    `   Spawned ${character.name} at (${data.spawned.x}, ${data.spawned.y})`
  );
  console.log(
    `   HP ${data.spawned.hp}/${data.spawned.maxHp}  Essence ${data.spawned.essence}/${data.spawned.maxEssence}\n`
  );
  return data.spawned;
}

// ---------------------------------------------------------------------------
//  Movement
// ---------------------------------------------------------------------------

async function moveTo(x: number, y: number) {
  await api("POST", "/command", {
    zoneId: currentZone,
    entityId: agentId,
    action: "move",
    x,
    y,
  });

  // Wait until we actually arrive (within 10 units)
  for (let i = 0; i < 30; i++) {
    await sleep(600);
    const a = await getAgentState();
    if (!a) break;
    const dx = a.x - x;
    const dy = a.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= 10) break;
  }
}

async function moveNear(targetId: string) {
  const state = await api("GET", "/state");
  const target = state.zones[currentZone]?.entities?.[targetId];
  if (target) {
    await moveTo(target.x, target.y);
    await sleep(800);
  }
}

// ---------------------------------------------------------------------------
//  Talk Quest Chain — Phase 0 (free L3 + full starter gear)
// ---------------------------------------------------------------------------

/** Find an entity by name in the current zone. */
async function findEntityByName(name: string): Promise<string | null> {
  const state = await api("GET", "/state");
  const entities = state.zones[currentZone]?.entities ?? {};
  const entry = Object.entries(entities).find(
    ([_, e]: any) => e.name === name
  );
  return entry ? entry[0] : null;
}

/**
 * Walk to each NPC in order, call POST /quests/talk for each.
 * Awards 900 XP (→ L3) + Iron Sword, full armor set, 6 health potions.
 */
async function runTalkQuestChain() {
  banner("PHASE 0: TALK QUEST CHAIN (→ L3 + FULL GEAR)");

  const npcRoute = [
    { name: "Guard Captain Marcus", x: 150, y: 150 },
    { name: "Grimwald the Trader", x: 180, y: 420 },
    { name: "Bron the Blacksmith", x: 220, y: 420 },
    { name: "Thrain Ironforge - Warrior Trainer", x: 100, y: 200 },
    { name: "Herbalist Willow", x: 340, y: 420 },
    { name: "Chef Gastron", x: 460, y: 420 },
    { name: "Grizzled Miner Torvik", x: 260, y: 420 },
    { name: "Guard Captain Marcus", x: 150, y: 150 }, // return for final quest
  ];

  for (const npc of npcRoute) {
    console.log(`   Walking to ${npc.name} (${npc.x}, ${npc.y})...`);
    await moveTo(npc.x, npc.y);

    const npcEntityId = await findEntityByName(npc.name);
    if (!npcEntityId) {
      console.log(`   WARNING: ${npc.name} not found in zone — skipping`);
      continue;
    }

    try {
      const result = await api("POST", "/quests/talk", {
        zoneId: currentZone,
        playerId: agentId,
        npcEntityId,
      });
      console.log(
        `   ✓ ${result.quest?.title ?? "talk quest"} — +${result.rewards?.xp ?? 0}xp +${result.rewards?.gold ?? 0}g`
      );
    } catch (err: any) {
      console.log(`   Skip ${npc.name}: ${err.message?.slice(0, 60) ?? "unknown error"}`);
    }

    await printStatus();
    await sleep(500);
  }
}

// ---------------------------------------------------------------------------
//  Equipment — Equip all gear received from talk quests
// ---------------------------------------------------------------------------

async function equipAllGear() {
  banner("EQUIPPING GEAR");

  const gearTokenIds = [
    { tokenId: 2, name: "Iron Sword" },
    { tokenId: 8, name: "Leather Vest" },
    { tokenId: 10, name: "Iron Helm" },
    { tokenId: 12, name: "Leather Leggings" },
    { tokenId: 13, name: "Traveler Boots" },
    { tokenId: 14, name: "Bronze Shoulders" },
    { tokenId: 15, name: "Padded Gloves" },
    { tokenId: 16, name: "Guard Belt" },
  ];

  for (const gear of gearTokenIds) {
    try {
      await api("POST", "/equipment/equip", {
        zoneId: currentZone,
        tokenId: gear.tokenId,
        entityId: agentId,
        walletAddress: WALLET,
      });
      console.log(`   Equipped ${gear.name} (token ${gear.tokenId})`);
    } catch (err: any) {
      console.log(`   Skip ${gear.name}: ${err.message?.slice(0, 60) ?? "unknown error"}`);
    }
    await sleep(300);
  }

  await printStatus();
}

// ---------------------------------------------------------------------------
//  Techniques
// ---------------------------------------------------------------------------

async function learnAvailableTechniques() {
  try {
    const state = await api("GET", "/state");
    // Find trainers in current zone
    const trainers = Object.entries(state.zones[currentZone].entities).filter(
      ([_, e]: any) => e.type === "trainer"
    );
    if (trainers.length === 0) return;

    const available = await api(
      "GET",
      `/techniques/available/${currentZone}/${agentId}`
    );
    const toLearn = available.techniques.filter((t: any) => !t.isLearned);
    if (toLearn.length === 0) return;

    // Prioritise attack techniques, then by level
    toLearn.sort((a: any, b: any) => {
      if (a.type === "attack" && b.type !== "attack") return -1;
      if (a.type !== "attack" && b.type === "attack") return 1;
      return a.levelRequired - b.levelRequired;
    });

    for (const tech of toLearn) {
      try {
        // Find matching trainer
        const trainer = trainers[0]; // class trainers are in human-meadow
        await moveNear(trainer[0]);

        await api("POST", "/techniques/learn", {
          zoneId: currentZone,
          playerEntityId: agentId,
          techniqueId: tech.id,
          trainerEntityId: trainer[0],
        });

        console.log(
          `   Learned ${tech.name} (${tech.essenceCost} ess, ${tech.cooldown}s CD)`
        );
        await sleep(300);
      } catch (err: any) {
        console.log(`   Tech ${tech.name} failed: ${err.message?.slice(0, 80) ?? "unknown"}`);
      }
    }
  } catch (err: any) {
    console.log(`   Technique scan: ${err.message?.slice(0, 60) ?? "no trainers"}`);
  }
}

async function useBestTechnique(targetId: string): Promise<boolean> {
  try {
    const agent = await getAgentState();
    const essence = agent.essence ?? 0;

    const learnedData = await api(
      "GET",
      `/techniques/learned/${currentZone}/${agentId}`
    );
    const attacks = learnedData.techniques
      .filter((t: any) => t.type === "attack" && t.essenceCost <= essence)
      .sort(
        (a: any, b: any) =>
          (b.effects?.damageMultiplier ?? 0) - (a.effects?.damageMultiplier ?? 0)
      );

    if (attacks.length === 0) {
      console.log(`   (no attack techniques available, ${learnedData.techniques.length} total learned, ${essence} essence)`);
      return false;
    }

    const pick = essence > (agent.maxEssence ?? 100) * 0.4 ? attacks[0] : attacks[attacks.length - 1];

    await api("POST", "/techniques/use", {
      zoneId: currentZone,
      casterEntityId: agentId,
      techniqueId: pick.id,
      targetEntityId: targetId,
    });
    console.log(`   Cast ${pick.name}! (${pick.essenceCost} ess)`);
    return true;
  } catch (err: any) {
    console.log(`   Cast failed: ${err.message?.slice(0, 60) ?? "unknown"}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Combat
// ---------------------------------------------------------------------------

/**
 * Kill a single mob. Returns true if a mob was killed, false if we couldn't find one.
 */
async function killOneMob(mobName: string): Promise<boolean> {
  // Find a living mob with this name
  const state = await api("GET", "/state");
  const mobs = Object.entries(state.zones[currentZone]?.entities ?? {}).filter(
    ([_, e]: any) =>
      e.name === mobName && (e.type === "mob" || e.type === "boss") && e.hp > 0
  );

  if (mobs.length === 0) return false;

  const [mobId, mob] = mobs[0] as [string, any];
  console.log(`   -> ${mobName} L${mob.level ?? "?"} HP ${mob.hp}/${mob.maxHp}`);

  // Engage: try technique first, fall back to basic attack
  try {
    const usedTech = await useBestTechnique(mobId);
    if (!usedTech) {
      await api("POST", "/command", {
        zoneId: currentZone,
        entityId: agentId,
        action: "attack",
        targetId: mobId,
      });
    }
  } catch {
    return false;
  }

  // Wait for the fight to resolve
  for (let ticks = 0; ticks < 40; ticks++) {
    await sleep(800);

    const s2 = await api("GET", "/state");
    const target = s2.zones[currentZone]?.entities?.[mobId];
    const me = s2.zones[currentZone]?.entities?.[agentId];

    if (!me) {
      await sleep(3000);
      break;
    }

    if (!target || target.hp <= 0) {
      console.log(`   Killed! (L${me.level} XP ${me.xp ?? 0})`);
      await sleep(1000);
      return true;
    }
  }

  await sleep(1000);
  return true; // mob probably died, tick timeout
}

/**
 * Hunt mobs for a quest, checking actual server-side quest progress.
 */
async function huntForQuest(questId: string, mobName: string, requiredKills: number) {
  console.log(`   Hunting ${mobName} (need ${requiredKills} kills)...\n`);

  for (let attempt = 0; attempt < requiredKills * 6; attempt++) {
    // Check actual quest progress from server
    const me = await getAgentState();
    if (!me) { await sleep(3000); continue; }

    const aq = me.activeQuests?.find((q: any) => q.questId === questId);
    if (!aq) break; // quest no longer active (completed or dropped)
    if (aq.progress >= requiredKills) {
      console.log(`   Quest progress: ${aq.progress}/${requiredKills} — done!`);
      break;
    }

    console.log(`   Progress: ${aq.progress}/${requiredKills}`);

    const found = await killOneMob(mobName);
    if (!found) {
      console.log("   No mobs found — waiting for respawn...");
      await sleep(5000);
    }
  }
}

/**
 * Hunt mobs for grinding (no quest, just kill count).
 */
async function huntMobs(mobName: string, killTarget: number) {
  console.log(`   Hunting ${killTarget}x ${mobName}...\n`);
  for (let i = 0; i < killTarget; i++) {
    const found = await killOneMob(mobName);
    if (!found) {
      await sleep(5000);
      i--; // don't count failed attempts
    }
  }
}

/**
 * Grind mobs until we reach a target level.
 * Picks the strongest mob in the zone we can safely farm.
 */
async function grindToLevel(targetLevel: number) {
  const agent = await getAgentState();
  if ((agent?.level ?? 1) >= targetLevel) return;

  banner(`GRINDING TO LEVEL ${targetLevel}`);

  while (true) {
    const a = await getAgentState();
    if (!a || (a.level ?? 1) >= targetLevel) break;

    const agentLevel = a.level ?? 1;
    console.log(`   Level ${agentLevel} / ${targetLevel}  XP ${a.xp ?? 0}`);

    // Scan zone for living mobs — prefer mobs 1-2 levels below to avoid deaths
    const state = await api("GET", "/state");
    const allMobs = Object.values(state.zones[currentZone]?.entities ?? {})
      .filter(
        (e: any) =>
          (e.type === "mob" || e.type === "boss") && e.hp > 0
      )
      .filter((e: any) => (e.level ?? 1) <= agentLevel)
      .sort((a: any, b: any) => (b.level ?? 1) - (a.level ?? 1)); // best XP first

    if (allMobs.length === 0) {
      console.log("   No suitable mobs — waiting for respawn...");
      await sleep(5000);
      continue;
    }

    const target = allMobs[0] as any;
    await huntMobs(target.name, 1);
  }

  const a2 = await getAgentState();
  console.log(`   Reached Level ${a2?.level}!\n`);
}

// ---------------------------------------------------------------------------
//  Quests
// ---------------------------------------------------------------------------

interface QuestDef {
  id: string;
  mob: string;
  count: number;
}

const HUMAN_MEADOW_QUESTS: QuestDef[] = [
  { id: "rat_extermination", mob: "Giant Rat", count: 3 },
  { id: "wolf_hunter_1", mob: "Hungry Wolf", count: 5 },
  { id: "boar_bounty", mob: "Wild Boar", count: 4 },
  { id: "goblin_menace", mob: "Goblin Raider", count: 3 },
  { id: "slime_cleanup", mob: "Mire Slime", count: 2 },
  { id: "bandit_problem", mob: "Bandit Scout", count: 3 },
  { id: "alpha_threat", mob: "Diseased Wolf", count: 1 },
];

const WILD_MEADOW_QUESTS: QuestDef[] = [
  { id: "bear_necessities", mob: "Forest Bear", count: 4 },
  { id: "arachnophobia", mob: "Venom Spider", count: 5 },
  { id: "outlaw_justice", mob: "Rogue Bandit", count: 4 },
  { id: "natures_corruption", mob: "Corrupted Ent", count: 3 },
  { id: "pack_leader", mob: "Dire Wolf", count: 1 },
  { id: "wilderness_survival", mob: "Forest Bear", count: 7 },
];

const DARK_FOREST_QUESTS: QuestDef[] = [
  { id: "shadows_in_dark", mob: "Shadow Wolf", count: 5 },
  { id: "cult_cleansing", mob: "Dark Cultist", count: 4 },
  { id: "undead_purge", mob: "Undead Knight", count: 4 },
  { id: "troll_slayer", mob: "Forest Troll", count: 3 },
  { id: "golem_breaker", mob: "Ancient Golem", count: 2 },
  { id: "necromancer_end", mob: "Necromancer Valdris", count: 1 },
  { id: "dark_forest_master", mob: "Shadow Wolf", count: 10 },
];

async function runQuestChain(quests: QuestDef[]) {
  for (const quest of quests) {
    console.log(`\n   -- Quest: ${quest.id} --`);

    // Accept
    try {
      await api("POST", "/quests/accept", {
        zoneId: currentZone,
        playerId: agentId,
        questId: quest.id,
      });
      console.log(`   Accepted ${quest.id}`);
    } catch (err: any) {
      console.log(`   Skip (${err.message.slice(0, 60)})`);
      continue;
    }

    // Hunt using server-side quest progress tracking
    await huntForQuest(quest.id, quest.mob, quest.count);

    // Turn in
    try {
      const state = await api("GET", "/state");
      const npcId = Object.entries(state.zones[currentZone].entities).find(
        ([_, e]: any) => e.type === "quest-giver"
      )?.[0];

      const result = await api("POST", "/quests/complete", {
        zoneId: currentZone,
        playerId: agentId,
        questId: quest.id,
        npcId,
      });
      console.log(
        `   COMPLETE  +${result.rewards.xp}xp  +${result.rewards.gold}g`
      );
    } catch (err: any) {
      console.log(`   Turn-in failed: ${err.message?.slice(0, 60)}`);
    }

    await printStatus();
    await sleep(1000);

    // Learn any newly-available techniques after level ups
    await learnAvailableTechniques();
  }
}

// ---------------------------------------------------------------------------
//  Zone transitions
// ---------------------------------------------------------------------------

async function transitionToZone(destZone: string) {
  banner(`TRANSITIONING TO ${destZone.toUpperCase()}`);

  // Get portals in current zone
  const portals = await api("GET", `/portals/${currentZone}`);
  const portal = portals.portals?.find(
    (p: any) => p.destination?.zone === destZone
  );

  if (!portal) {
    console.log(`   No portal found to ${destZone}! Available:`, JSON.stringify(portals.portals?.map((p: any) => p.destination?.zone)));
    return false;
  }

  // Move near the portal (position uses x/z)
  const px = portal.position?.x ?? portal.x;
  const pz = portal.position?.z ?? portal.y;
  console.log(`   Moving to portal "${portal.name}" at (${px}, ${pz})...`);
  await moveTo(px, pz);
  await sleep(2000); // travel time

  // Use the portal
  try {
    const result = await api(
      "POST",
      `/transition/${currentZone}/portal/${portal.id}`,
      {
        walletAddress: WALLET,
        entityId: agentId,
      }
    );

    currentZone = destZone;
    // Update agentId if the transition returns a new one
    if (result.entityId) agentId = result.entityId;

    console.log(`   Arrived in ${destZone}!`);
    await printStatus();
    return true;
  } catch (err: any) {
    // Try auto-transition as fallback
    try {
      const result = await api("POST", "/transition/auto", {
        walletAddress: WALLET,
        zoneId: currentZone,
        entityId: agentId,
      });

      currentZone = destZone;
      if (result.entityId) agentId = result.entityId;

      console.log(`   Arrived in ${destZone} (auto)!`);
      await printStatus();
      return true;
    } catch (err2: any) {
      console.log(`   Transition failed: ${err2.message.slice(0, 80)}`);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------------

async function run() {
  console.log(`
+------------------------------------------------------------+
|          SMART AGENT v3 — Survival-First Progression       |
|  Talk Quests -> Equip -> Kill Quests -> Grind -> Transition |
+------------------------------------------------------------+
  `);

  // -- Auth --
  console.log("Authenticating...\n");
  const token = await authenticateWithWallet(PRIVATE_KEY);
  api = createAuthenticatedAPI(token);
  console.log();

  // -- Load NFT --
  const character = await loadCharacterNFT();

  // -- Spawn --
  await spawnAgent(character);

  // ===================================================================
  //  PHASE 0 — Talk Quest Chain (→ L3 + full starter gear)
  // ===================================================================
  await runTalkQuestChain();

  // ===================================================================
  //  PHASE 0.5 — Equip all gear from talk quests
  // ===================================================================
  await equipAllGear();

  // ===================================================================
  //  PHASE 1 — Human Meadow Kill Quests (L3-5)
  // ===================================================================
  banner("PHASE 1: HUMAN MEADOW KILL QUESTS (L3-5)");

  await learnAvailableTechniques();

  console.log("\n   Starting kill quest chain...\n");
  await runQuestChain(HUMAN_MEADOW_QUESTS);

  // Grind to L5 if quests alone weren't enough
  await grindToLevel(5);

  // ===================================================================
  //  PHASE 2 — Wild Meadow (L5-10)
  // ===================================================================
  banner("PHASE 2: WILD MEADOW (L5-10)");

  await transitionToZone("wild-meadow");

  console.log("\n   Starting quest chain...\n");
  await runQuestChain(WILD_MEADOW_QUESTS);

  // Grind to L10 if quests alone weren't enough
  await grindToLevel(10);

  // ===================================================================
  //  PHASE 3 — Dark Forest (L10-15)
  // ===================================================================
  banner("PHASE 3: DARK FOREST (L10-15)");

  await transitionToZone("dark-forest");

  console.log("\n   Starting quest chain...\n");
  await runQuestChain(DARK_FOREST_QUESTS);

  // Optional extra grind
  await grindToLevel(15);

  // ===================================================================
  //  Final report
  // ===================================================================
  const final = await getAgentState();
  console.log(`
+------------------------------------------------------------+
|                     AGENT COMPLETE                          |
+------------------------------------------------------------+
   Name:    ${final?.name ?? "?"}
   Level:   ${final?.level ?? "?"}
   XP:      ${final?.xp ?? 0}
   HP:      ${final?.hp}/${final?.maxHp}
   Zone:    ${currentZone}
   Quests:  20 completed
+------------------------------------------------------------+
  `);
}

run().catch((err) => {
  console.error("Agent Error:", err.message);
  process.exit(1);
});
