import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useZonePlayers, type ZoneLobby, type PlayerInfo } from "@/hooks/useZonePlayers";
import { cn } from "@/lib/utils";

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

function PlayerRow({ player }: { player: PlayerInfo }): React.ReactElement {
  const healthPercent = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;

  return (
    <div className="flex items-center gap-2 border-b-2 border-[#1a2338] px-1 py-1.5 hover:bg-[#1a2338] transition-colors">
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
      <div className="w-20">
        <div className="h-2 border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000] overflow-hidden">
          <div
            className={cn("h-full transition-all", getHealthBarColor(player.hp, player.maxHp))}
            style={{ width: `${Math.max(0, Math.min(100, healthPercent))}%` }}
          />
        </div>
        <div className="text-[8px] text-[#9aa7cc] text-center mt-0.5">
          {player.hp}/{player.maxHp}
        </div>
      </div>
    </div>
  );
}

function ZoneLobbySection({ lobby }: { lobby: ZoneLobby }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(true);

  return (
    <div className="space-y-1">
      {/* Zone header button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between border-2 border-black bg-[#283454] px-2 py-1.5 text-left text-[9px] shadow-[2px_2px_0_0_#000] transition hover:bg-[#324165]"
        type="button"
      >
        <span className="truncate text-[#edf2ff] uppercase tracking-wide">
          {expanded ? "▼" : "▶"} {lobby.zoneId}
        </span>
        <div className="inline-flex items-center gap-2">
          <Badge variant="default">{lobby.players.length}</Badge>
          <span className="text-[8px] text-[#9aa7cc]">{lobby.totalEntities} ents</span>
        </div>
      </button>

      {/* Player list */}
      {expanded && lobby.players.length > 0 && (
        <div className="border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000]">
          {lobby.players.map((player) => (
            <PlayerRow key={player.id} player={player} />
          ))}
        </div>
      )}

      {expanded && lobby.players.length === 0 && (
        <div className="border-2 border-black bg-[#0f1830] px-2 py-3 text-center text-[8px] text-[#9aa7cc] shadow-[2px_2px_0_0_#000]">
          No players in zone
        </div>
      )}
    </div>
  );
}

export function LobbyViewer({ className }: LobbyViewerProps): React.ReactElement {
  const { lobbies, loading } = useZonePlayers({ pollInterval: 3000 });

  const totalPlayers = lobbies.reduce((sum, lobby) => sum + lobby.players.length, 0);

  return (
    <Card className={cn("pointer-events-auto", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          Zone Lobbies
          <Badge variant="success">{totalPlayers} online</Badge>
        </CardTitle>
      </CardHeader>
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
    </Card>
  );
}
