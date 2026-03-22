import * as React from "react";
import { API_URL } from "@/config";

export interface ActiveQuestEntry {
  questId: string;
  title: string;
  description: string;
  objective: { type: string; targetMobName?: string; targetNpcName?: string; targetItemName?: string; count: number };
  progress: number;
  required: number;
  complete: boolean;
  rewards: { copper: number; xp: number; items?: Array<{ tokenId: number; quantity: number }> };
  /** Entity ID of the NPC that gave this quest (for turn-in) */
  npcEntityId: string | null;
}

export interface AvailableQuestEntry {
  questId: string;
  title: string;
  description: string;
  npcEntityId: string;
  npcName: string;
  objective: { type: string; targetMobName?: string; targetNpcName?: string; targetItemName?: string; count: number };
  rewards: { copper: number; xp: number; items?: Array<{ tokenId: number; quantity: number }> };
}

export interface CompletedQuestEntry {
  questId: string;
  title: string;
  description: string;
  rewards: { copper: number; xp: number; items?: Array<{ tokenId: number; quantity: number }> };
}

export interface ActivityEntry {
  type: string;
  message: string;
  timestamp: number;
  zoneId: string;
}

export interface QuestLogData {
  entityId: string;
  playerName: string;
  classId?: string | null;
  origin?: string | null;
  storyFlags: string[];
  zoneId: string;
  activeQuests: ActiveQuestEntry[];
  completedQuests: CompletedQuestEntry[];
  activity: ActivityEntry[];
}

export function useQuestLog(walletAddress: string | null): {
  data: QuestLogData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = React.useState<QuestLogData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  const refresh = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    if (!walletAddress) return;

    let cancelled = false;

    async function fetchLog(): Promise<void> {
      try {
        setLoading((prev) => (data === null ? true : prev));
        const res = await fetch(`${API_URL}/questlog/${walletAddress}`);
        if (!res.ok) {
          if (!cancelled) setError("Player not found");
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Failed to fetch quest log");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchLog();
    const interval = setInterval(fetchLog, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [walletAddress, tick]);

  return { data, loading, error, refresh };
}
