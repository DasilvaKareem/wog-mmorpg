import * as React from "react";
import { API_URL } from "../config.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HpBar } from "@/components/ui/hp-bar";
import { PredictionMarketPanel } from "./PredictionMarketPanel";

interface ColiseumViewerProps {
  battleId: string;
  onBack?: () => void;
}

interface BattleState {
  battleId: string;
  status: "queued" | "betting" | "in_progress" | "completed" | "cancelled";
  config: {
    format: string;
    duration: number;
    teamRed: Combatant[];
    teamBlue: Combatant[];
    arena: {
      name: string;
      width: number;
      height: number;
    };
    marketPoolId?: string;
  };
  winner?: "red" | "blue";
  mvp?: string;
  phase: string;
  turnCount: number;
  log: TurnRecord[];
  statistics: {
    teamRedDamage: number;
    teamBlueDamage: number;
    teamRedKills: number;
    teamBlueKills: number;
  };
}

interface Combatant {
  id: string;
  name: string;
  pvpTeam: "red" | "blue";
  stats: {
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    speed: number;
  };
  alive: boolean;
  elo: number;
}

interface TurnRecord {
  turn: number;
  actorName: string;
  targetName?: string;
  damage?: number;
  healing?: number;
  killed?: boolean;
  message: string;
}

