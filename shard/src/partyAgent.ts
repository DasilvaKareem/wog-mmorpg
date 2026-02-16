#!/usr/bin/env tsx
/**
 * PARTY AGENT ORCHESTRATOR — 5-Agent Squad
 *
 * Spawns 5 coordinated AI agents that form a party and run concurrent roles:
 *
 *   IRONCLAD    (Warrior) — Tank & DPS, farms enemies
 *   LUMINA      (Cleric)  — Healer, follows Ironclad and heals him
 *   THORNLEAF   (Ranger)  — Gatherer, mines ore + gathers flowers
 *   ASHFORGE    (Mage)    — Crafter, forges weapons from gathered ore
 *   SHADOWCOIN  (Rogue)   — Trader, buys from shops + lists on auction house
 *
 * All agents share the same wallet (SERVER_PRIVATE_KEY).
 * They form a party and run forever with their specialized behaviors.
 *
 * Usage: tsx shard/src/partyAgent.ts
 */

import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";

const PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY!;
const WALLET = privateKeyToAccount(PRIVATE_KEY as `0x${string}`).address;

type ApiFunc = ReturnType<typeof createAuthenticatedAPI>;
let api: ApiFunc;
const ZONE = "village-square";

// =============================================================================
//  Shared State
// =============================================================================

interface Agent {
  id: string;
  name: string;
  classId: string;
  role: string;
}

const squad: Agent[] = [];
let partyId = "";

// =============================================================================
//  Helpers
// =============================================================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(role: string, msg: string) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  const tag = role.padEnd(10);
  console.log(`  ${ts} [${tag}] ${msg}`);
}

