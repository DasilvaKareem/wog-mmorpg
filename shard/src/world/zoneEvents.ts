/**
 * Zone Event Logging System
 * Tracks all actions and messages in each zone for an 8-bit style chat log.
 */

export type ZoneEventType =
  | "combat"
  | "death"
  | "kill"
  | "move"
  | "chat"
  | "spawn"
  | "levelup"
  | "loot"
  | "trade"
  | "shop"
  | "quest"
  | "system";

export interface ZoneEvent {
  id: string;
  zoneId: string;
  type: ZoneEventType;
  timestamp: number;
  tick: number;
  /** Short message displayed in chat log (8-bit style) */
  message: string;
  /** Entity ID that triggered the event (optional) */
  entityId?: string;
  /** Entity name for display */
  entityName?: string;
  /** Target entity ID (for combat, trade, etc.) */
  targetId?: string;
  /** Target name for display */
  targetName?: string;
  /** Additional data (damage, gold, item name, etc.) */
  data?: Record<string, unknown>;
}

// In-memory circular buffer per zone
const MAX_EVENTS_PER_ZONE = 500;
const zoneEventLogs = new Map<string, ZoneEvent[]>();
let eventIdCounter = 0;

/**
 * Log an event to a specific zone's event log.
 */
export function logZoneEvent(params: Omit<ZoneEvent, "id" | "timestamp">): void {
  const event: ZoneEvent = {
    ...params,
    id: `evt_${++eventIdCounter}`,
    timestamp: Date.now(),
  };

  let log = zoneEventLogs.get(params.zoneId);
  if (!log) {
    log = [];
    zoneEventLogs.set(params.zoneId, log);
  }

  log.push(event);

  // Keep circular buffer at max size
  if (log.length > MAX_EVENTS_PER_ZONE) {
    log.shift();
  }
}

/**
 * Get recent events for a zone.
 */
export function getZoneEvents(
  zoneId: string,
  limit = 100,
  since?: number
): ZoneEvent[] {
  const log = zoneEventLogs.get(zoneId);
  if (!log) return [];

  let filtered = log;
  if (since != null) {
    filtered = log.filter((e) => e.timestamp > since);
  }

  return filtered.slice(-limit);
}

/**
 * Get recent events across all zones (for global feed).
 */
export function getAllZoneEvents(limit = 100, since?: number): ZoneEvent[] {
  const allEvents: ZoneEvent[] = [];

  for (const log of zoneEventLogs.values()) {
    allEvents.push(...log);
  }

  // Sort by timestamp descending
  allEvents.sort((a, b) => b.timestamp - a.timestamp);

  let filtered = allEvents;
  if (since != null) {
    filtered = allEvents.filter((e) => e.timestamp > since);
  }

  return filtered.slice(0, limit);
}

/**
 * Clear all events for a zone (for testing/admin).
 */
export function clearZoneEvents(zoneId: string): void {
  zoneEventLogs.delete(zoneId);
}
