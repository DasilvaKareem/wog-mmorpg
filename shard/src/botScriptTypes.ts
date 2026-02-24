/**
 * botScriptTypes.ts
 * Defines the BotScript template and TriggerEvent types used by the agent loop.
 * The bot executes the script autonomously; the AI supervisor sets the script.
 */

/** What the bot is currently doing. Parameters let the AI tune each mode. */
export type BotScriptType =
  | "combat"
  | "gather"
  | "travel"
  | "shop"
  | "craft"
  | "brew"
  | "cook"
  | "quest"
  | "idle";

export interface BotScript {
  type: BotScriptType;
  /** combat: how many levels above the agent mobs can be (default 2) */
  maxLevelOffset?: number;
  /** gather: which node types to target */
  nodeType?: "ore" | "herb" | "both";
  /** travel: destination zone */
  targetZone?: string;
  /** shop: maximum gold to spend this session */
  maxGold?: number;
  /** Why the supervisor chose this script — shown in activity log */
  reason?: string;
}

/** Events that fire during bot script execution and trigger the AI supervisor. */
export type TriggerType =
  | "no_script"       // no active script — agent needs initial decision
  | "level_up"        // agent leveled up — re-evaluate zone/strategy
  | "zone_arrived"    // arrived in a new zone — orient and plan
  | "script_done"     // script completed its goal (travel arrived, fully equipped)
  | "no_targets"      // nothing to do with current script (zone cleared, no nodes)
  | "user_directive"  // user changed focus via chat — re-evaluate
  | "periodic";       // max-stale safety net (~30s)

export interface TriggerEvent {
  type: TriggerType;
  detail: string;
}
