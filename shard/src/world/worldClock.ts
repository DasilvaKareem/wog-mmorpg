/**
 * World Clock — Game time runs at 4× real time.
 * 6 real hours = 24 in-game hours (1 full day/night cycle).
 *
 * Time phases:
 *   Dawn    04:00 – 06:00
 *   Day     06:00 – 20:00
 *   Dusk    20:00 – 22:00
 *   Night   22:00 – 04:00
 */

// 1 tick = 1 second real time.  4× speed → 1 tick = 4 game-seconds.
const GAME_SECONDS_PER_TICK = 4;
const GAME_SECONDS_PER_DAY = 24 * 60 * 60; // 86400 game-seconds
const TICKS_PER_GAME_DAY = GAME_SECONDS_PER_DAY / GAME_SECONDS_PER_TICK; // 21600 ticks = 6 real hours

export type TimePhase = "dawn" | "day" | "dusk" | "night";

export interface GameTime {
  /** In-game hour 0-23 */
  hour: number;
  /** In-game minute 0-59 */
  minute: number;
  /** Current day number (starts at 1) */
  day: number;
  /** Time phase for lighting/gameplay */
  phase: TimePhase;
  /** Normalized progress through the day 0.0–1.0 */
  progress: number;
}

/** Derive the current game time from the world tick counter. */
export function getGameTime(tick: number): GameTime {
  const tickInDay = tick % TICKS_PER_GAME_DAY;
  const totalGameSeconds = tickInDay * GAME_SECONDS_PER_TICK;

  const hour = Math.floor(totalGameSeconds / 3600) % 24;
  const minute = Math.floor((totalGameSeconds % 3600) / 60);
  const day = Math.floor(tick / TICKS_PER_GAME_DAY) + 1;
  const progress = tickInDay / TICKS_PER_GAME_DAY;

  return { hour, minute, day, phase: getPhase(hour), progress };
}

function getPhase(hour: number): TimePhase {
  if (hour >= 4 && hour < 6) return "dawn";
  if (hour >= 6 && hour < 20) return "day";
  if (hour >= 20 && hour < 22) return "dusk";
  return "night";
}

/** Check if a phase transition just happened on this tick. Returns the new phase or null. */
export function checkPhaseTransition(tick: number): TimePhase | null {
  if (tick <= 0) return null;
  const prev = getGameTime(tick - 1);
  const curr = getGameTime(tick);
  if (prev.phase !== curr.phase) return curr.phase;
  return null;
}

/** Human-readable time string, e.g. "Day 3, 14:05 (Day)" */
export function formatGameTime(gt: GameTime): string {
  const hh = String(gt.hour).padStart(2, "0");
  const mm = String(gt.minute).padStart(2, "0");
  const label = gt.phase.charAt(0).toUpperCase() + gt.phase.slice(1);
  return `Day ${gt.day}, ${hh}:${mm} (${label})`;
}

export { TICKS_PER_GAME_DAY };
