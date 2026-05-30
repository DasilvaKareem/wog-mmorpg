// Action queue: the agent's pending list of user/auto-directed scripts, plus
// the "user-driven" lock that protects freshly-queued user directives from
// being wiped by the circuit breaker / auto-progress for a short window.
//
// Pulled out of AgentRunner as PURE in-memory state. Side effects stay in the
// runner: Redis persistence, assigning the dequeued script to currentScript,
// and activity logging. The runner reads/writes this through a narrow surface
// instead of poking a bare array and a loose timestamp from ~10 call sites.

import type { BotScript } from "../types/botScriptTypes.js";

export interface ActionQueueOptions {
  /** Hard cap on queued items — extras past this are dropped. */
  max?: number;
  /** Clock source for the user lock. Defaults to Date.now; override in tests. */
  now?: () => number;
}

export class ActionQueue {
  private items: BotScript[] = [];
  private userLockUntil = 0;
  private readonly max: number;
  private readonly now: () => number;

  constructor(opts: ActionQueueOptions = {}) {
    this.max = opts.max ?? 10;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Append `scripts` to the back (optionally clearing first), capped at `max`. */
  push(scripts: BotScript[], clearExisting = false): void {
    if (clearExisting) this.items = [];
    this.items.push(...scripts);
    if (this.items.length > this.max) this.items = this.items.slice(0, this.max);
  }

  /** Remove and return the front item, or undefined when empty. */
  shift(): BotScript | undefined {
    return this.items.shift();
  }

  clear(): void {
    this.items = [];
  }

  /** A defensive copy of the queue (for persistence / display). */
  snapshot(): BotScript[] {
    return [...this.items];
  }

  /** Replace the queue wholesale (e.g. restoring from Redis on boot). */
  replace(items: BotScript[]): void {
    this.items = [...items];
  }

  // ── User-directive lock ─────────────────────────────────────────────

  /** Mark the queue user-driven for the next `ms` so autonomous logic leaves it alone. */
  lockForUser(ms: number): void {
    this.userLockUntil = this.now() + ms;
  }

  get isUserLocked(): boolean {
    return this.now() < this.userLockUntil;
  }
}
