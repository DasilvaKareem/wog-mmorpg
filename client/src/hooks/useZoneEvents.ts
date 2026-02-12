import { useState, useEffect, useCallback } from "react";

export interface ZoneEvent {
  id: string;
  zoneId: string;
  type: "combat" | "death" | "kill" | "move" | "chat" | "spawn" | "levelup" | "loot" | "trade" | "shop" | "quest" | "system";
  timestamp: number;
  tick: number;
  message: string;
  entityId?: string;
  entityName?: string;
  targetId?: string;
  targetName?: string;
  data?: Record<string, unknown>;
}

interface UseZoneEventsOptions {
  limit?: number;
  pollInterval?: number;
}

export function useZoneEvents(
  zoneId: string | null,
  options: UseZoneEventsOptions = {}
) {
  const { limit = 100, pollInterval = 2000 } = options;
  const [events, setEvents] = useState<ZoneEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!zoneId) return;

    try {
      const since = events.length > 0 ? events[events.length - 1].timestamp : undefined;

      const url = since
        ? `/events/${zoneId}?limit=${limit}&since=${since}`
        : `/events/${zoneId}?limit=${limit}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch events: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.events && Array.isArray(data.events)) {
        setEvents((prev) => {
          // Merge new events, avoiding duplicates
          const existingIds = new Set(prev.map((e) => e.id));
          const newEvents = data.events.filter((e: ZoneEvent) => !existingIds.has(e.id));
          const merged = [...prev, ...newEvents];

          // Keep only the latest N events
          return merged.slice(-limit);
        });
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [zoneId, limit, events]);

  // Initial fetch
  useEffect(() => {
    if (zoneId) {
      setLoading(true);
      fetchEvents();
    }
  }, [zoneId]);

  // Poll for new events
  useEffect(() => {
    if (!zoneId) return;

    const interval = setInterval(fetchEvents, pollInterval);
    return () => clearInterval(interval);
  }, [zoneId, pollInterval, fetchEvents]);

  return { events, loading, error };
}
