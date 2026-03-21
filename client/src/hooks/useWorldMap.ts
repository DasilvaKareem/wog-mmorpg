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

interface WorldLayoutZone {
  id: string;
  offset: { x: number; z: number };
  size: { width: number; height: number };
  levelReq: number;
}

interface WorldLayoutData {
  zones: Record<string, WorldLayoutZone>;
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
      let data: WorldMapMetadata | null = null;

      const layoutRes = await fetch(`${API_URL}/world/layout`);
      if (layoutRes.ok) {
        const layout = (await layoutRes.json()) as WorldLayoutData;
        data = {
          zones: Object.values(layout.zones).map((zone) => ({
            id: zone.id,
            name: zone.id,
            levelRange: `L${zone.levelReq}+`,
            levelReq: zone.levelReq,
            bgTint: "rgba(84,242,139,0.08)",
            bounds: { width: zone.size.width, height: zone.size.height },
            pois: [],
          })),
          connections: [],
          continents: [],
        };
      } else {
        const res = await fetch(`${API_URL}/worldmap`);
        if (!res.ok) return;
        data = (await res.json()) as WorldMapMetadata;
      }

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
      let activeZoneIds: Set<string> | null = null;
      const zonesRes = await fetch(`${API_URL}/zones`);
      if (zonesRes.ok) {
        const zones = await zonesRes.json() as Record<string, unknown>;
        activeZoneIds = new Set(Object.keys(zones));
      }

      const results = await Promise.all(
        meta.zones
          .filter((zone) => !activeZoneIds || activeZoneIds.has(zone.id))
          .map(async (zone) => {
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

      const map: WorldMapEntities = Object.fromEntries(
        meta.zones.map((zone) => [zone.id, [] as Entity[]])
      );
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
