import { useState, useEffect, useCallback, useRef } from "react";
import { API_URL } from "../config.js";
import type { Entity } from "@/types";

// ── Types mirroring the server WorldMapData contract ──

export interface SimplePOI {
  id: string;
  name: string;
  x: number;
  z: number;
  kind: "portal" | "shop" | "spawn" | "landmark" | "structure" | "road-node";
  destination?: string;
}

export interface ZoneMapInfo {
  id: string;
  name: string;
  levelRange: string;
  levelReq: number;
  bgTint: string;
  bounds: { width: number; height: number };
  pois: SimplePOI[];
}

export interface ContinentInfo {
  id: string;
  name: string;
  status: "active" | "placeholder";
  description: string;
  tint: string;
  icon: string;
}

export interface WorldMapMetadata {
  zones: ZoneMapInfo[];
  connections: [string, string][];
  continents: ContinentInfo[];
}

export type WorldMapEntities = Record<string, Entity[]>;

export function useWorldMap(enabled: boolean, pollInterval = 3000) {
  const [metadata, setMetadata] = useState<WorldMapMetadata | null>(null);
  const [entities, setEntities] = useState<WorldMapEntities>({});
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const metadataRef = useRef<WorldMapMetadata | null>(null);

  // Fetch metadata once when map opens
  const fetchMetadata = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/worldmap`);
      if (!res.ok) return;
      const data: WorldMapMetadata = await res.json();
      if (!mountedRef.current) return;
      metadataRef.current = data;
      setMetadata(data);
    } catch {
      // silently ignore
    }
  }, []);

  // Poll entity data for all zones from metadata
  const fetchEntities = useCallback(async () => {
    const meta = metadataRef.current;
    if (!meta) return;

    try {
      const results = await Promise.all(
        meta.zones.map(async (zone) => {
          const res = await fetch(`${API_URL}/zones/${zone.id}`);
          if (!res.ok) return { zoneId: zone.id, entities: [] as Entity[] };
          const json = await res.json();
          return {
            zoneId: zone.id,
            entities: Object.values(json.entities || {}) as Entity[],
          };
        })
      );

      if (!mountedRef.current) return;

      const map: WorldMapEntities = {};
      for (const r of results) {
        map[r.zoneId] = r.entities;
      }
      setEntities(map);
    } catch {
      // silently ignore — map will show stale data
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);

    // Fetch metadata first, then start entity polling
    fetchMetadata().then(() => {
      fetchEntities();
    });

    const id = setInterval(fetchEntities, pollInterval);
    return () => clearInterval(id);
  }, [enabled, pollInterval, fetchMetadata, fetchEntities]);

  return { metadata, entities, loading };
}