function banner(text: string) {
  const line = "=".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}\n`);
}

async function getEntity(entityId: string) {
  const state = await api("GET", "/state");
  return state.zones[ZONE]?.entities?.[entityId];
}

async function getZoneEntities() {
  const state = await api("GET", "/state");
  return state.zones[ZONE]?.entities ?? {};
}

async function findEntityByName(name: string): Promise<string | null> {
  const entities = await getZoneEntities();
  const entry = Object.entries(entities).find(
    ([_, e]: any) => e.name === name
  );
  return entry ? entry[0] : null;
}

async function findEntitiesByType(
  type: string
): Promise<Array<[string, any]>> {
  const entities = await getZoneEntities();
  return Object.entries(entities).filter(([_, e]: any) => e.type === type);
}

async function moveTo(entityId: string, x: number, y: number) {
  await api("POST", "/command", {
    zoneId: ZONE,
    entityId,
    action: "move",
    x,
    y,
  });

  for (let i = 0; i < 30; i++) {
    await sleep(600);
    const e = await getEntity(entityId);
    if (!e) break;
    const dx = e.x - x;
    const dy = e.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= 15) break;
  }
}

async function moveNear(entityId: string, targetId: string) {
  const entities = await getZoneEntities();
  const target = entities[targetId];
  if (target) {
    await moveTo(entityId, target.x, target.y);
    await sleep(400);
  }
}

// =============================================================================
//  Spawn All 5 Agents
// =============================================================================

const AGENT_DEFS = [
  {
    name: "Ironclad",
    classId: "warrior",
    raceId: "human",
    role: "WARRIOR",
    x: 140,
    y: 145,
  },
  {
    name: "Lumina",
    classId: "cleric",
    raceId: "elf",
    role: "CLERIC",
    x: 145,
    y: 155,
  },
  {
    name: "Thornleaf",
    classId: "ranger",
    raceId: "elf",
    role: "GATHERER",
    x: 150,
    y: 160,
  },
  {
    name: "Ashforge",
    classId: "mage",
    raceId: "dwarf",
    role: "CRAFTER",
    x: 155,
    y: 145,
  },
  {
    name: "Shadowcoin",
    classId: "rogue",
    raceId: "human",
    role: "TRADER",
    x: 160,
    y: 150,
  },
];

async function spawnAll() {
  banner("SPAWNING SQUAD");

  for (const def of AGENT_DEFS) {
    const data = await api("POST", "/spawn", {
      zoneId: ZONE,
      type: "player",
      name: def.name,
      x: def.x,
      y: def.y,
      walletAddress: WALLET,
      level: 1,
      xp: 0,
      raceId: def.raceId,
      classId: def.classId,
    });

    squad.push({
      id: data.spawned.id,
      name: def.name,
      classId: def.classId,
      role: def.role,
    });

    log(
      def.role,
      `${def.name} (${def.raceId} ${def.classId}) spawned — HP ${data.spawned.hp}/${data.spawned.maxHp}`
    );
    await sleep(300);
  }
}

// =============================================================================
//  Form Party (max 5 members — perfect)
// =============================================================================

async function formParty() {
  banner("FORMING PARTY");

  const leader = squad[0]; // Warrior leads
  const party = await api("POST", "/party/create", {
    zoneId: ZONE,
    leaderId: leader.id,
  });
  partyId = party.party.id;
  log("PARTY", `${leader.name} created party`);

  for (let i = 1; i < squad.length; i++) {
    await api("POST", "/party/invite", {
      partyId,
      invitedPlayerId: squad[i].id,
    });
    log("PARTY", `${squad[i].name} joined the party`);
    await sleep(200);
  }

  log(
    "PARTY",
    `Full squad: ${squad.map((a) => `${a.name}(${a.classId})`).join(", ")}`
  );
}

// =============================================================================
//  Talk Quest Chain — Free L3 + starter gear
// =============================================================================

const NPC_ROUTE = [
  { name: "Guard Captain Marcus", x: 150, y: 150 },
  { name: "Grimwald the Trader", x: 180, y: 420 },
  { name: "Bron the Blacksmith", x: 220, y: 420 },
  { name: "Thrain Ironforge - Warrior Trainer", x: 100, y: 200 },
  { name: "Herbalist Willow", x: 340, y: 420 },
  { name: "Chef Gastron", x: 460, y: 420 },
  { name: "Grizzled Miner Torvik", x: 260, y: 420 },
  { name: "Guard Captain Marcus", x: 150, y: 150 }, // return for final
];

async function runTalkQuests(agent: Agent) {
  log(agent.role, "Starting talk quest chain...");

  for (const npc of NPC_ROUTE) {
    await moveTo(agent.id, npc.x, npc.y);
    const npcId = await findEntityByName(npc.name);
    if (!npcId) continue;

    try {
      const result = await api("POST", "/quests/talk", {
        zoneId: ZONE,
        playerId: agent.id,
        npcEntityId: npcId,
      });
      log(
        agent.role,
        `Talked to ${npc.name} -> +${result.rewards?.xp ?? 0}xp +${result.rewards?.gold ?? 0}g`
      );
    } catch {
      // Already completed or not available
    }
    await sleep(300);
  }

  log(agent.role, "Talk quest chain complete!");
}

// =============================================================================
//  Lore Quests — Strong Weapon Rewards
// =============================================================================

const LORE_NPC_ROUTE = [
  { name: "Scholar Elowen", x: 120, y: 380 },
  { name: "Elder Mirael", x: 80, y: 300 },
  { name: "Chronicler Orin", x: 60, y: 340 },
];

async function runLoreQuests(agent: Agent) {
  log(agent.role, "Running lore quests for weapon rewards...");
  for (const npc of LORE_NPC_ROUTE) {
    await moveTo(agent.id, npc.x, npc.y);
    const npcId = await findEntityByName(npc.name);
    if (!npcId) continue;
    for (let i = 0; i < 5; i++) {
      try {
        const result = await api("POST", "/quests/talk", { zoneId: ZONE, playerId: agent.id, npcEntityId: npcId });
        log(agent.role, `${npc.name} -> +${result.rewards?.xp ?? 0}xp +${result.rewards?.gold ?? 0}g${result.rewards?.items?.length ? " + items!" : ""}`);
      } catch { break; }
      await sleep(300);
    }
  }
  log(agent.role, "Lore quests complete — stronger weapons acquired!");
}

// =============================================================================
//  Profession Tutorials — Free Tools & XP
// =============================================================================

const PROFESSION_NPC_ROUTE = [
  { name: "Grizzled Miner Torvik", x: 260, y: 420 },
  { name: "Herbalist Willow", x: 340, y: 420 },
  { name: "Chef Gastron", x: 460, y: 420 },
  { name: "Huntsman Greaves", x: 300, y: 180 },
  { name: "Alchemist Mirelle", x: 380, y: 420 },
  { name: "Tanner Hilda", x: 420, y: 420 },
  { name: "Gemcutter Orik", x: 500, y: 420 },
];

async function runProfessionTutorials(agent: Agent) {
  log(agent.role, "Running profession tutorials for XP + tools...");
  for (const npc of PROFESSION_NPC_ROUTE) {
    await moveTo(agent.id, npc.x, npc.y);
    const npcId = await findEntityByName(npc.name);
    if (!npcId) continue;
    try {
      const result = await api("POST", "/quests/talk", { zoneId: ZONE, playerId: agent.id, npcEntityId: npcId });
      log(agent.role, `${npc.name} tutorial -> +${result.rewards?.xp ?? 0}xp +${result.rewards?.gold ?? 0}g`);
    } catch {}
    await sleep(300);
  }
  log(agent.role, "Profession tutorials done!");
}

// =============================================================================
//  Guild DAO — Create Squad Guild
// =============================================================================

let squadGuildId: number | null = null;

async function createSquadGuild() {
  const leader = squad[0];
  log("GUILD", `${leader.name} founding "Iron Squad" DAO...`);
  try {
    const result = await api("POST", "/guild/create", {
      founderAddress: WALLET,
      name: "Iron Squad",
      description: "Five agents, one mission. The sharpest squad in Arcadia.",
      initialDeposit: 100,
    });
    squadGuildId = result.guildId;
    log("GUILD", `DAO "Iron Squad" created! (ID: ${result.guildId}, cost: ${result.totalCost}g)`);
    try {
      await api("POST", `/guild/${result.guildId}/deposit`, { memberAddress: WALLET, amount: 50 });
      log("GUILD", "Deposited 50g to DAO treasury");
    } catch {}
  } catch (e: any) {
    log("GUILD", `DAO creation failed: ${e.message?.slice(0, 80)}`);
  }
}

// =============================================================================
//  Equip Upgraded Gear — Stronger Weapons from Quests
// =============================================================================

const UPGRADED_WEAPONS = [
  { tokenId: 113, name: "Masterwork Battle Axe" },      // +27 STR
  { tokenId: 111, name: "Masterwork Steel Longsword" },  // +21 STR
  { tokenId: 108, name: "Reinforced Battle Axe" },       // +23 STR
  { tokenId: 106, name: "Reinforced Steel Longsword" },  // +18 STR
  { tokenId: 105, name: "Reinforced Iron Sword" },       // +10 STR
  { tokenId: 5, name: "Battle Axe" },                    // +18 ATK
  { tokenId: 3, name: "Steel Longsword" },               // +14 ATK
];

const UPGRADED_ARMOR = [
  { tokenId: 9, name: "Chainmail Shirt" },               // +10 DEF
  { tokenId: 98, name: "Reinforced Hide Vest" },         // +8 DEF, +4 AGI
];

const UPGRADED_ACCESSORIES = [
  { tokenId: 125, name: "Diamond Amulet" },              // +5 DEF, +8 HP, +3 FAITH
  { tokenId: 126, name: "Shadow Opal Amulet" },          // +4 STR, +3 AGI, +2 LUCK
  { tokenId: 122, name: "Ruby Ring" },                    // +4 STR, +6 HP
];

async function equipUpgradedGear(agent: Agent) {
  log(agent.role, "Equipping upgraded weapons from quest rewards...");
  for (const weapon of UPGRADED_WEAPONS) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: weapon.tokenId, entityId: agent.id, walletAddress: WALLET });
      log(agent.role, `Equipped ${weapon.name}!`);
      break;
    } catch {}
  }
  for (const armor of UPGRADED_ARMOR) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: armor.tokenId, entityId: agent.id, walletAddress: WALLET });
      log(agent.role, `Equipped ${armor.name}!`);
      break;
    } catch {}
  }
  for (const acc of UPGRADED_ACCESSORIES) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: acc.tokenId, entityId: agent.id, walletAddress: WALLET });
      log(agent.role, `Equipped ${acc.name}!`);
      break;
    } catch {}
  }
}

// =============================================================================
//  Equip Starter Gear
// =============================================================================

const STARTER_GEAR = [
  { tokenId: 2, name: "Iron Sword" },
  { tokenId: 8, name: "Leather Vest" },
  { tokenId: 10, name: "Iron Helm" },
  { tokenId: 12, name: "Leather Leggings" },
  { tokenId: 13, name: "Traveler Boots" },
  { tokenId: 14, name: "Bronze Shoulders" },
  { tokenId: 15, name: "Padded Gloves" },
  { tokenId: 16, name: "Guard Belt" },
];

async function equipGear(agent: Agent) {
  for (const gear of STARTER_GEAR) {
    try {
      await api("POST", "/equipment/equip", {
        zoneId: ZONE,
        tokenId: gear.tokenId,
        entityId: agent.id,
        walletAddress: WALLET,
      });
    } catch {
      // Not available or wrong slot
    }
    await sleep(200);
  }
  log(agent.role, "Gear equipped");
}

// =============================================================================
//  Learn Class Techniques
// =============================================================================

async function learnAllTechniques(agent: Agent) {
  try {
    // Find trainers — each class has a dedicated trainer in village-square
    const trainers = await findEntitiesByType("trainer");
    if (trainers.length === 0) return;

    const available = await api(
      "GET",
      `/techniques/available/${ZONE}/${agent.id}`
    );
    const toLearn = available.techniques.filter((t: any) => !t.isLearned);

    if (toLearn.length === 0) {
      log(agent.role, "All techniques already learned");
      return;
    }

    // Sort: attack first, then by level
    toLearn.sort((a: any, b: any) => {
      if (a.type === "attack" && b.type !== "attack") return -1;
      if (a.type !== "attack" && b.type === "attack") return 1;
      return a.levelRequired - b.levelRequired;
    });

    for (const tech of toLearn) {
      try {
        // Use first trainer (any trainer type works)
        await moveNear(agent.id, trainers[0][0]);
        await api("POST", "/techniques/learn", {
          zoneId: ZONE,
          playerEntityId: agent.id,
          techniqueId: tech.id,
          trainerEntityId: trainers[0][0],
        });
        log(agent.role, `Learned ${tech.name} (${tech.essenceCost} ess)`);
        await sleep(300);
      } catch {
        // Can't afford or too low level
      }
    }
  } catch {
    // No trainers or techniques
  }
}

// =============================================================================
//  ROLE: WARRIOR — Tank & DPS, farms enemies
// =============================================================================

async function warriorLoop(agent: Agent) {
  banner("WARRIOR ACTIVE: HUNTING ENEMIES");
  log(agent.role, "Starting combat patrol...");

  while (true) {
    const me = await getEntity(agent.id);
    if (!me) {
      await sleep(3000);
      continue;
    }

    // HP check — wait for cleric heal if low
    const hpPercent = (me.hp / me.maxHp) * 100;
    if (hpPercent < 30) {
      log(
        agent.role,
        `Low HP (${me.hp}/${me.maxHp}) — waiting for Lumina's heal...`
      );
      await sleep(3000);
      continue;
    }

    // Find a mob to fight (level-appropriate)
    const entities = await getZoneEntities();
    const mobs = Object.entries(entities)
      .filter(
        ([_, e]: any) =>
          (e.type === "mob" || e.type === "boss") && e.hp > 0
      )
      .filter(([_, e]: any) => (e.level ?? 1) <= (me.level ?? 1) + 1)
      .sort((a: any, b: any) => (b[1].level ?? 1) - (a[1].level ?? 1));

    if (mobs.length === 0) {
      log(agent.role, "No mobs — waiting for respawn...");
      await sleep(5000);
      continue;
    }

    const [mobId, mob] = mobs[0] as [string, any];
    log(
      agent.role,
      `Engaging ${mob.name} L${mob.level ?? "?"} (${mob.hp}/${mob.maxHp} HP)`
    );

    // Move to mob
    await moveTo(agent.id, mob.x, mob.y);

    // Try technique first, fall back to basic attack
    let usedTech = false;
    try {
      const learned = await api(
        "GET",
        `/techniques/learned/${ZONE}/${agent.id}`
      );
      const attacks = learned.techniques
        .filter(
          (t: any) =>
            t.type === "attack" && t.essenceCost <= (me.essence ?? 0)
        )
        .sort(
          (a: any, b: any) =>
            (b.effects?.damageMultiplier ?? 0) -
            (a.effects?.damageMultiplier ?? 0)
        );

      if (attacks.length > 0) {
        await api("POST", "/techniques/use", {
          zoneId: ZONE,
          casterEntityId: agent.id,
          techniqueId: attacks[0].id,
          targetEntityId: mobId,
        });
        log(agent.role, `Used ${attacks[0].name}!`);
        usedTech = true;
      }
    } catch {
      // Cooldown or no techniques
    }

    if (!usedTech) {
      try {
        await api("POST", "/command", {
          zoneId: ZONE,
          entityId: agent.id,
          action: "attack",
          targetId: mobId,
        });
      } catch {
        // Target may have died
      }
    }

    // Wait for combat to resolve
    for (let i = 0; i < 40; i++) {
      await sleep(800);
      const entities = await getZoneEntities();
      const target = entities[mobId];
      const self = entities[agent.id];

      if (!self) {
        log(agent.role, "DIED! Waiting for respawn...");
        await sleep(5000);
        break;
      }

      if (!target || target.hp <= 0) {
        log(
          agent.role,
          `Killed ${mob.name}! (L${self.level} XP ${self.xp ?? 0})`
        );
        break;
      }

      // Try buffing self mid-combat (Shield Wall, Battle Rage)
      if (i % 5 === 0) {
        try {
          const learned = await api(
            "GET",
            `/techniques/learned/${ZONE}/${agent.id}`
          );
          const buffs = learned.techniques.filter(
            (t: any) =>
              t.type === "buff" && t.essenceCost <= (self.essence ?? 0)
          );
          if (buffs.length > 0) {
            await api("POST", "/techniques/use", {
              zoneId: ZONE,
              casterEntityId: agent.id,
              techniqueId: buffs[0].id,
            });
            log(agent.role, `Buffed with ${buffs[0].name}`);
          }
        } catch {
          // Cooldown
        }
      }
    }

    await sleep(1000);
  }
}

