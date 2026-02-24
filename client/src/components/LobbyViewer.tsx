import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useZonePlayers, type ZoneLobby, type PlayerInfo } from "@/hooks/useZonePlayers";
import { cn } from "@/lib/utils";
import { gameBus } from "@/lib/eventBus";

interface LobbyViewerProps {
  className?: string;
}

function getLevelBadgeVariant(level: number): "default" | "secondary" | "success" | "danger" {
  if (level >= 30) return "success";
  if (level >= 15) return "default";
  return "secondary";
}

function getHealthBarColor(hp: number, maxHp: number): string {
  const percent = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  if (percent > 66) return "bg-[#54f28b]";
  if (percent > 33) return "bg-[#ffcc00]";
  return "bg-[#ff4d6d]";
}

const CLASS_COLORS: Record<string, string> = {
  warrior: "#c83232",
  paladin: "#e6c83c",
  rogue:   "#8232b4",
  ranger:  "#32a03c",
  mage:    "#3264dc",
  cleric:  "#dcdcf0",
  warlock: "#3cb464",
  monk:    "#e69628",
};

function PlayerRow({ player, zoneId }: { player: PlayerInfo; zoneId: string }): React.ReactElement {
  const healthPercent = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;
  const classColor = player.classId ? CLASS_COLORS[player.classId] : undefined;
  const clickable = Boolean(player.walletAddress);

  function handleClick() {
    if (!player.walletAddress) return;
    // Switch to the player's zone first, then lock camera once zone loads
    gameBus.emit("switchZone", { zoneId });
    setTimeout(() => {
      gameBus.emit("lockToPlayer", { walletAddress: player.walletAddress! });
    }, 300);
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b-2 border-[#1a2338] px-1 py-1.5 transition-colors",
        clickable
          ? "cursor-pointer hover:bg-[#1a2338] hover:border-[#54f28b]"
          : "hover:bg-[#1a2338]"
      )}
      onClick={handleClick}
      title={clickable ? `Click to follow ${player.name}` : undefined}
    >
      {/* Class color dot */}
      <span
        className="w-2 h-2 rounded-full shrink-0 border border-black"
        style={{ backgroundColor: classColor ?? "#9aa7cc" }}
      />

      {/* Level badge */}
      <Badge variant={getLevelBadgeVariant(player.level)} className="w-10 justify-center">
        {player.level}
      </Badge>

      {/* Player info */}
      <div className="flex-1 min-w-0">
        <div className="text-[9px] text-[#edf2ff] truncate">{player.name}</div>
        {player.raceId && player.classId && (
          <div className="text-[8px] text-[#9aa7cc] truncate">
            {player.raceId} • {player.classId}
          </div>
        )}
      </div>

      {/* HP bar */}
      <div className="w-16">
        <div className="h-2 border-2 border-black bg-[#0f1830] shadow-[1px_1px_0_0_#000] overflow-hidden">
          <div
            className={cn("h-full transition-all", getHealthBarColor(player.hp, player.maxHp))}
            style={{ width: `${Math.max(0, Math.min(100, healthPercent))}%` }}
          />
        </div>
        <div className="text-[7px] text-[#9aa7cc] text-center mt-0.5">
          {player.hp}/{player.maxHp}
        </div>
      </div>
    </div>
  );
}

function ZoneLobbySection({ lobby }: { lobby: ZoneLobby }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(true);

  function handleZoneClick() {
    gameBus.emit("switchZone", { zoneId: lobby.zoneId });
  }

  return (
    <div className="space-y-1">
      {/* Zone header — click to navigate, arrow to expand */}
      <div className="flex w-full items-center border-2 border-black bg-[#283454] shadow-[2px_2px_0_0_#000] transition hover:bg-[#324165]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-1 text-[9px] text-[#9aa7cc] hover:text-[#edf2ff] shrink-0"
          type="button"
          title="Expand/collapse"
        >
          {expanded ? "▼" : "▶"}
        </button>
        <button
          onClick={handleZoneClick}
          className="flex flex-1 items-center justify-between py-1 pr-2 text-left text-[9px] uppercase tracking-wide text-[#edf2ff] cursor-pointer"
          type="button"
          title={`Go to ${lobby.zoneId}`}
        >
          <span className="truncate">{lobby.zoneId}</span>
          <div className="inline-flex items-center gap-2 shrink-0">
            <Badge variant="default">{lobby.players.length}</Badge>
            <span className="text-[8px] text-[#9aa7cc]">{lobby.totalEntities} ents</span>
          </div>
        </button>
      </div>

      {/* Player list */}
      {expanded && lobby.players.length > 0 && (
        <div className="border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000]">
          {lobby.players.map((player) => (
            <PlayerRow key={player.id} player={player} zoneId={lobby.zoneId} />
          ))}
        </div>
      )}

      {expanded && lobby.players.length === 0 && (
        <div className="border-2 border-black bg-[#0f1830] px-2 py-2 text-center text-[8px] text-[#9aa7cc] shadow-[2px_2px_0_0_#000]">
          No players in zone
        </div>
      )}
    </div>
  );
}

export function LobbyViewer({ className }: LobbyViewerProps): React.ReactElement {
  const { lobbies, loading } = useZonePlayers({ pollInterval: 3000 });
  const [collapsed, setCollapsed] = React.useState(false);

  const totalPlayers = lobbies.reduce((sum, lobby) => sum + lobby.players.length, 0);

  return (
    <Card className={cn("pointer-events-auto", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-[#9aa7cc] hover:text-[#edf2ff] transition-colors"
              type="button"
            >
              {collapsed ? "+" : "−"}
            </button>
            Zone Lobbies
          </div>
          <Badge variant="success">{totalPlayers} online</Badge>
        </CardTitle>
      </CardHeader>

      {!collapsed && (
        <CardContent className="max-h-[320px] space-y-2 overflow-auto pt-0 text-[9px]">
          {loading && lobbies.length === 0 ? (
            <p className="text-[8px] text-[#9aa7cc]">Loading lobbies...</p>
          ) : null}
          {!loading && lobbies.length === 0 ? (
            <p className="text-[8px] text-[#9aa7cc]">No zones found.</p>
          ) : null}
          {lobbies.map((lobby) => (
            <ZoneLobbySection key={lobby.zoneId} lobby={lobby} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}
