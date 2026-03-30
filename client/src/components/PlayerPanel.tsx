import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useZonePlayers, type ZoneLobby, type PlayerInfo } from "@/hooks/useZonePlayers";
import { useLeaderboard, type LeaderboardEntry, type SortBy } from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";
import { gameBus } from "@/lib/eventBus";

interface PlayerPanelProps {
  className?: string;
}

type Tab = "lobby" | "leaderboard";

const SORT_TABS: { key: SortBy; label: string }[] = [
  { key: "power", label: "Power" },
  { key: "level", label: "Level" },
  { key: "kills", label: "Kills" },
];

/* ── shared helpers ── */

function getLevelBadgeVariant(level: number): "default" | "secondary" | "success" | "danger" {
  if (level >= 30) return "success";
  if (level >= 15) return "default";
  return "secondary";
}

function getRankColor(rank: number): string {
  if (rank === 1) return "text-[#ffdd57]";
  if (rank === 2) return "text-[#a6b2d4]";
  if (rank === 3) return "text-[#ff9e64]";
  return "text-[#9aa7cc]";
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

/* ── Lobby sub-components ── */

function PlayerRow({ player, zoneId }: { player: PlayerInfo; zoneId: string }): React.ReactElement {
  const healthPercent = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;
  const classColor = player.classId ? CLASS_COLORS[player.classId] : undefined;
  const clickable = Boolean(player.walletAddress);

  function handleClick() {
    if (!player.walletAddress) return;
    gameBus.emit("followPlayer", { zoneId, walletAddress: player.walletAddress });
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b-2 border-[#1a2338] px-1 py-1.5 transition-colors",
        clickable ? "cursor-pointer hover:bg-[#1a2338] hover:border-[#54f28b]" : "hover:bg-[#1a2338]"
      )}
      onClick={handleClick}
      title={clickable ? `Click to follow ${player.name}` : undefined}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0 border border-black"
        style={{ backgroundColor: classColor ?? "#9aa7cc" }}
      />
      <Badge variant={getLevelBadgeVariant(player.level)} className="w-10 justify-center">
        {player.level}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="text-[9px] text-[#edf2ff] truncate">{player.name}</div>
        {player.raceId && player.classId && (
          <div className="text-[8px] text-[#9aa7cc] truncate">
            {player.raceId} • {player.classId}
          </div>
        )}
      </div>
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

  return (
    <div className="space-y-1">
      <div className="flex w-full items-center border-2 border-black bg-[#283454] shadow-[2px_2px_0_0_#000] transition hover:bg-[#324165]">
        {/* Expand/collapse arrow */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-1 text-[9px] text-[#9aa7cc] hover:text-[#edf2ff] shrink-0"
          type="button"
        >
          {expanded ? "▼" : "▶"}
        </button>
        {/* Zone name — click to navigate */}
        <button
          onClick={() => gameBus.emit("switchZone", { zoneId: lobby.zoneId })}
          className="flex flex-1 items-center justify-between py-1 pr-2 text-left text-[9px] uppercase tracking-wide text-[#edf2ff]"
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

/* ── Leaderboard sub-components ── */

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 border-b-2 border-[#1a2338] px-1 py-1.5 hover:bg-[#1a2338] transition-colors">
      <span className={cn("w-5 text-right text-[9px] font-bold", getRankColor(entry.rank))}>
        {entry.rank <= 3 ? ["", "I", "II", "III"][entry.rank] : `${entry.rank}`}
      </span>
      <Badge variant={getLevelBadgeVariant(entry.level)} className="w-10 justify-center">
        {entry.level}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className={cn("text-[9px] truncate", entry.rank <= 3 ? getRankColor(entry.rank) : "text-[#edf2ff]")}>
          {entry.name}
        </div>
        <div className="text-[8px] text-[#9aa7cc] truncate">
          {entry.raceId && entry.classId
            ? `${entry.raceId} • ${entry.classId} • ${entry.zoneId}`
            : entry.zoneId}
        </div>
      </div>
      <div className="text-[8px] text-[#9aa7cc] w-10 text-right">
        {entry.kills}k
      </div>
      <div className="text-[9px] text-[#7aa2f7] w-12 text-right font-bold">
        {entry.powerScore}
      </div>
    </div>
  );
}

/* ── Combined panel ── */

export function PlayerPanel({ className }: PlayerPanelProps): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>("lobby");
  const [collapsed, setCollapsed] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<SortBy>("power");

  const { lobbies, gameTime, loading: lobbyLoading, error: lobbyError } = useZonePlayers({ pollInterval: 3000 });
  const { entries, loading: lbLoading, error: leaderboardError } = useLeaderboard({ limit: 10, sortBy, pollInterval: 5000 });

  const totalPlayers = lobbies.reduce((sum, lobby) => sum + lobby.players.length, 0);

  return (
    <Card className={cn("pointer-events-auto", className)} data-tutorial-id="ranks-panel">
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

            {/* Tab switcher */}
            <div className="flex gap-1">
              <button
                onClick={() => setTab("lobby")}
                className={cn(
                  "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                  tab === "lobby"
                    ? "bg-[#2a2210] text-[#ffcc00]"
                    : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                )}
                type="button"
              >
                Lobby
              </button>
              <button
                onClick={() => setTab("leaderboard")}
                className={cn(
                  "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                  tab === "leaderboard"
                    ? "bg-[#2a2210] text-[#ffcc00]"
                    : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                )}
                type="button"
              >
                Ranks
              </button>
            </div>
          </div>

          {/* Right side: context-dependent info */}
          {tab === "lobby" ? (
            <div className="flex items-center gap-2">
              {gameTime && (
                <span className="text-[8px] text-[#9aa7cc] font-mono">
                  {gameTime.phase === "night" ? "\u263D" : gameTime.phase === "dawn" || gameTime.phase === "dusk" ? "\u263C" : "\u2600"}{" "}
                  {String(gameTime.hour).padStart(2, "0")}:{String(gameTime.minute).padStart(2, "0")}
                </span>
              )}
              <Badge variant={lobbyError ? "danger" : "success"}>
                {lobbyError ? "offline" : `${totalPlayers} online`}
              </Badge>
            </div>
          ) : (
            <div className="flex gap-1">
              {SORT_TABS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSortBy(s.key)}
                  className={cn(
                    "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                    sortBy === s.key
                      ? "bg-[#2a2210] text-[#ffcc00]"
                      : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                  )}
                  type="button"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </CardTitle>
      </CardHeader>

      {!collapsed && tab === "lobby" && (
        <CardContent className="max-h-[320px] space-y-2 overflow-auto pt-0 text-[9px]">
          {lobbyLoading && lobbies.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc]">Loading lobbies...</p>
          )}
          {!lobbyLoading && lobbyError && (
            <p className="text-[8px] text-[#ff8f8f]">Shard unavailable. Live lobby data is offline.</p>
          )}
          {!lobbyLoading && !lobbyError && lobbies.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc]">No zones found.</p>
          )}
          {lobbies.map((lobby) => (
            <ZoneLobbySection key={lobby.zoneId} lobby={lobby} />
          ))}
        </CardContent>
      )}

      {!collapsed && tab === "leaderboard" && (
        <CardContent className="pt-0 text-[9px]" style={{ maxHeight: "320px", overflowY: "auto" }}>
          <div className="flex items-center gap-2 border-b-2 border-[#283454] px-1 py-1 text-[8px] text-[#565f89] uppercase">
            <span className="w-5 text-right">#</span>
            <span className="w-10 text-center">Lv</span>
            <span className="flex-1">Name</span>
            <span className="w-10 text-right">Kills</span>
            <span className="w-12 text-right">Score</span>
          </div>

          {lbLoading && entries.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc] py-4 text-center">Loading...</p>
          )}
          {!lbLoading && leaderboardError && entries.length === 0 && (
            <p className="text-[8px] text-[#ff8f8f] py-4 text-center">Shard unavailable.</p>
          )}
          {!lbLoading && !leaderboardError && entries.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc] py-4 text-center">No players yet.</p>
          )}
          {entries.map((entry) => (
            <LeaderboardRow key={entry.entityId} entry={entry} />
          ))}
        </CardContent>
      )}

      {!collapsed && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => gameBus.emit("mapOpen", undefined as never)}
            className="flex w-full items-center justify-center gap-1 border-2 border-[#54f28b]/40 bg-[#0f1e10] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#54f28b] transition hover:bg-[#1a2e18]"
          >
            Map
          </button>
        </div>
      )}
    </Card>
  );
}
