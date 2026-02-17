import * as React from "react";
import { useWorldMap } from "@/hooks/useWorldMap";
import type { SimplePOI } from "@/hooks/useWorldMap";
import { gameBus } from "@/lib/eventBus";
import type { Entity } from "@/types";

/* ── Icon glyphs ── */
const POI_ICON: Record<SimplePOI["kind"], string> = {
  portal: "\u27D0",    // ⟐
  shop: "$",
  spawn: "\u2694",     // ⚔
  landmark: "\u2605",  // ★
  structure: "\u26EB", // ⛫
  "road-node": "\u25CB", // ○
};

/* ── Entity dot colors ── */
function entityColor(e: Entity): string {
  switch (e.type) {
    case "player": return "#54f28b";
    case "boss": return "#bb9af7";
    case "mob": return "#ff4d6d";
    default: return "#ffcc00"; // npc, merchant, etc.
  }
}

/* ── Tooltip state ── */
interface Tooltip {
  x: number;
  y: number;
  entity: Entity;
}

/* ── Component ── */
interface WorldMapProps {
  open: boolean;
  onClose: () => void;
}

export function WorldMap({ open, onClose }: WorldMapProps): React.ReactElement | null {
  const { metadata, entities, loading } = useWorldMap(open);
  const [tooltip, setTooltip] = React.useState<Tooltip | null>(null);
  const [selectedContinent, setSelectedContinent] = React.useState<string>("arcadia");
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key.toLowerCase() === "m") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  const zones = metadata?.zones ?? [];
  const connections = metadata?.connections ?? [];
  const continents = metadata?.continents ?? [];

  const handleZoneClick = (zoneId: string) => {
    gameBus.emit("switchZone", { zoneId });
    onClose();
  };

  const handleEntityHover = (e: React.MouseEvent, entity: Entity) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      entity,
    });
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.88)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Map frame */}
      <div
        className="relative w-full max-w-[1100px] mx-4"
        style={{
          border: "3px solid #54f28b",
          backgroundColor: "#0a0f1e",
          boxShadow: "0 0 40px rgba(84,242,139,0.15), inset 0 0 60px rgba(0,0,0,0.5)",
          fontFamily: "'Press Start 2P', 'Courier New', monospace",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "2px solid #54f28b" }}
        >
          <h2
            className="text-[12px] tracking-[0.3em] uppercase"
            style={{ color: "#54f28b", textShadow: "0 0 8px rgba(84,242,139,0.4)" }}
          >
            {">>> WORLD MAP <<<"}
          </h2>
          <button
            onClick={onClose}
            className="text-[9px] uppercase tracking-wider transition-colors"
            style={{ color: "#9aa7cc" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#edf2ff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9aa7cc")}
            type="button"
          >
            [M] Close
          </button>
        </div>

        {/* Continent tabs */}
        {continents.length > 0 && (
          <div
            className="flex items-center gap-1 px-4 py-2 overflow-x-auto"
            style={{ borderBottom: "2px solid #283454" }}
          >
            {continents.map((c) => {
              const isActive = c.id === selectedContinent;
              const isPlayable = c.status === "active";
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedContinent(c.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 transition-all whitespace-nowrap"
                  style={{
                    border: isActive ? "2px solid #54f28b" : "2px solid #283454",
                    backgroundColor: isActive ? "rgba(84,242,139,0.08)" : "transparent",
                    color: isActive ? "#54f28b" : isPlayable ? "#9aa7cc" : "#565f89",
                    fontSize: "8px",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    opacity: isPlayable ? 1 : 0.7,
                  }}
                >
                  <span style={{ fontSize: "10px" }}>{c.icon}</span>
                  <span>{c.name}</span>
                  {!isPlayable && (
                    <span
                      style={{
                        fontSize: "6px",
                        color: "#565f89",
                        border: "1px solid #283454",
                        padding: "1px 3px",
                        marginLeft: "2px",
                      }}
                    >
                      SOON
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Loading state */}
        {loading && zones.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <span className="text-[10px] animate-pulse" style={{ color: "#54f28b" }}>
              LOADING MAP DATA...
            </span>
          </div>
        )}

        {/* Placeholder continent view */}
        {continents.find((c) => c.id === selectedContinent)?.status === "placeholder" && (() => {
          const continent = continents.find((c) => c.id === selectedContinent)!;
          return (
            <div className="flex items-center justify-center px-8 py-16">
              <div
                className="text-center max-w-[500px]"
                style={{
                  border: "2px solid #283454",
                  backgroundColor: "#0f1830",
                  padding: "32px 24px",
                  boxShadow: "4px 4px 0 0 #000",
                }}
              >
                <div style={{ fontSize: "32px", marginBottom: "12px" }}>{continent.icon}</div>
                <h3
                  className="text-[14px] uppercase tracking-[0.3em] mb-3"
                  style={{ color: "#565f89", textShadow: "0 0 6px rgba(86,95,137,0.3)" }}
                >
                  {continent.name}
                </h3>
                <div
                  className="text-[7px] leading-relaxed mb-4"
                  style={{ color: "#565f89" }}
                >
                  {continent.description}
                </div>
                <div
                  className="inline-block text-[8px] uppercase tracking-[0.2em] px-4 py-2"
                  style={{
                    border: "2px dashed #283454",
                    color: "#565f89",
                  }}
                >
                  {"// UNEXPLORED TERRITORY //"}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Zone panels + connection lines (Arcadia) */}
        {selectedContinent === "arcadia" && zones.length > 0 && (
          <div className="relative px-4 py-6">
            {/* SVG connection lines behind panels */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ zIndex: 0 }}
            >
              {connections.map(([fromId, toId]) => {
                const fromIdx = zones.findIndex((z) => z.id === fromId);
                const toIdx = zones.findIndex((z) => z.id === toId);
                if (fromIdx < 0 || toIdx < 0) return null;

                // Each panel is ~1/N of width. Lines go from right edge to left edge.
                const totalPanels = zones.length;
                const gapFraction = 0.04;
                const panelFraction = (1 - gapFraction * (totalPanels - 1)) / totalPanels;

                const x1Pct = (fromIdx * (panelFraction + gapFraction) + panelFraction) * 100;
                const x2Pct = (toIdx * (panelFraction + gapFraction)) * 100;
                const yPct = 50;

                return (
                  <line
                    key={`${fromId}-${toId}`}
                    x1={`${x1Pct}%`}
                    y1={`${yPct}%`}
                    x2={`${x2Pct}%`}
                    y2={`${yPct}%`}
                    stroke="#54f28b"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                    opacity="0.5"
                  />
                );
              })}
            </svg>

            {/* Zone cards — CSS grid for N-zone scalability */}
            <div
              className="relative"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(280px, 1fr))`,
                gap: "3%",
                zIndex: 1,
              }}
            >
              {zones.map((zone) => {
                const zoneEntities = entities[zone.id] || [];
                const players = zoneEntities.filter((e) => e.type === "player");
                const mobs = zoneEntities.filter((e) => e.type === "mob" || e.type === "boss");

                return (
                  <div
                    key={zone.id}
                    className="cursor-pointer transition-all"
                    style={{
                      border: "2px solid #283454",
                      backgroundColor: "#0f1830",
                      boxShadow: "3px 3px 0 0 #000",
                    }}
                    onClick={() => handleZoneClick(zone.id)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "#54f28b";
                      (e.currentTarget as HTMLDivElement).style.boxShadow = "3px 3px 0 0 #000, 0 0 12px rgba(84,242,139,0.2)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "#283454";
                      (e.currentTarget as HTMLDivElement).style.boxShadow = "3px 3px 0 0 #000";
                    }}
                  >
                    {/* Zone header */}
                    <div
                      className="flex items-center justify-between px-2 py-1.5"
                      style={{ borderBottom: "2px solid #283454" }}
                    >
                      <span className="text-[9px] uppercase tracking-wider" style={{ color: "#edf2ff" }}>
                        {zone.name}
                      </span>
                      <span
                        className="text-[7px] px-1.5 py-0.5"
                        style={{
                          color: "#0f1830",
                          backgroundColor: "#54f28b",
                          border: "1px solid #000",
                        }}
                      >
                        {zone.levelRange}
                      </span>
                    </div>

                    {/* Map area */}
                    <div
                      className="relative mx-1 my-1"
                      style={{
                        height: "200px",
                        background: zone.bgTint,
                        overflow: "hidden",
                      }}
                    >
                      {/* POI markers */}
                      {zone.pois.map((poi) => {
                        const left = (poi.x / zone.bounds.width) * 100;
                        const top = (poi.z / zone.bounds.height) * 100;
                        return (
                          <div
                            key={poi.id}
                            className="absolute flex flex-col items-center pointer-events-none"
                            style={{
                              left: `${left}%`,
                              top: `${top}%`,
                              transform: "translate(-50%, -50%)",
                            }}
                          >
                            <span
                              className="text-[10px] leading-none"
                              style={{
                                color: poi.kind === "portal" ? "#54f28b"
                                  : poi.kind === "shop" ? "#ffcc00"
                                  : poi.kind === "spawn" ? "#ff4d6d"
                                  : "#9aa7cc",
                                textShadow: "0 0 4px rgba(0,0,0,0.8)",
                              }}
                            >
                              {POI_ICON[poi.kind] ?? "\u25CB"}
                            </span>
                            <span
                              className="text-[5px] whitespace-nowrap mt-0.5"
                              style={{
                                color: "#9aa7cc",
                                textShadow: "0 0 3px #000, 0 0 3px #000",
                              }}
                            >
                              {poi.name}
                            </span>
                          </div>
                        );
                      })}

                      {/* Entity dots */}
                      {zoneEntities.map((entity) => {
                        const left = (entity.x / zone.bounds.width) * 100;
                        const top = ((entity.y ?? 0) / zone.bounds.height) * 100;
                        return (
                          <div
                            key={entity.id}
                            className="absolute cursor-pointer"
                            style={{
                              left: `${left}%`,
                              top: `${top}%`,
                              width: "4px",
                              height: "4px",
                              backgroundColor: entityColor(entity),
                              boxShadow: `0 0 3px ${entityColor(entity)}`,
                              transform: "translate(-50%, -50%)",
                              zIndex: entity.type === "player" ? 3 : 2,
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseEnter={(e) => handleEntityHover(e, entity)}
                            onMouseLeave={() => setTooltip(null)}
                          />
                        );
                      })}
                    </div>

                    {/* Entity counts footer */}
                    <div
                      className="flex items-center justify-between px-2 py-1"
                      style={{ borderTop: "2px solid #283454" }}
                    >
                      <span className="text-[7px]" style={{ color: "#9aa7cc" }}>
                        {zoneEntities.length} entities
                      </span>
                      <div className="flex gap-2 text-[7px]">
                        <span style={{ color: "#54f28b" }}>{players.length}P</span>
                        <span style={{ color: "#ff4d6d" }}>{mobs.length}M</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend (only for active continent) */}
        {selectedContinent === "arcadia" && <div
          className="flex items-center justify-center gap-6 px-4 py-2"
          style={{ borderTop: "2px solid #283454" }}
        >
          {/* Entity types */}
          <div className="flex items-center gap-4 text-[7px]">
            {[
              { label: "Player", color: "#54f28b" },
              { label: "Mob", color: "#ff4d6d" },
              { label: "NPC", color: "#ffcc00" },
              { label: "Boss", color: "#bb9af7" },
            ].map((item) => (
              <span key={item.label} className="flex items-center gap-1">
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    backgroundColor: item.color,
                    boxShadow: `0 0 3px ${item.color}`,
                  }}
                />
                <span style={{ color: "#9aa7cc" }}>{item.label}</span>
              </span>
            ))}
          </div>

          <span style={{ color: "#283454" }}>|</span>

          {/* POI types */}
          <div className="flex items-center gap-3 text-[7px]">
            {[
              { icon: POI_ICON.portal, label: "Portal", color: "#54f28b" },
              { icon: POI_ICON.shop, label: "Shop", color: "#ffcc00" },
              { icon: POI_ICON.landmark, label: "Landmark", color: "#9aa7cc" },
              { icon: POI_ICON.spawn, label: "Spawn", color: "#ff4d6d" },
            ].map((item) => (
              <span key={item.label} className="flex items-center gap-1">
                <span style={{ color: item.color, fontSize: "9px" }}>{item.icon}</span>
                <span style={{ color: "#9aa7cc" }}>{item.label}</span>
              </span>
            ))}
          </div>
        </div>}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed pointer-events-none"
          style={{
            left: (containerRef.current?.getBoundingClientRect().left ?? 0) + tooltip.x + 10,
            top: (containerRef.current?.getBoundingClientRect().top ?? 0) + tooltip.y - 10,
            zIndex: 60,
            border: "2px solid #54f28b",
            backgroundColor: "#0f1830",
            padding: "4px 8px",
            boxShadow: "2px 2px 0 0 #000",
            fontFamily: "'Press Start 2P', 'Courier New', monospace",
          }}
        >
          <div className="text-[8px]" style={{ color: entityColor(tooltip.entity) }}>
            {tooltip.entity.name}
          </div>
          <div className="text-[7px]" style={{ color: "#9aa7cc" }}>
            Lv.{tooltip.entity.level ?? 1} {tooltip.entity.type}
            {" | "}HP {tooltip.entity.hp}/{tooltip.entity.maxHp}
          </div>
          {tooltip.entity.raceId && tooltip.entity.classId && (
            <div className="text-[6px]" style={{ color: "#565f89" }}>
              {tooltip.entity.raceId} {tooltip.entity.classId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
