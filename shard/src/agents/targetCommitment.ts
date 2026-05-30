// Target commitment: a tiny state machine that keeps the agent locked onto one
// combat target for a few ticks so it doesn't thrash between mobs every frame.
//
// Pulled out of AgentRunner, where it was a nullable struct plus three methods
// reaching into the runner's shared tickCounter. TTL is measured in ticks, so
// callers pass the current tick in rather than this class owning a clock.
//
// Pure state — logging stays in the caller, driven by the booleans/ids returned
// here (commit reports whether the target changed; clear returns what it freed).

export class TargetCommitment {
  private committed: { targetId: string; expiresAtTick: number } | null = null;

  /** Committed target id if still valid at `tick`, else null. Lazily clears an
   *  expired commitment as a side effect (matches the old getCommittedTargetId). */
  currentId(tick: number): string | null {
    if (!this.committed) return null;
    if (tick >= this.committed.expiresAtTick) {
      this.committed = null;
      return null;
    }
    return this.committed.targetId;
  }

  /** The committed target id without a TTL check (raw read), or null. */
  get targetId(): string | null {
    return this.committed?.targetId ?? null;
  }

  /** True if a commitment exists (ignoring TTL). */
  get active(): boolean {
    return this.committed !== null;
  }

  /** Commit to `targetId` for `ttlTicks` from `tick`. Returns true if this is a
   *  DIFFERENT target than was previously committed (so the caller can log it). */
  commit(targetId: string, tick: number, ttlTicks = 8): boolean {
    const changed = this.committed?.targetId !== targetId;
    this.committed = { targetId, expiresAtTick: tick + ttlTicks };
    return changed;
  }

  /** Release any commitment. Returns the freed target id, or null if there was
   *  nothing committed. */
  clear(): string | null {
    const released = this.committed?.targetId ?? null;
    this.committed = null;
    return released;
  }
}