export function ColiseumViewer({ battleId, onBack }: ColiseumViewerProps): React.ReactElement {
  const [battle, setBattle] = React.useState<BattleState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = React.useState(true);

  React.useEffect(() => {
    fetchBattle();

    if (autoRefresh) {
      const interval = setInterval(fetchBattle, 2000);
      return () => clearInterval(interval);
    }
  }, [battleId, autoRefresh]);

  const fetchBattle = async () => {
    try {
      const response = await fetch(`${API_URL}/api/pvp/battle/${battleId}`);
      if (!response.ok) throw new Error("Battle not found");
      const data = await response.json();
      setBattle(data.battle);
      setLoading(false);

      if (data.battle.status === "completed" || data.battle.status === "cancelled") {
        setAutoRefresh(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-[10px] text-[#9aa7cc]">Loading battle...</div>
      </div>
    );
  }

  if (error || !battle) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-[10px] text-[#ff4d6d]">{error || "Battle not found"}</div>
      </div>
    );
  }

  const timeRemaining =
    battle.status === "in_progress"
      ? battle.config.duration - Math.floor(battle.turnCount / 2)
      : 0;

  return (
    <div className="space-y-3">
      {/* Back button + Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button
              onClick={onBack}
              size="sm"
              variant="ghost"
              className="h-6 text-[8px]"
            >
              {"<-"} Back
            </Button>
          )}
          <h2
            className="text-[11px] font-bold uppercase tracking-wide text-[#ffcc00]"
            style={{ textShadow: "2px 2px 0 #000" }}
          >
            {battle.config.arena.name}
          </h2>
        </div>
        <div className="flex gap-1">
          <Badge variant={getStatusVariant(battle.status)}>
            {battle.status.toUpperCase()}
          </Badge>
          <Badge variant="secondary">{battle.config.format.toUpperCase()}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Left: Arena & Battle Stats */}
        <div className="space-y-3 lg:col-span-2">
          {/* Battle Timer */}
          {battle.status === "in_progress" && (
            <div className="border-4 border-black bg-[#1a2340] p-3 text-center shadow-[4px_4px_0_0_#000]">
              <div className="text-[8px] font-semibold uppercase tracking-wide text-[#9aa7cc]">
                Time Remaining
              </div>
              <div
                className="text-[18px] font-bold text-[#ffcc00]"
                style={{ textShadow: "2px 2px 0 #000" }}
              >
                {formatTime(timeRemaining)}
              </div>
            </div>
          )}

          {/* Team Status */}
          <div className="grid grid-cols-2 gap-3">
            <TeamPanel
              team="RED"
              combatants={battle.config.teamRed}
              damage={battle.statistics.teamRedDamage}
              kills={battle.statistics.teamRedKills}
              isWinner={battle.winner === "red"}
            />
            <TeamPanel
              team="BLUE"
              combatants={battle.config.teamBlue}
              damage={battle.statistics.teamBlueDamage}
              kills={battle.statistics.teamBlueKills}
              isWinner={battle.winner === "blue"}
            />
          </div>

          {/* Battle Log */}
          <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-3">
            <h3 className="mb-2 text-[10px] font-semibold text-[#00ff88]">Battle Log</h3>
            <div className="h-48 space-y-0.5 overflow-y-auto font-mono text-[9px]">
              {battle.log.slice(-20).reverse().map((turn, i) => (
                <div
                  key={i}
                  className={`p-1 ${turn.killed ? "bg-[#3a1020] text-[#ff4d6d]" : "text-[#d6deff]"}`}
                >
                  <span className="text-[#565f89]">#{turn.turn}</span> {turn.message}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Prediction Market */}
        <div className="lg:col-span-1">
          {battle.config.marketPoolId ? (
            <PredictionMarketPanel
              poolId={battle.config.marketPoolId}
              battleStatus={battle.status}
              winner={battle.winner}
            />
          ) : (
            <div className="border-2 border-[#29334d] bg-[#11182b] p-3">
              <p className="text-[9px] text-[#9aa7cc]">No prediction market for this battle</p>
            </div>
          )}
        </div>
      </div>

      {/* MVP Card */}
      {battle.mvp && battle.status === "completed" && (
        <div className="border-4 border-[#ffcc00] bg-[#1a2340] p-3 text-center shadow-[4px_4px_0_0_#000]">
          <div className="text-[9px] font-semibold uppercase text-[#ffcc00]">
            [MVP]
          </div>
          <div
            className="text-[14px] font-bold text-[#f1f5ff]"
            style={{ textShadow: "2px 2px 0 #000" }}
          >
            {battle.config.teamRed.find((c) => c.id === battle.mvp)?.name ||
              battle.config.teamBlue.find((c) => c.id === battle.mvp)?.name}
          </div>
          <div className="text-[9px] text-[#ffcc00]">+100 GOLD Bonus</div>
        </div>
      )}
    </div>
  );
}

function TeamPanel({
  team,
  combatants,
  damage,
  kills,
  isWinner,
}: {
  team: string;
  combatants: Combatant[];
  damage: number;
  kills: number;
  isWinner: boolean;
}) {
  const bgColor = team === "RED" ? "bg-[#cc3333]" : "bg-[#3355cc]";
  const borderClass = isWinner
    ? "border-4 border-[#ffcc00] shadow-[4px_4px_0_0_#000]"
    : "border-2 border-[#29334d]";

  return (
    <div className={`${borderClass} bg-[#11182b] p-2`}>
      <div className={`${bgColor} border-2 border-black p-1.5 text-center text-[10px] font-bold text-white`}>
        {team} TEAM {isWinner && "[WINNER]"}
      </div>

      <div className="mt-2 space-y-2">
        {combatants.map((c) => (
          <div key={c.id} className="space-y-1">
            <div className="flex justify-between text-[9px]">
              <span className={c.alive ? "text-[#f1f5ff]" : "text-[#565f89] line-through"}>
                {c.name}
              </span>
              <span className="text-[8px] text-[#9aa7cc]">ELO: {c.elo}</span>
            </div>
            <HpBar hp={c.stats.hp} maxHp={c.stats.maxHp} />
            <div className="text-[8px] text-[#9aa7cc]">
              ATK: {c.stats.attack} | DEF: {c.stats.defense} | SPD: {Math.round(c.stats.speed)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 border-t border-[#29334d] pt-2 text-[9px] text-[#9aa7cc]">
        <div>DMG: <span className="text-[#ff4d6d]">{damage}</span></div>
        <div>KIL: <span className="text-[#ff4d6d]">{kills}</span></div>
      </div>
    </div>
  );
}

function getStatusVariant(status: string): "default" | "danger" | "secondary" {
  switch (status) {
    case "in_progress":
      return "default";
    case "completed":
      return "secondary";
    case "cancelled":
      return "danger";
    default:
      return "secondary";
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
