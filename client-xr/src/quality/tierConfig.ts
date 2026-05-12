/**
 * Per-tier quality configuration table.
 *
 * Each tier names a coherent bundle of trade-offs for renderer settings,
 * asset preload aggressiveness, polling cadence, and HUD eager-init.
 * Live-settable values can change mid-session via QualityManager.applyLive;
 * antialias and asset-preload decisions require a page reload.
 */

export type Tier = "high" | "medium" | "low" | "potato";

export interface TierConfig {
  /** WebGLRenderer antialias context flag. Requires reload to change. */
  antialias: boolean;
  /** Cap for renderer.setPixelRatio (vs window.devicePixelRatio). Live. */
  dprCap: number;
  /** EffectComposer render-target scale (1.0 = full, 0.5 = half). Live. */
  renderScale: number;
  /** Normal/depth render-target scale (often lower than renderScale). Live. */
  normalScale: number;
  /** Outline thickness uniform; compensates for renderScale downsampling. */
  outlineThickness: number;
  /** Interval between nearby-zone polls (ms). Live. */
  pollNearbyMs: number;
  /** Interval between active-players polls (ms). Live. */
  pollPlayersMs: number;
  /** Preload town props at boot. Requires reload to opt back in. */
  preloadTown: boolean;
  /**
   * Delay before NPC/armor preload kicks in (ms).
   * null = never auto-preload; load on first demand.
   * Requires reload to opt back in.
   */
  npcDeferMs: number | null;
  /** Preload player class GLBs at boot. Requires reload to opt back in. */
  preloadPlayerClassesAtBoot: boolean;
  /** Whether to eager-init the rarely-opened HUD panels at boot. */
  eagerHudInit: boolean;
}

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  high: {
    antialias: true,
    dprCap: 2.0,
    renderScale: 1.0,
    normalScale: 1.0,
    outlineThickness: 1.2,
    pollNearbyMs: 250,
    pollPlayersMs: 1000,
    preloadTown: true,
    npcDeferMs: 3000,
    preloadPlayerClassesAtBoot: true,
    eagerHudInit: true,
  },
  medium: {
    antialias: false,
    dprCap: 1.5,
    renderScale: 1.0,
    normalScale: 0.75,
    outlineThickness: 1.2,
    pollNearbyMs: 400,
    pollPlayersMs: 1500,
    preloadTown: true,
    npcDeferMs: 5000,
    preloadPlayerClassesAtBoot: true,
    eagerHudInit: true,
  },
  low: {
    antialias: false,
    dprCap: 1.5,
    renderScale: 0.9,
    normalScale: 0.75,
    outlineThickness: 1.35,
    pollNearbyMs: 750,
    pollPlayersMs: 2500,
    preloadTown: true,
    npcDeferMs: 10000,
    preloadPlayerClassesAtBoot: true,
    eagerHudInit: false,
  },
  potato: {
    antialias: false,
    dprCap: 1.25,
    renderScale: 0.75,
    normalScale: 0.6,
    outlineThickness: 1.6,
    pollNearbyMs: 1500,
    pollPlayersMs: 4000,
    preloadTown: false,
    npcDeferMs: null,
    preloadPlayerClassesAtBoot: false,
    eagerHudInit: false,
  },
};

export const TIER_LABELS: Record<Tier, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  potato: "Potato",
};

export const TIER_ORDER: Tier[] = ["high", "medium", "low", "potato"];
