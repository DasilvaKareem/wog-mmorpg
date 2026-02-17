#!/usr/bin/env tsx
/**
 * TEAM BATTLE — 2 Competing Squads (10 Agents)
 *
 *   TEAM ALPHA (Red)                    TEAM BRAVO (Blue)
 *   ─────────────────                   ─────────────────
 *   Ironclad    (Warrior) Tank/DPS      Grimjaw     (Warrior) Tank/DPS
 *   Lumina      (Cleric)  Healer        Seraphine   (Cleric)  Healer
 *   Thornleaf   (Ranger)  Gatherer      Bramblewood (Ranger)  Gatherer
 *   Ashforge    (Mage)    Crafter       Vulcanis    (Mage)    Crafter
 *   Shadowcoin  (Rogue)   Trader        Goldweave   (Rogue)   Trader
 *
 *   COMPETITION:
 *   - Race to defeat the strongest mobs (tracked by highest level kill)
 *   - Forge the most weapons and equip their warrior
 *   - Trade and list on auction house
 *   - First team to hit level milestones wins
 *
 * Usage: npx tsx src/teamBattle.ts
 */

import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";

const PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY!;
const WALLET = privateKeyToAccount(PRIVATE_KEY as `0x${string}`).address;

type ApiFunc = ReturnType<typeof createAuthenticatedAPI>;
let api: ApiFunc;
const ZONE = "village-square";

// Per-team zone tracking (updated on transition)
const teamZones: Record<string, string> = { ALPHA: "village-square", BRAVO: "village-square" };

// Transition lock — when true, non-warrior loops pause to avoid move conflicts
const teamTransitioning: Record<string, boolean> = { ALPHA: false, BRAVO: false };

// =============================================================================
//  Types & Scoreboard
// =============================================================================

interface Agent {
  id: string;
  name: string;
  classId: string;
  role: string;
  team: string;
}

interface TeamScore {
  kills: number;
  highestLevelKill: number;
  strongestMobName: string;
  weaponsForged: number;
  itemsTraded: number;
  teamLevel: number; // warrior's level
  totalXp: number;
}

const scores: Record<string, TeamScore> = {
  ALPHA: { kills: 0, highestLevelKill: 0, strongestMobName: "none", weaponsForged: 0, itemsTraded: 0, teamLevel: 1, totalXp: 0 },
  BRAVO: { kills: 0, highestLevelKill: 0, strongestMobName: "none", weaponsForged: 0, itemsTraded: 0, teamLevel: 1, totalXp: 0 },
};

const teams: Record<string, Agent[]> = { ALPHA: [], BRAVO: [] };
const partyIds: Record<string, string> = {};

// =============================================================================
//  Helpers
// =============================================================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TEAM_COLORS: Record<string, string> = { ALPHA: "🔴", BRAVO: "🔵" };

function log(team: string, role: string, msg: string) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  const icon = TEAM_COLORS[team] ?? "⚪";
  const tag = `${team[0]}:${role}`.padEnd(12);
  console.log(`  ${ts} ${icon} [${tag}] ${msg}`);
}

function banner(text: string) {
  const line = "=".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}\n`);
}

function printScoreboard() {
  const a = scores.ALPHA;
  const b = scores.BRAVO;
  const zA = teamZones.ALPHA ?? "village-square";
  const zB = teamZones.BRAVO ?? "village-square";
  console.log(`
