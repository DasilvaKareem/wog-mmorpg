// A small key→value map whose entries expire after a TTL.
//
// The agent runtime had this exact idiom hand-rolled in several places (stuck
// quests, gather-node blacklist, learn-profession cooldowns): a Map<string,
// number> of expiry timestamps with copy-pasted "get, compare to Date.now(),
// delete if expired" logic. Each copy was a place to get the comparison or the
// eviction subtly wrong. This consolidates it into one tested primitive with an
// injectable clock.

export interface TtlMapOptions {
  /** Default lifetime for entries (ms). Can be overridden per set/mark call. */
  ttlMs: number;
  /** Clock source. Defaults to Date.now; override for deterministic tests. */
  now?: () => number;
}

export class TtlMap<V = true> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(opts: TtlMapOptions) {
    this.defaultTtlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  /** Return the live entry, evicting it first if it has expired. */
  private live(key: string): { value: V; expiresAt: number } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Is there a live (non-expired) entry for `key`? Evicts on expiry. */
  has(key: string): boolean {
    return this.live(key) !== undefined;
  }

  /** The live value for `key`, or undefined if absent/expired. Evicts on expiry. */
  get(key: string): V | undefined {
    return this.live(key)?.value;
  }

  /** Insert/refresh `key` for `ttlMs` (default from options). */
  set(key: string, value: V, ttlMs = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /** Like set, but returns true if `key` was NOT already live — useful for
   *  "do this only the first time we flag it" transitions. */
  mark(key: string, value: V, ttlMs = this.defaultTtlMs): boolean {
    const wasLive = this.has(key);
    this.set(key, value, ttlMs);
    return !wasLive;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
