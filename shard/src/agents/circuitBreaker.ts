// Circuit breaker: the agent's failure-tracking state machine.
//
// Pulled out of AgentRunner, where five interlocking Maps (failure memory,
// stuck quests, gather-node blacklist, per-zone death history, per-zone rescue
// counters) were mutated from a dozen methods with implicit invariants between
// them. Consolidating them here makes those invariants enforceable in one place
// and unit-testable in isolation.
//
// This class is PURE STATE — no logging, chat, config writes, or other I/O.
// Methods return values (e.g. `markQuestStuck` returns whether the quest was
// newly flagged) so the runner keeps the side effects. The clock is injected so
// TTL behavior is deterministic under test.

import type { FailureCategory, FailureMemoryEntry } from "./agentUtils.js";
import { TtlMap } from "./ttlMap.js";

export interface CircuitBreakerOptions {
  /** Clock source. Defaults to Date.now; override for deterministic tests. */
  now?: () => number;
  /** How long a quest stays flagged stuck (ms). */
  stuckTtlMs?: number;
  /** How long a gather node stays blacklisted (ms). */
  blacklistTtlMs?: number;
  /** Rolling window for the per-zone death-loop guard (ms). */
  deathWindowMs?: number;
}

const FIVE_MIN = 5 * 60_000;

export interface RecordFailureArgs {
  key: string;
  reason: string;
  scriptType?: string;
  endpoint?: string;
  targetId?: string;
  targetName?: string;
  category?: FailureCategory;
}

export class CircuitBreaker {
  private readonly now: () => number;
  private readonly stuckTtlMs: number;
  private readonly blacklistTtlMs: number;
  private readonly deathWindowMs: number;

  /** Failure history keyed by an action-specific key (e.g. "combat:no-targets:dark-forest"). */
  private readonly failureMemory = new Map<string, FailureMemoryEntry>();
  /** Quests flagged stuck, auto-expiring after stuckTtlMs. */
  private readonly stuckQuests: TtlMap;
  /** Gather nodes blacklisted, auto-expiring after blacklistTtlMs. */
  private readonly gatherNodeBlacklist: TtlMap;
  /** zone → recent death timestamps (within deathWindowMs). */
  private readonly recentDeathsByZone = new Map<string, number[]>();
  /** zone → cumulative rescue-ladder attempt count. */
  private readonly rescueAttemptByZone = new Map<string, number>();
  /** zone → epoch ms of the most recent rescue attempt. Currently write-only;
   *  reserved for "same-zone rescue within 30s ⇒ escalate" detection. */
  private readonly lastRescueByZone = new Map<string, number>();

  constructor(opts: CircuitBreakerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.stuckTtlMs = opts.stuckTtlMs ?? FIVE_MIN;
    this.blacklistTtlMs = opts.blacklistTtlMs ?? FIVE_MIN;
    this.deathWindowMs = opts.deathWindowMs ?? FIVE_MIN;
    this.stuckQuests = new TtlMap({ ttlMs: this.stuckTtlMs, now: this.now });
    this.gatherNodeBlacklist = new TtlMap({ ttlMs: this.blacklistTtlMs, now: this.now });
  }

  // ── Failure memory ──────────────────────────────────────────────────

  /** Record one failure for `key`, bumping count + consecutive streak. Returns
   *  the updated entry. Telemetry is the caller's concern — derive it from the
   *  returned entry. */
  recordFailure(args: RecordFailureArgs): FailureMemoryEntry {
    const now = this.now();
    const existing = this.failureMemory.get(args.key);
    const next: FailureMemoryEntry = {
      key: args.key,
      reason: args.reason,
      count: (existing?.count ?? 0) + 1,
      consecutive: (existing?.consecutive ?? 0) + 1,
      firstAt: existing?.firstAt ?? now,
      lastAt: now,
      scriptType: args.scriptType ?? existing?.scriptType,
      endpoint: args.endpoint ?? existing?.endpoint,
      targetId: args.targetId ?? existing?.targetId,
      targetName: args.targetName ?? existing?.targetName,
      category: args.category ?? existing?.category,
    };
    this.failureMemory.set(args.key, next);
    return next;
  }

  /** Reset the consecutive streak for `key` (the action finally succeeded), but
   *  keep its lifetime count + metadata. No-op for unknown/empty keys. */
  clearFailure(key: string | undefined): void {
    if (!key) return;
    const existing = this.failureMemory.get(key);
    if (!existing) return;
    this.failureMemory.set(key, { ...existing, consecutive: 0, lastAt: this.now() });
  }

  /** Most-recently-failing entries with a live streak, newest first (copies). */
  getRecentFailures(limit = 6): FailureMemoryEntry[] {
    return [...this.failureMemory.values()]
      .filter((entry) => entry.consecutive > 0)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }

  /** Live view of all failure entries (for scanning, e.g. handleActionResult). */
  failures(): IterableIterator<FailureMemoryEntry> {
    return this.failureMemory.values();
  }

  // ── Quest stuck (TTL) ───────────────────────────────────────────────

  isQuestStuck(questId: string): boolean {
    return this.stuckQuests.has(questId);
  }

  /** Flag a quest stuck for stuckTtlMs. Returns true if it was NOT already
   *  flagged (so the caller can log only on the transition). */
  markQuestStuck(questId: string): boolean {
    return this.stuckQuests.mark(questId, true);
  }

  // ── Gather-node blacklist (TTL) ─────────────────────────────────────

  isGatherNodeBlacklisted(nodeId: string): boolean {
    return this.gatherNodeBlacklist.has(nodeId);
  }

  markGatherNodeBlacklisted(nodeId: string): void {
    this.gatherNodeBlacklist.set(nodeId, true);
  }

  // ── Death-loop guard ────────────────────────────────────────────────

  /** Record a death in `zone` and return how many deaths have occurred there
   *  within the rolling window (including this one). */
  recordDeath(zone: string): number {
    const now = this.now();
    const deaths = (this.recentDeathsByZone.get(zone) ?? []).filter((t) => now - t < this.deathWindowMs);
    deaths.push(now);
    this.recentDeathsByZone.set(zone, deaths);
    return deaths.length;
  }

  /** Forget `zone`'s death history (e.g. after forcing idle to break the loop). */
  clearDeaths(zone: string): void {
    this.recentDeathsByZone.delete(zone);
  }

  // ── Rescue ladder counters ──────────────────────────────────────────

  /** Advance the rescue ladder for `zone`. Returns the count of PRIOR attempts
   *  (0 on the first call), matching "read-then-increment" semantics so the
   *  caller can pick the next rung. Also stamps the last-rescue time. */
  recordRescueAttempt(zone: string): number {
    const prior = this.rescueAttemptByZone.get(zone) ?? 0;
    this.rescueAttemptByZone.set(zone, prior + 1);
    this.lastRescueByZone.set(zone, this.now());
    return prior;
  }

  getRescueAttempts(zone: string): number {
    return this.rescueAttemptByZone.get(zone) ?? 0;
  }

  /** Reset the rescue ladder for `zone` (agent escaped, or zone changed). */
  resetRescues(zone: string): void {
    this.rescueAttemptByZone.delete(zone);
  }
}
