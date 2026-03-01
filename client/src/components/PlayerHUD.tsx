import * as React from "react";
import { useWallet } from "@/hooks/useWallet";
import { useZonePlayers } from "@/hooks/useZonePlayers";

interface PlayerHUDProps {
  walletAddress: string;
}

function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 100 * level * level;
}

export function PlayerHUD({ walletAddress }: PlayerHUDProps): React.ReactElement | null {
  const { characterProgress, balance } = useWallet();
  const { lobbies } = useZonePlayers({ pollInterval: 2000 });

  const liveEntity = React.useMemo(() => {
    const addr = walletAddress.toLowerCase();
    for (const lobby of lobbies) {
      const found = lobby.players.find((p) => p.walletAddress?.toLowerCase() === addr);
      if (found) return found;
    }
    return null;
  }, [lobbies, walletAddress]);

  if (!characterProgress) return null;

  const { hp, maxHp, level, xp, name } = characterProgress;
  const gold = balance?.gold ?? 0;

  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;

  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  const xpInLevel = Math.max(0, xp - currentLevelXp);
  const xpPct = Math.max(0, Math.min(100, (xpInLevel / span) * 100));

  const hpColor =
    hpPct > 66
      ? "from-green-700 to-green-500"
      : hpPct > 33
      ? "from-yellow-700 to-yellow-400"
      : "from-red-800 to-red-500";

  return (
    <>
      {/* ── TOP-LEFT: Level badge + name + XP bar ── */}
      <div className="absolute top-2 left-2 z-30 flex items-center gap-2 pointer-events-none select-none">
        {/* Level badge */}
        <div className="relative w-14 h-14 flex-shrink-0">
          <img
            src="/icons/level.png"
            alt="Level"
            className="w-full h-full object-contain drop-shadow-lg"
            draggable={false}
          />
          <span
            className="absolute inset-0 flex items-center justify-center text-white font-black text-xl leading-none"
            style={{ textShadow: "0 0 6px #000, 1px 1px 0 #000, -1px -1px 0 #000" }}
          >
            {level}
          </span>
        </div>

        {/* Name + XP bar */}
        <div className="flex flex-col gap-1">
          <span
            className="text-white text-[12px] font-bold leading-none tracking-wide"
            style={{ textShadow: "1px 1px 0 #000, -1px 1px 0 #000" }}
          >
            {name}
          </span>
          {/* XP bar */}
          <div
            className="w-36 h-4 border-2 border-black overflow-hidden shadow-[2px_2px_0_0_#000]"
            style={{ background: "rgba(0,0,0,0.6)" }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${xpPct}%`,
                background:
                  "repeating-linear-gradient(45deg,#54f28b 0px,#54f28b 4px,#3dd775 4px,#3dd775 8px)",
              }}
            />
          </div>
          <span
            className="text-[8px] text-[#54f28b] leading-none"
            style={{ textShadow: "1px 1px 0 #000" }}
          >
            {xpInLevel.toLocaleString()} / {span.toLocaleString()} XP
          </span>
        </div>
      </div>

      {/* ── TOP-RIGHT: HP, Essence, Gold bars ── */}
      <div className="absolute top-2 right-2 z-30 flex flex-col gap-2 pointer-events-none select-none">
        {/* HP row */}
        <div className="flex items-center gap-2">
          <span
            className="text-white text-[10px] font-bold w-16 text-right leading-none tabular-nums"
            style={{ textShadow: "1px 1px 0 #000" }}
          >
            {hp} / {maxHp}
          </span>
          <div
            className="w-32 h-5 border-2 border-black overflow-hidden shadow-[2px_2px_0_0_#000]"
            style={{ background: "rgba(0,0,0,0.6)" }}
          >
            <div
              className={`h-full bg-gradient-to-r ${hpColor} transition-all duration-300`}
              style={{ width: `${hpPct}%` }}
            />
          </div>
          <img
            src="/icons/heart.png"
            alt="HP"
            className="w-9 h-9 object-contain drop-shadow-lg flex-shrink-0"
            draggable={false}
          />
        </div>

        {/* Essence / EP row — shown when live entity exists */}
        {liveEntity && (
          <div className="flex items-center gap-2">
            <span
              className="text-purple-300 text-[10px] font-bold w-16 text-right leading-none"
              style={{ textShadow: "1px 1px 0 #000" }}
            >
              — EP —
            </span>
            <div
              className="w-32 h-5 border-2 border-black overflow-hidden shadow-[2px_2px_0_0_#000]"
              style={{ background: "rgba(0,0,0,0.6)" }}
            >
              <div
                className="h-full bg-gradient-to-r from-purple-900 to-purple-400"
                style={{ width: "60%" }}
              />
            </div>
            <img
              src="/icons/essence.png"
              alt="Essence"
              className="w-9 h-9 object-contain drop-shadow-lg flex-shrink-0"
              draggable={false}
            />
          </div>
        )}

        {/* Gold row */}
        <div className="flex items-center gap-2">
          <span
            className="text-[#ffcc00] text-[10px] font-bold w-16 text-right leading-none tabular-nums"
            style={{ textShadow: "1px 1px 0 #000" }}
          >
            {gold.toLocaleString()}
          </span>
          <div
            className="w-32 h-5 border-2 border-black overflow-hidden shadow-[2px_2px_0_0_#000]"
            style={{ background: "rgba(0,0,0,0.6)" }}
          >
            <div className="h-full bg-gradient-to-r from-yellow-800 to-yellow-400 w-full" />
          </div>
          <img
            src="/icons/gold.png"
            alt="Gold"
            className="w-9 h-9 object-contain drop-shadow-lg flex-shrink-0"
            draggable={false}
          />
        </div>
      </div>
    </>
  );
}
