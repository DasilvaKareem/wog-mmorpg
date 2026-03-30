import { useState, useEffect, useCallback, useRef } from "react";
import { API_URL } from "../config.js";
import type { GameTime } from "@/types";

export interface PlayerInfo {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  essence?: number;
  maxEssence?: number;
  xp?: number;
  raceId?: string;
  classId?: string;
  walletAddress?: string;
  x: number;
  y: number;
}

export interface ZoneLobby {
  zoneId: string;
  players: PlayerInfo[];
  totalEntities: number;
  tick: number;
}

interface UseZonePlayersOptions {
  pollInterval?: number;
}

export function useZonePlayers(options: UseZonePlayersOptions = {}) {
  const { pollInterval = 3000 } = options;
  const [lobbies, setLobbies] = useState<ZoneLobby[]>([]);
  const [gameTime, setGameTime] = useState<GameTime | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const failureCountRef = useRef(0);

  const fetchZonePlayers = useCallback(async () => {
    try {
      // First, get list of all zones
      const zonesResponse = await fetch(`${API_URL}/zones`);

      if (!zonesResponse.ok) {
        throw new Error(`Failed to fetch zones: ${zonesResponse.statusText}`);
      }

      const zonesData = await zonesResponse.json();
      const zoneIds = Object.keys(zonesData);

      // Fetch details for each zone
      let capturedGameTime: GameTime | null = null;
      const lobbyPromises = zoneIds.map(async (zoneId) => {
        const zoneResponse = await fetch(`${API_URL}/zones/${zoneId}`);

        if (!zoneResponse.ok) {
          console.warn(`Failed to fetch zone ${zoneId}`);
          return null;
        }

        const zoneData = await zoneResponse.json();
        if (!capturedGameTime && zoneData.gameTime) capturedGameTime = zoneData.gameTime;
        const entities = Object.values(zoneData.entities || {}) as any[];

        // Filter for player entities
        const players: PlayerInfo[] = entities
          .filter((e) => e.type === "player")
          .map((e) => ({
            id: e.id,
            name: e.name,
            level: e.level ?? 1,
            hp: e.hp,
            maxHp: e.maxHp,
            essence: e.essence,
            maxEssence: e.maxEssence,
            xp: e.xp,
            raceId: e.raceId,
            classId: e.classId,
            walletAddress: e.walletAddress,
            x: e.x,
            y: e.y,
          }))
          .sort((a, b) => b.level - a.level); // Sort by level descending

        return {
          zoneId,
          players,
          totalEntities: entities.length,
          tick: zoneData.tick,
        } as ZoneLobby;
      });

      const results = await Promise.all(lobbyPromises);
      const validLobbies = results.filter((l): l is ZoneLobby => l !== null);

      // Sort zones by player count descending
      validLobbies.sort((a, b) => b.players.length - a.players.length);

      // Grab gameTime from first zone response
      if (capturedGameTime) setGameTime(capturedGameTime);

      setLobbies(validLobbies);
      setError(null);
      failureCountRef.current = 0;
    } catch (err) {
      setLobbies([]);
      setGameTime(null);
      setError(err instanceof Error ? err : new Error(String(err)));
      failureCountRef.current += 1;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;

    async function poll() {
      if (cancelled) return;
      await fetchZonePlayers();
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
  }, [fetchZonePlayers, pollInterval]);

  return { lobbies, gameTime, loading, error, refresh: fetchZonePlayers };
}