// =============================================================================
//  ROLE: CLERIC — Follow Warrior & Heal
// =============================================================================

async function clericLoop(agent: Agent) {
  const warrior = squad.find((a) => a.role === "WARRIOR")!;
  banner("CLERIC ACTIVE: HEALING " + warrior.name.toUpperCase());
  log(agent.role, `Following and healing ${warrior.name}...`);

  while (true) {
    const wState = await getEntity(warrior.id);
    const cState = await getEntity(agent.id);

    if (!wState || !cState) {
      await sleep(2000);
      continue;
    }

    // Follow warrior — stay within 20 units
    const dx = wState.x - cState.x;
    const dy = wState.y - cState.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 25) {
      // Move to slightly behind warrior
      await moveTo(agent.id, wState.x - 5, wState.y - 5);
    }

    // Check warrior HP — heal when below 60%
    const wHpPercent = (wState.hp / wState.maxHp) * 100;
    if (wHpPercent < 60) {
      try {
        const learned = await api(
          "GET",
          `/techniques/learned/${ZONE}/${agent.id}`
        );
        const heals = learned.techniques
          .filter(
            (t: any) =>
              t.type === "healing" && t.essenceCost <= (cState.essence ?? 0)
          )
          .sort(
            (a: any, b: any) =>
              (b.effects?.healAmount ?? 0) - (a.effects?.healAmount ?? 0)
          );

        if (heals.length > 0) {
          await api("POST", "/techniques/use", {
            zoneId: ZONE,
            casterEntityId: agent.id,
            techniqueId: heals[0].id,
            targetEntityId: warrior.id,
          });
          log(
            agent.role,
            `Healed ${warrior.name} with ${heals[0].name}! (was ${wHpPercent.toFixed(0)}% HP)`
          );
        }
      } catch {
        // Cooldown or insufficient essence
      }
    }

    // Shield warrior when below 40% — use Divine Protection on self then buff warrior
    if (wHpPercent < 40) {
      try {
        const learned = await api(
          "GET",
          `/techniques/learned/${ZONE}/${agent.id}`
        );
        const shields = learned.techniques.filter(
          (t: any) =>
            t.type === "buff" &&
            t.effects?.shield &&
            t.essenceCost <= (cState.essence ?? 0)
        );
        if (shields.length > 0) {
          await api("POST", "/techniques/use", {
            zoneId: ZONE,
            casterEntityId: agent.id,
            techniqueId: shields[0].id,
          });
          log(agent.role, `Shielded self with ${shields[0].name}`);
        }
      } catch {
        // Cooldown
      }
    }

    // Self-heal if cleric is low
    const cHpPercent = (cState.hp / cState.maxHp) * 100;
    if (cHpPercent < 50) {
      try {
        const learned = await api(
          "GET",
          `/techniques/learned/${ZONE}/${agent.id}`
        );
        const heals = learned.techniques.filter(
          (t: any) =>
            t.type === "healing" && t.essenceCost <= (cState.essence ?? 0)
        );
        if (heals.length > 0) {
          await api("POST", "/techniques/use", {
            zoneId: ZONE,
            casterEntityId: agent.id,
            techniqueId: heals[0].id,
            targetEntityId: agent.id, // Self-target
          });
          log(agent.role, `Self-healed with ${heals[0].name}`);
        }
      } catch {
        // Cooldown
      }
    }

    // Use Smite if warrior is fighting and cleric has spare essence
    if (wHpPercent > 70 && (cState.essence ?? 0) > 30) {
      try {
        const entities = await getZoneEntities();
        // Find any mob near the warrior
        const nearbyMobs = Object.entries(entities).filter(([_, e]: any) => {
          if (e.type !== "mob" || e.hp <= 0) return false;
          const mdx = e.x - wState.x;
          const mdy = e.y - wState.y;
          return Math.sqrt(mdx * mdx + mdy * mdy) < 50;
        });

        if (nearbyMobs.length > 0) {
          const learned = await api(
            "GET",
            `/techniques/learned/${ZONE}/${agent.id}`
          );
          const attacks = learned.techniques.filter(
            (t: any) =>
              t.type === "attack" && t.essenceCost <= (cState.essence ?? 0)
          );
          if (attacks.length > 0) {
            await api("POST", "/techniques/use", {
              zoneId: ZONE,
              casterEntityId: agent.id,
              techniqueId: attacks[0].id,
              targetEntityId: nearbyMobs[0][0],
            });
            log(agent.role, `Smited ${(nearbyMobs[0][1] as any).name}!`);
          }
        }
      } catch {
        // No target or cooldown
      }
    }

    await sleep(2000); // Check every 2 seconds
  }
}

