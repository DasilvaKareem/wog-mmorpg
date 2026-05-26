// Single source of truth for "who is the local player".
//
// Keys identity on wallet address (immutable for a session). entityId is mutable
// because the server issues a new id on relogin (shard/src/world/spawnOrders.ts:273).
// State machine drives UI: BOOTING → SPAWNING → PRESENT ⇄ REACQUIRING → LOST.

export type PlayerSessionState =
  | "booting"
  | "spawning"
  | "present"
  | "reacquiring"
  | "lost";

export interface CharacterInfo {
  level: number;
  characterTokenId: string | null;
  agentId: string | null;
}

export interface PlayerSessionSnapshot {
  state: PlayerSessionState;
  wallet: string | null;
  entityId: string | null;
  zoneId: string | null;
  custodialWallet: string | null;
  characterInfo: CharacterInfo | null;
  lastPresentAtMs: number;
  missingSinceMs: number | null;
}

export type PlayerSessionEvent =
  | { type: "state-changed"; from: PlayerSessionState; to: PlayerSessionState }
  | { type: "entity-id-changed"; from: string | null; to: string }
  | { type: "zone-changed"; from: string | null; to: string }
  | { type: "wallet-changed"; from: string | null; to: string | null };

type Listener = (ev: PlayerSessionEvent) => void;

class PlayerSessionImpl {
  private _state: PlayerSessionState = "booting";
  private _wallet: string | null = null;
  private _entityId: string | null = null;
  private _zoneId: string | null = null;
  private _custodialWallet: string | null = null;
  private _characterInfo: CharacterInfo | null = null;
  private _lastPresentAtMs = 0;
  private _missingSinceMs: number | null = null;
  private listeners = new Set<Listener>();

  snapshot(): PlayerSessionSnapshot {
    return {
      state: this._state,
      wallet: this._wallet,
      entityId: this._entityId,
      zoneId: this._zoneId,
      custodialWallet: this._custodialWallet,
      characterInfo: this._characterInfo,
      lastPresentAtMs: this._lastPresentAtMs,
      missingSinceMs: this._missingSinceMs,
    };
  }

  get state(): PlayerSessionState { return this._state; }
  get wallet(): string | null { return this._wallet; }
  get entityId(): string | null { return this._entityId; }
  get zoneId(): string | null { return this._zoneId; }
  get custodialWallet(): string | null { return this._custodialWallet; }
  get characterInfo(): CharacterInfo | null { return this._characterInfo; }
  get missingSinceMs(): number | null { return this._missingSinceMs; }

  /** Time in ms the player has been missing from the scene (0 if present). */
  missingDurationMs(now = Date.now()): number {
    return this._missingSinceMs == null ? 0 : Math.max(0, now - this._missingSinceMs);
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(ev: PlayerSessionEvent) {
    for (const l of this.listeners) {
      try { l(ev); } catch (err) { console.error("[PlayerSession] listener error:", err); }
    }
  }

  private setState(next: PlayerSessionState) {
    if (this._state === next) return;
    const prev = this._state;
    this._state = next;
    this.emit({ type: "state-changed", from: prev, to: next });
  }

  /** Called once on app boot when wallet is known but character not yet spawned. */
  initWallet(wallet: string, custodialWallet: string | null = null) {
    const norm = wallet.toLowerCase();
    const prev = this._wallet;
    if (prev && prev !== norm) {
      console.warn("[PlayerSession] wallet changed mid-session; resetting", prev, "→", norm);
      this.reset();
    }
    this._wallet = norm;
    this._custodialWallet = custodialWallet;
    if (prev !== norm) {
      this.emit({ type: "wallet-changed", from: prev, to: norm });
    }
    if (this._state === "booting") this.setState("spawning");
  }

  /** Called when /spawn returns or auto-lock finds the live character. */
  setSpawned(entityId: string, zoneId: string, info?: CharacterInfo | null) {
    const prevEntityId = this._entityId;
    this._entityId = entityId;
    this._zoneId = zoneId;
    if (info !== undefined) this._characterInfo = info;
    if (prevEntityId !== entityId) {
      this.emit({ type: "entity-id-changed", from: prevEntityId, to: entityId });
    }
    // Don't auto-transition to PRESENT here — wait for markPresent() from EntityManager
    // confirming the entity is actually in the rendered scene.
    if (this._state === "booting" || this._state === "spawning") {
      // Stay in spawning until first markPresent.
    }
  }

  /** Called by EntityManager when own-player entity is in the current snapshot. */
  markPresent(entityId: string, zoneId: string) {
    const now = Date.now();
    this._lastPresentAtMs = now;
    this._missingSinceMs = null;

    if (this._entityId !== entityId) {
      const prev = this._entityId;
      this._entityId = entityId;
      this.emit({ type: "entity-id-changed", from: prev, to: entityId });
    }
    if (this._zoneId !== zoneId) {
      const prev = this._zoneId;
      this._zoneId = zoneId;
      this.emit({ type: "zone-changed", from: prev, to: zoneId });
    }
    this.setState("present");
  }

  /** Called by EntityManager when own-player is missing from snapshot. */
  markMissing() {
    if (this._missingSinceMs == null) this._missingSinceMs = Date.now();
    if (this._state === "present") this.setState("reacquiring");
  }

  /** Called when own-player has been missing past the recovery window. */
  markLost() {
    if (this._missingSinceMs == null) this._missingSinceMs = Date.now();
    this.setState("lost");
  }

  /** Called on zone transition (we know we're about to be missing briefly). */
  markTransitioning(targetZoneId: string) {
    if (this._zoneId !== targetZoneId) {
      const prev = this._zoneId;
      this._zoneId = targetZoneId;
      this.emit({ type: "zone-changed", from: prev, to: targetZoneId });
    }
    if (this._state === "present") this.setState("reacquiring");
  }

  /** Wipe everything (logout, wallet change, etc.). */
  reset() {
    const prevWallet = this._wallet;
    this._state = "booting";
    this._wallet = null;
    this._entityId = null;
    this._zoneId = null;
    this._custodialWallet = null;
    this._characterInfo = null;
    this._lastPresentAtMs = 0;
    this._missingSinceMs = null;
    if (prevWallet) {
      this.emit({ type: "wallet-changed", from: prevWallet, to: null });
    }
  }

  /** Update character info without changing identity (level-up, agent flip, etc.). */
  updateCharacterInfo(info: Partial<CharacterInfo>) {
    if (!this._characterInfo) {
      this._characterInfo = { level: 1, characterTokenId: null, agentId: null, ...info };
    } else {
      this._characterInfo = { ...this._characterInfo, ...info };
    }
  }
}

export const playerSession = new PlayerSessionImpl();
export type PlayerSession = PlayerSessionImpl;
