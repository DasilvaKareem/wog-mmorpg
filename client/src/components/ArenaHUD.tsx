import * as React from "react";

import { useWallet } from "@/hooks/useWallet";
import { gameBus } from "@/lib/eventBus";
import { API_URL } from "@/config";
import { PredictionMarketPanel } from "./PredictionMarketPanel";

interface ArenaCombatant {
  id: string;
  name: string;
  pvpTeam: "red" | "blue";
  stats: { hp: number; maxHp: number };
  alive: boolean;
}

interface BattleState {
  battleId: string;
  status: "queued" | "betting" | "in_progress" | "completed" | "cancelled";
  config: {
    format: string;
    duration: number;
    arena: { name: string };
    teamRed: ArenaCombatant[];
    teamBlue: ArenaCombatant[];
  };
  winner?: "red" | "blue";
  mvp?: string;
  statistics: {
    teamRedDamage: number;
    teamBlueDamage: number;
    teamRedKills: number;
    teamBlueKills: number;
  };
  log: Array<{ turn: number }>;
}

/**
 * ArenaHUD -- overlay displayed when the player is in an active PvP match.
 * Polls the shard for battle state and renders match info on top of the WorldScene.
 */
function BettingToggle({ poolId, battleStatus, winner }: { poolId: string; battleStatus: string; winner?: "red" | "blue" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-2 border-t border-[#29334d] pt-1">
      <button
        className="w-full text-[8px] font-bold uppercase tracking-wide text-[#ffcc00] hover:text-[#fff] transition"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide Bets" : "Place Bet"}
      </button>
      {open && (
        <div className="mt-1">
          <PredictionMarketPanel poolId={poolId} battleStatus={battleStatus} winner={winner} />
        </div>
      )}
    </div>
  );
}

export function ArenaHUD(): React.ReactElement | null {
  const { address } = useWallet();
  const [battleId, setBattleId] = React.useState<string | null>(null);
  const [battle, setBattle] = React.useState<BattleState | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [poolId, setPoolId] = React.useState<string | null>(null);

  // Resolve agentId from wallet address once
  React.useEffect(() => {
    if (!address) {
      setAgentId(null);
      return;
    }

    let cancelled = false;

    const resolve = async () => {
      try {
        const res = await fetch(`${API_URL}/agent/wallet/${encodeURIComponent(address)}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data.agentId) setAgentId(String(data.agentId));
        }
      } catch {
        // silent
      }
    };

    void resolve();
    return () => { cancelled = true; };
  }, [address]);

  // Listen for matchFound events from MatchmakingQueue
  React.useEffect(() => {
    const unsub = gameBus.on("matchFound", ({ battleId: id }) => {
      setBattleId(id);
      setDismissed(false);
    });
    return unsub;
  }, []);

  // Listen for battleEnded to clear state
  React.useEffect(() => {
    const unsub = gameBus.on("battleEnded", () => {
      setBattleId(null);
      setBattle(null);
      setDismissed(false);
    });
    return unsub;
  }, []);

  // Poll for current battle when we don't have a battleId yet
  React.useEffect(() => {
    if (battleId || !agentId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/pvp/player/${encodeURIComponent(agentId)}/current-battle`,
        );
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (data.inBattle && data.battleId) {
          setBattleId(data.battleId);
          setDismissed(false);
        }
      } catch {
        // silent
      }
    };

    void poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [battleId, agentId]);

  // Poll battle state when we have a battleId
  React.useEffect(() => {
    if (!battleId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/pvp/battle/${encodeURIComponent(battleId)}`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (data.battle) {
          setBattle(data.battle);
          if (data.poolId) setPoolId(data.poolId);

          // Auto-clear when completed/cancelled after a delay
          if (data.battle.status === "completed" || data.battle.status === "cancelled") {
            // Keep showing for 12 seconds, then allow ESC dismiss
          }
        }
      } catch {
        // silent
      }
    };

    void poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [battleId]);

  // ESC key: toggle HUD visibility during battle, fully dismiss when over
  React.useEffect(() => {
    if (!battle) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const isOver = battle.status === "completed" || battle.status === "cancelled";
        if (isOver) {
          setDismissed(true);
          setHidden(false);
          setBattleId(null);
          setBattle(null);
          setPoolId(null);
          gameBus.emit("battleEnded", { battleId: battle.battleId });
        } else {
          setHidden((v) => !v);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [battle]);

  // Auto-show HUD again when battle ends so you see the result
  React.useEffect(() => {
    if (!battle) return;
    const isOver = battle.status === "completed" || battle.status === "cancelled";
    if (isOver) setHidden(false);
  }, [battle?.status]);

  // Nothing to show
  if (!battleId || !battle || dismissed) return null;

  // Hidden — show a small pill to bring it back
  if (hidden) {
    return (
      <div className="pointer-events-auto fixed left-1/2 top-3 z-[9999] -translate-x-1/2">
        <button
          className="border-2 border-[#29334d] bg-[#0a0f1a]/95 px-3 py-1 text-[8px] font-bold uppercase tracking-wide text-[#ffcc00] shadow-[2px_2px_0_0_#000] hover:text-[#fff] transition"
          onClick={() => setHidden(false)}
        >
          Show PvP (ESC)
        </button>
      </div>
    );
  }

  const { status, config, winner, mvp, statistics, log } = battle;
  const isOver = status === "completed" || status === "cancelled";

  const redAlive = config.teamRed.filter((c) => c.alive).length;
  const blueAlive = config.teamBlue.filter((c) => c.alive).length;
  const redTotal = config.teamRed.length;
  const blueTotal = config.teamBlue.length;

  // Timer estimate
  const turnCount = log?.length ?? 0;
  const elapsed = Math.floor(turnCount / 2);
  const remaining = Math.max(0, config.duration - elapsed);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  const statusLabel =
    status === "betting"
      ? "BETTING PHASE"
      : status === "in_progress"
        ? "FIGHT"
        : status === "completed"
          ? "COMPLETED"
          : status === "cancelled"
            ? "CANCELLED"
            : status.toUpperCase();

  const statusColor =
    status === "betting"
      ? "text-[#ffcc00]"
      : status === "in_progress"
        ? "text-[#ff4d6d]"
        : "text-[#54f28b]";

  // Find MVP name
  const allCombatants = [...config.teamRed, ...config.teamBlue];
  const mvpName = mvp ? allCombatants.find((c) => c.id === mvp)?.name : null;

  return (
    <div className="pointer-events-auto fixed left-1/2 top-3 z-[9999] -translate-x-1/2">
      <div className="border-2 border-[#29334d] bg-[#0a0f1a]/95 px-5 py-3 shadow-[4px_4px_0_0_#000] backdrop-blur-sm">
        {/* Arena name + status + hide */}
        <div className="flex items-center justify-between gap-4">
          <span
            className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#ffcc00]"
            style={{ textShadow: "2px 2px 0 #000" }}
          >
            {config.arena.name}
          </span>
          <div className="flex items-center gap-3">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${statusColor}`}
              style={{ textShadow: "1px 1px 0 #000" }}
            >
              {statusLabel}
            </span>
            {!isOver && (
              <button
                className="text-[8px] font-bold uppercase text-[#565f89] hover:text-[#ff4d6d] transition"
                onClick={() => setHidden(true)}
                title="Hide PvP HUD (ESC)"
              >
                [HIDE]
              </button>
            )}
          </div>
        </div>

        {/* Timer */}
        {status === "in_progress" && (
          <div className="mt-1 text-center">
            <span
              className={`font-mono text-[18px] font-bold ${remaining <= 30 ? "text-[#ff4d6d]" : "text-[#f1f5ff]"}`}
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              {mins}:{secs.toString().padStart(2, "0")}
            </span>
          </div>
        )}

        {/* Team summary */}
        <div className="mt-2 flex items-center justify-center gap-4 text-[10px] font-bold">
          <span className="text-[#cc3333]">
            RED {redAlive}/{redTotal} alive
          </span>
          <span className="text-[#565f89]">|</span>
          <span className="text-[#3355cc]">
            BLUE {blueAlive}/{blueTotal} alive
          </span>
        </div>

        {/* Damage stats */}
        <div className="mt-1 flex items-center justify-center gap-4 text-[8px] text-[#9aa7cc]">
          <span>
            Red: <span className="font-bold text-[#cc3333]">{statistics.teamRedDamage}</span> dmg
          </span>
          <span className="text-[#565f89]">|</span>
          <span>
            Blue: <span className="font-bold text-[#3355cc]">{statistics.teamBlueDamage}</span> dmg
          </span>
        </div>

        {/* Format */}
        <div className="mt-1 text-center text-[8px] text-[#565f89]">
          {config.format.toUpperCase()}
        </div>

        {/* Prediction Market Betting — collapsible */}
        {poolId && (
          <BettingToggle poolId={poolId} battleStatus={status} winner={winner} />
        )}

        {/* Winner announcement */}
        {isOver && winner && (
          <div className="mt-2 border-t border-[#29334d] pt-2 text-center">
            <div
              className={`text-[14px] font-bold uppercase ${winner === "red" ? "text-[#cc3333]" : "text-[#3355cc]"}`}
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              {winner.toUpperCase()} TEAM WINS!
            </div>
            {mvpName && (
              <div className="mt-1 text-[9px] font-bold text-[#ffcc00]">
                MVP: {mvpName}
              </div>
            )}
            <div className="mt-2 text-[8px] text-[#9aa7cc] animate-pulse">
              Press ESC to return
            </div>
          </div>
        )}

        {/* Cancelled */}
        {status === "cancelled" && (
          <div className="mt-2 border-t border-[#29334d] pt-2 text-center">
            <div className="text-[11px] font-bold text-[#9aa7cc]">
              MATCH CANCELLED
            </div>
            <div className="mt-1 text-[8px] text-[#9aa7cc] animate-pulse">
              Press ESC to return
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
