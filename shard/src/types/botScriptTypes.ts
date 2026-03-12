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
  | "trade"
  | "craft"
  | "brew"
  | "cook"
  | "quest"
  | "learn"
  | "idle"
  | "goto";

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
  /** goto: target NPC entity ID */
  targetEntityId?: string;
  /** goto: human-readable NPC name for activity log */
  targetName?: string;
}

/** Events that fire during bot script execution and trigger the AI supervisor. */
export type TriggerType =
  | "no_script"       // no active script — agent needs initial decision
  | "level_up"        // agent leveled up — re-evaluate zone/strategy
  | "zone_arrived"    // arrived in a new zone — orient and plan
  | "script_done"     // script completed its goal (travel arrived, fully equipped)
  | "no_targets"      // nothing to do with current script (zone cleared, no nodes)
  | "blocked"         // action failed repeatedly with a concrete reason
  | "user_directive"  // user changed focus via chat — re-evaluate
  | "stuck"           // script running too long with no progress (~30s)
  | "periodic";       // max-stale safety net (~30s)

export interface TriggerEvent {
  type: TriggerType;
  detail: string;
}
