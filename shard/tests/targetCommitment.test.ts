import assert from "node:assert/strict";

import { TargetCommitment } from "../src/agents/targetCommitment.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check("starts empty", () => {
  const tc = new TargetCommitment();
  assert.equal(tc.active, false);
  assert.equal(tc.targetId, null);
  assert.equal(tc.currentId(0), null);
});

check("commit reports whether the target changed", () => {
  const tc = new TargetCommitment();
  assert.equal(tc.commit("mob-1", 0), true, "first commit is a change");
  assert.equal(tc.commit("mob-1", 1), false, "re-committing same target is not a change");
  assert.equal(tc.commit("mob-2", 2), true, "switching target is a change");
});

check("currentId honors the tick-based TTL and clears lazily", () => {
  const tc = new TargetCommitment();
  tc.commit("mob-1", 10, 8); // expires at tick 18
  assert.equal(tc.currentId(17), "mob-1", "valid before expiry");
  assert.equal(tc.currentId(18), null, "expires at TTL boundary (tick >= expiresAtTick)");
  assert.equal(tc.active, false, "expiry lazily cleared the commitment");
});

check("targetId is a raw read independent of TTL", () => {
  const tc = new TargetCommitment();
  tc.commit("mob-1", 0, 8);
  assert.equal(tc.targetId, "mob-1");
  // raw read does not evict; currentId past TTL does
  assert.equal(tc.targetId, "mob-1");
  assert.equal(tc.currentId(100), null);
  assert.equal(tc.targetId, null, "currentId past TTL cleared it");
});

check("clear returns the freed target id, or null when empty", () => {
  const tc = new TargetCommitment();
  assert.equal(tc.clear(), null, "nothing to clear");
  tc.commit("mob-7", 0);
  assert.equal(tc.clear(), "mob-7", "returns what it freed");
  assert.equal(tc.active, false);
  assert.equal(tc.clear(), null);
});

console.log(`\ntargetCommitment: ${passed} checks passed`);
