import assert from "node:assert/strict";

import { CircuitBreaker } from "../src/agents/circuitBreaker.js";

// Deterministic clock so TTL behavior is testable without real time.
function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── Failure memory ────────────────────────────────────────────────────

check("recordFailure increments count + consecutive and preserves firstAt", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({ now: clock.now });
  const a = cb.recordFailure({ key: "combat:x", reason: "no targets", endpoint: "/scan" });
  assert.equal(a.count, 1);
  assert.equal(a.consecutive, 1);
  assert.equal(a.firstAt, 1_000_000);

  clock.advance(500);
  const b = cb.recordFailure({ key: "combat:x", reason: "still none" });
  assert.equal(b.count, 2);
  assert.equal(b.consecutive, 2);
  assert.equal(b.firstAt, 1_000_000, "firstAt is preserved across failures");
  assert.equal(b.lastAt, 1_000_500);
  assert.equal(b.endpoint, "/scan", "metadata carries forward when not re-supplied");
});

check("clearFailure resets the consecutive streak but keeps lifetime count", () => {
  const cb = new CircuitBreaker();
  cb.recordFailure({ key: "k", reason: "r" });
  cb.recordFailure({ key: "k", reason: "r" });
  cb.clearFailure("k");
  const recent = cb.getRecentFailures();
  // consecutive == 0 ⇒ filtered out of getRecentFailures
  assert.equal(recent.length, 0);
  // but the entry still exists with its lifetime count
  const after = cb.recordFailure({ key: "k", reason: "r" });
  assert.equal(after.count, 3, "lifetime count survives a clear");
  assert.equal(after.consecutive, 1, "consecutive restarts at 1 after clear");
});

check("clearFailure is a no-op for empty/unknown keys", () => {
  const cb = new CircuitBreaker();
  cb.clearFailure(undefined);
  cb.clearFailure("nope");
  assert.equal(cb.getRecentFailures().length, 0);
});

check("getRecentFailures filters consecutive>0, sorts newest-first, respects limit", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({ now: clock.now });
  cb.recordFailure({ key: "a", reason: "a" });
  clock.advance(10);
  cb.recordFailure({ key: "b", reason: "b" });
  clock.advance(10);
  cb.recordFailure({ key: "c", reason: "c" });
  const recent = cb.getRecentFailures(2);
  assert.deepEqual(recent.map((e) => e.key), ["c", "b"], "newest first, limited to 2");
  // returned entries are copies — mutating must not corrupt internal state
  recent[0].count = 999;
  assert.equal([...cb.failures()].find((e) => e.key === "c")!.count, 1);
});

// ── Quest stuck (TTL) ──────────────────────────────────────────────────

check("markQuestStuck returns true only on the first flag, then false", () => {
  const cb = new CircuitBreaker();
  assert.equal(cb.markQuestStuck("q1"), true);
  assert.equal(cb.markQuestStuck("q1"), false, "already stuck ⇒ not newly stuck");
});

check("isQuestStuck honors the TTL and auto-evicts on expiry", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({ now: clock.now, stuckTtlMs: 1000 });
  cb.markQuestStuck("q1");
  assert.equal(cb.isQuestStuck("q1"), true);
  clock.advance(999);
  assert.equal(cb.isQuestStuck("q1"), true, "still stuck just before TTL");
  clock.advance(1);
  assert.equal(cb.isQuestStuck("q1"), false, "unsticks at TTL");
  // after eviction it is newly stuck again
  assert.equal(cb.markQuestStuck("q1"), true);
});

// ── Gather-node blacklist (TTL) ────────────────────────────────────────

check("gather blacklist honors its own TTL", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({ now: clock.now, blacklistTtlMs: 2000 });
  assert.equal(cb.isGatherNodeBlacklisted("n1"), false);
  cb.markGatherNodeBlacklisted("n1");
  assert.equal(cb.isGatherNodeBlacklisted("n1"), true);
  clock.advance(2000);
  assert.equal(cb.isGatherNodeBlacklisted("n1"), false);
});

// ── Death-loop guard ───────────────────────────────────────────────────

check("recordDeath counts within the window and rolls off old deaths", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({ now: clock.now, deathWindowMs: 5000 });
  assert.equal(cb.recordDeath("dark-forest"), 1);
  clock.advance(1000);
  assert.equal(cb.recordDeath("dark-forest"), 2);
  clock.advance(1000);
  assert.equal(cb.recordDeath("dark-forest"), 3, "3 deaths inside the window");
  // jump past the window — the first deaths roll off
  clock.advance(5000);
  assert.equal(cb.recordDeath("dark-forest"), 1, "stale deaths are filtered out");
});

check("death history is per-zone and clearable", () => {
  const cb = new CircuitBreaker();
  cb.recordDeath("zoneA");
  cb.recordDeath("zoneA");
  assert.equal(cb.recordDeath("zoneB"), 1, "zones are independent");
  cb.clearDeaths("zoneA");
  assert.equal(cb.recordDeath("zoneA"), 1, "cleared zone restarts at 1");
});

// ── Rescue ladder ──────────────────────────────────────────────────────

check("recordRescueAttempt returns the PRIOR count and advances the ladder", () => {
  const cb = new CircuitBreaker();
  assert.equal(cb.recordRescueAttempt("z"), 0, "first call: 0 prior attempts");
  assert.equal(cb.recordRescueAttempt("z"), 1);
  assert.equal(cb.recordRescueAttempt("z"), 2);
  assert.equal(cb.getRescueAttempts("z"), 3);
  cb.resetRescues("z");
  assert.equal(cb.getRescueAttempts("z"), 0, "reset clears the ladder");
  assert.equal(cb.recordRescueAttempt("z"), 0, "first call again after reset");
});

console.log(`\ncircuitBreaker: ${passed} checks passed`);