┌──────────────────────────────────────────────────────────┐
│                    ⚔️  SCOREBOARD  ⚔️                     │
├──────────────────────────┬───────────────────────────────┤
│  🔴 TEAM ALPHA           │  🔵 TEAM BRAVO                │
├──────────────────────────┼───────────────────────────────┤
│  Zone: ${zA.padEnd(18)}│  Zone: ${zB.padEnd(23)}│
│  Level: ${String(a.teamLevel).padEnd(17)}│  Level: ${String(b.teamLevel).padEnd(22)}│
│  Kills: ${String(a.kills).padEnd(17)}│  Kills: ${String(b.kills).padEnd(22)}│
│  Best Kill: L${String(a.highestLevelKill).padEnd(13)}│  Best Kill: L${String(b.highestLevelKill).padEnd(18)}│
│  XP: ${String(a.totalXp).padEnd(20)}│  XP: ${String(b.totalXp).padEnd(25)}│
│  Weapons Forged: ${String(a.weaponsForged).padEnd(8)}│  Weapons Forged: ${String(b.weaponsForged).padEnd(13)}│
│  Items Traded: ${String(a.itemsTraded).padEnd(11)}│  Items Traded: ${String(b.itemsTraded).padEnd(16)}│
└──────────────────────────┴───────────────────────────────┘`);
}

async function getEntity(entityId: string, zoneId?: string) {
  const state = await api("GET", "/state");
  return state.zones[zoneId ?? ZONE]?.entities?.[entityId];
}

async function getZoneEntities(zoneId?: string) {
  const state = await api("GET", "/state");
  return state.zones[zoneId ?? ZONE]?.entities ?? {};
}

async function findEntityByName(name: string, zoneId?: string): Promise<string | null> {
  const entities = await getZoneEntities(zoneId);
  const entry = Object.entries(entities).find(([_, e]: any) => e.name === name);
  return entry ? entry[0] : null;
}

async function findEntitiesByType(type: string, zoneId?: string): Promise<Array<[string, any]>> {
  const entities = await getZoneEntities(zoneId);
  return Object.entries(entities).filter(([_, e]: any) => e.type === type);
}

async function moveTo(entityId: string, x: number, y: number, zoneId?: string) {
  const zone = zoneId ?? ZONE;
  await api("POST", "/command", { zoneId: zone, entityId, action: "move", x, y });
  for (let i = 0; i < 30; i++) {
    await sleep(600);
    const e = await getEntity(entityId, zone);
    if (!e) break;
    const dx = e.x - x;
    const dy = e.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= 15) break;
  }
}

async function moveNear(entityId: string, targetId: string, zoneId?: string) {
  const entities = await getZoneEntities(zoneId);
  const target = entities[targetId];
  if (target) {
    await moveTo(entityId, target.x, target.y, zoneId);
    await sleep(400);
  }
}

// =============================================================================
//  Zone-Aware Helpers (for multi-zone transition quests)
// =============================================================================

function getTeamZone(team: string): string {
  return teamZones[team] ?? ZONE;
}

async function getEntityInZone(entityId: string, zoneId: string) {
  const state = await api("GET", "/state");
  return state.zones[zoneId]?.entities?.[entityId];
}

async function getZoneEntitiesIn(zoneId: string) {
  const state = await api("GET", "/state");
  return state.zones[zoneId]?.entities ?? {};
}

async function moveToInZone(entityId: string, x: number, y: number, zoneId: string) {
  await api("POST", "/command", { zoneId, entityId, action: "move", x, y });
  for (let i = 0; i < 40; i++) {
    await sleep(600);
    const e = await getEntityInZone(entityId, zoneId);
    if (!e) break;
    const dx = e.x - x;
    const dy = e.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= 15) break;
  }
}

// =============================================================================
//  TRANSITION QUEST CHAIN — Lore-driven zone progression
// =============================================================================

const ZONE_PROGRESSION = [
  {
    zoneId: "village-square",
    bossName: "Diseased Wolf",
    bossLevel: 5,
    portalPos: { x: 290, y: 150 },
    portalId: "meadow-exit",
    requiredLevel: 5,
    nextZone: "wild-meadow",
    lore: [
      "═══════════════════════════════════════════════════════",
      "  📜 THE FIRST TRIAL: PROVING GROUND",
      "═══════════════════════════════════════════════════════",
      "  The Village Square grows too small for warriors of",
      "  your caliber. Ancient tales speak of wild beasts",
      "  roaming the meadows beyond the village walls.",
      "",
      "  QUEST: Slay the Diseased Wolf, a corrupted beast",
      "  that terrorizes the village outskirts. Only then",
      "  shall the Meadow Road reveal itself to the worthy.",
      "═══════════════════════════════════════════════════════",
    ],
    victoryLore: "With the Diseased Wolf vanquished, the Meadow Road beckons. Onward to the Wild Meadow!",
  },
  {
    zoneId: "wild-meadow",
    bossName: "Dire Wolf",
    bossLevel: 10,
    portalPos: { x: 336, y: 175 },
    portalId: "forest-gate",
    requiredLevel: 10,
    nextZone: "dark-forest",
    lore: [
      "═══════════════════════════════════════════════════════",
      "  📜 THE SECOND TRIAL: THE ALPHA'S HOWL",
      "═══════════════════════════════════════════════════════",
      "  The Wild Meadow has tested your mettle, but darker",
      "  forces stir in the ancient woods beyond. The Dire",
      "  Wolf — alpha of the meadow pack — guards the",
      "  passage to the Dark Forest.",
      "",
      "  QUEST: Hunt and slay the Dire Wolf, apex predator",
      "  of the meadows. Prove you are ready for the",
      "  horrors that lurk beneath the forest canopy.",
      "═══════════════════════════════════════════════════════",
    ],
    victoryLore: "The Dire Wolf falls with a thunderous howl! The Forest Gate creaks open, revealing the ominous Dark Forest...",
  },
];

const FINAL_BOSS = {
  zoneId: "dark-forest",
  bossName: "Necromancer Valdris",
  bossLevel: 16,
  lore: [
    "═══════════════════════════════════════════════════════",
    "  📜 THE FINAL TRIAL: VALDRIS MUST FALL",
    "═══════════════════════════════════════════════════════",
    "  The Dark Forest reeks of death and dark magic.",
    "  Necromancer Valdris has corrupted these ancient",
    "  woods, raising the dead as his twisted servants.",
    "",
    "  QUEST: Slay Necromancer Valdris and restore peace",
    "  to the realm of Geneva. This is the ultimate test.",
    "═══════════════════════════════════════════════════════",
  ],
  victoryLore: "⚔️ NECROMANCER VALDRIS IS DEFEATED! The dark magic dissipates and the ancient forest begins to heal. LEGENDS WILL BE WRITTEN! ⚔️",
};

/**
 * Transition quest: grind to required level, slay zone boss, transition the whole team.
 * Sets teamTransitioning flag to pause other loops during portal phase.
 */
async function runTransitionQuest(team: string, progressionIndex: number): Promise<boolean> {
  const prog = ZONE_PROGRESSION[progressionIndex];
  if (!prog) return false;

  const squad = teams[team];
  const warrior = squad.find((a) => a.role === "WARRIOR")!;

  // Print lore
  for (const line of prog.lore) {
    console.log(`  ${TEAM_COLORS[team]} [${team}] ${line}`);
  }

  // Phase 1: Hunt the zone boss
  log(team, "QUEST", `Hunting ${prog.bossName} (L${prog.bossLevel})...`);
  const currentZone = prog.zoneId;

  let bossSlain = false;
  for (let attempt = 0; attempt < 60 && !bossSlain; attempt++) {
    const entities = await getZoneEntitiesIn(currentZone);
    const boss = Object.entries(entities).find(
      ([_, e]: any) => e.name === prog.bossName && e.hp > 0
    );

    if (!boss) {
      log(team, "QUEST", `${prog.bossName} not found — waiting for respawn...`);
      await sleep(5000);
      continue;
    }

    const [bossId, bossData] = boss as [string, any];
    log(team, "QUEST", `Found ${prog.bossName} L${bossData.level} (${bossData.hp}/${bossData.maxHp} HP) — engaging!`);

    // Move warrior to boss
    await moveToInZone(warrior.id, bossData.x, bossData.y, currentZone);

    // Attack with techniques
    try {
      const learned = await api("GET", `/techniques/learned/${currentZone}/${warrior.id}`);
      const attacks = learned.techniques
        .filter((t: any) => t.type === "attack")
        .sort((a: any, b: any) => (b.effects?.damageMultiplier ?? 0) - (a.effects?.damageMultiplier ?? 0));
      if (attacks.length > 0) {
        await api("POST", "/techniques/use", { zoneId: currentZone, casterEntityId: warrior.id, techniqueId: attacks[0].id, targetEntityId: bossId });
      }
    } catch {}
    try {
      await api("POST", "/command", { zoneId: currentZone, entityId: warrior.id, action: "attack", targetId: bossId });
    } catch {}

    // Wait for combat resolution
    for (let i = 0; i < 60; i++) {
      await sleep(800);
      const entities2 = await getZoneEntitiesIn(currentZone);
      const target = entities2[bossId];
      const self = entities2[warrior.id];
      if (!self) {
        log(team, "QUEST", `Warrior died to ${prog.bossName}! Waiting for respawn...`);
        await sleep(5000);
        break;
      }
      if (!target || target.hp <= 0) {
        bossSlain = true;
        log(team, "QUEST", `☠️ ${prog.bossName} SLAIN by ${warrior.name}! (L${self.level} XP ${self.xp ?? 0})`);
        break;
      }
      // Re-attack every few ticks
      if (i % 4 === 0) {
        try { await api("POST", "/command", { zoneId: currentZone, entityId: warrior.id, action: "attack", targetId: bossId }); } catch {}
      }
    }
    await sleep(2000);
  }

  if (!bossSlain) {
    log(team, "QUEST", `Failed to slay ${prog.bossName} after many attempts.`);
    return false;
  }

  // Print victory lore
  console.log(`\n  ${TEAM_COLORS[team]} [${team}] 📜 ${prog.victoryLore}\n`);

  // ── TRANSITION PHASE: Lock other loops so they stop sending move commands ──
  teamTransitioning[team] = true;
  log(team, "QUEST", `🔒 Transition lock ON — pausing other loops for ${team}`);
  await sleep(3000); // Wait for in-flight loop iterations to finish

  try {
    // Update team zone FIRST so paused loops will target the new zone when they resume
    teamZones[team] = prog.nextZone;

    // Phase 2: Move warrior to portal and transition
    log(team, "QUEST", `Heading to ${prog.portalId} portal at (${prog.portalPos.x}, ${prog.portalPos.y})...`);
    await moveToInZone(warrior.id, prog.portalPos.x, prog.portalPos.y, currentZone);

    // Transition warrior with retry
    let warriorTransitioned = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await api("POST", `/transition/${currentZone}/portal/${prog.portalId}`, {
          walletAddress: WALLET, entityId: warrior.id,
        });
        log(team, "QUEST", `⚡ ${warrior.name} entered ${prog.nextZone}! (arrived at ${result.destination?.portal ?? "portal"})`);
        warriorTransitioned = true;
        break;
      } catch (err: any) {
        log(team, "QUEST", `Warrior portal attempt ${attempt}/3 failed: ${err.message?.slice(0, 80)}`);
        if (attempt < 3) {
          await moveToInZone(warrior.id, prog.portalPos.x, prog.portalPos.y, currentZone);
          await sleep(2000);
        }
      }
    }

    if (!warriorTransitioned) {
      log(team, "QUEST", `Portal transition failed after 3 attempts — aborting.`);
      teamZones[team] = currentZone; // Revert
      return false;
    }

    // Phase 3: Transition ALL other team members (except crafter — stays at forge)
    for (const agent of squad) {
      if (agent.id === warrior.id || agent.role === "CRAFTER") continue;

      let transitioned = false;
      for (let attempt = 1; attempt <= 3 && !transitioned; attempt++) {
        try {
          // Verify agent is still in the old zone before moving
          const agentState = await getEntityInZone(agent.id, currentZone);
          if (!agentState) {
            // Agent might already be in the new zone
            const inNewZone = await getEntityInZone(agent.id, prog.nextZone);
            if (inNewZone) {
              log(team, "QUEST", `${agent.name} already in ${prog.nextZone}`);
              transitioned = true;
              break;
            }
            log(team, "QUEST", `${agent.name} not found in either zone (attempt ${attempt}/3)`);
            await sleep(3000);
            continue;
          }

          await moveToInZone(agent.id, prog.portalPos.x, prog.portalPos.y, currentZone);
          await api("POST", `/transition/${currentZone}/portal/${prog.portalId}`, {
            walletAddress: WALLET, entityId: agent.id,
          });
          log(team, "QUEST", `⚡ ${agent.name} followed to ${prog.nextZone}!`);
          transitioned = true;
        } catch (err: any) {
          log(team, "QUEST", `${agent.name} transition attempt ${attempt}/3 failed: ${err.message?.slice(0, 60)}`);
          if (attempt < 3) await sleep(2000);
        }
      }
      if (!transitioned) {
        log(team, "QUEST", `⚠️ ${agent.name} stranded — could not transition after 3 attempts`);
      }
      await sleep(500);
    }

    log(team, "QUEST", `🌍 TEAM ${team} is now in ${prog.nextZone.toUpperCase()}!`);
    return true;
  } finally {
    // Always release the lock
    teamTransitioning[team] = false;
    log(team, "QUEST", `🔓 Transition lock OFF — loops resuming for ${team}`);
  }
}

/**
 * Final boss quest (no transition — just slay Necromancer Valdris)
 */
async function runFinalBossQuest(team: string): Promise<boolean> {
  const squad = teams[team];
  const warrior = squad.find((a) => a.role === "WARRIOR")!;
  const currentZone = "dark-forest";

  for (const line of FINAL_BOSS.lore) {
    console.log(`  ${TEAM_COLORS[team]} [${team}] ${line}`);
  }

  log(team, "QUEST", `Hunting ${FINAL_BOSS.bossName} (L${FINAL_BOSS.bossLevel})...`);

  for (let attempt = 0; attempt < 120; attempt++) {
    const entities = await getZoneEntitiesIn(currentZone);
    const boss = Object.entries(entities).find(
      ([_, e]: any) => e.name === FINAL_BOSS.bossName && e.hp > 0
    );

    if (!boss) {
      log(team, "QUEST", `${FINAL_BOSS.bossName} not found — waiting for respawn...`);
      await sleep(5000);
      continue;
    }

    const [bossId, bossData] = boss as [string, any];
    log(team, "QUEST", `Found ${FINAL_BOSS.bossName} L${bossData.level} (${bossData.hp}/${bossData.maxHp} HP) — THE FINAL BATTLE!`);
    await moveToInZone(warrior.id, bossData.x, bossData.y, currentZone);

    try {
      const learned = await api("GET", `/techniques/learned/${currentZone}/${warrior.id}`);
      const attacks = learned.techniques.filter((t: any) => t.type === "attack")
        .sort((a: any, b: any) => (b.effects?.damageMultiplier ?? 0) - (a.effects?.damageMultiplier ?? 0));
      if (attacks.length > 0) {
        await api("POST", "/techniques/use", { zoneId: currentZone, casterEntityId: warrior.id, techniqueId: attacks[0].id, targetEntityId: bossId });
      }
    } catch {}
    try { await api("POST", "/command", { zoneId: currentZone, entityId: warrior.id, action: "attack", targetId: bossId }); } catch {}

    for (let i = 0; i < 80; i++) {
      await sleep(800);
      const entities2 = await getZoneEntitiesIn(currentZone);
      const target = entities2[bossId];
      const self = entities2[warrior.id];
      if (!self) { log(team, "QUEST", "Warrior died! Respawning..."); await sleep(5000); break; }
      if (!target || target.hp <= 0) {
        console.log(`\n  ${TEAM_COLORS[team]} [${team}] 📜 ${FINAL_BOSS.victoryLore}\n`);
        log(team, "QUEST", `🏆 TEAM ${team} HAS CONQUERED ALL OF GENEVA! 🏆`);
        return true;
      }
      if (i % 4 === 0) {
        try { await api("POST", "/command", { zoneId: currentZone, entityId: warrior.id, action: "attack", targetId: bossId }); } catch {}
      }
    }
    await sleep(3000);
  }
  return false;
}

// =============================================================================
//  Team Definitions
// =============================================================================

const TEAM_DEFS: Record<string, Array<{
  name: string; classId: string; raceId: string; role: string; x: number; y: number;
}>> = {
  ALPHA: [
    { name: "Ironclad",    classId: "warrior", raceId: "human",  role: "WARRIOR",  x: 140, y: 145 },
    { name: "Lumina",      classId: "cleric",  raceId: "elf",    role: "CLERIC",   x: 145, y: 155 },
    { name: "Thornleaf",   classId: "ranger",  raceId: "elf",    role: "GATHERER", x: 150, y: 160 },
    { name: "Ashforge",    classId: "mage",    raceId: "dwarf",  role: "CRAFTER",  x: 155, y: 145 },
    { name: "Shadowcoin",  classId: "rogue",   raceId: "human",  role: "TRADER",   x: 160, y: 150 },
  ],
  BRAVO: [
    { name: "Grimjaw",     classId: "warrior", raceId: "dwarf",  role: "WARRIOR",  x: 200, y: 200 },
    { name: "Seraphine",   classId: "cleric",  raceId: "human",  role: "CLERIC",   x: 205, y: 210 },
    { name: "Bramblewood", classId: "ranger",  raceId: "elf",    role: "GATHERER", x: 210, y: 215 },
    { name: "Vulcanis",    classId: "mage",    raceId: "dwarf",  role: "CRAFTER",  x: 215, y: 200 },
    { name: "Goldweave",   classId: "rogue",   raceId: "human",  role: "TRADER",   x: 220, y: 205 },
  ],
};

// =============================================================================
//  Spawn & Party Formation
// =============================================================================

async function spawnTeam(teamName: string) {
  const defs = TEAM_DEFS[teamName];
  for (const def of defs) {
    const data = await api("POST", "/spawn", {
      zoneId: ZONE, type: "player", name: def.name,
      x: def.x, y: def.y, walletAddress: WALLET,
      level: 1, xp: 0, raceId: def.raceId, classId: def.classId,
    });
    teams[teamName].push({
      id: data.spawned.id, name: def.name,
      classId: def.classId, role: def.role, team: teamName,
    });
    log(teamName, def.role, `${def.name} (${def.raceId} ${def.classId}) spawned — HP ${data.spawned.hp}/${data.spawned.maxHp}`);
    await sleep(300);
  }
}

async function formTeamParty(teamName: string) {
  const squad = teams[teamName];
  const leader = squad[0];
  const party = await api("POST", "/party/create", { zoneId: ZONE, leaderId: leader.id });
  partyIds[teamName] = party.party.id;
  log(teamName, "PARTY", `${leader.name} created party`);

  for (let i = 1; i < squad.length; i++) {
    await api("POST", "/party/invite", { partyId: partyIds[teamName], invitedPlayerId: squad[i].id });
    log(teamName, "PARTY", `${squad[i].name} joined`);
    await sleep(200);
  }
}

// =============================================================================
//  Talk Quest Chain
// =============================================================================

const NPC_ROUTE = [
  { name: "Guard Captain Marcus", x: 150, y: 150 },
  { name: "Grimwald the Trader", x: 180, y: 420 },
  { name: "Bron the Blacksmith", x: 220, y: 420 },
  { name: "Thrain Ironforge - Warrior Trainer", x: 100, y: 200 },
  { name: "Herbalist Willow", x: 340, y: 420 },
  { name: "Chef Gastron", x: 460, y: 420 },
  { name: "Grizzled Miner Torvik", x: 260, y: 420 },
  { name: "Guard Captain Marcus", x: 150, y: 150 },
];

async function runTalkQuests(agent: Agent) {
  log(agent.team, agent.role, "Starting talk quest chain...");
  for (const npc of NPC_ROUTE) {
    await moveTo(agent.id, npc.x, npc.y);
    const npcId = await findEntityByName(npc.name);
    if (!npcId) continue;
    try {
      const result = await api("POST", "/quests/talk", { zoneId: ZONE, playerId: agent.id, npcEntityId: npcId });
      log(agent.team, agent.role, `Talked to ${npc.name} -> +${result.rewards?.xp ?? 0}xp +${result.rewards?.copper ?? 0}c`);
    } catch { /* done */ }
    await sleep(300);
  }
  log(agent.team, agent.role, "Quest chain complete!");
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
  log(agent.team, agent.role, "Running lore quests for weapon rewards...");
  for (const npc of LORE_NPC_ROUTE) {
    await moveTo(agent.id, npc.x, npc.y);
    const npcId = await findEntityByName(npc.name);
    if (!npcId) continue;
    for (let i = 0; i < 5; i++) {
      try {
        const result = await api("POST", "/quests/talk", { zoneId: ZONE, playerId: agent.id, npcEntityId: npcId });
        log(agent.team, agent.role, `${npc.name} -> +${result.rewards?.xp ?? 0}xp +${result.rewards?.copper ?? 0}c${result.rewards?.items?.length ? " + items!" : ""}`);
      } catch { break; }
      await sleep(300);
    }
  }
  log(agent.team, agent.role, "Lore quests complete — stronger weapons acquired!");
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
  log(agent.team, agent.role, "Running profession tutorials for XP + tools...");
  for (const npc of PROFESSION_NPC_ROUTE) {
    await moveTo(agent.id, npc.x, npc.y);
    const npcId = await findEntityByName(npc.name);
    if (!npcId) continue;
    try {
      const result = await api("POST", "/quests/talk", { zoneId: ZONE, playerId: agent.id, npcEntityId: npcId });
      log(agent.team, agent.role, `${npc.name} tutorial -> +${result.rewards?.xp ?? 0}xp +${result.rewards?.copper ?? 0}c`);
    } catch {}
    await sleep(300);
  }
  log(agent.team, agent.role, "Profession tutorials done!");
}

// =============================================================================
//  Guild DAO — Create Team Guild
// =============================================================================

const guildIds: Record<string, number> = {};

async function createTeamGuild(teamName: string) {
  const leader = teams[teamName][0];
  const guildName = teamName === "ALPHA" ? "Alpha Legion" : "Bravo Vanguard";
  log(teamName, "GUILD", `${leader.name} founding DAO "${guildName}"...`);
  try {
    const result = await api("POST", "/guild/create", {
      founderAddress: WALLET,
      name: guildName,
      description: `Team ${teamName} DAO — forged in battle, united in purpose.`,
      initialDeposit: 100,
    });
    guildIds[teamName] = result.guildId;
    log(teamName, "GUILD", `DAO "${guildName}" created! (ID: ${result.guildId}, cost: ${result.totalCost}g)`);
    try {
      await api("POST", `/guild/${result.guildId}/deposit`, { memberAddress: WALLET, amount: 50 });
      log(teamName, "GUILD", "Deposited 50g to DAO treasury");
    } catch {}
  } catch (e: any) {
    log(teamName, "GUILD", `DAO creation failed: ${e.message?.slice(0, 80)}`);
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
  log(agent.team, agent.role, "Equipping upgraded weapons from quest rewards...");
  for (const weapon of UPGRADED_WEAPONS) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: weapon.tokenId, entityId: agent.id, walletAddress: WALLET });
      log(agent.team, agent.role, `Equipped ${weapon.name}!`);
      break;
    } catch {}
  }
  for (const armor of UPGRADED_ARMOR) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: armor.tokenId, entityId: agent.id, walletAddress: WALLET });
      log(agent.team, agent.role, `Equipped ${armor.name}!`);
      break;
    } catch {}
  }
  for (const acc of UPGRADED_ACCESSORIES) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: acc.tokenId, entityId: agent.id, walletAddress: WALLET });
      log(agent.team, agent.role, `Equipped ${acc.name}!`);
      break;
    } catch {}
  }
}

// =============================================================================
//  Equip & Techniques
// =============================================================================

const STARTER_GEAR = [
  { tokenId: 2, name: "Iron Sword" }, { tokenId: 8, name: "Leather Vest" },
  { tokenId: 10, name: "Iron Helm" }, { tokenId: 12, name: "Leather Leggings" },
  { tokenId: 13, name: "Traveler Boots" }, { tokenId: 14, name: "Bronze Shoulders" },
  { tokenId: 15, name: "Padded Gloves" }, { tokenId: 16, name: "Guard Belt" },
];

async function equipGear(agent: Agent) {
  for (const gear of STARTER_GEAR) {
    try { await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: gear.tokenId, entityId: agent.id, walletAddress: WALLET }); } catch {}
    await sleep(200);
  }
  log(agent.team, agent.role, "Gear equipped");
}

async function learnAllTechniques(agent: Agent) {
  try {
    const trainers = await findEntitiesByType("trainer");
    if (trainers.length === 0) return;
    const available = await api("GET", `/techniques/available/${ZONE}/${agent.id}`);
    const toLearn = available.techniques.filter((t: any) => !t.isLearned);
    if (toLearn.length === 0) { log(agent.team, agent.role, "All techniques learned"); return; }
    for (const tech of toLearn) {
      try {
        await moveNear(agent.id, trainers[0][0]);
        await api("POST", "/techniques/learn", { zoneId: ZONE, playerEntityId: agent.id, techniqueId: tech.id, trainerEntityId: trainers[0][0] });
        log(agent.team, agent.role, `Learned ${tech.name}`);
        await sleep(300);
      } catch {}
    }
  } catch {}
}

// =============================================================================
//  ROLE: WARRIOR — Compete for strongest mob kills
// =============================================================================

async function warriorLoop(agent: Agent) {
  log(agent.team, agent.role, "Setting up skinning profession...");

  // Learn skinning
  const skinTrainers = await findEntitiesByType("profession-trainer");
  for (const [tId, trainer] of skinTrainers as Array<[string, any]>) {
    if (trainer.teachesProfession === "skinning") {
      await moveTo(agent.id, trainer.x, trainer.y);
      try {
        await api("POST", "/professions/learn", { walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, trainerId: tId, professionId: "skinning" });
        log(agent.team, agent.role, "Learned skinning");
      } catch { log(agent.team, agent.role, "Already know skinning"); }
      break;
    }
  }
  // Buy skinning knife
  try {
    await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId: 76, quantity: 1 });
    log(agent.team, agent.role, "Bought Rusty Skinning Knife");
  } catch {}

  log(agent.team, agent.role, "Starting combat patrol...");

  while (true) {
    const z = getTeamZone(agent.team);
    const me = await getEntity(agent.id, z);
    if (!me) { await sleep(3000); continue; }

    // --- TRANSITION QUEST TRIGGERS ---
    const currentLevel = me.level ?? 1;
    if (z === "village-square" && currentLevel >= 5) {
      log(agent.team, agent.role, "⚡ Level 5! The First Trial — slay the Diseased Wolf!");
      const ok = await runTransitionQuest(agent.team, 0);
      if (!ok) log(agent.team, agent.role, "Transition failed — retrying next loop");
      continue;
    }
    if (z === "wild-meadow" && currentLevel >= 10) {
      log(agent.team, agent.role, "⚡ Level 10! The Second Trial — hunt the Dire Wolf!");
      const ok = await runTransitionQuest(agent.team, 1);
      if (!ok) log(agent.team, agent.role, "Transition failed — retrying next loop");
      continue;
    }
    if (z === "dark-forest" && currentLevel >= 14) {
      log(agent.team, agent.role, "⚡ Ready for the Final Trial — Necromancer Valdris awaits!");
      const won = await runFinalBossQuest(agent.team);
      if (won) {
        banner(`🏆 TEAM ${agent.team} CONQUERED GENEVA! 🏆`);
        printScoreboard();
        return;
      }
      continue;
    }

    const hpPercent = (me.hp / me.maxHp) * 100;
    if (hpPercent < 30) {
      log(agent.team, agent.role, `Low HP (${me.hp}/${me.maxHp}) — waiting for heal...`);
      await sleep(3000);
      continue;
    }

    // Find STRONGEST mob we can fight (competitive advantage!)
    const entities = await getZoneEntities(z);
    const mobs = Object.entries(entities)
      .filter(([_, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0)
      .filter(([_, e]: any) => (e.level ?? 1) <= (me.level ?? 1) + 2) // Push limits: +2 levels
      .sort((a: any, b: any) => (b[1].level ?? 1) - (a[1].level ?? 1)); // Strongest first

    if (mobs.length === 0) { log(agent.team, agent.role, "No mobs — waiting..."); await sleep(5000); continue; }

    const [mobId, mob] = mobs[0] as [string, any];
    const mobLevel = mob.level ?? 1;
    log(agent.team, agent.role, `[${z}] Engaging ${mob.name} L${mobLevel} (${mob.hp}/${mob.maxHp} HP)`);

    await moveTo(agent.id, mob.x, mob.y, z);

    // Use strongest technique
    let usedTech = false;
    try {
      const learned = await api("GET", `/techniques/learned/${z}/${agent.id}`);
      const attacks = learned.techniques
        .filter((t: any) => t.type === "attack" && t.essenceCost <= (me.essence ?? 0))
        .sort((a: any, b: any) => (b.effects?.damageMultiplier ?? 0) - (a.effects?.damageMultiplier ?? 0));
      if (attacks.length > 0) {
        await api("POST", "/techniques/use", { zoneId: z, casterEntityId: agent.id, techniqueId: attacks[0].id, targetEntityId: mobId });
        log(agent.team, agent.role, `Used ${attacks[0].name}!`);
        usedTech = true;
      }
    } catch {}

    if (!usedTech) {
      try { await api("POST", "/command", { zoneId: z, entityId: agent.id, action: "attack", targetId: mobId }); } catch {}
    }

    // Wait for combat
    for (let i = 0; i < 40; i++) {
      await sleep(800);
      const entities = await getZoneEntities(z);
      const target = entities[mobId];
      const self = entities[agent.id];
      if (!self) { log(agent.team, agent.role, "DIED! Respawning..."); await sleep(5000); break; }
      if (!target || target.hp <= 0) {
        scores[agent.team].kills++;
        scores[agent.team].totalXp = self.xp ?? 0;
        scores[agent.team].teamLevel = self.level ?? 1;
        if (mobLevel > scores[agent.team].highestLevelKill) {
          scores[agent.team].highestLevelKill = mobLevel;
          scores[agent.team].strongestMobName = mob.name;
        }
        log(agent.team, agent.role, `Killed ${mob.name} L${mobLevel}! (L${self.level} XP ${self.xp ?? 0}) [Kills: ${scores[agent.team].kills}]`);
        // Skin the corpse for leather + raw meat
        try {
          await sleep(1500);
          const meNow = await getEntity(agent.id, z);
          const savedWeaponTokenId = meNow?.equipment?.weapon?.tokenId;
          // Swap to skinning knife
          try { await api("POST", "/equipment/unequip", { zoneId: z, slot: "weapon", entityId: agent.id, walletAddress: WALLET }); } catch {}
          await sleep(300);
          try { await api("POST", "/equipment/equip", { zoneId: z, tokenId: 76, entityId: agent.id, walletAddress: WALLET }); } catch {}
          await sleep(300);
          const corpseData = await api("GET", `/skinning/corpses/${z}`);
          const nearbyCorpses = (corpseData.corpses ?? []).filter((c: any) => {
            const cdx = c.x - mob.x; const cdy = c.y - mob.y;
            return Math.sqrt(cdx * cdx + cdy * cdy) < 60;
          });
          for (const corpse of nearbyCorpses.slice(0, 3)) {
            try {
              await moveTo(agent.id, corpse.x, corpse.y, z);
              const skinResult = await api("POST", "/skinning/harvest", { walletAddress: WALLET, zoneId: z, entityId: agent.id, corpseId: corpse.id });
              const matNames = skinResult.materials?.map((m: any) => `${m.name}×${m.quantity}`).join(", ") ?? "nothing";
              log(agent.team, agent.role, `Skinned ${corpse.name} → ${matNames}`);
            } catch {}
          }
          // Re-equip original weapon
          try { await api("POST", "/equipment/unequip", { zoneId: z, slot: "weapon", entityId: agent.id, walletAddress: WALLET }); } catch {}
          await sleep(300);
          if (savedWeaponTokenId) {
            try { await api("POST", "/equipment/equip", { zoneId: z, tokenId: savedWeaponTokenId, entityId: agent.id, walletAddress: WALLET }); } catch {}
          }
        } catch {}
        break;
      }
      // Buff mid-combat
      if (i % 5 === 0) {
        try {
          const learned = await api("GET", `/techniques/learned/${z}/${agent.id}`);
          const buffs = learned.techniques.filter((t: any) => t.type === "buff" && t.essenceCost <= (self.essence ?? 0));
          if (buffs.length > 0) {
            await api("POST", "/techniques/use", { zoneId: z, casterEntityId: agent.id, techniqueId: buffs[0].id });
            log(agent.team, agent.role, `Buffed with ${buffs[0].name}`);
          }
        } catch {}
      }
    }
    await sleep(1000);
  }
}

// =============================================================================
//  ROLE: CLERIC — Follow & Heal Warrior
// =============================================================================

async function clericLoop(agent: Agent) {
  const warrior = teams[agent.team].find((a) => a.role === "WARRIOR")!;

  // Learn cooking profession
  log(agent.team, agent.role, "Setting up cooking profession...");
  const cookTrainers = await findEntitiesByType("profession-trainer");
  for (const [tId, trainer] of cookTrainers as Array<[string, any]>) {
    if (trainer.teachesProfession === "cooking") {
      await moveTo(agent.id, trainer.x, trainer.y);
      try {
        await api("POST", "/professions/learn", { walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, trainerId: tId, professionId: "cooking" });
        log(agent.team, agent.role, "Learned cooking");
      } catch { log(agent.team, agent.role, "Already know cooking"); }
      break;
    }
  }

  // Find campfire
  const campfires = await findEntitiesByType("campfire");
  const campfireId = campfires.length > 0 ? campfires[0][0] : null;
  const campfirePos = campfires.length > 0 ? { x: (campfires[0][1] as any).x, y: (campfires[0][1] as any).y } : { x: 380, y: 580 };
  if (campfireId) log(agent.team, agent.role, `Found campfire at (${campfirePos.x}, ${campfirePos.y})`);

  // Cooking recipes from cheapest to most expensive
  const COOK_PRIORITY = ["cooked_meat", "hearty_stew", "roasted_boar", "bear_feast"];
  // Food token IDs for consuming (81=Cooked Meat, 82=Hearty Stew, 83=Roasted Boar, 84=Bear Feast)
  const FOOD_TOKENS = [84, 83, 82, 81]; // best first for consuming

  log(agent.team, agent.role, `Following and healing ${warrior.name}...`);

  let clericCycle = 0;
  while (true) {
    // Pause during zone transitions to avoid conflicting move commands
    if (teamTransitioning[agent.team]) {
      log(agent.team, agent.role, "⏸ Paused — team transitioning...");
      while (teamTransitioning[agent.team]) await sleep(1000);
      log(agent.team, agent.role, "▶ Resumed after transition");
    }

    const z = getTeamZone(agent.team);
    const wState = await getEntity(warrior.id, z);
    const cState = await getEntity(agent.id, z);
    if (!wState || !cState) { await sleep(2000); continue; }

    // Follow warrior
    const dx = wState.x - cState.x;
    const dy = wState.y - cState.y;
    if (Math.sqrt(dx * dx + dy * dy) > 25) {
      await moveTo(agent.id, wState.x - 5, wState.y - 5, z);
    }

    // Heal warrior when below 60%
    const wHpPercent = (wState.hp / wState.maxHp) * 100;
    if (wHpPercent < 60) {
      try {
        const learned = await api("GET", `/techniques/learned/${z}/${agent.id}`);
        const heals = learned.techniques
          .filter((t: any) => t.type === "healing" && t.essenceCost <= (cState.essence ?? 0))
          .sort((a: any, b: any) => (b.effects?.healAmount ?? 0) - (a.effects?.healAmount ?? 0));
        if (heals.length > 0) {
          await api("POST", "/techniques/use", { zoneId: z, casterEntityId: agent.id, techniqueId: heals[0].id, targetEntityId: warrior.id });
          log(agent.team, agent.role, `Healed ${warrior.name} with ${heals[0].name}! (was ${wHpPercent.toFixed(0)}% HP)`);
        }
      } catch {}
    }

    // Self-heal if low
    const cHpPercent = (cState.hp / cState.maxHp) * 100;
    if (cHpPercent < 50) {
      try {
        const learned = await api("GET", `/techniques/learned/${z}/${agent.id}`);
        const heals = learned.techniques.filter((t: any) => t.type === "healing" && t.essenceCost <= (cState.essence ?? 0));
        if (heals.length > 0) {
          await api("POST", "/techniques/use", { zoneId: z, casterEntityId: agent.id, techniqueId: heals[0].id, targetEntityId: agent.id });
          log(agent.team, agent.role, `Self-healed with ${heals[0].name}`);
        }
      } catch {}
    }

    // Assist in combat if warrior is healthy
    if (wHpPercent > 70 && (cState.essence ?? 0) > 30) {
      try {
        const entities = await getZoneEntities(z);
        const nearbyMobs = Object.entries(entities).filter(([_, e]: any) => {
          if (e.type !== "mob" || e.hp <= 0) return false;
          const mdx = e.x - wState.x;
          const mdy = e.y - wState.y;
          return Math.sqrt(mdx * mdx + mdy * mdy) < 50;
        });
        if (nearbyMobs.length > 0) {
          const learned = await api("GET", `/techniques/learned/${z}/${agent.id}`);
          const attacks = learned.techniques.filter((t: any) => t.type === "attack" && t.essenceCost <= (cState.essence ?? 0));
          if (attacks.length > 0) {
            await api("POST", "/techniques/use", { zoneId: z, casterEntityId: agent.id, techniqueId: attacks[0].id, targetEntityId: nearbyMobs[0][0] });
            log(agent.team, agent.role, `Smited ${(nearbyMobs[0][1] as any).name}!`);
          }
        }
      } catch {}
    }

    // --- COOKING CYCLE: Cook food + feed warrior every 8 loops ---
    // (only works in village-square where campfire exists)
    if (campfireId && z === "village-square" && clericCycle % 8 === 4) {
      log(agent.team, agent.role, "Heading to campfire to cook...");
      await moveTo(agent.id, campfirePos.x, campfirePos.y, z);
      for (const recipeId of COOK_PRIORITY) {
        try {
          const result = await api("POST", "/cooking/cook", { walletAddress: WALLET, zoneId: z, entityId: agent.id, campfireId, recipeId });
          log(agent.team, agent.role, `Cooked ${result.recipe}! (heals ${result.hpRestoration}hp)`);
        } catch {}
      }
    }

    // --- FEED WARRIOR: Consume food to restore HP when warrior is low ---
    if (wHpPercent < 50) {
      for (const foodTokenId of FOOD_TOKENS) {
        try {
          const result = await api("POST", "/cooking/consume", { walletAddress: WALLET, zoneId: z, entityId: warrior.id, foodTokenId });
          log(agent.team, agent.role, `Fed ${warrior.name} ${result.consumed}! (+${result.hpRestored}hp → ${result.currentHp}/${result.maxHp})`);
          break;
        } catch {}
      }
    }

    // --- SELF-FEED: Eat food if cleric is low ---
    if (cHpPercent < 40) {
      for (const foodTokenId of FOOD_TOKENS) {
        try {
          const result = await api("POST", "/cooking/consume", { walletAddress: WALLET, zoneId: z, entityId: agent.id, foodTokenId });
          log(agent.team, agent.role, `Ate ${result.consumed}! (+${result.hpRestored}hp → ${result.currentHp}/${result.maxHp})`);
          break;
        } catch {}
      }
    }

    clericCycle++;
    await sleep(2000);
  }
}

// =============================================================================
//  ROLE: GATHERER — Mine ore + gather herbs (rotate nodes)
// =============================================================================

async function gathererLoop(agent: Agent) {
  log(agent.team, agent.role, "Setting up gathering professions...");

  // Learn mining + herbalism
  const profTrainers = await findEntitiesByType("profession-trainer");
  for (const [tId, trainer] of profTrainers as Array<[string, any]>) {
    if (trainer.teachesProfession === "mining" || trainer.teachesProfession === "herbalism") {
      await moveTo(agent.id, trainer.x, trainer.y);
      try {
        await api("POST", "/professions/learn", { walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, trainerId: tId, professionId: trainer.teachesProfession });
        log(agent.team, agent.role, `Learned ${trainer.teachesProfession}`);
      } catch { log(agent.team, agent.role, `Already know ${trainer.teachesProfession}`); }
      await sleep(500);
    }
  }

  // Buy tools with retry
  const toolNames: Record<number, string> = { 27: "Stone Pickaxe", 41: "Basic Sickle" };
  const ownedTools = new Set<number>();
  for (const tokenId of [27, 41]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId, quantity: 1 });
        log(agent.team, agent.role, `Bought ${toolNames[tokenId]}`);
        ownedTools.add(tokenId);
        break;
      } catch (err: any) {
        log(agent.team, agent.role, `Buy ${toolNames[tokenId]} attempt ${attempt}/3 failed`);
        if (attempt < 3) await sleep(3000);
      }
    }
    await sleep(500);
  }

  async function equipTool(agentId: string, tokenId: number, toolName: string, zoneId?: string): Promise<boolean> {
    const zone = zoneId ?? ZONE;
    try { await api("POST", "/equipment/unequip", { zoneId: zone, slot: "weapon", entityId: agentId, walletAddress: WALLET }); } catch {}
    await sleep(500);
    try { await api("POST", "/equipment/equip", { zoneId: zone, tokenId, entityId: agentId, walletAddress: WALLET }); } catch (err: any) {
      log(agent.team, "GATHERER", `Failed to equip ${toolName}`);
      return false;
    }
    await sleep(300);
    const e = await getEntity(agentId, zone);
    return e?.equipment?.weapon?.tokenId === tokenId;
  }

  log(agent.team, agent.role, `Tools: ${[...ownedTools].map(t => toolNames[t]).join(", ") || "NONE"}`);

  // Tier-1 ore types that stone pickaxe can mine
  const mineableOres = new Set(["coal", "tin"]);
  // Tier-1 herbs that basic sickle can gather
  const gatherableHerbs = new Set(["Meadow Lily Patch", "Wild Rose Bush", "Clover Field", "Dandelion Cluster"]);
  // Offset for team Bravo so they don't fight for same nodes
  const teamOffset = agent.team === "BRAVO" ? 1 : 0;

  let cycle = 0;
  while (true) {
    // Pause during zone transitions to avoid conflicting move commands
    if (teamTransitioning[agent.team]) {
      log(agent.team, agent.role, "⏸ Paused — team transitioning...");
      while (teamTransitioning[agent.team]) await sleep(1000);
      log(agent.team, agent.role, "▶ Resumed after transition");
    }

    const z = getTeamZone(agent.team);
    // Prioritize mining (3 mine : 1 herb) to accumulate ore for crafting
    const doMining = cycle % 4 !== 3;

    if (doMining) {
      if (!ownedTools.has(27)) {
        try { await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId: 27, quantity: 1 }); ownedTools.add(27); } catch { cycle++; await sleep(5000); continue; }
      }
      const equipped = await equipTool(agent.id, 27, "Stone Pickaxe", z);
      if (!equipped) { cycle++; await sleep(5000); continue; }

      try {
        const nodes = await api("GET", `/mining/nodes/${z}`);
        const available = nodes.oreNodes?.filter((n: any) => !n.depleted && n.charges > 0 && mineableOres.has(n.oreType)) ?? [];
        if (available.length > 0) {
          const node = available[(cycle + teamOffset) % available.length];
          log(agent.team, agent.role, `[${z}] Mining ${node.name} (${node.oreType}) at (${node.x}, ${node.y})...`);
          await moveTo(agent.id, node.x, node.y, z);
          await sleep(500);
          try {
            const result = await api("POST", "/mining/gather", { walletAddress: WALLET, zoneId: z, entityId: agent.id, oreNodeId: node.id });
            log(agent.team, agent.role, `Mined ${result.oreName}! (dur: ${result.pickaxe?.durability}/${result.pickaxe?.maxDurability})`);
          } catch (err: any) { log(agent.team, agent.role, `Mining failed: ${err.message?.slice(0, 50)}`); }
        } else {
          log(agent.team, agent.role, "No mineable nodes — waiting for respawn...");
        }
      } catch {}
    } else {
      if (!ownedTools.has(41)) {
        try { await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId: 41, quantity: 1 }); ownedTools.add(41); } catch { cycle++; await sleep(5000); continue; }
      }
      const equipped = await equipTool(agent.id, 41, "Basic Sickle", z);
      if (!equipped) { cycle++; await sleep(5000); continue; }

      try {
        const nodes = await api("GET", `/herbalism/nodes/${z}`);
        const available = nodes.flowerNodes?.filter((n: any) => !n.depleted && n.charges > 0 && gatherableHerbs.has(n.name)) ?? [];
        if (available.length > 0) {
          const node = available[(cycle + teamOffset) % available.length];
          log(agent.team, agent.role, `[${z}] Gathering ${node.name} at (${node.x}, ${node.y})...`);
          await moveTo(agent.id, node.x, node.y, z);
          await sleep(500);
          try {
            const result = await api("POST", "/herbalism/gather", { walletAddress: WALLET, zoneId: z, entityId: agent.id, flowerNodeId: node.id });
            log(agent.team, agent.role, `Gathered ${result.flowerName}! (dur: ${result.sickle?.durability}/${result.sickle?.maxDurability})`);
          } catch (err: any) { log(agent.team, agent.role, `Gathering failed: ${err.message?.slice(0, 50)}`); }
        }
      } catch {}
    }

    cycle++;
    await sleep(4000);
  }
}

// =============================================================================
//  ROLE: CRAFTER — Forge weapons, equip warrior
// =============================================================================

async function crafterLoop(agent: Agent) {
  log(agent.team, agent.role, "Setting up blacksmithing + alchemy + leatherworking + jewelcrafting...");

  const profTrainers = await findEntitiesByType("profession-trainer");
  for (const [tId, trainer] of profTrainers as Array<[string, any]>) {
    if (["blacksmithing", "alchemy", "leatherworking", "jewelcrafting"].includes(trainer.teachesProfession)) {
      await moveTo(agent.id, trainer.x, trainer.y);
      try {
        await api("POST", "/professions/learn", { walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, trainerId: tId, professionId: trainer.teachesProfession });
        log(agent.team, agent.role, `Learned ${trainer.teachesProfession} from ${trainer.name}`);
      } catch { log(agent.team, agent.role, `Already know ${trainer.teachesProfession}`); }
      await sleep(300);
    }
  }

  // Find all crafting stations
  const forges = await findEntitiesByType("forge");
  let forgeId: string | null = null;
  let forgePos = { x: 280, y: 460 };
  if (forges.length > 0) {
    forgeId = forges[0][0];
    const forge: any = forges[0][1];
    forgePos = { x: forge.x, y: forge.y };
    log(agent.team, agent.role, `Found forge at (${forge.x}, ${forge.y})`);
  }

  const alchemyLabs = await findEntitiesByType("alchemy-lab");
  const alchemyLabId = alchemyLabs.length > 0 ? alchemyLabs[0][0] : null;
  if (alchemyLabId) log(agent.team, agent.role, "Found Mystical Cauldron for alchemy");

  const altars = await findEntitiesByType("enchanting-altar");
  const altarId = altars.length > 0 ? altars[0][0] : null;
  if (altarId) log(agent.team, agent.role, "Found Enchanter's Altar for weapon enchanting");

  const tanningRacks = await findEntitiesByType("tanning-rack");
  const tanningRackId = tanningRacks.length > 0 ? tanningRacks[0][0] : null;
  const tanningRackPos = tanningRacks.length > 0 ? { x: (tanningRacks[0][1] as any).x, y: (tanningRacks[0][1] as any).y } : { x: 480, y: 580 };
  if (tanningRackId) log(agent.team, agent.role, "Found Tanning Rack for leatherworking");

  const jewelersBenches = await findEntitiesByType("jewelers-bench");
  const jewelersBenchId = jewelersBenches.length > 0 ? jewelersBenches[0][0] : null;
  const jewelersBenchPos = jewelersBenches.length > 0 ? { x: (jewelersBenches[0][1] as any).x, y: (jewelersBenches[0][1] as any).y } : { x: 580, y: 580 };
  if (jewelersBenchId) log(agent.team, agent.role, "Found Jeweler's Workbench for jewelcrafting");

  await moveTo(agent.id, forgePos.x, forgePos.y);

  let recipes: any[] = [];
  try {
    recipes = await api("GET", "/crafting/recipes/blacksmithing");
    log(agent.team, agent.role, `Loaded ${recipes.length} recipes`);
  } catch {
    try { const all = await api("GET", "/crafting/recipes"); recipes = all.filter((r: any) => r.requiredProfession === "blacksmithing"); } catch {}
  }

  const priorityIds = ["iron-sword", "steel-longsword", "hunters-bow", "battle-axe", "oak-shield", "chainmail-shirt"];
  const prioritized = [
    ...recipes.filter((r: any) => priorityIds.includes(r.recipeId)),
    ...recipes.filter((r: any) => !priorityIds.includes(r.recipeId)),
  ];

  log(agent.team, agent.role, "Standing by at forge...");

  while (true) {
    // Pause during zone transitions to avoid conflicting move commands
    if (teamTransitioning[agent.team]) {
      log(agent.team, agent.role, "⏸ Paused — team transitioning...");
      while (teamTransitioning[agent.team]) await sleep(1000);
      log(agent.team, agent.role, "▶ Resumed after transition");
    }

    // Crafter stays in village-square; wz = warrior/gatherer's current zone (for remote equip)
    const wz = getTeamZone(agent.team);

    if (!forgeId) {
      const forges = await findEntitiesByType("forge");
      if (forges.length > 0) { forgeId = forges[0][0]; }
      await sleep(10000);
      continue;
    }

    await moveTo(agent.id, forgePos.x, forgePos.y);
    const warrior = teams[agent.team].find((a) => a.role === "WARRIOR")!;

    // --- PHASE 1: WEAPON UPGRADES (Base → Reinforced → Masterwork) ---
    const UPGRADE_PRIORITY = [
      "upgrade-battle-axe-masterwork", "upgrade-steel-longsword-masterwork",
      "upgrade-battle-axe-reinforced", "upgrade-steel-longsword-reinforced",
      "upgrade-iron-sword-masterwork", "upgrade-iron-sword-reinforced",
      "upgrade-hunters-bow-masterwork", "upgrade-hunters-bow-reinforced",
      "upgrade-apprentice-staff-masterwork", "upgrade-apprentice-staff-reinforced",
    ];
    for (const upgradeId of UPGRADE_PRIORITY) {
      try {
        const result = await api("POST", "/crafting/upgrade", {
          walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, forgeId, recipeId: upgradeId,
        });
        const upgName = result.crafted?.name ?? upgradeId;
        scores[agent.team].weaponsForged++;
        log(agent.team, agent.role, `UPGRADED to ${upgName}! [Total: ${scores[agent.team].weaponsForged}]`);
        if (result.crafted?.tokenId) {
          try {
            await api("POST", "/equipment/equip", { zoneId: wz, tokenId: Number(result.crafted.tokenId), entityId: warrior.id, walletAddress: WALLET });
            log(agent.team, agent.role, `Equipped ${upgName} on ${warrior.name}!`);
          } catch {}
        }
        break;
      } catch {}
    }

    // --- PHASE 2: FORGE NEW WEAPONS ---
    let crafted = false;
    for (const recipe of prioritized) {
      try {
        const result = await api("POST", "/crafting/forge", {
          walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, forgeId, recipeId: recipe.recipeId,
        });
        const craftedName = result.crafted?.name ?? recipe.recipeId;
        const craftedTokenId = result.crafted?.tokenId ?? recipe.outputTokenId;
        scores[agent.team].weaponsForged++;
        log(agent.team, agent.role, `FORGED ${craftedName}! [Total: ${scores[agent.team].weaponsForged}]`);
        crafted = true;
        if (craftedTokenId) {
          try {
            await api("POST", "/equipment/equip", { zoneId: wz, tokenId: Number(craftedTokenId), entityId: warrior.id, walletAddress: WALLET });
            log(agent.team, agent.role, `Equipped ${craftedName} on ${warrior.name}!`);
          } catch {}
        }
        await sleep(2000);
        break;
      } catch {}
    }

    // --- PHASE 3: BREW ENCHANTMENT ELIXIRS ---
    if (alchemyLabId) {
      await moveTo(agent.id, 360, 460);
      const ELIXIR_RECIPES = ["sharpness-elixir", "shadow-enchantment", "fire-enchantment", "lightning-enchantment"];
      for (const recipe of ELIXIR_RECIPES) {
        try {
          await api("POST", "/alchemy/brew", { walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, alchemyLabId, recipeId: recipe });
          log(agent.team, agent.role, `Brewed ${recipe}!`);
          break;
        } catch {}
      }
      // Also brew combat potions when possible
      for (const potion of ["greater-health-potion", "stamina-elixir", "elixir-of-strength"]) {
        try {
          await api("POST", "/alchemy/brew", { walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, alchemyLabId, recipeId: potion });
          log(agent.team, agent.role, `Brewed ${potion}!`);
          break;
        } catch {}
      }
    }

    // --- PHASE 4: ENCHANT WARRIOR'S WEAPON ---
    if (altarId) {
      await moveTo(agent.id, 320, 460);
      const ENCHANT_ELIXIRS = [60, 59, 55, 57]; // Sharpness +8 STR, Shadow +6 STR, Fire +5 STR, Lightning
      for (const elixirTokenId of ENCHANT_ELIXIRS) {
        try {
          await api("POST", "/enchanting/apply", {
            walletAddress: WALLET, zoneId: ZONE, entityId: warrior.id,
            altarId, enchantmentElixirTokenId: elixirTokenId, equipmentSlot: "weapon",
          });
          log(agent.team, agent.role, `Enchanted ${warrior.name}'s weapon! (+STR bonus)`);
          break;
        } catch {}
      }
    }

    // --- PHASE 5: LEATHERWORKING — Craft leather armor ---
    if (tanningRackId) {
      await moveTo(agent.id, tanningRackPos.x, tanningRackPos.y);
      const LEATHER_PRIORITY = [
        "tanned-vest", "tanned-leggings", "tanned-boots", "tanned-helm",
        "tanned-shoulders", "tanned-gloves", "tanned-belt",
        "reinforced-vest", "reinforced-leggings", "reinforced-boots",
      ];
      for (const recipeId of LEATHER_PRIORITY) {
        try {
          const result = await api("POST", "/leatherworking/craft", {
            walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, tanningRackId, recipeId,
          });
          const itemName = result.crafted?.name ?? recipeId;
          log(agent.team, agent.role, `CRAFTED leather ${itemName}!`);
          // Equip on gatherer (squishy ranger benefits from leather armor)
          const gatherer = teams[agent.team].find((a) => a.role === "GATHERER");
          if (gatherer && result.crafted?.tokenId) {
            try {
              await api("POST", "/equipment/equip", { zoneId: wz, tokenId: Number(result.crafted.tokenId), entityId: gatherer.id, walletAddress: WALLET });
              log(agent.team, agent.role, `Equipped ${itemName} on ${gatherer.name}!`);
            } catch {}
          }
          break;
        } catch {}
      }
    }

    // --- PHASE 6: JEWELCRAFTING — Craft rings & amulets ---
    if (jewelersBenchId) {
      await moveTo(agent.id, jewelersBenchPos.x, jewelersBenchPos.y);
      const JEWELRY_PRIORITY = [
        "ruby-ring", "sapphire-ring", "emerald-ring",
        "diamond-amulet", "shadow-opal-amulet", "arcane-crystal-amulet",
      ];
      for (const recipeId of JEWELRY_PRIORITY) {
        try {
          const result = await api("POST", "/jewelcrafting/craft", {
            walletAddress: WALLET, zoneId: ZONE, entityId: agent.id, jewelersBenchId, recipeId,
          });
          const itemName = result.crafted?.name ?? recipeId;
          log(agent.team, agent.role, `CRAFTED jewelry ${itemName}!`);
          // Equip on warrior for stat boosts
          if (result.crafted?.tokenId) {
            try {
              await api("POST", "/equipment/equip", { zoneId: wz, tokenId: Number(result.crafted.tokenId), entityId: warrior.id, walletAddress: WALLET });
              log(agent.team, agent.role, `Equipped ${itemName} on ${warrior.name}!`);
            } catch {}
          }
          break;
        } catch {}
      }
    }

    if (!crafted) { log(agent.team, agent.role, "Waiting for materials..."); }
    await sleep(12000);
  }
}

