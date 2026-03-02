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

function StatLine({
  value,
  max,
  icon,
  label,
  color,
}: {
  value: number;
  max?: number;
  icon: string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <img
        src={icon}
        alt={label}
        className="w-5 h-5 object-contain drop-shadow-md flex-shrink-0"
        draggable={false}
      />
      <span
        className="text-[13px] font-black tabular-nums leading-none"
        style={{ color, textShadow: "1px 1px 0 #000, -1px -1px 0 #000" }}
      >
        {max != null ? `${value.toLocaleString()} / ${max.toLocaleString()}` : value.toLocaleString()}
      </span>
    </div>
  );
}

export function PlayerHUD({ walletAddress }: PlayerHUDProps): React.ReactElement | null {
  const { characterProgress, balance, refreshBalance, refreshCharacterProgress } = useWallet();
  const { lobbies } = useZonePlayers({ pollInterval: 2000 });

  // Auto-refresh gold and character progress every 3s
  React.useEffect(() => {
    const id = setInterval(() => {
      void refreshBalance();
      void refreshCharacterProgress(true);
    }, 3000);
    return () => clearInterval(id);
  }, [refreshBalance, refreshCharacterProgress]);

  // Find this wallet's live entity across all zones
  const live = React.useMemo(() => {
    const addr = walletAddress.toLowerCase();
    for (const lobby of lobbies) {
      const found = lobby.players.find((p) => p.walletAddress?.toLowerCase() === addr);
      if (found) return found;
    }
    return null;
  }, [lobbies, walletAddress]);

  if (!characterProgress) return null;

  // Prefer live zone entity values — they update every 2s with real combat/xp changes
  const name   = live?.name        ?? characterProgress.name;
  const level  = live?.level       ?? characterProgress.level;
  const xp     = live?.xp          ?? characterProgress.xp;
  const hp     = live?.hp          ?? characterProgress.hp;
  const maxHp  = live?.maxHp       ?? characterProgress.maxHp;
  const ep     = live?.essence     ?? 0;
  const maxEp  = live?.maxEssence  ?? 100;
  const gold   = balance?.gold     ?? 0;

  const currentLevelXp = xpForLevel(level);
  const nextLevelXp    = xpForLevel(level + 1);
  const span           = Math.max(1, nextLevelXp - currentLevelXp);
  const xpInLevel      = Math.max(0, xp - currentLevelXp);
  const xpPct          = Math.max(0, Math.min(100, (xpInLevel / span) * 100));

  const hpPct = maxHp > 0 ? hp / maxHp : 0;
  const hpTextColor = hpPct > 0.66 ? "#54f28b" : hpPct > 0.33 ? "#ffcc00" : "#ff4444";

  return (
    <>
      {/* ── TOP-LEFT: Level badge + name + XP bar ── */}
      <div
        className="absolute z-30 flex items-center gap-3 pointer-events-none select-none"
        style={{ top: 8, left: 8 }}
      >
        {/* Level badge */}
        <div className="relative w-16 h-16 flex-shrink-0">
          <img
            src="/icons/level.png"
            alt="Level"
            className="w-full h-full object-contain drop-shadow-xl"
            draggable={false}
          />
          <span
            className="absolute inset-0 flex items-center justify-center font-black text-2xl text-white leading-none"
            style={{ textShadow: "0 0 8px #000, 1px 1px 0 #000, -1px -1px 0 #000" }}
          >
            {level}
          </span>
        </div>

        {/* Name + XP bar */}
        <div className="flex flex-col gap-1.5">
          <span
            className="text-white text-[13px] font-black tracking-wide leading-none"
            style={{ textShadow: "1px 1px 0 #000, -1px 1px 0 #000" }}
          >
            {name}
          </span>
          <div
            className="h-5 border-2 border-black overflow-hidden shadow-[2px_2px_0_0_rgba(0,0,0,0.8)]"
            style={{ width: 180, background: "rgba(0,0,0,0.55)" }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${xpPct}%`,
                background:
                  "repeating-linear-gradient(45deg,#54f28b 0px,#54f28b 5px,#3dd775 5px,#3dd775 10px)",
              }}
            />
          </div>
          <span
            className="text-[9px] text-[#54f28b] font-bold leading-none"
            style={{ textShadow: "1px 1px 0 #000" }}
          >
            {xpInLevel.toLocaleString()} / {span.toLocaleString()} XP
          </span>
        </div>
      </div>

      {/* ── TOP-RIGHT: HP, Essence, Gold ── */}
      <div
        className="absolute z-30 flex flex-col gap-1 pointer-events-none select-none"
        style={{ top: 8, right: 8 }}
      >
        <StatLine value={hp} max={maxHp} icon="/icons/heart.png" label="HP" color={hpTextColor} />
        <StatLine value={ep} max={maxEp} icon="/icons/essence.png" label="Essence" color="#b04aff" />
        <StatLine value={gold} icon="/icons/gold.png" label="Gold" color="#ffcc00" />
      </div>
    </>
  );
}
