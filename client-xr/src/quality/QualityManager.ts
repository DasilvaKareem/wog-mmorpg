/**
 * Singleton holding the resolved quality tier and config for the session.
 *
 * Resolution order: ?quality= URL param → localStorage["wog-quality-tier"]
 *  → detectTier(). Manual overrides persist across reloads.
 *
 * Live-settable values (DPR, renderScale, poll intervals) can be re-applied
 * mid-session via applyLive(); subscribers are notified so renderer/main can
 * update without a reload. antialias and asset-preload changes require a
 * page reload — UI surfaces that distinction.
 */

import { detectTier } from "./detectTier.js";
import { TIER_CONFIGS, type Tier, type TierConfig } from "./tierConfig.js";

const STORAGE_KEY = "wog-quality-tier";
const VALID_TIERS: Tier[] = ["high", "medium", "low", "potato"];

type Listener = (tier: Tier, config: TierConfig) => void;

function isValidTier(value: unknown): value is Tier {
  return typeof value === "string" && (VALID_TIERS as string[]).includes(value);
}

function readUrlOverride(): Tier | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("quality");
    return isValidTier(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readStoredOverride(): Tier | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isValidTier(raw) ? raw : null;
  } catch {
    return null;
  }
}

class QualityManagerImpl {
  private detected: Tier = "high";
  private active: Tier = "high";
  private listeners = new Set<Listener>();

  /** Resolve the boot-time tier. Must run before WebGLRenderer is created. */
  init(): { tier: Tier; config: TierConfig; detected: Tier; source: "url" | "storage" | "detected" } {
    this.detected = detectTier();
    const url = readUrlOverride();
    const stored = readStoredOverride();
    const source: "url" | "storage" | "detected" = url ? "url" : stored ? "storage" : "detected";
    this.active = url ?? stored ?? this.detected;
    return { tier: this.active, config: TIER_CONFIGS[this.active], detected: this.detected, source };
  }

  current(): Tier {
    return this.active;
  }

  detectedTier(): Tier {
    return this.detected;
  }

  config(): TierConfig {
    return TIER_CONFIGS[this.active];
  }

  /**
   * Persist a manual override. Pass null to clear (revert to detected).
   * Live-settable values take effect immediately via listeners; reload-only
   * values change the stored intent but apply on next load.
   */
  setOverride(tier: Tier | null): void {
    try {
      if (tier) localStorage.setItem(STORAGE_KEY, tier);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage may be blocked; carry on with in-memory state
    }
    const next = tier ?? this.detected;
    if (next === this.active) return;
    this.active = next;
    const cfg = this.config();
    for (const cb of this.listeners) {
      try {
        cb(this.active, cfg);
      } catch (err) {
        console.warn("[QualityManager] listener threw:", err);
      }
    }
  }

  /** Subscribe to live tier changes. Returns an unsubscribe fn. */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const QualityManager = new QualityManagerImpl();
export type { Tier, TierConfig };
