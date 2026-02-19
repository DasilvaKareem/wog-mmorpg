import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gameBus } from "@/lib/eventBus";
import { useGameBridge } from "@/hooks/useGameBridge";
import { useZoneList } from "@/hooks/useZoneList";

export function ZoneSelector(): React.ReactElement {
  const { zones, loading } = useZoneList();
  const [currentZone, setCurrentZone] = React.useState("village-square");
  const [collapsed, setCollapsed] = React.useState(false);

  useGameBridge("zoneChanged", ({ zoneId }) => {
    setCurrentZone(zoneId);
  });

  return (
    <Card className="pointer-events-auto absolute bottom-2 left-2 z-30 w-72 md:w-96 md:bottom-4 md:left-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm md:text-base">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-[#9aa7cc] hover:text-[#edf2ff] transition-colors"
              type="button"
            >
              {collapsed ? "+" : "−"}
            </button>
            Zones
          </div>
          <Badge variant="secondary">{zones.length}</Badge>
        </CardTitle>
      </CardHeader>
      {!collapsed && <CardContent className="max-h-64 space-y-1 overflow-auto pt-0 text-[9px]">
        {loading ? <p className="text-[8px] text-[#9aa7cc]">Loading zones...</p> : null}
        {!loading && zones.length === 0 ? <p className="text-[8px] text-[#9aa7cc]">No zones online.</p> : null}
        {zones.map((zone) => {
          const active = zone.zoneId === currentZone;
          return (
            <button
              className={[
                "flex w-full items-center justify-between border-2 border-black px-2 py-1 text-left text-[8px] shadow-[2px_2px_0_0_#000] transition",
                active
                  ? "bg-[#ffcc00] text-black"
                  : "bg-[#283454] text-[#edf2ff] hover:bg-[#324165]",
              ].join(" ")}
              key={zone.zoneId}
              onClick={() => {
                setCurrentZone(zone.zoneId);
                gameBus.emit("switchZone", { zoneId: zone.zoneId });
              }}
              type="button"
            >
              <span className="truncate">{zone.zoneId}</span>
              <span className="inline-flex items-center gap-2 text-[#0f1830]">
                <Badge variant={active ? "default" : "secondary"}>{zone.entityCount}</Badge>
                t{zone.tick}
              </span>
            </button>
          );
        })}
      </CardContent>}
    </Card>
  );
}
