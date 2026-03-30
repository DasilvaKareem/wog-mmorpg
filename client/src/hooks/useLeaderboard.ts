import { useState, useEffect, useCallback, useRef } from "react";
import { API_URL } from "../config.js";

export interface LeaderboardEntry {
  rank: number;
  entityId: string;
  name: string;
  level: number;
  xp: number;
  kills: number;
  raceId: string | null;
  classId: string | null;
  zoneId: string;
  powerScore: number;
}

export type SortBy = "power" | "level" | "kills";

interface UseLeaderboardOptions {
  limit?: number;
  sortBy?: SortBy;
  pollInterval?: number;
}

export function useLeaderboard(options: UseLeaderboardOptions = {}) {
  const { limit = 10, sortBy = "power", pollInterval = 5000 } = options;
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const failureCountRef = useRef(0);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/leaderboard?limit=${limit}&sortBy=${sortBy}`);
      if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.statusText}`);
      const data = await res.json();
      setEntries(data.entries);
      setError(null);
      failureCountRef.current = 0;
    } catch (err) {
      setEntries([]);
      setError(err instanceof Error ? err : new Error(String(err)));
      failureCountRef.current += 1;
    } finally {
      setLoading(false);
    }
  }, [limit, sortBy]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;

    async function poll() {
      if (cancelled) return;
      await fetchLeaderboard();
      if (cancelled) return;

      const failureCount = failureCountRef.current;
      const nextDelay =
        failureCount === 0
          ? pollInterval
          : Math.min(30000, pollInterval * 2 ** Math.min(failureCount, 3));

      timeoutId = window.setTimeout(() => {
        void poll();
      }, nextDelay);
    }

    setLoading(true);
    void poll();

    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [fetchLeaderboard, pollInterval]);

  return { entries, loading, error, refresh: fetchLeaderboard };
}
