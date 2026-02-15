import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { API_URL } from "../config.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGameBridge } from "@/hooks/useGameBridge";
import type { Entity } from "@/types";
import { ColiseumViewer } from "./ColiseumViewer";
import { MatchmakingQueue } from "./MatchmakingQueue";

interface ActiveBattle {
  battleId: string;
  status: string;
  config: {
    format: string;
    arena: { name: string };
    teamRed: Array<{ name: string }>;
    teamBlue: Array<{ name: string }>;
  };
  turnCount: number;
  winner?: "red" | "blue";
}

interface LeaderboardEntry {
  agentId: string;
  walletAddress: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function ColiseumDialog(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [npc, setNpc] = React.useState<Entity | null>(null);
  const [zoneId, setZoneId] = React.useState("human-meadow");
  const [selectedBattleId, setSelectedBattleId] = React.useState<string | null>(null);
  const [activeBattles, setActiveBattles] = React.useState<ActiveBattle[]>([]);
  const [leaderboard, setLeaderboard] = React.useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = React.useState(false);

  useGameBridge("zoneChanged", ({ zoneId: nextZoneId }) => {
    setZoneId(nextZoneId);
  });

  useGameBridge("arenaMasterClick", (entity: Entity) => {
    if (entity.type !== "arena-master") return;
    setNpc(entity);
    setOpen(true);
    setSelectedBattleId(null);
    void fetchBattlesAndLeaderboard();
  });

  const fetchBattlesAndLeaderboard = React.useCallback(async () => {
    setLoading(true);
    try {
      const [battlesRes, leaderboardRes] = await Promise.all([
        fetch(`${API_URL}/api/pvp/battles/active`),
        fetch(`${API_URL}/api/pvp/leaderboard?limit=5`),
      ]);

      if (battlesRes.ok) {
        const battlesData = await battlesRes.json();
        setActiveBattles(battlesData.battles ?? []);
      }

      if (leaderboardRes.ok) {
        const leaderboardData = await leaderboardRes.json();
        setLeaderboard(leaderboardData.leaderboard ?? []);
      }
    } catch {
      // Silently fail — empty state is fine
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while open and on battle list view
  React.useEffect(() => {
    if (!open || selectedBattleId) return;
    const interval = setInterval(fetchBattlesAndLeaderboard, 3000);
    return () => clearInterval(interval);
  }, [open, selectedBattleId, fetchBattlesAndLeaderboard]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto border-4 border-[#29334d] bg-[#11182b] p-0 text-[#f1f5ff]">
        <DialogHeader className="border-b-2 border-[#29334d] bg-[#1a2340] p-4">
          <DialogTitle className="font-mono text-sm text-[#00ff88]">
            {npc ? `${npc.name} - PvP Coliseum` : "PvP Coliseum"}
          </DialogTitle>
          <DialogDescription className="font-mono text-[9px] text-[#9aa7cc]">
            {selectedBattleId
              ? "Watching live battle"
              : "Browse active battles, join the queue, or spectate matches"}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4">
          {selectedBattleId ? (
            /* View 2: Battle Viewer */
            <ColiseumViewer
              battleId={selectedBattleId}
              onBack={() => {
                setSelectedBattleId(null);
                void fetchBattlesAndLeaderboard();
              }}
            />
          ) : (
            /* View 1: Battle List + Queue */
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Left: Active Battles (2/3) */}
                <div className="space-y-3 lg:col-span-2">
                  <h3
                    className="text-[11px] font-bold uppercase tracking-wide text-[#ffcc00]"
                    style={{ textShadow: "2px 2px 0 #000" }}
                  >
                    Active Battles
                  </h3>

                  {loading && activeBattles.length === 0 ? (
                    <div className="text-center text-[9px] text-[#9aa7cc]">Loading battles...</div>
                  ) : activeBattles.length === 0 ? (
                    <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-6 text-center">
                      <p className="text-[9px] text-[#9aa7cc]">No active battles right now</p>
                      <p className="mt-1 text-[8px] text-[#565f89]">
                        Join the queue to start a match
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activeBattles.map((battle) => (
                        <button
                          key={battle.battleId}
                          className="w-full border-2 border-[#29334d] bg-[#1a2340] p-3 text-left transition hover:border-[#00ff88]"
                          onClick={() => setSelectedBattleId(battle.battleId)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">
                                {battle.config.format.toUpperCase()}
                              </Badge>
                              <span className="text-[10px] font-bold text-[#f1f5ff]">
                                {battle.config.arena.name}
                              </span>
                            </div>
                            <Badge
                              variant={
                                battle.status === "in_progress"
                                  ? "default"
                                  : battle.status === "completed"
                                    ? "secondary"
                                    : "danger"
                              }
                            >
                              {battle.status.toUpperCase().replace("_", " ")}
                            </Badge>
                          </div>

                          <div className="mt-2 flex items-center justify-between text-[9px]">
                            <div className="flex items-center gap-2">
                              <span className="text-[#cc3333]">
                                RED: {battle.config.teamRed.map((c) => c.name).join(", ")}
                              </span>
                              <span className="text-[#565f89]">vs</span>
                              <span className="text-[#3355cc]">
                                BLUE: {battle.config.teamBlue.map((c) => c.name).join(", ")}
                              </span>
                            </div>
                            <span className="text-[8px] text-[#9aa7cc]">
                              Turn {battle.turnCount}
                            </span>
                          </div>

                          {battle.winner && (
                            <div className="mt-1 text-[9px] font-bold text-[#ffcc00]">
                              Winner: {battle.winner.toUpperCase()} Team
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: Matchmaking Queue (1/3) */}
                <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-3 lg:col-span-1">
                  <MatchmakingQueue />
                </div>
              </div>

              {/* Bottom: Mini Leaderboard */}
              {leaderboard.length > 0 && (
                <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-3">
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#ffcc00]">
                    Top Fighters
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {leaderboard.map((entry, i) => (
                      <div
                        key={entry.agentId}
                        className="flex items-center gap-2 border border-[#29334d] bg-[#11182b] px-2 py-1"
                      >
                        <span
                          className={`text-[10px] font-bold ${
                            i === 0 ? "text-[#ffcc00]" : i === 1 ? "text-[#c0c0c0]" : i === 2 ? "text-[#cd7f32]" : "text-[#9aa7cc]"
                          }`}
                        >
                          #{i + 1}
                        </span>
                        <span className="font-mono text-[8px] text-[#9aa7cc]">
                          {truncateAddress(entry.walletAddress)}
                        </span>
                        <span className="text-[9px] font-bold text-[#f1f5ff]">
                          {entry.elo} ELO
                        </span>
                        <span className="text-[8px] text-[#54f28b]">
                          {entry.wins}W
                        </span>
                        <span className="text-[8px] text-[#ff4d6d]">
                          {entry.losses}L
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