// =============================================================================
//  ROLE: TRADER — Buy, sell, auction
// =============================================================================

async function traderLoop(agent: Agent) {
  log(agent.team, agent.role, "Starting trade operations...");

  const merchants = await findEntitiesByType("merchant");
  if (merchants.length > 0) {
    const [merchantId, merchant] = merchants[0] as [string, any];
    log(agent.team, agent.role, `Found merchant: ${merchant.name}`);
    await moveTo(agent.id, merchant.x, merchant.y);
    try {
      const shopData = await api("GET", `/shop/npc/${ZONE}/${merchantId}`);
      log(agent.team, agent.role, `${shopData.npcName} sells ${shopData.items.length} items`);
      for (const item of shopData.items.slice(0, 2)) {
        try {
          await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId: parseInt(item.tokenId), quantity: 1 });
          scores[agent.team].itemsTraded++;
          log(agent.team, agent.role, `Bought ${item.name} for ${item.copperPrice}c`);
          await sleep(500);
        } catch {}
      }
    } catch {}
  }

  const auctioneers = await findEntitiesByType("auctioneer");
  let auctioneerInfo: { id: string; x: number; y: number; name: string } | null = null;
  if (auctioneers.length > 0) {
    const [aId, auct] = auctioneers[0] as [string, any];
    auctioneerInfo = { id: aId, x: auct.x, y: auct.y, name: auct.name };
    log(agent.team, agent.role, `Found auctioneer: ${auct.name}`);
  }

  let tradeCycle = 0;
  while (true) {
    // Pause during zone transitions to avoid conflicting move commands
    if (teamTransitioning[agent.team]) {
      log(agent.team, agent.role, "⏸ Paused — team transitioning...");
      while (teamTransitioning[agent.team]) await sleep(1000);
      log(agent.team, agent.role, "▶ Resumed after transition");
    }

    const z = getTeamZone(agent.team);

    // Re-discover auctioneer in current zone (changes after transition)
    if (!auctioneerInfo || tradeCycle % 10 === 0) {
      const zoneAuctioneers = await findEntitiesByType("auctioneer", z);
      if (zoneAuctioneers.length > 0) {
        const [aId, auct] = zoneAuctioneers[0] as [string, any];
        auctioneerInfo = { id: aId, x: auct.x, y: auct.y, name: auct.name };
      }
    }

    // Check auction house
    try {
      const auctions = await api("GET", `/auctionhouse/${z}/auctions`);
      const active = auctions.auctions?.filter((a: any) => a.status === "active") ?? [];
      if (active.length > 0) {
        log(agent.team, agent.role, `[${z}] Auction House: ${active.length} active listings`);
        for (const listing of active.slice(0, 2)) {
          try {
            await api("POST", `/auctionhouse/${z}/bid`, {
              bidderAddress: WALLET, auctionId: listing.id, bidAmount: (listing.currentBid ?? listing.startingBid) + 10,
            });
            scores[agent.team].itemsTraded++;
            log(agent.team, agent.role, `Bid on ${listing.itemName ?? `Token#${listing.tokenId}`}!`);
          } catch {}
        }
      } else {
        log(agent.team, agent.role, `[${z}] Auction House: empty`);
      }
    } catch {}

    // List items
    if (auctioneerInfo && tradeCycle % 3 === 0) {
      await moveTo(agent.id, auctioneerInfo.x, auctioneerInfo.y, z);
      const listableItems = [
        { tokenId: 22, name: "Coal Ore", startBid: 5, buyout: 15 },
        { tokenId: 23, name: "Tin Ore", startBid: 8, buyout: 20 },
        { tokenId: 31, name: "Meadow Lily", startBid: 3, buyout: 10 },
      ];
      const itemToList = listableItems[tradeCycle % listableItems.length];
      try {
        await api("POST", `/auctionhouse/${z}/create`, {
          sellerAddress: WALLET, tokenId: itemToList.tokenId, quantity: 1,
          startingBid: itemToList.startBid, buyoutPrice: itemToList.buyout,
          durationMinutes: 60, auctioneerEntityId: auctioneerInfo.id,
        });
        scores[agent.team].itemsTraded++;
        log(agent.team, agent.role, `Listed ${itemToList.name} on auction!`);
      } catch {}
    }

    // Buy from shop periodically (only in village-square where merchants are)
    if (z === "village-square" && tradeCycle % 5 === 0 && merchants.length > 0) {
      const [merchantId] = merchants[0];
      await moveTo(agent.id, (merchants[0][1] as any).x, (merchants[0][1] as any).y, z);
      try {
        const shopData = await api("GET", `/shop/npc/${z}/${merchantId}`);
        const randomItem = shopData.items[Math.floor(Math.random() * shopData.items.length)];
        if (randomItem) {
          await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId: parseInt(randomItem.tokenId), quantity: 1 });
          scores[agent.team].itemsTraded++;
          log(agent.team, agent.role, `Restocked ${randomItem.name}`);
        }
      } catch {}
    }

    tradeCycle++;
    await sleep(15000);
  }
}

