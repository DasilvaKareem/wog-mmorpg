import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLeaderboard, type LeaderboardEntry, type SortBy } from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";

interface LeaderboardProps {
  className?: string;
}

const SORT_TABS: { key: SortBy; label: string }[] = [
  { key: "power", label: "Power" },
  { key: "level", label: "Level" },
  { key: "kills", label: "Kills" },
];

function getRankColor(rank: number): string {
  if (rank === 1) return "text-[#ffdd57]"; // gold
  if (rank === 2) return "text-[#a6b2d4]"; // silver
  if (rank === 3) return "text-[#ff9e64]"; // bronze
  return "text-[#9aa7cc]";
}

function getLevelBadgeVariant(level: number): "default" | "secondary" | "success" | "danger" {
  if (level >= 30) return "success";
  if (level >= 15) return "default";
  return "secondary";
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 border-b-2 border-[#1a2338] px-1 py-1.5 hover:bg-[#1a2338] transition-colors">
      {/* Rank */}
      <span className={cn("w-5 text-right text-[9px] font-bold", getRankColor(entry.rank))}>
        {entry.rank <= 3 ? ["", "I", "II", "III"][entry.rank] : `${entry.rank}`}
      </span>

      {/* Level badge */}
      <Badge variant={getLevelBadgeVariant(entry.level)} className="w-10 justify-center">
        {entry.level}
      </Badge>

      {/* Player info */}
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

      {/* Kills */}
      <div className="text-[8px] text-[#9aa7cc] w-10 text-right">
        {entry.kills}k
      </div>

      {/* Power score */}
      <div className="text-[9px] text-[#7aa2f7] w-12 text-right font-bold">
        {entry.powerScore}
      </div>
    </div>
  );
}

export function Leaderboard({ className }: LeaderboardProps): React.ReactElement {
  const [sortBy, setSortBy] = React.useState<SortBy>("power");
  const [collapsed, setCollapsed] = React.useState(false);
  const { entries, loading } = useLeaderboard({ limit: 10, sortBy, pollInterval: 5000 });

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
            Leaderboard
          </div>
          <div className="flex gap-1">
            {SORT_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSortBy(tab.key)}
                className={cn(
                  "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                  sortBy === tab.key
                    ? "bg-[#7aa2f7] text-[#0f1830]"
                    : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                )}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>

      {!collapsed && (
        <CardContent className="pt-0 text-[9px]" style={{ maxHeight: "240px", overflowY: "auto" }}>
          {/* Column headers */}
          <div className="flex items-center gap-2 border-b-2 border-[#283454] px-1 py-1 text-[8px] text-[#565f89] uppercase">
            <span className="w-5 text-right">#</span>
            <span className="w-10 text-center">Lv</span>
            <span className="flex-1">Name</span>
            <span className="w-10 text-right">Kills</span>
            <span className="w-12 text-right">Score</span>
          </div>

          {loading && entries.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc] py-4 text-center">Loading...</p>
          )}

          {!loading && entries.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc] py-4 text-center">No players yet.</p>
          )}

          {entries.map((entry) => (
            <LeaderboardRow key={entry.entityId} entry={entry} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}
