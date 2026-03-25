import { ASSET_BASE_URL } from "@/config";

export const SOUND_EFFECT_EVENT = "wog:play-sfx";
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
  category: "ui" | "movement" | "combat";
  path: string;
  volume: number;
};

const SOUND_EFFECTS: Record<SoundEffectId, SoundEffectConfig> = {
  ui_button_hover: {
    category: "ui",
    path: "sfx/ui/ui_button_hover",
    volume: 0.1,
  },
  ui_button_click: {
    category: "ui",
    path: "sfx/ui/ui_button_click",
    volume: 0.15,
  },
  ui_dialog_open: {
    category: "ui",
    path: "sfx/ui/ui_dialog_open",
    volume: 0.15,
  },
  ui_dialog_close: {
    category: "ui",
    path: "sfx/ui/ui_dialog_close",
    volume: 0.15,
  },
  ui_map_open: {
    category: "ui",
    path: "sfx/ui/ui_map_open",
    volume: 0.15,
  },
  ui_tab_switch: {
    category: "ui",
    path: "sfx/ui/ui_tab_switch",
    volume: 0.15,
  },
  ui_notification: {
    category: "ui",
    path: "sfx/ui/ui_notification",
    volume: 0.12,
  },
  ui_item_pickup: {
    category: "ui",
    path: "sfx/ui/ui_item_pickup",
    volume: 0.15,
  },
  ui_item_drop: {
    category: "ui",
    path: "sfx/ui/ui_item_drop",
    volume: 0.15,
  },
  ui_level_up: {
    category: "ui",
    path: "sfx/ui/ui_level_up",
    volume: 0.2,
  },
  combat_melee_hit: {
    category: "combat",
    path: "sfx/combat/combat_melee_hit",
    volume: 0.3,
  },
  combat_melee_miss: {
    category: "combat",
    path: "sfx/combat/combat_melee_miss",
    volume: 0.25,
  },
  combat_ranged_hit: {
    category: "combat",
    path: "sfx/combat/combat_ranged_hit",
    volume: 0.3,
  },
  combat_ranged_miss: {
    category: "combat",
    path: "sfx/combat/combat_ranged_miss",
    volume: 0.25,
  },
  combat_defend: {
    category: "combat",
    path: "sfx/combat/combat_defend",
    volume: 0.3,
  },
  combat_flee: {
    category: "combat",
    path: "sfx/combat/combat_flee",
    volume: 0.25,
  },
  combat_battle_start: {
    category: "combat",
    path: "sfx/combat/combat_battle_start",
    volume: 0.3,
  },
  combat_victory: {
    category: "combat",
    path: "sfx/combat/combat_victory",
    volume: 0.3,
  },
  move_zone_transition: {
    category: "movement",
    path: "sfx/movement/move_zone_transition",
    volume: 0.12,
  },
};

function getAudioBaseUrl(): string {
  const base = ASSET_BASE_URL ? ASSET_BASE_URL.replace(/\/$/, "") : "";
  return base ? `${base}/audio` : "/audio";
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
    const value = window.localStorage.getItem(SOUND_ENABLED_KEY);
    return value !== "0";
  } catch {
    return true;
  }
}

export const ALL_SOUND_EFFECT_IDS = Object.keys(SOUND_EFFECTS) as SoundEffectId[];

export function playSoundEffect(id: SoundEffectId): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SOUND_EFFECT_EVENT, { detail: { id } }));
}
