import assert from "node:assert/strict";

import { activeZoneSet } from "../src/world/activeZones.js";

// Fake walkable-neighbor graph:  A — B — C — D  (linear),  E isolated.
const NEIGHBORS: Record<string, string[]> = {
  A: ["B"],
  B: ["A", "C"],
  C: ["B", "D"],
  D: ["C"],
  E: [],
};
const getNeighbors = (z: string) => NEIGHBORS[z] ?? [];

function setOf(s: Set<string>): string[] {
  return [...s].sort();
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check("a player's zone and its walkable neighbors are active", () => {
  assert.deepEqual(setOf(activeZoneSet(["A"], getNeighbors)), ["A", "B"]);
});

check("zones that are neither occupied nor bordering a player are dormant", () => {
  const active = activeZoneSet(["A"], getNeighbors);
  assert.equal(active.has("C"), false);
  assert.equal(active.has("D"), false);
  assert.equal(active.has("E"), false);
});

check("neighbor expansion is NOT transitive (neighbor-of-neighbor stays dormant)", () => {
  // A active → B active (neighbor). C is B's neighbor but B was only added as a
  // neighbor, not expanded, so C must remain dormant.
  const active = activeZoneSet(["A"], getNeighbors);
  assert.equal(active.has("C"), false);
});

check("multiple players in different zones each wake their zone + neighbors", () => {
  assert.deepEqual(setOf(activeZoneSet(["A", "C"], getNeighbors)), ["A", "B", "C", "D"]);
});

check("duplicate player regions are deduped (same result as one)", () => {
  assert.deepEqual(
    setOf(activeZoneSet(["A", "A", "A"], getNeighbors)),
    setOf(activeZoneSet(["A"], getNeighbors)),
  );
});

check("an isolated zone with a player is active with no neighbors", () => {
  assert.deepEqual(setOf(activeZoneSet(["E"], getNeighbors)), ["E"]);
});

check("no players ⇒ no active zones", () => {
  assert.equal(activeZoneSet([], getNeighbors).size, 0);
});

check("falsy/empty regions are ignored", () => {
  assert.deepEqual(setOf(activeZoneSet(["", "A"], getNeighbors)), ["A", "B"]);
});

console.log(`\nactiveZones: ${passed} checks passed`);
