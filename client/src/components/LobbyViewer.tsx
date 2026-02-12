import * as React from "react";
import { useZonePlayers, type ZoneLobby, type PlayerInfo } from "@/hooks/useZonePlayers";
import { cn } from "@/lib/utils";

interface LobbyViewerProps {
  className?: string;
}

function getHealthBarColor(hp: number, maxHp: number): string {
  const percent = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  if (percent > 66) return "bg-green-500";
  if (percent > 33) return "bg-yellow-500";
  return "bg-red-500";
}

function getLevelColor(level: number): string {
  if (level >= 50) return "text-purple-400";
  if (level >= 30) return "text-blue-400";
  if (level >= 15) return "text-green-400";
  return "text-gray-400";
}

function PlayerRow({ player }: { player: PlayerInfo }): React.ReactElement {
  const healthPercent = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;

  return (
    <div className="flex items-center gap-2 px-2 py-1 hover:bg-green-500/10 transition-colors border-b border-green-500/20">
      {/* Level badge */}
      <div
        className={cn(
          "flex items-center justify-center w-10 h-8 font-mono text-xs font-bold border-2 rounded",
          getLevelColor(player.level),
          "border-current"
        )}
      >
        {player.level}
      </div>

      {/* Player name */}
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-green-300 truncate">{player.name}</div>
        {player.raceId && player.classId && (
          <div className="font-mono text-[10px] text-gray-500 truncate">
            {player.raceId} • {player.classId}
          </div>
        )}
      </div>

      {/* HP bar */}
      <div className="w-16">
        <div className="h-2 bg-gray-800 border border-gray-600 rounded-sm overflow-hidden">
          <div
            className={cn("h-full transition-all", getHealthBarColor(player.hp, player.maxHp))}
            style={{ width: `${Math.max(0, Math.min(100, healthPercent))}%` }}
          />
        </div>
        <div className="font-mono text-[9px] text-gray-500 text-center mt-0.5">
          {player.hp}/{player.maxHp}
        </div>
      </div>
    </div>
  );
}

function ZoneLobbyCard({ lobby }: { lobby: ZoneLobby }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(true);

  return (
    <div className="border-2 border-green-500/50 bg-black/80 rounded">
      {/* Zone header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-green-500/20 hover:bg-green-500/30 transition-colors border-b-2 border-green-500/50"
      >
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-mono text-xs">
            {expanded ? "▼" : "▶"}
          </span>
          <span className="text-green-300 font-mono text-sm font-bold uppercase">
            {lobby.zoneId}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-cyan-400 font-mono text-xs">
            {lobby.players.length} player{lobby.players.length !== 1 ? "s" : ""}
          </span>
          <span className="text-gray-500 font-mono text-xs">
            {lobby.totalEntities} entities
          </span>
        </div>
      </button>

      {/* Player list */}
      {expanded && (
        <div className="max-h-48 overflow-y-auto">
          {lobby.players.length === 0 ? (
            <div className="px-3 py-4 text-center text-gray-500 font-mono text-xs">
              No players in this zone
            </div>
          ) : (
            <div>
              {lobby.players.map((player) => (
                <PlayerRow key={player.id} player={player} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LobbyViewer({ className }: LobbyViewerProps): React.ReactElement {
  const { lobbies, loading, error } = useZonePlayers({ pollInterval: 3000 });

  const totalPlayers = lobbies.reduce((sum, lobby) => sum + lobby.players.length, 0);

  return (
    <div
      className={cn(
        "flex flex-col bg-black/90 border-2 border-green-500 shadow-lg",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between bg-green-500/20 border-b-2 border-green-500 px-3 py-2">
        <h3 className="text-green-400 font-mono text-sm font-bold uppercase tracking-wider">
          ▶ Zone Lobbies
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 font-mono text-xs">
            {totalPlayers} online
          </span>
          {loading && (
            <span className="text-green-400 font-mono text-xs animate-pulse">...</span>
          )}
        </div>
      </div>

      {/* Lobbies */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ minHeight: 0 }}>
        {error && (
          <div className="text-red-400 font-mono text-xs p-2 border border-red-500 bg-red-500/10">
            Error: {error.message}
          </div>
        )}

        {!loading && lobbies.length === 0 && !error && (
          <div className="text-gray-500 font-mono text-xs text-center py-4">
            No zones found
          </div>
        )}

        {lobbies.map((lobby) => (
          <ZoneLobbyCard key={lobby.zoneId} lobby={lobby} />
        ))}
      </div>

      {/* Footer stats */}
      <div className="border-t-2 border-green-500/50 bg-green-500/10 px-3 py-2">
        <div className="flex items-center justify-between font-mono text-[10px] text-gray-400">
          <span>{lobbies.length} zone{lobbies.length !== 1 ? "s" : ""}</span>
          <span>Updates every 3s</span>
        </div>
      </div>
    </div>
  );
}
