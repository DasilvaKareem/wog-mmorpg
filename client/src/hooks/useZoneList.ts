import * as React from "react";

import { fetchZoneList } from "@/ShardClient";
import type { ZoneListEntry } from "@/types";

interface UseZoneListResult {
  zones: ZoneListEntry[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useZoneList(): UseZoneListResult {
  const [zones, setZones] = React.useState<ZoneListEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    const next = await fetchZoneList();
    setZones(next);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { zones, loading, refresh };
}
