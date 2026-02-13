/**
 * Coliseum Viewer Component
 * Main view for watching PvP battles with integrated prediction market
 */

import React, { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { HpBar } from "./ui/hp-bar";
import { PredictionMarketPanel } from "./PredictionMarketPanel";

interface ColiseumViewerProps {
  battleId: string;
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

export function ColiseumViewer({ battleId }: ColiseumViewerProps) {
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchBattle();

    if (autoRefresh) {
      const interval = setInterval(fetchBattle, 2000);
      return () => clearInterval(interval);
    }
  }, [battleId, autoRefresh]);

  const fetchBattle = async () => {
    try {
      const response = await fetch(`/api/pvp/battle/${battleId}`);
      if (!response.ok) {
        throw new Error("Battle not found");
      }
      const data = await response.json();
      setBattle(data.battle);
      setLoading(false);

      // Stop auto-refresh when battle is completed
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
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">Loading battle...</div>
      </div>
    );
  }

  if (error || !battle) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl text-red-500">{error || "Battle not found"}</div>
      </div>
    );
  }

  const timeRemaining = battle.status === "in_progress"
    ? battle.config.duration - Math.floor(battle.turnCount / 2)
    : 0;

  return (
    <div className="container mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">
          {battle.config.arena.name}
        </h1>
        <div className="flex gap-2">
          <Badge variant={getStatusVariant(battle.status)}>
            {battle.status.toUpperCase()}
          </Badge>
          <Badge variant="outline">{battle.config.format.toUpperCase()}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Arena & Battle Stats */}
        <div className="lg:col-span-2 space-y-4">
          {/* Battle Timer */}
          {battle.status === "in_progress" && (
            <Card className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white">
              <div className="text-center">
                <div className="text-sm font-semibold">TIME REMAINING</div>
                <div className="text-4xl font-bold">{formatTime(timeRemaining)}</div>
              </div>
            </Card>
          )}

          {/* Team Status */}
          <div className="grid grid-cols-2 gap-4">
            {/* Red Team */}
            <TeamPanel
              team="RED"
              combatants={battle.config.teamRed}
              damage={battle.statistics.teamRedDamage}
              kills={battle.statistics.teamRedKills}
              isWinner={battle.winner === "red"}
            />

            {/* Blue Team */}
            <TeamPanel
              team="BLUE"
              combatants={battle.config.teamBlue}
              damage={battle.statistics.teamBlueDamage}
              kills={battle.statistics.teamBlueKills}
              isWinner={battle.winner === "blue"}
            />
          </div>

          {/* Battle Log */}
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-2">Battle Log</h3>
            <div className="h-64 overflow-y-auto space-y-1 text-sm font-mono">
              {battle.log.slice(-20).reverse().map((turn, i) => (
                <div
                  key={i}
                  className={`p-1 ${
                    turn.killed ? "bg-red-100 dark:bg-red-900" : ""
                  }`}
                >
                  <span className="text-gray-500">#{turn.turn}</span> {turn.message}
                </div>
              ))}
            </div>
          </Card>
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
            <Card className="p-4">
              <p className="text-gray-500">No prediction market for this battle</p>
            </Card>
          )}
        </div>
      </div>

      {/* MVP Card */}
      {battle.mvp && battle.status === "completed" && (
        <Card className="p-4 bg-gradient-to-r from-yellow-400 to-yellow-600 text-white">
          <div className="text-center">
            <div className="text-sm font-semibold">🏆 MVP 🏆</div>
            <div className="text-2xl font-bold">
              {battle.config.teamRed.find((c) => c.id === battle.mvp)?.name ||
                battle.config.teamBlue.find((c) => c.id === battle.mvp)?.name}
            </div>
            <div className="text-sm">+100 GOLD Bonus</div>
          </div>
        </Card>
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
  const bgColor = team === "RED" ? "bg-red-600" : "bg-blue-600";
  const borderColor = isWinner ? "border-yellow-400 border-4" : "";

  return (
    <Card className={`p-4 ${borderColor}`}>
      <div className={`${bgColor} text-white p-2 rounded mb-2 text-center font-bold`}>
        {team} TEAM {isWinner && "👑"}
      </div>

      <div className="space-y-2">
        {combatants.map((c) => (
          <div key={c.id} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className={c.alive ? "" : "line-through text-gray-400"}>
                {c.name}
              </span>
              <span className="text-xs text-gray-500">ELO: {c.elo}</span>
            </div>
            <HpBar current={c.stats.hp} max={c.stats.maxHp} />
            <div className="text-xs text-gray-500">
              ATK: {c.stats.attack} | DEF: {c.stats.defense} | SPD: {Math.round(c.stats.speed)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t">
        <div className="text-sm">
          <div>💥 Damage: {damage}</div>
          <div>☠️ Kills: {kills}</div>
        </div>
      </div>
    </Card>
  );
}

function getStatusVariant(status: string): "default" | "destructive" | "outline" {
  switch (status) {
    case "in_progress":
      return "default";
    case "completed":
      return "outline";
    case "cancelled":
      return "destructive";
    default:
      return "outline";
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