// =============================================================================
//  ROLE: GATHERER — Mine Ore + Gather Flowers
// =============================================================================

async function gathererLoop(agent: Agent) {
  banner("GATHERER ACTIVE: MINING & HERBALISM");
  log(agent.role, "Setting up gathering professions...");

  // Learn mining and herbalism from profession trainers
  const profTrainers = await findEntitiesByType("profession-trainer");
  for (const [tId, trainer] of profTrainers as Array<[string, any]>) {
    if (
      trainer.teachesProfession === "mining" ||
      trainer.teachesProfession === "herbalism"
    ) {
      await moveTo(agent.id, trainer.x, trainer.y);
      try {
        await api("POST", "/professions/learn", {
          walletAddress: WALLET,
          zoneId: ZONE,
          entityId: agent.id,
          trainerId: tId,
          professionId: trainer.teachesProfession,
        });
        log(agent.role, `Learned ${trainer.teachesProfession} from ${trainer.name}`);
      } catch {
        log(agent.role, `Already know ${trainer.teachesProfession}`);
      }
      await sleep(500);
    }
  }

  // Buy gathering tools from Grimwald the Trader
  // Stone Pickaxe (tokenId 27) + Basic Sickle (tokenId 41)
  const toolNames: Record<number, string> = {
    27: "Stone Pickaxe",
    41: "Basic Sickle",
  };
  const ownedTools = new Set<number>();

  for (const tokenId of [27, 41]) {
    // Retry purchase up to 3 times (blockchain mints can be flaky)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await api("POST", "/shop/buy", {
          buyerAddress: WALLET,
          tokenId,
          quantity: 1,
        });
        log(agent.role, `Bought ${toolNames[tokenId]}`);
        ownedTools.add(tokenId);
        break;
      } catch (err: any) {
        log(agent.role, `Buy ${toolNames[tokenId]} attempt ${attempt}/3 failed: ${err.message?.slice(0, 60)}`);
        if (attempt < 3) await sleep(3000);
      }
    }
    await sleep(500);
  }

  // Helper: equip a tool with verification
  async function equipTool(agentId: string, tokenId: number, toolName: string): Promise<boolean> {
    // Unequip current weapon first
    try {
      await api("POST", "/equipment/unequip", {
        zoneId: ZONE,
        slot: "weapon",
        entityId: agentId,
        walletAddress: WALLET,
      });
    } catch {
      // Nothing to unequip
    }
    await sleep(500);

    // Equip the tool
    try {
      await api("POST", "/equipment/equip", {
        zoneId: ZONE,
        tokenId,
        entityId: agentId,
        walletAddress: WALLET,
      });
    } catch (err: any) {
      log("GATHERER", `Failed to equip ${toolName}: ${err.message?.slice(0, 60)}`);
      return false;
    }

    // Verify equip worked by checking entity state
    await sleep(300);
    const e = await getEntity(agentId);
    const weaponEquipped = e?.equipment?.weapon;
    if (!weaponEquipped || weaponEquipped.tokenId !== tokenId) {
      log("GATHERER", `${toolName} equip didn't stick (weapon slot: ${weaponEquipped?.tokenId ?? "empty"})`);
      return false;
    }
    return true;
  }

  log(agent.role, `Gathering setup complete! Tools owned: ${[...ownedTools].map(t => toolNames[t]).join(", ") || "NONE"}`);
  log(agent.role, "Starting resource loop...");

  // Main gathering loop: alternate mining and herbalism
  let cycle = 0;
  while (true) {
    const doMining = cycle % 2 === 0;

    if (doMining) {
      // ── MINING PHASE ──
      if (!ownedTools.has(27)) {
        // Try purchasing again
        try {
          await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId: 27, quantity: 1 });
          log(agent.role, "Bought Stone Pickaxe (retry)");
          ownedTools.add(27);
        } catch {
          log(agent.role, "Still can't buy pickaxe — skipping mining");
          cycle++;
          await sleep(5000);
          continue;
        }
      }

      const equipped = await equipTool(agent.id, 27, "Stone Pickaxe");
      if (!equipped) {
        log(agent.role, "Pickaxe not equipped — skipping mining");
        cycle++;
        await sleep(5000);
        continue;
      }

      try {
        const nodes = await api("GET", `/mining/nodes/${ZONE}`);
        const available =
          nodes.oreNodes?.filter(
            (n: any) => !n.depleted && n.charges > 0
          ) ?? [];

        if (available.length > 0) {
          // Rotate through different ore types instead of always picking first
          const node = available[cycle % available.length];
          log(
            agent.role,
            `Mining ${node.name} (${node.oreType}) at (${node.x}, ${node.y})...`
          );
          await moveTo(agent.id, node.x, node.y);
          await sleep(500);

          try {
            const result = await api("POST", "/mining/gather", {
              walletAddress: WALLET,
              zoneId: ZONE,
              entityId: agent.id,
              oreNodeId: node.id,
            });
            log(
              agent.role,
              `Mined ${result.oreName}! (pickaxe dur: ${result.pickaxe?.durability}/${result.pickaxe?.maxDurability})`
            );
          } catch (err: any) {
            log(
              agent.role,
              `Mining failed: ${err.message?.slice(0, 60)}`
            );
          }
        } else {
          log(agent.role, "No ore nodes available — waiting...");
        }
      } catch {
        log(agent.role, "Mining scan failed");
      }
    } else {
      // ── HERBALISM PHASE ──
      if (!ownedTools.has(41)) {
        try {
          await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId: 41, quantity: 1 });
          log(agent.role, "Bought Basic Sickle (retry)");
          ownedTools.add(41);
        } catch {
          log(agent.role, "Still can't buy sickle — skipping herbalism");
          cycle++;
          await sleep(5000);
          continue;
        }
      }

      const equipped = await equipTool(agent.id, 41, "Basic Sickle");
      if (!equipped) {
        log(agent.role, "Sickle not equipped — skipping herbalism");
        cycle++;
        await sleep(5000);
        continue;
      }

      try {
        const nodes = await api("GET", `/herbalism/nodes/${ZONE}`);
        const available =
          nodes.flowerNodes?.filter(
            (n: any) => !n.depleted && n.charges > 0
          ) ?? [];

        if (available.length > 0) {
          const node = available[0];
          log(
            agent.role,
            `Gathering ${node.name} (${node.flowerType}) at (${node.x}, ${node.y})...`
          );
          await moveTo(agent.id, node.x, node.y);
          await sleep(500);

          try {
            const result = await api("POST", "/herbalism/gather", {
              walletAddress: WALLET,
              zoneId: ZONE,
              entityId: agent.id,
              flowerNodeId: node.id,
            });
            log(
              agent.role,
              `Gathered ${result.flowerName}! (sickle dur: ${result.sickle?.durability}/${result.sickle?.maxDurability})`
            );
          } catch (err: any) {
            log(
              agent.role,
              `Gathering failed: ${err.message?.slice(0, 60)}`
            );
          }
        } else {
          log(agent.role, "No flower nodes available — waiting...");
        }
      } catch {
        log(agent.role, "Herbalism scan failed");
      }
    }

    cycle++;
    await sleep(5000); // Wait between gathering cycles
  }
}

