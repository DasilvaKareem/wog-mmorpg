// Local-only sound effects for client-xr.
// IMPORTANT: SFX are played *only* on the current player's window.
// Never route these through the shard, WebSocket, or any network channel —
// remote players must not hear our local clicks/combat/movement sounds.

export const SOUND_EFFECT_EVENT = "wog:play-sfx";
export const SOUND_TOGGLE_EVENT = "wog:sound-toggle";
const SOUND_ENABLED_KEY = "wog-sound-enabled";

export type SoundEffectId =
  | "ui_button_hover"
  | "ui_button_click"
  | "ui_dialog_open"
  | "ui_dialog_close"
  | "ui_tab_switch"
  | "ui_map_open"
  | "ui_notification"
  | "ui_item_pickup"
  | "ui_item_drop"
  | "ui_level_up"
  | "combat_melee_hit"
  | "combat_melee_miss"
  | "combat_ranged_hit"
  | "combat_ranged_miss"
  | "combat_defend"
  | "combat_flee"
  | "combat_battle_start"
  | "combat_victory"
  | "move_zone_transition";

type SoundEffectConfig = {
  category: "ui" | "combat" | "movement";
  path: string;
  volume: number;
};

const SOUND_EFFECTS: Record<SoundEffectId, SoundEffectConfig> = {
  ui_button_hover:     { category: "ui",       path: "sfx/ui/ui_button_hover",             volume: 0.10 },
  ui_button_click:     { category: "ui",       path: "sfx/ui/ui_button_click",             volume: 0.15 },
  ui_dialog_open:      { category: "ui",       path: "sfx/ui/ui_dialog_open",              volume: 0.15 },
  ui_dialog_close:     { category: "ui",       path: "sfx/ui/ui_dialog_close",             volume: 0.15 },
  ui_tab_switch:       { category: "ui",       path: "sfx/ui/ui_tab_switch",               volume: 0.15 },
  ui_map_open:         { category: "ui",       path: "sfx/ui/ui_map_open",                 volume: 0.15 },
  ui_notification:     { category: "ui",       path: "sfx/ui/ui_notification",             volume: 0.12 },
  ui_item_pickup:      { category: "ui",       path: "sfx/ui/ui_item_pickup",              volume: 0.15 },
  ui_item_drop:        { category: "ui",       path: "sfx/ui/ui_item_drop",                volume: 0.15 },
  ui_level_up:         { category: "ui",       path: "sfx/ui/ui_level_up",                 volume: 0.20 },
  combat_melee_hit:    { category: "combat",   path: "sfx/combat/combat_melee_hit",        volume: 0.30 },
  combat_melee_miss:   { category: "combat",   path: "sfx/combat/combat_melee_miss",       volume: 0.25 },
  combat_ranged_hit:   { category: "combat",   path: "sfx/combat/combat_ranged_hit",       volume: 0.30 },
  combat_ranged_miss:  { category: "combat",   path: "sfx/combat/combat_ranged_miss",      volume: 0.25 },
  combat_defend:       { category: "combat",   path: "sfx/combat/combat_defend",           volume: 0.30 },
  combat_flee:         { category: "combat",   path: "sfx/combat/combat_flee",             volume: 0.25 },
  combat_battle_start: { category: "combat",   path: "sfx/combat/combat_battle_start",     volume: 0.30 },
  combat_victory:      { category: "combat",   path: "sfx/combat/combat_victory",          volume: 0.30 },
  move_zone_transition:{ category: "movement", path: "sfx/movement/move_zone_transition",  volume: 0.12 },
};

export const ALL_SOUND_EFFECT_IDS = Object.keys(SOUND_EFFECTS) as SoundEffectId[];

function getAudioBaseUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const cdn = env?.VITE_ASSET_BASE_URL;
  if (cdn) return `${cdn.replace(/\/$/, "")}/audio`;
  // Resolve against the Vite base (prod serves under /xr/, dev at /). Hardcoded
  // "/audio" would 404 on prod since the bucket path is /xr/audio.
  if (typeof window !== "undefined") {
    const appBase = env?.BASE_URL ?? "/";
    return new URL("audio", new URL(appBase, window.location.href)).href.replace(/\/$/, "");
  }
  return "/audio";
}

export function getSoundEffectConfig(id: SoundEffectId): SoundEffectConfig {
  return SOUND_EFFECTS[id];
}

export function getSoundEffectUrls(id: SoundEffectId): string[] {
  const { path } = SOUND_EFFECTS[id];
  const base = getAudioBaseUrl();
  return [`${base}/${path}.ogg`, `${base}/${path}.mp3`];
}

