import assert from "node:assert/strict";

import { ActionQueue } from "../src/agents/actionQueue.js";
import type { BotScript } from "../src/types/botScriptTypes.js";

function script(type: string, reason = ""): BotScript {
  return { type, reason } as BotScript;
}

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

check("starts empty", () => {
  const q = new ActionQueue();
  assert.equal(q.isEmpty, true);
  assert.equal(q.size, 0);
  assert.equal(q.shift(), undefined);
});

check("push appends; shift is FIFO", () => {
  const q = new ActionQueue();
  q.push([script("a"), script("b")]);
  q.push([script("c")]);
  assert.equal(q.size, 3);
  assert.equal(q.shift()?.type, "a");
  assert.equal(q.shift()?.type, "b");
  assert.equal(q.shift()?.type, "c");
  assert.equal(q.isEmpty, true);
});

check("push with clearExisting replaces the queue", () => {
  const q = new ActionQueue();
  q.push([script("a"), script("b")]);
  q.push([script("c")], true);
  assert.equal(q.size, 1);
  assert.equal(q.shift()?.type, "c");
});

check("push caps the queue at max and keeps the front", () => {
  const q = new ActionQueue({ max: 3 });
  q.push([script("a"), script("b"), script("c"), script("d"), script("e")]);
  assert.equal(q.size, 3);
  assert.deepEqual(q.snapshot().map((s) => s.type), ["a", "b", "c"]);
});

check("snapshot is a defensive copy", () => {
  const q = new ActionQueue();
  q.push([script("a")]);
  const snap = q.snapshot();
  snap.push(script("x"));
  assert.equal(q.size, 1, "mutating the snapshot does not affect the queue");
});

check("replace swaps contents wholesale (restore from persistence)", () => {
  const q = new ActionQueue();
  q.push([script("old")]);
  q.replace([script("new1"), script("new2")]);
  assert.deepEqual(q.snapshot().map((s) => s.type), ["new1", "new2"]);
});

check("clear empties the queue", () => {
  const q = new ActionQueue();
  q.push([script("a"), script("b")]);
  q.clear();
  assert.equal(q.isEmpty, true);
});

check("user lock is time-bounded by the injected clock", () => {
  const clock = makeClock();
  const q = new ActionQueue({ now: clock.now });
  assert.equal(q.isUserLocked, false);
  q.lockForUser(60_000);
  assert.equal(q.isUserLocked, true);
  clock.advance(59_999);
  assert.equal(q.isUserLocked, true);
  clock.advance(1);
  assert.equal(q.isUserLocked, false, "lock expires exactly at the window");
});

console.log(`\nactionQueue: ${passed} checks passed`);