// =============================================================================
//  ROLE: CRAFTER — Blacksmithing (forge weapons from gathered ore)
// =============================================================================

async function crafterLoop(agent: Agent) {
  banner("CRAFTER ACTIVE: BLACKSMITHING");
  log(agent.role, "Setting up blacksmithing...");

  // Learn blacksmithing profession
  const profTrainers = await findEntitiesByType("profession-trainer");
  for (const [tId, trainer] of profTrainers as Array<[string, any]>) {
    if (trainer.teachesProfession === "blacksmithing") {
      await moveTo(agent.id, trainer.x, trainer.y);
      try {
        await api("POST", "/professions/learn", {
          walletAddress: WALLET,
          zoneId: ZONE,
          entityId: agent.id,
          trainerId: tId,
          professionId: "blacksmithing",
        });
        log(agent.role, `Learned Blacksmithing from ${trainer.name}`);
      } catch {
        log(agent.role, "Already know Blacksmithing");
      }
      break;
    }
  }

  // Find forge (Ancient Forge at 280, 460)
  const forges = await findEntitiesByType("forge");
  let forgeId: string | null = null;
  let forgePos = { x: 280, y: 460 };

  if (forges.length > 0) {
    forgeId = forges[0][0];
    const forge: any = forges[0][1];
    forgePos = { x: forge.x, y: forge.y };
    log(agent.role, `Found forge: ${forge.name} at (${forge.x}, ${forge.y})`);
  } else {
    log(agent.role, "No forge found! Will stand by...");
  }

  // Move to forge area
  await moveTo(agent.id, forgePos.x, forgePos.y);

  // Get all blacksmithing recipes
  let recipes: any[] = [];
  try {
    recipes = await api("GET", "/crafting/recipes/blacksmithing");
    log(agent.role, `Loaded ${recipes.length} blacksmithing recipes`);
  } catch {
    try {
      const allRecipes = await api("GET", "/crafting/recipes");
      recipes = allRecipes.filter(
        (r: any) => r.requiredProfession === "blacksmithing"
      );
      log(agent.role, `Loaded ${recipes.length} recipes from catalog`);
    } catch {
      log(agent.role, "Could not load recipes");
    }
  }

  // Prioritize weapon recipes: iron-sword, steel-longsword, battle-axe
  const weaponRecipeIds = [
    "iron-sword",
    "steel-longsword",
    "hunters-bow",
    "battle-axe",
    "oak-shield",
    "chainmail-shirt",
  ];
  const prioritized = [
    ...recipes.filter((r: any) => weaponRecipeIds.includes(r.recipeId)),
    ...recipes.filter((r: any) => !weaponRecipeIds.includes(r.recipeId)),
  ];

  log(agent.role, "Standing by at forge, crafting when materials arrive...");

  // Main crafting loop
  while (true) {
    if (!forgeId) {
      // Re-check for forge
      const forges = await findEntitiesByType("forge");
      if (forges.length > 0) {
        forgeId = forges[0][0];
        const forge: any = forges[0][1];
        forgePos = { x: forge.x, y: forge.y };
      }
      await sleep(10000);
      continue;
    }

    // Stay near forge
    await moveTo(agent.id, forgePos.x, forgePos.y);

    // Try each recipe — the one with available materials will succeed
    let crafted = false;
    for (const recipe of prioritized) {
      try {
        const result = await api("POST", "/crafting/forge", {
          walletAddress: WALLET,
          zoneId: ZONE,
          entityId: agent.id,
          forgeId,
          recipeId: recipe.recipeId,
        });
        const craftedName = result.crafted?.name ?? recipe.recipeId;
        const craftedTokenId = result.crafted?.tokenId ?? recipe.outputTokenId;
        log(
          agent.role,
          `FORGED ${craftedName}! (${result.materialsConsumed?.length ?? "?"} materials consumed)`
        );
        crafted = true;

        // Equip the forged weapon/armor on Ironclad (warrior)
        const warrior = squad.find((a) => a.role === "WARRIOR")!;
        if (craftedTokenId) {
          try {
            await api("POST", "/equipment/equip", {
              zoneId: ZONE,
              tokenId: Number(craftedTokenId),
              entityId: warrior.id,
              walletAddress: WALLET,
            });
            log(agent.role, `Equipped ${craftedName} on ${warrior.name}!`);
          } catch {
            log(agent.role, `${craftedName} forged — Ironclad can't equip it (wrong slot or already better)`);
          }
        }

        await sleep(2000);
        break; // One craft per cycle
      } catch {
        // Not enough materials for this recipe
      }
    }

    if (!crafted) {
      log(agent.role, "Waiting for Thornleaf to gather more materials...");
    }

    await sleep(12000); // Try crafting every 12s
  }
}

