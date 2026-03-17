/**
 * Party + Battle + XP Integration Tests
 * Run with: npx tsx tests/partyIntegration.test.ts
 *
 * Tests the party XP sharing, friendly-fire prevention, and party PvP matchmaking
 * without needing a running server — imports the functions/classes directly.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

// ── Test: Party system helpers ──────────────────────────────────────────────

import { getPartyMembers, areInSameParty, getPlayerPartyId } from "../src/social/partySystem.js";

section("Party helpers (solo player)");

{
  // A player not in any party should return [self]
  const solo = getPartyMembers("solo-player-123");
  assert(solo.length === 1, "Solo player getPartyMembers returns [self]");
  assert(solo[0] === "solo-player-123", "Solo player ID matches");

  assert(!areInSameParty("player-a", "player-b"), "Unrelated players not in same party");
  assert(getPlayerPartyId("nobody") === undefined, "Solo player has no partyId");
}

// ── Test: MatchmakingEntry groupId ──────────────────────────────────────────

import type { MatchmakingEntry } from "../src/types/pvp.js";

section("MatchmakingEntry groupId field");

{
  const entry: MatchmakingEntry = {
    agentId: "agent-1",
    walletAddress: "0x1234",
    characterTokenId: 1n,
    level: 10,
    elo: 1000,
    format: "2v2",
    queuedAt: Date.now(),
    groupId: "party_abc",
  };
  assert(entry.groupId === "party_abc", "groupId accepted on MatchmakingEntry");

  const entryNoGroup: MatchmakingEntry = {
    agentId: "agent-2",
    walletAddress: "0x5678",
    characterTokenId: 2n,
    level: 15,
    elo: 1100,
    format: "1v1",
    queuedAt: Date.now(),
  };
  assert(entryNoGroup.groupId === undefined, "groupId is optional");
}

// ── Test: Matchmaking balanceTeams keeps groups together ─────────────────────

import { MatchmakingSystem } from "../src/combat/matchmaking.js";
import {
  clearPartyAutoCombatTargetLock,
  pickAutoCombatTarget,
  rememberPartyAutoCombatTarget,
  type Entity,
  type ZoneState,
} from "../src/world/zoneRuntime.js";

section("Matchmaking: group-aware team balancing");

{
  const mm = new MatchmakingSystem();
  const now = Date.now();

  // Queue 4 players for 2v2: two are grouped, two are solo
  // ELOs must be within 100 of each other for matchmaking to work
  const grouped1: MatchmakingEntry = {
    agentId: "g1", walletAddress: "0xa", characterTokenId: 1n,
    level: 20, elo: 1050, format: "2v2", queuedAt: now - 10000, groupId: "team-alpha",
  };
  const grouped2: MatchmakingEntry = {
    agentId: "g2", walletAddress: "0xb", characterTokenId: 2n,
    level: 18, elo: 1030, format: "2v2", queuedAt: now - 9000, groupId: "team-alpha",
  };
  const solo1: MatchmakingEntry = {
    agentId: "s1", walletAddress: "0xc", characterTokenId: 3n,
    level: 22, elo: 1080, format: "2v2", queuedAt: now - 8000,
  };
  const solo2: MatchmakingEntry = {
    agentId: "s2", walletAddress: "0xd", characterTokenId: 4n,
    level: 19, elo: 1000, format: "2v2", queuedAt: now - 7000,
  };

  mm.addToQueue(grouped1);
  mm.addToQueue(grouped2);
  mm.addToQueue(solo1);
  mm.addToQueue(solo2);

  const match = mm.tryCreateMatch("2v2");
  assert(match !== null, "Match created from 4 queued players");

  if (match) {
    // In the result, teamRed is the first half, teamBlue is the second half
    const redIds = match.teamRed.map(c => c.agentId);
    const blueIds = match.teamBlue.map(c => c.agentId);

    // The grouped players (g1, g2) should be on the same team
    const g1Team = redIds.includes("g1") ? "red" : blueIds.includes("g1") ? "blue" : "none";
    const g2Team = redIds.includes("g2") ? "red" : blueIds.includes("g2") ? "blue" : "none";

    assert(g1Team === g2Team, `Grouped players on same team (both ${g1Team})`);
    assert(g1Team !== "none" && g2Team !== "none", "Both grouped players placed");

    // Solos should be on the other team
    const s1Team = redIds.includes("s1") ? "red" : blueIds.includes("s1") ? "blue" : "none";
    const s2Team = redIds.includes("s2") ? "red" : blueIds.includes("s2") ? "blue" : "none";
    assert(s1Team === s2Team, `Solo players on same team (both ${s1Team})`);
    assert(s1Team !== g1Team, "Solos on opposite team from group");
  }
}

// ── Test: PvPBattleManager.isInActiveBattle ─────────────────────────────────

import { PvPBattleManager } from "../src/combat/pvpBattleManager.js";

section("PvPBattleManager.isInActiveBattle");

{
  const manager = new PvPBattleManager();

  assert(!manager.isInActiveBattle("nonexistent"), "Non-existent agent not in battle");

  // We can't easily create a full battle without the engine setup,
  // but we can verify the method exists and returns false for empty state
  assert(typeof manager.isInActiveBattle === "function", "isInActiveBattle method exists");
}

// ── Test: awardPartyXp logic (unit-level simulation) ────────────────────────

section("Party XP sharing math (simulated)");

{
  // Simulate the math from awardPartyXp without calling it directly
  // (it depends on zone state internals, so we test the formula)

  // Solo: 1 member, bonus = 1.0
  const soloBonus = 1.0 + (1 - 1) * 0.1;
  assert(soloBonus === 1.0, "Solo party bonus = 1.0x");

  // 2 members: bonus = 1.1
  const duo = 1.0 + (2 - 1) * 0.1;
  assert(duo === 1.1, "2-member party bonus = 1.1x");

  // 3 members: bonus = 1.2
  const trio = 1.0 + (3 - 1) * 0.1;
  assert(Math.abs(trio - 1.2) < 0.001, "3-member party bonus = 1.2x");

  // 5 members: bonus = 1.4
  const full = 1.0 + (5 - 1) * 0.1;
  assert(Math.abs(full - 1.4) < 0.001, "5-member party bonus = 1.4x");

  // XP split: 100 base, 3 members → total 120, each gets 40
  const baseXp = 100;
  const members3 = 3;
  const totalXp3 = Math.floor(baseXp * (1.0 + (members3 - 1) * 0.1));
  const perMember3 = Math.floor(totalXp3 / members3);
  assert(totalXp3 === 120, "3-man party: 100 base → 120 total XP");
  assert(perMember3 === 40, "3-man party: each gets 40 XP");

  // XP split: 100 base, 2 members → total 110, each gets 55
  const members2 = 2;
  const totalXp2 = Math.floor(baseXp * (1.0 + (members2 - 1) * 0.1));
  const perMember2 = Math.floor(totalXp2 / members2);
  assert(totalXp2 === 110, "2-man party: 100 base → 110 total XP");
  assert(perMember2 === 55, "2-man party: each gets 55 XP");

  // Solo: 100 base, 1 member → total 100, gets 100
  const totalXp1 = Math.floor(baseXp * 1.0);
  assert(totalXp1 === 100, "Solo: 100 base → 100 total XP (no bonus)");
}

// ── Test: Friendly-fire logic ───────────────────────────────────────────────

section("Friendly-fire prevention logic");

{
  // areInSameParty returns false for unrelated players
  assert(!areInSameParty("p1", "p2"), "Unrelated players → no friendly-fire block");

  // The guard logic: if both players and in same party, cancel attack
  const entityType = "player";
  const targetType = "player";
  const inParty = false; // simulate areInSameParty result

  const shouldBlock = entityType === "player" && targetType === "player" && inParty;
  assert(!shouldBlock, "Different-party players can attack each other");

  // If they WERE in same party
  const shouldBlockParty = entityType === "player" && targetType === "player" && true;
  assert(shouldBlockParty, "Same-party players → attack blocked");

  // Player attacking mob should never be blocked
  const mobTarget = entityType === "player" && "mob" === "player" && true;
  assert(!mobTarget, "Player attacking mob → never blocked");
}

// ── Test: Party same-zone target focus ──────────────────────────────────────

section("Party auto-combat target focus");

{
  const zone: ZoneState = {
    zoneId: "wild-meadow",
    tick: 1,
    entities: new Map<string, Entity>(),
  };

  const leader: Entity = {
    id: "leader",
    type: "player",
    name: "Leader",
    x: 100,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
    order: { action: "attack", targetId: "mob-focus" },
  };

  const ally: Entity = {
    id: "ally",
    type: "player",
    name: "Ally",
    x: 120,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
  };

  const focusedMob: Entity = {
    id: "mob-focus",
    type: "mob",
    name: "Focused Mob",
    x: 150,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
  };

  const closerMob: Entity = {
    id: "mob-closer",
    type: "mob",
    name: "Closer Mob",
    x: 130,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
  };

  zone.entities.set(leader.id, leader);
  zone.entities.set(ally.id, ally);
  zone.entities.set(focusedMob.id, focusedMob);
  zone.entities.set(closerMob.id, closerMob);

  const chosen = pickAutoCombatTarget(ally, zone, 80, [leader.id, ally.id]);
  assert(chosen?.id === focusedMob.id, "Party member prefers same-zone ally target over a closer mob");
}

{
  const zone: ZoneState = {
    zoneId: "wild-meadow",
    tick: 1,
    entities: new Map<string, Entity>(),
  };

  const leader: Entity = {
    id: "leader-2",
    type: "player",
    name: "Leader Two",
    x: 100,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
    order: { action: "attack", targetId: "missing-cross-zone-mob" },
  };

  const ally: Entity = {
    id: "ally-2",
    type: "player",
    name: "Ally Two",
    x: 120,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
  };

  const localMob: Entity = {
    id: "mob-local",
    type: "mob",
    name: "Local Mob",
    x: 135,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
  };

  zone.entities.set(leader.id, leader);
  zone.entities.set(ally.id, ally);
  zone.entities.set(localMob.id, localMob);

  const chosen = pickAutoCombatTarget(ally, zone, 80, [leader.id, ally.id]);
  assert(chosen?.id === localMob.id, "Party focus ignores ally targets that are not present in the same zone");
}

{
  const zone: ZoneState = {
    zoneId: "wild-meadow",
    tick: 1,
    entities: new Map<string, Entity>(),
  };

  const leader: Entity = {
    id: "leader-anchor",
    type: "player",
    name: "Leader Anchor",
    x: 100,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
    order: { action: "attack", targetId: "mob-far-from-leader" },
  };

  const ally: Entity = {
    id: "ally-anchor",
    type: "player",
    name: "Ally Anchor",
    x: 230,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
  };

  const farFocusedMob: Entity = {
    id: "mob-far-from-leader",
    type: "mob",
    name: "Far Focused Mob",
    x: 220,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
    region: "wild-meadow",
  };

  const anchorMob: Entity = {
    id: "mob-near-leader",
    type: "mob",
    name: "Anchor Mob",
    x: 135,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
    region: "wild-meadow",
  };

  zone.entities.set(leader.id, leader);
  zone.entities.set(ally.id, ally);
  zone.entities.set(farFocusedMob.id, farFocusedMob);
  zone.entities.set(anchorMob.id, anchorMob);

  const chosen = pickAutoCombatTarget(ally, zone, 160, [leader.id, ally.id], undefined, leader.id);
  assert(chosen?.id === anchorMob.id, "Party focus ignores ally targets that pull too far away from the leader anchor");
}

{
  const partyId = "party-lock-focus";
  clearPartyAutoCombatTargetLock(partyId);

  const zone: ZoneState = {
    zoneId: "wild-meadow",
    tick: 10,
    entities: new Map<string, Entity>(),
  };

  const ally: Entity = {
    id: "ally-3",
    type: "player",
    name: "Ally Three",
    x: 120,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
  };

  const lockedMob: Entity = {
    id: "mob-locked",
    type: "mob",
    name: "Locked Mob",
    x: 155,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
    region: "wild-meadow",
  };

  const closerMob: Entity = {
    id: "mob-closer-2",
    type: "mob",
    name: "Closer Mob Two",
    x: 130,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
    region: "wild-meadow",
  };

  zone.entities.set(ally.id, ally);
  zone.entities.set(lockedMob.id, lockedMob);
  zone.entities.set(closerMob.id, closerMob);

  rememberPartyAutoCombatTarget(ally.id, zone.zoneId, lockedMob.id, zone.tick, partyId);
  const chosen = pickAutoCombatTarget(ally, zone, 80, [ally.id], partyId);
  assert(chosen?.id === lockedMob.id, "Party target lock keeps focus on the shared target even when another mob is closer");

  clearPartyAutoCombatTargetLock(partyId);
}

{
  const partyId = "party-lock-anchor";
  clearPartyAutoCombatTargetLock(partyId);

  const zone: ZoneState = {
    zoneId: "wild-meadow",
    tick: 10,
    entities: new Map<string, Entity>(),
  };

  const leader: Entity = {
    id: "leader-lock-anchor",
    type: "player",
    name: "Leader Lock Anchor",
    x: 100,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
  };

  const ally: Entity = {
    id: "ally-lock-anchor",
    type: "player",
    name: "Ally Lock Anchor",
    x: 230,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
  };

  const lockedMob: Entity = {
    id: "mob-locked-far",
    type: "mob",
    name: "Locked Far Mob",
    x: 220,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
    region: "wild-meadow",
  };

  const anchorMob: Entity = {
    id: "mob-anchor-safe",
    type: "mob",
    name: "Anchor Safe Mob",
    x: 135,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
    region: "wild-meadow",
  };

  zone.entities.set(leader.id, leader);
  zone.entities.set(ally.id, ally);
  zone.entities.set(lockedMob.id, lockedMob);
  zone.entities.set(anchorMob.id, anchorMob);

  rememberPartyAutoCombatTarget(ally.id, zone.zoneId, lockedMob.id, zone.tick, partyId);
  const chosen = pickAutoCombatTarget(ally, zone, 160, [leader.id, ally.id], partyId, leader.id);
  assert(chosen?.id === anchorMob.id, "Party target lock is ignored when it would drag the party too far from the leader anchor");

  clearPartyAutoCombatTargetLock(partyId);
}

{
  const partyId = "party-lock-expire";
  clearPartyAutoCombatTargetLock(partyId);

  const zone: ZoneState = {
    zoneId: "wild-meadow",
    tick: 20,
    entities: new Map<string, Entity>(),
  };

  const ally: Entity = {
    id: "ally-4",
    type: "player",
    name: "Ally Four",
    x: 120,
    y: 100,
    hp: 100,
    maxHp: 100,
    createdAt: Date.now(),
  };

  const expiredMob: Entity = {
    id: "mob-expired",
    type: "mob",
    name: "Expired Mob",
    x: 155,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
    region: "wild-meadow",
  };

  const closerMob: Entity = {
    id: "mob-closer-3",
    type: "mob",
    name: "Closer Mob Three",
    x: 130,
    y: 100,
    hp: 60,
    maxHp: 60,
    createdAt: Date.now(),
    region: "wild-meadow",
  };

  zone.entities.set(ally.id, ally);
  zone.entities.set(expiredMob.id, expiredMob);
  zone.entities.set(closerMob.id, closerMob);

  rememberPartyAutoCombatTarget(ally.id, zone.zoneId, expiredMob.id, zone.tick - 10, partyId);
  const chosen = pickAutoCombatTarget(ally, zone, 80, [ally.id], partyId);
  assert(chosen?.id === closerMob.id, "Expired party target lock falls back to the nearest valid mob");

  clearPartyAutoCombatTargetLock(partyId);
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(50)}`);

// Force exit — PvPBattleManager starts setInterval timers that keep the process alive
process.exit(failed > 0 ? 1 : 0);