export function isSoundEffectsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SOUND_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setSoundEffectsEnabled(enabled: boolean): void {
  try { window.localStorage.setItem(SOUND_ENABLED_KEY, enabled ? "1" : "0"); } catch {}
  window.dispatchEvent(new CustomEvent(SOUND_TOGGLE_EVENT, { detail: { enabled } }));
}

const SFX_VOLUME_KEY = "wog-sfx-volume";

/** Master volume multiplier on top of per-effect volumes (0..1). */
export function getSoundEffectMasterVolume(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(SFX_VOLUME_KEY);
    if (raw === null) return 1;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.min(1, Math.max(0, n));
  } catch {
    return 1;
  }
}

export function setSoundEffectMasterVolume(volume: number): void {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
  try { window.localStorage.setItem(SFX_VOLUME_KEY, String(clamped)); } catch {}
}

/**
 * Dispatch a local-only request to play an SFX. Listened to by SfxManager
 * inside this same window. NEVER emit this to the network.
 */
export function playSoundEffect(id: SoundEffectId): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SOUND_EFFECT_EVENT, { detail: { id } }));
}

/**
 * HTMLAudio-pool SFX player. One pool per id (round-robin) so rapid-fire
 * triggers overlap cleanly instead of cutting each other off.
 */
class SfxManager {
  private pools = new Map<SoundEffectId, HTMLAudioElement[]>();
  private nextIndex = new Map<SoundEffectId, number>();
  private readonly poolSize = 3;
  private unlocked = false;
  private listener: ((e: Event) => void) | null = null;
  private unlockHandler: (() => void) | null = null;

  attach(): void {
    if (this.listener) return;
    this.listener = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: SoundEffectId }>).detail;
      if (!detail?.id) return;
      this.play(detail.id);
    };
    window.addEventListener(SOUND_EFFECT_EVENT, this.listener);

    // Autoplay unlock: first pointer/key/touch primes audio context.
    this.unlockHandler = () => {
      this.unlocked = true;
      if (this.unlockHandler) {
        window.removeEventListener("pointerdown", this.unlockHandler, true);
        window.removeEventListener("keydown", this.unlockHandler, true);
        window.removeEventListener("touchstart", this.unlockHandler, true);
      }
    };
    window.addEventListener("pointerdown", this.unlockHandler, true);
    window.addEventListener("keydown", this.unlockHandler, true);
    window.addEventListener("touchstart", this.unlockHandler, true);
  }

  detach(): void {
    if (this.listener) {
      window.removeEventListener(SOUND_EFFECT_EVENT, this.listener);
      this.listener = null;
    }
    if (this.unlockHandler) {
      window.removeEventListener("pointerdown", this.unlockHandler, true);
      window.removeEventListener("keydown", this.unlockHandler, true);
      window.removeEventListener("touchstart", this.unlockHandler, true);
      this.unlockHandler = null;
    }
    for (const pool of this.pools.values()) {
      for (const a of pool) { a.pause(); a.src = ""; }
    }
    this.pools.clear();
    this.nextIndex.clear();
  }

  private ensurePool(id: SoundEffectId): HTMLAudioElement[] {
    let pool = this.pools.get(id);
    if (pool) return pool;
    const [oggUrl, mp3Url] = getSoundEffectUrls(id);
    pool = [];
    for (let i = 0; i < this.poolSize; i += 1) {
      const audio = new Audio();
      audio.preload = "auto";
      // Try OGG first, fall back to MP3 on error (parity with client/).
      let triedFallback = false;
      audio.addEventListener("error", () => {
        if (triedFallback) return;
        triedFallback = true;
        audio.src = mp3Url;
        audio.load();
      });
      audio.src = oggUrl;
      pool.push(audio);
    }
    this.pools.set(id, pool);
    this.nextIndex.set(id, 0);
    return pool;
  }

  private play(id: SoundEffectId): void {
    if (!isSoundEffectsEnabled()) return;
    if (!this.unlocked) return; // pre-gesture: skip silently
    const pool = this.ensurePool(id);
    const idx = this.nextIndex.get(id) ?? 0;
    const audio = pool[idx];
    this.nextIndex.set(id, (idx + 1) % pool.length);
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
    audio.volume = getSoundEffectConfig(id).volume * getSoundEffectMasterVolume();
    audio.play().catch(() => {});
  }
}

export function createSfxManager(): SfxManager {
  const mgr = new SfxManager();
  mgr.attach();
  return mgr;
}

export type { SfxManager };