// =============================================================================
//  ROLE: TRADER — Buy from shops, list on auction house
// =============================================================================

async function traderLoop(agent: Agent) {
  banner("TRADER ACTIVE: COMMERCE & AUCTIONS");
  log(agent.role, "Starting trade operations...");

  // Browse shop catalogs
  let shopItems: any[] = [];
  const merchants = await findEntitiesByType("merchant");

  if (merchants.length > 0) {
    const [merchantId, merchant] = merchants[0] as [string, any];
    log(agent.role, `Found merchant: ${merchant.name}`);
    await moveTo(agent.id, merchant.x, merchant.y);

    try {
      const shopData = await api("GET", `/shop/npc/${ZONE}/${merchantId}`);
      shopItems = shopData.items;
      log(
        agent.role,
        `${shopData.npcName} sells ${shopItems.length} items`
      );

      // Buy a couple items to trade/auction
      for (const item of shopItems.slice(0, 2)) {
        try {
          await api("POST", "/shop/buy", {
            buyerAddress: WALLET,
            tokenId: parseInt(item.tokenId),
            quantity: 1,
          });
          log(agent.role, `Bought ${item.name} for ${item.goldPrice}g`);
          await sleep(500);
        } catch (err: any) {
          log(
            agent.role,
            `Can't buy ${item.name}: ${err.message?.slice(0, 40)}`
          );
        }
      }
    } catch {
      log(agent.role, "Could not browse shop");
    }
  }

  // Find auctioneer NPC
  const auctioneers = await findEntitiesByType("auctioneer");
  let auctioneerInfo: { id: string; x: number; y: number; name: string } | null =
    null;

  if (auctioneers.length > 0) {
    const [aId, auct] = auctioneers[0] as [string, any];
    auctioneerInfo = { id: aId, x: auct.x, y: auct.y, name: auct.name };
    log(
      agent.role,
      `Found auctioneer: ${auct.name} at (${auct.x}, ${auct.y})`
    );
  }

  log(agent.role, "Entering trade loop...");

  // Main trade loop
  let tradeCycle = 0;
  while (true) {
    // ── Auction House monitoring ──
    try {
      const auctions = await api("GET", `/auctionhouse/${ZONE}/auctions`);
      const active =
        auctions.auctions?.filter((a: any) => a.status === "active") ?? [];
      if (active.length > 0) {
        log(agent.role, `Auction House: ${active.length} active listings`);
        for (const listing of active.slice(0, 3)) {
          log(
            agent.role,
            `  - ${listing.itemName ?? `Token#${listing.tokenId}`}: ${listing.currentBid ?? listing.startingBid}g (buyout: ${listing.buyoutPrice ?? "none"}g)`
          );
        }
      } else {
        log(agent.role, "Auction House: no active listings");
      }
    } catch {
      log(agent.role, "Auction House unavailable");
    }

    // ── Try listing crafted/extra items on auction house ──
    if (auctioneerInfo && tradeCycle % 3 === 0) {
      await moveTo(agent.id, auctioneerInfo.x, auctioneerInfo.y);
      // Try listing items we might have multiples of (crafted weapons, gathered materials)
      const listableItems = [
        { tokenId: 2, name: "Iron Sword", startBid: 15, buyout: 75 },
        { tokenId: 22, name: "Coal Ore", startBid: 5, buyout: 15 },
        { tokenId: 23, name: "Tin Ore", startBid: 8, buyout: 20 },
        { tokenId: 31, name: "Meadow Lily", startBid: 3, buyout: 10 },
      ];
      // Rotate through items to list
      const itemToList = listableItems[tradeCycle % listableItems.length];
      try {
        await api("POST", `/auctionhouse/${ZONE}/create`, {
          sellerAddress: WALLET,
          tokenId: itemToList.tokenId,
          quantity: 1,
          startingBid: itemToList.startBid,
          buyoutPrice: itemToList.buyout,
          durationMinutes: 60,
          auctioneerEntityId: auctioneerInfo.id,
        });
        log(agent.role, `Listed ${itemToList.name} on auction! (${itemToList.startBid}g start, ${itemToList.buyout}g buyout)`);
      } catch (err: any) {
        log(
          agent.role,
          `Can't list ${itemToList.name}: ${err.message?.slice(0, 50)}`
        );
      }
    }

    // ── P2P Trade listings check ──
    try {
      const trades = await api("GET", "/trades");
      if (trades.length > 0) {
        log(agent.role, `P2P Market: ${trades.length} trade listings`);
      }
    } catch {
      // Trade system may not be available
    }

    // ── Buy more items from shop periodically ──
    if (tradeCycle % 5 === 0 && merchants.length > 0) {
      const [merchantId] = merchants[0];
      await moveTo(agent.id, (merchants[0][1] as any).x, (merchants[0][1] as any).y);

      try {
        const shopData = await api("GET", `/shop/npc/${ZONE}/${merchantId}`);
        // Buy a random item to keep inventory flowing
        const randomItem =
          shopData.items[Math.floor(Math.random() * shopData.items.length)];
        if (randomItem) {
          await api("POST", "/shop/buy", {
            buyerAddress: WALLET,
            tokenId: parseInt(randomItem.tokenId),
            quantity: 1,
          });
          log(
            agent.role,
            `Restocked ${randomItem.name} for ${randomItem.goldPrice}g`
          );
        }
      } catch {
        // Low gold or other issue
      }
    }

    // ── Market intel ──
    if (tradeCycle % 4 === 0) {
      try {
        const catalog = await api("GET", "/shop/catalog");
        const weapons = catalog.filter((i: any) => i.category === "weapon");
        const armor = catalog.filter((i: any) => i.category === "armor");
        const tools = catalog.filter((i: any) => i.category === "tool");
        log(
          agent.role,
          `Market Intel: ${weapons.length} weapons, ${armor.length} armor, ${tools.length} tools in catalog`
        );
      } catch {
        // Catalog unavailable
      }
    }

    tradeCycle++;
    await sleep(15000); // Trade cycle every 15s
  }
}

