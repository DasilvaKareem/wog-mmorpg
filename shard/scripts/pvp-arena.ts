/**
 * PvP Arena Script — Deploy N agents, level them up, and pit them against each other.
 *
 * Usage:
 *   npx tsx scripts/pvp-arena.ts [--agents N] [--format 1v1|2v2|5v5|ffa] [--shard URL]
 *
 * Defaults: 2 agents, 1v1 format, http://localhost:3000
 */

import { Wallet } from "ethers";

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const AGENT_COUNT = Math.max(2, Number(flag("agents", "2")));
const FORMAT = flag("format", "1v1") as "1v1" | "2v2" | "5v5" | "ffa";
const SHARD = flag("shard", "http://localhost:3000").replace(/\/$/, "");

const PLAYERS_NEEDED: Record<string, number> = { "1v1": 2, "2v2": 4, "5v5": 10, ffa: 4 };
const MIN_AGENTS = PLAYERS_NEEDED[FORMAT] ?? 2;
if (AGENT_COUNT < MIN_AGENTS) {
  console.error(`❌  ${FORMAT} requires at least ${MIN_AGENTS} agents, got ${AGENT_COUNT}`);
  process.exit(1);
}

// ── Trainer positions in village-square (x, y) indexed by class ─────────
const TRAINER_POS: Record<string, { x: number; y: number }> = {
  warrior: { x: 60, y: 80 },
  paladin: { x: 200, y: 80 },
  rogue:   { x: 340, y: 80 },
  ranger:  { x: 480, y: 80 },
  mage:    { x: 60, y: 160 },
  cleric:  { x: 200, y: 160 },
  warlock: { x: 340, y: 160 },
  monk:    { x: 480, y: 160 },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
async function post(path: string, body: Record<string, unknown>, jwt?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  const res = await fetch(`${SHARD}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

async function get(path: string, jwt?: string) {
  const headers: Record<string, string> = {};
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  const res = await fetch(`${SHARD}${path}`, { headers });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function randomPick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Agent descriptor ────────────────────────────────────────────────────────
interface Agent {
  wallet: Wallet;
  address: string;
  jwt: string;
  entityId: string;
  zoneId: string;
  name: string;
  level: number;
  classId: string;
  raceId: string;
  characterTokenId: string;
}

const CLASSES = ["warrior", "mage", "ranger", "cleric", "rogue", "paladin", "warlock", "monk"];
const RACES  = ["human", "elf", "dwarf", "beastkin"];
const NAMES  = [
  "Kael", "Lyra", "Thane", "Vex", "Nyx", "Oren", "Runa", "Sable",
  "Dusk", "Ember", "Frost", "Grim", "Haze", "Ivy", "Jinx", "Knox",
  "Lux", "Mist", "Nova", "Pike", "Quill", "Rift", "Storm", "Thorn",
];

// ── Step 1: Generate wallets ────────────────────────────────────────────────
async function authenticate(wallet: Wallet): Promise<string> {
  const address = wallet.address;

  // 1a. Get challenge
  const challenge = await get(`/auth/challenge?wallet=${address}`);
  if (!challenge.message || !challenge.timestamp) {
    throw new Error(`Challenge failed for ${address}: ${JSON.stringify(challenge)}`);
  }

  // 1b. Sign challenge
  const signature = await wallet.signMessage(challenge.message);

  // 1c. Verify → JWT
  const { data } = await post("/auth/verify", {
    walletAddress: address,
    signature,
    timestamp: challenge.timestamp,
  });

  const token = data.token ?? data.access_token ?? data.accessToken ?? data.jwt;
  if (!token) throw new Error(`Auth verify failed for ${address}: ${JSON.stringify(data)}`);
  return token;
}

async function deployAgent(index: number): Promise<Agent> {
  const wallet = Wallet.createRandom();
  const address = wallet.address;
  const name = NAMES[index % NAMES.length] + (index >= NAMES.length ? `${index}` : "");
  const classId = CLASSES[index % CLASSES.length];
  const raceId = randomPick(RACES);

  console.log(`\n🎭 Agent ${index + 1}: ${name} (${raceId} ${classId}) — ${address}`);

  // Register wallet
  const reg = await post("/wallet/register", { address });
  console.log(`   💰 Wallet: ${reg.data.message ?? "registered"}`);

  // Authenticate
  const jwt = await authenticate(wallet);
  console.log(`   🔑 JWT obtained`);

  // Create character
  const char = await post("/character/create", { walletAddress: address, name, race: raceId, className: classId });
  if (char.data.error) console.log(`   ⚠️  Character: ${char.data.error}`);
  else console.log(`   📜 Character created: ${char.data.character?.name ?? name}`);

  // Fetch character to get tokenId — must be numeric for BigInt on server
  const charInfo = await get(`/character/${address}`);
  let tokenId = charInfo.characters?.[0]?.tokenId ?? "1";
  if (!/^\d+$/.test(tokenId)) tokenId = "1"; // fallback if non-numeric like "redis-0"

  // Spawn near class trainer so we can learn techniques immediately
  const trainerPos = TRAINER_POS[classId] ?? { x: 100, y: 100 };
  const spawn = await post("/spawn", {
    zoneId: "village-square",
    type: "player",
    name,
    x: trainerPos.x + 5,
    y: trainerPos.y + 5,
    walletAddress: address,
    level: 1,
    xp: 0,
    raceId,
    classId,
  }, jwt);

  const entityId = spawn.data.spawned?.id ?? spawn.data.entityId;
  const zoneId = spawn.data.zone ?? "village-square";

  if (!entityId) {
    // Might already be spawned — try to find via zone scan
    const zone = await get(`/zones/village-square`);
    const found = Object.values(zone.entities ?? {}).find(
      (e: any) => e.walletAddress?.toLowerCase() === address.toLowerCase()
    ) as any;
    if (found) {
      console.log(`   ♻️  Found existing entity: ${found.id}`);
      return { wallet, address, jwt, entityId: found.id, zoneId: "village-square", name, level: found.level ?? 1, classId, raceId, characterTokenId: tokenId };
    }
    throw new Error(`Spawn failed for ${name}: ${JSON.stringify(spawn.data)}`);
  }

  console.log(`   🌍 Spawned in ${zoneId} (entity: ${entityId})`);

  return { wallet, address, jwt, entityId, zoneId, name, level: 1, classId, raceId, characterTokenId: tokenId };
}

// ── Step 2: Learn techniques ────────────────────────────────────────────────
async function learnTechniques(agent: Agent) {
  // Find a trainer for this class in the zone
  const zone = await get(`/zones/${agent.zoneId}`);
  const entities = Object.values(zone.entities ?? {}) as any[];
  const trainer = entities.find(
    (e) => e.type === "trainer" && e.teachesClass === agent.classId
  );

  if (!trainer) {
    console.log(`   ⚠️  No ${agent.classId} trainer in ${agent.zoneId}, skipping technique learning`);
    return;
  }

  // Get available techniques
  const available = await get(`/techniques/available/${agent.zoneId}/${agent.entityId}`);
  const learnable = (available.techniques ?? []).filter(
    (t: any) => !t.isLearned && t.levelRequired <= agent.level
  );

  for (const tech of learnable.slice(0, 2)) {
    const result = await post("/techniques/learn", {
      zoneId: agent.zoneId,
      playerEntityId: agent.entityId,
      techniqueId: tech.id,
      trainerEntityId: trainer.id,
    }, agent.jwt);

    if (result.data.success) {
      console.log(`   ⚔️  Learned: ${tech.name} (${tech.copperCost}c)`);
    } else {
      console.log(`   ⚠️  ${tech.name}: ${result.data.error ?? "failed"}`);
    }
  }
}

// ── Step 3: Queue for PvP ───────────────────────────────────────────────────
async function queueForPvP(agent: Agent) {
  const tokenId = agent.characterTokenId || "1";

  const { status, data } = await post("/api/pvp/queue/join", {
    agentId: agent.entityId,
    walletAddress: agent.address,
    characterTokenId: tokenId,
    level: agent.level,
    format: FORMAT,
  }, agent.jwt);

  if (data.success) {
    console.log(`   🏟️  ${agent.name} queued for ${FORMAT} (${data.queueStatus?.playersInQueue ?? "?"} in queue)`);
  } else {
    console.log(`   ⚠️  Queue failed (${status}): ${data.error ?? JSON.stringify(data).slice(0, 200)}`);
  }
}

// ── Step 4: Wait for match and fight ────────────────────────────────────────
async function waitForBattle(agents: Agent[]): Promise<string | null> {
  console.log(`\n⏳ Waiting for matchmaker to create a battle...`);
  const agentIds = new Set(agents.map(a => a.entityId));

  for (let i = 0; i < 60; i++) {
    const { battles } = await get("/api/pvp/battles/active");
    if (battles && battles.length > 0) {
      // Find a battle that contains one of our agents
      for (const b of battles) {
        const allCombatants = [
          ...(b.teamRed ?? b.red?.players ?? []),
          ...(b.teamBlue ?? b.blue?.players ?? []),
        ];
        const hasOurs = allCombatants.some((c: any) => agentIds.has(c.agentId ?? c.id));
        if (hasOurs) {
          console.log(`🏟️  Battle found: ${b.battleId ?? b.id} (${b.format})`);
          return b.battleId ?? b.id;
        }
      }
    }
    await sleep(2000);
    if (i % 5 === 4) {
      const qs = await get(`/api/pvp/queue/status/${FORMAT}`);
      console.log(`   Queue: ${qs.playersInQueue ?? qs.count ?? "?"} players waiting...`);
    }
  }

  console.log("⚠️  No battle created after 2 minutes. The matchmaker may need more players or a tick.");
  return null;
}

// ── Step 5: Fight the battle ────────────────────────────────────────────────
async function fightBattle(battleId: string, agents: Agent[]) {
  const agentMap = new Map(agents.map(a => [a.entityId, a]));

  console.log(`\n⚔️  === BATTLE START: ${battleId} ===\n`);

  let round = 0;
  while (round < 100) {
    const state = await get(`/api/pvp/battle/${battleId}`);
    const battle = state.battle ?? state;

    if (!battle || battle.status === "completed" || battle.status === "cancelled") {
      console.log(`\n🏁 Battle ended: ${battle?.status ?? "unknown"}`);
      break;
    }

    // Gather all alive combatants from both teams
    const redTeam = battle.teamRed ?? battle.red?.players ?? [];
    const blueTeam = battle.teamBlue ?? battle.blue?.players ?? [];
    const allCombatants = [...redTeam, ...blueTeam];

    const alive = allCombatants.filter((c: any) => (c.hp ?? 0) > 0);
    const enemies = (team: any[]) => {
      const teamIds = new Set(team.map((c: any) => c.combatantId ?? c.agentId ?? c.id));
      return alive.filter((c: any) => !teamIds.has(c.combatantId ?? c.agentId ?? c.id));
    };

    // Each of our agents takes an action
    for (const combatant of alive) {
      const cId = combatant.combatantId ?? combatant.agentId ?? combatant.id;
      const agent = agentMap.get(cId);
      if (!agent) continue; // not our agent

      const isRed = redTeam.some((c: any) => (c.combatantId ?? c.agentId ?? c.id) === cId);
      const targets = enemies(isRed ? redTeam : blueTeam);
      if (targets.length === 0) continue;

      const target = targets[Math.floor(Math.random() * targets.length)];
      const targetId = target.combatantId ?? target.agentId ?? target.id;

      // Pick action: 70% attack, 20% ability, 10% defend
      const roll = Math.random();
      const actionType = roll < 0.7 ? "attack" : roll < 0.9 ? "ability" : "defend";

      const { data } = await post(`/api/pvp/battle/${battleId}/action`, {
        actorId: cId,
        type: actionType,
        targetId,
      }, agent.jwt);

      if (data.error) {
        // Battle might have ended
        if (data.error.includes("completed") || data.error.includes("not found")) break;
      }
    }

    // Print round summary
    round++;
    const freshState = await get(`/api/pvp/battle/${battleId}`);
    const fb = freshState.battle ?? freshState;

    const redHP = (fb.teamRed ?? fb.red?.players ?? []).reduce((s: number, c: any) => s + Math.max(0, c.hp ?? 0), 0);
    const blueHP = (fb.teamBlue ?? fb.blue?.players ?? []).reduce((s: number, c: any) => s + Math.max(0, c.hp ?? 0), 0);

    const redNames = (fb.teamRed ?? fb.red?.players ?? []).map((c: any) => `${c.name ?? "?"}(${Math.max(0, c.hp ?? 0)}hp)`).join(", ");
    const blueNames = (fb.teamBlue ?? fb.blue?.players ?? []).map((c: any) => `${c.name ?? "?"}(${Math.max(0, c.hp ?? 0)}hp)`).join(", ");

    console.log(`   Round ${round}: 🔴 [${redNames}] (${redHP}hp) vs 🔵 [${blueNames}] (${blueHP}hp)`);

    if (fb.status === "completed" || fb.status === "cancelled") {
      console.log(`\n🏁 Battle ended: ${fb.status}`);
      break;
    }

    await sleep(500);
  }

  // Final results
  const final = await get(`/api/pvp/battle/${battleId}`);
  const fb = final.battle ?? final;

  if (fb.result ?? fb.winner) {
    const winner = fb.result?.winner ?? fb.winner;
    console.log(`\n🏆 Winner: ${winner?.toUpperCase() ?? "unknown"}`);

    if (fb.result?.mvp ?? fb.mvp) {
      const mvp = fb.result?.mvp ?? fb.mvp;
      console.log(`⭐ MVP: ${mvp.agentId ?? mvp.name ?? "?"} — reward: ${mvp.reward ?? "100 GOLD"}`);
    }

    // Print ELO changes
    const allResults = [...(fb.result?.teamRed ?? []), ...(fb.result?.teamBlue ?? [])];
    for (const r of allResults) {
      const sign = (r.eloChange ?? 0) >= 0 ? "+" : "";
      console.log(`   ${r.walletAddress?.slice(0, 10)}... ELO: ${sign}${r.eloChange ?? 0} → ${r.newElo ?? "?"}`);
    }
  }

  // Stats
  if (fb.statistics) {
    console.log(`\n📊 Stats:`);
    console.log(`   Red damage: ${fb.statistics.teamRedDamage}, kills: ${fb.statistics.teamRedKills}`);
    console.log(`   Blue damage: ${fb.statistics.teamBlueDamage}, kills: ${fb.statistics.teamBlueKills}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏟️  PvP Arena — Deploying ${AGENT_COUNT} agents for ${FORMAT}\n`);
  console.log(`   Shard: ${SHARD}`);
  console.log(`   Format: ${FORMAT} (need ${MIN_AGENTS} players)\n`);

  // Deploy all agents
  const agents: Agent[] = [];
  for (let i = 0; i < AGENT_COUNT; i++) {
    try {
      const agent = await deployAgent(i);
      agents.push(agent);
    } catch (err: any) {
      console.error(`   ❌ Failed to deploy agent ${i + 1}: ${err.message}`);
    }
  }

  if (agents.length < MIN_AGENTS) {
    console.error(`\n❌ Only ${agents.length}/${MIN_AGENTS} agents deployed. Need at least ${MIN_AGENTS} for ${FORMAT}.`);
    process.exit(1);
  }

  console.log(`\n✅ ${agents.length} agents deployed. Learning techniques...`);

  // Learn techniques for each agent
  for (const agent of agents) {
    await learnTechniques(agent);
  }

  console.log(`\n🏟️  Queuing all agents for ${FORMAT}...`);

  // Queue everyone for PvP
  for (const agent of agents) {
    await queueForPvP(agent);
  }

  // Wait for battle
  const battleId = await waitForBattle(agents);
  if (!battleId) {
    // Try to manually check if matchmaking created one
    console.log("\n🔍 Checking active battles one more time...");
    const { battles } = await get("/api/pvp/battles/active");
    if (battles?.length > 0) {
      await fightBattle(battles[0].battleId ?? battles[0].id, agents);
    } else {
      console.log("No battles found. Try running with more agents or check matchmaker logs.");
    }
    return;
  }

  // Fight!
  await fightBattle(battleId, agents);

  // Post-battle leaderboard
  console.log(`\n📋 PvP Leaderboard:`);
  const lb = await get("/api/pvp/leaderboard?limit=10");
  if (lb.leaderboard) {
    for (const entry of lb.leaderboard.slice(0, 10)) {
      console.log(`   #${entry.rank} ${entry.name ?? entry.agentId?.slice(0, 8)} — ELO: ${entry.elo}, W/L: ${entry.wins}/${entry.losses}`);
    }
  }

  console.log("\n🎬 Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
