import assert from "node:assert/strict";

import { TtlMap } from "../src/agents/ttlMap.js";

function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check("has/get return live entries and evict on expiry", () => {
  const clock = makeClock();
  const m = new TtlMap<string>({ ttlMs: 1000, now: clock.now });
  m.set("a", "alpha");
  assert.equal(m.has("a"), true);
  assert.equal(m.get("a"), "alpha");
  clock.advance(999);
  assert.equal(m.get("a"), "alpha", "still live one ms before TTL");
  clock.advance(1);
  assert.equal(m.has("a"), false, "expires exactly at TTL");
  assert.equal(m.get("a"), undefined);
});

check("absent keys are falsy", () => {
  const m = new TtlMap({ ttlMs: 1000 });
  assert.equal(m.has("missing"), false);
  assert.equal(m.get("missing"), undefined);
});

check("mark returns true only when the key was not already live", () => {
  const clock = makeClock();
  const m = new TtlMap({ ttlMs: 1000, now: clock.now });
  assert.equal(m.mark("k", true), true, "first mark is new");
  assert.equal(m.mark("k", true), false, "second mark while live is not new");
  clock.advance(1000);
  assert.equal(m.mark("k", true), true, "after expiry it is new again");
});

check("set refreshes the TTL", () => {
  const clock = makeClock();
  const m = new TtlMap<number>({ ttlMs: 1000, now: clock.now });
  m.set("k", 1);
  clock.advance(900);
  m.set("k", 2); // refresh
  clock.advance(900);
  assert.equal(m.get("k"), 2, "refresh extended the lifetime past the original TTL");
});

check("per-call ttl overrides the default", () => {
  const clock = makeClock();
  const m = new TtlMap<true>({ ttlMs: 1000, now: clock.now });
  m.set("short", true, 100);
  clock.advance(150);
  assert.equal(m.has("short"), false, "short-lived entry expired on its own ttl");
});

check("delete removes immediately", () => {
  const m = new TtlMap({ ttlMs: 10_000 });
  m.set("k", true);
  m.delete("k");
  assert.equal(m.has("k"), false);
});

console.log(`\nttlMap: ${passed} checks passed`);