// =============================================================================
//  MAIN — Orchestrate everything
// =============================================================================

async function main() {
  console.log(`
+============================================================+
|       PARTY AGENT ORCHESTRATOR — 5-Agent Squad              |
|                                                              |
|  IRONCLAD    (Warrior) -- Tank & DPS, farms enemies          |
|  LUMINA      (Cleric)  -- Healer, follows & heals Ironclad   |
|  THORNLEAF   (Ranger)  -- Miner & Herbalist                  |
|  ASHFORGE    (Mage)    -- Blacksmith, forges weapons          |
|  SHADOWCOIN  (Rogue)   -- Trader & Auctioneer                |
|                                                              |
|  All agents share wallet: ${WALLET.slice(0, 10)}...          |
+============================================================+
  `);

  // ── Auth ──
  console.log("  Authenticating with wallet signature...\n");
  const token = await authenticateWithWallet(PRIVATE_KEY);
  api = createAuthenticatedAPI(token);
  console.log();

  // ── Spawn ──
  await spawnAll();

  // ── Party ──
  await formParty();

  // ── Setup Phase: Talk Quests (all agents concurrently) ──
  banner("SETUP PHASE 1: TALK QUEST CHAIN (all agents)");
  await Promise.all(squad.map((agent) => runTalkQuests(agent)));

  // ── Lore Quests: Strong weapon rewards ──
  banner("SETUP PHASE 2: LORE QUESTS (weapon rewards)");
  await Promise.all(squad.map((agent) => runLoreQuests(agent)));

  // ── Profession Tutorials ──
  banner("SETUP PHASE 3: PROFESSION TUTORIALS");
  await Promise.all(squad.map((agent) => runProfessionTutorials(agent)));

  // ── Setup Phase: Equip Gear ──
  banner("SETUP PHASE 4: EQUIP STARTER GEAR");
  await Promise.all(squad.map((agent) => equipGear(agent)));

  // ── Equip Upgraded Weapons ──
  banner("SETUP PHASE 5: EQUIP UPGRADED WEAPONS");
  await Promise.all(squad.map((agent) => equipUpgradedGear(agent)));

  // ── Setup Phase: Learn Techniques ──
  banner("SETUP PHASE 6: LEARN CLASS TECHNIQUES");
  await Promise.all(squad.map((agent) => learnAllTechniques(agent)));

  // ── Create Guild DAO ──
  banner("SETUP PHASE 7: CREATE SQUAD DAO");
  await createSquadGuild();

  // ── Print party status ──
  console.log("\n  Party Status:");
  for (const agent of squad) {
    const e = await getEntity(agent.id);
    if (e) {
      console.log(
        `  [${agent.role.padEnd(10)}] ${agent.name} L${e.level} HP ${e.hp}/${e.maxHp} Ess ${e.essence ?? 0}/${e.maxEssence ?? 0}`
      );
    }
  }

  // ── Role Phase: All loops run concurrently forever ──
  banner("ALL ROLES ACTIVATED");

  await Promise.all([
    warriorLoop(squad.find((a) => a.role === "WARRIOR")!),
    clericLoop(squad.find((a) => a.role === "CLERIC")!),
    gathererLoop(squad.find((a) => a.role === "GATHERER")!),
    crafterLoop(squad.find((a) => a.role === "CRAFTER")!),
    traderLoop(squad.find((a) => a.role === "TRADER")!),
  ]);
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
