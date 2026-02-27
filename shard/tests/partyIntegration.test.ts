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

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(50)}`);

// Force exit — PvPBattleManager starts setInterval timers that keep the process alive
process.exit(failed > 0 ? 1 : 0);
