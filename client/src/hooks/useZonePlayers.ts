import { useState, useEffect, useCallback } from "react";
import { API_URL } from "../config.js";

export interface PlayerInfo {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  xp?: number;
  raceId?: string;
  classId?: string;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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
      const lobbyPromises = zoneIds.map(async (zoneId) => {
        const zoneResponse = await fetch(`${API_URL}/zones/${zoneId}`);

        if (!zoneResponse.ok) {
          console.warn(`Failed to fetch zone ${zoneId}`);
          return null;
        }

        const zoneData = await zoneResponse.json();
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
            xp: e.xp,
            raceId: e.raceId,
            classId: e.classId,
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

      setLobbies(validLobbies);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchZonePlayers();
  }, [fetchZonePlayers]);

  // Poll for updates
  useEffect(() => {
    const interval = setInterval(fetchZonePlayers, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, fetchZonePlayers]);

  return { lobbies, loading, error, refresh: fetchZonePlayers };
}