// =============================================================================
//  Scoreboard Ticker
// =============================================================================

async function scoreboardTicker() {
  while (true) {
    await sleep(30000); // Print scoreboard every 30s
    printScoreboard();

    // Check for level milestones
    for (const team of ["ALPHA", "BRAVO"]) {
      const s = scores[team];
      if (s.teamLevel >= 5 && s.teamLevel % 5 === 0) {
        log(team, "MILESTONE", `${team} warrior reached Level ${s.teamLevel}!`);
      }
    }
  }
}

// =============================================================================
//  MAIN — Run both teams
// =============================================================================

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║               ⚔️  TEAM BATTLE MODE  ⚔️                   ║
║                                                          ║
║   🔴 TEAM ALPHA              🔵 TEAM BRAVO               ║
║   Ironclad    (Warrior)      Grimjaw     (Warrior)       ║
║   Lumina      (Cleric)       Seraphine   (Cleric)        ║
║   Thornleaf   (Ranger)       Bramblewood (Ranger)        ║
║   Ashforge    (Mage)         Vulcanis    (Mage)          ║
║   Shadowcoin  (Rogue)        Goldweave   (Rogue)         ║
║                                                          ║
║   GOAL: Defeat the strongest mobs, forge the best        ║
║         weapons, and dominate the auction house!          ║
║                                                          ║
║   Wallet: ${WALLET.slice(0, 10)}...                                  ║
╚══════════════════════════════════════════════════════════╝
  `);

  // Auth
  console.log("  Authenticating...\n");
  const token = await authenticateWithWallet(PRIVATE_KEY);
  api = createAuthenticatedAPI(token);

  // Spawn both teams
  banner("SPAWNING TEAMS");
  await Promise.all([spawnTeam("ALPHA"), spawnTeam("BRAVO")]);

  // Form parties
  banner("FORMING PARTIES");
  await formTeamParty("ALPHA");
  await formTeamParty("BRAVO");

  // Talk quests (all 10 agents concurrently)
  banner("SETUP: TALK QUEST CHAIN (all 10 agents)");
  await Promise.all([
    ...teams.ALPHA.map((a) => runTalkQuests(a)),
    ...teams.BRAVO.map((a) => runTalkQuests(a)),
  ]);

  // Lore quests — strong weapon rewards
  banner("SETUP: LORE QUESTS (weapon rewards)");
  await Promise.all([
    ...teams.ALPHA.map((a) => runLoreQuests(a)),
    ...teams.BRAVO.map((a) => runLoreQuests(a)),
  ]);

  // Profession tutorials — free XP + tools
  banner("SETUP: PROFESSION TUTORIALS");
  await Promise.all([
    ...teams.ALPHA.map((a) => runProfessionTutorials(a)),
    ...teams.BRAVO.map((a) => runProfessionTutorials(a)),
  ]);

  // Equip gear
  banner("SETUP: EQUIP STARTER GEAR");
  await Promise.all([
    ...teams.ALPHA.map((a) => equipGear(a)),
    ...teams.BRAVO.map((a) => equipGear(a)),
  ]);

  // Equip upgraded weapons from quest rewards
  banner("SETUP: EQUIP UPGRADED WEAPONS");
  await Promise.all([
    ...teams.ALPHA.map((a) => equipUpgradedGear(a)),
    ...teams.BRAVO.map((a) => equipUpgradedGear(a)),
  ]);

  // Learn techniques
  banner("SETUP: LEARN TECHNIQUES");
  await Promise.all([
    ...teams.ALPHA.map((a) => learnAllTechniques(a)),
    ...teams.BRAVO.map((a) => learnAllTechniques(a)),
  ]);

  // Create guild DAOs
  banner("SETUP: CREATE GUILD DAOs");
  await createTeamGuild("ALPHA");
  await sleep(1000);
  await createTeamGuild("BRAVO");

  // Print initial status
  console.log("\n  Initial Party Status:");
  for (const teamName of ["ALPHA", "BRAVO"]) {
    for (const agent of teams[teamName]) {
      const e = await getEntity(agent.id);
      if (e) {
        console.log(`  ${TEAM_COLORS[teamName]} [${agent.role.padEnd(10)}] ${agent.name} L${e.level} HP ${e.hp}/${e.maxHp}`);
      }
    }
  }

  printScoreboard();

  // BATTLE START!
  banner("⚔️  BATTLE START! BOTH TEAMS ACTIVE ⚔️");

  // Launch all 10 role loops + scoreboard ticker
  await Promise.all([
    // Team Alpha
    warriorLoop(teams.ALPHA.find((a) => a.role === "WARRIOR")!),
    clericLoop(teams.ALPHA.find((a) => a.role === "CLERIC")!),
    gathererLoop(teams.ALPHA.find((a) => a.role === "GATHERER")!),
    crafterLoop(teams.ALPHA.find((a) => a.role === "CRAFTER")!),
    traderLoop(teams.ALPHA.find((a) => a.role === "TRADER")!),
    // Team Bravo
    warriorLoop(teams.BRAVO.find((a) => a.role === "WARRIOR")!),
    clericLoop(teams.BRAVO.find((a) => a.role === "CLERIC")!),
    gathererLoop(teams.BRAVO.find((a) => a.role === "GATHERER")!),
    crafterLoop(teams.BRAVO.find((a) => a.role === "CRAFTER")!),
    traderLoop(teams.BRAVO.find((a) => a.role === "TRADER")!),
    // Scoreboard
    scoreboardTicker(),
  ]);
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
