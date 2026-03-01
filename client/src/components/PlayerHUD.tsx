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

function ResourceBar({
  value,
  max,
  color,
  icon,
  label,
}: {
  value: number;
  max: number;
  color: string;
  icon: string;
  label: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      {/* Number */}
      <span
        className="text-white text-[13px] font-black tabular-nums text-right"
        style={{ minWidth: 64, textShadow: "1px 1px 0 #000, -1px -1px 0 #000" }}
      >
        {value.toLocaleString()}
      </span>
      {/* Bar */}
      <div
        className="h-5 border-2 border-black overflow-hidden shadow-[2px_2px_0_0_rgba(0,0,0,0.8)]"
        style={{ width: 180, background: "rgba(0,0,0,0.55)" }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      {/* Full-size icon — no border, no box */}
      <img
        src={icon}
        alt={label}
        className="w-14 h-14 object-contain drop-shadow-xl flex-shrink-0"
        draggable={false}
      />
    </div>
  );
}

export function PlayerHUD({ walletAddress }: PlayerHUDProps): React.ReactElement | null {
  const { characterProgress, balance } = useWallet();
  const { lobbies } = useZonePlayers({ pollInterval: 2000 });

  const liveEntity = React.useMemo(() => {
    const addr = walletAddress.toLowerCase();
    for (const lobby of lobbies) {
      const p = lobby.players.find((e) => e.walletAddress?.toLowerCase() === addr);
      if (p) return p;
    }
    return null;
  }, [lobbies, walletAddress]);

  if (!characterProgress) return null;

  const { hp, maxHp, level, xp, name } = characterProgress;
  const gold = balance?.gold ?? 0;

  // XP progress within current level
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  const xpInLevel = Math.max(0, xp - currentLevelXp);
  const xpPct = Math.max(0, Math.min(100, (xpInLevel / span) * 100));

  // Use live HP if the entity is found in zone, else fall back to NFT data
  const liveHp = liveEntity?.hp ?? hp;
  const liveMaxHp = liveEntity?.maxHp ?? maxHp;

  const hpColor =
    liveMaxHp > 0 && (liveHp / liveMaxHp) > 0.66
      ? "linear-gradient(90deg,#1a7a30,#54f28b)"
      : liveMaxHp > 0 && (liveHp / liveMaxHp) > 0.33
      ? "linear-gradient(90deg,#7a5a00,#ffcc00)"
      : "linear-gradient(90deg,#7a0000,#ff4444)";

  return (
    <>
      {/* ── TOP-LEFT: Level badge + name + XP bar ── */}
      <div
        className="absolute z-30 flex items-center gap-3 pointer-events-none select-none"
        style={{ top: 8, left: 8 }}
      >
        {/* Level badge — full size icon, number overlaid */}
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
            style={{ textShadow: "1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000" }}
          >
            {name}
          </span>
          {/* XP bar — same width as resource bars */}
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
            className="text-[9px] text-[#54f28b] leading-none font-bold"
            style={{ textShadow: "1px 1px 0 #000" }}
          >
            {xpInLevel.toLocaleString()} / {span.toLocaleString()} XP
          </span>
        </div>
      </div>

      {/* ── TOP-RIGHT: HP, Essence, Gold ── */}
      <div
        className="absolute z-30 flex flex-col gap-2 pointer-events-none select-none"
        style={{ top: 8, right: 8 }}
      >
        {/* HP */}
        <ResourceBar
          value={liveHp}
          max={liveMaxHp}
          color={hpColor}
          icon="/icons/heart.png"
          label="HP"
        />

        {/* Essence (EP) — always shown */}
        <ResourceBar
          value={100}
          max={100}
          color="linear-gradient(90deg,#4a0080,#b04aff)"
          icon="/icons/essence.png"
          label="Essence"
        />

        {/* Gold */}
        <ResourceBar
          value={gold}
          max={Math.max(gold, 10000)}
          color="linear-gradient(90deg,#7a5a00,#ffcc00)"
          icon="/icons/gold.png"
          label="Gold"
        />
      </div>
    </>
  );
}
