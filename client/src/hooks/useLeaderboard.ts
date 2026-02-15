import { useState, useEffect, useCallback } from "react";
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

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/leaderboard?limit=${limit}&sortBy=${sortBy}`);
      if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.statusText}`);
      const data = await res.json();
      setEntries(data.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [limit, sortBy]);

  useEffect(() => {
    setLoading(true);
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  useEffect(() => {
    const interval = setInterval(fetchLeaderboard, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, fetchLeaderboard]);

  return { entries, loading, error, refresh: fetchLeaderboard };
}
